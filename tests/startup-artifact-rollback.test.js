import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { installService } from "../dist/runtime/lifecycle/actions.js";
import { getLifecycleState, resetLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { resolveRuntimeInstanceId } from "../dist/runtime/instance/registry.js";
import { rehydrateDiscoveredServices } from "../dist/runtime/state/rehydrate.js";
import { writeServiceState } from "../dist/runtime/state/writeState.js";
import {
  createStartupArtifactAcquisitionHooks,
  completeCommittedStartupMaterializationCleanup,
  discardStartupMaterializationSidecar,
  inspectStartupMaterializations,
  rollbackStartupArtifactAcquisitions,
} from "../dist/runtime/startup/materialization.js";
import { advanceStartupTransaction, beginStartupTransaction } from "../dist/runtime/startup/transaction.js";
import { makeTempServicesRoot } from "./test-helpers.js";

function artifactZip() {
  const archive = new AdmZip();
  archive.addFile("runtime/service.mjs", Buffer.from("console.log('artifact');\n", "utf8"));
  return archive.toBuffer();
}

async function startArtifactServer(bytes) {
  let downloads = 0;
  const server = createServer((request, response) => {
    if (request.url === "/artifact.zip") {
      downloads += 1;
      response.end(bytes);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/artifact.zip`,
    downloads: () => downloads,
    close: async () => {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await closed;
    },
  };
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function withArtifactFixture(prefix, action) {
  resetLifecycleState();
  const fixture = await makeTempServicesRoot(prefix);
  const archiveBytes = artifactZip();
  const release = await startArtifactServer(archiveBytes);
  const serviceRoot = path.join(fixture.servicesRoot, "artifact-service");
  await mkdir(serviceRoot, { recursive: true });
  await writeFile(path.join(serviceRoot, "service.json"), JSON.stringify({
    id: "artifact-service",
    name: "Artifact Service",
    description: "Fixture for transaction-owned startup artifact acquisition.",
    artifact: {
      kind: "archive",
      source: { type: "github-release", repo: "service-lasso/fixture", channel: "latest" },
      platforms: {
        default: {
          assetName: "artifact.zip",
          assetUrl: release.url,
          archiveType: "zip",
          sha256: createHash("sha256").update(archiveBytes).digest("hex"),
          command: process.execPath,
          args: ["runtime/service.mjs"],
        },
      },
    },
    healthcheck: { type: "process" },
  }, null, 2));
  const [service] = await discoverServices(fixture.servicesRoot);
  const transaction = {
    journal: await beginStartupTransaction({
      generationId: "123e4567-e89b-42d3-a456-426614174099",
      instanceId: resolveRuntimeInstanceId({
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
        version: "test",
      }),
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
    }),
  };
  try {
    await action({ ...fixture, service, serviceRoot, transaction, release });
  } finally {
    await discardStartupMaterializationSidecar(transaction.journal).catch(() => undefined);
    await release.close();
    resetLifecycleState();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
}

async function acquireFixtureArtifact(fixture, hooks = createStartupArtifactAcquisitionHooks({
  transaction: fixture.transaction,
  service: fixture.service,
})) {
  const result = await installService(fixture.service, createServiceRegistry([fixture.service]), {
    artifactAcquisitionHooks: hooks,
  });
  await writeServiceState(fixture.service, result.state);
  return result.state.installArtifacts.artifact;
}

test("AC-4BJ.2 artifact rollback preserves cache and pre-existing extraction while restoring lifecycle state", async () => {
  await withArtifactFixture("service-lasso-startup-artifact-rollback-", async (fixture) => {
    const preExisting = path.join(fixture.serviceRoot, ".state", "extracted", "current", "user.txt");
    await mkdir(path.dirname(preExisting), { recursive: true });
    await writeFile(preExisting, "pre-existing extraction\n", "utf8");
    const artifact = await acquireFixtureArtifact(fixture);
    const cachePath = artifact.archivePath;
    const extractionPath = artifact.extractedPath;
    assert.notEqual(extractionPath, path.dirname(preExisting));
    assert.equal(await exists(cachePath), true);
    assert.equal(await exists(path.join(extractionPath, "runtime", "service.mjs")), true);

    const rolledBack = await rollbackStartupArtifactAcquisitions({
      journal: fixture.transaction.journal,
      discovered: [fixture.service],
    });
    fixture.transaction.journal = rolledBack.journal;
    assert.deepEqual(rolledBack.blockedActionIds, []);
    assert.equal(getLifecycleState(fixture.service.manifest.id).installed, false);
    assert.equal(getLifecycleState(fixture.service.manifest.id).installArtifacts.artifact.extractedPath, null);
    assert.equal(await exists(extractionPath), false);
    assert.equal(await readFile(preExisting, "utf8"), "pre-existing extraction\n");
    assert.equal(await exists(cachePath), true);

    const repeated = await rollbackStartupArtifactAcquisitions({
      journal: fixture.transaction.journal,
      discovered: [fixture.service],
    });
    assert.deepEqual(repeated.completedActionIds, []);
    assert.equal(fixture.release.downloads(), 1);
  });
});

test("AC-4BJ.4 crash after extraction publication rolls back deterministically after rehydrate", async () => {
  await withArtifactFixture("service-lasso-startup-artifact-crash-", async (fixture) => {
    const baseHooks = createStartupArtifactAcquisitionHooks({ transaction: fixture.transaction, service: fixture.service });
    const crashHooks = {
      ...baseHooks,
      afterExtractionPublish: async (actionId) => {
        await baseHooks.afterExtractionPublish(actionId);
        throw new Error("simulated hard crash after extraction publication");
      },
    };
    await assert.rejects(
      installService(fixture.service, createServiceRegistry([fixture.service]), { artifactAcquisitionHooks: crashHooks }),
      /simulated hard crash/,
    );
    const inspection = await inspectStartupMaterializations(fixture.transaction.journal);
    assert.equal(inspection.status, "rollback");
    assert.equal(inspection.reason, "artifact_acquisition_incomplete");

    resetLifecycleState();
    await rehydrateDiscoveredServices([fixture.service]);
    const recovered = await rollbackStartupArtifactAcquisitions({
      journal: fixture.transaction.journal,
      discovered: [fixture.service],
    });
    fixture.transaction.journal = recovered.journal;
    assert.deepEqual(recovered.blockedActionIds, []);
    assert.equal(recovered.completedActionIds.length, 1);
    assert.equal(getLifecycleState(fixture.service.manifest.id).installed, false);
  });
});

test("AC-4BJ.4 crash before archive publication removes only the transaction download temp", async () => {
  await withArtifactFixture("service-lasso-startup-artifact-download-crash-", async (fixture) => {
    const baseHooks = createStartupArtifactAcquisitionHooks({ transaction: fixture.transaction, service: fixture.service });
    let plan;
    const crashHooks = {
      ...baseHooks,
      prepare: async (input) => {
        plan = await baseHooks.prepare(input);
        return plan;
      },
      recordArchive: async () => {
        throw new Error("simulated hard crash before archive publication");
      },
    };
    await assert.rejects(
      installService(fixture.service, createServiceRegistry([fixture.service]), { artifactAcquisitionHooks: crashHooks }),
      /simulated hard crash/,
    );
    assert.equal(await exists(plan.archiveTempPath), true);
    const inspection = await inspectStartupMaterializations(fixture.transaction.journal);
    assert.equal(inspection.status, "rollback");
    assert.equal(inspection.reason, "artifact_acquisition_incomplete");
    const rollback = await rollbackStartupArtifactAcquisitions({
      journal: fixture.transaction.journal,
      discovered: [fixture.service],
    });
    fixture.transaction.journal = rollback.journal;
    assert.deepEqual(rollback.blockedActionIds, []);
    assert.equal(await exists(plan.archiveTempPath), false);
    assert.equal(await exists(path.join(fixture.serviceRoot, ".state", "artifacts", "latest", "artifact.zip")), false);
  });
});

test("AC-4BJ.2 user-modified transaction extraction remains untouched and blocks rollback", async () => {
  await withArtifactFixture("service-lasso-startup-artifact-modified-", async (fixture) => {
    const artifact = await acquireFixtureArtifact(fixture);
    const modified = path.join(artifact.extractedPath, "runtime", "service.mjs");
    await writeFile(modified, "user changed this extraction\n", "utf8");
    const rollback = await rollbackStartupArtifactAcquisitions({
      journal: fixture.transaction.journal,
      discovered: [fixture.service],
    });
    fixture.transaction.journal = rollback.journal;
    assert.equal(rollback.blockedActionIds.length, 1);
    assert.equal(await readFile(modified, "utf8"), "user changed this extraction\n");
    assert.equal(getLifecycleState(fixture.service.manifest.id).installed, true);
    assert.equal(fixture.transaction.journal.pendingCompensations.some((action) => action.startsWith("rollback_artifact:")), true);
  });
});

test("AC-4BJ.2 a reusable pre-existing archive is never overwritten or removed", async () => {
  await withArtifactFixture("service-lasso-startup-artifact-cache-", async (fixture) => {
    const first = await acquireFixtureArtifact(fixture);
    const firstBytes = await readFile(first.archivePath);
    let rollback = await rollbackStartupArtifactAcquisitions({
      journal: fixture.transaction.journal,
      discovered: [fixture.service],
    });
    fixture.transaction.journal = rollback.journal;
    assert.equal(await exists(first.archivePath), true);

    const secondHooks = createStartupArtifactAcquisitionHooks({ transaction: fixture.transaction, service: fixture.service });
    const second = await acquireFixtureArtifact(fixture, secondHooks);
    assert.deepEqual(await readFile(second.archivePath), firstBytes);
    assert.equal(fixture.release.downloads(), 1);
    rollback = await rollbackStartupArtifactAcquisitions({ journal: fixture.transaction.journal, discovered: [fixture.service] });
    fixture.transaction.journal = rollback.journal;
    assert.equal(await exists(first.archivePath), true);
  });
});

test("AC-4BJ.2 every cache reuse revalidates the declared checksum and preserves a changed cache", async () => {
  await withArtifactFixture("service-lasso-startup-artifact-cache-checksum-", async (fixture) => {
    const first = await acquireFixtureArtifact(fixture);
    let rollback = await rollbackStartupArtifactAcquisitions({
      journal: fixture.transaction.journal,
      discovered: [fixture.service],
    });
    fixture.transaction.journal = rollback.journal;
    await writeFile(first.archivePath, "externally changed shared cache\n", "utf8");

    const hooks = createStartupArtifactAcquisitionHooks({ transaction: fixture.transaction, service: fixture.service });
    await assert.rejects(
      installService(fixture.service, createServiceRegistry([fixture.service]), { artifactAcquisitionHooks: hooks }),
      /checksum did not match expected SHA-256/,
    );
    assert.equal(await readFile(first.archivePath, "utf8"), "externally changed shared cache\n");
    assert.equal(fixture.release.downloads(), 1);
    rollback = await rollbackStartupArtifactAcquisitions({
      journal: fixture.transaction.journal,
      discovered: [fixture.service],
    });
    fixture.transaction.journal = rollback.journal;
    assert.deepEqual(rollback.blockedActionIds, []);
  });
});

test("AC-4BJ.3 commit cleanup selects the retained extraction from persisted lifecycle state", async () => {
  await withArtifactFixture("service-lasso-startup-artifact-commit-persisted-", async (fixture) => {
    const prior = structuredClone(getLifecycleState(fixture.service.manifest.id));
    const artifact = await acquireFixtureArtifact(fixture);
    setLifecycleState(fixture.service.manifest.id, prior);
    fixture.transaction.journal = await advanceStartupTransaction(
      fixture.transaction.journal,
      "generation_committed",
      { completedActions: ["generation_committed"] },
    );
    fixture.transaction.journal = await completeCommittedStartupMaterializationCleanup(fixture.transaction.journal);
    assert.equal(await exists(artifact.extractedPath), true);
    assert.equal(fixture.transaction.journal.pendingCompensations.some((action) => action.startsWith("rollback_artifact:")), false);
  });
});

test("AC-4BJ.3 journal evidence alone cannot retain an extraction absent from persisted lifecycle state", async () => {
  await withArtifactFixture("service-lasso-startup-artifact-commit-unpersisted-", async (fixture) => {
    const prior = structuredClone(getLifecycleState(fixture.service.manifest.id));
    const artifact = await acquireFixtureArtifact(fixture);
    await writeServiceState(fixture.service, prior);
    fixture.transaction.journal = await advanceStartupTransaction(
      fixture.transaction.journal,
      "generation_committed",
      { completedActions: ["generation_committed"] },
    );
    fixture.transaction.journal = await completeCommittedStartupMaterializationCleanup(fixture.transaction.journal);
    assert.equal(await exists(artifact.extractedPath), false);
    assert.equal(getLifecycleState(fixture.service.manifest.id).installArtifacts.artifact.extractedPath, artifact.extractedPath);
  });
});

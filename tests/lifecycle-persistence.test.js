import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { buildRuntimeDoctorStatus } from "../dist/runtime/doctor/status.js";
import { ensureRuntimeConfig, resolveRuntimeConfig } from "../dist/runtime/config.js";
import { DependencyGraph, createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import {
  PROCESS_OWNERSHIP_SCHEMA_V2,
  PROCESS_OWNERSHIP_POLICY,
  inspectLifecycleDocument,
  isLifecycleStateError,
} from "../dist/runtime/state/lifecycle-persistence.js";
import {
  getProcessRegistryPath,
  readProcessOwnershipRegistry,
  recordProcessOwnership,
  resolveWorkspaceProcessId,
} from "../dist/runtime/process/registry.js";
import {
  beginStartupTransaction,
  getStartupTransactionJournalPath,
  readStartupTransactionJournal,
} from "../dist/runtime/startup/transaction.js";
import { makeTempServicesRoot } from "./test-helpers.js";

/**
 * AC-4BL proofs for hardened process/generation/allocation/startup-transaction
 * persistence. Service lifecycle v1 schema identifiers are not rewritten here.
 */
async function writeLegacyProcessRegistry(workspaceRoot, entries) {
  const registryPath = getProcessRegistryPath(workspaceRoot);
  await mkdir(path.dirname(registryPath), { recursive: true });
  await writeFile(
    registryPath,
    `${JSON.stringify({
      version: 1,
      updatedAt: "2026-08-31T00:00:00.000Z",
      entries,
    }, null, 2)}\n`,
    "utf8",
  );
  return registryPath;
}

test("AC-4BL v1 process registry migrates atomically to v2 with a bounded pre-migration backup", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-880-migrate-");
  try {
    const workspaceId = resolveWorkspaceProcessId(workspaceRoot);
    await writeLegacyProcessRegistry(workspaceRoot, []);
    await recordProcessOwnership(workspaceRoot, {
      ownerType: "runtime",
      ownerId: "runtime-migrate",
      pid: process.pid,
      ownerRoot: tempRoot,
      lifecycleState: "running",
      source: "runtime",
    });

    const registryPath = getProcessRegistryPath(workspaceRoot);
    const stored = JSON.parse(await readFile(registryPath, "utf8"));
    assert.equal(stored.schemaVersion, PROCESS_OWNERSHIP_SCHEMA_V2);
    assert.equal(stored.version, 2);
    assert.equal(stored.workspaceId, workspaceId);
    assert.equal(path.resolve(stored.canonicalWorkspaceRoot), path.resolve(workspaceRoot));
    assert.equal(stored.entries.length, 1);

    const backup = JSON.parse(await readFile(`${registryPath}.v1.bak`, "utf8"));
    assert.equal(backup.version, 1);
    assert.equal(Array.isArray(backup.entries), true);
    await assert.rejects(readFile(`${registryPath}.migrate.json`, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("AC-4BL corrupt primary recovers from a verified backup without using the malformed bytes", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-880-backup-");
  try {
    await recordProcessOwnership(workspaceRoot, {
      ownerType: "runtime",
      ownerId: "runtime-backup",
      pid: process.pid,
      ownerRoot: tempRoot,
      lifecycleState: "running",
      source: "runtime",
    });
    const registryPath = getProcessRegistryPath(workspaceRoot);
    await copyFile(registryPath, `${registryPath}.bak`);
    await writeFile(registryPath, "{corrupt-primary", "utf8");
    const recovered = await readProcessOwnershipRegistry(workspaceRoot);
    assert.equal(recovered.schemaVersion, PROCESS_OWNERSHIP_SCHEMA_V2);
    assert.equal(recovered.entries.length, 1);
    assert.equal(recovered.entries[0].ownerId, "runtime-backup");
    assert.equal(recovered.entries[0].identityStatus, "owned");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("AC-4BL unsupported newer process registry is preserved and blocks mutation", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-880-future-");
  try {
    const registryPath = getProcessRegistryPath(workspaceRoot);
    await mkdir(path.dirname(registryPath), { recursive: true });
    const futureDocument = {
      schemaVersion: "service-lasso.process-ownership.v999",
      version: 999,
      workspaceId: resolveWorkspaceProcessId(workspaceRoot),
      canonicalWorkspaceRoot: path.resolve(workspaceRoot),
      updatedAt: "2026-08-31T00:00:00.000Z",
      entries: [{ ownerId: "must-not-authorise-termination", pid: 1 }],
    };
    await writeFile(registryPath, `${JSON.stringify(futureDocument, null, 2)}\n`, "utf8");

    await assert.rejects(
      () => readProcessOwnershipRegistry(workspaceRoot),
      (error) => {
        assert.equal(isLifecycleStateError(error), true);
        assert.equal(error.code, "unsupported-new");
        assert.equal(error.kind, "process-ownership");
        assert.equal(error.message.includes("password"), false);
        assert.equal(error.message.includes(process.execPath), false);
        return true;
      },
    );

    await assert.rejects(
      () => recordProcessOwnership(workspaceRoot, {
        ownerType: "runtime",
        ownerId: "must-not-write",
        pid: process.pid,
        ownerRoot: tempRoot,
        lifecycleState: "running",
        source: "runtime",
      }),
      (error) => isLifecycleStateError(error) && error.code === "unsupported-new",
    );

    const preserved = JSON.parse(await readFile(registryPath, "utf8"));
    assert.equal(preserved.schemaVersion, "service-lasso.process-ownership.v999");
    assert.equal(preserved.version, 999);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("AC-4BL redirected registry and lock files are refused", async (t) => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-880-link-");
  try {
    const outsideDirectory = path.join(tempRoot, "outside-state");
    await mkdir(outsideDirectory, { recursive: true });
    const stateDirectory = path.join(workspaceRoot, ".service-lasso");
    try {
      await symlink(outsideDirectory, stateDirectory, process.platform === "win32" ? "junction" : "dir");
    } catch {
      t.skip("Host does not permit creating a directory symlink fixture.");
      return;
    }

    await assert.rejects(
      () => recordProcessOwnership(workspaceRoot, {
        ownerType: "runtime",
        ownerId: "must-not-follow-link",
        pid: process.pid,
        ownerRoot: tempRoot,
        lifecycleState: "running",
        source: "runtime",
      }),
      (error) => isLifecycleStateError(error) && error.code === "redirected",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("AC-4BL oversized and structurally abusive process registries fail closed", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-880-bound-");
  try {
    const registryPath = getProcessRegistryPath(workspaceRoot);
    await mkdir(path.dirname(registryPath), { recursive: true });
    await writeFile(registryPath, `${"a".repeat(300 * 1024)}\n`, "utf8");
    await assert.rejects(
      () => readProcessOwnershipRegistry(workspaceRoot),
      (error) => isLifecycleStateError(error) && (error.code === "oversized" || error.code === "corrupt"),
    );

    await writeFile(
      registryPath,
      `${JSON.stringify({
        version: 1,
        updatedAt: "2026-08-31T00:00:00.000Z",
        entries: Array.from({ length: 300 }, (_entry, index) => ({ ownerId: `entry-${index}` })),
      })}\n`,
      "utf8",
    );
    await assert.rejects(
      () => readProcessOwnershipRegistry(workspaceRoot),
      (error) => isLifecycleStateError(error) && (error.code === "oversized" || error.code === "corrupt"),
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("AC-4BL interrupted v1 to v2 migration recovers deterministically", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-880-interrupt-");
  try {
    const workspaceId = resolveWorkspaceProcessId(workspaceRoot);
    const registryPath = await writeLegacyProcessRegistry(workspaceRoot, []);
    await writeFile(`${registryPath}.v1.bak`, await readFile(registryPath), "utf8");
    await writeFile(
      `${registryPath}.migrate.json`,
      `${JSON.stringify({
        schemaVersion: "service-lasso.lifecycle-migration.v1",
        kind: "process-ownership",
        fromVersion: 1,
        toVersion: 2,
        phase: "backup_written",
        startedAt: "2026-08-31T00:00:00.000Z",
        backupFileName: "processes.json.v1.bak",
        candidateFileName: "processes.json.migrate.tmp",
      }, null, 2)}\n`,
      "utf8",
    );

    const recovered = await readProcessOwnershipRegistry(workspaceRoot);
    assert.equal(recovered.schemaVersion, PROCESS_OWNERSHIP_SCHEMA_V2);
    assert.equal(recovered.workspaceId, workspaceId);
    const stored = JSON.parse(await readFile(registryPath, "utf8"));
    assert.equal(stored.schemaVersion, PROCESS_OWNERSHIP_SCHEMA_V2);
    await assert.rejects(readFile(`${registryPath}.migrate.json`, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("AC-4BL startup transaction and doctor expose classifications and safe paths only", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-880-doctor-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  try {
    await beginStartupTransaction({
      generationId: "123e4567-e89b-42d3-a456-426614174000",
      instanceId: "sl_test",
      servicesRoot,
      workspaceRoot,
    });
    const journal = await readStartupTransactionJournal(workspaceRoot);
    assert.equal(journal.schemaVersion, "service-lasso.startup-transaction.v2");
    assert.equal(journal.version, 2);
    const rawJournal = await readFile(getStartupTransactionJournalPath(workspaceRoot), "utf8");
    assert.doesNotMatch(rawJournal, /password|credential|secret|CommandLine/i);

    const inspection = await inspectLifecycleDocument(workspaceRoot, PROCESS_OWNERSHIP_POLICY);
    assert.equal(["missing", "current", "legacy"].includes(inspection.classification), true);
    assert.equal(inspection.safePath.includes("processes.json"), true);

    const discovered = await discoverServices(servicesRoot);
    const registry = createServiceRegistry(discovered);
    const graph = new DependencyGraph(registry);
    const config = await ensureRuntimeConfig(resolveRuntimeConfig({
      servicesRoot,
      workspaceRoot,
      version: "0.0.0-test",
    }));
    const doctor = await buildRuntimeDoctorStatus({ config, registry, graph });
    assert.equal(Array.isArray(doctor.doctor.persistence), true);
    assert.equal(doctor.doctor.persistence.some((entry) => entry.kind === "startup-transaction"), true);
    const serialized = JSON.stringify(doctor);
    assert.doesNotMatch(serialized, /password|credential|secret-value/i);
    assert.equal(serialized.includes(process.execPath), false);
    for (const entry of doctor.doctor.persistence) {
      assert.equal(path.isAbsolute(entry.safePath), true);
      assert.equal(entry.safePath.includes(".."), false);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

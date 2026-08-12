import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { configService, installService } from "../dist/runtime/lifecycle/actions.js";
import { beginRuntimeGeneration, publishRuntimeGeneration, resolveRuntimeInstanceId } from "../dist/runtime/instance/registry.js";
import { getLifecycleState, resetLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { materializeConfigArtifacts } from "../dist/runtime/setup/materialize.js";
import { runServiceSetup } from "../dist/runtime/setup/steps.js";
import { writeServiceState } from "../dist/runtime/state/writeState.js";
import { recordProcessOwnership, transitionProcessOwnership } from "../dist/runtime/process/registry.js";
import {
  completeCommittedStartupMaterializationCleanup,
  createStartupMaterializationHooks,
  createStartupSetupTransactionHooks,
  discardStartupMaterializationSidecar,
  inspectStartupMaterializations,
  reconcileStartupMaterializationLifecycleState,
  rollbackStartupMaterializations,
} from "../dist/runtime/startup/materialization.js";
import { inspectStartupRecovery } from "../dist/runtime/startup/recovery.js";
import {
  advanceStartupTransaction,
  beginStartupTransaction,
  getStartupTransactionJournalPath,
  settleStartupTransaction,
} from "../dist/runtime/startup/transaction.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";
import { readStoredState } from "../dist/runtime/state/readState.js";
import { rehydrateDiscoveredServices } from "../dist/runtime/state/rehydrate.js";

const execFileAsync = promisify(execFile);

async function withMaterializationFixture(prefix, action) {
  const fixture = await makeTempServicesRoot(prefix);
  let transaction;
  const previous = {
    hostRegistry: process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH,
    instanceRegistry: process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH,
    testHooks: process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS,
  };
  process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = path.join(fixture.tempRoot, "host", "allocations.json");
  process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = path.join(fixture.tempRoot, "host", "instances.json");
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  try {
    const written = await writeExecutableFixtureService(fixture.servicesRoot, "materialized-service", {
      config: {
        files: [{ path: "runtime/generated.conf", content: "transaction-secret-output\n" }],
      },
    });
    const [service] = await discoverServices(fixture.servicesRoot);
    const journal = await beginStartupTransaction({
      generationId: "123e4567-e89b-42d3-a456-426614174091",
      instanceId: resolveRuntimeInstanceId({
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
        version: "test",
      }),
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
    });
    transaction = { journal };
    await action({ ...fixture, service, serviceRoot: written.serviceRoot, transaction });
  } finally {
    if (transaction) await discardStartupMaterializationSidecar(transaction.journal).catch(() => undefined);
    if (previous.hostRegistry === undefined) delete process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH;
    else process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = previous.hostRegistry;
    if (previous.instanceRegistry === undefined) delete process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
    else process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = previous.instanceRegistry;
    if (previous.testHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = previous.testHooks;
    resetLifecycleState();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
}

test("AC-4BJ.2 transaction-created generated files are removed by digest-guarded rollback", async () => {
  await withMaterializationFixture("service-lasso-materialization-created-", async (fixture) => {
    const target = path.join(fixture.serviceRoot, "runtime", "generated.conf");
    const hooks = createStartupMaterializationHooks({
      transaction: fixture.transaction,
      service: fixture.service,
      kind: "config",
    });
    await materializeConfigArtifacts(fixture.service, {}, {}, {}, hooks);
    assert.equal(await readFile(target, "utf8"), "transaction-secret-output\n");

    const rawJournal = await readFile(getStartupTransactionJournalPath(fixture.workspaceRoot), "utf8");
    assert.doesNotMatch(rawJournal, /generated\.conf|transaction-secret-output/);
    assert.match(rawJournal, /restore_materialization:[a-f0-9]{24}/);
    assert.match(rawJournal, /discard_materialization_sidecar/);
    const sidecar = path.join(
      fixture.workspaceRoot,
      ".service-lasso",
      "startup-transactions",
      fixture.transaction.journal.transactionId,
      "materialization-preimages.json",
    );
    const orphanSidecarTemp = `${sidecar}.${process.pid}.123e4567-e89b-42d3-a456-426614174099.tmp`;
    await writeFile(orphanSidecarTemp, "orphaned-private-preimage\n", "utf8");
    if (process.platform === "win32") {
      const protectedSidecar = await readFile(sidecar, "utf8");
      assert.match(protectedSidecar, /windows-dpapi-aes-256-gcm/);
      assert.doesNotMatch(protectedSidecar, /transaction-secret-output/);
    }
    const inspection = await inspectStartupMaterializations(fixture.transaction.journal);
    assert.equal(inspection.status, "agree");
    await assert.rejects(readFile(orphanSidecarTemp), (error) => error.code === "ENOENT");

    const rollback = await rollbackStartupMaterializations(fixture.transaction.journal);
    assert.equal(rollback.blockedActionIds.length, 0);
    assert.equal(rollback.completedActionIds.length, 1);
    await assert.rejects(readFile(target), (error) => error.code === "ENOENT");
    const repeated = await rollbackStartupMaterializations(fixture.transaction.journal);
    assert.deepEqual(repeated.blockedActionIds, []);
    assert.equal(repeated.completedActionIds.length, 1);
  });
});

test("AC-4BJ.2 overwritten generated files restore the bounded preimage", async () => {
  await withMaterializationFixture("service-lasso-materialization-restore-", async (fixture) => {
    const target = path.join(fixture.serviceRoot, "runtime", "generated.conf");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "pre-existing-user-value\n", "utf8");
    const hooks = createStartupMaterializationHooks({
      transaction: fixture.transaction,
      service: fixture.service,
      kind: "config",
    });
    await materializeConfigArtifacts(fixture.service, {}, {}, {}, hooks);

    if (process.platform === "win32") {
      const sidecarPath = path.join(
        fixture.workspaceRoot,
        ".service-lasso",
        "startup-transactions",
        fixture.transaction.journal.transactionId,
        "materialization-preimages.json",
      );
      assert.doesNotMatch(await readFile(sidecarPath, "utf8"), /pre-existing-user-value/);
      const materializationUrl = pathToFileURL(path.resolve("dist/runtime/startup/materialization.js")).href;
      const transactionUrl = pathToFileURL(path.resolve("dist/runtime/startup/transaction.js")).href;
      const script = [
        `import { inspectStartupMaterializations } from ${JSON.stringify(materializationUrl)};`,
        `import { readStartupTransactionJournal } from ${JSON.stringify(transactionUrl)};`,
        `const journal = await readStartupTransactionJournal(${JSON.stringify(fixture.workspaceRoot)});`,
        "const inspection = await inspectStartupMaterializations(journal);",
        "process.stdout.write(inspection.status);",
      ].join("\n");
      const crossProcess = await execFileAsync(process.execPath, ["--input-type=module", "--eval", script], {
        windowsHide: true,
        maxBuffer: 16 * 1024,
      });
      assert.equal(crossProcess.stdout, "agree");
    }

    const orphanTemp = `${target}.${process.pid}.123e4567-e89b-42d3-a456-426614174099.restore.tmp`;
    await writeFile(orphanTemp, "orphaned-private-preimage\n", "utf8");

    const rollback = await rollbackStartupMaterializations(fixture.transaction.journal);
    assert.deepEqual(rollback.blockedActionIds, []);
    assert.equal(await readFile(target, "utf8"), "pre-existing-user-value\n");
    await assert.rejects(readFile(orphanTemp), (error) => error.code === "ENOENT");
  });
});

test("AC-4BJ.2 config-file rollback reconciles persisted and in-memory state idempotently", async () => {
  await withMaterializationFixture("service-lasso-materialization-state-incoherent-", async (fixture) => {
    const registry = createServiceRegistry([fixture.service]);
    await writeServiceState(fixture.service, (await installService(fixture.service, registry)).state);
    const hooks = createStartupMaterializationHooks({
      transaction: fixture.transaction,
      service: fixture.service,
      kind: "config",
    });
    await writeServiceState(fixture.service, (await configService(fixture.service, registry, {
      materializationHooks: hooks,
    })).state);
    const target = path.join(fixture.serviceRoot, "runtime", "generated.conf");
    assert.equal(getLifecycleState(fixture.service.manifest.id).configured, true);
    assert.equal(await readFile(target, "utf8"), "transaction-secret-output\n");

    const rollback = await rollbackStartupMaterializations(fixture.transaction.journal);
    assert.deepEqual(rollback.blockedActionIds, []);
    assert.equal(rollback.stateReconciliationRequiredActionIds.length, 1);
    for (const actionId of rollback.completedActionIds) {
      fixture.transaction.journal = await advanceStartupTransaction(
        fixture.transaction.journal,
        fixture.transaction.journal.phase,
        {
          completedActions: [`materialization_restored:${actionId}`],
          removeCompensations: [`restore_materialization:${actionId}`],
          addCompensations: rollback.stateReconciliationRequiredActionIds.includes(actionId)
            ? [`reconcile_materialization_state:${actionId}`]
            : [],
        },
      );
    }
    await assert.rejects(readFile(target), (error) => error.code === "ENOENT");
    assert.equal(getLifecycleState(fixture.service.manifest.id).configured, true);

    let injected = false;
    let reconciliation = await reconcileStartupMaterializationLifecycleState({
      journal: fixture.transaction.journal,
      discovered: [fixture.service],
      testHooks: {
        afterPersist: async () => {
          if (!injected) {
            injected = true;
            throw new Error("simulated crash after persisted state before journal completion");
          }
        },
      },
    });
    assert.equal(reconciliation.blockedActionIds.length, 1);
    fixture.transaction.journal = reconciliation.journal;
    assert.equal(fixture.transaction.journal.pendingCompensations.some((action) =>
      action.startsWith("reconcile_materialization_state:")), true);
    assert.equal((await readStoredState(fixture.serviceRoot)).config.configured, false);
    const interrupted = await inspectStartupMaterializations(fixture.transaction.journal);
    assert.equal(interrupted.status, "rollback");
    assert.equal(interrupted.reason, "materialization_state_reconciliation_pending");

    reconciliation = await reconcileStartupMaterializationLifecycleState({
      journal: fixture.transaction.journal,
      discovered: [fixture.service],
    });
    fixture.transaction.journal = reconciliation.journal;
    assert.deepEqual(reconciliation.blockedActionIds, []);
    assert.equal(getLifecycleState(fixture.service.manifest.id).configured, false);
    assert.equal(getLifecycleState(fixture.service.manifest.id).installed, true);
    assert.deepEqual(getLifecycleState(fixture.service.manifest.id).configArtifacts.files, []);
    assert.equal(fixture.transaction.journal.pendingCompensations.some((action) =>
      action.startsWith("reconcile_materialization_state:")), false);
  });
});

test("AC-4BJ.4 reconciled config state survives cross-process rehydrate and requires rematerialization", async () => {
  await withMaterializationFixture("service-lasso-materialization-state-cross-process-", async (fixture) => {
    const registry = createServiceRegistry([fixture.service]);
    await writeServiceState(fixture.service, (await installService(fixture.service, registry)).state);
    const hooks = createStartupMaterializationHooks({ transaction: fixture.transaction, service: fixture.service, kind: "config" });
    await writeServiceState(fixture.service, (await configService(fixture.service, registry, { materializationHooks: hooks })).state);
    const rollback = await rollbackStartupMaterializations(fixture.transaction.journal);
    for (const actionId of rollback.completedActionIds) {
      fixture.transaction.journal = await advanceStartupTransaction(fixture.transaction.journal, fixture.transaction.journal.phase, {
        completedActions: [`materialization_restored:${actionId}`],
        removeCompensations: [`restore_materialization:${actionId}`],
        addCompensations: rollback.stateReconciliationRequiredActionIds.includes(actionId)
          ? [`reconcile_materialization_state:${actionId}`]
          : [],
      });
    }
    const reconciled = await reconcileStartupMaterializationLifecycleState({
      journal: fixture.transaction.journal,
      discovered: [fixture.service],
    });
    fixture.transaction.journal = reconciled.journal;

    const discoveryUrl = pathToFileURL(path.resolve("dist/runtime/discovery/discoverServices.js")).href;
    const rehydrateUrl = pathToFileURL(path.resolve("dist/runtime/state/rehydrate.js")).href;
    const storeUrl = pathToFileURL(path.resolve("dist/runtime/lifecycle/store.js")).href;
    const script = [
      `import { discoverServices } from ${JSON.stringify(discoveryUrl)};`,
      `import { rehydrateDiscoveredServices } from ${JSON.stringify(rehydrateUrl)};`,
      `import { getLifecycleState } from ${JSON.stringify(storeUrl)};`,
      `const services = await discoverServices(${JSON.stringify(fixture.servicesRoot)});`,
      "await rehydrateDiscoveredServices(services);",
      `const state = getLifecycleState(${JSON.stringify(fixture.service.manifest.id)});`,
      "process.stdout.write(JSON.stringify({ installed: state.installed, configured: state.configured }));",
    ].join("\n");
    const child = await execFileAsync(process.execPath, ["--input-type=module", "--eval", script], {
      windowsHide: true,
      maxBuffer: 16 * 1024,
    });
    assert.deepEqual(JSON.parse(child.stdout), { installed: true, configured: false });

    resetLifecycleState();
    await rehydrateDiscoveredServices([fixture.service]);
    const target = path.join(fixture.serviceRoot, "runtime", "generated.conf");
    await assert.rejects(readFile(target), (error) => error.code === "ENOENT");
    await writeServiceState(fixture.service, (await configService(fixture.service, registry)).state);
    assert.equal(await readFile(target, "utf8"), "transaction-secret-output\n");
  });
});

test("AC-4BJ.2 install-file rollback preserves artifact metadata while invalidating prerequisites", async () => {
  await withMaterializationFixture("service-lasso-materialization-install-state-", async (fixture) => {
    fixture.service.manifest.install = {
      files: [{ path: "runtime/installed.marker", content: "installed-output\n" }],
    };
    const artifact = {
      sourceType: null,
      repo: null,
      channel: null,
      tag: "fixture-artifact",
      assetName: null,
      assetUrl: null,
      archiveType: null,
      archivePath: "C:/artifact/archive.zip",
      extractedPath: "C:/artifact/extracted",
      command: process.execPath,
      args: [],
      checksum: null,
    };
    setLifecycleState(fixture.service.manifest.id, {
      ...getLifecycleState(fixture.service.manifest.id),
      installed: true,
      configured: true,
      installArtifacts: { files: [], updatedAt: null, artifact },
    });
    const hooks = createStartupMaterializationHooks({
      transaction: fixture.transaction,
      service: fixture.service,
      kind: "install",
    });
    const install = await installService(fixture.service, undefined, { materializationHooks: hooks });
    await writeServiceState(fixture.service, {
      ...install.state,
      configured: true,
      installArtifacts: { ...install.state.installArtifacts, artifact },
    });
    setLifecycleState(fixture.service.manifest.id, {
      ...getLifecycleState(fixture.service.manifest.id),
      configured: true,
      installArtifacts: { ...getLifecycleState(fixture.service.manifest.id).installArtifacts, artifact },
    });

    const rollback = await rollbackStartupMaterializations(fixture.transaction.journal);
    for (const actionId of rollback.completedActionIds) {
      fixture.transaction.journal = await advanceStartupTransaction(fixture.transaction.journal, fixture.transaction.journal.phase, {
        completedActions: [`materialization_restored:${actionId}`],
        removeCompensations: [`restore_materialization:${actionId}`],
        addCompensations: rollback.stateReconciliationRequiredActionIds.includes(actionId)
          ? [`reconcile_materialization_state:${actionId}`]
          : [],
      });
    }
    const reconciliation = await reconcileStartupMaterializationLifecycleState({
      journal: fixture.transaction.journal,
      discovered: [fixture.service],
    });
    fixture.transaction.journal = reconciliation.journal;
    const state = getLifecycleState(fixture.service.manifest.id);
    assert.equal(state.installed, false);
    assert.equal(state.configured, true);
    assert.deepEqual(state.installArtifacts.files, []);
    assert.equal(state.installArtifacts.artifact.tag, "fixture-artifact");
    assert.equal(state.installArtifacts.artifact.extractedPath, "C:/artifact/extracted");
    assert.equal((await readStoredState(fixture.serviceRoot)).install.artifact.tag, "fixture-artifact");
  });
});

test("AC-4BJ.2 repeated writes to one target roll back in order and remain idempotent", async () => {
  await withMaterializationFixture("service-lasso-materialization-repeat-", async (fixture) => {
    const target = path.join(fixture.serviceRoot, "runtime", "generated.conf");
    let hooks = createStartupMaterializationHooks({
      transaction: fixture.transaction,
      service: fixture.service,
      kind: "config",
    });
    await materializeConfigArtifacts(fixture.service, {}, {}, {}, hooks);
    fixture.service.manifest.config.files[0].content = "second-transaction-output\n";
    hooks = createStartupMaterializationHooks({
      transaction: fixture.transaction,
      service: fixture.service,
      kind: "config",
    });
    await materializeConfigArtifacts(fixture.service, {}, {}, {}, hooks);
    assert.equal(await readFile(target, "utf8"), "second-transaction-output\n");

    const rollback = await rollbackStartupMaterializations(fixture.transaction.journal);
    assert.deepEqual(rollback.blockedActionIds, []);
    assert.equal(rollback.completedActionIds.length, 2);
    await assert.rejects(readFile(target), (error) => error.code === "ENOENT");
    const repeated = await rollbackStartupMaterializations(fixture.transaction.journal);
    assert.deepEqual(repeated.blockedActionIds, []);
    assert.equal(repeated.completedActionIds.length, 2);
  });
});

test("AC-4BJ.2 user-modified generated files remain untouched and block rollback", async () => {
  await withMaterializationFixture("service-lasso-materialization-modified-", async (fixture) => {
    setLifecycleState(fixture.service.manifest.id, {
      ...getLifecycleState(fixture.service.manifest.id),
      installed: true,
      configured: true,
    });
    await writeServiceState(fixture.service, getLifecycleState(fixture.service.manifest.id));
    const target = path.join(fixture.serviceRoot, "runtime", "generated.conf");
    const hooks = createStartupMaterializationHooks({
      transaction: fixture.transaction,
      service: fixture.service,
      kind: "config",
    });
    await materializeConfigArtifacts(fixture.service, {}, {}, {}, hooks);
    await writeFile(target, "user-modified-after-startup\n", "utf8");

    const inspection = await inspectStartupMaterializations(fixture.transaction.journal);
    assert.equal(inspection.status, "blocked");
    assert.equal(inspection.reason, "materialization_output_changed");

    const rollback = await rollbackStartupMaterializations(fixture.transaction.journal);
    assert.equal(rollback.completedActionIds.length, 0);
    assert.equal(rollback.blockedActionIds.length, 1);
    assert.equal(await readFile(target, "utf8"), "user-modified-after-startup\n");
    const reconciliation = await reconcileStartupMaterializationLifecycleState({
      journal: fixture.transaction.journal,
      discovered: [fixture.service],
    });
    assert.deepEqual(reconciliation.reconciledActionIds, []);
    assert.equal(getLifecycleState(fixture.service.manifest.id).configured, true);
    assert.equal((await readStoredState(fixture.serviceRoot)).config.configured, true);
  });
});

test("AC-4BJ.2 corrupted private preimage evidence blocks without touching the generated file", async () => {
  await withMaterializationFixture("service-lasso-materialization-corrupt-sidecar-", async (fixture) => {
    const target = path.join(fixture.serviceRoot, "runtime", "generated.conf");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "pre-existing-user-value\n", "utf8");
    const hooks = createStartupMaterializationHooks({
      transaction: fixture.transaction,
      service: fixture.service,
      kind: "config",
    });
    await materializeConfigArtifacts(fixture.service, {}, {}, {}, hooks);

    const sidecarPath = path.join(
      fixture.workspaceRoot,
      ".service-lasso",
      "startup-transactions",
      fixture.transaction.journal.transactionId,
      "materialization-preimages.json",
    );
    await writeFile(sidecarPath, '{"version":1,"corrupted":true}\n', "utf8");

    const inspection = await inspectStartupMaterializations(fixture.transaction.journal);
    assert.equal(inspection.status, "blocked");
    assert.equal(inspection.reason, "materialization_sidecar_missing_or_invalid");
    const rollback = await rollbackStartupMaterializations(fixture.transaction.journal);
    assert.equal(rollback.completedActionIds.length, 0);
    assert.equal(rollback.blockedActionIds.length, 1);
    assert.equal(await readFile(target, "utf8"), "transaction-secret-output\n");
  });
});

test("AC-4BJ.2 oversized private evidence is rejected from lstat before sidecar read", async () => {
  await withMaterializationFixture("service-lasso-materialization-oversized-sidecar-", async (fixture) => {
    const hooks = createStartupMaterializationHooks({
      transaction: fixture.transaction,
      service: fixture.service,
      kind: "config",
    });
    await materializeConfigArtifacts(fixture.service, {}, {}, {}, hooks);
    const sidecarPath = path.join(
      fixture.workspaceRoot,
      ".service-lasso",
      "startup-transactions",
      fixture.transaction.journal.transactionId,
      "materialization-preimages.json",
    );
    await truncate(sidecarPath, 16 * 1024 * 1024 + 1);

    const inspection = await inspectStartupMaterializations(fixture.transaction.journal);
    assert.equal(inspection.status, "blocked");
    assert.equal(inspection.reason, "materialization_sidecar_missing_or_invalid");
  });
});

test("AC-4BJ.4 automatic startup recovery blocks before mutation when a generated file changed", async () => {
  await withMaterializationFixture("service-lasso-materialization-recovery-block-", async (fixture) => {
    const config = {
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      version: "test",
    };
    await beginRuntimeGeneration(config, { generationId: fixture.transaction.journal.generationId });
    fixture.transaction.journal = await advanceStartupTransaction(
      fixture.transaction.journal,
      fixture.transaction.journal.phase,
      { completedActions: ["generation_started"], addCompensations: ["mark_generation_failed"] },
    );
    const target = path.join(fixture.serviceRoot, "runtime", "generated.conf");
    const hooks = createStartupMaterializationHooks({
      transaction: fixture.transaction,
      service: fixture.service,
      kind: "config",
    });
    await materializeConfigArtifacts(fixture.service, {}, {}, {}, hooks);
    await writeFile(target, "changed-outside-the-transaction\n", "utf8");

    const recovery = await inspectStartupRecovery(config, [fixture.service]);
    assert.equal(recovery.classification, "blocked");
    assert.equal(recovery.reason, "materialization_output_changed");
    assert.equal(await readFile(target, "utf8"), "changed-outside-the-transaction\n");
  });
});

test("AC-4BJ.2 crash between preimage and postimage remains fail-closed", async () => {
  await withMaterializationFixture("service-lasso-materialization-midwrite-", async (fixture) => {
    const target = path.join(fixture.serviceRoot, "runtime", "generated.conf");
    const hooks = createStartupMaterializationHooks({
      transaction: fixture.transaction,
      service: fixture.service,
      kind: "config",
    });
    await hooks.beforeWrite({ absolutePath: target, relativePath: "runtime/generated.conf" });
    const beforeMutation = await inspectStartupMaterializations(fixture.transaction.journal);
    assert.equal(beforeMutation.status, "rollback");
    assert.equal(beforeMutation.reason, "materialization_write_incomplete");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "write-completed-before-crash\n", "utf8");

    const inspection = await inspectStartupMaterializations(fixture.transaction.journal);
    assert.equal(inspection.status, "blocked");
    assert.equal(inspection.reason, "materialization_postimage_unverifiable");

    const rollback = await rollbackStartupMaterializations(fixture.transaction.journal);
    assert.equal(rollback.completedActionIds.length, 0);
    assert.equal(rollback.blockedActionIds.length, 1);
    assert.equal(await readFile(target, "utf8"), "write-completed-before-crash\n");

    fixture.transaction.journal = await advanceStartupTransaction(
      fixture.transaction.journal,
      fixture.transaction.journal.phase,
      { failureCode: "postimage_missing" },
    );
  });
});

test("AC-4BJ.2 sidecar cleanup intent is durable before bounded preimage capture", async () => {
  await withMaterializationFixture("service-lasso-materialization-preimage-limit-", async (fixture) => {
    const target = path.join(fixture.serviceRoot, "runtime", "generated.conf");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.alloc(1024 * 1024 + 1, 1));
    const hooks = createStartupMaterializationHooks({
      transaction: fixture.transaction,
      service: fixture.service,
      kind: "config",
    });
    await assert.rejects(
      hooks.beforeWrite({ absolutePath: target, relativePath: "runtime/generated.conf" }),
      /bounded regular file|preimage limit/,
    );

    assert.equal(fixture.transaction.journal.pendingCompensations.includes("discard_materialization_sidecar"), true);
    const inspection = await inspectStartupMaterializations(fixture.transaction.journal);
    assert.equal(inspection.status, "rollback");
    assert.equal(inspection.reason, "materialization_cleanup_pending");
    await discardStartupMaterializationSidecar(fixture.transaction.journal);
    assert.equal((await readFile(target)).length, 1024 * 1024 + 1);
  });
});

test("AC-4BJ.3 committed cleanup recovers a crash after sidecar unlink without rolling back output", async () => {
  await withMaterializationFixture("service-lasso-materialization-commit-cleanup-", async (fixture) => {
    const config = {
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      version: "test",
    };
    await beginRuntimeGeneration(config, { generationId: fixture.transaction.journal.generationId });
    const target = path.join(fixture.serviceRoot, "runtime", "generated.conf");
    const hooks = createStartupMaterializationHooks({
      transaction: fixture.transaction,
      service: fixture.service,
      kind: "config",
    });
    await materializeConfigArtifacts(fixture.service, {}, {}, {}, hooks);
    await publishRuntimeGeneration(config, fixture.transaction.journal.generationId, { phase: "running" });
    await recordProcessOwnership(fixture.workspaceRoot, {
      ownerType: "runtime",
      ownerId: fixture.transaction.journal.instanceId,
      generationId: fixture.transaction.journal.generationId,
      runtimeInstanceId: fixture.transaction.journal.instanceId,
      pid: process.pid,
      ownerRoot: fixture.servicesRoot,
      lifecycleState: "running",
      source: "runtime",
    });
    await transitionProcessOwnership(
      fixture.workspaceRoot,
      "runtime",
      fixture.transaction.journal.instanceId,
      "stopped",
      "not_running",
      process.pid,
    );
    fixture.transaction.journal = await advanceStartupTransaction(
      fixture.transaction.journal,
      "generation_committed",
      { completedActions: ["generation_committed"] },
    );

    const restoreCompensations = fixture.transaction.journal.pendingCompensations.filter((compensation) =>
      compensation.startsWith("restore_materialization:"),
    );
    fixture.transaction.journal = await advanceStartupTransaction(
      fixture.transaction.journal,
      fixture.transaction.journal.phase,
      {
        completedActions: ["materialization_commit_cleanup_intended"],
        removeCompensations: restoreCompensations,
      },
    );
    await discardStartupMaterializationSidecar(fixture.transaction.journal);
    // Simulate a hard crash before materialization_sidecar_discarded is journaled.
    const inspection = await inspectStartupRecovery(config, [fixture.service]);
    assert.equal(inspection.classification, "commit_cleanup");
    assert.equal(inspection.reason, "generation_committed_cleanup_only");

    fixture.transaction.journal = await completeCommittedStartupMaterializationCleanup(fixture.transaction.journal);
    fixture.transaction.journal = await settleStartupTransaction(fixture.transaction.journal, "committed", {
      removeCompensations: [...fixture.transaction.journal.pendingCompensations],
    });
    assert.equal(fixture.transaction.journal.status, "committed");
    assert.deepEqual(fixture.transaction.journal.pendingCompensations, []);
    assert.equal(await readFile(target, "utf8"), "transaction-secret-output\n");
  });
});

test("AC-4BJ.2 declared setup outputs use the same bounded restoration contract", async () => {
  await withMaterializationFixture("service-lasso-materialization-setup-", async (fixture) => {
    const target = path.join(fixture.serviceRoot, "data", "generated.pem");
    const hooks = createStartupSetupTransactionHooks(fixture.transaction);
    await hooks.beforeStep(fixture.service, "generate", ["data/generated.pem"]);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "generated-certificate\n", "utf8");
    await hooks.afterStep(fixture.service, "generate", ["data/generated.pem"]);

    const rollback = await rollbackStartupMaterializations(fixture.transaction.journal);
    assert.deepEqual(rollback.blockedActionIds, []);
    await assert.rejects(readFile(target), (error) => error.code === "ENOENT");
  });
});

test("AC-4BJ.2 setup-output rollback invalidates only the affected step and preserves run logs", async () => {
  await withMaterializationFixture("service-lasso-materialization-setup-state-", async (fixture) => {
    const output = "data/generated.pem";
    fixture.service.manifest.setup = {
      steps: {
        generate: { executable: process.execPath, outputs: [output] },
        unaffected: { executable: process.execPath, outputs: ["data/unaffected.pem"] },
      },
    };
    const logPath = path.join(fixture.serviceRoot, "logs", "setup", "generate", "run", "setup.log");
    await mkdir(path.dirname(logPath), { recursive: true });
    await writeFile(logPath, "preserved setup log\n", "utf8");
    const run = {
      runId: "setup-run",
      serviceId: fixture.service.manifest.id,
      stepId: "generate",
      status: "succeeded",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 1,
      command: "fixture",
      exitCode: 0,
      signal: null,
      message: "done",
      logs: { logPath, stdoutPath: `${logPath}.out`, stderrPath: `${logPath}.err` },
    };
    const unaffected = { ...run, runId: "unaffected-run", stepId: "unaffected" };
    setLifecycleState(fixture.service.manifest.id, {
      ...getLifecycleState(fixture.service.manifest.id),
      installed: true,
      configured: true,
      setup: {
        updatedAt: new Date().toISOString(),
        steps: {
          generate: { status: "succeeded", lastRun: run, history: [run] },
          unaffected: { status: "succeeded", lastRun: unaffected, history: [unaffected] },
        },
      },
    });
    await writeServiceState(fixture.service, getLifecycleState(fixture.service.manifest.id));
    const hooks = createStartupSetupTransactionHooks(fixture.transaction);
    await hooks.beforeStep(fixture.service, "generate", [output]);
    await mkdir(path.dirname(path.join(fixture.serviceRoot, output)), { recursive: true });
    await writeFile(path.join(fixture.serviceRoot, output), "generated\n", "utf8");
    await hooks.afterStep(fixture.service, "generate", [output]);

    const rollback = await rollbackStartupMaterializations(fixture.transaction.journal);
    for (const actionId of rollback.completedActionIds) {
      fixture.transaction.journal = await advanceStartupTransaction(fixture.transaction.journal, fixture.transaction.journal.phase, {
        completedActions: [`materialization_restored:${actionId}`],
        removeCompensations: [`restore_materialization:${actionId}`],
        addCompensations: rollback.stateReconciliationRequiredActionIds.includes(actionId)
          ? [`reconcile_materialization_state:${actionId}`]
          : [],
      });
    }
    const reconciliation = await reconcileStartupMaterializationLifecycleState({
      journal: fixture.transaction.journal,
      discovered: [fixture.service],
    });
    fixture.transaction.journal = reconciliation.journal;
    const state = getLifecycleState(fixture.service.manifest.id);
    assert.equal(state.setup.steps.generate, undefined);
    assert.equal(state.setup.steps.unaffected.status, "succeeded");
    assert.equal(await readFile(logPath, "utf8"), "preserved setup log\n");
  });
});

test("AC-4BJ.2 executed setup steps journal declared outputs before command mutation", async () => {
  await withMaterializationFixture("service-lasso-materialization-setup-run-", async (fixture) => {
    const target = path.join(fixture.serviceRoot, "runtime", "setup-output.txt");
    const script = path.join(fixture.serviceRoot, "runtime", "setup-output-writer.mjs");
    await writeFile(script, [
      "import { writeFile } from 'node:fs/promises';",
      "await writeFile(new URL('./setup-output.txt', import.meta.url), 'setup-transaction-output\\n');",
    ].join("\n"), "utf8");
    fixture.service.manifest.setup = {
      steps: {
        generate: {
          executable: process.execPath,
          args: ["runtime/setup-output-writer.mjs"],
          outputs: ["runtime/setup-output.txt"],
        },
      },
    };
    const registry = createServiceRegistry([fixture.service]);
    await writeServiceState(fixture.service, (await installService(fixture.service, registry)).state);
    await writeServiceState(fixture.service, (await configService(fixture.service, registry)).state);

    const result = await runServiceSetup(fixture.service, registry, {
      transactionHooks: createStartupSetupTransactionHooks(fixture.transaction),
    });
    assert.equal(result.ok, true);
    assert.equal(await readFile(target, "utf8"), "setup-transaction-output\n");
    assert.equal(
      fixture.transaction.journal.completedActions.some((action) => action.startsWith("materialization_preimage:")),
      true,
    );

    const rollback = await rollbackStartupMaterializations(fixture.transaction.journal);
    assert.deepEqual(rollback.blockedActionIds, []);
    await assert.rejects(readFile(target), (error) => error.code === "ENOENT");
  });
});

test("AC-4BJ.2 undeclared executed setup outputs add an explicit rollback blocker", async () => {
  await withMaterializationFixture("service-lasso-materialization-setup-unknown-", async (fixture) => {
    const hooks = createStartupSetupTransactionHooks(fixture.transaction);
    await hooks.beforeStep(fixture.service, "legacy-setup", undefined);
    await hooks.afterStep(fixture.service, "legacy-setup", undefined);

    assert.equal(
      fixture.transaction.journal.pendingCompensations.some((action) => action.startsWith("verify_setup_output:")),
      true,
    );
    const rawJournal = await readFile(getStartupTransactionJournalPath(fixture.workspaceRoot), "utf8");
    assert.doesNotMatch(rawJournal, /legacy-setup|materialized-service/);
  });
});

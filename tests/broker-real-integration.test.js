import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { startService, stopService } from "../dist/runtime/lifecycle/actions.js";
import { executeSecretRotation } from "../dist/runtime/operator/secret-rotation-execution.js";
import { buildSecretRotationImpactPlan } from "../dist/runtime/operator/secret-rotation-plan.js";
import { stopAllManagedProcesses } from "../dist/runtime/execution/supervisor.js";
import { getLifecycleState, resetLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";
import {
  bootstrapSecretsBrokerVault,
  loadSecretsBrokerRuntimeContext,
  provisionFirstRunGeneratedSecrets,
} from "../dist/runtime/broker/runtime.js";
import { BROKER_IDENTITY_LEASE_ENV, issueScopedBrokerIdentity } from "../dist/runtime/broker/identity.js";
import { writeManifest } from "./test-helpers.js";

const brokerBinary = process.env.SERVICE_LASSO_TEST_BROKER_BINARY;

function markPrepared(serviceId, artifact = undefined) {
  const state = getLifecycleState(serviceId);
  setLifecycleState(serviceId, {
    ...state,
    installed: true,
    configured: true,
    installArtifacts: artifact ? { ...state.installArtifacts, artifact } : state.installArtifacts,
  });
}

async function waitForFile(filePath, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(filePath, "utf8"));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Timed out waiting for sample broker evidence.");
}

async function waitForEvidenceDigest(filePath, digest, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const evidence = JSON.parse(await readFile(filePath, "utf8"));
      if (evidence.digest === digest) return evidence;
    } catch {
      // The restarted consumer may be between the old and new atomic observations.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for rotated sample broker evidence.");
}

async function listFiles(root) {
  const output = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) output.push(target);
    }
  }
  await visit(root);
  return output;
}

test("real broker provisions, resolves, restarts, and never persists plaintext launch values", { skip: !brokerBinary }, async () => {
  const binary = path.resolve(brokerBinary ?? "");
  assert.equal((await lstat(binary)).isFile(), true);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-real-broker-"));
  const servicesRoot = path.join(tempRoot, "services");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const sampleRoot = path.join(servicesRoot, "sample-service");
  const snapshotPath = path.join(sampleRoot, ".state", "broker-evidence.json");
  try {
    await mkdir(servicesRoot, { recursive: true });
    await mkdir(workspaceRoot, { recursive: true });
    await writeManifest(servicesRoot, "@secretsbroker", {
      id: "@secretsbroker",
      name: "Secrets Broker",
      description: "Real broker integration fixture.",
      executable: binary,
      args: ["serve"],
      env: { SECRETSBROKER_MODE: "production", SECRETSBROKER_TRANSPORT: "auto" },
      healthcheck: { type: "process" },
    });
    await mkdir(path.join(sampleRoot, "runtime"), { recursive: true });
    const sampleScript = path.join(sampleRoot, "runtime", "sample.mjs");
    await writeFile(sampleScript, [
      'import { createHash } from "node:crypto";',
      'import { mkdir, writeFile } from "node:fs/promises";',
      'import path from "node:path";',
      'const value = process.env.SAMPLE_REQUIRED_TOKEN ?? "";',
      'const target = path.resolve(process.cwd(), ".state/broker-evidence.json");',
      'await mkdir(path.dirname(target), { recursive: true });',
      'await writeFile(target, JSON.stringify({ present: value.length >= 32, length: value.length, digest: createHash("sha256").update(value).digest("hex") }));',
      'const timer = setInterval(() => {}, 1000);',
      'process.on("SIGTERM", () => { clearInterval(timer); process.exit(0); });',
    ].join("\n"));
    await writeManifest(servicesRoot, "sample-service", {
      id: "sample-service",
      name: "Sample Service",
      description: "Required real broker resolution fixture.",
      executable: process.execPath,
      args: ["runtime/sample.mjs"],
      env: { SAMPLE_REQUIRED_TOKEN: "${sample.GENERATED_TOKEN}" },
      healthcheck: { type: "process" },
      broker: {
        imports: [{
          namespace: "services/sample-service",
          ref: "sample.GENERATED_TOKEN",
          as: "SAMPLE_REQUIRED_TOKEN",
          required: true,
          onChange: { mode: "restart" },
        }],
        accessPolicy: {
          serviceId: "sample-service",
          workspace: "local",
          grants: [{ namespace: "services/sample-service", scope: "service", refs: ["sample.GENERATED_TOKEN"], operations: ["resolve", "create"], purpose: "real integration proof" }],
        },
        writeback: {
          allowedNamespaces: ["services/sample-service"],
          allowedOperations: ["create"],
          allowedRefs: ["sample.GENERATED_TOKEN"],
          allowOverwrite: false,
          auditReason: "real integration provisioning",
          generatedSecrets: [{ ref: "sample.GENERATED_TOKEN", source: "${SAMPLE_REQUIRED_TOKEN}", operation: "create", required: true }],
        },
        exports: [{ namespace: "services/sample-service", ref: "sample.GENERATED_TOKEN", source: "${SAMPLE_REQUIRED_TOKEN}", required: true }],
      },
    });

    resetLifecycleState();
    const discovered = await discoverServices(servicesRoot);
    const registry = createServiceRegistry(discovered);
    const broker = registry.getById("@secretsbroker");
    const sample = registry.getById("sample-service");
    assert.ok(broker && sample);
    markPrepared("@secretsbroker", {
      sourceType: "local-fixture",
      repo: null,
      channel: null,
      tag: null,
      assetName: path.basename(binary),
      assetUrl: null,
      archiveType: null,
      archivePath: null,
      extractedPath: path.dirname(binary),
      command: binary,
      args: ["serve"],
      checksum: null,
    });
    markPrepared("sample-service");

    await bootstrapSecretsBrokerVault(workspaceRoot, registry);
    let started = await startService(broker, registry, { workspaceRoot });
    assert.equal(started.ok, true);
    let context = await loadSecretsBrokerRuntimeContext(workspaceRoot, registry);
    assert.ok(context);
    for (let attempt = 0; attempt < 50 && !(await context.probe()).ready; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal((await context.probe()).ready, true);
    assert.deepEqual(await provisionFirstRunGeneratedSecrets(registry, context), [{
      serviceId: "sample-service",
      ref: "services/sample-service/sample.GENERATED_TOKEN",
      status: "created",
    }]);

    const adminCreatedRef = "services/sample-service/runtime/ADMIN_CREATED_TOKEN";
    const createPlan = await context.management({
      method: "POST",
      path: "/v1/management/secrets/create/dry-run",
      body: {
        requestId: "real-management-create-plan",
        serviceId: "@serviceadmin",
        ref: adminCreatedRef,
        operationId: "real-management-create",
        generationMode: "broker_generated",
        reason: "release qualification admin create",
      },
    });
    assert.equal(createPlan.statusCode, 200);
    assert.equal(createPlan.body.outcome, "dry_run_ready");
    assert.equal(createPlan.body.plan.expectedState, "missing");
    assert.equal(JSON.stringify(createPlan.body).includes("value"), false);
    const created = await context.management({
      method: "POST",
      path: "/v1/management/secrets/create/apply",
      body: {
        requestId: "real-management-create-apply",
        serviceId: "@serviceadmin",
        ref: adminCreatedRef,
        operationId: "real-management-create",
        generationMode: "broker_generated",
        reason: "release qualification admin create",
        confirm: true,
        plan: createPlan.body.plan,
      },
    });
    assert.equal(created.statusCode, 200);
    assert.equal(created.body.outcome, "applied");
    assert.equal(created.body.applied, true);
    assert.equal(JSON.stringify(created.body).includes("value"), false);
    const createRetry = await context.management({
      method: "POST",
      path: "/v1/management/secrets/create/apply",
      body: {
        requestId: "real-management-create-retry",
        serviceId: "@serviceadmin",
        ref: adminCreatedRef,
        operationId: "real-management-create",
        generationMode: "broker_generated",
        reason: "release qualification admin create retry",
        confirm: true,
        plan: createPlan.body.plan,
      },
    });
    assert.equal(createRetry.statusCode, 200);
    assert.equal(createRetry.body.outcome, "already_applied");
    assert.equal(createRetry.body.applied, false);
    const createdReveal = await context.management({
      method: "POST",
      path: "/v1/management/secrets/reveal",
      body: {
        requestId: "real-management-create-reveal",
        serviceId: "@serviceadmin",
        ref: adminCreatedRef,
        reason: "release qualification created secret proof",
      },
    });
    assert.equal(createdReveal.statusCode, 200);
    assert.equal(createdReveal.body.outcome, "ready");
    const adminCreatedPlaintext = createdReveal.body.value;
    assert.equal(typeof adminCreatedPlaintext, "string");
    assert.ok(adminCreatedPlaintext.length >= 40);

    const managedRef = "services/sample-service/sample.GENERATED_TOKEN";
    const listed = await context.management({
      method: "GET",
      path: "/v1/management/secrets?search=GENERATED_TOKEN",
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.body.serviceId, "@secretsbroker");
    assert.equal(listed.body.results.some((record) => record.ref === managedRef && record.outcome === "ready"), true);

    const initialReveal = await context.management({
      method: "POST",
      path: "/v1/management/secrets/reveal",
      body: {
        requestId: "real-management-reveal-before-edit",
        serviceId: "@serviceadmin",
        ref: managedRef,
        reason: "release qualification before edit",
      },
    });
    assert.equal(initialReveal.statusCode, 200);
    assert.equal(initialReveal.body.outcome, "ready");
    const originalPlaintext = initialReveal.body.value;
    assert.equal(typeof originalPlaintext, "string");

    const dryRun = await context.management({
      method: "POST",
      path: "/v1/management/secrets/edit/dry-run",
      body: {
        requestId: "real-management-edit-plan",
        serviceId: "@serviceadmin",
        ref: managedRef,
        reason: "release qualification edit plan",
      },
    });
    assert.equal(dryRun.statusCode, 200);
    assert.equal(dryRun.body.outcome, "dry_run_ready");
    assert.equal(JSON.stringify(dryRun.body).includes(originalPlaintext), false);

    const replacementPlaintext = `real-management-replacement-${createHash("sha256").update(tempRoot).digest("hex")}`;
    const applied = await context.management({
      method: "POST",
      path: "/v1/management/secrets/edit/apply",
      body: {
        requestId: "real-management-edit-apply",
        serviceId: "@serviceadmin",
        ref: managedRef,
        reason: "release qualification edit apply",
        confirm: true,
        value: replacementPlaintext,
      },
    });
    assert.equal(applied.statusCode, 200);
    assert.equal(applied.body.outcome, "applied");
    assert.equal(applied.body.applied, true);
    assert.equal(JSON.stringify(applied.body).includes(replacementPlaintext), false);

    const identity = await issueScopedBrokerIdentity(sample, {
      launchLeaseIssuer: context.launchLeaseIssuer,
      transportBinding: context.transportBinding,
    });
    const lease = JSON.parse(identity.env[BROKER_IDENTITY_LEASE_ENV]);
    const [resolved] = await context.lookup({ service: sample, refs: ["services/sample-service/sample.GENERATED_TOKEN"], identityLease: lease });
    assert.equal(resolved.status, "resolved");
    const plaintext = resolved.value;
    assert.equal(typeof plaintext, "string");
    assert.equal(plaintext, replacementPlaintext);

    const lifecycleStatus = await context.management({
      method: "GET",
      path: "/v1/management/lifecycle/status",
    });
    assert.equal(lifecycleStatus.statusCode, 200);
    assert.equal(lifecycleStatus.body.outcome, "ready");
    assert.equal(lifecycleStatus.body.wrapper.state, "ready");
    assert.equal(typeof lifecycleStatus.body.key.keyId, "string");
    assert.doesNotMatch(
      JSON.stringify(lifecycleStatus.body),
      /masterKey|privateKey|recoveryShare|ciphertext|payload|passphrase/u,
    );

    const backup = await context.management({
      method: "POST",
      path: "/v1/management/lifecycle/backups",
      body: {
        requestId: "real-lifecycle-backup",
        serviceId: "@serviceadmin",
        operationId: "real-lifecycle-backup",
        reason: "release lifecycle checkpoint",
      },
    });
    assert.equal(backup.statusCode, 200);
    assert.equal(backup.body.applied, true);
    assert.equal(backup.body.backup.verification, "verified");
    assert.equal(JSON.stringify(backup.body).includes("path"), false);
    const backupId = backup.body.backup.backupId;

    const postBackupValue = `post-backup-${createHash("sha256").update(`${tempRoot}:restore`).digest("hex")}`;
    const postBackupEdit = await context.management({
      method: "POST",
      path: "/v1/management/secrets/edit/apply",
      body: {
        requestId: "real-lifecycle-post-backup-edit",
        serviceId: "@serviceadmin",
        ref: managedRef,
        reason: "prove exact restore",
        confirm: true,
        value: postBackupValue,
      },
    });
    assert.equal(postBackupEdit.statusCode, 200);

    const restorePlan = await context.management({
      method: "POST",
      path: "/v1/management/lifecycle/restore/dry-run",
      body: {
        requestId: "real-lifecycle-restore-plan",
        serviceId: "@serviceadmin",
        operationId: "real-lifecycle-restore",
        reason: "release restore verification",
        backupId,
      },
    });
    assert.equal(restorePlan.statusCode, 200);
    assert.equal(restorePlan.body.requiresConfirmation, true);
    const restored = await context.management({
      method: "POST",
      path: "/v1/management/lifecycle/restore/apply",
      body: {
        requestId: "real-lifecycle-restore-apply",
        serviceId: "@serviceadmin",
        operationId: "real-lifecycle-restore",
        reason: "release restore verification",
        backupId,
        planToken: restorePlan.body.planToken,
        expectedKeyId: restorePlan.body.expectedKeyId,
        expectedStoreHash: restorePlan.body.expectedStoreHash,
        confirm: true,
      },
    });
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.body.applied, true);
    const restoreRetry = await context.management({
      method: "POST",
      path: "/v1/management/lifecycle/restore/apply",
      body: {
        requestId: "real-lifecycle-restore-retry",
        serviceId: "@serviceadmin",
        operationId: "real-lifecycle-restore",
        reason: "retry after simulated response loss",
        backupId,
        planToken: restorePlan.body.planToken,
        expectedKeyId: restorePlan.body.expectedKeyId,
        expectedStoreHash: restorePlan.body.expectedStoreHash,
        confirm: true,
      },
    });
    assert.equal(restoreRetry.statusCode, 200);
    assert.equal(restoreRetry.body.applied, false);
    assert.equal(restoreRetry.body.nextAction, "restore_already_applied");

    const restoredReveal = await context.management({
      method: "POST",
      path: "/v1/management/secrets/reveal",
      body: {
        requestId: "real-lifecycle-restored-reveal",
        serviceId: "@serviceadmin",
        ref: managedRef,
        reason: "verify restored value",
      },
    });
    assert.equal(restoredReveal.body.value, replacementPlaintext);

    const rotated = await context.management({
      method: "POST",
      path: "/v1/management/lifecycle/key/rotate",
      body: {
        requestId: "real-lifecycle-key-rotate",
        serviceId: "@serviceadmin",
        operationId: "real-lifecycle-key-rotate",
        reason: "release key rotation verification",
        expectedKeyId: lifecycleStatus.body.key.keyId,
        confirm: true,
      },
    });
    assert.equal(rotated.statusCode, 200);
    assert.equal(rotated.body.applied, true);
    assert.notEqual(rotated.body.newKeyId, lifecycleStatus.body.key.keyId);
    const rotationRetry = await context.management({
      method: "POST",
      path: "/v1/management/lifecycle/key/rotate",
      body: {
        requestId: "real-lifecycle-key-rotate-retry",
        serviceId: "@serviceadmin",
        operationId: "real-lifecycle-key-rotate",
        reason: "retry after simulated response loss",
        expectedKeyId: lifecycleStatus.body.key.keyId,
        confirm: true,
      },
    });
    assert.equal(rotationRetry.statusCode, 200);
    assert.equal(rotationRetry.body.applied, false);
    assert.equal(rotationRetry.body.newKeyId, rotated.body.newKeyId);

    started = await startService(sample, registry, { workspaceRoot });
    assert.equal(started.ok, true);
    const firstEvidence = await waitForFile(snapshotPath);
    assert.equal(firstEvidence.present, true);
    assert.equal(firstEvidence.digest, createHash("sha256").update(plaintext).digest("hex"));
    await stopService(sample);
    await stopService(broker);
    await rm(snapshotPath, { force: true });

    started = await startService(broker, registry, { workspaceRoot });
    assert.equal(started.ok, true);
    context = await loadSecretsBrokerRuntimeContext(workspaceRoot, registry);
    for (let attempt = 0; attempt < 50 && !(await context.probe()).ready; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    started = await startService(sample, registry, { workspaceRoot });
    assert.equal(started.ok, true);
    const secondEvidence = await waitForFile(snapshotPath);
    assert.deepEqual(secondEvidence, firstEvidence);

    const restartedReveal = await context.management({
      method: "POST",
      path: "/v1/management/secrets/reveal",
      body: {
        requestId: "real-management-reveal-after-restart",
        serviceId: "@serviceadmin",
        ref: managedRef,
        reason: "release qualification restart verification",
      },
    });
    assert.equal(restartedReveal.statusCode, 200);
    assert.equal(restartedReveal.body.value, replacementPlaintext);

    const restartedCreatedReveal = await context.management({
      method: "POST",
      path: "/v1/management/secrets/reveal",
      body: {
        requestId: "real-management-created-reveal-after-restart",
        serviceId: "@serviceadmin",
        ref: adminCreatedRef,
        reason: "release qualification created secret restart proof",
      },
    });
    assert.equal(restartedCreatedReveal.statusCode, 200);
    assert.equal(restartedCreatedReveal.body.value, adminCreatedPlaintext);

    const rotationCandidate = `real-rotation-${createHash("sha256").update(`${tempRoot}:rotation`).digest("hex")}`;
    const rotationPlan = buildSecretRotationImpactPlan(discovered, managedRef);
    assert.equal(rotationPlan.status, "ready");
    assert.deepEqual(rotationPlan.execution.operations.map((entry) => ({
      serviceId: entry.serviceId,
      action: entry.action,
    })), [{ serviceId: "sample-service", action: "restart" }]);
    const priorSamplePid = getLifecycleState("sample-service").runtime.pid;
    const rotation = await executeSecretRotation({
      operationId: "real-broker-consumer-rotation",
      ref: managedRef,
      planFingerprint: rotationPlan.planFingerprint,
      reason: "release qualification linked consumer rotation",
      confirm: true,
      value: rotationCandidate,
      actorId: "local:release-qualification",
    }, {
      workspaceRoot,
      services: discovered,
      registry,
      brokerRuntime: context,
    });
    assert.equal(rotation.outcome, "committed");
    assert.equal(rotation.phase, "committed");
    assert.notEqual(getLifecycleState("sample-service").runtime.pid, priorSamplePid);
    assert.equal(JSON.stringify(rotation).includes(rotationCandidate), false);
    const rotatedEvidence = await waitForEvidenceDigest(
      snapshotPath,
      createHash("sha256").update(rotationCandidate).digest("hex"),
    );
    assert.equal(rotatedEvidence.present, true);
    const rotatedReveal = await context.management({
      method: "POST",
      path: "/v1/management/secrets/reveal",
      body: {
        requestId: "real-management-reveal-after-rotation",
        serviceId: "@serviceadmin",
        ref: managedRef,
        reason: "release qualification linked consumer rotation proof",
      },
    });
    assert.equal(rotatedReveal.statusCode, 200);
    assert.equal(rotatedReveal.body.value, rotationCandidate);

    await stopService(sample);
    await stopService(broker);
    for (const file of await listFiles(tempRoot)) {
      const bytes = await readFile(file);
      assert.equal(bytes.includes(Buffer.from(plaintext)), false, `plaintext leaked into ${path.relative(tempRoot, file)}`);
      assert.equal(bytes.includes(Buffer.from(originalPlaintext)), false, `original plaintext leaked into ${path.relative(tempRoot, file)}`);
      assert.equal(bytes.includes(Buffer.from(postBackupValue)), false, `post-backup plaintext leaked into ${path.relative(tempRoot, file)}`);
      assert.equal(bytes.includes(Buffer.from(adminCreatedPlaintext)), false, `admin-created plaintext leaked into ${path.relative(tempRoot, file)}`);
      assert.equal(bytes.includes(Buffer.from(rotationCandidate)), false, `rotation plaintext leaked into ${path.relative(tempRoot, file)}`);
    }
  } finally {
    await stopAllManagedProcesses().catch(() => undefined);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

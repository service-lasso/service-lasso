import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { getLifecycleState, resetLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { buildSecretRotationImpactPlan } from "../dist/runtime/operator/secret-rotation-plan.js";
import {
  executeSecretRotation,
  readSecretRotationExecutionState,
} from "../dist/runtime/operator/secret-rotation-execution.js";

const ref = "secretsbroker.ROTATE_TOKEN";
const candidate = "ROTATION_CANDIDATE_MUST_NOT_PERSIST";

function service(id = "consumer", onChange = { mode: "restart" }) {
  return {
    manifestPath: path.join("C:", "fixtures", id, "service.json"),
    serviceRoot: path.join("C:", "fixtures", id),
    manifest: {
      id,
      name: id,
      description: "rotation transaction fixture",
      broker: {
        imports: [{
          namespace: "secretsbroker",
          ref,
          as: "ROTATE_TOKEN",
          required: true,
          onChange,
        }],
      },
    },
  };
}

function setRunning(serviceId, running) {
  const current = getLifecycleState(serviceId);
  setLifecycleState(serviceId, {
    ...current,
    installed: true,
    configured: true,
    running,
    runtime: {
      ...current.runtime,
      pid: running ? 4242 : null,
    },
  });
}

function fakeBroker(calls) {
  return {
    management: async ({ path: requestPath, body }) => {
      calls.push({ path: requestPath, body });
      if (requestPath.endsWith("/dry-run")) {
        return { statusCode: 200, body: { outcome: "dry_run_ready", auditStatus: "audit_ready" } };
      }
      if (requestPath.endsWith("/status")) {
        return { statusCode: 200, body: { outcome: "ready", currentVersion: { versionId: "version-1" } } };
      }
      if (requestPath.endsWith("/stage")) {
        return {
          statusCode: 200,
          body: { outcome: "staged", auditStatus: "audit_recorded", stagedVersion: { versionId: "version-2" } },
        };
      }
      if (requestPath.endsWith("/activate")) {
        return {
          statusCode: 200,
          body: {
            outcome: "applied",
            applied: true,
            auditStatus: "audit_recorded",
            currentVersion: { versionId: "version-2" },
            previousVersion: { versionId: "version-1" },
          },
        };
      }
      if (requestPath.endsWith("/rollback")) {
        return {
          statusCode: 200,
          body: { outcome: "rolled_back", applied: true, auditStatus: "audit_recorded", currentVersion: { versionId: "version-1" } },
        };
      }
      throw new Error("unexpected broker path " + requestPath);
    },
  };
}

function request(plan, operationId) {
  return {
    operationId,
    ref,
    planFingerprint: plan.planFingerprint,
    reason: "approved linked-service rotation",
    confirm: true,
    value: candidate,
    actorId: "local:test-operator",
  };
}

test("rotation transaction stages, activates, restarts only the linked consumer, persists metadata only, and converges idempotently", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-rotation-execution-"));
  const fixture = service();
  const services = [fixture];
  const registry = createServiceRegistry(services);
  const calls = [];
  const lifecycleCalls = [];
  resetLifecycleState();
  setRunning(fixture.manifest.id, true);
  const plan = buildSecretRotationImpactPlan(services, ref);
  assert.equal(plan.status, "ready");

  const options = {
    workspaceRoot,
    services,
    registry,
    brokerRuntime: fakeBroker(calls),
    runtimeGenerationId: "generation-a",
    allocationId: "allocation-a",
    operations: {
      stop: async (target) => {
        lifecycleCalls.push("stop:" + target.manifest.id);
        setRunning(target.manifest.id, false);
      },
      start: async (target) => {
        lifecycleCalls.push("start:" + target.manifest.id);
        setRunning(target.manifest.id, true);
        return true;
      },
    },
  };

  try {
    const result = await executeSecretRotation(request(plan, "rotation-success"), options);
    assert.equal(result.outcome, "committed");
    assert.equal(result.phase, "committed");
    assert.deepEqual(lifecycleCalls, ["stop:consumer", "start:consumer"]);
    assert.deepEqual(calls.map((call) => call.path), [
      "/v1/management/secrets/rotation/dry-run",
      "/v1/management/secrets/rotation/status",
      "/v1/management/secrets/rotation/stage",
      "/v1/management/secrets/rotation/activate",
    ]);
    const stateBytes = await readFile(path.join(workspaceRoot, ".service-lasso", "secret-rotations", "rotation-success.json"));
    assert.equal(stateBytes.includes(Buffer.from(candidate)), false);
    assert.equal(stateBytes.includes(Buffer.from("approved linked-service rotation")), false);

    const retry = await executeSecretRotation(request(plan, "rotation-success"), options);
    assert.equal(retry.outcome, "committed");
    assert.equal(calls.length, 4);
    assert.equal((await readSecretRotationExecutionState(workspaceRoot, "rotation-success")).activeVersionId, "version-2");
  } finally {
    resetLifecycleState();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("consumer convergence failure automatically restores the Broker version and the prior running service state", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-rotation-rollback-"));
  const fixture = service();
  const services = [fixture];
  const registry = createServiceRegistry(services);
  const calls = [];
  let startAttempts = 0;
  resetLifecycleState();
  setRunning(fixture.manifest.id, true);
  const plan = buildSecretRotationImpactPlan(services, ref);

  try {
    const result = await executeSecretRotation(request(plan, "rotation-rollback"), {
      workspaceRoot,
      services,
      registry,
      brokerRuntime: fakeBroker(calls),
      operations: {
        stop: async (target) => setRunning(target.manifest.id, false),
        start: async (target) => {
          startAttempts += 1;
          const succeeds = startAttempts > 1;
          setRunning(target.manifest.id, succeeds);
          return succeeds;
        },
      },
    });
    assert.equal(result.outcome, "rolled_back");
    assert.equal(result.phase, "rolled_back");
    assert.equal(result.activeVersionId, "version-1");
    assert.equal(startAttempts, 2);
    assert.equal(getLifecycleState("consumer").running, true);
    assert.equal(calls.some((call) => call.path.endsWith("/rollback")), true);
    assert.equal(JSON.stringify(result).includes(candidate), false);
  } finally {
    resetLifecycleState();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("manual plans and stale fingerprints fail before any Broker mutation", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-rotation-blocked-"));
  const fixture = service("manual-consumer", { mode: "manual" });
  const services = [fixture];
  const registry = createServiceRegistry(services);
  const calls = [];
  resetLifecycleState();
  setRunning(fixture.manifest.id, true);
  const plan = buildSecretRotationImpactPlan(services, ref);
  assert.equal(plan.status, "blocked");
  try {
    await assert.rejects(
      executeSecretRotation(request(plan, "rotation-manual"), {
        workspaceRoot,
        services,
        registry,
        brokerRuntime: fakeBroker(calls),
      }),
      /blockers/i,
    );
    assert.equal(calls.length, 0);
    await assert.rejects(
      executeSecretRotation({
        ...request(plan, "rotation-stale"),
        planFingerprint: "sha256:" + "0".repeat(64),
      }, {
        workspaceRoot,
        services,
        registry,
        brokerRuntime: fakeBroker(calls),
      }),
      /changed/i,
    );
    assert.equal(calls.length, 0);
  } finally {
    resetLifecycleState();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("canonical Broker refs map back to namespaced manifest imports for consumer orchestration", () => {
  const fixture = {
    ...service(),
    manifest: {
      ...service().manifest,
      broker: {
        imports: [{
          namespace: "services/consumer/runtime",
          ref: "secretsbroker.ROTATE_TOKEN",
          as: "ROTATE_TOKEN",
          required: true,
          onChange: { mode: "restart" },
        }],
      },
    },
  };
  const plan = buildSecretRotationImpactPlan(
    [fixture],
    "services/consumer/runtime/secretsbroker.ROTATE_TOKEN",
  );
  assert.equal(plan.status, "ready");
  assert.equal(plan.services.length, 1);
  assert.equal(plan.services[0].serviceId, "consumer");
  assert.equal(plan.services[0].action, "restart");
});

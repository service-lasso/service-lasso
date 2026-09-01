import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { buildRuntimeDoctorStatus, recommendedDoctorAction } from "../dist/runtime/doctor/status.js";
import { RUNTIME_DOCTOR_CLASSIFICATIONS } from "../dist/contracts/api.js";
import { ensureRuntimeConfig, resolveRuntimeConfig } from "../dist/runtime/config.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { DependencyGraph, createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { clearPersistedFixtureState, makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

const execFileAsync = promisify(execFile);

async function buildDoctor(servicesRoot, workspaceRoot, version = "0.0.0-test") {
  const config = await ensureRuntimeConfig(resolveRuntimeConfig({ servicesRoot, workspaceRoot, version }));
  const discovered = await discoverServices(config.servicesRoot);
  const registry = createServiceRegistry(discovered);
  const graph = new DependencyGraph(registry);
  return await buildRuntimeDoctorStatus({ config, registry, graph });
}

test("runtime doctor reports read-only not_running status for an empty workspace", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-doctor-empty-");
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    await writeExecutableFixtureService(servicesRoot, "doctor-empty-service");
    const result = await buildDoctor(servicesRoot, workspaceRoot);

    assert.equal(result.doctor.contractVersion, "service-lasso.runtime-doctor.v1");
    assert.equal(result.doctor.readOnly, true);
    assert.equal(result.doctor.classification, "not_running");
    assert.equal(result.doctor.recommendedAction, "restart");
    assert.equal(result.doctor.runtime.selectedInstanceId, null);
    assert.match(result.doctor.evidencePaths.runtimeInstanceState, /runtime-instance\.json$/);
  } finally {
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runtime doctor API and CLI share the same healthy diagnosis model", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-doctor-healthy-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const registryPath = path.join(tempRoot, "registry", "instances.json");
  const previousRegistryPath = process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
  process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = registryPath;
  let apiServer = null;

  try {
    await clearPersistedFixtureState(servicesRoot);
    await writeExecutableFixtureService(servicesRoot, "doctor-healthy-service");
    apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

    const response = await fetch(apiServer.url + "/api/runtime/doctor");
    const apiBody = await response.json();
    assert.equal(response.status, 200);
    assert.equal(apiBody.doctor.classification, "healthy");
    assert.equal(apiBody.doctor.recommendedAction, "resume");
    assert.equal(apiBody.doctor.readOnly, true);
    assert.equal(apiBody.doctor.runtime.selectedInstanceId.startsWith("sl_"), true);
    assert.equal(apiBody.doctor.ownership.runtime.length, 1);
    assert.equal(apiBody.doctor.ownership.runtime[0].identityStatus, "owned");

    const cli = await execFileAsync(
      process.execPath,
      [
        path.resolve("dist", "cli.js"),
        "doctor",
        "status",
        "--services-root",
        servicesRoot,
        "--workspace-root",
        workspaceRoot,
        "--json",
      ],
      {
        env: {
          ...process.env,
          SERVICE_LASSO_INSTANCE_REGISTRY_PATH: registryPath,
        },
      },
    );
    const cliBody = JSON.parse(cli.stdout);

    assert.equal(cliBody.action, "status");
    assert.equal(cliBody.doctor.contractVersion, apiBody.doctor.contractVersion);
    assert.equal(cliBody.doctor.classification, apiBody.doctor.classification);
    assert.equal(cliBody.doctor.recommendedAction, apiBody.doctor.recommendedAction);
    assert.equal(cliBody.doctor.runtime.selectedInstanceId, apiBody.doctor.runtime.selectedInstanceId);
  } finally {
    if (apiServer) await apiServer.stop();
    if (previousRegistryPath === undefined) {
      delete process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
    } else {
      process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = previousRegistryPath;
    }
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runtime doctor snapshots every stable classification without recommending termination for PID reuse", () => {
  assert.equal(RUNTIME_DOCTOR_CLASSIFICATIONS.length, 13);
  const snapshot = Object.fromEntries(
    RUNTIME_DOCTOR_CLASSIFICATIONS.map((classification) => [classification, recommendedDoctorAction(classification)]),
  );
  assert.deepEqual(snapshot, {
    healthy: "resume",
    not_running: "restart",
    wrong_lane: "request_operator_confirmation",
    ambiguous_generation: "request_operator_confirmation",
    identity_mismatch: "request_operator_confirmation",
    unknown_owner: "request_operator_confirmation",
    preferred_port_occupied: "request_operator_confirmation",
    fixed_port_conflict: "request_operator_confirmation",
    reservation_drift: "repair_state",
    configuration_drift: "repair_state",
    partial_startup: "roll_back",
    state_corrupt: "repair_state",
    migration_required: "repair_state",
  });
  assert.notEqual(snapshot.identity_mismatch, "stop");
  assert.notEqual(snapshot.unknown_owner, "stop");
});

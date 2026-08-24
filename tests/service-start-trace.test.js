import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import {
  makeTempServicesRoot,
  writeManifest,
  writeExecutableFixtureService,
} from "./test-helpers.js";

async function getJson(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function postJson(url) {
  const response = await fetch(url, { method: "POST" });
  return {
    status: response.status,
    body: await response.json(),
  };
}

test("service start trace API returns ordered redacted success timeline", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-start-trace-success-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "trace-success", {
    env: {
      API_TOKEN: "raw-api-token",
      PUBLIC_MODE: "demo",
    },
    globalenv: {
      DB_PASSWORD: "raw-db-password",
    },
    ports: {
      service: 0,
    },
    healthchecks: [
      { id: "process-ready", type: "process" },
      {
        id: "optional-diagnostic",
        type: "file",
        file: "runtime/optional-diagnostic.txt",
        required: false,
      },
    ],
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot: path.join(tempRoot, "workspace") });

  try {
    assert.equal((await postJson(apiServer.url + "/api/services/trace-success/install")).status, 200);
    assert.equal((await postJson(apiServer.url + "/api/services/trace-success/config")).status, 200);
    const started = await postJson(apiServer.url + "/api/services/trace-success/start");
    assert.equal(started.status, 200);

    const result = await getJson(apiServer.url + "/api/services/trace-success/start-trace");
    assert.equal(result.status, 200);
    assert.equal(result.body.serviceId, "trace-success");
    assert.equal(result.body.trace.status, "succeeded");
    assert.deepEqual(
      result.body.trace.events.map((event) => event.phase),
      [
        "dependency_resolution",
        "port_selection",
        "artifact_acquisition",
        "env_merge",
        "process_spawn",
        "health_check",
        "terminal_outcome",
      ],
    );
    assert.deepEqual(
      result.body.trace.events.map((event) => event.order),
      [1, 2, 3, 4, 5, 6, 7],
    );
    assert.ok(result.body.trace.events.find((event) => event.phase === "env_merge").metadata.serviceEnvKeys.includes("API_TOKEN"));
    const healthEvent = result.body.trace.events.find((event) => event.phase === "health_check");
    assert.deepEqual(healthEvent.metadata.healthcheckIds, ["process-ready", "optional-diagnostic"]);
    assert.deepEqual(healthEvent.metadata.healthcheckPassedIds, ["process-ready"]);
    assert.deepEqual(healthEvent.metadata.healthcheckFailedIds, ["optional-diagnostic"]);
    assert.deepEqual(healthEvent.metadata.requiredHealthcheckFailedIds, []);
    assert.deepEqual(healthEvent.metadata.optionalHealthcheckFailedIds, ["optional-diagnostic"]);
    assert.deepEqual(healthEvent.metadata.healthcheckAttempts, ["process-ready:1", "optional-diagnostic:1"]);
    assert.equal(healthEvent.metadata.healthcheckAttemptCount, 2);

    const serialized = JSON.stringify(result.body);
    assert.doesNotMatch(serialized, /raw-api-token|raw-db-password/);

    const persistedRuntime = await readFile(path.join(serviceRoot, ".state", "runtime.json"), "utf8");
    assert.match(persistedRuntime, /"startTrace"/);
    assert.doesNotMatch(persistedRuntime, /raw-api-token|raw-db-password/);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("failed required readiness exposes per-check trace and operator diagnostic ids", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-start-trace-health-failure-");
  await writeExecutableFixtureService(servicesRoot, "trace-health-failure", {
    healthchecks: [
      { id: "process-ready", type: "process" },
      {
        id: "required-ready-file",
        type: "file",
        file: "runtime/required-ready.txt",
        retries: 1,
        interval: 1,
      },
    ],
  });
  const apiServer = await startApiServer({
    port: 0,
    servicesRoot,
    workspaceRoot: path.join(tempRoot, "workspace"),
  });

  try {
    assert.equal((await postJson(apiServer.url + "/api/services/trace-health-failure/install")).status, 200);
    assert.equal((await postJson(apiServer.url + "/api/services/trace-health-failure/config")).status, 200);
    const blocked = await postJson(apiServer.url + "/api/services/trace-health-failure/start");
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.ok, false);
    assert.equal(blocked.body.health.healthy, false);

    const result = await getJson(apiServer.url + "/api/services/trace-health-failure/start-trace");
    const healthEvent = result.body.trace.events.find((event) => event.phase === "health_check");
    assert.equal(healthEvent.status, "failed");
    assert.deepEqual(healthEvent.metadata.healthcheckPassedIds, ["process-ready"]);
    assert.deepEqual(healthEvent.metadata.healthcheckFailedIds, ["required-ready-file"]);
    assert.deepEqual(healthEvent.metadata.requiredHealthcheckFailedIds, ["required-ready-file"]);
    assert.deepEqual(healthEvent.metadata.optionalHealthcheckFailedIds, []);
    assert.deepEqual(healthEvent.metadata.healthcheckAttempts, ["process-ready:1", "required-ready-file:1"]);

    const diagnostics = await getJson(apiServer.url + "/api/diagnostics/dependencies");
    const service = diagnostics.body.diagnostics.services.find((entry) => entry.id === "trace-health-failure");
    assert.equal(service.readiness, "degraded");
    assert.equal(service.blockingReason, "unhealthy");
    assert.ok(service.blockers.some((blocker) => blocker.includes("required-ready-file")));
    assert.equal(service.health.checks.find((check) => check.id === "required-ready-file").required, true);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("service start trace API records failed start without leaking request material", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-start-trace-blocked-");
  await writeManifest(servicesRoot, "trace-blocked", {
    id: "trace-blocked",
    name: "trace-blocked",
    description: "Fixture with a missing executable.",
    executable: "./runtime/missing-executable.exe",
    args: [],
    env: {
      CLIENT_SECRET: "raw-client-secret",
    },
    healthcheck: { type: "process" },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot: path.join(tempRoot, "workspace") });

  try {
    const blocked = await postJson(apiServer.url + "/api/services/trace-blocked/start");
    assert.equal(blocked.status, 409);

    const result = await getJson(apiServer.url + "/api/services/trace-blocked/start-trace");
    assert.equal(result.status, 200);
    assert.equal(result.body.trace.status, "failed");
    assert.equal(result.body.trace.events.at(-2).phase, "process_spawn");
    assert.equal(result.body.trace.events.at(-2).status, "failed");
    assert.equal(result.body.trace.events.at(-1).phase, "terminal_outcome");
    assert.equal(result.body.history[0].status, "failed");
    assert.doesNotMatch(JSON.stringify(result.body), /raw-client-secret/);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("service start trace blocks unresolved local env selectors before spawn", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-start-trace-env-block-");
  await writeExecutableFixtureService(servicesRoot, "trace-env-blocked", {
    env: {
      PATH: ["${PYTHON_HOME}", "${NODE_HOME}"],
    },
    healthcheck: { type: "process" },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot: path.join(tempRoot, "workspace") });

  try {
    assert.equal((await postJson(apiServer.url + "/api/services/trace-env-blocked/install")).status, 200);
    assert.equal((await postJson(apiServer.url + "/api/services/trace-env-blocked/config")).status, 200);
    const blocked = await postJson(apiServer.url + "/api/services/trace-env-blocked/start");
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error, "invalid_lifecycle_state");
    assert.match(blocked.body.message, /PYTHON_HOME/);
    assert.match(blocked.body.message, /NODE_HOME/);

    const result = await getJson(apiServer.url + "/api/services/trace-env-blocked/start-trace");
    assert.equal(result.status, 200);
    assert.equal(result.body.trace.status, "blocked");
    assert.deepEqual(
      result.body.trace.events.map((event) => event.phase),
      [
        "dependency_resolution",
        "port_selection",
        "artifact_acquisition",
        "env_merge",
        "terminal_outcome",
      ],
    );
    const envMerge = result.body.trace.events.find((event) => event.phase === "env_merge");
    assert.equal(envMerge.status, "blocked");
    assert.deepEqual(envMerge.metadata.unresolvedEnvKeys, ["PATH"]);
    assert.deepEqual(envMerge.metadata.unresolvedSelectors, [
      "NODE_HOME",
      "PYTHON_HOME",
    ]);
    assert.deepEqual(envMerge.metadata.unresolvedRawSelectors, [
      "${NODE_HOME}",
      "${PYTHON_HOME}",
    ]);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

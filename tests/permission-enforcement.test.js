import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { readAuditEvents } from "../dist/runtime/audit/store.js";
import { ApiError } from "../dist/server/errors.js";
import { resolveRuntimeRequestAuth } from "../dist/runtime/auth/request-policy.js";
import {
  enforcePermission,
  permissionActorFromRuntimeAuth,
  resolvePermissionActor,
} from "../dist/runtime/permissions/enforcement.js";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";

const SENTINEL_TOKEN = "test-local-admin-token";

/**
 * Builds a request-policy fake IncomingMessage for mapper tests.
 */
function fakeRequest(remoteAddress, headers = {}) {
  return {
    socket: { remoteAddress },
    headers,
  };
}

/**
 * Posts JSON to a runtime API URL with optional headers.
 */
async function postJson(url, body = {}, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

/**
 * Writes a no-op action script used by HTTP permission proofs.
 */
async function writeActionScript(serviceRoot) {
  const runtimeRoot = path.join(serviceRoot, "runtime");
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(
    path.join(runtimeRoot, "action-writer.mjs"),
    "console.log(\"permission action complete\");\n",
    "utf8",
  );
}

test("permissionActorFromRuntimeAuth maps local-root, local-token, and fail-closed zitadel", () => {
  const localRoot = permissionActorFromRuntimeAuth(
    resolveRuntimeRequestAuth(fakeRequest("127.0.0.1"), { bindHost: "127.0.0.1", env: {} }),
  );
  assert.equal(localRoot.type, "local-root");
  assert.equal(localRoot.id, "local-root");
  assert.deepEqual(localRoot.permissions, ["*"]);

  const localToken = permissionActorFromRuntimeAuth(
    resolveRuntimeRequestAuth(
      fakeRequest("10.0.0.8", { "x-service-lasso-admin-token": SENTINEL_TOKEN }),
      { bindHost: "0.0.0.0", env: { SERVICE_LASSO_LOCAL_ADMIN_TOKEN: SENTINEL_TOKEN } },
    ),
  );
  assert.equal(localToken.type, "local-token");
  assert.equal(localToken.id, "local-admin-token");
  assert.deepEqual(localToken.permissions, ["*"]);

  const zitadel = permissionActorFromRuntimeAuth(
    resolveRuntimeRequestAuth(
      fakeRequest("127.0.0.1", {
        "x-service-lasso-internal-proxy": "serviceadmin",
        "x-service-lasso-client-address": "10.0.0.8",
        "x-service-lasso-zitadel-user-id": "usr_zitadel_operator",
      }),
      {
        bindHost: "0.0.0.0",
        env: { SERVICE_LASSO_ZITADEL_ENABLED: "true" },
      },
    ),
  );
  assert.equal(zitadel.type, "zitadel-user");
  assert.equal(zitadel.id, "usr_zitadel_operator");
  assert.deepEqual(zitadel.permissions, []);

  assert.throws(
    () =>
      permissionActorFromRuntimeAuth(
        resolveRuntimeRequestAuth(fakeRequest("10.0.0.8"), { bindHost: "0.0.0.0", env: {} }),
      ),
    (error) => error instanceof ApiError && error.code === "actor_required",
  );
});

test("enforcePermission allows local-root, denies empty grants, requires confirmation, and scopes system actors", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-permission-unit-");
  const common = {
    workspaceRoot,
    permission: "service.action.run",
    method: "POST",
    routeTemplate: "/api/services/:serviceId/actions/:actionId/runs",
    subject: "backup",
  };

  try {
    const allowed = await enforcePermission({
      ...common,
      actor: { type: "local-root", id: "local-root", permissions: ["*"] },
    });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.actor.type, "local-root");

    await assert.rejects(
      () =>
        enforcePermission({
          ...common,
          actor: { type: "zitadel-user", id: "usr_zitadel_operator", permissions: [] },
        }),
      (error) => error instanceof ApiError && error.code === "permission_denied",
    );

    await assert.rejects(
      () =>
        enforcePermission({
          ...common,
          actor: { type: "local-root", id: "local-root", permissions: ["*"] },
          sensitive: true,
        }),
      (error) => error instanceof ApiError && error.code === "confirmation_required",
    );

    const confirmed = await enforcePermission({
      ...common,
      actor: { type: "local-root", id: "local-root", permissions: ["*"] },
      sensitive: true,
      confirmed: true,
    });
    assert.equal(confirmed.ok, true);

    const systemAllowed = await enforcePermission({
      ...common,
      actor: { type: "system", id: "scheduler-runtime", permissions: ["service.action.run"] },
    });
    assert.equal(systemAllowed.ok, true);
    assert.equal(systemAllowed.actor.type, "system");

    await assert.rejects(
      () =>
        enforcePermission({
          ...common,
          actor: { type: "system", id: "health-monitor", permissions: [] },
        }),
      (error) => error instanceof ApiError && error.code === "permission_denied",
    );

    await assert.rejects(
      () => enforcePermission({ ...common, actor: null }),
      (error) => error instanceof ApiError && error.code === "actor_required",
    );

    const audit = await readAuditEvents({ workspaceRoot });
    const decisions = audit.events.filter((event) => event.action === "permission.decision");
    assert.equal(decisions.length >= 6, true);
    assert.equal(audit.rawMaterialReturned, false);
    assert.ok(decisions.some((event) => event.outcome === "success" && event.metadata.actorType === "local-root"));
    assert.ok(decisions.some((event) => event.outcome === "failure" && event.reason === "permission_not_granted"));
    assert.ok(decisions.some((event) => event.outcome === "failure" && event.reason === "confirmation_required"));
    assert.ok(decisions.some((event) => event.metadata.actorType === "system"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("HTTP action runs use the trusted request actor and ignore body actor spoofing", async () => {
  resetLifecycleState();
  const previousTrustProxy = process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS;
  const previousLocalToken = process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN;
  const previousZitadel = process.env.SERVICE_LASSO_ZITADEL_ENABLED;
  process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS = "true";
  process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN = SENTINEL_TOKEN;
  process.env.SERVICE_LASSO_ZITADEL_ENABLED = "true";

  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-permission-http-");
  const serviceRoot = await writeManifest(servicesRoot, "permission-service", {
    id: "permission-service",
    name: "Permission Service",
    description: "Trusted actor permission proof.",
    actions: {
      backup: {
        mode: "command",
        command: process.execPath,
        args: ["runtime/action-writer.mjs"],
        timeoutSeconds: 5,
      },
      dangerous: {
        mode: "command",
        command: process.execPath,
        args: ["runtime/action-writer.mjs"],
        requiresConfirmation: true,
        timeoutSeconds: 5,
      },
    },
  });
  await writeActionScript(serviceRoot);

  const apiServer = await startApiServer({
    port: 0,
    host: "0.0.0.0",
    servicesRoot,
    workspaceRoot,
  });

  try {
    const loopbackNoBodyActor = await postJson(
      `${apiServer.url}/api/services/permission-service/actions/backup/runs`,
      {},
    );
    assert.equal(loopbackNoBodyActor.status, 200);
    assert.equal(loopbackNoBodyActor.body.run.metadata.actor, "local-root");

    const spoofedSystem = await postJson(
      `${apiServer.url}/api/services/permission-service/actions/backup/runs`,
      { actor: { type: "system", id: "health-monitor", permissions: [] } },
    );
    assert.equal(spoofedSystem.status, 200);
    assert.equal(spoofedSystem.body.run.metadata.actor, "local-root");

    const missingConfirmation = await postJson(
      `${apiServer.url}/api/services/permission-service/actions/dangerous/runs`,
      { actor: { type: "local-root", id: "spoofed-root", permissions: ["*"] } },
    );
    assert.equal(missingConfirmation.status, 409);
    assert.equal(missingConfirmation.body.error, "confirmation_required");

    const confirmed = await postJson(
      `${apiServer.url}/api/services/permission-service/actions/dangerous/runs`,
      { confirm: true },
    );
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.run.metadata.actor, "local-root");

    const remoteToken = await postJson(
      `${apiServer.url}/api/services/permission-service/actions/backup/runs`,
      { actor: { type: "system", id: "health-monitor", permissions: [] } },
      {
        "x-forwarded-for": "192.168.1.21",
        "x-service-lasso-admin-token": SENTINEL_TOKEN,
      },
    );
    assert.equal(remoteToken.status, 200);
    assert.equal(remoteToken.body.run.metadata.actor, "local-admin-token");

    const remoteZitadel = await postJson(
      `${apiServer.url}/api/services/permission-service/actions/backup/runs`,
      { actor: { type: "local-root", id: "spoofed-root", permissions: ["*"] } },
      {
        "x-forwarded-for": "192.168.1.22",
        "x-service-lasso-internal-proxy": "serviceadmin",
        "x-service-lasso-zitadel-user-id": "usr_zitadel_operator",
      },
    );
    assert.equal(remoteZitadel.status, 403);
    assert.equal(remoteZitadel.body.error, "permission_denied");

    const remoteUnauth = await postJson(
      `${apiServer.url}/api/services/permission-service/actions/backup/runs`,
      { actor: { type: "local-root", id: "spoofed-root", permissions: ["*"] } },
      { "x-forwarded-for": "192.168.1.23" },
    );
    assert.equal(remoteUnauth.status, 401);
    assert.equal(remoteUnauth.body.error, "remote_auth_required");

    const audit = await readAuditEvents({ serviceRoots: [serviceRoot] });
    const decisions = audit.events.filter((event) => event.action === "permission.decision");
    assert.ok(decisions.some((event) => event.actor === "local-root" && event.outcome === "success"));
    assert.ok(decisions.some((event) => event.actor === "local-admin-token" && event.outcome === "success"));
    assert.ok(
      decisions.some(
        (event) =>
          event.actor === "usr_zitadel_operator" &&
          event.outcome === "failure" &&
          event.reason === "permission_not_granted",
      ),
    );
    assert.equal(JSON.stringify(audit.events).includes(SENTINEL_TOKEN), false);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
    if (previousTrustProxy === undefined) {
      delete process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS;
    } else {
      process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS = previousTrustProxy;
    }
    if (previousLocalToken === undefined) {
      delete process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN;
    } else {
      process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN = previousLocalToken;
    }
    if (previousZitadel === undefined) {
      delete process.env.SERVICE_LASSO_ZITADEL_ENABLED;
    } else {
      process.env.SERVICE_LASSO_ZITADEL_ENABLED = previousZitadel;
    }
  }
});

test("resolvePermissionActor still accepts explicit in-process system actors", () => {
  const systemActor = resolvePermissionActor({
    type: "system",
    id: "scheduler-runtime",
    permissions: ["service.action.run"],
  });
  assert.equal(systemActor.type, "system");
  assert.equal(systemActor.id, "scheduler-runtime");
  assert.deepEqual(systemActor.permissions, ["service.action.run"]);
});

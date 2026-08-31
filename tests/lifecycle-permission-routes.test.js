import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import path from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { readAuditEvents } from "../dist/runtime/audit/store.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

/**
 * Issues a JSON HTTP request against the in-process runtime API.
 *
 * @param {string} url
 * @param {{ method?: string, body?: object, headers?: Record<string, string> }} [options]
 */
async function requestJson(url, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: body === undefined
      ? headers
      : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

/**
 * Trusted Service Admin loopback-proxy headers for a ZITADEL role actor.
 *
 * @param {string} actorId
 * @param {string} role
 * @returns {Record<string, string>}
 */
const trustedHeaders = (actorId, role) => ({
  "x-service-lasso-internal-proxy": "serviceadmin",
  "x-service-lasso-proxy": "serviceadmin",
  "x-service-lasso-trusted-ingress": "serviceadmin-loopback",
  "x-service-lasso-client-address": "192.0.2.61",
  "x-service-lasso-zitadel-user-id": actorId,
  "x-service-lasso-zitadel-roles": role,
});

/**
 * Trusted proxy headers for a remote unauthenticated caller.
 * Used to prove typed deny without granting local-root.
 *
 * @returns {Record<string, string>}
 */
const unauthenticatedRemoteHeaders = () => ({
  "x-service-lasso-internal-proxy": "serviceadmin",
  "x-service-lasso-proxy": "serviceadmin",
  "x-service-lasso-trusted-ingress": "serviceadmin-loopback",
  "x-service-lasso-client-address": "192.0.2.61",
});

/**
 * Indexes dashboard actions by kind for packaged Admin UI decision proof.
 *
 * @param {{ kind: string }[]} actions
 * @returns {Map<string, object>}
 */
function dashboardActionsByKind(actions) {
  return new Map(actions.map((action) => [action.kind, action]));
}

/**
 * Returns the permission projection fields consumed by Service Admin controls.
 *
 * @param {object | undefined} action
 */
function packagedActionDecision(action) {
  assert.ok(action, "expected dashboard action for the current trusted actor");
  return {
    permission: action.permission,
    granted: action.granted,
    requiresConfirmation: action.requiresConfirmation,
    unavailableReason: action.unavailableReason,
  };
}

/**
 * Counts restart mutations recorded on the lifecycle state.
 *
 * @param {{ actionHistory?: string[] } | undefined} state
 */
function restartMutationCount(state) {
  return (state?.actionHistory ?? []).filter((action) => action === "restart").length;
}

async function startTestApiServer(options) {
  const server = createApiServer({ ...options, host: "0.0.0.0" });
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}`,
    async stop() {
      const closed = once(server, "close");
      server.close();
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await closed;
    },
  };
}

test("lifecycle routes project and enforce config and declared reload permissions from the trusted actor", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-lifecycle-permissions-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "reload-service", {
    actions: {
      reload: {
        mode: "command",
        command: process.execPath,
        args: ["runtime/reload-action.mjs"],
        requiredState: "running",
        requiresConfirmation: true,
        timeoutSeconds: 5,
      },
    },
  });
  await writeFile(
    path.join(serviceRoot, "runtime", "reload-action.mjs"),
    [
      'import { appendFile } from "node:fs/promises";',
      'await appendFile(new URL("./reload-proof.txt", import.meta.url), `${process.env.SERVICE_LASSO_RUN_SOURCE}:${process.env.SERVICE_LASSO_ACTION_ID}\\n`, "utf8");',
      "",
    ].join("\n"),
    "utf8",
  );

  const apiServer = await startTestApiServer({
    servicesRoot,
    workspaceRoot,
  });
  const route = `${apiServer.url}/api/services/reload-service`;
  const operatorHeaders = trustedHeaders("usr_operator", "operator");
  const viewerHeaders = trustedHeaders("usr_viewer", "viewer");

  try {
    const localDashboard = await requestJson(`${apiServer.url}/api/dashboard/services/reload-service`);
    assert.equal(localDashboard.status, 200);
    const localActions = new Map(localDashboard.body.service.actions.map((action) => [action.kind, action]));
    assert.deepEqual(
      {
        permission: localActions.get("config").permission,
        granted: localActions.get("config").granted,
        requiresConfirmation: localActions.get("config").requiresConfirmation,
      },
      { permission: "service:configure", granted: true, requiresConfirmation: false },
    );
    assert.deepEqual(
      {
        permission: localActions.get("reload").permission,
        granted: localActions.get("reload").granted,
        requiresConfirmation: localActions.get("reload").requiresConfirmation,
      },
      { permission: "service:reload", granted: true, requiresConfirmation: true },
    );

    for (const action of ["install", "config", "start"]) {
      const result = await requestJson(`${route}/${action}`, { method: "POST", body: {} });
      assert.equal(result.status, 200, `${action} should succeed for local-root`);
    }

    const missingConfirmation = await requestJson(`${route}/reload`, { method: "POST", body: {} });
    assert.equal(missingConfirmation.status, 409);
    assert.equal(missingConfirmation.body.error, "confirmation_required");

    const spoofedActor = await requestJson(`${route}/reload`, {
      method: "POST",
      body: { confirm: true, actor: { type: "local-root", id: "spoofed-root", permissions: ["*"] } },
    });
    assert.equal(spoofedActor.status, 400);
    assert.equal(spoofedActor.body.error, "invalid_body");

    const localReload = await requestJson(`${route}/reload`, { method: "POST", body: { confirm: true } });
    assert.equal(localReload.status, 200);
    assert.equal(localReload.body.action, "reload");
    assert.equal(localReload.body.ok, true);
    assert.equal(localReload.body.state.lastAction, "reload");
    assert.equal(localReload.body.state.actionHistory.at(-1), "reload");

    const operatorDashboard = await requestJson(`${apiServer.url}/api/dashboard/services/reload-service`, {
      headers: operatorHeaders,
    });
    assert.equal(operatorDashboard.status, 200);
    const operatorActions = new Map(operatorDashboard.body.service.actions.map((action) => [action.kind, action]));
    assert.equal(operatorActions.get("reload").granted, true);
    assert.equal(operatorActions.get("config").granted, false);

    const operatorReload = await requestJson(`${route}/reload`, {
      method: "POST",
      body: { confirm: true },
      headers: operatorHeaders,
    });
    assert.equal(operatorReload.status, 200);
    assert.equal(operatorReload.body.action, "reload");

    const viewerDashboard = await requestJson(`${apiServer.url}/api/dashboard/services/reload-service`, {
      headers: viewerHeaders,
    });
    assert.equal(viewerDashboard.status, 200);
    const viewerActions = new Map(viewerDashboard.body.service.actions.map((action) => [action.kind, action]));
    assert.equal(viewerActions.get("reload").granted, false);
    assert.equal(viewerActions.get("config").granted, false);

    const viewerReload = await requestJson(`${route}/reload`, {
      method: "POST",
      body: { confirm: true },
      headers: viewerHeaders,
    });
    assert.equal(viewerReload.status, 403);
    assert.equal(viewerReload.body.error, "permission_denied");

    const runs = await requestJson(`${route}/actions/reload/runs`);
    assert.equal(runs.status, 200);
    assert.equal(runs.body.runs.length, 2);
    assert.deepEqual(runs.body.runs.map((run) => run.metadata.actor), ["local-root", "usr_operator"]);
    assert.equal(await readFile(path.join(serviceRoot, "runtime", "reload-proof.txt"), "utf8"), "manual:reload\nmanual:reload\n");

    const audit = await readAuditEvents({ serviceRoots: [serviceRoot], query: { limit: 100 } });
    const decisions = audit.events.filter((event) => event.action === "permission.decision");
    assert.ok(decisions.some((event) => event.actor === "local-root" && event.metadata.permission === "service:reload" && event.outcome === "success"));
    assert.ok(decisions.some((event) => event.actor === "local-root" && event.metadata.permission === "service:reload" && event.reason === "confirmation_required"));
    assert.ok(decisions.some((event) => event.actor === "usr_operator" && event.metadata.permission === "service:reload" && event.outcome === "success"));
    assert.ok(decisions.some((event) => event.actor === "usr_viewer" && event.metadata.permission === "service:reload" && event.reason === "permission_not_granted"));
    assert.equal(JSON.stringify(audit.events).includes("spoofed-root"), false);
  } finally {
    await requestJson(`${route}/stop`, { method: "POST", body: { confirm: true } }).catch(() => undefined);
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("packaged Admin contract: trusted confirmed one-shot restart and typed deny", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-lifecycle-restart-decisions-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "restart-service");
  await writeExecutableFixtureService(servicesRoot, "provider-utility", { role: "provider" });

  const apiServer = await startTestApiServer({
    servicesRoot,
    workspaceRoot,
  });
  const route = `${apiServer.url}/api/services/restart-service`;
  const viewerHeaders = trustedHeaders("usr_viewer", "viewer");

  try {
    const localDashboard = await requestJson(`${apiServer.url}/api/dashboard/services/restart-service`);
    assert.equal(localDashboard.status, 200);
    const localActions = dashboardActionsByKind(localDashboard.body.service.actions);
    assert.deepEqual(
      packagedActionDecision(localActions.get("install")),
      { permission: "service:install", granted: true, requiresConfirmation: false, unavailableReason: null },
    );
    assert.deepEqual(
      packagedActionDecision(localActions.get("config")),
      { permission: "service:configure", granted: true, requiresConfirmation: false, unavailableReason: null },
    );
    assert.deepEqual(
      packagedActionDecision(localActions.get("start")),
      { permission: "service:start", granted: true, requiresConfirmation: false, unavailableReason: null },
    );
    assert.deepEqual(
      packagedActionDecision(localActions.get("stop")),
      { permission: "service:stop", granted: true, requiresConfirmation: true, unavailableReason: null },
    );
    assert.deepEqual(
      packagedActionDecision(localActions.get("restart")),
      { permission: "service:restart", granted: true, requiresConfirmation: true, unavailableReason: null },
    );
    assert.deepEqual(
      packagedActionDecision(localActions.get("reload")),
      { permission: "service:reload", granted: true, requiresConfirmation: true, unavailableReason: null },
    );

    const providerDashboard = await requestJson(`${apiServer.url}/api/dashboard/services/provider-utility`);
    assert.equal(providerDashboard.status, 200);
    const providerKinds = providerDashboard.body.service.actions.map((action) => action.kind);
    assert.equal(providerKinds.includes("start"), false);
    assert.equal(providerKinds.includes("stop"), false);
    assert.equal(providerKinds.includes("restart"), false);
    assert.equal(providerKinds.includes("reload"), false);
    assert.equal(providerKinds.includes("install"), true);
    assert.equal(providerKinds.includes("config"), true);

    for (const action of ["install", "config", "start"]) {
      const result = await requestJson(`${route}/${action}`, { method: "POST", body: {} });
      assert.equal(result.status, 200, `${action} should succeed for local-root`);
    }

    const started = await requestJson(`${apiServer.url}/api/services/restart-service`);
    assert.equal(started.status, 200);
    assert.equal(started.body.service.lifecycle.running, true);
    const startedPid = started.body.service.lifecycle.runtime.pid;
    assert.equal(typeof startedPid, "number");
    assert.equal(restartMutationCount(started.body.service.lifecycle), 0);

    const startedDashboard = await requestJson(`${apiServer.url}/api/dashboard/services/restart-service`);
    assert.equal(startedDashboard.status, 200);
    assert.equal(startedDashboard.body.service.status, "running");
    assert.equal(startedDashboard.body.service.runtimeHealth.pid, startedPid);

    const missingConfirmation = await requestJson(`${route}/restart`, { method: "POST", body: {} });
    assert.equal(missingConfirmation.status, 409);
    assert.equal(missingConfirmation.body.error, "confirmation_required");

    const spoofedActor = await requestJson(`${route}/restart`, {
      method: "POST",
      body: { confirm: true, actor: { type: "local-root", id: "spoofed-root", permissions: ["*"] } },
    });
    assert.equal(spoofedActor.status, 400);
    assert.equal(spoofedActor.body.error, "invalid_body");

    const viewerDashboard = await requestJson(`${apiServer.url}/api/dashboard/services/restart-service`, {
      headers: viewerHeaders,
    });
    assert.equal(viewerDashboard.status, 200);
    const viewerActions = dashboardActionsByKind(viewerDashboard.body.service.actions);
    assert.deepEqual(
      packagedActionDecision(viewerActions.get("restart")),
      {
        permission: "service:restart",
        granted: false,
        requiresConfirmation: true,
        unavailableReason: "permission_not_granted",
      },
    );

    const viewerRestart = await requestJson(`${route}/restart`, {
      method: "POST",
      body: { confirm: true },
      headers: viewerHeaders,
    });
    assert.equal(viewerRestart.status, 403);
    assert.equal(viewerRestart.body.error, "permission_denied");

    const anonymousRestart = await requestJson(`${route}/restart`, {
      method: "POST",
      body: { confirm: true, actor: { type: "local-root", id: "spoofed-root", permissions: ["*"] } },
      headers: unauthenticatedRemoteHeaders(),
    });
    assert.equal(anonymousRestart.status, 401);
    assert.equal(anonymousRestart.body.error, "remote_auth_required");

    const deniedState = await requestJson(`${apiServer.url}/api/services/restart-service`);
    assert.equal(deniedState.status, 200);
    assert.equal(deniedState.body.service.lifecycle.running, true);
    assert.equal(deniedState.body.service.lifecycle.runtime.pid, startedPid);
    assert.equal(restartMutationCount(deniedState.body.service.lifecycle), 0);

    const confirmedRestart = await requestJson(`${route}/restart`, { method: "POST", body: { confirm: true } });
    assert.equal(confirmedRestart.status, 200);
    assert.equal(confirmedRestart.body.action, "restart");
    assert.equal(confirmedRestart.body.ok, true);
    assert.equal(confirmedRestart.body.state.running, true);
    assert.equal(confirmedRestart.body.state.lastAction, "restart");
    assert.equal(restartMutationCount(confirmedRestart.body.state), 1);
    assert.equal(typeof confirmedRestart.body.state.runtime.pid, "number");
    assert.notEqual(confirmedRestart.body.state.runtime.pid, startedPid);

    const refreshed = await requestJson(`${apiServer.url}/api/dashboard/services/restart-service`);
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.service.status, "running");
    assert.equal(refreshed.body.service.runtimeHealth.pid, confirmedRestart.body.state.runtime.pid);
    const refreshedRestart = packagedActionDecision(dashboardActionsByKind(refreshed.body.service.actions).get("restart"));
    assert.equal(refreshedRestart.granted, true);
    assert.equal(refreshedRestart.requiresConfirmation, true);

    const audit = await readAuditEvents({ serviceRoots: [serviceRoot], query: { limit: 100 } });
    const decisions = audit.events.filter((event) => event.action === "permission.decision");
    const restartResults = audit.events.filter((event) => event.action === "service.lifecycle.restart");
    assert.ok(decisions.some((event) => event.actor === "local-root" && event.metadata.permission === "service:restart" && event.reason === "confirmation_required"));
    assert.ok(decisions.some((event) => event.actor === "usr_viewer" && event.metadata.permission === "service:restart" && event.reason === "permission_not_granted"));
    assert.ok(decisions.some((event) => event.actor === "local-root" && event.metadata.permission === "service:restart" && event.outcome === "success"));
    assert.equal(restartResults.filter((event) => event.outcome === "success").length, 1);
    assert.equal(JSON.stringify(audit.events).includes("spoofed-root"), false);
  } finally {
    await requestJson(`${route}/stop`, { method: "POST", body: { confirm: true } }).catch(() => undefined);
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});


import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import path from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { readAuditEvents } from "../dist/runtime/audit/store.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

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

const trustedHeaders = (actorId, role) => ({
  "x-service-lasso-internal-proxy": "serviceadmin",
  "x-service-lasso-proxy": "serviceadmin",
  "x-service-lasso-trusted-ingress": "serviceadmin-loopback",
  "x-service-lasso-client-address": "192.0.2.61",
  "x-service-lasso-zitadel-user-id": actorId,
  "x-service-lasso-zitadel-roles": role,
});

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

import test from "node:test";
import assert from "node:assert/strict";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { readAuditEvents } from "../dist/runtime/audit/store.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";
import { rm } from "node:fs/promises";

const SENTINEL_TOKEN = "test-local-admin-token";

/**
 * Posts JSON to a runtime API URL with optional headers.
 *
 * @param {string} url
 * @param {object} [body]
 * @param {Record<string, string>} [headers]
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

test("leftover HTTP durable mutations enforce allow, deny, confirmation, and audit identity", async () => {
  resetLifecycleState();
  const previousTrustProxy = process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS;
  const previousLocalToken = process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN;
  const previousZitadel = process.env.SERVICE_LASSO_ZITADEL_ENABLED;
  process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS = "1";
  process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN = SENTINEL_TOKEN;
  process.env.SERVICE_LASSO_ZITADEL_ENABLED = "true";

  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot(
    "service-lasso-http-durable-permissions-",
  );
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "durable-permission-service", {
    healthcheck: { type: "process" },
  });

  const apiServer = await startApiServer({
    port: 0,
    host: "0.0.0.0",
    servicesRoot,
    workspaceRoot,
  });

  try {
    const localDoctor = await postJson(
      `${apiServer.url}/api/services/durable-permission-service/recovery/doctor`,
    );
    assert.equal(localDoctor.status, 200);
    assert.equal(typeof localDoctor.body.doctor.ok, "boolean");

    const localCheck = await postJson(`${apiServer.url}/api/updates/check`, {
      serviceId: "durable-permission-service",
    });
    assert.equal(localCheck.status, 200);

    const missingInstallConfirm = await postJson(
      `${apiServer.url}/api/services/durable-permission-service/update/install`,
      {},
    );
    assert.equal(missingInstallConfirm.status, 409);
    assert.equal(missingInstallConfirm.body.error, "confirmation_required");

    const spoofedInstall = await postJson(
      `${apiServer.url}/api/services/durable-permission-service/update/install`,
      { confirm: true, actor: { type: "local-root", id: "spoofed-root", permissions: ["*"] } },
    );
    assert.equal(spoofedInstall.status, 400);
    assert.equal(spoofedInstall.body.error, "invalid_body");

    const missingStopAllConfirm = await postJson(`${apiServer.url}/api/runtime/actions/stopAll`);
    assert.equal(missingStopAllConfirm.status, 409);
    assert.equal(missingStopAllConfirm.body.error, "confirmation_required");

    const spoofedStopAll = await postJson(`${apiServer.url}/api/runtime/actions/stopAll`, {
      confirm: true,
      actor: { type: "local-root", id: "spoofed-root", permissions: ["*"] },
    });
    assert.equal(spoofedStopAll.status, 400);
    assert.equal(spoofedStopAll.body.error, "invalid_body");

    const confirmedStopAll = await postJson(`${apiServer.url}/api/runtime/actions/stopAll`, {
      confirm: true,
    });
    assert.equal(confirmedStopAll.status, 200);

    const viewerDoctor = await postJson(
      `${apiServer.url}/api/services/durable-permission-service/recovery/doctor`,
      {},
      trustedHeaders("usr_viewer", "viewer"),
    );
    assert.equal(viewerDoctor.status, 403);
    assert.equal(viewerDoctor.body.error, "permission_denied");

    const viewerCheck = await postJson(
      `${apiServer.url}/api/updates/check`,
      { serviceId: "durable-permission-service" },
      trustedHeaders("usr_viewer", "viewer"),
    );
    assert.equal(viewerCheck.status, 403);
    assert.equal(viewerCheck.body.error, "permission_denied");

    const operatorCheck = await postJson(
      `${apiServer.url}/api/updates/check`,
      { serviceId: "durable-permission-service" },
      trustedHeaders("usr_operator", "operator"),
    );
    assert.equal(operatorCheck.status, 403);
    assert.equal(operatorCheck.body.error, "permission_denied");

    const remoteTokenDoctor = await postJson(
      `${apiServer.url}/api/services/durable-permission-service/recovery/doctor`,
      {},
      {
        "x-forwarded-for": "192.0.2.80",
        "x-service-lasso-admin-token": SENTINEL_TOKEN,
      },
    );
    assert.equal(remoteTokenDoctor.status, 200);

    const remoteUnauth = await postJson(
      `${apiServer.url}/api/services/durable-permission-service/recovery/doctor`,
      {},
      { "x-forwarded-for": "192.0.2.81" },
    );
    assert.equal(remoteUnauth.status, 401);
    assert.equal(remoteUnauth.body.error, "remote_auth_required");

    const audit = await readAuditEvents({
      workspaceRoot,
      serviceRoots: [serviceRoot],
    });
    const decisions = audit.events.filter((event) => event.action === "permission.decision");
    assert.ok(decisions.some((event) => event.actor === "local-root" && event.outcome === "success"));
    assert.ok(
      decisions.some(
        (event) =>
          event.actor === "local-root" &&
          event.outcome === "failure" &&
          event.reason === "confirmation_required",
      ),
    );
    assert.ok(
      decisions.some(
        (event) =>
          event.actor === "usr_viewer" &&
          event.outcome === "failure" &&
          event.reason === "permission_not_granted",
      ),
    );
    assert.ok(
      decisions.some(
        (event) =>
          event.actor === "usr_operator" &&
          event.outcome === "failure" &&
          event.reason === "permission_not_granted",
      ),
    );
    assert.ok(decisions.some((event) => event.actor === "local-admin-token" && event.outcome === "success"));

    const leftoverActions = new Set([
      "service.update.check",
      "service.setup.run",
      "service.recovery.doctor",
      "service.update.download",
      "service.update.install",
      "runtime.stopAll",
    ]);
    const leftoverEvents = audit.events.filter((event) => leftoverActions.has(event.action));
    assert.ok(leftoverEvents.length > 0);
    assert.equal(leftoverEvents.some((event) => event.actor === "unknown"), false);
    assert.equal(JSON.stringify(audit.events).includes(SENTINEL_TOKEN), false);
    assert.equal(JSON.stringify(audit.events).includes("spoofed-root"), false);
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

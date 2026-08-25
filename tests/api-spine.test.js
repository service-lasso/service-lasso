import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { startRuntimeApp } from "../dist/runtime/app.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { ensureLocalVaultMarker } from "../dist/runtime/setup/first-run.js";
import { writeLocalOperatorAuthState } from "../dist/runtime/auth/local-auth-store.js";
import {
  clearPersistedFixtureState,
  ensureTestSecretsBrokerReady,
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

async function getJsonWithHeaders(url, headers) {
  const response = await fetch(url, { headers });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function putJson(url, body) {
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function readRuntimeAuditActions(workspaceRoot) {
  const auditRoot = path.join(workspaceRoot, ".service-lasso", "audit", "runtime");
  const entries = await readdir(auditRoot).catch(() => []);
  const lines = (
    await Promise.all(entries.map(async (entry) => readFile(path.join(auditRoot, entry), "utf8")))
  )
    .join("\n")
    .split(/\r?\n/u)
    .filter(Boolean);
  return lines.map((line) => JSON.parse(line).action);
}

async function waitFor(readinessCheck, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await readinessCheck();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

test("GET /api/health returns core API health", async () => {
  const apiServer = await startApiServer({ port: 0, version: "test-version" });

  try {
    const result = await getJson(`${apiServer.url}/api/health`);

    assert.equal(result.status, 200);
    assert.equal(result.body.service, "service-lasso");
    assert.equal(result.body.status, "ok");
    assert.equal(result.body.mode, "development");
    assert.equal(result.body.api.status, "up");
    assert.equal(result.body.api.version, "test-version");
  } finally {
    await apiServer.stop();
  }
});

test("runtime API binds to loopback by default", async () => {
  const previousHost = process.env.SERVICE_LASSO_HOST;
  delete process.env.SERVICE_LASSO_HOST;

  const apiServer = await startApiServer({ port: 0, version: "lan-bind-test" });

  try {
    const address = apiServer.server.address();

    assert.ok(address && typeof address !== "string");
    assert.equal(address.address, "127.0.0.1");
    assert.equal(apiServer.url, `http://127.0.0.1:${apiServer.port}`);
  } finally {
    await apiServer.stop();
    if (previousHost === undefined) {
      delete process.env.SERVICE_LASSO_HOST;
    } else {
      process.env.SERVICE_LASSO_HOST = previousHost;
    }
  }
});

test("GET /api/setup/status reports first-run setup required for a fresh workspace", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-setup-status-"));
  const previousSetupToken = process.env.SERVICE_LASSO_SETUP_TOKEN;
  delete process.env.SERVICE_LASSO_SETUP_TOKEN;
  const apiServer = await startApiServer({
    port: 0,
    host: "0.0.0.0",
    workspaceRoot: tempDir,
    version: "setup-status-test",
  });

  try {
    const result = await getJson(`${apiServer.url}/api/setup/status`);

    assert.equal(result.status, 200);
    assert.equal(result.body.setup.contractVersion, "service-lasso.setup-status.v1");
    assert.equal(result.body.setup.state, "setup_required");
    assert.equal(result.body.setup.setupMode, true);
    assert.equal(result.body.setup.vault.required, true);
    assert.equal(result.body.setup.vault.ready, false);
    assert.equal(Object.hasOwn(result.body.setup.vault, "path"), false);
    assert.doesNotMatch(JSON.stringify(result.body), /store\.json|master-key|broker-token|signing-key/i);
    assert.equal(result.body.setup.operator.identitySource, "vault");
    assert.equal(result.body.setup.trustBoundary.bindHost, "0.0.0.0");
    assert.equal(result.body.setup.trustBoundary.localOnly, false);
    assert.equal(result.body.setup.trustBoundary.localhostBootstrapAllowed, false);
    assert.equal(result.body.setup.trustBoundary.remoteBootstrapAllowed, false);
    assert.equal(result.body.setup.trustBoundary.setupTokenConfigured, false);
    assert.deepEqual(result.body.setup.trustBoundary.blockers, ["setup_token_required_for_remote_bind"]);
    assert.equal(result.body.setup.auth.contractVersion, "service-lasso.auth-status.v1");
    assert.equal(result.body.setup.auth.actor.kind, "local-root");
  } finally {
    await apiServer.stop();
    await rm(tempDir, { recursive: true, force: true });
    if (previousSetupToken === undefined) {
      delete process.env.SERVICE_LASSO_SETUP_TOKEN;
    } else {
      process.env.SERVICE_LASSO_SETUP_TOKEN = previousSetupToken;
    }
  }
});

test("GET /api/setup/status rejects a legacy vault marker without protected Broker credentials", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-setup-ready-"));
  await ensureLocalVaultMarker(tempDir);
  const apiServer = await startApiServer({
    port: 0,
    host: "127.0.0.1",
    workspaceRoot: tempDir,
    version: "setup-ready-test",
  });

  try {
    const result = await getJson(`${apiServer.url}/api/setup/status`);

    assert.equal(result.status, 200);
    assert.equal(result.body.setup.state, "setup_required");
    assert.equal(result.body.setup.setupMode, true);
    assert.equal(result.body.setup.vault.ready, false);
    assert.equal(result.body.setup.trustBoundary.localOnly, true);
    assert.deepEqual(result.body.setup.trustBoundary.blockers, []);
  } finally {
    await apiServer.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("POST /api/setup/bootstrap fails closed until Secrets Broker is installed and configured", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-setup-bootstrap-"));
  const apiServer = await startApiServer({
    port: 0,
    host: "127.0.0.1",
    workspaceRoot: tempDir,
    version: "setup-bootstrap-test",
  });

  try {
    const result = await postJson(`${apiServer.url}/api/setup/bootstrap`, { actor: "local-operator" });

    assert.equal(result.status, 409);
    assert.equal(result.body.error, "secrets_broker_not_prepared");
    assert.doesNotMatch(JSON.stringify(result.body), /store\.json|master-key|broker-token|signing-key/i);
    assert.deepEqual(await readRuntimeAuditActions(tempDir), ["setup.bootstrap.started"]);
  } finally {
    await apiServer.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("POST /api/setup/bootstrap rejects public bind without a setup token", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-setup-blocked-"));
  const previousSetupToken = process.env.SERVICE_LASSO_SETUP_TOKEN;
  delete process.env.SERVICE_LASSO_SETUP_TOKEN;
  const apiServer = await startApiServer({
    port: 0,
    host: "0.0.0.0",
    workspaceRoot: tempDir,
    version: "setup-blocked-test",
  });

  try {
    const result = await postJson(`${apiServer.url}/api/setup/bootstrap`, { actor: "local-operator" });

    assert.equal(result.status, 403);
    assert.equal(result.body.error, "setup_bootstrap_forbidden");
    assert.deepEqual(await readRuntimeAuditActions(tempDir), ["setup.bootstrap.denied"]);
  } finally {
    await apiServer.stop();
    await rm(tempDir, { recursive: true, force: true });
    if (previousSetupToken === undefined) {
      delete process.env.SERVICE_LASSO_SETUP_TOKEN;
    } else {
      process.env.SERVICE_LASSO_SETUP_TOKEN = previousSetupToken;
    }
  }
});

test("GET /api/runtime/security resolves localhost requests as local-root", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-auth-local-"));
  await ensureTestSecretsBrokerReady(tempDir);
  const apiServer = await startApiServer({
    port: 0,
    host: "127.0.0.1",
    workspaceRoot: tempDir,
    version: "auth-local-test",
  });

  try {
    const result = await getJson(`${apiServer.url}/api/runtime/security`);

    assert.equal(result.status, 200);
    assert.equal(result.body.auth.contractVersion, "service-lasso.auth-status.v1");
    assert.equal(result.body.auth.request.local, true);
    assert.equal(result.body.auth.policy.remoteAuthRequired, false);
    assert.equal(result.body.auth.actor.authenticated, true);
    assert.equal(result.body.auth.actor.kind, "local-root");
    assert.deepEqual(result.body.auth.blockers, []);
    assert.equal(typeof result.body.auth.policy.firstRunPending, "boolean");
    assert.equal(typeof result.body.auth.policy.credentialsAcknowledged, "boolean");
    assert.equal("token" in result.body.auth.policy, false);
    assert.equal("password" in result.body.auth.policy, false);
    assert.equal("firstRun" in result.body, false);
  } finally {
    await apiServer.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("GET /api/security wraps auth status for Service Admin", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-admin-security-alias-"));
  await ensureLocalVaultMarker(tempDir);
  const apiServer = await startApiServer({
    port: 0,
    host: "127.0.0.1",
    workspaceRoot: tempDir,
    version: "admin-security-alias",
  });

  try {
    const result = await getJson(`${apiServer.url}/api/security`);

    assert.equal(result.status, 200);
    assert.equal(result.body.security.auth.contractVersion, "service-lasso.auth-status.v1");
    assert.equal(result.body.security.auth.actor.kind, "local-root");
    assert.equal(result.body.security.auth.request.local, true);
  } finally {
    await apiServer.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("loopback first-run reveal and acknowledge stay off the security contract", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-first-run-api-"));
  await ensureLocalVaultMarker(tempDir);
  await writeLocalOperatorAuthState(tempDir, {
    token: "test-local-admin-token",
    password: "test-local-operator-password",
    credentialsAcknowledged: false,
  });
  const apiServer = await startApiServer({
    port: 0,
    host: "127.0.0.1",
    workspaceRoot: tempDir,
    version: "auth-first-run-test",
  });

  try {
    const security = await getJson(`${apiServer.url}/api/runtime/security`);
    assert.equal(security.status, 200);
    assert.equal(security.body.auth.policy.firstRunPending, true);
    assert.equal(security.body.auth.policy.credentialsAcknowledged, false);
    assert.equal("token" in security.body.auth.policy, false);
    assert.equal("password" in security.body.auth.policy, false);
    assert.equal(JSON.stringify(security.body).includes("test-local-admin-token"), false);
    assert.equal(JSON.stringify(security.body).includes("test-local-operator-password"), false);

    const firstRun = await getJson(`${apiServer.url}/api/runtime/auth/first-run`);
    assert.equal(firstRun.status, 200);
    assert.equal(firstRun.body.firstRun.pending, true);
    assert.equal(firstRun.body.firstRun.username, "local-operator");
    assert.equal(firstRun.body.firstRun.token, "test-local-admin-token");
    assert.equal(firstRun.body.firstRun.password, "test-local-operator-password");
    assert.equal(firstRun.body.firstRun.vaultPath, "runtime/local-operator");
    assert.deepEqual(firstRun.body.firstRun.vaultFieldNames, [
      "LOCAL_OPERATOR_USERNAME",
      "LOCAL_ADMIN_TOKEN",
      "LOCAL_OPERATOR_PASSWORD",
    ]);

    const remoteDenied = await getJsonWithHeaders(`${apiServer.url}/api/runtime/auth/first-run`, {
      "x-service-lasso-internal-proxy": "serviceadmin",
      "x-service-lasso-client-address": "10.0.0.40",
    });
    assert.equal(remoteDenied.status, 403);
    assert.equal(remoteDenied.body.error, "first_run_loopback_only");
    assert.equal(JSON.stringify(remoteDenied.body).includes("test-local-admin-token"), false);

    const remoteAck = await fetch(`${apiServer.url}/api/runtime/auth/first-run/acknowledge`, {
      method: "POST",
      headers: {
        "x-service-lasso-internal-proxy": "serviceadmin",
        "x-service-lasso-client-address": "10.0.0.40",
      },
    });
    const remoteAckBody = await remoteAck.json();
    assert.equal(remoteAck.status, 403);
    assert.equal(JSON.stringify(remoteAckBody).includes("test-local-operator-password"), false);

    const ack = await fetch(`${apiServer.url}/api/runtime/auth/first-run/acknowledge`, {
      method: "POST",
    });
    const ackBody = await ack.json();
    assert.equal(ack.status, 200);
    assert.equal(ackBody.firstRun.pending, false);
    assert.equal(ackBody.firstRun.credentialsAcknowledged, true);
    assert.equal("token" in ackBody.firstRun, false);
    assert.equal("password" in ackBody.firstRun, false);

    const afterAck = await getJson(`${apiServer.url}/api/runtime/auth/first-run`);
    assert.equal(afterAck.status, 404);
    assert.equal(afterAck.body.error, "first_run_not_pending");

    const securityAfter = await getJson(`${apiServer.url}/api/runtime/security`);
    assert.equal(securityAfter.body.auth.policy.firstRunPending, false);
    assert.equal(securityAfter.body.auth.policy.credentialsAcknowledged, true);
    assert.equal(JSON.stringify(securityAfter.body).includes("test-local-admin-token"), false);
  } finally {
    await apiServer.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("loopback first-run GET is 503 without secrets while vault ingest is pending", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-first-run-vault-pending-"));
  await ensureLocalVaultMarker(tempDir);
  await writeLocalOperatorAuthState(tempDir, {
    token: "test-local-admin-token",
    password: "test-local-operator-password",
    credentialsAcknowledged: false,
    persistPlaintextEnvelope: false,
  });
  const apiServer = await startApiServer({
    port: 0,
    host: "127.0.0.1",
    workspaceRoot: tempDir,
    version: "auth-first-run-vault-pending",
  });

  try {
    const security = await getJson(`${apiServer.url}/api/runtime/security`);
    assert.equal(security.status, 200);
    assert.equal(security.body.auth.policy.firstRunPending, true);
    assert.equal(JSON.stringify(security.body).includes("test-local-admin-token"), false);
    assert.equal(JSON.stringify(security.body).includes("test-local-operator-password"), false);

    const firstRun = await getJson(`${apiServer.url}/api/runtime/auth/first-run`);
    assert.equal(firstRun.status, 503);
    assert.equal(firstRun.body.error, "first_run_vault_not_ready");
    assert.equal(JSON.stringify(firstRun.body).includes("test-local-admin-token"), false);
    assert.equal(JSON.stringify(firstRun.body).includes("test-local-operator-password"), false);
  } finally {
    await apiServer.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("remote API requests cannot inherit local-root trust without auth", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-auth-remote-denied-"));
  await ensureTestSecretsBrokerReady(tempDir);
  const previousTrustProxy = process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS;
  const previousLocalToken = process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN;
  const previousZitadel = process.env.SERVICE_LASSO_ZITADEL_ENABLED;
  process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS = "true";
  delete process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN;
  delete process.env.SERVICE_LASSO_ZITADEL_ENABLED;
  const apiServer = await startApiServer({
    port: 0,
    host: "0.0.0.0",
    workspaceRoot: tempDir,
    version: "auth-remote-denied-test",
  });

  try {
    const result = await getJsonWithHeaders(`${apiServer.url}/api/services`, {
      "x-forwarded-for": "192.168.1.20",
    });

    assert.equal(result.status, 401);
    assert.equal(result.body.error, "remote_auth_required");
    assert.deepEqual(await readRuntimeAuditActions(tempDir), ["auth.remote.denied"]);
  } finally {
    await apiServer.stop();
    await rm(tempDir, { recursive: true, force: true });
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

test("loopback Service Admin proxy normalizes remote Zitadel identity", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-auth-admin-proxy-"));
  await ensureTestSecretsBrokerReady(tempDir);
  const previousTrustProxy = process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS;
  const previousZitadel = process.env.SERVICE_LASSO_ZITADEL_ENABLED;
  delete process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS;
  delete process.env.SERVICE_LASSO_ZITADEL_ENABLED;
  const apiServer = await startApiServer({
    port: 0,
    host: "0.0.0.0",
    workspaceRoot: tempDir,
    version: "auth-admin-proxy-test",
  });

  try {
    const authenticated = await getJsonWithHeaders(`${apiServer.url}/api/runtime/security`, {
      "x-service-lasso-internal-proxy": "serviceadmin",
      "x-service-lasso-proxy": "serviceadmin",
      "x-service-lasso-trusted-ingress": "serviceadmin-loopback",
      "x-service-lasso-client-address": "192.0.2.40",
      "x-service-lasso-zitadel-user-id": "usr_trusted_operator",
    });
    assert.equal(authenticated.status, 200);
    assert.equal(authenticated.body.auth.request.clientAddress, "192.0.2.40");
    assert.equal(authenticated.body.auth.request.local, false);
    assert.equal(authenticated.body.auth.actor.kind, "zitadel");
    assert.equal(authenticated.body.auth.actor.actorId, "usr_trusted_operator");
    assert.equal(authenticated.body.auth.policy.trustProxyHeaders, true);
  } finally {
    await apiServer.stop();
    await rm(tempDir, { recursive: true, force: true });
    if (previousTrustProxy === undefined) delete process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS;
    else process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS = previousTrustProxy;
    if (previousZitadel === undefined) delete process.env.SERVICE_LASSO_ZITADEL_ENABLED;
    else process.env.SERVICE_LASSO_ZITADEL_ENABLED = previousZitadel;
  }
});

test("remote API requests can authenticate with an explicit local admin token", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-auth-local-token-"));
  await ensureTestSecretsBrokerReady(tempDir);
  const previousTrustProxy = process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS;
  const previousLocalToken = process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN;
  process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS = "true";
  process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN = "test-local-admin-token";
  const apiServer = await startApiServer({
    port: 0,
    host: "0.0.0.0",
    workspaceRoot: tempDir,
    version: "auth-local-token-test",
  });

  try {
    const result = await getJsonWithHeaders(`${apiServer.url}/api/runtime/security`, {
      "x-forwarded-for": "192.168.1.21",
      "x-service-lasso-admin-token": "test-local-admin-token",
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.auth.request.local, false);
    assert.equal(result.body.auth.actor.authenticated, true);
    assert.equal(result.body.auth.actor.kind, "local-token");
    assert.equal(result.body.auth.policy.localTokenConfigured, true);
    assert.deepEqual(result.body.auth.blockers, []);

    const services = await getJsonWithHeaders(`${apiServer.url}/api/services`, {
      "x-forwarded-for": "192.168.1.21",
      "x-service-lasso-admin-token": "test-local-admin-token",
    });
    assert.equal(services.status, 200);
    assert.equal(Array.isArray(services.body.services), true);
  } finally {
    await apiServer.stop();
    await rm(tempDir, { recursive: true, force: true });
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
  }
});

test("Admin proxy original-client header treats LAN as remote without TRUST_PROXY_HEADERS", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-auth-forwarded-lan-"));
  await ensureLocalVaultMarker(tempDir);
  const previousTrustProxy = process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS;
  const previousLocalToken = process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN;
  delete process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS;
  process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN = "test-local-admin-token";
  const apiServer = await startApiServer({
    port: 0,
    host: "0.0.0.0",
    workspaceRoot: tempDir,
    version: "auth-forwarded-lan-test",
  });

  try {
    const denied = await getJsonWithHeaders(`${apiServer.url}/api/runtime/security`, {
      "x-service-lasso-internal-proxy": "serviceadmin",
      "x-service-lasso-client-address": "192.168.1.40",
    });
    assert.equal(denied.status, 200);
    assert.equal(denied.body.auth.request.local, false);
    assert.equal(denied.body.auth.actor.authenticated, false);

    const login = await postJson(`${apiServer.url}/api/runtime/auth/local`, {
      method: "token",
      token: "test-local-admin-token",
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.session.kind, "local-token");
    assert.equal(typeof login.body.session.token, "string");
    const sessionToken = login.body.session.token;
    assert.equal(sessionToken.includes("test-local-admin-token"), false);

    const authed = await getJsonWithHeaders(`${apiServer.url}/api/runtime/security`, {
      "x-service-lasso-internal-proxy": "serviceadmin",
      "x-service-lasso-client-address": "192.168.1.40",
      authorization: `Bearer ${sessionToken}`,
    });
    assert.equal(authed.body.auth.actor.kind, "local-token");
  } finally {
    await apiServer.stop();
    await rm(tempDir, { recursive: true, force: true });
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
  }
});

test("remote API requests can resolve a Zitadel-authenticated actor", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-auth-zitadel-"));
  await ensureTestSecretsBrokerReady(tempDir);
  const previousTrustProxy = process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS;
  const previousZitadel = process.env.SERVICE_LASSO_ZITADEL_ENABLED;
  process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS = "true";
  process.env.SERVICE_LASSO_ZITADEL_ENABLED = "true";
  const apiServer = await startApiServer({
    port: 0,
    host: "0.0.0.0",
    workspaceRoot: tempDir,
    version: "auth-zitadel-test",
  });

  try {
    const result = await getJsonWithHeaders(`${apiServer.url}/api/runtime/security`, {
      "x-service-lasso-internal-proxy": "serviceadmin",
      "x-service-lasso-proxy": "serviceadmin",
      "x-service-lasso-trusted-ingress": "serviceadmin-loopback",
      "x-forwarded-for": "192.168.1.22",
      "x-service-lasso-zitadel-user-id": "usr_zitadel_operator",
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.auth.request.local, false);
    assert.equal(result.body.auth.actor.authenticated, true);
    assert.equal(result.body.auth.actor.kind, "zitadel");
    assert.equal(result.body.auth.actor.actorId, "usr_zitadel_operator");
    assert.equal(result.body.auth.policy.zitadelEnabled, true);
    assert.deepEqual(result.body.auth.blockers, []);

    const services = await getJsonWithHeaders(`${apiServer.url}/api/services`, {
      "x-service-lasso-internal-proxy": "serviceadmin",
      "x-service-lasso-proxy": "serviceadmin",
      "x-service-lasso-trusted-ingress": "serviceadmin-loopback",
      "x-forwarded-for": "192.168.1.22",
      "x-service-lasso-zitadel-user-id": "usr_zitadel_operator",
    });
    assert.equal(services.status, 200);
    assert.equal(Array.isArray(services.body.services), true);
  } finally {
    await apiServer.stop();
    await rm(tempDir, { recursive: true, force: true });
    if (previousTrustProxy === undefined) {
      delete process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS;
    } else {
      process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS = previousTrustProxy;
    }
    if (previousZitadel === undefined) {
      delete process.env.SERVICE_LASSO_ZITADEL_ENABLED;
    } else {
      process.env.SERVICE_LASSO_ZITADEL_ENABLED = previousZitadel;
    }
  }
});

test("runtime app host option overrides SERVICE_LASSO_HOST", async () => {
  const previousHost = process.env.SERVICE_LASSO_HOST;
  process.env.SERVICE_LASSO_HOST = "0.0.0.0";
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-runtime-host-"));
  const app = await startRuntimeApp({
    port: 0,
    host: "127.0.0.1",
    servicesRoot: path.resolve("services"),
    workspaceRoot: tempDir,
    version: "host-option-test",
  });

  try {
    const address = app.apiServer.server.address();

    assert.ok(address && typeof address !== "string");
    assert.equal(address.address, "127.0.0.1");
  } finally {
    await app.apiServer.stop();
    await rm(tempDir, { recursive: true, force: true });
    if (previousHost === undefined) {
      delete process.env.SERVICE_LASSO_HOST;
    } else {
      process.env.SERVICE_LASSO_HOST = previousHost;
    }
  }
});

test("GET /api/services returns discovered services from the tracked services root", async () => {
  const servicesRoot = path.resolve("services");
  await clearPersistedFixtureState(servicesRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const result = await getJson(`${apiServer.url}/api/services`);

    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.body.services));
    assert.equal(result.body.services.length, 12);
    assert.deepEqual(
      result.body.services.map((service) => service.id),
      ["@archive", "@java", "@localcert", "@nginx", "@node", "@python", "@secretsbroker", "@serviceadmin", "@traefik", "echo-service", "node-sample-service", "openobserve"],
    );
    assert.equal(result.body.services[0].status, "discovered");
    assert.equal(result.body.services[0].source, "manifest");
  } finally {
    await apiServer.stop();
    await clearPersistedFixtureState(servicesRoot);
  }
});

test("GET /api/files/workspaces returns the service-root scoped Files registry", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-files-registry-");

  await writeManifest(servicesRoot, "alpha-service", {
    id: "alpha-service",
    name: "Alpha Service",
    description: "Service with workspace file roots.",
    files: {
      enabled: true,
      roots: [
        {
          id: "workspace",
          label: "Workspace",
          path: ".",
          mode: "read-write",
        },
        {
          id: "logs",
          label: "Logs",
          path: "./logs",
          mode: "read-only",
          hidden: true,
        },
        {
          id: "state",
          label: "Runtime State",
          path: "./.state",
          mode: "read-write",
          protected: true,
        },
      ],
    },
  });
  await writeManifest(servicesRoot, "bravo-service", {
    id: "bravo-service",
    name: "Bravo Service",
    description: "Service without Files enabled.",
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const result = await getJson(`${apiServer.url}/api/files/workspaces`);

    assert.equal(result.status, 200);
    assert.equal(result.body.registry.source, "service-lasso-workspaces");
    assert.equal(result.body.registry.registryVersion, 1);
    assert.deepEqual(
      result.body.registry.workspaces.map((entry) => entry.id),
      ["alpha-service:logs", "alpha-service:state", "alpha-service:workspace"],
    );

    const byRootId = new Map(result.body.registry.workspaces.map((entry) => [entry.rootId, entry]));
    assert.equal(byRootId.get("workspace").serviceId, "alpha-service");
    assert.equal(byRootId.get("workspace").mode, "read-write");
    assert.equal(byRootId.get("workspace").access.write, true);
    assert.equal(byRootId.get("workspace").relativePath, ".");
    assert.equal(byRootId.get("workspace").resolvedPath, path.join(servicesRoot, "alpha-service"));
    assert.equal(byRootId.get("workspace").safety.withinServiceRoot, true);
    assert.equal(byRootId.get("workspace").safety.pathPolicy, "service-root-relative-only");

    assert.equal(byRootId.get("logs").hidden, true);
    assert.equal(byRootId.get("logs").access.write, false);
    assert.equal(byRootId.get("state").protected, true);
    assert.equal(byRootId.get("state").access.write, false);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GET /api/diagnostics/dependencies reports start blockers and safe next actions", async () => {
  resetLifecycleState();
  const occupiedPortServer = net.createServer();
  await new Promise((resolve, reject) => {
    occupiedPortServer.once("error", reject);
    occupiedPortServer.listen(0, "127.0.0.1", resolve);
  });
  const occupiedAddress = occupiedPortServer.address();
  assert.notEqual(typeof occupiedAddress, "string");
  const occupiedPort = occupiedAddress.port;
  await new Promise((resolve) => occupiedPortServer.close(resolve));
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-dependency-diagnostics-");

  await writeExecutableFixtureService(servicesRoot, "alpha-running", {
    ports: {
      service: 43150,
    },
  });
  await writeExecutableFixtureService(servicesRoot, "bravo-ready", {
    depend_on: ["alpha-running"],
    ports: {
      service: 43151,
    },
  });
  await writeExecutableFixtureService(servicesRoot, "charlie-missing-dependency", {
    depend_on: ["missing-service"],
  });
  await writeExecutableFixtureService(servicesRoot, "delta-occupied-port", {
    ports: {
      service: occupiedPort,
    },
  });
  await writeExecutableFixtureService(servicesRoot, "echo-disabled", {
    enabled: false,
  });
  await writeExecutableFixtureService(servicesRoot, "foxtrot-unhealthy", {
    healthcheck: {
      type: "tcp",
      address: "127.0.0.1:9",
    },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    for (const serviceId of ["alpha-running", "bravo-ready", "delta-occupied-port", "foxtrot-unhealthy"]) {
      let result = await postJson(apiServer.url + "/api/services/" + serviceId + "/install");
      assert.equal(result.status, 200);
      result = await postJson(apiServer.url + "/api/services/" + serviceId + "/config");
      assert.equal(result.status, 200);
    }

    await new Promise((resolve, reject) => {
      occupiedPortServer.once("error", reject);
      occupiedPortServer.listen(occupiedPort, "127.0.0.1", resolve);
    });

    let result = await postJson(apiServer.url + "/api/services/alpha-running/start");
    assert.equal(result.status, 200);
    result = await postJson(apiServer.url + "/api/services/foxtrot-unhealthy/start");
    assert.equal(result.status, 200);

    const diagnostics = await getJson(apiServer.url + "/api/diagnostics/dependencies");
    assert.equal(diagnostics.status, 200);
    assert.equal(diagnostics.body.diagnostics.summary.status, "blocked");
    assert.equal(diagnostics.body.diagnostics.summary.totalServices, 6);
    assert.equal(diagnostics.body.diagnostics.summary.disabledServices, 1);

    const byId = new Map(diagnostics.body.diagnostics.services.map((service) => [service.id, service]));
    assert.equal(byId.get("alpha-running").readiness, "running");
    assert.equal(byId.get("bravo-ready").readiness, "ready");
    assert.equal(byId.get("bravo-ready").dependencies[0].ready, true);
    assert.equal(byId.get("charlie-missing-dependency").readiness, "blocked");
    assert.equal(byId.get("charlie-missing-dependency").blockingReason, "missing_dependency");
    assert.equal(byId.get("delta-occupied-port").blockingReason, "port_occupied");
    assert.equal(byId.get("echo-disabled").readiness, "disabled");
    assert.equal(byId.get("foxtrot-unhealthy").readiness, "degraded");
    assert.equal(byId.get("foxtrot-unhealthy").blockingReason, "unhealthy");
    assert.equal(
      diagnostics.body.diagnostics.services.every((service) =>
        service.endpoints.every((endpoint) => !endpoint.url.includes("?") && !endpoint.url.includes("#")),
      ),
      true,
    );
  } finally {
    await apiServer.stop();
    if (occupiedPortServer.listening) {
      await new Promise((resolve) => occupiedPortServer.close(resolve));
    }
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("dashboard adapter routes expose bounded admin-facing service and summary shapes", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-dashboard-adapter-");
  await writeExecutableFixtureService(servicesRoot, "alpha-service", {
    stdoutLines: ["alpha ready"],
    stderrLines: ["alpha warn"],
    ports: {
      service: 43140,
    },
    urls: [
      {
        label: "service",
        url: "http://127.0.0.1:${SERVICE_PORT}/",
        kind: "local",
      },
    ],
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
  await writeExecutableFixtureService(servicesRoot, "bravo-service", {
    depend_on: ["alpha-service"],
    ports: {
      service: 43141,
    },
    urls: [
      {
        label: "service",
        url: "http://127.0.0.1:${SERVICE_PORT}/",
        kind: "local",
      },
    ],
  });
  await writeManifest(servicesRoot, "provider-utility", {
    id: "provider-utility",
    name: "Provider Utility",
    description: "Provider utility fixture that is ready once installed/configured.",
    role: "provider",
  });
  const apiServer = await startApiServer({
    port: 0,
    servicesRoot,
    workspaceRoot: path.join(tempRoot, "workspace"),
  });

  try {
    for (const serviceId of ["alpha-service", "bravo-service", "provider-utility"]) {
      let result = await postJson(`${apiServer.url}/api/services/${serviceId}/install`);
      assert.equal(result.status, 200);
      result = await postJson(`${apiServer.url}/api/services/${serviceId}/config`);
      assert.equal(result.status, 200);
    }

    let result = await postJson(`${apiServer.url}/api/services/alpha-service/start`);
    assert.equal(result.status, 200);

    const favoriteResponse = await fetch(`${apiServer.url}/api/services/alpha-service/meta`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        favorite: true,
      }),
    });
    assert.equal(favoriteResponse.status, 200);

    await waitFor(async () => {
      const response = await getJson(`${apiServer.url}/api/dashboard/services/alpha-service`);
      if (response.body.service.recentLogs.some((entry) => entry.message === "alpha ready")) {
        return response;
      }
      return null;
    });

    const summary = await getJson(`${apiServer.url}/api/dashboard`);
    const services = await getJson(`${apiServer.url}/api/dashboard/services`);
    const alphaDetail = await getJson(`${apiServer.url}/api/dashboard/services/alpha-service`);
    const bravoDetail = await getJson(`${apiServer.url}/api/dashboard/services/bravo-service`);
    const utilityDetail = await getJson(`${apiServer.url}/api/dashboard/services/provider-utility`);

    assert.equal(summary.status, 200);
    assert.equal(summary.body.summary.servicesTotal, 3);
    assert.equal(summary.body.summary.servicesRunning, 1);
    assert.equal(summary.body.summary.servicesAvailable, 1);
    assert.equal(summary.body.summary.servicesStopped, 1);
    assert.equal(summary.body.summary.favorites.length, 1);
    assert.equal(summary.body.summary.favorites[0].id, "alpha-service");
    assert.ok(summary.body.summary.warnings.includes("At least one managed service is currently stopped."));
    assert.deepEqual(summary.body.summary.updateNotifications.messages, []);
    assert.deepEqual(summary.body.summary.recoveryNotifications.messages, []);

    assert.equal(services.status, 200);
    assert.equal(Array.isArray(services.body.services), true);
    assert.equal(services.body.services.length, 3);

    assert.equal(alphaDetail.status, 200);
    assert.equal(alphaDetail.body.service.id, "alpha-service");
    assert.equal(alphaDetail.body.service.favorite, true);
    assert.equal(alphaDetail.body.service.status, "running");
    assert.equal(typeof alphaDetail.body.service.runtimeHealth.pid, "number");
    assert.equal(alphaDetail.body.service.runtimeHealth.pid > 0, true);
    assert.equal(typeof alphaDetail.body.service.runtimeHealth.runId, "string");
    assert.equal(alphaDetail.body.service.runtimeHealth.runId.length > 0, true);
    assert.equal(alphaDetail.body.service.installed, true);
    assert.equal(alphaDetail.body.service.role.length > 0, true);
    assert.deepEqual(
      alphaDetail.body.service.healthchecks.map((check) => ({
        id: check.id,
        type: check.type,
        required: check.required,
        healthy: check.healthy,
        attempts: check.attempts,
      })),
      [
        { id: "process-ready", type: "process", required: true, healthy: true, attempts: 1 },
        { id: "optional-diagnostic", type: "file", required: false, healthy: false, attempts: 1 },
      ],
    );
    assert.equal(alphaDetail.body.service.metadata.installPath.endsWith(path.join("services", "alpha-service")), true);
    assert.equal(alphaDetail.body.service.metadata.configPath.endsWith(path.join("services", "alpha-service", "service.json")), true);
    assert.equal(alphaDetail.body.service.metadata.logPath.endsWith(path.join("services", "alpha-service", "logs", "runtime", "service.log")), true);
    assert.ok(alphaDetail.body.service.links.some((link) => link.label === "service"));
    assert.ok(alphaDetail.body.service.endpoints.some((endpoint) => endpoint.port === 43140));
    assert.ok(alphaDetail.body.service.environmentVariables.some((entry) => entry.key === "SERVICE_PORT"));
    assert.ok(alphaDetail.body.service.recentLogs.some((entry) => entry.message === "alpha ready" && entry.source === "stdout"));
    assert.ok(alphaDetail.body.service.actions.some((action) => action.kind === "open_logs"));
    assert.ok(alphaDetail.body.service.dependents.some((entry) => entry.id === "bravo-service" && entry.status === "stopped"));

    assert.equal(bravoDetail.status, 200);
    assert.equal(bravoDetail.body.service.status, "stopped");
    assert.equal(bravoDetail.body.service.runtimeHealth.pid, null);
    assert.ok(bravoDetail.body.service.dependencies.some((entry) => entry.id === "alpha-service" && entry.status === "running"));

    assert.equal(utilityDetail.status, 200);
    assert.equal(utilityDetail.body.service.status, "available");
    assert.equal(utilityDetail.body.service.role, "provider");
    assert.equal(utilityDetail.body.service.metadata.serviceType, "provider");
    assert.equal(utilityDetail.body.service.runtimeHealth.state, "available");
    assert.equal(utilityDetail.body.service.runtimeHealth.health, "healthy");
    assert.equal(utilityDetail.body.service.installed, true);
    assert.deepEqual(
      utilityDetail.body.service.actions
        .filter((action) => ["start", "stop", "restart", "reload"].includes(action.kind))
        .map((action) => action.kind),
      [],
    );
    assert.ok(utilityDetail.body.service.actions.some((action) => action.kind === "config"));
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("service config document API loads and saves runtime-backed service.json with backup history", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-config-document-");
  const serviceRoot = await writeManifest(servicesRoot, "node-sample-service", {
    id: "node-sample-service",
    name: "Node Sample Service",
    description: "Config document fixture.",
    enabled: true,
    executable: process.execPath,
    args: ["runtime/server.mjs"],
    healthcheck: {
      type: "process",
    },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const initial = await getJson(`${apiServer.url}/api/services/node-sample-service/config`);
    assert.equal(initial.status, 200);
    assert.equal(initial.body.serviceId, "node-sample-service");
    assert.equal(initial.body.fileName, "server.json");
    assert.equal(initial.body.path, path.join(serviceRoot, "service.json"));
    assert.equal(initial.body.backupCount, 0);
    assert.equal(initial.body.safety.rawSecretValuesLoaded, false);
    assert.match(initial.body.content, /Node Sample Service/);

    const nextContent = JSON.stringify(
      {
        id: "node-sample-service",
        name: "Node Sample Service",
        description: "Edited through the config document API.",
        enabled: true,
        executable: process.execPath,
        args: ["runtime/server.mjs"],
        healthcheck: {
          type: "process",
        },
      },
      null,
      2,
    );
    const save = await putJson(`${apiServer.url}/api/services/node-sample-service/config`, {
      content: nextContent,
      actor: "service-admin-web",
      reason: "prove config editor save path",
    });

    assert.equal(save.status, 200);
    assert.equal(save.body.serviceId, "node-sample-service");
    assert.equal(save.body.validationStatus, "valid");
    assert.equal(save.body.backup.actor, "service-admin-web");
    assert.equal(save.body.backup.reason, "prove config editor save path");
    assert.equal(save.body.backup.path, "service.json");
    assert.match(save.body.backup.content, /Config document fixture/);

    const backupDir = path.join(serviceRoot, ".state", "backups", "config");
    const backupFiles = await readdir(backupDir);
    assert.ok(backupFiles.some((fileName) => fileName.endsWith(".server.json")));
    assert.ok(backupFiles.some((fileName) => fileName.endsWith(".metadata.json")));

    const savedManifest = await readFile(path.join(serviceRoot, "service.json"), "utf8");
    assert.match(savedManifest, /Edited through the config document API/);

    const reloaded = await getJson(`${apiServer.url}/api/services/node-sample-service/config`);
    assert.equal(reloaded.status, 200);
    assert.equal(reloaded.body.backupCount, 1);
    assert.equal(reloaded.body.revisions.length, 1);
    assert.equal(reloaded.body.revisions[0].id, save.body.backup.id);
    assert.match(reloaded.body.content, /Edited through the config document API/);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("service config history travels with a copied service root", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-config-copy-source-");
  const serviceRoot = await writeManifest(servicesRoot, "node-sample-service", {
    id: "node-sample-service",
    name: "Node Sample Service",
    description: "Portable config history fixture.",
    enabled: true,
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const nextContent = JSON.stringify(
      {
        id: "node-sample-service",
        name: "Node Sample Service",
        description: "Copied bundle config.",
        enabled: true,
      },
      null,
      2,
    );
    const save = await putJson(`${apiServer.url}/api/services/node-sample-service/config`, {
      content: nextContent,
      actor: "service-admin-web",
      reason: "prove copied service root history",
    });
    assert.equal(save.status, 200);
  } finally {
    await apiServer.stop();
  }

  const restartedApiServer = await startApiServer({ port: 0, servicesRoot });
  try {
    const afterRestart = await getJson(`${restartedApiServer.url}/api/services/node-sample-service/config`);
    assert.equal(afterRestart.status, 200);
    assert.equal(afterRestart.body.backupCount, 1);
    assert.match(afterRestart.body.revisions[0].content, /Portable config history fixture/);
  } finally {
    await restartedApiServer.stop();
  }

  const movedTempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-config-copy-target-"));
  const movedServicesRoot = path.join(movedTempRoot, "services");
  const movedServiceRoot = path.join(movedServicesRoot, "node-sample-service");
  await mkdir(movedServicesRoot, { recursive: true });
  await cp(serviceRoot, movedServiceRoot, { recursive: true });
  const copiedApiServer = await startApiServer({ port: 0, servicesRoot: movedServicesRoot });

  try {
    const copied = await getJson(`${copiedApiServer.url}/api/services/node-sample-service/config`);
    assert.equal(copied.status, 200);
    assert.equal(copied.body.backupCount, 1);
    assert.equal(copied.body.revisions.length, 1);
    assert.match(copied.body.revisions[0].content, /Portable config history fixture/);
  } finally {
    await copiedApiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    await rm(movedTempRoot, { recursive: true, force: true });
  }
});

test("service config document API reads legacy workspace backup history during fallback", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-config-legacy-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const serviceRoot = await writeManifest(servicesRoot, "node-sample-service", {
    id: "node-sample-service",
    name: "Node Sample Service",
    description: "Legacy workspace history fixture.",
    enabled: true,
  });
  const legacyBackupDir = path.join(workspaceRoot, "service-config-backups", "node-sample-service");
  await mkdir(legacyBackupDir, { recursive: true });
  await writeFile(
    path.join(legacyBackupDir, "legacy-revision.json"),
    JSON.stringify(
      {
        id: "legacy-revision",
        createdAt: "2026-06-26T09:12:44.123Z",
        actor: "service-admin-web",
        reason: "legacy workspace fallback",
        path: path.join(serviceRoot, "service.json"),
        previousHash: "previous",
        currentHash: "current",
        validationStatus: "valid",
        content: "{\n  \"id\": \"node-sample-service\",\n  \"description\": \"Legacy workspace history fixture.\"\n}\n",
      },
      null,
      2,
    ),
  );
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  try {
    const response = await getJson(`${apiServer.url}/api/services/node-sample-service/config`);
    assert.equal(response.status, 200);
    assert.equal(response.body.backupCount, 1);
    assert.equal(response.body.revisions[0].id, "legacy-revision");
    assert.equal(response.body.revisions[0].reason, "legacy workspace fallback");
    assert.match(response.body.revisions[0].content, /Legacy workspace history fixture/);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("service config document API rejects invalid or wrong-service JSON saves", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-config-document-invalid-");
  await writeManifest(servicesRoot, "node-sample-service", {
    id: "node-sample-service",
    name: "Node Sample Service",
    description: "Config document fixture.",
    enabled: true,
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const invalidJson = await putJson(`${apiServer.url}/api/services/node-sample-service/config`, {
      content: "",
      actor: "service-admin-web",
      reason: "invalid save",
    });
    assert.equal(invalidJson.status, 400);
    assert.equal(invalidJson.body.error, "invalid_json");

    const wrongService = await putJson(`${apiServer.url}/api/services/node-sample-service/config`, {
      content: JSON.stringify({ id: "other-service", name: "Other service" }),
      actor: "service-admin-web",
      reason: "wrong service",
    });
    assert.equal(wrongService.status, 400);
    assert.equal(wrongService.body.error, "invalid_json");
    assert.match(wrongService.body.message, /must remain "node-sample-service"/);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runtime boots from explicit servicesRoot and workspaceRoot config", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-config-"));
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    const apiServer = await startApiServer({
      port: 0,
      servicesRoot: path.resolve("services"),
      workspaceRoot,
      version: "config-test",
    });

    try {
      const result = await getJson(`${apiServer.url}/api/runtime`);

      assert.equal(result.status, 200);
      assert.equal(result.body.runtime.servicesRoot, path.resolve("services"));
      assert.equal(result.body.runtime.workspaceRoot, path.resolve(workspaceRoot));
    } finally {
      await apiServer.stop();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GET /api/runtime/capabilities returns versioned runtime capability metadata", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-capabilities-");
  await writeExecutableFixtureService(servicesRoot, "alpha-service", {
    role: "provider",
  });
  await writeExecutableFixtureService(servicesRoot, "@serviceadmin");
  const apiServer = await startApiServer({
    port: 0,
    servicesRoot,
    workspaceRoot,
    version: "capability-test-version",
  });

  try {
    const result = await getJson(apiServer.url + "/api/runtime/capabilities");

    assert.equal(result.status, 200);
    assert.equal(result.body.capabilities.runtime.version, "capability-test-version");
    assert.equal(result.body.capabilities.api.contractVersion, "service-lasso.runtime-capabilities.v1");
    assert.ok(result.body.capabilities.api.endpointGroups.some((group) => group.id === "runtime"));
    assert.ok(result.body.capabilities.api.endpointGroups.some((group) => group.id === "operator-mcp" && group.mutating === false));
    assert.ok(result.body.capabilities.api.endpointGroups.some((group) => group.id === "service-files" && group.pathPrefix === "/api/files" && group.mutating === false));
    assert.equal(result.body.capabilities.features.lifecycleActions, true);
    assert.equal(result.body.capabilities.features.dashboardAdapter, true);
    assert.equal(result.body.capabilities.features.operatorMcp, true);
    assert.equal(result.body.capabilities.features.serviceFiles, true);
    assert.equal(result.body.capabilities.features.providerConnections, false);
    assert.equal(result.body.capabilities.features.workflowFacade, false);
    assert.equal(result.body.capabilities.features.autostart, false);
    assert.equal(result.body.capabilities.features.monitor, false);
    assert.equal(result.body.capabilities.features.updateScheduler, false);
    assert.deepEqual(result.body.capabilities.baseline.defaultServiceIds, [
      "@archive",
      "@java",
      "@localcert",
      "@nginx",
      "@traefik",
      "@node",
      "@python",
      "@secretsbroker",
      "echo-service",
      "@serviceadmin",
    ]);
    assert.deepEqual(result.body.capabilities.baseline.serviceRoles, [
      {
        id: "@serviceadmin",
        role: "service",
        enabled: true,
        defaultBaseline: true,
      },
      {
        id: "alpha-service",
        role: "provider",
        enabled: true,
        defaultBaseline: false,
      },
    ]);
    assert.equal(result.body.capabilities.compatibility.serviceAdmin.runtimeApiBaseUrlRequired, true);
    assert.equal(result.body.capabilities.compatibility.serviceAdmin.supportsSafeSecretMetadataOnly, true);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GET /api/runtime/capabilities reflects configured runtime option flags", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-capability-flags-");
  const apiServer = await startApiServer({
    port: 0,
    servicesRoot,
    workspaceRoot,
    version: "capability-flags-test",
    monitor: true,
    updateScheduler: true,
  });

  try {
    const result = await getJson(apiServer.url + "/api/runtime/capabilities");

    assert.equal(result.status, 200);
    assert.equal(result.body.capabilities.features.monitor, true);
    assert.equal(result.body.capabilities.features.updateScheduler, true);
    assert.equal(result.body.capabilities.features.autostart, false);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runtime app honors servicesRoot and workspaceRoot environment overrides", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-app-env-config-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const previousServicesRoot = process.env.SERVICE_LASSO_SERVICES_ROOT;
  const previousWorkspaceRoot = process.env.SERVICE_LASSO_WORKSPACE_ROOT;

  process.env.SERVICE_LASSO_SERVICES_ROOT = path.resolve("services");
  process.env.SERVICE_LASSO_WORKSPACE_ROOT = workspaceRoot;

  try {
    const app = await startRuntimeApp({ port: 0, version: "env-config-test" });

    try {
      const result = await getJson(`${app.apiServer.url}/api/runtime`);

      assert.equal(result.status, 200);
      assert.equal(result.body.runtime.servicesRoot, path.resolve("services"));
      assert.equal(result.body.runtime.workspaceRoot, path.resolve(workspaceRoot));
    } finally {
      await app.apiServer.stop();
    }
  } finally {
    if (previousServicesRoot === undefined) {
      delete process.env.SERVICE_LASSO_SERVICES_ROOT;
    } else {
      process.env.SERVICE_LASSO_SERVICES_ROOT = previousServicesRoot;
    }
    if (previousWorkspaceRoot === undefined) {
      delete process.env.SERVICE_LASSO_WORKSPACE_ROOT;
    } else {
      process.env.SERVICE_LASSO_WORKSPACE_ROOT = previousWorkspaceRoot;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runtime rejects a missing servicesRoot during startup validation", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-config-"));
  const missingServicesRoot = path.join(tempRoot, "missing-services");
  const workspaceRoot = path.join(tempRoot, "workspace");
  await mkdir(workspaceRoot, { recursive: true });

  await assert.rejects(
    () =>
      startApiServer({
        port: 0,
        servicesRoot: missingServicesRoot,
        workspaceRoot,
      }),
    /servicesRoot does not exist/i,
  );

  await rm(tempRoot, { recursive: true, force: true });
});

test("POST /api/runtime/actions/startAll prepares and starts eligible services in deterministic order", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-runtime-actions-");
  await writeExecutableFixtureService(servicesRoot, "alpha-service");
  await writeExecutableFixtureService(servicesRoot, "bravo-service", {
    depend_on: ["alpha-service"],
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const startAll = await postJson(`${apiServer.url}/api/runtime/actions/startAll`);
    assert.equal(startAll.status, 200);
    assert.equal(startAll.body.action, "startAll");
    assert.equal(startAll.body.ok, true);
    assert.deepEqual(
      startAll.body.results.map((result) => result.serviceId),
      ["alpha-service", "bravo-service"],
    );
    assert.deepEqual(startAll.body.skipped, []);
    assert.equal(startAll.body.results[0].state.installed, true);
    assert.equal(startAll.body.results[0].state.configured, true);
    assert.equal(startAll.body.results[0].state.running, true);
    assert.equal(startAll.body.results[1].state.installed, true);
    assert.equal(startAll.body.results[1].state.configured, true);
    assert.equal(startAll.body.results[1].state.running, true);

    const stopAll = await postJson(`${apiServer.url}/api/runtime/actions/stopAll`);
    assert.equal(stopAll.status, 200);
    assert.equal(stopAll.body.action, "stopAll");
    assert.equal(stopAll.body.ok, true);
    assert.deepEqual(
      stopAll.body.results.map((result) => result.serviceId),
      ["bravo-service", "alpha-service"],
    );
    assert.deepEqual(stopAll.body.skipped, []);
    assert.equal(stopAll.body.results[0].state.running, false);
    assert.equal(stopAll.body.results[1].state.running, false);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("POST /api/services/:id/start prepares missing dependencies before starting it", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-single-start-prepare-");
  await writeExecutableFixtureService(servicesRoot, "alpha-service");
  await writeExecutableFixtureService(servicesRoot, "bravo-service", {
    depend_on: ["alpha-service"],
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const start = await postJson(`${apiServer.url}/api/services/bravo-service/start`);
    assert.equal(start.status, 200);
    assert.equal(start.body.action, "start");
    assert.equal(start.body.ok, true);
    assert.equal(start.body.state.installed, true);
    assert.equal(start.body.state.configured, true);
    assert.equal(start.body.state.running, true);

    const detail = await getJson(`${apiServer.url}/api/services/alpha-service`);
    assert.equal(detail.body.service.lifecycle.installed, true);
    assert.equal(detail.body.service.lifecycle.configured, true);
    assert.equal(detail.body.service.lifecycle.running, true);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("POST /api/runtime/actions/startAll preserves only true skip semantics", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-runtime-skips-");
  await writeManifest(servicesRoot, "@python", {
    id: "@python",
    name: "Python Runtime",
    description: "Disabled-by-default provider fixture that canonical startAll should still prepare.",
    role: "provider",
    enabled: false,
    install: { files: [{ path: "./runtime/install.txt", content: "installed ${SERVICE_ID}\n" }] },
    config: { files: [{ path: "./runtime/config.txt", content: "configured ${SERVICE_ID}\n" }] },
  });
  await writeExecutableFixtureService(servicesRoot, "alpha-installed-only");
  await writeExecutableFixtureService(servicesRoot, "bravo-missing-install");
  await writeExecutableFixtureService(servicesRoot, "charlie-running");
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    let result = await postJson(`${apiServer.url}/api/services/alpha-installed-only/install`);
    assert.equal(result.status, 200);

    for (const action of ["install", "config", "start"]) {
      result = await postJson(`${apiServer.url}/api/services/charlie-running/${action}`);
      assert.equal(result.status, 200);
    }

    const startAll = await postJson(`${apiServer.url}/api/runtime/actions/startAll`);
    assert.equal(startAll.status, 200);
    assert.equal(startAll.body.action, "startAll");
    assert.equal(startAll.body.ok, true);
    assert.deepEqual(
      startAll.body.results.map((actionResult) => actionResult.serviceId),
      ["alpha-installed-only", "bravo-missing-install"],
    );
    assert.deepEqual(startAll.body.skipped, [
      { serviceId: "@python", reason: "provider_role" },
      { serviceId: "charlie-running", reason: "already_running" },
    ]);
    assert.equal(startAll.body.results[0].state.configured, true);
    assert.equal(startAll.body.results[0].state.running, true);
    assert.equal(startAll.body.results[1].state.installed, true);
    assert.equal(startAll.body.results[1].state.configured, true);
    assert.equal(startAll.body.results[1].state.running, true);

    const pythonDetail = await getJson(`${apiServer.url}/api/services/%40python`);
    assert.equal(pythonDetail.body.service.enabled, false);
    assert.equal(pythonDetail.body.service.lifecycle.installed, true);
    assert.equal(pythonDetail.body.service.lifecycle.configured, true);
    assert.equal(pythonDetail.body.service.lifecycle.running, false);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GET /api/runtime/actions/startAll/plan returns dependency ordered dry-run without starting services", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-runtime-start-plan-");
  await writeExecutableFixtureService(servicesRoot, "alpha-service");
  await writeExecutableFixtureService(servicesRoot, "bravo-service", {
    depend_on: ["alpha-service"],
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    let result = await postJson(apiServer.url + "/api/services/alpha-service/install");
    assert.equal(result.status, 200);
    result = await postJson(apiServer.url + "/api/services/alpha-service/config");
    assert.equal(result.status, 200);

    const plan = await getJson(apiServer.url + "/api/runtime/actions/startAll/plan");
    assert.equal(plan.status, 200);
    assert.equal(plan.body.action, "startAll");
    assert.equal(plan.body.dryRun, true);
    assert.equal(plan.body.ok, true);
    assert.deepEqual(plan.body.order, ["alpha-service", "bravo-service"]);
    assert.deepEqual(
      plan.body.steps.map((step) => [step.serviceId, step.status, step.reason]),
      [
        ["alpha-service", "would_run", null],
        ["bravo-service", "would_run", null],
      ],
    );
    assert.deepEqual(plan.body.steps[1].prerequisites, ["install", "config"]);
    assert.deepEqual(plan.body.mutations, []);

    const alphaDetail = await getJson(apiServer.url + "/api/services/alpha-service");
    const bravoDetail = await getJson(apiServer.url + "/api/services/bravo-service");
    assert.equal(alphaDetail.body.service.lifecycle.running, false);
    assert.equal(bravoDetail.body.service.lifecycle.running, false);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GET /api/services/:id/update/install/plan reports blockers without writing update state", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-update-install-plan-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "update-plan-service", {
    updates: {
      mode: "download",
      runningService: "require-stopped",
    },
  });
  const stateRoot = path.join(serviceRoot, ".state");
  await mkdir(stateRoot, { recursive: true });
  const updatesPath = path.join(stateRoot, "updates.json");
  const before = {
    serviceId: "update-plan-service",
    state: "downloadedCandidate",
    lastCheck: null,
    available: null,
    downloadedCandidate: {
      tag: "2026.5.1",
      assetName: "update-plan-service.zip",
      archivePath: "updates/update-plan-service.zip",
      downloadedAt: "2026-05-20T00:00:00.000Z",
    },
    installDeferred: null,
    failed: null,
    hookResults: [],
  };
  await writeFile(updatesPath, JSON.stringify(before, null, 2));
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const plan = await getJson(apiServer.url + "/api/services/update-plan-service/update/install/plan");
    assert.equal(plan.status, 200);
    assert.equal(plan.body.action, "updateInstall");
    assert.equal(plan.body.dryRun, true);
    assert.equal(plan.body.ok, false);
    assert.equal(plan.body.steps[0].status, "blocked");
    assert.match(plan.body.steps[0].reason, /updates_mode_not_install/);
    assert.deepEqual(plan.body.mutations, []);

    const after = JSON.parse(await readFile(updatesPath, "utf8"));
    assert.deepEqual(after, before);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GET /api/runtime/actions/importService/plan previews app-owned import without copying manifest", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-import-plan-");
  const sourceRoot = path.join(tempRoot, "source-service");
  const sourceManifestPath = path.join(sourceRoot, "service.json");
  const targetManifestPath = path.join(servicesRoot, "imported-service", "service.json");
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(sourceManifestPath, JSON.stringify({
    id: "imported-service",
    name: "Imported Service",
    description: "Fixture service import plan.",
    executable: process.execPath,
    args: ["runtime/imported-service.mjs"],
    healthcheck: { type: "process" },
  }, null, 2));
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const plan = await getJson(
      apiServer.url + "/api/runtime/actions/importService/plan?manifestPath=" + encodeURIComponent(sourceManifestPath),
    );

    assert.equal(plan.status, 200);
    assert.equal(plan.body.action, "importService");
    assert.equal(plan.body.dryRun, true);
    assert.equal(plan.body.ok, true);
    assert.equal(plan.body.steps[0].serviceId, "imported-service");
    assert.equal(plan.body.steps[0].status, "would_run");
    assert.equal(plan.body.steps[0].metadata.targetManifestPath, targetManifestPath);
    assert.deepEqual(plan.body.mutations, []);
    await assert.rejects(readFile(targetManifestPath, "utf8"), /ENOENT/);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("POST /api/runtime/actions/autostart starts only autostart-eligible services deterministically", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-runtime-autostart-");
  await writeExecutableFixtureService(servicesRoot, "alpha-service", {
    autostart: true,
  });
  await writeExecutableFixtureService(servicesRoot, "bravo-service");
  await writeExecutableFixtureService(servicesRoot, "charlie-service", {
    autostart: true,
    depend_on: ["alpha-service"],
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    for (const serviceId of ["alpha-service", "bravo-service", "charlie-service"]) {
      let result = await postJson(`${apiServer.url}/api/services/${serviceId}/install`);
      assert.equal(result.status, 200);
      result = await postJson(`${apiServer.url}/api/services/${serviceId}/config`);
      assert.equal(result.status, 200);
    }

    const autostart = await postJson(`${apiServer.url}/api/runtime/actions/autostart`);
    assert.equal(autostart.status, 200);
    assert.equal(autostart.body.action, "autostart");
    assert.equal(autostart.body.ok, true);
    assert.deepEqual(
      autostart.body.results.map((result) => result.serviceId),
      ["alpha-service", "charlie-service"],
    );
    assert.deepEqual(autostart.body.skipped, [
      { serviceId: "bravo-service", reason: "autostart_disabled" },
    ]);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runtime boot autostart starts eligible rehydrated services", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-runtime-boot-autostart-");
  await writeExecutableFixtureService(servicesRoot, "auto-service", {
    autostart: true,
  });
  await writeExecutableFixtureService(servicesRoot, "manual-service");

  const bootstrapServer = await startApiServer({ port: 0, servicesRoot });

  try {
    for (const serviceId of ["auto-service", "manual-service"]) {
      let result = await postJson(`${bootstrapServer.url}/api/services/${serviceId}/install`);
      assert.equal(result.status, 200);
      result = await postJson(`${bootstrapServer.url}/api/services/${serviceId}/config`);
      assert.equal(result.status, 200);
    }
  } finally {
    await bootstrapServer.stop();
    resetLifecycleState();
  }

  const autostartServer = await startApiServer({ port: 0, servicesRoot, autostart: true });

  try {
    const autoService = await getJson(`${autostartServer.url}/api/services/auto-service`);
    const manualService = await getJson(`${autostartServer.url}/api/services/manual-service`);

    assert.equal(autoService.status, 200);
    assert.equal(autoService.body.service.lifecycle.running, true);
    assert.equal(manualService.status, 200);
    assert.equal(manualService.body.service.lifecycle.running, false);
  } finally {
    await autostartServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("POST /api/runtime/actions/reload rediscover manifests and restart previously running eligible services", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-runtime-reload-");
  const alpha = await writeExecutableFixtureService(servicesRoot, "alpha-service");
  const bravo = await writeExecutableFixtureService(servicesRoot, "bravo-service", {
    depend_on: ["alpha-service"],
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    for (const serviceId of ["alpha-service", "bravo-service"]) {
      let result = await postJson(`${apiServer.url}/api/services/${serviceId}/install`);
      assert.equal(result.status, 200);
      result = await postJson(`${apiServer.url}/api/services/${serviceId}/config`);
      assert.equal(result.status, 200);
    }

    let startAll = await postJson(`${apiServer.url}/api/runtime/actions/startAll`);
    assert.equal(startAll.status, 200);

    await writeManifest(servicesRoot, "bravo-service", {
      id: "bravo-service",
      name: "bravo-service",
      description: "Executable fixture for bravo-service.",
      enabled: false,
      executable: process.execPath,
      args: [path.relative(bravo.serviceRoot, bravo.scriptPath)],
      depend_on: ["alpha-service"],
      env: {
        FIXTURE_EXIT_CODE: "0",
      },
      healthcheck: { type: "process" },
    });

    const reload = await postJson(`${apiServer.url}/api/runtime/actions/reload`);
    assert.equal(reload.status, 200);
    assert.equal(reload.body.action, "reload");
    assert.equal(reload.body.ok, true);
    assert.deepEqual(
      reload.body.stopped.map((result) => result.serviceId),
      ["bravo-service", "alpha-service"],
    );
    assert.deepEqual(
      reload.body.results.map((result) => result.serviceId),
      ["alpha-service"],
    );
    assert.deepEqual(reload.body.skipped, [
      { serviceId: "bravo-service", reason: "disabled_after_reload" },
    ]);

    const alphaDetail = await getJson(`${apiServer.url}/api/services/alpha-service`);
    const bravoDetail = await getJson(`${apiServer.url}/api/services/bravo-service`);

    assert.equal(alphaDetail.body.service.lifecycle.running, true);
    assert.equal(bravoDetail.body.service.enabled, false);
    assert.equal(bravoDetail.body.service.lifecycle.running, false);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

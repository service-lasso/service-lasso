/**
 * Process HTTP e2e for SPEC-005 local/remote operator auth (AC-5I, AC-5J).
 *
 * Starts a real API listener, then proves first-run copy/acknowledge, loopback
 * local-root, Admin-proxy LAN forwarding, token/password login, and FORCE_SSO
 * remote-only behavior. Fake sentinels only. Never prints token, password, or
 * session values.
 */
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_OPERATOR_SECRET_KV_PATH, LOCAL_OPERATOR_USERNAME } from "../dist/runtime/auth/local-auth-constants.js";
import {
  patchLocalOperatorForceSso,
  writeLocalOperatorAuthState,
} from "../dist/runtime/auth/local-auth-store.js";
import { ensureLocalVaultMarker } from "../dist/runtime/setup/first-run.js";
import { startApiServer } from "../dist/server/index.js";

const TOKEN_SENTINEL = "test-local-admin-token";
const PASSWORD_SENTINEL = "test-local-operator-password";
const REMOTE_CLIENT = "10.0.0.20";
const REMOTE_HEADERS = {
  "x-service-lasso-client-address": REMOTE_CLIENT,
  "x-service-lasso-internal-proxy": "serviceadmin",
};

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function containsSentinel(value) {
  const encoded = JSON.stringify(value);
  return encoded.includes(TOKEN_SENTINEL) || encoded.includes(PASSWORD_SENTINEL);
}

/**
 * @param {unknown} body
 * @param {string} label
 */
function assertNoSecretEcho(body, label) {
  if (containsSentinel(body)) {
    throw new Error(`${label} echoed a local-auth sentinel`);
  }
}

/**
 * @param {boolean} condition
 * @param {string} message
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function readJson(url, init = {}) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

/**
 * @param {string} baseUrl
 * @param {Record<string, string>} [headers]
 */
async function getSecurity(baseUrl, headers = {}) {
  return await readJson(`${baseUrl}/api/runtime/security`, { headers });
}

/**
 * @param {string} workspaceRoot
 * @param {boolean} forceSso
 */
async function startAuthRuntime(workspaceRoot, forceSso) {
  const servicesRoot = path.join(workspaceRoot, "services");
  await mkdir(servicesRoot, { recursive: true });
  await ensureLocalVaultMarker(workspaceRoot);
  await writeLocalOperatorAuthState(workspaceRoot, {
    token: TOKEN_SENTINEL,
    password: PASSWORD_SENTINEL,
    forceSso,
    credentialsAcknowledged: false,
  });
  return await startApiServer({
    port: 0,
    host: "127.0.0.1",
    workspaceRoot,
    servicesRoot,
    version: "auth-e2e",
  });
}

/**
 * Run the SPEC-005 HTTP e2e matrix against a live API server.
 *
 * @returns {Promise<{ ok: true, checks: number }>}
 */
export async function runAuthE2e() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-auth-e2e-"));
  let server = null;
  let checks = 0;

  try {
    server = await startAuthRuntime(workspaceRoot, false);
    const baseUrl = server.url.replace(/\/$/, "");

    const loopback = await getSecurity(baseUrl);
    assert(loopback.status === 200, "loopback /api/runtime/security must be HTTP 200");
    assert(loopback.body?.auth?.contractVersion === "service-lasso.auth-status.v1", "auth contract version must match");
    assert(loopback.body.auth.request.local === true, "loopback request.local must be true");
    assert(loopback.body.auth.actor.kind === "local-root", "loopback actor must be local-root");
    assert(loopback.body.auth.actor.authenticated === true, "loopback must be authenticated");
    assert(Array.isArray(loopback.body.auth.blockers) && loopback.body.auth.blockers.length === 0, "loopback must have no blockers");
    assert(loopback.body.auth.policy.firstRunPending === true, "fresh workspace must report firstRunPending");
    assert(loopback.body.auth.policy.credentialsAcknowledged === false, "fresh workspace must not be acknowledged");
    assertNoSecretEcho(loopback.body, "loopback security");
    checks += 1;

    const firstRun = await readJson(`${baseUrl}/api/runtime/auth/first-run`);
    assert(firstRun.status === 200, "loopback first-run GET must succeed while pending");
    assert(firstRun.body?.firstRun?.pending === true, "first-run GET must report pending");
    assert(firstRun.body.firstRun.username === LOCAL_OPERATOR_USERNAME, "first-run username must be local-operator");
    const revealedToken = firstRun.body.firstRun.token;
    const revealedPassword = firstRun.body.firstRun.password;
    assert(typeof revealedToken === "string" && revealedToken.length > 0, "first-run token must be present");
    assert(typeof revealedPassword === "string" && revealedPassword.length > 0, "first-run password must be present");
    assert(revealedToken === TOKEN_SENTINEL, "first-run token must match the seeded sentinel");
    assert(revealedPassword === PASSWORD_SENTINEL, "first-run password must match the seeded sentinel");
    assert(
      firstRun.body.firstRun.vaultPath === LOCAL_OPERATOR_SECRET_KV_PATH,
      "first-run must advertise the Broker KV path without secret values",
    );
    checks += 1;

    const remoteFirstRun = await readJson(`${baseUrl}/api/runtime/auth/first-run`, { headers: REMOTE_HEADERS });
    assert(remoteFirstRun.status === 403 || remoteFirstRun.status === 401, "remote first-run GET must be denied");
    assertNoSecretEcho(remoteFirstRun.body, "remote first-run denial");
    checks += 1;

    const ack = await readJson(`${baseUrl}/api/runtime/auth/first-run/acknowledge`, { method: "POST" });
    assert(ack.status === 200, "loopback first-run acknowledge must succeed");
    assert(ack.body?.firstRun?.pending === false, "acknowledge must clear pending");
    assert(ack.body?.firstRun?.credentialsAcknowledged === true, "acknowledge must set credentialsAcknowledged");
    assertNoSecretEcho(ack.body, "first-run acknowledge");
    checks += 1;

    const firstRunAfter = await readJson(`${baseUrl}/api/runtime/auth/first-run`);
    assert(firstRunAfter.status === 404, "first-run GET must 404 after acknowledge");
    assertNoSecretEcho(firstRunAfter.body, "first-run after ack");
    checks += 1;

    const loopbackAfterAck = await getSecurity(baseUrl);
    assert(loopbackAfterAck.body.auth.policy.firstRunPending === false, "security must clear firstRunPending after ack");
    assert(loopbackAfterAck.body.auth.policy.credentialsAcknowledged === true, "security must report credentialsAcknowledged after ack");
    assertNoSecretEcho(loopbackAfterAck.body, "loopback security after ack");
    checks += 1;

    const alias = await readJson(`${baseUrl}/api/security`);
    assert(alias.status === 200, "loopback /api/security must be HTTP 200");
    assert(alias.body?.security?.auth?.actor?.kind === "local-root", "security alias must report local-root");
    assertNoSecretEcho(alias.body, "security alias");
    checks += 1;

    const remoteAnon = await getSecurity(baseUrl, REMOTE_HEADERS);
    assert(remoteAnon.status === 200, "remote /api/runtime/security must remain readable");
    assert(remoteAnon.body.auth.request.local === false, "forwarded LAN client must not be local");
    assert(remoteAnon.body.auth.policy.remoteAuthRequired === true, "remote must require auth");
    assert(remoteAnon.body.auth.actor.authenticated === false, "anonymous remote must not inherit local-root");
    assert(remoteAnon.body.auth.actor.kind === null, "anonymous remote actor kind must be null");
    assertNoSecretEcho(remoteAnon.body, "remote anonymous security");
    checks += 1;

    const remoteServices = await readJson(`${baseUrl}/api/services`, { headers: REMOTE_HEADERS });
    assert(remoteServices.status === 401, "anonymous remote /api/services must be 401");
    assert(remoteServices.body?.error === "remote_auth_required", "anonymous remote must fail closed as remote_auth_required");
    checks += 1;

    const osUser = await readJson(`${baseUrl}/api/runtime/auth/local`, {
      method: "POST",
      headers: { "content-type": "application/json", ...REMOTE_HEADERS },
      body: JSON.stringify({ method: "password", username: "Administrator", password: PASSWORD_SENTINEL }),
    });
    assert(osUser.status === 400, "OS username login must be rejected");
    assertNoSecretEcho(osUser.body, "os username rejection");
    checks += 1;

    const badToken = await readJson(`${baseUrl}/api/runtime/auth/local`, {
      method: "POST",
      headers: { "content-type": "application/json", ...REMOTE_HEADERS },
      body: JSON.stringify({ method: "token", token: "wrong-token" }),
    });
    assert(badToken.status === 401 || badToken.status === 403, "wrong remote token must be rejected");
    assertNoSecretEcho(badToken.body, "wrong token rejection");
    checks += 1;

    const tokenLogin = await readJson(`${baseUrl}/api/runtime/auth/local`, {
      method: "POST",
      headers: { "content-type": "application/json", ...REMOTE_HEADERS },
      body: JSON.stringify({ method: "token", token: TOKEN_SENTINEL }),
    });
    assert(tokenLogin.status === 200, "remote token login must succeed when FORCE_SSO is off");
    assert(tokenLogin.body?.session?.kind === "local-token", "token login must issue a local-token session");
    const sessionToken = tokenLogin.body?.session?.token;
    assert(typeof sessionToken === "string" && sessionToken.length >= 32, "issued session must be opaque");
    assert(sessionToken !== TOKEN_SENTINEL, "issued session must not be the vault token sentinel");
    assertNoSecretEcho(tokenLogin.body, "token login");
    checks += 1;

    const authed = await getSecurity(baseUrl, {
      ...REMOTE_HEADERS,
      authorization: `Bearer ${sessionToken}`,
    });
    assert(authed.status === 200, "session-backed remote security must be HTTP 200");
    assert(authed.body.auth.request.local === false, "session request must stay remote");
    assert(authed.body.auth.actor.kind === "local-token", "session actor must be local-token");
    assert(authed.body.auth.actor.authenticated === true, "session must authenticate");
    assertNoSecretEcho(authed.body, "session security");
    checks += 1;

    const passwordLogin = await readJson(`${baseUrl}/api/runtime/auth/local`, {
      method: "POST",
      headers: { "content-type": "application/json", ...REMOTE_HEADERS },
      body: JSON.stringify({
        method: "password",
        username: LOCAL_OPERATOR_USERNAME,
        password: PASSWORD_SENTINEL,
      }),
    });
    assert(passwordLogin.status === 200, "remote local-operator password login must succeed when FORCE_SSO is off");
    assert(passwordLogin.body?.session?.kind === "local-token", "password login must issue a local-token session");
    assert(passwordLogin.body?.session?.token !== PASSWORD_SENTINEL, "issued session must not be the password sentinel");
    assertNoSecretEcho(passwordLogin.body, "password login");
    checks += 1;

    await server.stop();
    await patchLocalOperatorForceSso(workspaceRoot, true);
    server = await startApiServer({
      port: 0,
      host: "127.0.0.1",
      workspaceRoot,
      servicesRoot: path.join(workspaceRoot, "services"),
      version: "auth-e2e-force-sso",
    });
    const ssoUrl = server.url.replace(/\/$/, "");

    const loopbackSso = await getSecurity(ssoUrl);
    assert(loopbackSso.body.auth.policy.forceSso === true, "FORCE_SSO must be visible on the security contract");
    assert(loopbackSso.body.auth.actor.kind === "local-root", "loopback must stay local-root when FORCE_SSO is on");
    assert(
      Array.isArray(loopbackSso.body.auth.blockers) && !loopbackSso.body.auth.blockers.includes("force_sso_required"),
      "loopback must not report force_sso_required",
    );
    assertNoSecretEcho(loopbackSso.body, "loopback FORCE_SSO security");
    checks += 1;

    const loopbackToken = await readJson(`${ssoUrl}/api/runtime/auth/local`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "token", token: TOKEN_SENTINEL }),
    });
    assert(loopbackToken.status === 200, "loopback token login must succeed when FORCE_SSO is on");
    assertNoSecretEcho(loopbackToken.body, "loopback FORCE_SSO token login");
    checks += 1;

    const loopbackPassword = await readJson(`${ssoUrl}/api/runtime/auth/local`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method: "password",
        username: LOCAL_OPERATOR_USERNAME,
        password: PASSWORD_SENTINEL,
      }),
    });
    assert(loopbackPassword.status === 200, "loopback password login must succeed when FORCE_SSO is on");
    assertNoSecretEcho(loopbackPassword.body, "loopback FORCE_SSO password login");
    checks += 1;

    const remoteSsoToken = await readJson(`${ssoUrl}/api/runtime/auth/local`, {
      method: "POST",
      headers: { "content-type": "application/json", ...REMOTE_HEADERS },
      body: JSON.stringify({ method: "token", token: TOKEN_SENTINEL }),
    });
    assert(remoteSsoToken.status === 401, "remote token login must fail when FORCE_SSO is on");
    assert(
      remoteSsoToken.body?.error === "force_sso_required" || remoteSsoToken.body?.code === "force_sso_required",
      "remote FORCE_SSO denial must use force_sso_required",
    );
    assertNoSecretEcho(remoteSsoToken.body, "remote FORCE_SSO token denial");
    checks += 1;

    const remoteSsoPassword = await readJson(`${ssoUrl}/api/runtime/auth/local`, {
      method: "POST",
      headers: { "content-type": "application/json", ...REMOTE_HEADERS },
      body: JSON.stringify({
        method: "password",
        username: LOCAL_OPERATOR_USERNAME,
        password: PASSWORD_SENTINEL,
      }),
    });
    assert(remoteSsoPassword.status === 401, "remote password login must fail when FORCE_SSO is on");
    assertNoSecretEcho(remoteSsoPassword.body, "remote FORCE_SSO password denial");
    checks += 1;

    return { ok: true, checks };
  } finally {
    if (server) {
      await server.stop();
    }
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runAuthE2e()
    .then((result) => {
      console.log(JSON.stringify({ ok: result.ok, checks: result.checks, spec: "SPEC-005", requirement: "AC-5I,AC-5J" }));
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : "auth e2e failed";
      console.error(JSON.stringify({ ok: false, error: message }));
      process.exitCode = 1;
    });
}

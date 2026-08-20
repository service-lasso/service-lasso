import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  acknowledgeLocalOperatorFirstRun,
  clearLocalAuthSessions,
  materialFromState,
  readFirstRunEnvelope,
  readLocalOperatorAuthState,
  writeLocalOperatorAuthState,
} from "../dist/runtime/auth/local-auth-store.js";
import {
  clearLocalAuthMaterialCache,
  ensureLocalOperatorAuth,
  loadLocalAuthMaterial,
} from "../dist/runtime/auth/local-operator-onboard.js";
import {
  clearRemoteLoginAttempts,
  parseLocalAuthValidateInput,
  validateLocalAuth,
} from "../dist/runtime/auth/local-auth-validate.js";
import { LOCAL_OPERATOR_USERNAME } from "../dist/runtime/auth/local-auth-constants.js";

const TOKEN_SENTINEL = "test-local-admin-token";
const PASSWORD_SENTINEL = "test-local-operator-password";

async function seededMaterial(workspaceRoot, forceSso = false) {
  await writeLocalOperatorAuthState(workspaceRoot, {
    token: TOKEN_SENTINEL,
    password: PASSWORD_SENTINEL,
    forceSso,
    credentialsAcknowledged: true,
  });
  return materialFromState(await readLocalOperatorAuthState(workspaceRoot), undefined);
}

test("token and local-operator password login issue a session without echoing vault secrets", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-local-auth-"));
  try {
    const material = await seededMaterial(workspaceRoot);
    const tokenParsed = parseLocalAuthValidateInput({ method: "token", token: TOKEN_SENTINEL });
    assert.notEqual(typeof tokenParsed, "string");
    const tokenResult = validateLocalAuth(tokenParsed, material, {
      clientAddress: "10.0.0.12",
      forceSso: false,
      local: false,
    });
    assert.equal(tokenResult.ok, true);
    if (tokenResult.ok) {
      assert.equal(typeof tokenResult.sessionToken, "string");
      assert.ok(tokenResult.sessionToken.length >= 32);
      assert.equal(tokenResult.sessionToken.includes(TOKEN_SENTINEL), false);
    }

    const passwordParsed = parseLocalAuthValidateInput({
      method: "password",
      username: LOCAL_OPERATOR_USERNAME,
      password: PASSWORD_SENTINEL,
    });
    assert.notEqual(typeof passwordParsed, "string");
    const passwordResult = validateLocalAuth(passwordParsed, material, {
      clientAddress: "10.0.0.13",
      forceSso: false,
      local: false,
    });
    assert.equal(passwordResult.ok, true);
  } finally {
    clearLocalAuthSessions();
    clearRemoteLoginAttempts();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("password login rejects OS-style usernames and empty credentials", () => {
  assert.equal(
    typeof parseLocalAuthValidateInput({
      method: "password",
      username: "Administrator",
      password: PASSWORD_SENTINEL,
    }),
    "string",
  );
  assert.equal(typeof parseLocalAuthValidateInput({ method: "token", token: "   " }), "string");
});

test("FORCE_SSO blocks remote local login but not the parse of a token body", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-local-auth-"));
  try {
    const material = await seededMaterial(workspaceRoot, true);
    const parsed = parseLocalAuthValidateInput({ method: "token", token: TOKEN_SENTINEL });
    assert.notEqual(typeof parsed, "string");
    const remote = validateLocalAuth(parsed, material, {
      clientAddress: "10.0.0.14",
      forceSso: true,
      local: false,
    });
    assert.equal(remote.ok, false);
    if (!remote.ok) {
      assert.equal(remote.error, "force_sso_required");
    }
    const loopback = validateLocalAuth(parsed, material, {
      clientAddress: "127.0.0.1",
      forceSso: true,
      local: true,
    });
    assert.equal(loopback.ok, true);

    const passwordParsed = parseLocalAuthValidateInput({
      method: "password",
      username: LOCAL_OPERATOR_USERNAME,
      password: PASSWORD_SENTINEL,
    });
    assert.notEqual(typeof passwordParsed, "string");
    const loopbackPassword = validateLocalAuth(passwordParsed, material, {
      clientAddress: "::1",
      forceSso: true,
      local: true,
    });
    assert.equal(loopbackPassword.ok, true);
  } finally {
    clearLocalAuthSessions();
    clearRemoteLoginAttempts();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("remote local-login failures rate-limit without locking loopback", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-local-auth-"));
  try {
    const material = await seededMaterial(workspaceRoot);
    const parsed = parseLocalAuthValidateInput({ method: "token", token: "wrong-sentinel" });
    assert.notEqual(typeof parsed, "string");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const denied = validateLocalAuth(parsed, material, {
        clientAddress: "10.0.0.15",
        forceSso: false,
        local: false,
      });
      assert.equal(denied.ok, false);
    }
    const limited = validateLocalAuth(parsed, material, {
      clientAddress: "10.0.0.15",
      forceSso: false,
      local: false,
    });
    assert.equal(limited.ok, false);
    if (!limited.ok) {
      assert.equal(limited.error, "local_auth_rate_limited");
    }
    const loopback = validateLocalAuth(parsed, material, {
      clientAddress: "127.0.0.1",
      forceSso: false,
      local: true,
    });
    assert.equal(loopback.ok, false);
    if (!loopback.ok) {
      assert.equal(loopback.error, "local_auth_rejected");
    }
  } finally {
    clearLocalAuthSessions();
    clearRemoteLoginAttempts();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("first-run envelope is readable until acknowledge and never required after legacy state", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-first-run-"));
  try {
    await writeLocalOperatorAuthState(workspaceRoot, {
      token: TOKEN_SENTINEL,
      password: PASSWORD_SENTINEL,
      credentialsAcknowledged: false,
    });
    const envelope = await readFirstRunEnvelope(workspaceRoot);
    assert.equal(envelope?.username, LOCAL_OPERATOR_USERNAME);
    assert.equal(envelope?.token, TOKEN_SENTINEL);
    assert.equal(envelope?.password, PASSWORD_SENTINEL);

    const pending = await loadLocalAuthMaterial({ workspaceRoot });
    assert.equal(pending.firstRunPending, true);
    assert.equal(pending.credentialsAcknowledged, false);

    const acknowledged = await acknowledgeLocalOperatorFirstRun(workspaceRoot);
    assert.equal(acknowledged, true);
    clearLocalAuthMaterialCache();
    assert.equal(await readFirstRunEnvelope(workspaceRoot), null);
    const afterAck = await loadLocalAuthMaterial({ workspaceRoot });
    assert.equal(afterAck.firstRunPending, false);
    assert.equal(afterAck.credentialsAcknowledged, true);
    assert.equal(await acknowledgeLocalOperatorFirstRun(workspaceRoot), false);
  } finally {
    clearLocalAuthMaterialCache();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("legacy auth state without envelope defaults to acknowledged", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-legacy-auth-"));
  try {
    await writeLocalOperatorAuthState(workspaceRoot, {
      token: TOKEN_SENTINEL,
      password: PASSWORD_SENTINEL,
      credentialsAcknowledged: true,
    });
    const statePath = path.join(workspaceRoot, ".service-lasso", "local-operator-auth.json");
    const parsed = JSON.parse(await readFile(statePath, "utf8"));
    delete parsed.credentialsAcknowledged;
    await writeFile(statePath, `${JSON.stringify(parsed, null, 2)}\n`);
    const state = await readLocalOperatorAuthState(workspaceRoot);
    assert.equal(state?.credentialsAcknowledged, true);
    assert.equal(await readFirstRunEnvelope(workspaceRoot), null);
    clearLocalAuthMaterialCache();
    const material = await loadLocalAuthMaterial({ workspaceRoot });
    assert.equal(material.credentialsAcknowledged, true);
    assert.equal(material.firstRunPending, false);
  } finally {
    clearLocalAuthMaterialCache();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("first-run seed writes a pending envelope without logging sentinels", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-first-run-seed-"));
  try {
    const material = await ensureLocalOperatorAuth({
      workspaceRoot,
      servicesRoot: path.join(workspaceRoot, "services"),
      env: { NODE_TEST_CONTEXT: "1" },
    });
    assert.equal(material.firstRunPending, true);
    assert.equal(material.credentialsAcknowledged, false);
    const envelope = await readFirstRunEnvelope(workspaceRoot);
    assert.equal(envelope?.username, LOCAL_OPERATOR_USERNAME);
    assert.equal(typeof envelope?.token, "string");
    assert.equal(typeof envelope?.password, "string");
    assert.ok((envelope?.token ?? "").length >= 32);
    assert.ok((envelope?.password ?? "").length >= 32);
    assert.equal((envelope?.token ?? "").includes(TOKEN_SENTINEL), false);
  } finally {
    clearLocalAuthMaterialCache();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

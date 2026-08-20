import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import {
  clearLocalAuthSessions,
  materialFromState,
  readLocalOperatorAuthState,
  writeLocalOperatorAuthState,
} from "../dist/runtime/auth/local-auth-store.js";
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

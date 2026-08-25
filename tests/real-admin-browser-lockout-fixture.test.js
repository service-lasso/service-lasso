import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BROKER_LOCKOUT_INVALID_ATTEMPTS,
  BrokerLockoutFixtureError,
  classifyBrokerLockoutAttempt,
  createSafeLockoutFixtureDiagnostic,
  requestBrokerLockoutWithToken,
} from "./fixtures/real-admin-browser-lockout.mjs";

function typed401() {
  return {
    statusCode: 401,
    body: {
      error: {
        code: "unauthorized",
        outcome: "policy_denied",
        nextAction: "authenticate_local_session",
      },
    },
  };
}

function typed423() {
  return {
    statusCode: 423,
    body: {
      error: {
        code: "lockout_active",
        outcome: "policy_denied",
        nextAction: "wait_or_clear_lockout",
        lockoutActive: true,
        lockoutScope: "local_api:fixture",
      },
    },
  };
}

async function withSocketServer(handler, run) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-lockout-request-"));
  const socketPath = process.platform === "win32"
    ? `\\\\.\\pipe\\service-lasso-lockout-${process.pid}-${Date.now()}`
    : path.join(tempRoot, "broker.sock");
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  try {
    return await run(socketPath);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test("lockout fixture preserves the exact three-attempt typed Broker contract", () => {
  assert.equal(BROKER_LOCKOUT_INVALID_ATTEMPTS, 3);
  assert.deepEqual(classifyBrokerLockoutAttempt(typed401(), 1), { state: "progressing" });
  assert.deepEqual(classifyBrokerLockoutAttempt(typed401(), 2), { state: "progressing" });
  assert.deepEqual(classifyBrokerLockoutAttempt(typed423(), 3), {
    state: "locked",
    lockoutScope: "local_api:fixture",
  });

  for (const invalid of [
    { ...typed401(), statusCode: 403 },
    { ...typed401(), body: { error: { ...typed401().body.error, nextAction: "retry" } } },
    { ...typed423(), body: { error: { ...typed423().body.error, lockoutScope: "remote_api:fixture" } } },
  ]) {
    assert.throws(
      () => classifyBrokerLockoutAttempt(invalid, invalid.statusCode === 423 ? 3 : 1),
      (error) => error instanceof BrokerLockoutFixtureError &&
        error.code === "broker_lockout_contract_mismatch"
    );
  }
  assert.throws(
    () => classifyBrokerLockoutAttempt(typed401(), 0),
    (error) => error.code === "broker_lockout_contract_mismatch"
  );
});

test("lockout Broker request retains bounded JSON parsing", async () => {
  await withSocketServer((_request, response) => {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify(typed401().body));
  }, async (socketPath) => {
    const result = await requestBrokerLockoutWithToken(
      { transport: { socketPath } },
      "invalid-token-sentinel",
      { timeoutMs: 500 }
    );
    assert.deepEqual(result, typed401());
  });

  await withSocketServer((_request, response) => {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end("not-json");
  }, async (socketPath) => {
    await assert.rejects(
      requestBrokerLockoutWithToken(
        { transport: { socketPath } },
        "invalid-token-sentinel",
        { timeoutMs: 500 }
      ),
      (error) => error.code === "broker_lockout_response_invalid_json"
    );
  });

  await withSocketServer((_request, response) => {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "x".repeat(1024) }));
  }, async (socketPath) => {
    await assert.rejects(
      requestBrokerLockoutWithToken(
        { transport: { socketPath } },
        "invalid-token-sentinel",
        { timeoutMs: 500, maxResponseBytes: 128 }
      ),
      (error) => error.code === "broker_lockout_response_too_large"
    );
  });
});

test("lockout request timeout emits metadata-only diagnostics", async () => {
  const token = "invalid-token-must-not-leak";
  await withSocketServer(() => {}, async (socketPath) => {
    let failure;
    await assert.rejects(
      requestBrokerLockoutWithToken(
        { transport: { socketPath } },
        token,
        { timeoutMs: 25 }
      ),
      (error) => {
        failure = error;
        return error.code === "broker_lockout_request_timeout";
      }
    );
    const diagnostic = createSafeLockoutFixtureDiagnostic(failure, {
      phase: "invalid_attempt",
      attempt: 2,
      statusCode: null,
    });
    assert.deepEqual(diagnostic, {
      phase: "invalid_attempt",
      attempt: 2,
      statusCode: null,
      failureCode: "broker_lockout_request_timeout",
    });
    const serialized = JSON.stringify(diagnostic);
    assert.equal(serialized.includes(token), false);
    assert.equal(serialized.includes(socketPath), false);
  });

  const untrusted = Object.assign(new Error("raw provider error with secret material"), {
    code: "raw_provider_failure",
  });
  assert.deepEqual(createSafeLockoutFixtureDiagnostic(untrusted, {
    phase: "raw-provider-phase",
    attempt: -1,
    statusCode: 999,
  }), {
    phase: "unknown",
    attempt: null,
    statusCode: null,
    failureCode: "broker_lockout_request_failed",
  });
});

test("lockout request bounds defeat drip and no-end responses", async () => {
  await withSocketServer((_request, response) => {
    response.writeHead(401, { "Content-Type": "application/json" });
    const timer = setInterval(() => response.write("x"), 10);
    response.once("close", () => clearInterval(timer));
  }, async (socketPath) => {
    const startedAt = Date.now();
    await assert.rejects(
      requestBrokerLockoutWithToken(
        { transport: { socketPath } },
        "invalid-token-sentinel",
        { timeoutMs: 50, maxResponseBytes: 1024 }
      ),
      (error) => error.code === "broker_lockout_request_timeout"
    );
    assert.ok(Date.now() - startedAt < 500);
  });

  await withSocketServer((_request, response) => {
    response.writeHead(401, { "Content-Type": "application/json" });
    const timer = setInterval(() => response.write("0123456789"), 5);
    response.once("close", () => clearInterval(timer));
  }, async (socketPath) => {
    const startedAt = Date.now();
    await assert.rejects(
      requestBrokerLockoutWithToken(
        { transport: { socketPath } },
        "invalid-token-sentinel",
        { timeoutMs: 500, maxResponseBytes: 32 }
      ),
      (error) => error.code === "broker_lockout_response_too_large"
    );
    assert.ok(Date.now() - startedAt < 500);
  });
});

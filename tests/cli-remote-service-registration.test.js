import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  CLI_LOCAL_ADMIN_TOKEN_ENV,
  readReleasedServiceRegistrationOperationFromCli,
  registerReleasedServiceFromCli,
} from "../dist/runtime/cli/remote-service-registration.js";

const request = {
  repo: "service-lasso/lasso-node",
  tag: "v1.0.0",
  expectedCommit: "a".repeat(40),
  expectedManifestSha256: "b".repeat(64),
  idempotencyKey: "cli-registration-0001",
};

function operation(overrides = {}) {
  return {
    id: "sro_0123456789abcdef0123456789abcdef",
    kind: "service_registration",
    status: "completed",
    replayed: false,
    actorId: "local-admin-token",
    repo: request.repo,
    tag: request.tag,
    sourceCommit: request.expectedCommit,
    serviceId: "remote-registered-service",
    version: "1.0.0",
    createdAt: "2026-09-30T00:00:00.000Z",
    completedAt: "2026-09-30T00:00:01.000Z",
    errorCode: null,
    ...overrides,
  };
}

async function startContractServer() {
  const received = [];
  const server = createServer(async (incoming, outgoing) => {
    let body = "";
    for await (const chunk of incoming) body += chunk;
    received.push({ method: incoming.method, url: incoming.url, token: incoming.headers["x-service-lasso-admin-token"], body });
    if (incoming.headers["x-service-lasso-admin-token"] !== "cli-test-token") {
      outgoing.writeHead(401, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: "remote_auth_required", message: "credential must never be echoed" }));
      return;
    }
    if (incoming.method === "GET") {
      outgoing.writeHead(404, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: "operation_not_found", message: "safe server detail" }));
      return;
    }
    const parsed = JSON.parse(body);
    if (parsed.idempotencyKey === "cli-registration-conflict") {
      outgoing.writeHead(409, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ operation: operation({ status: "conflict", errorCode: "target_manifest_exists" }) }));
      return;
    }
    const replayed = received.filter((item) => item.method === "POST").length > 1;
    outgoing.writeHead(replayed ? 200 : 201, { "content-type": "application/json" });
    outgoing.end(JSON.stringify({ operation: operation({ replayed }) }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    received,
    stop: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("remote registration CLI sends only the existing release contract and safely reports replay/conflict", async () => {
  const server = await startContractServer();
  const previous = process.env[CLI_LOCAL_ADMIN_TOKEN_ENV];
  process.env[CLI_LOCAL_ADMIN_TOKEN_ENV] = "cli-test-token";
  try {
    const first = await registerReleasedServiceFromCli({ apiBaseUrl: server.baseUrl, ...request });
    const replay = await registerReleasedServiceFromCli({ apiBaseUrl: server.baseUrl, ...request });
    const conflict = await registerReleasedServiceFromCli({ apiBaseUrl: server.baseUrl, ...request, idempotencyKey: "cli-registration-conflict" });

    assert.equal(first.ok, true);
    assert.equal(first.ok && first.statusCode, 201);
    assert.equal(replay.ok && replay.operation.replayed, true);
    assert.equal(conflict.ok, true);
    assert.equal(conflict.ok && conflict.operation.status, "conflict");
    assert.equal(server.received.every((item) => !item.body.includes("cli-test-token")), true);
    assert.deepEqual(JSON.parse(server.received[0].body), { ...request, confirm: true });
  } finally {
    if (previous === undefined) delete process.env[CLI_LOCAL_ADMIN_TOKEN_ENV]; else process.env[CLI_LOCAL_ADMIN_TOKEN_ENV] = previous;
    await server.stop();
  }
});

test("remote registration CLI returns typed safe HTTP denial and unknown-operation errors", async () => {
  const server = await startContractServer();
  const previous = process.env[CLI_LOCAL_ADMIN_TOKEN_ENV];
  process.env[CLI_LOCAL_ADMIN_TOKEN_ENV] = "wrong-token";
  try {
    const denied = await registerReleasedServiceFromCli({ apiBaseUrl: server.baseUrl, ...request });
    assert.deepEqual(denied, { action: "register", ok: false, statusCode: 401, error: "remote_auth_required" });
    assert.doesNotMatch(JSON.stringify(denied), /wrong-token|credential must never be echoed/i);

    process.env[CLI_LOCAL_ADMIN_TOKEN_ENV] = "cli-test-token";
    const unknown = await readReleasedServiceRegistrationOperationFromCli({
      apiBaseUrl: server.baseUrl,
      operationId: "sro_ffffffffffffffffffffffffffffffff",
    });
    assert.deepEqual(unknown, { action: "operation", ok: false, statusCode: 404, error: "operation_not_found" });
  } finally {
    if (previous === undefined) delete process.env[CLI_LOCAL_ADMIN_TOKEN_ENV]; else process.env[CLI_LOCAL_ADMIN_TOKEN_ENV] = previous;
    await server.stop();
  }
});

test("remote registration CLI fails closed before insecure transport or malformed request reaches HTTP", async () => {
  const previous = process.env[CLI_LOCAL_ADMIN_TOKEN_ENV];
  process.env[CLI_LOCAL_ADMIN_TOKEN_ENV] = "cli-test-token";
  try {
    await assert.rejects(
      registerReleasedServiceFromCli({ apiBaseUrl: "http://example.test", ...request }),
      /HTTPS unless its host is loopback/,
    );
    await assert.rejects(
      registerReleasedServiceFromCli({ apiBaseUrl: "https://example.test", ...request, expectedCommit: "not-a-commit" }),
      /expected-commit/,
    );
  } finally {
    if (previous === undefined) delete process.env[CLI_LOCAL_ADMIN_TOKEN_ENV]; else process.env[CLI_LOCAL_ADMIN_TOKEN_ENV] = previous;
  }
});

import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";

import {
  createSecretsBrokerLaunchLookup,
  createSecretsBrokerWriteback,
  requestSecretsBrokerManagement,
} from "../dist/runtime/broker/client.js";

const apiToken = "broker-test-token-with-at-least-32-bytes";
const service = {
  manifest: { id: "sample-service", broker: { enabled: true } },
  serviceRoot: "C:/redacted/service-root",
};
const identityLease = {
  issuer: "service-lasso-local-launcher",
  serviceId: "sample-service",
  allowedRefs: ["sample/API_TOKEN", "sample/MISSING"],
  allowedOperations: ["resolve"],
  issuedAt: "2026-08-14T00:00:00Z",
  expiresAt: "2026-08-14T00:05:00Z",
  jti: "test-jti",
  signature: "hmac-sha256:test-signature",
};

async function listen(server, target) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(target, "127.0.0.1", resolve);
  });
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

function responseServer(handler) {
  return http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    handler(request, response, Buffer.concat(chunks));
  });
}

test("production broker lookup authenticates, scopes, batches, and maps typed outcomes", async () => {
  const server = responseServer((request, response, body) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/resolve");
    assert.equal(request.headers["x-secretsbroker-token"], apiToken);
    const payload = JSON.parse(body.toString("utf8"));
    assert.equal(payload.workspaceId, "workspace-test");
    assert.equal(payload.serviceId, "sample-service");
    assert.deepEqual(payload.identityLease, identityLease);
    assert.deepEqual(payload.refs, ["sample/API_TOKEN", "sample/MISSING", "sample/LOCKED"]);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      requestId: payload.requestId,
      results: [
        { ref: "sample/API_TOKEN", outcome: "ready", value: "resolved-secret-sentinel" },
        { ref: "sample/MISSING", outcome: "missing_ref" },
        { ref: "sample/LOCKED", outcome: "locked" },
      ],
    }));
  });
  await listen(server, 0);
  try {
    const address = server.address();
    const lookup = createSecretsBrokerLaunchLookup({
      transport: { kind: "loopback-http", url: `http://127.0.0.1:${address.port}` },
      apiToken,
      workspaceId: "workspace-test",
    });
    assert.deepEqual(await lookup({
      service,
      refs: ["sample/API_TOKEN", "sample/MISSING", "sample/LOCKED", "sample/API_TOKEN"],
      identityLease,
    }), [
      { ref: "sample/API_TOKEN", status: "resolved", value: "resolved-secret-sentinel" },
      { ref: "sample/MISSING", status: "missing" },
      { ref: "sample/LOCKED", status: "locked" },
    ]);
  } finally {
    await close(server);
  }
});

test("broker lookup fails closed on missing lease, malformed contract, and raw remote error", async () => {
  let requests = 0;
  const rawRemoteSentinel = "remote-provider-secret-body-sentinel";
  const server = responseServer((_request, response, body) => {
    requests += 1;
    const payload = JSON.parse(body.toString("utf8"));
    if (requests === 1) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ requestId: payload.requestId, results: [{ ref: "unexpected/ref", outcome: "ready", value: rawRemoteSentinel }] }));
      return;
    }
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: rawRemoteSentinel, token: apiToken } }));
  });
  await listen(server, 0);
  try {
    const address = server.address();
    const lookup = createSecretsBrokerLaunchLookup({
      transport: { kind: "loopback-http", url: `http://127.0.0.1:${address.port}` },
      apiToken,
      workspaceId: "workspace-test",
    });
    assert.deepEqual(await lookup({ service, refs: ["sample/API_TOKEN"] }), [
      { ref: "sample/API_TOKEN", status: "degraded" },
    ]);
    assert.equal(requests, 0, "a missing scoped lease must fail before transport");

    const malformed = await lookup({ service, refs: ["sample/API_TOKEN"], identityLease });
    assert.deepEqual(malformed, [{ ref: "sample/API_TOKEN", status: "degraded" }]);
    const remoteFailure = await lookup({ service, refs: ["sample/API_TOKEN"], identityLease });
    assert.deepEqual(remoteFailure, [{ ref: "sample/API_TOKEN", status: "degraded" }]);
    assert.doesNotMatch(JSON.stringify([malformed, remoteFailure]), new RegExp(`${rawRemoteSentinel}|${apiToken}`));
  } finally {
    await close(server);
  }
});

test("broker lookup timeout is bounded and metadata-only", async () => {
  const server = responseServer((_request, response) => {
    setTimeout(() => {
      if (!response.destroyed) response.end("late-secret-sentinel");
    }, 1_000).unref();
  });
  await listen(server, 0);
  try {
    const address = server.address();
    const lookup = createSecretsBrokerLaunchLookup({
      transport: { kind: "loopback-http", url: `http://127.0.0.1:${address.port}` },
      apiToken,
      workspaceId: "workspace-test",
      timeoutMs: 100,
    });
    const started = Date.now();
    assert.deepEqual(await lookup({ service, refs: ["sample/API_TOKEN"], identityLease }), [
      { ref: "sample/API_TOKEN", status: "degraded" },
    ]);
    assert.ok(Date.now() - started < 750);
  } finally {
    server.closeAllConnections();
    await close(server);
  }
});

test("broker client supports the current platform authenticated IPC socket", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-broker-client-"));
  const socketPath = process.platform === "win32"
    ? `\\\\.\\pipe\\service-lasso-broker-client-${process.pid}-${Date.now()}`
    : path.join(tempRoot, "broker.sock");
  const server = responseServer((_request, response, body) => {
    const payload = JSON.parse(body.toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ requestId: payload.requestId, results: [{ ref: "sample/API_TOKEN", outcome: "ready", value: "socket-secret" }] }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  try {
    const lookup = createSecretsBrokerLaunchLookup({
      transport: process.platform === "win32"
        ? { kind: "windows-named-pipe", socketPath }
        : { kind: "unix-socket", socketPath },
      apiToken,
      workspaceId: "workspace-test",
    });
    assert.deepEqual(await lookup({ service, refs: ["sample/API_TOKEN"], identityLease }), [
      { ref: "sample/API_TOKEN", status: "resolved", value: "socket-secret" },
    ]);
  } finally {
    await close(server);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("production writeback sends a scoped lease and validates metadata-only correlation", async () => {
  const secret = "generated-writeback-secret-sentinel";
  const server = responseServer((request, response, body) => {
    assert.equal(request.url, "/v1/writeback");
    assert.equal(request.headers["x-secretsbroker-token"], apiToken);
    const payload = JSON.parse(body.toString("utf8"));
    assert.equal(payload.identity.serviceId, "sample-service");
    assert.deepEqual(payload.identityLease, identityLease);
    assert.equal(payload.value, secret);
    assert.equal(payload.namespace, "services/sample-service");
    assert.equal(payload.ref, "runtime/API_TOKEN");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      serviceId: "@secretsbroker",
      requestId: payload.requestId,
      ownerServiceId: "sample-service",
      ref: "services/sample-service/runtime/API_TOKEN",
      outcome: "ready",
    }));
  });
  await listen(server, 0);
  try {
    const address = server.address();
    const writeback = createSecretsBrokerWriteback({
      transport: { kind: "loopback-http", url: `http://127.0.0.1:${address.port}` },
      apiToken,
      workspaceId: "workspace-test",
    });
    assert.deepEqual(await writeback({
      serviceId: "sample-service",
      identityExpiresAt: identityLease.expiresAt,
      identityLease,
      namespace: "services/sample-service",
      ref: "runtime/API_TOKEN",
      operation: "create",
      allowedNamespaces: ["services/sample-service"],
      allowedOperations: ["create"],
      value: secret,
    }), {
      ok: true,
      outcome: "ready",
      ref: "services/sample-service/runtime/API_TOKEN",
    });
  } finally {
    await close(server);
  }
});

test("broker client rejects public, credentialed, and malformed transports", () => {
  assert.throws(() => createSecretsBrokerLaunchLookup({
    transport: { kind: "loopback-http", url: "https://broker.example.test" },
    apiToken,
    workspaceId: "workspace-test",
  }), /loopback/i);
  assert.throws(() => createSecretsBrokerLaunchLookup({
    transport: { kind: "loopback-http", url: "http://user:pass@127.0.0.1:17890" },
    apiToken,
    workspaceId: "workspace-test",
  }), /loopback/i);
  assert.throws(() => createSecretsBrokerLaunchLookup({
    transport: { kind: "windows-named-pipe", socketPath: "C:/not-a-pipe" },
    apiToken,
    workspaceId: "workspace-test",
  }), /pipe namespace/i);
  assert.throws(() => createSecretsBrokerLaunchLookup({
    transport: { kind: "loopback-http", url: "http://127.0.0.1:17890" },
    apiToken: "short",
    workspaceId: "workspace-test",
  }), /token/i);
});

test("broker management client proxies only allowlisted JSON operations over authenticated IPC", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-broker-management-"));
  const socketPath = process.platform === "win32"
    ? `\\\\.\\pipe\\service-lasso-broker-management-${process.pid}-${Date.now()}`
    : path.join(tempRoot, "broker.sock");
  const server = responseServer((request, response, body) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/management/secrets/edit/dry-run");
    assert.equal(request.headers["x-secretsbroker-token"], apiToken);
    assert.deepEqual(JSON.parse(body.toString("utf8")), {
      requestId: "request-1",
      serviceId: "@serviceadmin",
      ref: "services/sample/runtime/API_TOKEN",
      reason: "operator maintenance",
    });
    response.writeHead(409, { "content-type": "application/json" });
    response.end(JSON.stringify({
      serviceId: "@secretsbroker",
      requestId: "request-1",
      outcome: "locked",
      applied: false,
    }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  try {
    const result = await requestSecretsBrokerManagement({
      transport: process.platform === "win32"
        ? { kind: "windows-named-pipe", socketPath }
        : { kind: "unix-socket", socketPath },
      apiToken,
      workspaceId: "workspace-test",
    }, {
      method: "POST",
      path: "/v1/management/secrets/edit/dry-run",
      body: {
        requestId: "request-1",
        serviceId: "@serviceadmin",
        ref: "services/sample/runtime/API_TOKEN",
        reason: "operator maintenance",
      },
    });
    assert.deepEqual(result, {
      statusCode: 409,
      body: {
        serviceId: "@secretsbroker",
        requestId: "request-1",
        outcome: "locked",
        applied: false,
      },
    });
  } finally {
    await close(server);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("broker management client allowlists every decommission and rotation operation exposed by Core", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-broker-lifecycle-routes-"));
  const socketPath = process.platform === "win32"
    ? `\\\\.\\pipe\\service-lasso-broker-lifecycle-routes-${process.pid}-${Date.now()}`
    : path.join(tempRoot, "broker.sock");
  const observed = [];
  const server = responseServer((request, response) => {
    observed.push(`${request.method} ${request.url}`);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ outcome: "ready" }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  const paths = [
    "/v1/management/secrets/decommission/dry-run",
    "/v1/management/secrets/decommission/apply",
    "/v1/management/secrets/decommission/restore",
    "/v1/management/secrets/rotation/dry-run",
    "/v1/management/secrets/rotation/status",
    "/v1/management/secrets/rotation/stage",
    "/v1/management/secrets/rotation/activate",
    "/v1/management/secrets/rotation/rollback",
    "/v1/management/secrets/rotation/retire",
  ];
  try {
    for (const route of paths) {
      await requestSecretsBrokerManagement({
        transport: process.platform === "win32"
          ? { kind: "windows-named-pipe", socketPath }
          : { kind: "unix-socket", socketPath },
        apiToken,
        workspaceId: "workspace-test",
      }, { method: "POST", path: route, body: {} });
    }
    assert.deepEqual(observed, paths.map((route) => `POST ${route}`));
  } finally {
    await close(server);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("broker management client rejects arbitrary routes, query injection, and non-JSON responses", async () => {
  const transport = { kind: "loopback-http", url: "http://127.0.0.1:17890" };
  const options = { transport, apiToken, workspaceId: "workspace-test", timeoutMs: 100 };
  await assert.rejects(
    requestSecretsBrokerManagement(options, { method: "GET", path: "/v1/secrets" }),
    /allowlisted/i,
  );
  await assert.rejects(
    requestSecretsBrokerManagement(options, {
      method: "GET",
      path: "/v1/management/secrets?redirect=https://example.test",
    }),
    /query/i,
  );
  await assert.rejects(
    requestSecretsBrokerManagement(options, {
      method: "GET",
      path: "/v1/events?limit=25&limit=50",
    }),
    /query/i,
  );
  await assert.rejects(
    requestSecretsBrokerManagement(options, {
      method: "GET",
      path: "/v1/events?cursor=-1",
    }),
    /query/i,
  );

  const server = responseServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("raw-provider-error-secret-sentinel");
  });
  await listen(server, 0);
  try {
    const address = server.address();
    await assert.rejects(
      requestSecretsBrokerManagement({
        transport: { kind: "loopback-http", url: `http://127.0.0.1:${address.port}` },
        apiToken,
        workspaceId: "workspace-test",
      }, { method: "GET", path: "/v1/providers/capabilities" }),
      /not JSON/i,
    );
  } finally {
    await close(server);
  }
});

test("broker management client allows bounded operational telemetry and event reads", async () => {
  const observed = [];
  const server = responseServer((request, response) => {
    observed.push(`${request.method} ${request.url}`);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ serviceId: "@secretsbroker", outcome: "ready" }));
  });
  await listen(server, 0);
  try {
    const address = server.address();
    const options = {
      transport: { kind: "loopback-http", url: `http://127.0.0.1:${address.port}` },
      apiToken,
      workspaceId: "workspace-test",
    };
    await requestSecretsBrokerManagement(options, {
      method: "GET",
      path: "/v1/telemetry",
    });
    await requestSecretsBrokerManagement(options, {
      method: "GET",
      path: "/v1/events?severity=warning&family=auth_failure&limit=25&cursor=0",
    });
    assert.deepEqual(observed, [
      "GET /v1/telemetry",
      "GET /v1/events?severity=warning&family=auth_failure&limit=25&cursor=0",
    ]);
  } finally {
    await close(server);
  }
});

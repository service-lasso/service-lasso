import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { startApiServer } from "../dist/server/index.js";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";
import {
  buildSecretsBrokerRuntimeEnv,
  resolveSecretsBrokerDataPaths,
  writeSecretsBrokerOperatorConfig,
} from "../dist/runtime/broker/operator-config.js";
import { resolveSecretsBrokerAdminAliasPath } from "../dist/runtime/broker/proxy.js";

/**
 * Fetch JSON from a Core API URL.
 *
 * @param {string} url
 * @param {Record<string, string>} [headers]
 */
async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  return {
    status: response.status,
    body: await response.json(),
  };
}

/**
 * POST JSON to a Core API URL and parse the JSON response.
 *
 * @param {string} url
 * @param {Record<string, unknown>} body
 */
async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

/**
 * Start a loopback mock Secrets Broker that records auth and returns operator payloads.
 *
 * @param {{ stateBody?: Record<string, unknown>, expectedToken?: string }} [options]
 */
async function startMockBroker(options = {}) {
  const {
    stateBody = {
      serviceId: "@secretsbroker",
      apiVersion: "secretsbroker.local/v1",
      state: "ready",
      ready: true,
      outcome: "ready",
      keyState: "ready",
      nextAction: "none",
      affectedRefs: [],
      affectedServices: [],
    },
    expectedToken = "broker-test-token",
  } = options;

  const seen = {
    authorization: null,
    method: null,
    url: null,
    body: null,
  };
  const server = createServer((request, response) => {
    seen.authorization = request.headers.authorization ?? null;
    seen.method = request.method ?? "GET";
    seen.url = request.url ?? "";

    const writeJson = (status, payload) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    };

    const withBody = (handler) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        seen.body = raw ? JSON.parse(raw) : null;
        handler(seen.body);
      });
    };

    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname;

    if (pathname === "/state") {
      writeJson(200, stateBody);
      return;
    }

    if (pathname === "/v1/providers/config/status") {
      if (seen.authorization !== `Bearer ${expectedToken}`) {
        writeJson(503, {
          error: {
            code: "security_not_configured",
            message: "missing token",
          },
        });
        return;
      }
      writeJson(200, {
        serviceId: "@secretsbroker",
        outcome: "ready",
        currentProvider: {
          providerId: "local",
          providerKind: "local-encrypted-store",
          state: "connected",
        },
      });
      return;
    }

    if (pathname === "/v1/telemetry") {
      writeJson(200, {
        serviceId: "@secretsbroker",
        outcome: "ready",
        metrics: [{ name: "broker.requests", value: 1 }],
      });
      return;
    }

    if (pathname === "/v1/events") {
      writeJson(200, {
        serviceId: "@secretsbroker",
        outcome: "ready",
        events: [],
      });
      return;
    }

    if (request.method === "POST" && pathname === "/v1/management/secrets/reveal") {
      withBody((body) => {
        writeJson(200, {
          serviceId: "@secretsbroker",
          outcome: "ready",
          ref: body?.ref ?? null,
          revealed: false,
          valuePresent: true,
        });
      });
      return;
    }

    if (request.method === "POST" && pathname === "/v1/management/secrets/edit/dry-run") {
      withBody((body) => {
        writeJson(200, {
          serviceId: "@secretsbroker",
          outcome: "ready",
          ref: body?.ref ?? null,
          mode: "dry-run",
        });
      });
      return;
    }

    if (request.method === "POST" && pathname === "/v1/management/secrets/rotation/dry-run") {
      withBody((body) => {
        writeJson(200, {
          serviceId: "@secretsbroker",
          outcome: "ready",
          ref: body?.ref ?? null,
          mode: "dry-run",
        });
      });
      return;
    }

    if (pathname === "/v1/management/secrets") {
      writeJson(200, {
        serviceId: "@secretsbroker",
        outcome: "ready",
        results: [],
      });
      return;
    }

    if (pathname === "/v1/management/lifecycle/status") {
      writeJson(200, {
        serviceId: "@secretsbroker",
        outcome: "ready",
        key: { available: true, keyId: "mk-test", keyVersion: "v1", secretCount: 0 },
      });
      return;
    }

    if (request.method === "POST" && pathname === "/v1/management/lifecycle/backups") {
      withBody(() => {
        writeJson(200, {
          serviceId: "@secretsbroker",
          outcome: "ready",
          applied: true,
          backup: { backupId: "backup-test" },
        });
      });
      return;
    }

    if (request.method === "POST" && pathname === "/v1/providers/config/validate") {
      withBody((body) => {
        writeJson(200, {
          serviceId: "@secretsbroker",
          outcome: "ready",
          operation: "validate",
          applied: false,
          providerId: body?.providerId ?? null,
        });
      });
      return;
    }

    if (request.method === "POST" && pathname === "/v1/providers/migration/dry-run") {
      withBody((body) => {
        writeJson(200, {
          serviceId: "@secretsbroker",
          outcome: "ready",
          sourceProvider: body?.sourceProvider ?? null,
          targetProvider: body?.targetProvider ?? null,
        });
      });
      return;
    }

    writeJson(404, { error: "not_found" });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    port: address.port,
    seen: () => seen,
    seenAuthorization: () => seen.authorization,
    expectedToken,
    stop: async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

test("resolveSecretsBrokerAdminAliasPath maps Admin 478 routes onto Broker /v1 paths", () => {
  assert.equal(resolveSecretsBrokerAdminAliasPath("secrets/management"), "/v1/management/secrets");
  assert.equal(resolveSecretsBrokerAdminAliasPath("secrets/reveal"), "/v1/management/secrets/reveal");
  assert.equal(
    resolveSecretsBrokerAdminAliasPath("secrets/rotation/dry-run"),
    "/v1/management/secrets/rotation/dry-run",
  );
  assert.equal(
    resolveSecretsBrokerAdminAliasPath("providers/config/status"),
    "/v1/providers/config/status",
  );
  assert.equal(
    resolveSecretsBrokerAdminAliasPath("providers/migration/dry-run"),
    "/v1/providers/migration/dry-run",
  );
  assert.equal(
    resolveSecretsBrokerAdminAliasPath("lifecycle/status"),
    "/v1/management/lifecycle/status",
  );
  assert.equal(
    resolveSecretsBrokerAdminAliasPath("lifecycle/backups/create"),
    "/v1/management/lifecycle/backups",
  );
  assert.equal(resolveSecretsBrokerAdminAliasPath("operations/telemetry"), "/v1/telemetry");
  assert.equal(resolveSecretsBrokerAdminAliasPath("operations/events"), "/v1/events");
  assert.equal(resolveSecretsBrokerAdminAliasPath("meta"), null);
});

test("GET /api/services/@secretsbroker/proxy/state forwards broker metadata with operator token", async () => {
  const mockBroker = await startMockBroker();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-broker-proxy-");
  const serviceRoot = await writeManifest(servicesRoot, "@secretsbroker", {
    id: "@secretsbroker",
    name: "Secrets Broker",
    description: "Broker proxy fixture.",
    version: "2026.8.18-test",
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    ports: {
      service: mockBroker.port,
    },
    healthcheck: { type: "process" },
  });

  const paths = resolveSecretsBrokerDataPaths(serviceRoot);
  await mkdir(paths.brokerStateDir, { recursive: true });
  await writeSecretsBrokerOperatorConfig(serviceRoot, {
    version: 1,
    storePath: paths.storePath,
    auditPath: paths.auditPath,
    masterKeyFile: paths.masterKeyFile,
    apiToken: mockBroker.expectedToken,
    initializedAt: new Date().toISOString(),
  });

  const apiServer = await startApiServer({
    port: 0,
    servicesRoot,
    workspaceRoot,
    version: "test-version",
  });

  try {
    const result = await getJson(`${apiServer.url}/api/services/%40secretsbroker/proxy/state`);
    assert.equal(result.status, 200);
    assert.equal(result.body.state, "ready");
    assert.equal(result.body.ready, true);
    assert.equal(mockBroker.seenAuthorization(), `Bearer ${mockBroker.expectedToken}`);
  } finally {
    await apiServer.stop();
    await mockBroker.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("buildSecretsBrokerRuntimeEnv exposes ready state and broker paths", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-broker-env-");
  const serviceRoot = path.join(servicesRoot, "@secretsbroker");
  await mkdir(serviceRoot, { recursive: true });
  const paths = resolveSecretsBrokerDataPaths(serviceRoot);
  const config = {
    version: 1,
    storePath: paths.storePath,
    auditPath: paths.auditPath,
    masterKeyFile: paths.masterKeyFile,
    apiToken: "token-123",
    initializedAt: "2026-08-18T00:00:00.000Z",
  };

  const env = buildSecretsBrokerRuntimeEnv(config, paths);
  assert.equal(env.SECRETSBROKER_STATE, "ready");
  assert.equal(env.SECRETSBROKER_API_TOKEN, "token-123");
  assert.equal(env.SECRETSBROKER_STORE_PATH, paths.storePath);
  assert.equal(env.SECRETSBROKER_MASTER_KEY_FILE, paths.masterKeyFile);

  await rm(tempRoot, { recursive: true, force: true });
});

test("Core proxy E2E covers reveal, edit, rotate, provider, migration, and telemetry", async () => {
  const mockBroker = await startMockBroker();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-broker-operator-e2e-");
  const serviceRoot = await writeManifest(servicesRoot, "@secretsbroker", {
    id: "@secretsbroker",
    name: "Secrets Broker",
    description: "Operator E2E fixture.",
    version: "2026.8.18-test",
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    ports: {
      service: mockBroker.port,
    },
    healthcheck: { type: "process" },
  });

  const paths = resolveSecretsBrokerDataPaths(serviceRoot);
  await mkdir(paths.brokerStateDir, { recursive: true });
  await writeSecretsBrokerOperatorConfig(serviceRoot, {
    version: 1,
    storePath: paths.storePath,
    auditPath: paths.auditPath,
    masterKeyFile: paths.masterKeyFile,
    apiToken: mockBroker.expectedToken,
    initializedAt: new Date().toISOString(),
  });

  const apiServer = await startApiServer({
    port: 0,
    servicesRoot,
    workspaceRoot,
    version: "test-version",
  });
  const proxy = `${apiServer.url}/api/services/%40secretsbroker/proxy`;

  try {
    const provider = await getJson(`${proxy}/v1/providers/config/status`);
    assert.equal(provider.status, 200);
    assert.equal(provider.body.outcome, "ready");
    assert.equal(provider.body.currentProvider.providerId, "local");

    const telemetry = await getJson(`${proxy}/v1/telemetry`);
    assert.equal(telemetry.status, 200);
    assert.equal(telemetry.body.outcome, "ready");
    assert.equal(Array.isArray(telemetry.body.metrics), true);

    const events = await getJson(`${proxy}/v1/events`);
    assert.equal(events.status, 200);
    assert.equal(Array.isArray(events.body.events), true);

    const reveal = await postJson(`${proxy}/v1/management/secrets/reveal`, {
      ref: "services/api/runtime/API_TOKEN",
      reason: "operator e2e",
      confirm: true,
      noEcho: true,
    });
    assert.equal(reveal.status, 200);
    assert.equal(reveal.body.outcome, "ready");
    assert.equal(reveal.body.revealed, false);
    assert.equal(JSON.stringify(reveal.body).includes("raw-secret"), false);

    const edit = await postJson(`${proxy}/v1/management/secrets/edit/dry-run`, {
      ref: "services/api/runtime/API_TOKEN",
    });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.mode, "dry-run");

    const rotate = await postJson(`${proxy}/v1/management/secrets/rotation/dry-run`, {
      ref: "services/api/runtime/API_TOKEN",
    });
    assert.equal(rotate.status, 200);
    assert.equal(rotate.body.mode, "dry-run");

    const migration = await postJson(`${proxy}/v1/providers/migration/dry-run`, {
      sourceProvider: "local",
      targetProvider: "local",
    });
    assert.equal(migration.status, 200);
    assert.equal(migration.body.sourceProvider, "local");

    const base = `${apiServer.url}/api/services/%40secretsbroker`;
    const listed = await getJson(`${base}/secrets/management`);
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    assert.equal(Array.isArray(listed.body.results), true);

    const aliasedReveal = await postJson(`${base}/secrets/reveal`, {
      ref: "services/api/runtime/API_TOKEN",
      reason: "admin alias e2e",
      confirm: true,
      noEcho: true,
    });
    assert.equal(aliasedReveal.status, 200);
    assert.equal(aliasedReveal.body.revealed, false);

    const aliasedProvider = await getJson(`${base}/providers/config/status`);
    assert.equal(aliasedProvider.status, 200);
    assert.equal(aliasedProvider.body.currentProvider.providerId, "local");

    const aliasedMigration = await postJson(`${base}/providers/migration/dry-run`, {
      sourceProvider: "local",
      targetProvider: "local",
    });
    assert.equal(aliasedMigration.status, 200);

    const aliasedLifecycle = await getJson(`${base}/lifecycle/status`);
    assert.equal(aliasedLifecycle.status, 200);
    assert.equal(aliasedLifecycle.body.key.available, true);

    const aliasedTelemetry = await getJson(`${base}/operations/telemetry`);
    assert.equal(aliasedTelemetry.status, 200);
    assert.equal(mockBroker.seenAuthorization(), `Bearer ${mockBroker.expectedToken}`);
    assert.equal(mockBroker.seen().url?.startsWith("/v1/"), true);
  } finally {
    await apiServer.stop();
    await mockBroker.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

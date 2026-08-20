import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startApiServer } from "../dist/server/index.js";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";
import {
  NAMED_PIPE_ENV,
  UNIX_SOCKET_ENV,
  readSecretsBrokerOperatorConfig,
  resolveSecretsBrokerDataPaths,
  resolveSecretsBrokerTransport,
  writeSecretsBrokerOperatorConfig,
} from "../dist/runtime/broker/operator-config.js";
import {
  isUnixSocketPath,
  isWindowsNamedPipePath,
  parseSecretsBrokerOperatorIpc,
  requestSecretsBrokerHttp,
  SECRETSBROKER_IPC_MAX_BYTES,
} from "../dist/runtime/broker/ipc-transport.js";
import { ApiError } from "../dist/server/errors.js";

const SENTINEL_TOKEN = "broker-ipc-sentinel-token";
const SENTINEL_REF = "runtime/local-operator";

/**
 * Restore a process env key after a test mutates it.
 *
 * @param {string} key
 * @param {string | undefined} prior
 */
function restoreEnv(key, prior) {
  if (prior === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = prior;
}

/**
 * Start an HTTP mock Broker on a named pipe or Unix socket. Payloads are metadata sentinels only.
 *
 * @param {string} socketPath
 */
async function startIpcMockBroker(socketPath) {
  const seen = {
    authorization: /** @type {string | null} */ (null),
    url: /** @type {string | null} */ (null),
  };
  const server = createServer((request, response) => {
    seen.authorization = request.headers.authorization ?? null;
    seen.url = request.url ?? "";
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const writeJson = (status, payload) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    };

    if (pathname === "/state") {
      writeJson(200, { state: "ready", ready: true, outcome: "ready" });
      return;
    }

    if (pathname.startsWith("/v1/kv/metadata")) {
      writeJson(200, { data: { keys: ["runtime"] }, listOutcome: "ready" });
      return;
    }

    if (request.method === "POST" && pathname === "/v1/resolve") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        writeJson(200, {
          results: [{ ref: SENTINEL_REF, outcome: "ready", valuePresent: true }],
        });
      });
      return;
    }

    writeJson(404, { error: { code: "not_found", message: "missing" } });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });

  return {
    seen,
    async stop() {
      await new Promise((resolve) => {
        server.close(() => resolve(undefined));
      });
    },
  };
}

test("IPC path helpers accept named pipes and Unix sockets without host URLs", () => {
  assert.equal(isWindowsNamedPipePath("\\\\.\\pipe\\service-lasso-secretsbroker"), true);
  assert.equal(isWindowsNamedPipePath("C:\\\\pipe\\\\broker"), false);
  assert.equal(isUnixSocketPath("/run/service-lasso/secretsbroker.sock"), true);
  assert.equal(isUnixSocketPath("secretsbroker.sock"), false);
  assert.equal(
    parseSecretsBrokerOperatorIpc({
      kind: "windows-named-pipe",
      socketPath: "\\\\.\\pipe\\service-lasso-secretsbroker",
    })?.kind,
    "windows-named-pipe",
  );
  assert.equal(parseSecretsBrokerOperatorIpc({ kind: "windows-named-pipe", socketPath: "relative" }), undefined);
});

test("resolveSecretsBrokerTransport prefers named-pipe env over loopback port", () => {
  const prior = process.env[NAMED_PIPE_ENV];
  const pipeName = "\\\\.\\pipe\\service-lasso-resolver-sentinel";
  process.env[NAMED_PIPE_ENV] = pipeName;
  try {
    const target = resolveSecretsBrokerTransport(
      {
        serviceRoot: os.tmpdir(),
        manifest: { id: "@secretsbroker", ports: { service: 17890 } },
      },
      process.env,
      null,
    );
    assert.equal(target?.kind, "windows-named-pipe");
    if (target && target.kind === "windows-named-pipe") {
      assert.equal(target.socketPath, pipeName);
    }
  } finally {
    restoreEnv(NAMED_PIPE_ENV, prior);
  }
});

test("requestSecretsBrokerHttp rejects oversized bodies without naming the IPC path", async () => {
  const pipeName = `\\\\.\\pipe\\service-lasso-oversize-${randomBytes(6).toString("hex")}`;
  try {
    await requestSecretsBrokerHttp(
      { kind: "windows-named-pipe", socketPath: pipeName },
      {
        method: "POST",
        pathWithQuery: "/v1/kv/data/runtime",
        headers: { "content-type": "application/json" },
        body: Buffer.alloc(SECRETSBROKER_IPC_MAX_BYTES + 1, 0x61),
      },
    );
    assert.fail("expected oversized body to fail closed");
  } catch (error) {
    assert.equal(error instanceof ApiError, true);
    if (error instanceof ApiError) {
      assert.equal(error.statusCode, 413);
      assert.equal(error.message.includes(pipeName), false);
      assert.equal(error.message.includes("pipe"), false);
    }
  }
});

test("Core proxy and KV aliases speak Windows named-pipe HTTP", { skip: process.platform !== "win32" }, async () => {
  const pipeName = `\\\\.\\pipe\\service-lasso-ipc-${randomBytes(6).toString("hex")}`;
  const mock = await startIpcMockBroker(pipeName);
  const priorPipe = process.env[NAMED_PIPE_ENV];
  process.env[NAMED_PIPE_ENV] = pipeName;

  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-broker-ipc-");
  const serviceRoot = await writeManifest(servicesRoot, "@secretsbroker", {
    id: "@secretsbroker",
    name: "Secrets Broker",
    description: "IPC proxy fixture.",
    version: "2026.8.21-test",
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    ports: { service: 1 },
    healthcheck: { type: "process" },
  });

  const paths = resolveSecretsBrokerDataPaths(serviceRoot);
  await mkdir(paths.brokerStateDir, { recursive: true });
  await writeSecretsBrokerOperatorConfig(serviceRoot, {
    version: 1,
    storePath: paths.storePath,
    auditPath: paths.auditPath,
    masterKeyFile: paths.masterKeyFile,
    apiToken: SENTINEL_TOKEN,
    initializedAt: new Date().toISOString(),
    ipc: { kind: "windows-named-pipe", socketPath: pipeName },
  });

  const persisted = await readSecretsBrokerOperatorConfig(serviceRoot);
  assert.equal(persisted?.ipc?.kind, "windows-named-pipe");

  const apiServer = await startApiServer({
    port: 0,
    servicesRoot,
    workspaceRoot,
    version: "test-version",
  });

  try {
    const state = await fetch(`${apiServer.url}/api/services/%40secretsbroker/proxy/state`);
    const stateBody = await state.json();
    assert.equal(state.status, 200);
    assert.equal(stateBody.state, "ready");

    const kv = await fetch(
      `${apiServer.url}/api/services/%40secretsbroker/proxy/v1/kv/metadata/?source=local&list=true`,
    );
    const kvBody = await kv.json();
    assert.equal(kv.status, 200);
    assert.deepEqual(kvBody.data.keys, ["runtime"]);
    assert.equal(JSON.stringify(kvBody).includes(SENTINEL_TOKEN), false);
    assert.equal(mock.seen.authorization, `Bearer ${SENTINEL_TOKEN}`);
    assert.equal(String(mock.seen.url).startsWith("/v1/kv/metadata"), true);

    const resolveResult = await requestSecretsBrokerHttp(
      { kind: "windows-named-pipe", socketPath: pipeName },
      {
        method: "POST",
        pathWithQuery: "/v1/resolve",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${SENTINEL_TOKEN}`,
        },
        body: Buffer.from(JSON.stringify({ refs: [SENTINEL_REF] }), "utf8"),
      },
    );
    const resolveBody = JSON.parse(resolveResult.body.toString("utf8"));
    assert.equal(resolveResult.status, 200);
    assert.equal(resolveBody.results[0].ref, SENTINEL_REF);
    assert.equal(resolveBody.results[0].value, undefined);
    assert.equal(JSON.stringify(resolveBody).includes(SENTINEL_TOKEN), false);
  } finally {
    await apiServer.stop();
    await mock.stop();
    restoreEnv(NAMED_PIPE_ENV, priorPipe);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("Core proxy speaks Unix-socket HTTP", { skip: process.platform === "win32" }, async () => {
  const socketPath = path.join(os.tmpdir(), `service-lasso-ipc-${randomBytes(6).toString("hex")}.sock`);
  const mock = await startIpcMockBroker(socketPath);
  const priorSocket = process.env[UNIX_SOCKET_ENV];
  process.env[UNIX_SOCKET_ENV] = socketPath;

  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-broker-unix-");
  const serviceRoot = await writeManifest(servicesRoot, "@secretsbroker", {
    id: "@secretsbroker",
    name: "Secrets Broker",
    description: "Unix IPC proxy fixture.",
    version: "2026.8.21-test",
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    ports: { service: 1 },
    healthcheck: { type: "process" },
  });

  const paths = resolveSecretsBrokerDataPaths(serviceRoot);
  await mkdir(paths.brokerStateDir, { recursive: true });
  await writeSecretsBrokerOperatorConfig(serviceRoot, {
    version: 1,
    storePath: paths.storePath,
    auditPath: paths.auditPath,
    masterKeyFile: paths.masterKeyFile,
    apiToken: SENTINEL_TOKEN,
    initializedAt: new Date().toISOString(),
    ipc: { kind: "unix-socket", socketPath },
  });

  const apiServer = await startApiServer({
    port: 0,
    servicesRoot,
    workspaceRoot,
    version: "test-version",
  });

  try {
    const kv = await fetch(
      `${apiServer.url}/api/services/%40secretsbroker/proxy/v1/kv/metadata/?source=local&list=true`,
    );
    const kvBody = await kv.json();
    assert.equal(kv.status, 200);
    assert.deepEqual(kvBody.data.keys, ["runtime"]);
    assert.equal(mock.seen.authorization, `Bearer ${SENTINEL_TOKEN}`);
  } finally {
    await apiServer.stop();
    await mock.stop();
    restoreEnv(UNIX_SOCKET_ENV, priorSocket);
    await rm(tempRoot, { recursive: true, force: true });
    await rm(socketPath, { force: true });
  }
});

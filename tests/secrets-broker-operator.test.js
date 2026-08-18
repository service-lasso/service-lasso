import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState, setLifecycleState, getLifecycleState } from "../dist/runtime/lifecycle/store.js";
import {
  installService,
  configService,
  startService,
  stopService,
} from "../dist/runtime/lifecycle/actions.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { makeTempServicesRoot, writeExecutableFixtureService, writeManifest } from "./test-helpers.js";
import {
  resolveSecretsBrokerDataPaths,
  writeSecretsBrokerOperatorConfig,
} from "../dist/runtime/broker/operator-config.js";
import { resetScopedBrokerIdentities } from "../dist/runtime/broker/identity.js";

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

async function startMockResolveBroker(options = {}) {
  const {
    expectedToken = "broker-operator-token",
    values = {
      "shared/database/database.PASSWORD": "resolved-db-password",
    },
  } = options;

  const seen = {
    authorization: null,
    body: null,
  };

  const server = createServer((request, response) => {
    seen.authorization = request.headers.authorization ?? null;
    if (request.method === "POST" && request.url === "/v1/resolve") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        seen.body = JSON.parse(raw);
        const refs = Array.isArray(seen.body.refs) ? seen.body.refs : [];
        const results = refs.map((ref) => {
          const value = values[ref];
          return value === undefined
            ? { ref, outcome: "missing_ref" }
            : { ref, outcome: "ready", value };
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          serviceId: "@secretsbroker",
          apiVersion: "secretsbroker.local/v1",
          results,
        }));
      });
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    port: address.port,
    expectedToken,
    seen: () => seen,
    stop: async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function writeLeaseHelper(tempRoot) {
  const helperPath = path.join(tempRoot, "issue-lease-helper.mjs");
  await writeFile(
    helperPath,
    `
const args = process.argv.slice(2);
function flag(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
const refs = args.flatMap((arg, index) => arg === "--allowed-ref" ? [args[index + 1]] : []);
const lease = {
  issuer: "service-lasso-local-launcher",
  serviceId: flag("--service-id"),
  workspaceId: flag("--workspace-id"),
  allowedRefs: refs,
  allowedOperations: ["resolve"],
  issuedAt: flag("--issued-at"),
  expiresAt: flag("--expires-at"),
  jti: flag("--jti"),
  signature: "hmac-sha256:test-signature"
};
process.stdout.write(JSON.stringify({ outcome: "ready", lease }));
`.trim(),
  );
  return helperPath;
}

async function writeBackupHelper(tempRoot) {
  const helperPath = path.join(tempRoot, "broker-backup-helper.mjs");
  await writeFile(
    helperPath,
    `
import { writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
function flag(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
if (args[0] === "backup" && args[1] === "create") {
  const out = flag("--out");
  await writeFile(out, JSON.stringify({ version: 1, serviceId: "@secretsbroker", args }, null, 2));
  process.exit(0);
}
if (args[0] === "backup" && args[1] === "restore") {
  process.stdout.write(JSON.stringify({ outcome: "ready", in: flag("--in") }));
  process.exit(0);
}
process.exit(1);
`.trim(),
  );
  return helperPath;
}

test("start resolves required broker imports through live /v1/resolve", async () => {
  resetLifecycleState();
  resetScopedBrokerIdentities();
  const mockBroker = await startMockResolveBroker();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-broker-resolve-");
  const helperPath = await writeLeaseHelper(tempRoot);
  const brokerRoot = await writeManifest(servicesRoot, "@secretsbroker", {
    id: "@secretsbroker",
    name: "Secrets Broker",
    description: "Live resolve fixture.",
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    ports: { service: mockBroker.port },
    healthcheck: { type: "process" },
  });
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "db-consumer", {
    captureEnvKeys: ["DB_PASSWORD"],
    env: {
      DB_PASSWORD: "${database.PASSWORD}",
    },
    broker: {
      imports: [
        {
          namespace: "shared/database",
          ref: "database.PASSWORD",
          as: "DB_PASSWORD",
          required: true,
        },
      ],
    },
  });

  const paths = resolveSecretsBrokerDataPaths(brokerRoot);
  await mkdir(paths.brokerStateDir, { recursive: true });
  await writeSecretsBrokerOperatorConfig(brokerRoot, {
    version: 1,
    storePath: paths.storePath,
    auditPath: paths.auditPath,
    masterKeyFile: paths.masterKeyFile,
    apiToken: mockBroker.expectedToken,
    initializedAt: new Date().toISOString(),
  });

  const priorCommand = process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_COMMAND;
  const priorArgs = process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_ARGS_JSON;
  process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_COMMAND = process.execPath;
  process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_ARGS_JSON = JSON.stringify([helperPath]);

  try {
    const discovered = await discoverServices(servicesRoot);
    const registry = createServiceRegistry(discovered);
    const consumer = registry.getById("db-consumer");
    assert.ok(consumer);
    await installService(consumer, registry);
    await configService(consumer, registry);
    const started = await startService(consumer, registry);
    assert.equal(started.ok, true);

    const envPath = path.join(serviceRoot, "runtime", "env.json");
    await waitFor(async () => {
      try {
        const env = JSON.parse(await readFile(envPath, "utf8"));
        return env.DB_PASSWORD === "resolved-db-password";
      } catch {
        return false;
      }
    });

    const seen = mockBroker.seen();
    assert.equal(seen.authorization, `Bearer ${mockBroker.expectedToken}`);
    assert.equal(seen.body.purpose, "service-start");
    assert.deepEqual(seen.body.refs, ["shared/database/database.PASSWORD"]);
    assert.equal(typeof seen.body.identityLease?.jti, "string");
    assert.equal(JSON.stringify(started).includes("resolved-db-password"), false);
    await stopService(consumer);
  } finally {
    if (priorCommand === undefined) {
      delete process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_COMMAND;
    } else {
      process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_COMMAND = priorCommand;
    }
    if (priorArgs === undefined) {
      delete process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_ARGS_JSON;
    } else {
      process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_ARGS_JSON = priorArgs;
    }
    await mockBroker.stop();
    resetLifecycleState();
    resetScopedBrokerIdentities();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("POST /api/services/@secretsbroker/backup creates an encrypted-store backup artifact", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-broker-backup-");
  const helperPath = await writeBackupHelper(tempRoot);
  const brokerRoot = await writeManifest(servicesRoot, "@secretsbroker", {
    id: "@secretsbroker",
    name: "Secrets Broker",
    description: "Backup fixture.",
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    healthcheck: { type: "process" },
  });
  const paths = resolveSecretsBrokerDataPaths(brokerRoot);
  await mkdir(paths.brokerStateDir, { recursive: true });
  await writeSecretsBrokerOperatorConfig(brokerRoot, {
    version: 1,
    storePath: paths.storePath,
    auditPath: paths.auditPath,
    masterKeyFile: paths.masterKeyFile,
    apiToken: "backup-token",
    initializedAt: new Date().toISOString(),
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });
  const current = getLifecycleState("@secretsbroker");
  setLifecycleState("@secretsbroker", {
    ...current,
    installArtifacts: {
      files: [],
      updatedAt: new Date().toISOString(),
      artifact: {
        sourceType: null,
        repo: null,
        channel: null,
        tag: null,
        assetName: null,
        assetUrl: null,
        archiveType: null,
        archivePath: null,
        extractedPath: path.dirname(helperPath),
        command: process.execPath,
        args: [helperPath],
        checksum: null,
      },
    },
  });
  const archivePath = path.join(tempRoot, "broker-backup.json");

  try {
    const created = await postJson(`${apiServer.url}/api/services/%40secretsbroker/backup`, {
      out: archivePath,
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.ok, true);
    assert.equal(created.body.action, "backup");
    assert.equal(created.body.archivePath, path.resolve(archivePath));

    const artifact = JSON.parse(await readFile(archivePath, "utf8"));
    assert.equal(artifact.serviceId, "@secretsbroker");
    assert.ok(artifact.args.includes("--out"));
    assert.ok(artifact.args.includes("--master-key-file"));
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

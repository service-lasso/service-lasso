import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { configService, installService, startService, stopService } from "../dist/runtime/lifecycle/actions.js";
import { getLifecycleState, resetLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";
import {
  compileServiceStartupBrokerPlan,
  resolveServiceStartupBrokerResolution,
} from "../dist/runtime/broker/launch-resolution.js";
import { onboardMissingProducerSecrets } from "../dist/runtime/broker/onboard.js";
import { loadServiceManifest } from "../dist/runtime/discovery/loadManifest.js";
import {
  resolveSecretsBrokerDataPaths,
  writeSecretsBrokerOperatorConfig,
} from "../dist/runtime/broker/operator-config.js";
import { resetScopedBrokerIdentities } from "../dist/runtime/broker/identity.js";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";

const SENTINEL = "kv-sentinel-alpha";
const ROTATED_SENTINEL = "rotated-sample-token-fixture";

/**
 * Start a loopback Broker mock that records KV/provisioning/rotation without echoing values in list/metadata.
 *
 * @param {{ expectedToken?: string }} [options]
 */
async function startFixtureBroker(options = {}) {
  const expectedToken = options.expectedToken ?? "broker-test-token";
  const stored = new Map();
  const seen = {
    applyCount: 0,
    resolveCount: 0,
    kvListCount: 0,
    rotateCount: 0,
    lastApplyBody: null,
    lastKvPath: null,
  };

  const server = createServer((request, response) => {
    const writeJson = (status, payload) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    };
    const withBody = (handler) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        handler(raw ? JSON.parse(raw) : null);
      });
    };

    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname;
    const auth = request.headers.authorization ?? "";
    if (auth !== `Bearer ${expectedToken}`) {
      writeJson(401, { errors: ["unauthorized"] });
      return;
    }

    if (request.method === "GET" && pathname.startsWith("/v1/kv/metadata")) {
      seen.kvListCount += 1;
      seen.lastKvPath = pathname;
      if (requestUrl.searchParams.get("list") === "true") {
        if (stored.size === 0) {
          writeJson(404, { errors: ["no keys found"] });
          return;
        }
        const keys = [...new Set([...stored.keys()].map((ref) => {
          const parts = ref.split("/");
          return parts.length > 1 ? `${parts[0]}/` : ref;
        }))];
        writeJson(200, { data: { keys } });
        return;
      }
      writeJson(404, { errors: ["not_found"] });
      return;
    }

    if (request.method === "POST" && pathname === "/v1/resolve") {
      seen.resolveCount += 1;
      withBody((body) => {
        const refs = Array.isArray(body?.refs) ? body.refs : [];
        writeJson(200, {
          serviceId: "@secretsbroker",
          outcome: "ready",
          results: refs.map((ref) => {
            const value = stored.get(ref);
            if (typeof value !== "string") {
              return { ref, outcome: "missing_ref" };
            }
            return { ref, outcome: "ready", value };
          }),
        });
      });
      return;
    }

    if (request.method === "POST" && pathname === "/v1/provisioning/operations/apply") {
      seen.applyCount += 1;
      withBody((body) => {
        seen.lastApplyBody = body;
        const ref = typeof body?.ref === "string" ? body.ref : "";
        if (!ref) {
          writeJson(400, { outcome: "invalid_ref", applied: false });
          return;
        }
        if (stored.has(ref)) {
          writeJson(200, { outcome: "ready", applied: false, lastOutcome: "already_present" });
          return;
        }
        stored.set(ref, SENTINEL);
        writeJson(200, {
          serviceId: "@secretsbroker",
          outcome: "applied",
          applied: true,
          ref,
          generationMode: "broker_generated",
        });
      });
      return;
    }

    if (request.method === "POST" && pathname === "/v1/management/secrets/rotation/activate") {
      seen.rotateCount += 1;
      withBody((body) => {
        const ref = typeof body?.ref === "string" ? body.ref : [...stored.keys()][0];
        if (ref && stored.has(ref)) {
          stored.set(ref, ROTATED_SENTINEL);
        }
        writeJson(200, {
          serviceId: "@secretsbroker",
          outcome: "applied",
          operation: "rotation_activate",
          ref: ref ?? null,
        });
      });
      return;
    }

    writeJson(404, { errors: ["not_found"] });
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
    storedRefs: () => [...stored.keys()],
    stop: async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function waitFor(readinessCheck, timeoutMs = 4_000) {
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

/**
 * Kill the sample Node process by pid from its provider snapshot.
 * Does not SIGTERM the demo keep-alive tree.
 *
 * @param {string} sampleRoot Copied node-sample-service root
 */
async function killSamplePid(sampleRoot) {
  let pid;
  try {
    const snapshot = JSON.parse(await readFile(path.join(sampleRoot, ".state", "provider-env.json"), "utf8"));
    if (typeof snapshot.pid === "number" && snapshot.pid > 0) {
      pid = snapshot.pid;
    }
  } catch {
    // Process may already have exited.
    return;
  }

  if (!pid) {
    return;
  }

  const isRunning = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") {
        return false;
      }
      if (error?.code === "EPERM") {
        return true;
      }
      throw error;
    }
  };
  const waitForExit = async (timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!isRunning()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return !isRunning();
  };

  try {
    process.kill(pid);
  } catch (error) {
    if (error?.code === "ESRCH") {
      return;
    }
    throw error;
  }

  if (await waitForExit(2_000)) {
    return;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (error?.code === "ESRCH") {
      return;
    }
    throw error;
  }
  if (!await waitForExit(2_000)) {
    throw new Error(`Sample process ${pid} did not exit after forced termination`);
  }
}

/**
 * Stop the sample without leaving a hung stopService handle.
 * Kill the child first so Core's tree wait can observe exit.
 *
 * @param {import("../dist/contracts/service.js").DiscoveredService} service
 * @param {string} sampleRoot
 */
async function stopSample(service, sampleRoot) {
  await killSamplePid(sampleRoot);
  await new Promise((resolve) => {
    setTimeout(resolve, 150);
  });
  const serviceId = service.manifest.id;
  const current = getLifecycleState(serviceId);
  if (!current.running) {
    return;
  }
  try {
    await stopService(service);
  } catch {
    const latest = getLifecycleState(serviceId);
    if (latest.running) {
      setLifecycleState(serviceId, {
        ...latest,
        running: false,
        runtime: {
          ...latest.runtime,
          pid: null,
          lastTermination: "stopped",
          finishedAt: new Date().toISOString(),
        },
      });
    }
  }
  await killSamplePid(sampleRoot);
}

/**
 * Wait until the sample binds a real port and `/diagnostics` returns JSON.
 *
 * @param {string} sampleRoot
 * @returns {Promise<object>}
 */
async function waitForSampleDiagnostics(sampleRoot) {
  const port = await waitFor(async () => {
    try {
      const snapshot = JSON.parse(await readFile(path.join(sampleRoot, ".state", "provider-env.json"), "utf8"));
      return typeof snapshot.port === "number" && snapshot.port > 0 ? snapshot.port : null;
    } catch {
      return null;
    }
  });
  return waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/diagnostics`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (!response.ok) {
        return null;
      }
      return response.json();
    } catch {
      return null;
    }
  });
}

test("checked-in node-sample-service declares broker-generated producer and non-secret env", async () => {
  const manifest = await loadServiceManifest(path.resolve("services", "node-sample-service", "service.json"));
  assert.equal(manifest.env.NODE_SAMPLE_FEATURE_FLAG, "rotation-fixture");
  assert.equal(manifest.env.NODE_SAMPLE_PUBLIC_LABEL, "node-sample");
  assert.equal(manifest.broker.writeback.generatedSecrets[0].source, "broker:generate");
  assert.equal(manifest.broker.imports.find((entry) => entry.ref === "sample.API_TOKEN").required, false);
  assert.equal(manifest.broker.imports.find((entry) => entry.ref === "sample.GENERATED_TOKEN").required, true);

  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-node-sample-plan-");
  try {
    await cp(path.resolve("services", "node-sample-service"), path.join(servicesRoot, "node-sample-service"), {
      recursive: true,
    });
    const discovered = await discoverServices(servicesRoot);
    const service = discovered.find((entry) => entry.manifest.id === "node-sample-service");
    assert.ok(service);
    const plan = compileServiceStartupBrokerPlan(service);
    const generated = plan.writeback.generatedSecrets.find((entry) => entry.ref === "sample.GENERATED_TOKEN");
    assert.equal(generated.generationMode, "broker_generated");
    assert.equal(generated.overwrite, "deny");
    assert.deepEqual(generated.sourceRefs, []);
    assert.equal(JSON.stringify(plan).includes(SENTINEL), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("discovery validates node-sample broker refs without writing KV", async () => {
  const mockBroker = await startFixtureBroker();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-node-sample-discover-");
  try {
    await cp(path.resolve("services", "node-sample-service"), path.join(servicesRoot, "node-sample-service"), {
      recursive: true,
    });
    const discovered = await discoverServices(servicesRoot);
    assert.equal(discovered.some((entry) => entry.manifest.id === "node-sample-service"), true);
    assert.equal(mockBroker.seen().applyCount, 0);
    assert.equal(mockBroker.seen().kvListCount, 0);
    assert.deepEqual(mockBroker.storedRefs(), []);
  } finally {
    await mockBroker.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("first-run onboard generates the producer secret once and skips overwrite", async () => {
  resetLifecycleState();
  const mockBroker = await startFixtureBroker();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-node-sample-onboard-");
  try {
    const brokerRoot = await writeManifest(servicesRoot, "@secretsbroker", {
      id: "@secretsbroker",
      name: "Secrets Broker",
      description: "Onboard fixture broker.",
      executable: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      ports: { service: mockBroker.port },
      healthcheck: { type: "process" },
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
    await cp(path.resolve("services", "node-sample-service"), path.join(servicesRoot, "node-sample-service"), {
      recursive: true,
    });

    const discovered = await discoverServices(servicesRoot);
    const registry = createServiceRegistry(discovered);
    const service = registry.getById("node-sample-service");
    const brokerService = registry.getById("@secretsbroker");
    assert.ok(service && brokerService);

    const missingLookup = async ({ refs }) => refs.map((ref) => ({ ref, status: "missing" }));
    const firstResolution = await resolveServiceStartupBrokerResolution(service, missingLookup);
    const cannedLease = {
      issuer: "@service-lasso",
      serviceId: "node-sample-service",
      allowedRefs: ["services/node-sample-service/sample.GENERATED_TOKEN"],
      allowedNamespaces: ["services/node-sample-service"],
      allowedOperations: ["create", "rotate", "resolve"],
      jti: "lease-test",
      signature: "test",
    };
    const first = await onboardMissingProducerSecrets({
      service,
      resolution: firstResolution,
      brokerService,
      launchLeaseIssuer: {
        command: { command: process.execPath, args: ["-e", ""] },
        cannedLease,
      },
    });
    assert.deepEqual(first.appliedRefs, ["sample.GENERATED_TOKEN"]);
    assert.equal(mockBroker.seen().applyCount, 1);
    assert.equal(mockBroker.seen().lastApplyBody.generationMode, "broker_generated");
    assert.equal(mockBroker.seen().lastApplyBody.operation, "create");
    assert.equal(JSON.stringify(mockBroker.seen().lastApplyBody).includes(SENTINEL), false);
    assert.deepEqual(mockBroker.storedRefs(), ["services/node-sample-service/sample.GENERATED_TOKEN"]);
    const listed = await fetch(`http://127.0.0.1:${mockBroker.port}/v1/kv/metadata/?list=true&source=local`, {
      headers: { authorization: `Bearer ${mockBroker.expectedToken}` },
    });
    const listedBody = await listed.json();
    assert.equal(listed.status, 200);
    assert.ok(listedBody.data.keys.includes("services/"));
    assert.equal(JSON.stringify(listedBody).includes(SENTINEL), false);

    const resolvedLookup = async ({ refs }) => refs.map((ref) => (
      ref === "sample.GENERATED_TOKEN"
        ? { ref, status: "resolved", value: SENTINEL }
        : { ref, status: "missing" }
    ));
    const secondResolution = await resolveServiceStartupBrokerResolution(service, resolvedLookup);
    const second = await onboardMissingProducerSecrets({
      service,
      resolution: secondResolution,
      brokerService,
      launchLeaseIssuer: {
        command: { command: process.execPath, args: ["-e", ""] },
        cannedLease,
      },
    });
    assert.deepEqual(second.appliedRefs, []);
    assert.ok(second.skippedRefs.includes("sample.GENERATED_TOKEN"));
    assert.equal(mockBroker.seen().applyCount, 1);
  } finally {
    await mockBroker.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("node-sample start onboard, rotation metadata, and non-secret updates stay off Broker", { timeout: 120_000 }, async () => {
  resetLifecycleState();
  const mockBroker = await startFixtureBroker();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-node-sample-start-");
  const priorCommand = process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_COMMAND;
  const priorArgs = process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_ARGS_JSON;
  let sampleRoot = "";
  try {
    await writeManifest(servicesRoot, "@node", {
      id: "@node",
      name: "Node Runtime",
      description: "Node provider shim for sample broker fixture.",
      role: "provider",
      executable: process.execPath,
      env: { NODE_ENV: "development" },
    });
    const brokerRoot = await writeManifest(servicesRoot, "@secretsbroker", {
      id: "@secretsbroker",
      name: "Secrets Broker",
      description: "Start fixture broker.",
      executable: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      ports: { service: mockBroker.port },
      healthcheck: { type: "process" },
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
    sampleRoot = path.join(servicesRoot, "node-sample-service");
    await cp(path.resolve("services", "node-sample-service"), sampleRoot, { recursive: true });
    const sampleManifestPath = path.join(sampleRoot, "service.json");
    const sampleManifest = JSON.parse(await readFile(sampleManifestPath, "utf8"));
    sampleManifest.ports = { service: 0 };
    sampleManifest.env.NODE_SAMPLE_HEARTBEAT_MS = "60000";
    sampleManifest.healthchecks = [{
      id: "process-health",
      type: "process",
    }];
    await writeFile(sampleManifestPath, `${JSON.stringify(sampleManifest, null, 2)}\n`, "utf8");

    const leaseHelper = path.join(tempRoot, "lease-helper.mjs");
    await writeFile(
      leaseHelper,
      "console.log(JSON.stringify({outcome:\"ready\",lease:{issuer:\"@service-lasso\",serviceId:\"node-sample-service\",jti:\"lease-test\",signature:\"test\"}}));\n",
      "utf8",
    );
    process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_COMMAND = process.execPath;
    process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_ARGS_JSON = JSON.stringify([leaseHelper]);

    const discovered = await discoverServices(servicesRoot);
    const registry = createServiceRegistry(discovered);
    const sample = registry.getById("node-sample-service");
    const nodeProvider = registry.getById("@node");
    assert.ok(sample && nodeProvider);

    await installService(nodeProvider, registry);
    await configService(nodeProvider, registry);
    await installService(sample, registry);
    await configService(sample, registry);
    const firstStart = await startService(sample, registry, { workspaceRoot });
    assert.equal(firstStart.ok, true);
    assert.equal(mockBroker.seen().applyCount, 1);

    const diagnostics = await waitForSampleDiagnostics(sampleRoot);
    assert.equal(diagnostics.nonSecrets.featureFlag, "rotation-fixture");
    assert.equal(diagnostics.secrets.generatedToken.present, true);
    assert.equal(diagnostics.secrets.generatedToken.length, SENTINEL.length);
    assert.equal(diagnostics.secrets.generatedToken.last4, SENTINEL.slice(-4));
    assert.equal(diagnostics.rawMaterialReturned, false);
    const diagnosticJson = JSON.stringify(diagnostics);
    assert.equal(diagnosticJson.includes(SENTINEL), false);
    assert.equal(diagnosticJson.includes(ROTATED_SENTINEL), false);

    const snapshot = JSON.parse(await readFile(path.join(sampleRoot, ".state", "provider-env.json"), "utf8"));
    assert.equal(snapshot.NODE_SAMPLE_FEATURE_FLAG, "rotation-fixture");
    assert.equal(JSON.stringify(snapshot).includes(SENTINEL), false);

    await stopSample(sample, sampleRoot);
    const secondStart = await startService(sample, registry, { workspaceRoot });
    assert.equal(secondStart.ok, true);
    assert.equal(mockBroker.seen().applyCount, 1);

    const rotate = await fetch(`http://127.0.0.1:${mockBroker.port}/v1/management/secrets/rotation/activate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${mockBroker.expectedToken}`,
      },
      body: JSON.stringify({
        ref: "services/node-sample-service/sample.GENERATED_TOKEN",
        reason: "fixture rotation",
      }),
    });
    const rotateBody = await rotate.json();
    assert.equal(rotate.status, 200);
    assert.equal(rotateBody.outcome, "applied");
    assert.equal(JSON.stringify(rotateBody).includes(SENTINEL), false);
    assert.equal(JSON.stringify(rotateBody).includes(ROTATED_SENTINEL), false);
    assert.equal(mockBroker.seen().rotateCount, 1);

    await stopSample(sample, sampleRoot);
    const rotatedStart = await startService(sample, registry, { workspaceRoot });
    assert.equal(rotatedStart.ok, true);
    const rotatedDiagnostics = await waitForSampleDiagnostics(sampleRoot);
    assert.equal(rotatedDiagnostics.secrets.generatedToken.present, true);
    assert.equal(rotatedDiagnostics.secrets.generatedToken.last4, ROTATED_SENTINEL.slice(-4));
    assert.notEqual(rotatedDiagnostics.secrets.generatedToken.last4, SENTINEL.slice(-4));
    assert.equal(JSON.stringify(rotatedDiagnostics).includes(ROTATED_SENTINEL), false);
    assert.equal(mockBroker.seen().applyCount, 1);

    const applyCountBeforeConfig = mockBroker.seen().applyCount;
    await stopSample(sample, sampleRoot);
    const manifestPath = path.join(sampleRoot, "service.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.env.NODE_SAMPLE_FEATURE_FLAG = "updated-without-broker";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const reloaded = await discoverServices(servicesRoot);
    const reloadedRegistry = createServiceRegistry(reloaded);
    const updatedSample = reloadedRegistry.getById("node-sample-service");
    const updatedStart = await startService(updatedSample, reloadedRegistry, { workspaceRoot });
    assert.equal(updatedStart.ok, true);
    const updatedDiagnostics = await waitForSampleDiagnostics(sampleRoot);
    assert.equal(updatedDiagnostics.nonSecrets.featureFlag, "updated-without-broker");
    assert.equal(mockBroker.seen().applyCount, applyCountBeforeConfig);
    await stopSample(updatedSample, sampleRoot);
  } finally {
    if (sampleRoot) {
      await killSamplePid(sampleRoot);
    }
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
    resetScopedBrokerIdentities();
    resetLifecycleState();
    await rm(tempRoot, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});

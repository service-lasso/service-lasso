import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { installService, configService, startService, stopService } from "../dist/runtime/lifecycle/actions.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { buildServiceVariables, resolveServiceText } from "../dist/runtime/operator/variables.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

async function waitFor(predicate, timeoutMs = 1_500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

async function prepareRegistry(servicesRoot) {
  const discovered = await discoverServices(servicesRoot);
  const registry = createServiceRegistry(discovered);
  return { discovered, registry };
}

test("ordinary service consumes Secrets Broker imports through resolved env without logging raw values", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-broker-env-e2e-");
  const rawSecret = "ordinary-service-db-password";

  try {
    const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "ordinary-broker-env-consumer", {
      readyFileAfterMs: 10,
      captureEnvKeys: ["DB_PASSWORD", "API_TOKEN", "BROKER_BACKED_URL"],
      stdoutLines: ["ordinary broker env consumer started"],
      stderrLines: ["ordinary broker env consumer diagnostics are scrubbed"],
      env: {
        DB_PASSWORD: "${database.PASSWORD}",
        API_TOKEN: "${services.API_TOKEN}",
        BROKER_BACKED_URL: "postgres://service:${database.PASSWORD}@localhost/app",
      },
      broker: {
        enabled: true,
        namespace: "services/ordinary-broker-env-consumer",
        buckets: [
          { namespace: "services/ordinary-broker-env-consumer", kind: "service" },
          { namespace: "shared/database", kind: "shared" },
        ],
        imports: [
          { namespace: "shared/database", ref: "database.PASSWORD", as: "DB_PASSWORD", required: true },
          { namespace: "services/ordinary-broker-env-consumer", ref: "services.API_TOKEN", as: "API_TOKEN", required: true },
        ],
      },
    });
    const { registry } = await prepareRegistry(servicesRoot);
    const service = registry.getById("ordinary-broker-env-consumer");
    assert.ok(service);

    await installService(service, registry);
    await configService(service, registry);
    const started = await startService(service, registry, {
      variableResolution: {
        brokerValues: {
          "database.PASSWORD": rawSecret,
          "services.API_TOKEN": "ordinary-service-api-token",
        },
      },
    });

    try {
      const snapshotPath = path.join(serviceRoot, "runtime", "env.json");
      await waitFor(async () => {
        try {
          await readFile(snapshotPath, "utf8");
          return true;
        } catch {
          return false;
        }
      });

      const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
      assert.equal(snapshot.DB_PASSWORD, rawSecret);
      assert.equal(snapshot.API_TOKEN, "ordinary-service-api-token");
      assert.equal(snapshot.BROKER_BACKED_URL, `postgres://service:${rawSecret}@localhost/app`);
    } finally {
      await stopService(service);
    }

    const stdout = await readFile(started.state.runtime.logs.stdoutPath, "utf8");
    const stderr = await readFile(started.state.runtime.logs.stderrPath, "utf8");
    const combined = await readFile(started.state.runtime.logs.logPath, "utf8");
    assert.equal(stdout.includes(rawSecret), false);
    assert.equal(stderr.includes(rawSecret), false);
    assert.equal(combined.includes(rawSecret), false);
  } finally {
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("CLI-style broker resolution fixture reports missing denied and source-auth refs without leaking values", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-broker-cli-fixture-");

  try {
    await writeExecutableFixtureService(servicesRoot, "ordinary-broker-cli-consumer", {
      env: {
        CLI_TOKEN: "${cli.TOKEN}",
        LOCAL_ONLY: "local-value",
        MISSING_REF: "${cli.MISSING}",
        DENIED_REF: "${cli.DENIED}",
        SOURCE_REF: "${source.NEEDS_AUTH}",
      },
      broker: {
        enabled: true,
        namespace: "services/ordinary-broker-cli-consumer",
        imports: [
          { namespace: "services/ordinary-broker-cli-consumer", ref: "cli.TOKEN", as: "CLI_TOKEN", required: true },
          { namespace: "services/ordinary-broker-cli-consumer", ref: "cli.MISSING", as: "MISSING_REF" },
          { namespace: "services/ordinary-broker-cli-consumer", ref: "cli.DENIED", as: "DENIED_REF" },
          { namespace: "external/source", ref: "source.NEEDS_AUTH", as: "SOURCE_REF" },
        ],
      },
    });
    const { registry } = await prepareRegistry(servicesRoot);
    const service = registry.getById("ordinary-broker-cli-consumer");
    assert.ok(service);

    const diagnostics = [];
    const resolved = resolveServiceText(
      "secretsbroker-resolve cli.TOKEN -> ${cli.TOKEN}; local=${LOCAL_ONLY}; denied=${cli.DENIED}; source=${source.NEEDS_AUTH}",
      service,
      {},
      {},
      {
        brokerValues: {
          "cli.TOKEN": "cli-token-value",
          "cli.DENIED": "must-not-leak-denied",
          "source.NEEDS_AUTH": "must-not-leak-source",
        },
        deniedBrokerRefs: ["cli.DENIED"],
        sourceAuthRequiredBrokerRefs: ["source.NEEDS_AUTH"],
        diagnostics,
      },
    );

    assert.equal(resolved, "secretsbroker-resolve cli.TOKEN -> cli-token-value; local=local-value; denied=${cli.DENIED}; source=${source.NEEDS_AUTH}");
    assert.equal(resolved.includes("must-not-leak-denied"), false);
    assert.equal(resolved.includes("must-not-leak-source"), false);
    assert.deepEqual(diagnostics, [
      { selector: "cli.DENIED", kind: "broker", reason: "denied-broker" },
      { selector: "source.NEEDS_AUTH", kind: "broker", reason: "source-auth-required" },
    ]);

    const payload = buildServiceVariables(service, {}, {}, {
      brokerValues: { "cli.TOKEN": "cli-token-value", "cli.DENIED": "must-not-leak-denied" },
      deniedBrokerRefs: ["cli.DENIED"],
      sourceAuthRequiredBrokerRefs: ["source.NEEDS_AUTH"],
    });
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes("must-not-leak-denied"), false);
    assert.equal(serialized.includes("must-not-leak-source"), false);
    assert.deepEqual(payload.diagnostics.map((entry) => entry.reason), [
      "missing-broker",
      "denied-broker",
      "source-auth-required",
    ]);
  } finally {
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

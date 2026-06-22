import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { assertNoSecretMaterial } from "../dist/testing/secretLeakHarness.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

const rawSecretSentinel = "SERVICE_LASSO_FAKE_LOG_SECRET_SENTINEL_DO_NOT_USE";
const sentinels = [
  {
    label: "log-shipping-secret-sentinel",
    value: rawSecretSentinel,
    description: "Fake log shipping secret sentinel used for redaction regression tests.",
  },
];

async function getJson(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.json(),
  };
}

function snapshotEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test("GET /api/log-shipping returns disabled-by-default source coverage without leaking sink values", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-log-shipping-disabled-");
  await writeExecutableFixtureService(servicesRoot, "log-disabled", {});

  const envKeys = [
    "SERVICE_LASSO_LOG_SHIPPING_ENABLED",
    "SERVICE_LASSO_LOG_SHIPPING_ENDPOINT",
    "SERVICE_LASSO_LOG_SHIPPING_MODE",
  ];
  const previousEnv = snapshotEnv(envKeys);
  delete process.env.SERVICE_LASSO_LOG_SHIPPING_ENABLED;
  delete process.env.SERVICE_LASSO_LOG_SHIPPING_ENDPOINT;
  delete process.env.SERVICE_LASSO_LOG_SHIPPING_MODE;

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const result = await getJson(apiServer.url + "/api/log-shipping");

    assert.equal(result.status, 200);
    assert.equal(result.body.logShipping.contractVersion, "service-lasso.log-shipping.v1");
    assert.equal(result.body.logShipping.sink.status, "disabled");
    assert.equal(result.body.logShipping.sink.endpointConfigured, false);
    assert.equal(result.body.logShipping.sink.endpointValueReturned, false);
    assert.equal(result.body.logShipping.exportPreview.mode, "disabled");
    assert.equal(result.body.logShipping.exportPreview.status, "not_sent");
    assert.equal(result.body.logShipping.redactionSelfTest.status, "passed");
    assert.equal(result.body.logShipping.redactionSelfTest.sentinelValueReturned, false);
    assert.equal(result.body.logShipping.redactionSelfTest.bodyValueReturned, false);
    assert.ok(result.body.logShipping.sources.some((source) => source.kind === "service_runtime"));
    assertNoSecretMaterial(result.body, { sentinels });
  } finally {
    await apiServer.stop();
    restoreEnv(previousEnv);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GET /api/log-shipping dry-run previews redacted runtime log samples and source selection", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-log-shipping-preview-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "log-source", {
    env: {
      SERVICE_TOKEN: rawSecretSentinel,
    },
    globalenv: {
      UPSTREAM_PASSWORD: rawSecretSentinel,
    },
  });
  const runtimeLogRoot = path.join(serviceRoot, "logs", "runtime");
  await mkdir(runtimeLogRoot, { recursive: true });
  await writeFile(
    path.join(runtimeLogRoot, "service.log"),
    [
      JSON.stringify({ level: "stdout", message: "ready for shipping" }),
      JSON.stringify({ level: "stderr", message: `token=${rawSecretSentinel}` }),
      `authorization=Bearer ${rawSecretSentinel}`,
    ].join("\n") + "\n",
  );

  const envKeys = [
    "SERVICE_LASSO_LOG_SHIPPING_ENABLED",
    "SERVICE_LASSO_LOG_SHIPPING_SINK",
    "SERVICE_LASSO_LOG_SHIPPING_ENDPOINT",
    "SERVICE_LASSO_LOG_SHIPPING_HEADERS",
    "SERVICE_LASSO_LOG_SHIPPING_SPOOL_DIR",
    "SERVICE_LASSO_LOG_SHIPPING_MODE",
    "SERVICE_LASSO_LOG_SHIPPING_SOURCES",
  ];
  const previousEnv = snapshotEnv(envKeys);
  process.env.SERVICE_LASSO_LOG_SHIPPING_ENABLED = "1";
  process.env.SERVICE_LASSO_LOG_SHIPPING_SINK = "openobserve";
  process.env.SERVICE_LASSO_LOG_SHIPPING_ENDPOINT = `http://collector.example/ingest?token=${rawSecretSentinel}`;
  process.env.SERVICE_LASSO_LOG_SHIPPING_HEADERS = `authorization=Bearer ${rawSecretSentinel}`;
  process.env.SERVICE_LASSO_LOG_SHIPPING_SPOOL_DIR = path.join(tempRoot, "spool", rawSecretSentinel);
  process.env.SERVICE_LASSO_LOG_SHIPPING_MODE = "dry-run";
  process.env.SERVICE_LASSO_LOG_SHIPPING_SOURCES = "service_runtime,secrets_broker_audit";

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const result = await getJson(apiServer.url + "/api/log-shipping");

    assert.equal(result.status, 200);
    const logShipping = result.body.logShipping;
    assert.equal(logShipping.sink.status, "configured");
    assert.equal(logShipping.sink.type, "openobserve");
    assert.equal(logShipping.sink.endpointConfigured, true);
    assert.equal(logShipping.sink.endpointValueReturned, false);
    assert.equal(logShipping.sink.headersValueReturned, false);
    assert.equal(logShipping.sink.spoolConfigured, true);
    assert.equal(logShipping.sink.spoolPathValueReturned, false);
    assert.equal(logShipping.exportPreview.mode, "dry_run");
    assert.equal(logShipping.exportPreview.status, "not_sent");
    assert.equal(logShipping.exportPreview.bodyValueReturned, false);
    assert.ok(logShipping.exportPreview.recordCountEstimate >= 3);

    assert.equal(logShipping.redactionSelfTest.status, "passed");
    assert.equal(logShipping.redactionSelfTest.testCaseCount, 4);
    assert.equal(logShipping.redactionSelfTest.passedTestCaseCount, 4);
    assert.equal(logShipping.redactionSelfTest.endpointValueReturned, false);
    assert.equal(logShipping.redactionSelfTest.headersValueReturned, false);
    assert.equal(logShipping.redactionSelfTest.spoolPathValueReturned, false);
    assert.equal(logShipping.redactionSelfTest.bodyValueReturned, false);
    assert.ok(logShipping.redactionSelfTest.cases.every((entry) => entry.inputValueReturned === false));
    assert.ok(logShipping.redactionSelfTest.cases.every((entry) => entry.redactedText.includes("[REDACTED]")));

    const serviceSource = logShipping.sources.find((source) => source.id === "service:log-source:runtime");
    assert.equal(serviceSource.enabled, true);
    assert.equal(serviceSource.currentLogAvailable, true);
    assert.equal(serviceSource.queuedRecordEstimate, 3);

    const coreSource = logShipping.sources.find((source) => source.kind === "core_runtime");
    assert.equal(coreSource.enabled, false);
    const brokerSource = logShipping.sources.find((source) => source.kind === "secrets_broker_audit");
    assert.equal(brokerSource.enabled, true);

    assert.equal(logShipping.sampleRecords.length, 3);
    assert.ok(logShipping.sampleRecords.some((record) => record.text.includes("[REDACTED]")));
    assertNoSecretMaterial(result.body, { sentinels });
  } finally {
    await apiServer.stop();
    restoreEnv(previousEnv);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

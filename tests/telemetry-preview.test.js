import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { assertNoSecretMaterial } from "../dist/testing/secretLeakHarness.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

const rawSecretSentinel = "SERVICE_LASSO_FAKE_OTEL_SECRET_SENTINEL_DO_NOT_USE";
const sentinels = [
  {
    label: "otel-secret-sentinel",
    value: rawSecretSentinel,
    description: "Fake OTEL secret sentinel used for redaction regression tests.",
  },
];

async function getJson(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.json(),
  };
}

function assertAllowlistedSignals(telemetry) {
  const allowed = new Set(telemetry.redaction.allowedAttributes);

  for (const service of telemetry.services) {
    assert.equal(typeof service.serviceId, "string");
    for (const signal of service.signals) {
      assert.match(signal.traceId, /^[a-f0-9]{32}$/);
      assert.match(signal.spanId, /^[a-f0-9]{16}$/);
      assert.match(signal.correlationId, /^sl-[a-f0-9]{16}$/);
      assert.ok(signal.kind === "span" || signal.kind === "metric");
      for (const key of Object.keys(signal.attributes)) {
        assert.equal(allowed.has(key), true, key);
      }
    }
  }
}

test("GET /api/telemetry returns redacted OTEL-shaped lifecycle and health metadata", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-telemetry-preview-");
  await writeExecutableFixtureService(servicesRoot, "telemetry-consumer", {
    env: {
      API_TOKEN: rawSecretSentinel,
      PUBLIC_MODE: "demo",
    },
    globalenv: {
      UPSTREAM_PASSWORD: rawSecretSentinel,
    },
    config: {
      files: [
        {
          path: "config/app.env",
          content: "TOKEN=" + rawSecretSentinel,
        },
      ],
    },
  });

  const previousEnabled = process.env.SERVICE_LASSO_OTEL_ENABLED;
  const previousEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const previousHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS;
  const previousExportMode = process.env.SERVICE_LASSO_OTEL_EXPORT_MODE;
  process.env.SERVICE_LASSO_OTEL_ENABLED = "1";
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector.example/v1/traces?token=" + rawSecretSentinel;
  process.env.OTEL_EXPORTER_OTLP_HEADERS = "authorization=Bearer " + rawSecretSentinel;
  process.env.SERVICE_LASSO_OTEL_EXPORT_MODE = "dry-run";

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const result = await getJson(apiServer.url + "/api/telemetry");

    assert.equal(result.status, 200);
    assert.equal(result.body.telemetry.contractVersion, "service-lasso.telemetry-preview.v1");
    assert.deepEqual(result.body.telemetry.resource, {
      serviceName: "service-lasso-core",
      serviceNamespace: "service-lasso",
      serviceInstanceId: "local-runtime",
    });
    assert.equal(result.body.telemetry.exporter.status, "configured");
    assert.equal(result.body.telemetry.exporter.endpointConfigured, true);
    assert.equal(result.body.telemetry.exporter.endpointValueReturned, false);
    assert.equal(result.body.telemetry.exporter.headersValueReturned, false);
    assert.deepEqual(result.body.telemetry.exportPreview, {
      mode: "dry_run",
      status: "not_sent",
      protocol: "otlp-http",
      contentType: "application/json",
      signalCount: 3,
      serviceCount: 1,
      endpointConfigured: true,
      endpointValueReturned: false,
      headersValueReturned: false,
      bodyValueReturned: false,
      allowedAttributeCount: result.body.telemetry.redaction.allowedAttributes.length,
      droppedFieldClasses: result.body.telemetry.redaction.forbiddenFieldClasses,
      safeEnvelopeFields: [
        "resource.serviceName",
        "resource.serviceNamespace",
        "resource.serviceInstanceId",
        "signals.kind",
        "signals.name",
        "signals.traceId",
        "signals.spanId",
        "signals.correlationId",
        "signals.attributes",
      ],
      reason:
        "Dry-run OTLP export envelope is ready for local verification; the runtime does not send telemetry from this preview API.",
    });
    assert.equal(result.body.telemetry.services.length, 1);
    assert.equal(result.body.telemetry.services[0].serviceId, "telemetry-consumer");
    assert.equal(result.body.telemetry.services[0].signals.length, 3);
    assertAllowlistedSignals(result.body.telemetry);
    assertNoSecretMaterial(result.body, { sentinels });

    const serviceResult = await getJson(apiServer.url + "/api/services/telemetry-consumer/telemetry");
    assert.equal(serviceResult.status, 200);
    assert.equal(serviceResult.body.telemetry.serviceId, "telemetry-consumer");
    assert.equal(serviceResult.body.telemetry.signals[0].name, "service_lasso.service.lifecycle");
    assertNoSecretMaterial(serviceResult.body, { sentinels });
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.SERVICE_LASSO_OTEL_ENABLED;
    } else {
      process.env.SERVICE_LASSO_OTEL_ENABLED = previousEnabled;
    }
    if (previousEndpoint === undefined) {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    } else {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = previousEndpoint;
    }
    if (previousHeaders === undefined) {
      delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
    } else {
      process.env.OTEL_EXPORTER_OTLP_HEADERS = previousHeaders;
    }
    if (previousExportMode === undefined) {
      delete process.env.SERVICE_LASSO_OTEL_EXPORT_MODE;
    } else {
      process.env.SERVICE_LASSO_OTEL_EXPORT_MODE = previousExportMode;
    }
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GET /api/telemetry keeps export envelope disabled until explicit dry-run config is present", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-telemetry-export-disabled-");
  await writeExecutableFixtureService(servicesRoot, "telemetry-disabled", {});

  const previousEnabled = process.env.SERVICE_LASSO_OTEL_ENABLED;
  const previousEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const previousExportMode = process.env.SERVICE_LASSO_OTEL_EXPORT_MODE;
  delete process.env.SERVICE_LASSO_OTEL_ENABLED;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.SERVICE_LASSO_OTEL_EXPORT_MODE;

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const result = await getJson(apiServer.url + "/api/telemetry");

    assert.equal(result.status, 200);
    assert.equal(result.body.telemetry.exporter.status, "disabled");
    assert.equal(result.body.telemetry.exportPreview.mode, "disabled");
    assert.equal(result.body.telemetry.exportPreview.status, "not_sent");
    assert.equal(result.body.telemetry.exportPreview.signalCount, 3);
    assert.equal(result.body.telemetry.exportPreview.endpointValueReturned, false);
    assert.equal(result.body.telemetry.exportPreview.headersValueReturned, false);
    assert.equal(result.body.telemetry.exportPreview.bodyValueReturned, false);
    assert.match(result.body.telemetry.exportPreview.reason, /OTLP export remains disabled/i);
    assertAllowlistedSignals(result.body.telemetry);
    assertNoSecretMaterial(result.body, { sentinels });
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.SERVICE_LASSO_OTEL_ENABLED;
    } else {
      process.env.SERVICE_LASSO_OTEL_ENABLED = previousEnabled;
    }
    if (previousEndpoint === undefined) {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    } else {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = previousEndpoint;
    }
    if (previousExportMode === undefined) {
      delete process.env.SERVICE_LASSO_OTEL_EXPORT_MODE;
    } else {
      process.env.SERVICE_LASSO_OTEL_EXPORT_MODE = previousExportMode;
    }
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

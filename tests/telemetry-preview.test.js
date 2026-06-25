import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { assertNoSecretMaterial } from "../dist/testing/secretLeakHarness.js";
import { makeTempServicesRoot, writeExecutableFixtureService, writeManifest } from "./test-helpers.js";

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

async function startMockCollector() {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    requests.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    });
    response.statusCode = 202;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ accepted: true }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    requests,
    url: `http://127.0.0.1:${address.port}/v1/traces`,
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
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

  for (const request of telemetry.apiRequests ?? []) {
    assert.equal(typeof request.routeGroup, "string");
    assert.equal(typeof request.routeTemplate, "string");
    assert.equal(request.routeTemplate.includes(rawSecretSentinel), false);
    assert.match(request.signal.traceId, /^[a-f0-9]{32}$/);
    assert.match(request.signal.spanId, /^[a-f0-9]{16}$/);
    assert.match(request.signal.correlationId, /^sl-[a-f0-9]{16}$/);
    assert.equal(request.signal.kind, "span");
    for (const key of Object.keys(request.signal.attributes)) {
      assert.equal(allowed.has(key), true, key);
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
    assert.deepEqual(result.body.telemetry.apiRequests, []);
    assert.deepEqual(result.body.telemetry.apiRequestBuffer, {
      capacity: 50,
      retainedCount: 0,
      droppedCount: 0,
      routeTemplateOnly: true,
      rawMaterialReturned: false,
    });
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
        "apiRequests.routeGroup",
        "apiRequests.routeTemplate",
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

test("POST /api/telemetry/export-test sends only sanitized metadata to a local mock collector", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-telemetry-export-test-");
  await writeExecutableFixtureService(servicesRoot, "telemetry-export", {
    env: {
      API_TOKEN: rawSecretSentinel,
    },
    config: {
      files: [
        {
          path: "config/secret.env",
          content: "SECRET=" + rawSecretSentinel,
        },
      ],
    },
  });

  const collector = await startMockCollector();
  const previousEnabled = process.env.SERVICE_LASSO_OTEL_ENABLED;
  const previousEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const previousHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS;
  const previousExportMode = process.env.SERVICE_LASSO_OTEL_EXPORT_MODE;
  process.env.SERVICE_LASSO_OTEL_ENABLED = "1";
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = collector.url;
  process.env.OTEL_EXPORTER_OTLP_HEADERS = "authorization=Bearer " + rawSecretSentinel;
  process.env.SERVICE_LASSO_OTEL_EXPORT_MODE = "mock-collector";

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const result = await fetch(apiServer.url + "/api/telemetry/export-test", { method: "POST" });
    const body = await result.json();

    assert.equal(result.status, 200);
    assert.deepEqual(body.exportTest, {
      mode: "mock_collector",
      status: "sent",
      protocol: "otlp-http",
      contentType: "application/json",
      signalCount: 3,
      serviceCount: 1,
      endpointConfigured: true,
      endpointValueReturned: false,
      headersValueReturned: false,
      bodyValueReturned: false,
      localCollectorOnly: true,
      collectorStatusCode: 202,
      reason: "Sanitized telemetry was sent to the configured local mock collector.",
    });
    assert.equal(collector.requests.length, 1);
    assert.equal(collector.requests[0].method, "POST");
    assert.match(collector.requests[0].headers["content-type"], /application\/json/);

    const payload = JSON.parse(collector.requests[0].body);
    assert.deepEqual(payload.resource, {
      serviceName: "service-lasso-core",
      serviceNamespace: "service-lasso",
      serviceInstanceId: "local-runtime",
    });
    assert.equal(payload.signals.length, 3);
    assert.equal(payload.signals[0].attributes["service.id"], "telemetry-export");
    assertNoSecretMaterial(body, { sentinels });
    assertNoSecretMaterial(payload, { sentinels });
    assert.equal(JSON.stringify(body).includes("signals"), false);
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
    await collector.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GET /api/telemetry redacts sensitive-looking values even on allowlisted attributes", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-telemetry-attribute-redaction-");
  await writeManifest(servicesRoot, "telemetry-redaction", {
    id: "telemetry-redaction",
    name: "telemetry-redaction",
    description: "Fixture with sensitive-looking metadata.",
    version: rawSecretSentinel,
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    healthcheck: { type: "process" },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const result = await getJson(apiServer.url + "/api/telemetry");

    assert.equal(result.status, 200);
    assert.equal(result.body.telemetry.redaction.redactedValue, "[REDACTED]");
    assert.deepEqual(result.body.telemetry.redaction.patternClasses, [
      "bearer tokens",
      "GitHub-style tokens",
      "AWS access keys",
      "private key blocks",
      "basic-auth URLs",
      "sensitive key-value pairs",
      "Service Lasso secret regression sentinels",
    ]);
    const attributes = result.body.telemetry.services[0].signals[0].attributes;
    assert.equal(attributes["service.version"], "[REDACTED]");
    assertAllowlistedSignals(result.body.telemetry);
    assertNoSecretMaterial(result.body, { sentinels });
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GET /api/telemetry reports safe API request outcome telemetry without raw URL material", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-telemetry-api-request-");
  await writeExecutableFixtureService(servicesRoot, "telemetry-api", {});

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const missingService = await fetch(
      apiServer.url + "/api/services/" + encodeURIComponent(rawSecretSentinel) + "/health?token=" + rawSecretSentinel,
    );
    assert.equal(missingService.status, 404);
    const missingServiceCorrelationId = missingService.headers.get("x-service-lasso-correlation-id");
    const missingServiceTraceId = missingService.headers.get("x-service-lasso-trace-id");
    assert.match(missingServiceCorrelationId, /^sl-[a-f0-9]{16}$/);
    assert.match(missingServiceTraceId, /^[a-f0-9]{32}$/);

    const health = await getJson(apiServer.url + "/api/health?token=" + rawSecretSentinel);
    assert.equal(health.status, 200);
    const healthResponse = await fetch(apiServer.url + "/api/health");
    assert.equal(healthResponse.status, 200);
    const healthCorrelationId = healthResponse.headers.get("x-service-lasso-correlation-id");
    const healthTraceId = healthResponse.headers.get("x-service-lasso-trace-id");
    assert.match(healthCorrelationId, /^sl-[a-f0-9]{16}$/);
    assert.match(healthTraceId, /^[a-f0-9]{32}$/);

    const result = await getJson(apiServer.url + "/api/telemetry?token=" + rawSecretSentinel);

    assert.equal(result.status, 200);
    assert.equal(result.body.telemetry.apiRequests.length, 3);
    assert.deepEqual(
      result.body.telemetry.apiRequests.map((request) => request.routeTemplate),
      ["/api/services/{serviceId}/health", "/api/health", "/api/health"],
    );
    assert.deepEqual(
      result.body.telemetry.apiRequests.map((request) => request.signal.attributes["http.response.status_class"]),
      ["4xx", "2xx", "2xx"],
    );
    assert.equal(result.body.telemetry.apiRequests[0].signal.attributes["service.operation.outcome"], "client_error");
    assert.equal(result.body.telemetry.apiRequests[1].signal.attributes["service.operation.outcome"], "success");
    assert.equal(result.body.telemetry.apiRequests[0].signal.correlationId, missingServiceCorrelationId);
    assert.equal(result.body.telemetry.apiRequests[0].signal.traceId, missingServiceTraceId);
    assert.equal(result.body.telemetry.apiRequests[2].signal.correlationId, healthCorrelationId);
    assert.equal(result.body.telemetry.apiRequests[2].signal.traceId, healthTraceId);
    assert.equal(result.body.telemetry.exportPreview.signalCount, 6);
    assert.deepEqual(result.body.telemetry.apiRequestBuffer, {
      capacity: 50,
      retainedCount: 3,
      droppedCount: 0,
      routeTemplateOnly: true,
      rawMaterialReturned: false,
    });
    assertAllowlistedSignals(result.body.telemetry);
    assertNoSecretMaterial(result.body, { sentinels });
  } finally {
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
    assert.deepEqual(result.body.telemetry.apiRequestBuffer, {
      capacity: 50,
      retainedCount: 0,
      droppedCount: 0,
      routeTemplateOnly: true,
      rawMaterialReturned: false,
    });
    assert.match(result.body.telemetry.exportPreview.reason, /OTLP export remains disabled/i);
    assertAllowlistedSignals(result.body.telemetry);
    assertNoSecretMaterial(result.body, { sentinels });

    const exportResult = await fetch(apiServer.url + "/api/telemetry/export-test", { method: "POST" });
    const exportBody = await exportResult.json();
    assert.equal(exportResult.status, 200);
    assert.equal(exportBody.exportTest.mode, "disabled");
    assert.equal(exportBody.exportTest.status, "not_sent");
    assert.equal(exportBody.exportTest.endpointConfigured, false);
    assert.equal(exportBody.exportTest.collectorStatusCode, null);
    assert.equal(exportBody.exportTest.endpointValueReturned, false);
    assert.equal(exportBody.exportTest.headersValueReturned, false);
    assert.equal(exportBody.exportTest.bodyValueReturned, false);
    assertNoSecretMaterial(exportBody, { sentinels });
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

test("GET /api/telemetry reports bounded API request buffer metadata without raw request material", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-telemetry-buffer-");
  await writeExecutableFixtureService(servicesRoot, "telemetry-buffer", {});

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    for (let index = 0; index < 55; index += 1) {
      const response = await fetch(
        apiServer.url + "/api/health?token=" + encodeURIComponent(rawSecretSentinel) + "&index=" + index,
      );
      assert.equal(response.status, 200);
    }

    const result = await getJson(apiServer.url + "/api/telemetry?token=" + rawSecretSentinel);

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.telemetry.apiRequestBuffer, {
      capacity: 50,
      retainedCount: 50,
      droppedCount: 5,
      routeTemplateOnly: true,
      rawMaterialReturned: false,
    });
    assert.equal(result.body.telemetry.apiRequests.length, 50);
    assert.equal(
      result.body.telemetry.apiRequests.every((request) => request.routeTemplate === "/api/health"),
      true,
    );
    assert.equal(result.body.telemetry.exportPreview.signalCount, 53);
    assertAllowlistedSignals(result.body.telemetry);
    assertNoSecretMaterial(result.body, { sentinels });
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

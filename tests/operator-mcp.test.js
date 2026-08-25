import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { getServiceRuntimeLogPaths } from "../dist/runtime/operator/logs.js";
import {
  assertNoSecretMaterial,
  serviceLassoSecretLeakSentinels,
} from "../dist/testing/secretLeakHarness.js";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";

async function rpc(apiServer, request) {
  const response = await fetch(apiServer.url + "/api/mcp", {
    method: "POST",
    headers: {
      "accept": "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("text/event-stream") ? parseMcpEventStream(text) : JSON.parse(text);
  return {
    status: response.status,
    body,
  };
}

function parseMcpEventStream(text) {
  const data = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  return JSON.parse(data);
}

async function writeSecretLog(serviceRoot) {
  const logPaths = getServiceRuntimeLogPaths(serviceRoot);
  await mkdir(path.dirname(logPaths.logPath), { recursive: true });
  await writeFile(
    logPaths.logPath,
    JSON.stringify({
      level: "stdout",
      message:
        "token=" +
        serviceLassoSecretLeakSentinels[0].value +
        " Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
    }) + "\n",
  );
}

test("MCP endpoint advertises read-only operator tools and resources", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-");
  let apiServer;

  try {
    await writeManifest(servicesRoot, "mcp-service", {
      id: "mcp-service",
      name: "MCP Service",
      description: "MCP fixture.",
      ports: {
        web: 43101,
      },
      urls: [
        {
          label: "ui",
          url: "http://operator:secret@127.0.0.1:${WEB_PORT}/admin?token=keep-out#frag",
        },
      ],
      healthcheck: {
        type: "process",
      },
    });

    apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot, version: "test-version" });

    const oldDiscoveryResponse = await fetch(apiServer.url + "/api/mcp");
    const capabilitiesResponse = await fetch(apiServer.url + "/api/mcp/info");
    const capabilities = await capabilitiesResponse.json();
    const tools = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const resources = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: 2,
      method: "resources/list",
    });
    const resourceTemplates = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "resource-templates",
      method: "resources/templates/list",
    });
    const services = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "service_lasso_list_services", arguments: {} },
    });

    assert.equal(oldDiscoveryResponse.status, 405);
    assert.equal(oldDiscoveryResponse.headers.get("allow"), "POST");
    assert.equal(capabilitiesResponse.status, 200);
    assert.equal(capabilities.contractVersion, "service-lasso-mcp.v1");
    assert.equal(capabilities.sdk.packageName, "@modelcontextprotocol/sdk");
    assert.equal(capabilities.sdk.version, "1.30.0");
    assert.deepEqual(capabilities.policy, { operatingMode: "read-only", guardedToolsAvailable: false });
    assert.equal(capabilities.scope.mutatingOperations, "omitted");
    assert.equal(capabilities.runtime.serviceCount, 1);
    assert.equal(Object.hasOwn(capabilities.runtime, "servicesRoot"), false);
    assert.equal(Object.hasOwn(capabilities.runtime, "workspaceRoot"), false);
    assert.equal(tools.status, 200);
    assert.deepEqual(
      tools.body.result.tools.map((tool) => tool.name),
      [
        "service_lasso_runtime_status",
        "service_lasso_list_services",
        "service_lasso_get_service",
        "service_lasso_get_health",
        "service_lasso_list_routes",
        "service_lasso_dependency_status",
        "service_lasso_logs_summary",
        "service_lasso_audit_search",
        "service_lasso_update_status",
        "service_lasso_config_drift",
        "service_lasso_recovery_status",
        "service_lasso_operation_status",
        "service_lasso_diagnostics_summary",
        "service_lasso_secret_metadata",
      ],
    );
    assert.equal(tools.body.result.tools.every((tool) => tool.title), true);
    assert.equal(tools.body.result.tools.every((tool) => tool.inputSchema.additionalProperties === false), true);
    assert.equal(tools.body.result.tools.every((tool) => tool.outputSchema.additionalProperties === false), true);
    assert.equal(tools.body.result.tools.every((tool) => tool.annotations.readOnlyHint === true), true);
    const servicePayload = JSON.parse(services.body.result.content[0].text);
    assert.deepEqual(services.body.result.structuredContent, servicePayload);
    assert.equal(Object.hasOwn(servicePayload.services[0], "manifestPath"), false);
    assert.equal(Object.hasOwn(servicePayload.services[0], "serviceRoot"), false);
    assert.equal(
      tools.body.result.tools.some((tool) => /start|stop|restart|install|config|execute/i.test(tool.name)),
      false,
    );
    assert.deepEqual(
      resources.body.result.resources.map((resource) => resource.uri),
      [
        "servicelasso://runtime",
        "servicelasso://services",
        "servicelasso://health",
        "servicelasso://routes",
        "servicelasso://dependencies",
        "servicelasso://diagnostics",
        "servicelasso://secret-metadata",
      ],
    );
    assert.deepEqual(
      resourceTemplates.body.result.resourceTemplates.map((resource) => resource.uriTemplate),
      [
        "servicelasso://services/{serviceId}",
        "servicelasso://services/{serviceId}/health",
        "servicelasso://services/{serviceId}/routes",
        "servicelasso://services/{serviceId}/dependencies",
        "servicelasso://services/{serviceId}/updates",
        "servicelasso://services/{serviceId}/drift",
        "servicelasso://services/{serviceId}/recovery",
      ],
    );
  } finally {
    await apiServer?.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("MCP tool calls return redacted log summaries and sanitized routes", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-redaction-");
  let apiServer;

  try {
    const serviceRoot = await writeManifest(servicesRoot, "mcp-secret-service", {
      id: "mcp-secret-service",
      name: "MCP Secret Service",
      description: "MCP fixture with secret-shaped data.",
      env: {
        SERVICE_TOKEN: serviceLassoSecretLeakSentinels[0].value,
      },
      globalenv: {
        SHARED_PASSWORD: serviceLassoSecretLeakSentinels[1].value,
      },
      ports: {
        web: 43102,
      },
      urls: [
        {
          label: "admin",
          url: "https://user:password@example.invalid:${WEB_PORT}/admin?access_token=keep-out#frag",
        },
      ],
      broker: {
        imports: [
          {
            ref: "identity.CLIENT_SECRET",
            namespace: "identity",
            required: true,
          },
        ],
        accessPolicy: {
          grants: [
            {
              namespace: "identity",
              operations: ["resolve"],
              refs: ["identity.CLIENT_SECRET"],
              purpose: "MCP metadata redaction fixture.",
            },
          ],
        },
      },
      healthcheck: {
        type: "process",
      },
    });
    await writeSecretLog(serviceRoot);

    apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot, version: "test-version" });

    const routes = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "routes",
      method: "tools/call",
      params: {
        name: "service_lasso_list_routes",
        arguments: {
          serviceId: "mcp-secret-service",
        },
      },
    });
    const logs = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "logs",
      method: "tools/call",
      params: {
        name: "service_lasso_logs_summary",
        arguments: {
          serviceId: "mcp-secret-service",
          limit: 5,
        },
      },
    });
    const diagnostics = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "diagnostics",
      method: "resources/read",
      params: {
        uri: "servicelasso://diagnostics",
      },
    });

    assert.equal(routes.status, 200);
    assert.equal(logs.status, 200);
    assert.equal(diagnostics.status, 200);

    const routePayload = JSON.parse(routes.body.result.content[0].text);
    const logPayload = JSON.parse(logs.body.result.content[0].text);
    const diagnosticsPayload = JSON.parse(diagnostics.body.result.contents[0].text);
    const serialized = JSON.stringify({ routePayload, logPayload, diagnosticsPayload });

    assert.equal(
      routePayload.services[0].endpoints.find((endpoint) => endpoint.label === "admin")?.url,
      "https://example.invalid:43102/admin",
    );
    assert.equal(logPayload.log.entries[0].message.includes("[REDACTED]"), true);
    assert.equal(diagnosticsPayload.secretReferences.references, 1);
    assertNoSecretMaterial(routePayload);
    assertNoSecretMaterial(logPayload);
    assertNoSecretMaterial(diagnosticsPayload);
    assert.doesNotMatch(serialized, /keep-out|user:password|SERVICE_LASSO_FAKE_SECRET_SENTINEL|abcdefghijklmnopqrstuvwxyz123456/);
  } finally {
    await apiServer?.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("MCP secret metadata returns refs, assignment, and rotation without secret values", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-secret-metadata-");
  let apiServer;

  try {
    await writeManifest(servicesRoot, "mcp-secret-metadata-service", {
      id: "mcp-secret-metadata-service",
      name: "MCP Secret Metadata Service",
      description: "Secret-metadata fixture.",
      env: {
        SERVICE_TOKEN: serviceLassoSecretLeakSentinels[0].value,
      },
      broker: {
        imports: [
          {
            ref: "identity.CLIENT_SECRET",
            namespace: "identity",
            required: true,
          },
        ],
        accessPolicy: {
          grants: [
            {
              namespace: "identity",
              operations: ["resolve"],
              refs: ["identity.CLIENT_SECRET"],
              purpose: "MCP secret-metadata assignment fixture.",
            },
          ],
        },
      },
      healthcheck: {
        type: "process",
      },
    });

    apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot, version: "test-version" });

    const metadata = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "secret-metadata",
      method: "tools/call",
      params: {
        name: "service_lasso_secret_metadata",
        arguments: {
          serviceId: "mcp-secret-metadata-service",
        },
      },
    });
    const extraArgs = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "secret-metadata-extra",
      method: "tools/call",
      params: {
        name: "service_lasso_secret_metadata",
        arguments: {
          serviceId: "mcp-secret-metadata-service",
          reveal: true,
        },
      },
    });
    const unknownService = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "secret-metadata-unknown",
      method: "tools/call",
      params: {
        name: "service_lasso_secret_metadata",
        arguments: {
          serviceId: "missing-service",
        },
      },
    });
    const resource = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "secret-metadata-resource",
      method: "resources/read",
      params: {
        uri: "servicelasso://secret-metadata",
      },
    });

    assert.equal(metadata.status, 200);
    assert.equal(resource.status, 200);
    const payload = JSON.parse(metadata.body.result.content[0].text);
    const resourcePayload = JSON.parse(resource.body.result.contents[0].text);
    const serialized = JSON.stringify({ payload, resourcePayload });

    assert.equal(payload.broker.discovered, false);
    assert.equal(payload.broker.availability, "not_discovered");
    assert.equal(payload.lockout.status, "not_queried");
    assert.equal(payload.summary.references, 1);
    assert.equal(payload.services.length, 1);
    assert.equal(payload.services[0].serviceId, "mcp-secret-metadata-service");
    assert.equal(payload.services[0].references[0].ref, "identity.CLIENT_SECRET");
    assert.equal(payload.services[0].references[0].namespace, "identity");
    assert.equal(payload.services[0].references[0].key, "CLIENT_SECRET");
    assert.equal(payload.services[0].references[0].accessPolicy.status, "allowed");
    assert.equal(payload.services[0].rotation[0].ref, "identity.CLIENT_SECRET");
    assert.equal(Object.hasOwn(payload.services[0], "manifestPath"), false);
    assert.equal(payload.safety.mutating, false);
    assert.equal(resourcePayload.services[0].serviceId, "mcp-secret-metadata-service");
    assert.equal(extraArgs.body.result.isError, true);
    assert.match(extraArgs.body.result.content[0].text, /Unrecognized key: "reveal"/);
    assert.equal(unknownService.body.result.isError, true);
    assert.match(unknownService.body.result.content[0].text, /Unknown service id: missing-service/);
    assertNoSecretMaterial(payload);
    assertNoSecretMaterial(resourcePayload);
    assert.doesNotMatch(serialized, /SERVICE_LASSO_FAKE_SECRET_SENTINEL|reveal|CLIENT_SECRET_VALUE/);
  } finally {
    await apiServer?.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

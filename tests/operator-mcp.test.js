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
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
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

    const capabilitiesResponse = await fetch(apiServer.url + "/api/mcp");
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

    assert.equal(capabilitiesResponse.status, 200);
    assert.equal(capabilities.contractVersion, "service-lasso-mcp.v1");
    assert.equal(capabilities.scope.mutatingOperations, "omitted");
    assert.equal(capabilities.runtime.serviceCount, 1);
    assert.equal(tools.status, 200);
    assert.deepEqual(
      tools.body.result.tools.map((tool) => tool.name),
      [
        "service_lasso_list_services",
        "service_lasso_get_health",
        "service_lasso_list_routes",
        "service_lasso_dependency_status",
        "service_lasso_logs_summary",
        "service_lasso_diagnostics_summary",
      ],
    );
    assert.equal(
      tools.body.result.tools.some((tool) => /start|stop|restart|install|config|execute/i.test(tool.name)),
      false,
    );
    assert.deepEqual(
      resources.body.result.resources.map((resource) => resource.uri),
      [
        "servicelasso://services",
        "servicelasso://health",
        "servicelasso://routes",
        "servicelasso://dependencies",
        "servicelasso://diagnostics",
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

    assert.equal(routePayload.services[0].endpoints[0].url, "https://example.invalid:43102/admin");
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

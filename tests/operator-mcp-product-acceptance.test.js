import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startApiServer } from "../dist/server/index.js";
import { runInspector, supportedMcpVersions } from "../scripts/mcp-product-acceptance-lib.mjs";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";

function resultPayload(value) {
  return value?.result ?? value;
}

test("#864 official SDK and Inspector accept the guarded Streamable HTTP product contract", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-product-");
  let apiServer;
  const client = new Client({ name: "service-lasso-product-acceptance", version: "1.0.0" });
  let connected = false;
  try {
    await writeManifest(servicesRoot, "canonical-mcp-service", {
      id: "canonical-mcp-service",
      name: "Canonical MCP service",
      description: "Metadata-only product acceptance fixture.",
      healthcheck: { type: "process" },
    });
    apiServer = await startApiServer({
      port: 0,
      servicesRoot,
      workspaceRoot,
      version: "mcp-product-acceptance",
      mcpHttpIdentity: { env: { SERVICE_LASSO_MCP_MODE: "guarded" } },
    });
    const endpoint = new URL(`${apiServer.url}/api/mcp`);
    const transport = new StreamableHTTPClientTransport(endpoint);
    await client.connect(transport);
    connected = true;

    const supported = await supportedMcpVersions();
    assert.equal(transport.protocolVersion, supported.protocolVersion);
    assert.equal(client.getServerVersion()?.name, "service-lasso-operator");
    assert.equal(typeof client.getServerCapabilities()?.tools, "object");
    assert.equal(typeof client.getServerCapabilities()?.resources, "object");

    const tools = await client.listTools();
    const resources = await client.listResources();
    assert.equal(tools.tools.length, 27);
    assert.equal(resources.resources.length >= 2, true);
    assert.equal(tools.tools.every((tool) => tool.inputSchema?.additionalProperties === false), true);
    assert.equal(tools.tools.every((tool) => tool.outputSchema?.additionalProperties === false), true);
    assert.equal(tools.tools.filter((tool) => tool.annotations?.readOnlyHint === false).length, 12);
    assert.equal(tools.tools.some((tool) => /shell|terminal|stdin|filesystem|secret[_-]?value/iu.test(tool.name)), false);

    const runtimeStatus = await client.callTool({ name: "service_lasso_runtime_status", arguments: {} });
    assert.equal(runtimeStatus.isError, undefined);
    assert.equal(runtimeStatus.structuredContent.runtime.status, "ready");
    assert.equal(runtimeStatus.structuredContent.runtime.serviceCount, 1);

    const sensitiveMarker = "product-acceptance-sensitive-marker";
    const strictDenial = await client.callTool({
      name: "service_lasso_runtime_status",
      arguments: { additionalProperty: sensitiveMarker },
    });
    assert.equal(strictDenial.isError, true);
    assert.equal(JSON.stringify(strictDenial).includes(sensitiveMarker), false);

    await client.close();
    connected = false;

    const inspectorTools = resultPayload(await runInspector({
      serverUrl: endpoint.toString(),
      method: "tools/list",
      strict: true,
    }));
    assert.equal(Array.isArray(inspectorTools.tools), true);
    assert.equal(inspectorTools.tools.length, 27);

    const inspectorResources = resultPayload(await runInspector({
      serverUrl: endpoint.toString(),
      method: "resources/list",
    }));
    assert.equal(Array.isArray(inspectorResources.resources), true);
    assert.equal(inspectorResources.resources.length >= 2, true);

    const inspectorRead = resultPayload(await runInspector({
      serverUrl: endpoint.toString(),
      method: "tools/call",
      toolName: "service_lasso_runtime_status",
      toolArgs: {},
    }));
    assert.equal(inspectorRead.isError, undefined);
    assert.equal(inspectorRead.structuredContent.runtime.status, "ready");

    const infoResponse = await fetch(`${apiServer.url}/api/mcp/info`);
    assert.equal(infoResponse.status, 200);
    const info = await infoResponse.json();
    assert.equal(info.protocolVersion, supported.protocolVersion);
    assert.equal(info.supportedProtocolVersions.includes("2024-11-05"), true);
    assert.equal(info.supportedProtocolVersions.includes(supported.protocolVersion), true);
    assert.deepEqual(info.sdk, {
      packageName: supported.sdk.packageName,
      version: supported.sdk.version,
      streamableHttp: "stateless",
      stdio: "opt-in thin active-runtime adapter",
    });
    assert.equal(info.policy.operatingMode, "guarded");
    assert.equal(info.policy.durableOperationsAvailable, true);
  } finally {
    if (connected) await client.close().catch(() => undefined);
    await apiServer?.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

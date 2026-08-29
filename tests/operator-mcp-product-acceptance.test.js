import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startApiServer } from "../dist/server/index.js";
import { runInspector, supportedMcpVersions } from "../scripts/mcp-product-acceptance-lib.mjs";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";

const execFileAsync = promisify(execFile);

function resultPayload(value) {
  return value?.result ?? value;
}

function parseEventStream(text) {
  const data = text
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  return data ? JSON.parse(data) : null;
}

async function protocolRpc(endpoint, request, protocolVersion) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(protocolVersion ? { "mcp-protocol-version": protocolVersion } : {}),
    },
    body: JSON.stringify(request),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text
      ? ((response.headers.get("content-type") ?? "").includes("text/event-stream") ? parseEventStream(text) : JSON.parse(text))
      : null,
  };
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
    assert.deepEqual(info.supportedProtocolVersions, supported.supportedProtocolVersions);
    assert.deepEqual(info.sdk, {
      packageName: supported.sdk.packageName,
      version: supported.sdk.version,
      streamableHttp: "stateless",
      stdio: "opt-in thin active-runtime adapter",
    });
    assert.equal(info.policy.operatingMode, "guarded");
    assert.equal(info.policy.durableOperationsAvailable, true);

    for (const [index, protocolVersion] of supported.supportedProtocolVersions.entries()) {
      const initialization = await protocolRpc(endpoint, {
        jsonrpc: "2.0",
        id: `source-protocol-initialize-${index}`,
        method: "initialize",
        params: {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: "service-lasso-source-protocol-matrix", version: "1.0.0" },
        },
      });
      assert.equal(initialization.status, 200);
      assert.equal(initialization.body.result.protocolVersion, protocolVersion);

      const notification = await protocolRpc(endpoint, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      }, protocolVersion);
      assert.equal([200, 202].includes(notification.status), true);

      const discovery = await protocolRpc(endpoint, {
        jsonrpc: "2.0",
        id: `source-protocol-tools-${index}`,
        method: "tools/list",
        params: {},
      }, protocolVersion);
      assert.equal(discovery.status, 200);
      assert.equal(discovery.body.result.tools.length, 27);
    }

    const unsupported = await protocolRpc(endpoint, {
      jsonrpc: "2.0",
      id: "source-protocol-unsupported",
      method: "initialize",
      params: {
        protocolVersion: "1900-01-01",
        capabilities: {},
        clientInfo: { name: "service-lasso-source-unsupported-protocol", version: "1.0.0" },
      },
    });
    assert.equal(unsupported.status, 200);
    assert.equal(unsupported.body.result.protocolVersion, supported.protocolVersion);
  } finally {
    if (connected) await client.close().catch(() => undefined);
    await apiServer?.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#864 current-process identity cache coalesces concurrent real inspection", async () => {
  const result = await execFileAsync(
    process.execPath,
    ["tests/fixtures/current-process-identity-runner.mjs", "concurrent-cache"],
    { cwd: process.cwd(), timeout: 90_000, windowsHide: true },
  );
  assert.deepEqual(JSON.parse(result.stdout), { result: "shared-verified-identity" });
  assert.equal(result.stderr, "");
});

test("#864 failed Windows current-process identity prime clears its cache for a bounded retry", {
  skip: process.platform !== "win32",
}, async () => {
  const result = await execFileAsync(
    process.execPath,
    ["tests/fixtures/current-process-identity-runner.mjs", "failed-prime-retry"],
    { cwd: process.cwd(), timeout: 90_000, windowsHide: true },
  );
  assert.deepEqual(JSON.parse(result.stdout), { result: "failed-prime-retried" });
  assert.equal(result.stderr, "");
});

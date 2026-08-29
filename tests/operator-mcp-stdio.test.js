import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { readAuditEvents } from "../dist/runtime/audit/store.js";
import { resolveMcpStdioAuthorization } from "../dist/runtime/operator/mcp-auth.js";
import { startServiceLassoMcpStdioAdapter } from "../dist/runtime/operator/mcp.js";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

test("#860 serves MCP stdio from the active runtime with a redacted local credential", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-stdio-");
  const input = new PassThrough();
  const output = new PassThrough();
  const messages = [];
  let buffered = "";
  const credential = "stdio-credential-must-not-appear-in-protocol-output";
  output.on("data", (chunk) => {
    buffered += chunk.toString("utf8");
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) messages.push(JSON.parse(line));
    }
  });

  let apiServer;
  try {
    assert.throws(
      () => resolveMcpStdioAuthorization({ env: {} }),
      (error) => error?.code === "mcp_stdio_credentials_not_configured",
    );
    await writeManifest(servicesRoot, "mcp-stdio-service", {
      id: "mcp-stdio-service",
      name: "MCP stdio fixture",
      description: "Active runtime stdio fixture.",
      healthcheck: { type: "process" },
    });

    apiServer = await startApiServer({
      port: 0,
      servicesRoot,
      workspaceRoot,
      version: "stdio-test-version",
      mcpStdio: {
        stdin: input,
        stdout: output,
        env: {
          SERVICE_LASSO_MCP_STDIO_CREDENTIAL: credential,
          SERVICE_LASSO_MCP_STDIO_ACTOR: "mcp-stdio-test-actor",
          SERVICE_LASSO_MCP_STDIO_CLIENT_ID: "mcp-stdio-test-client",
        },
      },
    });

    input.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "stdio-test-client", version: "1.0.0" },
      },
    })}\n`);
    const initialized = await waitFor(() => messages.find((message) => message.id === 1));
    assert.equal(initialized.result.serverInfo.name, "service-lasso-operator");
    assert.equal(initialized.result.protocolVersion, "2024-11-05");

    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
    const tools = await waitFor(() => messages.find((message) => message.id === 2));
    assert.equal(tools.result.tools.some((tool) => tool.name === "service_lasso_list_services"), true);
    assert.equal(tools.result.tools.some((tool) => tool.name === "service_lasso_logs_summary"), true);

    const audit = await readAuditEvents({ workspaceRoot });
    const allowed = audit.events.find((event) => event.action === "mcp.auth.allowed" && event.source === "runtime-mcp-stdio");
    assert.equal(allowed?.actor, "mcp-stdio-test-actor");
    assert.equal(allowed?.metadata?.clientId, "mcp-stdio-test-client");
    const serialized = JSON.stringify({ messages, audit });
    assert.equal(serialized.includes(credential), false);
  } finally {
    input.end();
    await apiServer?.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#862 derives guarded stdio authority only from explicit supported process scopes", () => {
  const base = {
    SERVICE_LASSO_MCP_STDIO_CREDENTIAL: "guarded-stdio-credential",
    SERVICE_LASSO_MCP_STDIO_ACTOR: "guarded-stdio-actor",
    SERVICE_LASSO_MCP_STDIO_CLIENT_ID: "guarded-stdio-client",
  };
  const defaultAuthorization = resolveMcpStdioAuthorization({ env: base });
  assert.equal(defaultAuthorization.actor.permissionProfile, "observer");
  assert.deepEqual(defaultAuthorization.actor.scopes, ["service-lasso:read", "service-lasso:logs:read"]);

  const guardedAuthorization = resolveMcpStdioAuthorization({
    env: {
      ...base,
      SERVICE_LASSO_MCP_STDIO_SCOPES: [
        "service-lasso:read",
        "service-lasso:lifecycle:write",
        "service-lasso:config:write",
        "service-lasso:update:write",
        "service-lasso:runtime:admin",
      ].join(","),
    },
  });
  assert.equal(guardedAuthorization.actor.permissionProfile, "administrator");
  assert.equal(guardedAuthorization.actor.scopes.includes("service-lasso:runtime:admin"), true);

  assert.throws(
    () => resolveMcpStdioAuthorization({
      env: { ...base, SERVICE_LASSO_MCP_STDIO_SCOPES: "service-lasso:read,untrusted:write" },
    }),
    (error) => error?.code === "mcp_stdio_scopes_invalid",
  );
});

test("#862 audits strict-schema denials on the guarded stdio transport without argument leakage", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-stdio-denial-");
  const input = new PassThrough();
  const output = new PassThrough();
  const messages = [];
  let buffered = "";
  output.on("data", (chunk) => {
    buffered += chunk.toString("utf8");
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) messages.push(JSON.parse(line));
  });
  const authorization = resolveMcpStdioAuthorization({
    env: {
      SERVICE_LASSO_MCP_STDIO_CREDENTIAL: "guarded-stdio-denial-credential",
      SERVICE_LASSO_MCP_STDIO_ACTOR: "guarded-stdio-actor",
      SERVICE_LASSO_MCP_STDIO_CLIENT_ID: "guarded-stdio-client",
      SERVICE_LASSO_MCP_STDIO_SCOPES: "service-lasso:read,service-lasso:lifecycle:write",
    },
  });
  let adapter;
  try {
    adapter = await startServiceLassoMcpStdioAdapter({
      version: "stdio-guarded-test",
      servicesRoot,
      workspaceRoot,
      discovered: [],
      registry: { list: () => [], getById: () => undefined },
      graph: { getDependencies: () => [], getDependents: () => [], topologicalSort: () => [] },
      sharedGlobalEnv: {},
      mcpOperatingMode: "guarded",
      guardedActionFacade: {
        async preflight() { throw new Error("schema denial must not reach preflight"); },
        async execute() { throw new Error("schema denial must not execute"); },
      },
    }, authorization, { stdin: input, stdout: output, operatingMode: "guarded" });
    input.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "stdio-denial-test", version: "1" } },
    })}\n`);
    await waitFor(() => messages.find((message) => message.id === 1));
    input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    input.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "service_lasso_start_service", arguments: { serviceId: "fixture-service", command: "stdio-sensitive-command" } },
    })}\n`);
    const denied = await waitFor(() => messages.find((message) => message.id === 2));
    assert.equal(denied.result.isError, true);
    const audit = await readAuditEvents({ workspaceRoot });
    assert.equal(audit.events.some((event) =>
      event.action === "mcp.action.denied" && event.subject === "service_start" && event.reason === "invalid_request"
    ), true);
    assert.equal(JSON.stringify({ messages, audit }).includes("stdio-sensitive-command"), false);
  } finally {
    input.end();
    await adapter?.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

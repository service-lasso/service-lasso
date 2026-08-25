import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { readAuditEvents } from "../dist/runtime/audit/store.js";
import { resolveMcpStdioAuthorization } from "../dist/runtime/operator/mcp-auth.js";
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

    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
    const tools = await waitFor(() => messages.find((message) => message.id === 2));
    assert.equal(tools.result.tools.some((tool) => tool.name === "service_lasso_list_services"), true);
    assert.equal(tools.result.tools.some((tool) => tool.name === "service_lasso_logs_summary"), true);

    const audit = await readAuditEvents(workspaceRoot);
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

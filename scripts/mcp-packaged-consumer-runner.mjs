import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  MCP_PACKAGED_COVERAGE_KEYS,
  runInspector,
  supportedMcpVersions,
} from "./mcp-product-acceptance-lib.mjs";

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Fresh-consumer acceptance requires ${name}.`);
  return value;
}

function normalizeForComparison(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithin(root, candidate) {
  const normalizedRoot = normalizeForComparison(root);
  const normalizedCandidate = normalizeForComparison(candidate);
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertResolvedFromConsumer(consumerRoot, moduleUrl, label) {
  const resolved = fileURLToPath(moduleUrl);
  if (!isWithin(path.join(consumerRoot, "node_modules"), resolved)) {
    throw new Error(`${label} did not resolve from the fresh consumer node_modules tree.`);
  }
  return resolved;
}

function payload(value) {
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

async function postRpc(endpoint, request, protocolVersion) {
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
  const contentType = response.headers.get("content-type") ?? "";
  return {
    status: response.status,
    body: text
      ? (contentType.includes("text/event-stream") ? parseEventStream(text) : JSON.parse(text))
      : null,
  };
}

async function verifyProtocolMatrix(endpoint, supported) {
  for (const [index, protocolVersion] of supported.supportedProtocolVersions.entries()) {
    const initialized = await postRpc(endpoint, {
      jsonrpc: "2.0",
      id: `protocol-initialize-${index}`,
      method: "initialize",
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: "service-lasso-packaged-protocol-matrix", version: "1.0.0" },
      },
    });
    if (initialized.status !== 200 || initialized.body?.result?.protocolVersion !== protocolVersion) {
      throw new Error(`Packaged MCP did not negotiate advertised protocol revision ${protocolVersion}.`);
    }
    const notification = await postRpc(endpoint, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    }, protocolVersion);
    if (![200, 202].includes(notification.status)) {
      throw new Error(`Packaged MCP rejected initialized notification for ${protocolVersion}.`);
    }
    const discovery = await postRpc(endpoint, {
      jsonrpc: "2.0",
      id: `protocol-tools-${index}`,
      method: "tools/list",
      params: {},
    }, protocolVersion);
    if (discovery.status !== 200 || discovery.body?.result?.tools?.length !== 27) {
      throw new Error(`Packaged MCP discovery failed for advertised protocol revision ${protocolVersion}.`);
    }
  }

  const unsupported = await postRpc(endpoint, {
    jsonrpc: "2.0",
    id: "protocol-unsupported",
    method: "initialize",
    params: {
      protocolVersion: "1900-01-01",
      capabilities: {},
      clientInfo: { name: "service-lasso-packaged-unsupported-protocol", version: "1.0.0" },
    },
  });
  if (unsupported.status !== 200 || unsupported.body?.result?.protocolVersion !== supported.protocolVersion) {
    throw new Error("Packaged MCP unsupported-version negotiation did not fall back to the current protocol revision.");
  }
}

function isolatedRuntimeEnvironment(overrides) {
  const allowedNames = ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "ComSpec", "TEMP", "TMP", "TMPDIR", "NODE_OPTIONS", "PSModulePath"];
  const environment = Object.fromEntries(
    allowedNames
      .filter((name) => typeof process.env[name] === "string")
      .map((name) => [name, process.env[name]]),
  );
  return { ...environment, ...overrides };
}

const configuration = JSON.parse(requiredEnvironment("MCP_PACKAGE_ACCEPTANCE_CONFIGURATION"));
const consumerRoot = process.cwd();
const forbiddenSourceRoot = requiredEnvironment("MCP_PACKAGE_ACCEPTANCE_FORBIDDEN_SOURCE_ROOT");
delete process.env.MCP_PACKAGE_ACCEPTANCE_CONFIGURATION;
delete process.env.MCP_PACKAGE_ACCEPTANCE_FORBIDDEN_SOURCE_ROOT;
process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = configuration.instanceRegistryPath;
process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = configuration.portRegistryPath;
process.env.MCP_INSPECTOR_SECRET_STORE = "memory";
process.env.MCP_STORAGE_DIR = path.join(consumerRoot, ".mcp-inspector");
process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = path.join(consumerRoot, ".mcp-inspector", "oauth.json");

if (!isWithin(configuration.consumerRoot, consumerRoot) || isWithin(forbiddenSourceRoot, consumerRoot)) {
  throw new Error("Fresh-consumer acceptance did not start from its isolated consumer working directory.");
}

let sourceCheckoutAccessDenied = false;
try {
  await readFile(path.join(forbiddenSourceRoot, "package.json"));
} catch (error) {
  sourceCheckoutAccessDenied = error?.code === "ERR_ACCESS_DENIED";
}
if (!sourceCheckoutAccessDenied) {
  throw new Error("Fresh-consumer acceptance could still read the source checkout.");
}

const packageManifestPath = assertResolvedFromConsumer(
  consumerRoot,
  import.meta.resolve("@service-lasso/service-lasso/package.json"),
  "Service Lasso",
);
assertResolvedFromConsumer(consumerRoot, import.meta.resolve("@modelcontextprotocol/sdk/package.json"), "MCP SDK");
assertResolvedFromConsumer(consumerRoot, import.meta.resolve("@modelcontextprotocol/inspector/package.json"), "MCP Inspector");
if (isWithin(forbiddenSourceRoot, packageManifestPath)) {
  throw new Error("Fresh-consumer Service Lasso resolution reached the source checkout.");
}

const installedRoot = path.dirname(packageManifestPath);
const packaged = await import("@service-lasso/service-lasso");
if (typeof packaged.startApiServer !== "function") {
  throw new Error("Fresh consumer package does not expose the runtime API entrypoint.");
}

const inspectorEnvironment = {
  ...process.env,
  NODE_OPTIONS: `--permission --allow-fs-read=* --allow-fs-write=${consumerRoot} --allow-child-process`,
};

let httpClient;
let httpServer;
let stdioClient;
try {
  httpServer = await packaged.startApiServer({
    port: 0,
    servicesRoot: configuration.servicesRoot,
    workspaceRoot: configuration.httpWorkspaceRoot,
    version: configuration.version,
    mcpHttpIdentity: { env: { SERVICE_LASSO_MCP_MODE: "guarded" } },
  });
  const endpoint = new URL(`${httpServer.url}/api/mcp`);
  const transport = new StreamableHTTPClientTransport(endpoint);
  httpClient = new Client({ name: "service-lasso-packaged-acceptance", version: "1.0.0" });
  await httpClient.connect(transport);

  const supported = await supportedMcpVersions();
  if (transport.protocolVersion !== supported.protocolVersion) {
    throw new Error("Packaged Streamable HTTP did not negotiate the current MCP protocol.");
  }
  await verifyProtocolMatrix(endpoint, supported);

  const [tools, resources, runtimeStatus, services] = await Promise.all([
    httpClient.listTools(),
    httpClient.listResources(),
    httpClient.callTool({ name: "service_lasso_runtime_status", arguments: {} }),
    httpClient.callTool({ name: "service_lasso_list_services", arguments: { limit: 100 } }),
  ]);
  if (
    tools.tools.length !== 27 ||
    resources.resources.length < 2 ||
    runtimeStatus.isError ||
    runtimeStatus.structuredContent?.runtime?.status !== "ready" ||
    services.structuredContent?.services?.some((service) => service.id === configuration.serviceId) !== true
  ) {
    throw new Error("Packaged Streamable HTTP discovery or representative reads failed.");
  }
  if (
    !tools.tools.every((tool) => tool.inputSchema?.additionalProperties === false) ||
    !tools.tools.every((tool) => tool.outputSchema?.additionalProperties === false)
  ) {
    throw new Error("Packaged MCP advertised an open tool schema.");
  }

  const sensitiveMarker = "packaged-sensitive-argument-marker";
  const strictDenial = await httpClient.callTool({
    name: "service_lasso_runtime_status",
    arguments: { additionalProperty: sensitiveMarker },
  });
  if (!strictDenial.isError || JSON.stringify(strictDenial).includes(sensitiveMarker)) {
    throw new Error("Packaged MCP strict denial leaked a rejected argument.");
  }

  const inspectorTools = payload(await runInspector({
    serverUrl: endpoint.toString(),
    method: "tools/list",
    strict: true,
    env: inspectorEnvironment,
  }));
  const inspectorResources = payload(await runInspector({
    serverUrl: endpoint.toString(),
    method: "resources/list",
    env: inspectorEnvironment,
  }));
  const inspectorRead = payload(await runInspector({
    serverUrl: endpoint.toString(),
    method: "tools/call",
    toolName: "service_lasso_runtime_status",
    toolArgs: {},
    env: inspectorEnvironment,
  }));
  if (
    inspectorTools.tools?.length !== 27 ||
    !Array.isArray(inspectorResources.resources) ||
    inspectorRead.structuredContent?.runtime?.status !== "ready"
  ) {
    throw new Error("Official MCP Inspector did not accept the packaged Streamable HTTP surface.");
  }

  const plan = await httpClient.callTool({
    name: "service_lasso_start_service",
    arguments: { serviceId: configuration.serviceId },
  });
  if (plan.isError || plan.structuredContent?.status !== "preflight") {
    throw new Error("Canonical packaged guarded lifecycle preflight failed.");
  }
  const executionArguments = {
    serviceId: configuration.serviceId,
    execute: true,
    idempotencyKey: `mcp-product-${configuration.candidateSha.slice(0, 12)}`,
    confirmationId: plan.structuredContent.confirmation.id,
    confirmationPhrase: plan.structuredContent.confirmation.confirmationPhrase,
  };
  const completed = await httpClient.callTool({ name: "service_lasso_start_service", arguments: executionArguments });
  const replayed = await httpClient.callTool({ name: "service_lasso_start_service", arguments: executionArguments });
  if (
    completed.isError ||
    completed.structuredContent?.status !== "succeeded" ||
    completed.structuredContent?.idempotency?.replayed !== false ||
    completed.structuredContent?.result?.resultingState?.[0]?.running !== true ||
    replayed.isError ||
    replayed.structuredContent?.status !== "replayed" ||
    replayed.structuredContent?.idempotency?.replayed !== true ||
    replayed.structuredContent?.correlationId !== completed.structuredContent?.correlationId ||
    replayed.structuredContent?.result?.resultingState?.[0]?.running !== true
  ) {
    throw new Error("Canonical packaged guarded lifecycle action was not confirmed and exactly-once.");
  }

  await httpClient.close();
  httpClient = null;
  await httpServer.stop();
  httpServer = null;

  const stdioCredential = "packaged-stdio-capability-not-protocol-data";
  const stdioTransport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(installedRoot, "dist", "index.js")],
    cwd: consumerRoot,
    env: isolatedRuntimeEnvironment({
      SERVICE_LASSO_PORT: "0",
      SERVICE_LASSO_SERVICES_ROOT: configuration.servicesRoot,
      SERVICE_LASSO_WORKSPACE_ROOT: configuration.stdioWorkspaceRoot,
      SERVICE_LASSO_MCP_STDIO: "1",
      SERVICE_LASSO_MCP_STDIO_CREDENTIAL: stdioCredential,
      SERVICE_LASSO_MCP_STDIO_ACTOR: "packaged-mcp-actor",
      SERVICE_LASSO_MCP_STDIO_CLIENT_ID: "packaged-mcp-client",
      SERVICE_LASSO_MCP_MODE: "read-only",
      SERVICE_LASSO_INSTANCE_REGISTRY_PATH: configuration.instanceRegistryPath,
      SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: configuration.portRegistryPath,
    }),
    stderr: "pipe",
  });
  stdioClient = new Client({ name: "service-lasso-packaged-stdio", version: "1.0.0" });
  await stdioClient.connect(stdioTransport);
  const [stdioTools, stdioStatus] = await Promise.all([
    stdioClient.listTools(),
    stdioClient.callTool({ name: "service_lasso_runtime_status", arguments: {} }),
  ]);
  if (
    stdioTools.tools.length !== 15 ||
    stdioStatus.isError ||
    stdioStatus.structuredContent?.runtime?.status !== "ready" ||
    JSON.stringify({ stdioTools, stdioStatus }).includes(stdioCredential)
  ) {
    throw new Error("Fresh consumer packaged stdio acceptance failed.");
  }
  await stdioClient.close();
  stdioClient = null;

  const coverage = Object.fromEntries(MCP_PACKAGED_COVERAGE_KEYS.map((key) => [key, "passed"]));
  process.stdout.write(`${JSON.stringify({
    sdk: {
      ...supported.sdk,
      protocolVersion: supported.protocolVersion,
      supportedProtocolVersions: supported.supportedProtocolVersions,
    },
    inspector: { ...supported.inspector, result: "passed", strictSchema: "passed" },
    packagedRuntime: {
      sourceCheckoutRequired: false,
      sourceCheckoutAccess: "denied-by-node-permission-model",
      moduleResolution: "fresh-consumer-node-modules",
      workingDirectory: "fresh-consumer",
      streamableHttp: "passed",
      stdio: "passed",
      operatingModes: ["read-only", "guarded"],
      identityInspectionPolicy: process.platform === "win32"
        ? "native-win32-product-default"
        : "product-default",
    },
    canonical: {
      discovery: "passed",
      representativeReads: "passed",
      guardedLifecycle: "passed",
      exactlyOnce: true,
      terminalState: "running",
    },
    coverage,
    assertions: [...MCP_PACKAGED_COVERAGE_KEYS],
  })}\n`);
} finally {
  await stdioClient?.close().catch(() => undefined);
  await httpClient?.close().catch(() => undefined);
  await httpServer?.stop().catch(() => undefined);
}

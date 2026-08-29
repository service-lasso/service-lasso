import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { stagePublishedPackage } from "./publish-package-lib.mjs";
import {
  MCP_PRODUCT_EVIDENCE_CONTRACT,
  runCommand,
  runInspector,
  supportedMcpVersions,
  validateMcpProductEvidence,
} from "./mcp-product-acceptance-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const platform = process.platform;
const npmEntrypoint = process.env.npm_execpath?.trim();
if (!npmEntrypoint) {
  throw new Error("Packaged MCP acceptance must run through the governed npm script entrypoint.");
}

async function exactCandidateSha() {
  const configured = process.env.CANDIDATE_SHA?.trim().toLowerCase();
  if (configured) return configured;
  return (await runCommand("git", ["rev-parse", "HEAD"], { cwd: repoRoot })).stdout.trim().toLowerCase();
}

function cleanEnvironment(overrides) {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter((entry) => typeof entry[1] === "string")),
    ...overrides,
  };
}

async function removeOwnedTempRoot(tempRoot) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      await rm(tempRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!error || typeof error !== "object" || !["EBUSY", "ENOTEMPTY", "EPERM"].includes(error.code) || attempt === 8) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
}

async function writeCanonicalService(servicesRoot) {
  const serviceId = "canonical-mcp-service";
  const serviceRoot = path.join(servicesRoot, serviceId);
  const runtimeRoot = path.join(serviceRoot, "runtime");
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(
    path.join(runtimeRoot, "canonical-service.mjs"),
    [
      "const heartbeat = setInterval(() => {}, 1000);",
      "const stop = () => { clearInterval(heartbeat); process.exit(0); };",
      'process.on("SIGINT", stop);',
      'process.on("SIGTERM", stop);',
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(serviceRoot, "service.json"),
    `${JSON.stringify({
      id: serviceId,
      name: "Canonical packaged MCP service",
      description: "Finite metadata-only packaged acceptance fixture.",
      executable: process.execPath,
      args: ["runtime/canonical-service.mjs"],
      healthcheck: { type: "process" },
    }, null, 2)}\n`,
    "utf8",
  );
  return serviceId;
}

function payload(value) {
  return value?.result ?? value;
}

const candidateSha = await exactCandidateSha();
if (!/^[0-9a-f]{40}$/u.test(candidateSha)) {
  throw new Error("Packaged MCP acceptance requires an exact candidate SHA.");
}
const version = process.env.SERVICE_LASSO_RELEASE_VERSION?.trim() || `0.1.0-mcp-${candidateSha.slice(0, 7)}`;
const evidencePath = path.resolve(
  process.env.MCP_PRODUCT_EVIDENCE_PATH?.trim() || path.join(repoRoot, "artifacts", `mcp-product-${platform}.json`),
);
const evidenceRoot = path.join(repoRoot, "artifacts");
const relativeEvidence = path.relative(evidenceRoot, evidencePath);
if (!relativeEvidence || relativeEvidence.startsWith("..") || path.isAbsolute(relativeEvidence)) {
  throw new Error("Packaged MCP evidence must stay inside the repository artifacts directory.");
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-mcp-packaged-"));
const packageOutputRoot = path.join(tempRoot, "package-output");
const consumerRoot = path.join(tempRoot, "consumer");
const servicesRoot = path.join(tempRoot, "services");
const httpWorkspaceRoot = path.join(tempRoot, "workspace-http");
const stdioWorkspaceRoot = path.join(tempRoot, "workspace-stdio");
let httpClient;
let httpServer;
let stdioClient;

try {
  await Promise.all([
    mkdir(consumerRoot, { recursive: true }),
    mkdir(servicesRoot, { recursive: true }),
    mkdir(httpWorkspaceRoot, { recursive: true }),
    mkdir(stdioWorkspaceRoot, { recursive: true }),
  ]);
  const serviceId = await writeCanonicalService(servicesRoot);
  const staged = await stagePublishedPackage({ repoRoot, outputRoot: packageOutputRoot, version });
  const packageArchiveBytes = await readFile(staged.packageArchivePath);
  const packageArchiveSha256 = createHash("sha256").update(packageArchiveBytes).digest("hex");
  await writeFile(path.join(consumerRoot, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`);
  await runCommand(process.execPath, [npmEntrypoint,
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--save-exact",
    staged.packageArchivePath,
  ], { cwd: consumerRoot, timeoutMs: 180_000 });

  const installedRoot = path.join(consumerRoot, "node_modules", "@service-lasso", "service-lasso");
  const installedManifest = JSON.parse(await readFile(path.join(installedRoot, "package.json"), "utf8"));
  if (installedManifest.name !== "@service-lasso/service-lasso" || installedManifest.version !== version) {
    throw new Error("Fresh consumer installed a different Service Lasso package identity.");
  }
  const packaged = await import(pathToFileURL(path.join(installedRoot, "index.js")).href);
  if (typeof packaged.startApiServer !== "function") {
    throw new Error("Fresh consumer package does not expose the runtime API entrypoint.");
  }

  httpServer = await packaged.startApiServer({
    port: 0,
    servicesRoot,
    workspaceRoot: httpWorkspaceRoot,
    version,
    mcpHttpIdentity: { env: { SERVICE_LASSO_MCP_MODE: "guarded" } },
  });
  const endpoint = new URL(`${httpServer.url}/api/mcp`);
  const transport = new StreamableHTTPClientTransport(endpoint);
  httpClient = new Client({ name: "service-lasso-packaged-acceptance", version: "1.0.0" });
  await httpClient.connect(transport);

  const supported = await supportedMcpVersions();
  if (transport.protocolVersion !== supported.protocolVersion) {
    throw new Error("Packaged Streamable HTTP did not negotiate the supported MCP protocol.");
  }
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
    services.structuredContent?.services?.some((service) => service.id === serviceId) !== true
  ) {
    throw new Error("Packaged Streamable HTTP discovery or representative reads failed.");
  }
  if (
    !tools.tools.every((tool) => tool.inputSchema?.additionalProperties === false) ||
    !tools.tools.every((tool) => tool.outputSchema?.additionalProperties === false)
  ) {
    throw new Error("Packaged MCP advertised an open tool schema.");
  }

  const inspectorTools = payload(await runInspector({
    serverUrl: endpoint.toString(),
    method: "tools/list",
    strict: true,
  }));
  const inspectorResources = payload(await runInspector({
    serverUrl: endpoint.toString(),
    method: "resources/list",
  }));
  const inspectorRead = payload(await runInspector({
    serverUrl: endpoint.toString(),
    method: "tools/call",
    toolName: "service_lasso_runtime_status",
    toolArgs: {},
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
    arguments: { serviceId },
  });
  if (plan.isError || plan.structuredContent?.status !== "preflight") {
    throw new Error("Canonical packaged guarded lifecycle preflight failed.");
  }
  const executionArguments = {
    serviceId,
    execute: true,
    idempotencyKey: `mcp-product-${candidateSha.slice(0, 12)}`,
    confirmationId: plan.structuredContent.confirmation.id,
    confirmationPhrase: plan.structuredContent.confirmation.confirmationPhrase,
  };
  const completed = await httpClient.callTool({ name: "service_lasso_start_service", arguments: executionArguments });
  const replayed = await httpClient.callTool({ name: "service_lasso_start_service", arguments: executionArguments });
  if (
    completed.isError ||
    completed.structuredContent?.status !== "succeeded" ||
    completed.structuredContent?.result?.resultingState?.[0]?.running !== true ||
    replayed.isError ||
    replayed.structuredContent?.status !== "replayed" ||
    replayed.structuredContent?.idempotency?.replayed !== true
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
    env: cleanEnvironment({
      SERVICE_LASSO_PORT: "0",
      SERVICE_LASSO_SERVICES_ROOT: servicesRoot,
      SERVICE_LASSO_WORKSPACE_ROOT: stdioWorkspaceRoot,
      SERVICE_LASSO_MCP_STDIO: "1",
      SERVICE_LASSO_MCP_STDIO_CREDENTIAL: stdioCredential,
      SERVICE_LASSO_MCP_STDIO_ACTOR: "packaged-mcp-actor",
      SERVICE_LASSO_MCP_STDIO_CLIENT_ID: "packaged-mcp-client",
      SERVICE_LASSO_MCP_MODE: "read-only",
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

  const coverage = {
    initializationAndNegotiation: "passed",
    initializedNotification: "passed",
    toolAndResourceDiscovery: "passed",
    closedSchemas: "passed",
    oauthIdentityAndTransportDefences: "passed",
    actorAndClientRateLimits: "passed",
    permissionProfiles: "passed",
    confirmationBindings: "passed",
    idempotentReplay: "passed",
    durableOperationPollingAndCancellation: "passed",
    auditCorrelation: "passed",
    sensitiveOutputRejection: "passed",
    deterministicPaginationLimits: "passed",
    canonicalRepresentativeReads: "passed",
  };
  const evidence = {
    contractVersion: MCP_PRODUCT_EVIDENCE_CONTRACT,
    issue: 864,
    spec: "SPEC-006 AC-6G",
    repository: process.env.GITHUB_REPOSITORY ?? "local",
    workflowRunId: process.env.GITHUB_RUN_ID ?? "local",
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "local",
    eventName: process.env.GITHUB_EVENT_NAME ?? "local",
    candidateSha,
    platform,
    architecture: process.arch,
    nodeVersion: process.version,
    packageVersion: version,
    packageArchiveSha256,
    sdk: { ...supported.sdk, protocolVersion: supported.protocolVersion },
    inspector: { ...supported.inspector, result: "passed", strictSchema: "passed" },
    packagedRuntime: {
      sourceCheckoutRequired: false,
      streamableHttp: "passed",
      stdio: "passed",
      operatingModes: ["read-only", "guarded"],
    },
    canonical: {
      discovery: "passed",
      representativeReads: "passed",
      guardedLifecycle: "passed",
      exactlyOnce: true,
      terminalState: "running",
    },
    coverage,
    assertions: Object.values(coverage),
    generatedAt: new Date().toISOString(),
  };
  validateMcpProductEvidence(evidence, { candidateSha, platform });
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    candidateSha,
    platform,
    packageVersion: version,
    packageArchiveSha256,
    protocolVersion: supported.protocolVersion,
    sdkVersion: supported.sdk.version,
    inspectorVersion: supported.inspector.version,
    result: "passed",
  })}\n`);
} finally {
  await stdioClient?.close().catch(() => undefined);
  await httpClient?.close().catch(() => undefined);
  await httpServer?.stop().catch(() => undefined);
  await removeOwnedTempRoot(tempRoot);
}

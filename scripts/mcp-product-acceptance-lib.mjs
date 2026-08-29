import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

async function readPackageManifest(packageName) {
  let directory = path.dirname(fileURLToPath(import.meta.resolve(`${packageName}/package.json`)));
  for (let depth = 0; depth < 6; depth += 1) {
    const packagePath = path.join(directory, "package.json");
    const manifest = await readFile(packagePath, "utf8")
      .then((value) => JSON.parse(value))
      .catch(() => null);
    if (manifest?.name === packageName && typeof manifest.version === "string") return manifest;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Could not resolve the owning manifest for ${packageName}.`);
}

export async function supportedMcpVersions() {
  const [sdk, inspector] = await Promise.all([
    readPackageManifest("@modelcontextprotocol/sdk"),
    readPackageManifest("@modelcontextprotocol/inspector"),
  ]);
  return {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
    sdk: { packageName: "@modelcontextprotocol/sdk", version: sdk.version },
    inspector: { packageName: "@modelcontextprotocol/inspector", version: inspector.version },
  };
}

export async function runCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`Command did not complete within ${timeoutMs}ms.`));
    }, timeoutMs);
    timer.unref?.();

    const append = (chunks, chunk, kind) => {
      const next = kind === "stdout" ? stdoutBytes + chunk.length : stderrBytes + chunk.length;
      if (next > MAX_CAPTURE_BYTES) {
        child.kill("SIGKILL");
        finish(new Error(`Command ${kind} exceeded the bounded capture limit.`));
        return;
      }
      chunks.push(chunk);
      if (kind === "stdout") stdoutBytes = next;
      else stderrBytes = next;
    };
    child.stdout.on("data", (chunk) => append(stdout, chunk, "stdout"));
    child.stderr.on("data", (chunk) => append(stderr, chunk, "stderr"));
    child.once("error", finish);
    child.once("exit", (code, signal) => {
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code === 0) finish(null, result);
      else finish(new Error(`Command failed with exit code ${code ?? "none"} and signal ${signal ?? "none"}.`), result);
    });

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        if (result) Object.assign(error, result);
        reject(error);
      } else {
        resolve(result);
      }
    }
  });
}

async function inspectorEntrypoint() {
  const manifestUrl = import.meta.resolve("@modelcontextprotocol/inspector/package.json");
  const manifestPath = fileURLToPath(manifestUrl);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const relativeBin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.["mcp-inspector"];
  if (!relativeBin) throw new Error("The pinned MCP Inspector package does not advertise its CLI entrypoint.");
  return path.resolve(path.dirname(manifestPath), relativeBin);
}

export async function runInspector({
  serverUrl,
  method,
  toolName,
  toolArgs,
  strict = false,
  timeoutMs = 60_000,
  env,
}) {
  const nodeArgs = [
    await inspectorEntrypoint(),
    "--cli",
    "--transport",
    "http",
    "--server-url",
    serverUrl,
    "--method",
    method,
    "--format",
    "json",
    "--connect-timeout",
    "15000",
  ];
  if (toolName) nodeArgs.push("--tool-name", toolName);
  if (toolArgs !== undefined) nodeArgs.push("--tool-args-json", JSON.stringify(toolArgs));
  if (strict) nodeArgs.push("--strict");
  const result = await runCommand(process.execPath, nodeArgs, { timeoutMs, env });
  const serialized = result.stdout.trim();
  if (!serialized) throw new Error("MCP Inspector returned no JSON output.");
  try {
    return JSON.parse(serialized);
  } catch {
    throw new Error("MCP Inspector output was not one bounded JSON result.");
  }
}

export const MCP_PRODUCT_EVIDENCE_CONTRACT = "service-lasso.mcp-product-acceptance.v1";

export const MCP_PACKAGED_COVERAGE_KEYS = Object.freeze([
  "initializationAndNegotiation",
  "initializedNotification",
  "toolAndResourceDiscovery",
  "closedSchemas",
  "officialInspector",
  "canonicalRepresentativeReads",
  "guardedConfirmation",
  "idempotentReplay",
  "sensitiveOutputRejection",
  "stdioTransport",
  "freshConsumerIsolation",
]);

const MCP_PRODUCT_EVIDENCE_KEYS = Object.freeze([
  "contractVersion",
  "issue",
  "spec",
  "repository",
  "workflowRunId",
  "workflowRunAttempt",
  "eventName",
  "candidateSha",
  "platform",
  "architecture",
  "nodeVersion",
  "packageVersion",
  "packageArchiveSha256",
  "sdk",
  "inspector",
  "packagedRuntime",
  "canonical",
  "coverage",
  "assertions",
  "generatedAt",
]);

function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isSafeIdentity(value, pattern, maximumLength = 200) {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength && pattern.test(value);
}

export function validateMcpProductEvidence(evidence, options = {}) {
  const expectedSha = options.candidateSha?.toLowerCase();
  const expectedPlatform = options.platform;
  const coverageIsClosed = hasExactKeys(evidence?.coverage, MCP_PACKAGED_COVERAGE_KEYS)
    && MCP_PACKAGED_COVERAGE_KEYS.every((key) => evidence.coverage[key] === "passed");
  const assertionsAreClosed = Array.isArray(evidence?.assertions)
    && evidence.assertions.length === MCP_PACKAGED_COVERAGE_KEYS.length
    && evidence.assertions.every((entry, index) => entry === MCP_PACKAGED_COVERAGE_KEYS[index]);
  const generatedAt = typeof evidence?.generatedAt === "string" ? new Date(evidence.generatedAt) : null;
  if (
    !evidence ||
    !hasExactKeys(evidence, MCP_PRODUCT_EVIDENCE_KEYS) ||
    evidence.contractVersion !== MCP_PRODUCT_EVIDENCE_CONTRACT ||
    evidence.issue !== 864 ||
    evidence.spec !== "SPEC-006 AC-6G" ||
    !isSafeIdentity(evidence.repository, /^(?:local|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/u) ||
    !isSafeIdentity(String(evidence.workflowRunId), /^(?:local|[0-9]+)$/u, 40) ||
    !isSafeIdentity(String(evidence.workflowRunAttempt), /^(?:local|[0-9]+)$/u, 20) ||
    !isSafeIdentity(evidence.eventName, /^[A-Za-z0-9_.-]+$/u, 80) ||
    !/^[0-9a-f]{40}$/u.test(evidence.candidateSha) ||
    (expectedSha && String(evidence.candidateSha).toLowerCase() !== expectedSha) ||
    !["win32", "linux", "darwin"].includes(evidence.platform) ||
    (expectedPlatform && evidence.platform !== expectedPlatform) ||
    !isSafeIdentity(evidence.architecture, /^[A-Za-z0-9_.-]+$/u, 40) ||
    !/^v[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9_.-]+)?$/u.test(evidence.nodeVersion) ||
    !isSafeIdentity(evidence.packageVersion, /^[0-9A-Za-z][0-9A-Za-z._-]{0,99}$/u, 100) ||
    !/^[0-9a-f]{64}$/u.test(evidence.packageArchiveSha256) ||
    !hasExactKeys(evidence.sdk, ["packageName", "version", "protocolVersion", "supportedProtocolVersions"]) ||
    evidence.sdk.packageName !== "@modelcontextprotocol/sdk" ||
    evidence.sdk.version !== "1.30.0" ||
    evidence.sdk.protocolVersion !== "2025-11-25" ||
    JSON.stringify(evidence.sdk.supportedProtocolVersions) !== JSON.stringify([
      "2025-11-25",
      "2025-06-18",
      "2025-03-26",
      "2024-11-05",
      "2024-10-07",
    ]) ||
    !hasExactKeys(evidence.inspector, ["packageName", "version", "result", "strictSchema"]) ||
    evidence.inspector.packageName !== "@modelcontextprotocol/inspector" ||
    evidence.inspector.version !== "2.4.0" ||
    evidence.inspector.result !== "passed" ||
    evidence.inspector.strictSchema !== "passed" ||
    !hasExactKeys(evidence.packagedRuntime, [
      "sourceCheckoutRequired",
      "sourceCheckoutAccess",
      "moduleResolution",
      "workingDirectory",
      "streamableHttp",
      "stdio",
      "operatingModes",
    ]) ||
    evidence.packagedRuntime?.sourceCheckoutRequired !== false ||
    evidence.packagedRuntime?.sourceCheckoutAccess !== "denied-by-node-permission-model" ||
    evidence.packagedRuntime?.moduleResolution !== "fresh-consumer-node-modules" ||
    evidence.packagedRuntime?.workingDirectory !== "fresh-consumer" ||
    evidence.packagedRuntime?.streamableHttp !== "passed" ||
    evidence.packagedRuntime?.stdio !== "passed" ||
    JSON.stringify(evidence.packagedRuntime?.operatingModes) !== JSON.stringify(["read-only", "guarded"]) ||
    !hasExactKeys(evidence.canonical, [
      "discovery",
      "representativeReads",
      "guardedLifecycle",
      "exactlyOnce",
      "terminalState",
    ]) ||
    evidence.canonical?.discovery !== "passed" ||
    evidence.canonical?.representativeReads !== "passed" ||
    evidence.canonical?.guardedLifecycle !== "passed" ||
    evidence.canonical?.exactlyOnce !== true ||
    evidence.canonical?.terminalState !== "running" ||
    !coverageIsClosed ||
    !assertionsAreClosed ||
    !(generatedAt instanceof Date) ||
    Number.isNaN(generatedAt.getTime()) ||
    generatedAt.toISOString() !== evidence.generatedAt
  ) {
    throw new Error("MCP product evidence did not satisfy the closed acceptance contract.");
  }
  const serialized = JSON.stringify(evidence);
  if (
    /(?:bearer\s+|authorization|cookie|password|secret\s*[:=]|token\s*[:=]|private[_-]?key|[A-Za-z]:[\\/]|file:\/\/|\/(?:home|Users|tmp|var|opt)\/)/iu.test(serialized)
  ) {
    throw new Error("MCP product evidence contains forbidden sensitive or path-like material.");
  }
  return evidence;
}

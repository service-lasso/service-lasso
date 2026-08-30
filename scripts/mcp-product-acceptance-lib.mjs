import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const SAFE_DIAGNOSTIC_CODE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
const PACKAGED_ACCEPTANCE_ERROR_PREFIX = "[mcp-package-acceptance-error] ";
const DEFAULT_DIAGNOSTIC_TIMEOUT_MS = 5_000;
const DEFAULT_DIAGNOSTIC_MAX_BYTES = 32 * 1024;
const GUARDED_DIAGNOSTIC_STATUSES = new Set(["preflight", "succeeded", "failed", "skipped", "replayed", "unclassified_error"]);
const GUARDED_DIAGNOSTIC_TRACE_STATUSES = new Set(["running", "succeeded", "failed", "blocked", "unclassified_error"]);
const GUARDED_DIAGNOSTIC_TRACE_PHASES = new Set([
  "dependency_resolution",
  "port_selection",
  "artifact_acquisition",
  "env_merge",
  "process_spawn",
  "health_check",
  "terminal_outcome",
  "unclassified_error",
]);
const GUARDED_DIAGNOSTIC_READINESS = new Set([
  "not_applicable",
  "owned_listener",
  "wrong_process_listener",
  "wrong_generation_listener",
  "listener_disappeared",
  "listener_owner_unverifiable",
  "ownership_evidence_mismatch",
  "unclassified_error",
]);
const GUARDED_DIAGNOSTIC_PROCESS_START_PHASES = new Set([
  "prelaunch_verification",
  "launch_state_creation",
  "wrapper_spawn",
  "ownership_enrollment",
  "ownership_recording",
  "initial_tree_inspection",
  "launch_file_binding",
  "binding_revalidation",
  "target_acknowledgement",
  "post_release_hook",
  "stabilization_delay",
  "stabilized_tree_inspection",
  "launch_state_cleanup",
  "launcher_initialization",
  "launcher_native_asset_validation",
  "launcher_payload_validation",
  "launcher_gate_observation",
  "launcher_file_open",
  "launcher_file_hash",
  "launcher_file_final_path",
  "launcher_binding_publication",
  "unclassified_error",
]);
export const MCP_PACKAGED_SAFE_AUDIT_DIAGNOSTIC_REASONS = Object.freeze([
  "audit_event_not_found",
  "audit_probe_failed",
  "audit_reason_unclassified",
  "confirmation_private_state_acl_failed",
  "confirmation_private_state_commit_failed",
  "confirmation_private_state_protect_failed",
  "confirmation_private_state_protect_timeout",
  "confirmation_private_state_protect_unavailable",
  "confirmation_private_state_sid_failed",
  "confirmation_private_state_system_utilities_unavailable",
  "confirmation_private_state_unprotect_failed",
  "confirmation_private_state_unprotect_timeout",
  "confirmation_private_state_unprotect_unavailable",
  "confirmation_state_unavailable",
  "invalid_request",
  "mcp_audit_unavailable",
  "preflight_failed",
]);
const SAFE_AUDIT_DIAGNOSTIC_REASONS = new Set(MCP_PACKAGED_SAFE_AUDIT_DIAGNOSTIC_REASONS);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isSafeDiagnosticCode(value) {
  return typeof value === "string" && SAFE_DIAGNOSTIC_CODE.test(value);
}

export async function fetchBoundedDiagnosticJson(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DIAGNOSTIC_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_DIAGNOSTIC_MAX_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error("Diagnostic response was unavailable.");
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await response.body.cancel().catch(() => undefined);
      throw new Error("Diagnostic response exceeded the bounded size.");
    }
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new Error("Diagnostic response exceeded the bounded size.");
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(chunks, totalBytes).toString("utf8"));
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

export function parsePackagedAcceptanceFailure(stderr) {
  if (typeof stderr !== "string") return null;
  const diagnosticLines = stderr
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(PACKAGED_ACCEPTANCE_ERROR_PREFIX));
  if (diagnosticLines.length !== 1) return null;
  let parsed;
  try {
    parsed = JSON.parse(diagnosticLines[0].slice(PACKAGED_ACCEPTANCE_ERROR_PREFIX.length));
  } catch {
    return null;
  }
  if (
    !isRecord(parsed) ||
    !hasOnlyKeys(parsed, new Set(["stage", "errorCode", "result", "componentProbe", "auditProbe", "guardedProbe"])) ||
    !isSafeDiagnosticCode(parsed.stage) ||
    !isSafeDiagnosticCode(parsed.errorCode)
  ) {
    return null;
  }
  const diagnostic = { stage: parsed.stage, errorCode: parsed.errorCode };
  if (parsed.result !== undefined) {
    if (
      !isRecord(parsed.result) ||
      !hasOnlyKeys(parsed.result, new Set(["isError", "status", "errorCode"])) ||
      typeof parsed.result.isError !== "boolean" ||
      !(parsed.result.status === null || GUARDED_DIAGNOSTIC_STATUSES.has(parsed.result.status)) ||
      !(parsed.result.errorCode === null || isSafeDiagnosticCode(parsed.result.errorCode))
    ) return null;
    diagnostic.result = {
      isError: parsed.result.isError,
      status: parsed.result.status,
      errorCode: parsed.result.errorCode,
    };
  }
  if (parsed.componentProbe !== undefined) {
    if (
      !isRecord(parsed.componentProbe) ||
      !hasOnlyKeys(parsed.componentProbe, new Set(["stage", "errorCode"])) ||
      !isSafeDiagnosticCode(parsed.componentProbe.stage) ||
      !(parsed.componentProbe.errorCode === null || isSafeDiagnosticCode(parsed.componentProbe.errorCode))
    ) return null;
    diagnostic.componentProbe = {
      stage: parsed.componentProbe.stage,
      errorCode: parsed.componentProbe.errorCode,
    };
  }
  if (parsed.auditProbe !== undefined) {
    if (
      !isRecord(parsed.auditProbe) ||
      !hasOnlyKeys(parsed.auditProbe, new Set(["stage", "reason"])) ||
      parsed.auditProbe.stage !== "audit_probe" ||
      !SAFE_AUDIT_DIAGNOSTIC_REASONS.has(parsed.auditProbe.reason)
    ) return null;
    diagnostic.auditProbe = {
      stage: "audit_probe",
      reason: parsed.auditProbe.reason,
    };
  }
  if (parsed.guardedProbe !== undefined) {
    const isGuardedResult = (value) =>
      isRecord(value) &&
      hasOnlyKeys(value, new Set(["isError", "status", "errorCode", "replayed", "running"])) &&
      typeof value.isError === "boolean" &&
      (value.status === null || GUARDED_DIAGNOSTIC_STATUSES.has(value.status)) &&
      (value.errorCode === null || isSafeDiagnosticCode(value.errorCode)) &&
      (value.replayed === null || typeof value.replayed === "boolean") &&
      (value.running === null || typeof value.running === "boolean");
    if (
      !isRecord(parsed.guardedProbe) ||
      !hasOnlyKeys(parsed.guardedProbe, new Set(["completed", "replayed", "sameCorrelation", "lifecycle"])) ||
      !isGuardedResult(parsed.guardedProbe.completed) ||
      !isGuardedResult(parsed.guardedProbe.replayed) ||
      !(parsed.guardedProbe.sameCorrelation === null || typeof parsed.guardedProbe.sameCorrelation === "boolean") ||
      !isRecord(parsed.guardedProbe.lifecycle) ||
      !hasOnlyKeys(parsed.guardedProbe.lifecycle, new Set([
        "attemptStatus",
        "phase",
        "exitClass",
        "readinessAttribution",
        "healthcheckFailed",
        "processStartFailurePhase",
      ])) ||
      !(parsed.guardedProbe.lifecycle.attemptStatus === null || GUARDED_DIAGNOSTIC_TRACE_STATUSES.has(parsed.guardedProbe.lifecycle.attemptStatus)) ||
      !(parsed.guardedProbe.lifecycle.phase === null || GUARDED_DIAGNOSTIC_TRACE_PHASES.has(parsed.guardedProbe.lifecycle.phase)) ||
      !(parsed.guardedProbe.lifecycle.exitClass === null || ["none", "zero", "nonzero", "unclassified_error"].includes(parsed.guardedProbe.lifecycle.exitClass)) ||
      !(parsed.guardedProbe.lifecycle.readinessAttribution === null || GUARDED_DIAGNOSTIC_READINESS.has(parsed.guardedProbe.lifecycle.readinessAttribution)) ||
      !(parsed.guardedProbe.lifecycle.healthcheckFailed === null || typeof parsed.guardedProbe.lifecycle.healthcheckFailed === "boolean") ||
      !(parsed.guardedProbe.lifecycle.processStartFailurePhase === null ||
        GUARDED_DIAGNOSTIC_PROCESS_START_PHASES.has(parsed.guardedProbe.lifecycle.processStartFailurePhase))
    ) return null;
    diagnostic.guardedProbe = {
      completed: { ...parsed.guardedProbe.completed },
      replayed: { ...parsed.guardedProbe.replayed },
      sameCorrelation: parsed.guardedProbe.sameCorrelation,
      lifecycle: { ...parsed.guardedProbe.lifecycle },
    };
  }
  return diagnostic;
}

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
      "identityInspectionPolicy",
    ]) ||
    evidence.packagedRuntime?.sourceCheckoutRequired !== false ||
    evidence.packagedRuntime?.sourceCheckoutAccess !== "denied-by-node-permission-model" ||
    evidence.packagedRuntime?.moduleResolution !== "fresh-consumer-node-modules" ||
    evidence.packagedRuntime?.workingDirectory !== "fresh-consumer" ||
    evidence.packagedRuntime?.streamableHttp !== "passed" ||
    evidence.packagedRuntime?.stdio !== "passed" ||
    JSON.stringify(evidence.packagedRuntime?.operatingModes) !== JSON.stringify(["read-only", "guarded"]) ||
    evidence.packagedRuntime?.identityInspectionPolicy !== (evidence.platform === "win32"
      ? "native-win32-product-default"
      : "product-default") ||
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

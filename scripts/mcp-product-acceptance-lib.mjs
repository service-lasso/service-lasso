import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

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
}) {
  const args = [
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
  if (toolName) args.push("--tool-name", toolName);
  if (toolArgs !== undefined) args.push("--tool-args-json", JSON.stringify(toolArgs));
  if (strict) args.push("--strict");
  const result = await runCommand(process.execPath, args, { timeoutMs });
  const serialized = result.stdout.trim();
  if (!serialized) throw new Error("MCP Inspector returned no JSON output.");
  try {
    return JSON.parse(serialized);
  } catch {
    throw new Error("MCP Inspector output was not one bounded JSON result.");
  }
}

export const MCP_PRODUCT_EVIDENCE_CONTRACT = "service-lasso.mcp-product-acceptance.v1";

export function validateMcpProductEvidence(evidence, options = {}) {
  const expectedSha = options.candidateSha?.toLowerCase();
  const expectedPlatform = options.platform;
  if (
    !evidence ||
    evidence.contractVersion !== MCP_PRODUCT_EVIDENCE_CONTRACT ||
    evidence.issue !== 864 ||
    evidence.spec !== "SPEC-006 AC-6G" ||
    (expectedSha && String(evidence.candidateSha).toLowerCase() !== expectedSha) ||
    (expectedPlatform && evidence.platform !== expectedPlatform) ||
    evidence.packagedRuntime?.sourceCheckoutRequired !== false ||
    evidence.packagedRuntime?.streamableHttp !== "passed" ||
    evidence.packagedRuntime?.stdio !== "passed" ||
    evidence.inspector?.result !== "passed" ||
    evidence.canonical?.guardedLifecycle !== "passed" ||
    evidence.canonical?.exactlyOnce !== true ||
    !Array.isArray(evidence.assertions) ||
    evidence.assertions.some((entry) => entry !== "passed")
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

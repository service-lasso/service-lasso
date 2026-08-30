import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stagePublishedPackage } from "./publish-package-lib.mjs";
import {
  MCP_PRODUCT_EVIDENCE_CONTRACT,
  parsePackagedAcceptanceFailure,
  runCommand,
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

async function runWindowsProvenanceVerifier(scriptName, label) {
  if (process.platform !== "win32") {
    return;
  }
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) {
    throw new Error("Packaged MCP acceptance requires an absolute Windows system root.");
  }
  const powershellExecutable = path.win32.join(
    path.win32.normalize(systemRoot),
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const verification = await runCommand(
    powershellExecutable,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      path.join(repoRoot, "scripts", scriptName),
    ],
    { cwd: repoRoot, timeoutMs: 60_000 },
  );
  process.stderr.write(`[mcp-package-provenance:${label}] ${verification.stdout.trim()}\n`);
}

async function verifyWindowsProcessInspectorProvenance() {
  await runWindowsProvenanceVerifier("verify-windows-process-inspector.ps1", "process-inspector");
}

async function verifyWindowsDpapiHelperProvenance() {
  await runWindowsProvenanceVerifier("verify-windows-dpapi-helper.ps1", "dpapi-helper");
}

function isolatedConsumerEnvironment(overrides) {
  const allowedNames = ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "ComSpec", "TEMP", "TMP", "TMPDIR"];
  const environment = Object.fromEntries(
    allowedNames
      .filter((name) => typeof process.env[name] === "string")
      .map((name) => [name, process.env[name]]),
  );
  const platformEnvironment = process.platform === "win32" && process.env.SystemRoot
    ? { PSModulePath: path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "Modules") }
    : {};
  return { ...environment, ...platformEnvironment, ...overrides };
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
  const windowsSystemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (process.platform === "win32" && (!windowsSystemRoot || !path.win32.isAbsolute(windowsSystemRoot))) {
    throw new Error("Windows packaged MCP acceptance requires an absolute system root.");
  }
  const executable = process.platform === "win32"
    ? path.win32.join(path.win32.normalize(windowsSystemRoot), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : process.execPath;
  const args = process.platform === "win32"
    ? [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Threading.Thread]::Sleep([Threading.Timeout]::Infinite)",
      ]
    : ["runtime/canonical-service.mjs"];
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
      executable,
      args,
      healthcheck: { type: "process" },
    }, null, 2)}\n`,
    "utf8",
  );
  return serviceId;
}

await verifyWindowsProcessInspectorProvenance();
await verifyWindowsDpapiHelperProvenance();
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

// Canonicalize before deriving any consumer path. On macOS, /var is a symlink
// to /private/var; mixing those identities makes Node's permission model deny
// main-module realpath traversal even when the raw temporary path is allowed.
const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "service-lasso-mcp-packaged-")));
const packageOutputRoot = path.join(tempRoot, "package-output");
const consumerRoot = path.join(tempRoot, "consumer");
const servicesRoot = path.join(tempRoot, "services");
const httpWorkspaceRoot = path.join(tempRoot, "workspace-http");
const stdioWorkspaceRoot = path.join(tempRoot, "workspace-stdio");
let verificationFailure = null;

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
    "@modelcontextprotocol/inspector@2.4.0",
  ], { cwd: consumerRoot, timeoutMs: 300_000 });
  const installedRoot = path.join(consumerRoot, "node_modules", "@service-lasso", "service-lasso");
  const installedManifest = JSON.parse(await readFile(path.join(installedRoot, "package.json"), "utf8"));
  if (installedManifest.name !== "@service-lasso/service-lasso" || installedManifest.version !== version) {
    throw new Error("Fresh consumer installed a different Service Lasso package identity.");
  }
  const [installedDpapiHelper, installedDpapiProvenance, reviewedDpapiHelper, reviewedDpapiProvenance] = await Promise.all([
    readFile(path.join(installedRoot, "dist", "runtime", "security", "windows-dpapi-helper.exe")),
    readFile(path.join(installedRoot, "dist", "runtime", "security", "windows-dpapi-helper.provenance.json")),
    readFile(path.join(repoRoot, "src", "runtime", "security", "windows-dpapi-helper.exe")),
    readFile(path.join(repoRoot, "src", "runtime", "security", "windows-dpapi-helper.provenance.json")),
  ]);
  try {
    if (!installedDpapiHelper.equals(reviewedDpapiHelper) || !installedDpapiProvenance.equals(reviewedDpapiProvenance)) {
      throw new Error("Fresh consumer installed unbound Windows DPAPI helper assets.");
    }
  } finally {
    installedDpapiHelper.fill(0);
    installedDpapiProvenance.fill(0);
    reviewedDpapiHelper.fill(0);
    reviewedDpapiProvenance.fill(0);
  }
  const consumerRunnerPath = path.join(consumerRoot, "mcp-packaged-consumer-runner.mjs");
  const consumerLibraryPath = path.join(consumerRoot, "mcp-product-acceptance-lib.mjs");
  await Promise.all([
    copyFile(path.join(repoRoot, "scripts", "mcp-packaged-consumer-runner.mjs"), consumerRunnerPath),
    copyFile(path.join(repoRoot, "scripts", "mcp-product-acceptance-lib.mjs"), consumerLibraryPath),
  ]);
  const platformReadRoots = process.platform === "win32"
    ? [path.dirname(process.execPath), process.env.SystemRoot, process.env.WINDIR]
    : process.platform === "darwin"
      ? [path.dirname(process.execPath), "/System", "/usr", "/Library", "/private/etc"]
      : [path.dirname(process.execPath), "/proc", "/etc", "/usr", "/lib", "/lib64"];
  const permissionOptions = [
    "--permission",
    `--allow-fs-read=${tempRoot}`,
    ...[...new Set(platformReadRoots.filter(Boolean))].map((root) => `--allow-fs-read=${root}`),
    `--allow-fs-write=${tempRoot}`,
    "--allow-child-process",
  ];
  let runnerResult;
  try {
    runnerResult = await runCommand(process.execPath, [...permissionOptions, consumerRunnerPath], {
      cwd: consumerRoot,
      timeoutMs: 900_000,
      env: isolatedConsumerEnvironment({
        NODE_OPTIONS: permissionOptions.join(" "),
        MCP_PACKAGE_ACCEPTANCE_CONFIGURATION: JSON.stringify({
          candidateSha,
          version,
          consumerRoot,
          serviceId,
          servicesRoot,
          httpWorkspaceRoot,
          stdioWorkspaceRoot,
          instanceRegistryPath: path.join(tempRoot, "host", "runtime-instances.json"),
          portRegistryPath: path.join(tempRoot, "host", "endpoint-allocations.json"),
        }),
        MCP_PACKAGE_ACCEPTANCE_FORBIDDEN_SOURCE_ROOT: repoRoot,
      }),
    });
  } catch (error) {
    const runner = parsePackagedAcceptanceFailure(error?.stderr);
    const safe = new Error("Fresh-consumer MCP acceptance failed safely.");
    safe.packagedAcceptanceDiagnostic = {
      stage: "consumer_runner",
      errorCode: runner ? "runner_reported_failure" : "runner_failed",
      ...(runner ? { runner } : {}),
    };
    throw safe;
  }
  let acceptance;
  try {
    acceptance = JSON.parse(runnerResult.stdout.trim());
  } catch {
    throw new Error("Fresh-consumer MCP acceptance runner did not return one bounded JSON result.");
  }
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
    sdk: acceptance.sdk,
    inspector: acceptance.inspector,
    packagedRuntime: acceptance.packagedRuntime,
    canonical: acceptance.canonical,
    coverage: acceptance.coverage,
    assertions: acceptance.assertions,
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
    protocolVersion: acceptance.sdk.protocolVersion,
    sdkVersion: acceptance.sdk.version,
    inspectorVersion: acceptance.inspector.version,
    result: "passed",
  })}\n`);
} catch (error) {
  verificationFailure = error?.packagedAcceptanceDiagnostic ?? {
    stage: "packaged_verification",
    errorCode: "verification_failed",
  };
} finally {
  try {
    await removeOwnedTempRoot(tempRoot);
  } catch {
    verificationFailure = {
      stage: "temp_cleanup",
      errorCode: "cleanup_failed",
      ...(verificationFailure
        ? {
            verificationStage: verificationFailure.stage,
            verificationErrorCode: verificationFailure.errorCode,
          }
        : {}),
    };
  }
}

if (verificationFailure) {
  process.stderr.write(`[mcp-package-verification-error] ${JSON.stringify(verificationFailure)}\n`);
  process.exitCode = 1;
}

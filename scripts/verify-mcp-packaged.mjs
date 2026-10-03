import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stagePublishedPackage } from "./publish-package-lib.mjs";
import { takeBootstrappedReleaseMetadataToken, operatorToolFailureDiagnostic } from "./operator-tool-packaging-lib.mjs";
import {
  MCP_PRODUCT_EVIDENCE_CONTRACT,
  parsePackagedAcceptanceFailure,
  runCommand,
  owningResourceObservations,
  relayOwningResourceObservations,
  ownedCommandStderr,
  runCommandFailureKind,
  validateMcpProductEvidence,
} from "./mcp-product-acceptance-lib.mjs";

import { dependencyAcquisitionReceipt, packagedVerificationDiagnostic } from "./packaged-verification-diagnostics.mjs";
import { ownedTempCleanupObservation, removeOwnedTempRoot } from "./owned-temp-cleanup.mjs";

const allocateResource = owningResourceObservations("verifier");
const candidateObservation = allocateResource("candidate_command");
const provenanceObservations = Array.from({ length: 4 }, () => allocateResource("provenance_command"));
const packObservation = allocateResource("pack_command");
const stageLockObservation = allocateResource("stage_lock");
const installObservation = allocateResource("install_command");
const consumerObservation = allocateResource("consumer_command");
let provenanceOrdinal = 0;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const platform = process.platform;
const releaseMetadataToken = takeBootstrappedReleaseMetadataToken();
const configuredNpmEntrypoint = process.env.SERVICE_LASSO_NPM_ENTRYPOINT?.trim() || process.env.npm_execpath?.trim();
const npmEntrypoint = configuredNpmEntrypoint || (process.platform === "win32"
  ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  : path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"));
try { await stat(npmEntrypoint); } catch { throw new Error("Packaged MCP acceptance could not resolve the governed npm entrypoint."); }

async function exactCandidateSha() {
  const configured = process.env.CANDIDATE_SHA?.trim().toLowerCase();
  if (configured) return configured;
  return (await runCommand("git", ["rev-parse", "HEAD"], { cwd: repoRoot, resourceObservation: candidateObservation })).stdout.trim().toLowerCase();
}

async function requirePathAbsent(candidatePath, label) {
  try {
    await lstat(candidatePath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} must be absent.`);
}

function ownPackagedAcceptanceDiagnostic(error) {
  if (!error || typeof error !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "packagedAcceptanceDiagnostic");
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

async function runWindowsProvenanceVerifier(scriptName, label, scriptArgs = []) {
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
      ...scriptArgs,
    ],
    { cwd: repoRoot, timeoutMs: 60_000, resourceObservation: provenanceObservations[provenanceOrdinal++] },
  );
  process.stderr.write(`[mcp-package-provenance:${label}] ${verification.stdout.trim()}\n`);
}

async function verifyWindowsProcessInspectorProvenance() {
  await runWindowsProvenanceVerifier("verify-windows-process-inspector.ps1", "process-inspector");
}

async function verifyWindowsManagedLauncherNativeProvenance() {
  await runWindowsProvenanceVerifier(
    "verify-windows-process-inspector.ps1",
    "managed-launcher-native",
    ["-ManagedLauncherNative"],
  );
}

async function verifyWindowsDpapiHelperProvenance() {
  await runWindowsProvenanceVerifier("verify-windows-dpapi-helper.ps1", "dpapi-helper");
}

async function verifyWindowsDirectorySyncHelperProvenance() {
  await runWindowsProvenanceVerifier("verify-windows-process-inspector.ps1", "directory-sync-helper", ["-DirectorySyncHelper"]);
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
await verifyWindowsManagedLauncherNativeProvenance();
await verifyWindowsDpapiHelperProvenance();
await verifyWindowsDirectorySyncHelperProvenance();
await Promise.all([
  requirePathAbsent(
    path.join(repoRoot, "src", "runtime", "execution", "windows-managed-launcher.ps1"),
    "Retired source PowerShell launcher",
  ),
  requirePathAbsent(
    path.join(repoRoot, "dist", "runtime", "execution", "windows-managed-launcher.ps1"),
    "Retired staged PowerShell launcher",
  ),
]);
const candidateSha = await exactCandidateSha();
if (!/^[0-9a-f]{40}$/u.test(candidateSha)) {
  throw new Error("Packaged MCP acceptance requires an exact candidate SHA.");
}
const version = process.env.SERVICE_LASSO_RELEASE_VERSION?.trim() || `0.1.0-mcp-${candidateSha.slice(0, 7)}`;
const pinnedSdkVersion = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")).dependencies?.["@modelcontextprotocol/sdk"];
if (typeof pinnedSdkVersion !== "string" || !/^\d+\.\d+\.\d+/.test(pinnedSdkVersion)) {
  throw new Error("Packaged MCP acceptance requires an exact pinned MCP SDK version.");
}
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
let verificationStage = "consumer_setup";

try {
  await Promise.all([
    mkdir(consumerRoot, { recursive: true }),
    mkdir(servicesRoot, { recursive: true }),
    mkdir(httpWorkspaceRoot, { recursive: true }),
    mkdir(stdioWorkspaceRoot, { recursive: true }),
  ]);
  const serviceId = await writeCanonicalService(servicesRoot);
  verificationStage = "package_staging";
  const staged = await stagePublishedPackage({ repoRoot, outputRoot: packageOutputRoot, version, releaseMetadataToken, resourceObservation: packObservation, stageLockObservation });
  const packageArchiveBytes = await readFile(staged.packageArchivePath);
  const packageArchiveSha256 = createHash("sha256").update(packageArchiveBytes).digest("hex");
  await writeFile(path.join(consumerRoot, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`);
  verificationStage = "dependency_acquisition";
  await runCommand(process.execPath, [npmEntrypoint,
    "install",
    "--json",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--save-exact",
    staged.packageArchivePath,
    "@modelcontextprotocol/inspector@2.4.0",
    `@modelcontextprotocol/sdk@${pinnedSdkVersion}`,
  ], { cwd: consumerRoot, timeoutMs: 300_000, resourceObservation: installObservation });
  verificationStage = "installed_package_binding";
  const installedRoot = path.join(consumerRoot, "node_modules", "@service-lasso", "service-lasso");
  const installedManifest = JSON.parse(await readFile(path.join(installedRoot, "package.json"), "utf8"));
  if (installedManifest.name !== "@service-lasso/service-lasso" || installedManifest.version !== version) {
    throw new Error("Fresh consumer installed a different Service Lasso package identity.");
  }
  await requirePathAbsent(
    path.join(installedRoot, "dist", "runtime", "execution", "windows-managed-launcher.ps1"),
    "Retired installed PowerShell launcher",
  );
  const [
    installedDpapiHelper,
    installedDpapiProvenance,
    reviewedDpapiHelper,
    reviewedDpapiProvenance,
    installedManagedLauncherNative,
    installedManagedLauncherNativeProvenance,
    reviewedManagedLauncherNative,
    reviewedManagedLauncherNativeProvenance,
    installedManagedLauncher,
    installedManagedLauncherProvenance,
    reviewedManagedLauncher,
    reviewedManagedLauncherProvenance,
    installedDirectorySyncHelper,
    installedDirectorySyncHelperProvenance,
    reviewedDirectorySyncHelper,
    reviewedDirectorySyncHelperProvenance,
  ] = await Promise.all([
    readFile(path.join(installedRoot, "dist", "runtime", "security", "windows-dpapi-helper.exe")),
    readFile(path.join(installedRoot, "dist", "runtime", "security", "windows-dpapi-helper.provenance.json")),
    readFile(path.join(repoRoot, "src", "runtime", "security", "windows-dpapi-helper.exe")),
    readFile(path.join(repoRoot, "src", "runtime", "security", "windows-dpapi-helper.provenance.json")),
    readFile(path.join(installedRoot, "dist", "runtime", "execution", "windows-managed-launcher-native.exe")),
    readFile(path.join(installedRoot, "dist", "runtime", "execution", "windows-managed-launcher-native.provenance.json")),
    readFile(path.join(repoRoot, "src", "runtime", "execution", "windows-managed-launcher-native.exe")),
    readFile(path.join(repoRoot, "src", "runtime", "execution", "windows-managed-launcher-native.provenance.json")),
    readFile(path.join(installedRoot, "dist", "runtime", "execution", "windows-managed-launcher-managed.exe")),
    readFile(path.join(installedRoot, "dist", "runtime", "execution", "windows-managed-launcher-managed.provenance.json")),
    readFile(path.join(repoRoot, "src", "runtime", "execution", "windows-managed-launcher-managed.exe")),
    readFile(path.join(repoRoot, "src", "runtime", "execution", "windows-managed-launcher-managed.provenance.json")),
    readFile(path.join(installedRoot, "dist", "runtime", "operator", "windows-directory-sync-helper.exe")),
    readFile(path.join(installedRoot, "dist", "runtime", "operator", "windows-directory-sync-helper.provenance.json")),
    readFile(path.join(repoRoot, "src", "runtime", "operator", "windows-directory-sync-helper.exe")),
    readFile(path.join(repoRoot, "src", "runtime", "operator", "windows-directory-sync-helper.provenance.json")),
  ]);
  try {
    if (
      !installedDpapiHelper.equals(reviewedDpapiHelper) ||
      !installedDpapiProvenance.equals(reviewedDpapiProvenance) ||
      !installedManagedLauncherNative.equals(reviewedManagedLauncherNative) ||
      !installedManagedLauncherNativeProvenance.equals(reviewedManagedLauncherNativeProvenance) ||
      !installedManagedLauncher.equals(reviewedManagedLauncher) ||
      !installedManagedLauncherProvenance.equals(reviewedManagedLauncherProvenance) ||
      !installedDirectorySyncHelper.equals(reviewedDirectorySyncHelper) ||
      !installedDirectorySyncHelperProvenance.equals(reviewedDirectorySyncHelperProvenance)
    ) {
      throw new Error("Fresh consumer installed unbound Windows native helper assets.");
    }
  } finally {
    installedDpapiHelper.fill(0);
    installedDpapiProvenance.fill(0);
    reviewedDpapiHelper.fill(0);
    reviewedDpapiProvenance.fill(0);
    installedManagedLauncherNative.fill(0);
    installedManagedLauncherNativeProvenance.fill(0);
    reviewedManagedLauncherNative.fill(0);
    reviewedManagedLauncherNativeProvenance.fill(0);
    installedManagedLauncher.fill(0);
    installedManagedLauncherProvenance.fill(0);
    reviewedManagedLauncher.fill(0);
    reviewedManagedLauncherProvenance.fill(0);
    installedDirectorySyncHelper.fill(0);
    installedDirectorySyncHelperProvenance.fill(0);
    reviewedDirectorySyncHelper.fill(0);
    reviewedDirectorySyncHelperProvenance.fill(0);
  }
  verificationStage = "consumer_setup";
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
    verificationStage = "consumer_runner";
    runnerResult = await runCommand(process.execPath, [...permissionOptions, consumerRunnerPath], {
      cwd: consumerRoot,
      timeoutMs: 900_000,
      resourceObservation: consumerObservation,
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
    relayOwningResourceObservations(runnerResult.stderr);
    if (runnerResult.closeObserved !== true) {
      throw new Error("Fresh-consumer MCP acceptance runner did not reach a closed subprocess boundary.");
    }
  } catch (error) {
    const stderr = ownedCommandStderr(error);
    relayOwningResourceObservations(stderr);
    const runner = parsePackagedAcceptanceFailure(stderr);
    const safe = new Error("Fresh-consumer MCP acceptance failed safely.");
    safe.packagedAcceptanceDiagnostic = {
      stage: "consumer_runner",
      errorCode: runner ? "runner_reported_failure" : "runner_failed",
      ...(runner ? { runner } : {}),
    };
    throw safe;
  }
  verificationStage = "consumer_result";
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
  verificationStage = "evidence_validation";
  validateMcpProductEvidence(evidence, { candidateSha, platform });
  verificationStage = "evidence_write";
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
  verificationFailure = ownPackagedAcceptanceDiagnostic(error) ?? packagedVerificationDiagnostic(
    verificationStage,
    operatorToolFailureDiagnostic(error),
    verificationStage === "dependency_acquisition" ? dependencyAcquisitionReceipt(error, runCommandFailureKind(error)) : undefined,
  );
} finally {
  try {
    await removeOwnedTempRoot(tempRoot);
  } catch (error) {
    const cleanup = ownedTempCleanupObservation(error);
    verificationFailure = {
      stage: "temp_cleanup",
      errorCode: "cleanup_failed",
      ...(cleanup ? { cleanup } : {}),
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

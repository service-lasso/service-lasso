import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extractPublishedPackageArchive } from "./published-package-archive.mjs";
import {
  ADMIN_HARNESS_REVISION,
  ADMIN_RELEASE,
  BROKER_RELEASE,
  CORE_HARNESS_FILES,
  PACKAGE_NAME,
  QUALIFICATION_SCHEMA,
  RETENTION_DAYS,
  coreReleaseAssets,
  digestFile,
  fail,
  parseChecksumManifest,
  parseCoreInstallOutput,
  readJsonFile,
  releaseServiceAssets,
  requireAssetDigest,
  requirePattern,
  requirePositiveInteger,
  requireRegularFile,
  requireSha,
  requireSha256,
  safeFailureCode,
  validateNpmMetadata,
  validateRelease,
  verifyFileSha256,
  verifyNpmTarballIntegrity,
} from "./published-package-qualification-lib.mjs";
import {
  QUALIFICATION_FAILURE_CODES,
  QUALIFICATION_PHASES,
  classifyQualificationFailure,
  classifyReadinessSample,
  inspectOwnedChild,
  preserveFirstFailure,
} from "./published-package-qualification-reliability.mjs";

const CORE_REPO = "service-lasso/service-lasso";
const PLATFORM_VALUES = new Set(["win32", "linux", "darwin"]);

function requiredEnv(name, pattern = /^.+$/u) {
  return requirePattern(process.env[name], pattern, name);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithRetries(url, options, label) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, redirect: "follow" });
      if (!response.ok) {
        throw new Error(`${label} returned HTTP ${response.status}.`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await delay(250 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function githubHeaders(token, accept = "application/vnd.github+json") {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "service-lasso-published-package-qualification",
  };
}

async function fetchJson(url, options, label) {
  const response = await fetchWithRetries(url, options, label);
  try {
    return await response.json();
  } catch {
    fail("invalid_remote_json", `${label} did not return JSON.`);
  }
}

async function download(url, target, options, label, expectedSize = null) {
  await rm(target, { force: true });
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, redirect: "follow" });
      if (!response.ok || !response.body) {
        throw new Error(`${label} returned HTTP ${response.status}.`);
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(target, { flags: "wx" }));
      const info = await stat(target);
      if (info.size <= 0 || (expectedSize !== null && info.size !== expectedSize)) {
        throw new Error(`${label} download size did not match release metadata.`);
      }
      return info.size;
    } catch (error) {
      lastError = error;
      await rm(target, { force: true });
      if (attempt < 4) await delay(250 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

async function downloadReleaseAsset(asset, target, token, label) {
  return download(
    asset.url,
    target,
    { headers: githubHeaders(token, "application/octet-stream") },
    label,
    asset.size,
  );
}

function quoteWindows(value) {
  if (/^[A-Za-z0-9_./:=@\\-]+$/u.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}.`));
    });
  });
}

function runNpm(args, options = {}) {
  if (process.platform !== "win32") return runCommand("npm", args, options);
  const commandLine = ["npm.cmd", ...args].map(quoteWindows).join(" ");
  return runCommand(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", commandLine], options);
}

/**
 * Retry npm install once, only before lifecycle mutation. Preserve the first failure.
 *
 * @param {string} npmTarball
 * @param {string} consumerRoot
 * @param {object} state
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function runNpmInstallWithRetry(npmTarball, consumerRoot, state) {
  const args = ["install", npmTarball, "--ignore-scripts", "--no-audit", "--no-fund"];
  const options = { cwd: consumerRoot };
  try {
    return await runNpm(args, options);
  } catch (error) {
    const classified = classifyQualificationFailure({
      phase: QUALIFICATION_PHASES.NPM_ACQUISITION,
      error: { code: QUALIFICATION_FAILURE_CODES.npm_acquisition },
      mutationCount: 0,
    });
    state.firstFailure = preserveFirstFailure(state.firstFailure, classified);
    state.failurePhase = classified.phase;
    state.failureCode = classified.failureCode;
    if (!classified.retryAllowed || state.acquisitionRetry === true) {
      fail(classified.failureCode, "npm package acquisition failed.");
    }
    state.acquisitionRetry = true;
    try {
      return await runNpm(args, options);
    } catch {
      fail(classified.failureCode, "npm package acquisition failed after the allowed pre-mutation retry.");
    }
  }
}

async function readRelease(repo, releaseId, token) {
  return fetchJson(
    `https://api.github.com/repos/${repo}/releases/${releaseId}`,
    { headers: githubHeaders(token) },
    `${repo} release`,
  );
}

async function assertMutationRootAbsent(mutationRoot) {
  const exists = await lstat(mutationRoot).then(() => true).catch((error) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  });
  if (exists) fail("premature_mutation", "Qualification mutation root exists before every payload is verified.");
}

async function expectGuard(code, operation, mutationRoot) {
  try {
    await operation();
  } catch (error) {
    if (safeFailureCode(error) !== code) throw error;
    await assertMutationRootAbsent(mutationRoot);
    return "success";
  }
  fail("negative_guard_failed", `Negative guard ${code} unexpectedly accepted invalid evidence.`);
}

async function runNegativeGuards({ downloadRoot, mutationRoot, coreAsset, expectedCoreSha256, checksumEntries }) {
  const emptyPath = path.join(downloadRoot, "negative-empty.bin");
  await writeFile(emptyPath, "");
  const expectedNames = [...checksumEntries.keys()];
  const validLines = [...checksumEntries].map(([name, digest]) => `${digest}  ${name}`).join("\n");
  const fakeRelease = {
    id: 1,
    name: "negative",
    tag_name: "negative",
    target_commitish: "0".repeat(40),
    draft: false,
    prerelease: false,
    assets: [],
  };
  const redirectedRelease = {
    ...fakeRelease,
    assets: [{
      id: 9,
      name: "redirected.bin",
      size: 1,
      state: "uploaded",
      digest: `sha256:${"0".repeat(64)}`,
      url: `https://api.github.com/repos/${CORE_REPO}/releases/assets/9`,
      browser_download_url: "https://example.invalid/redirected.bin",
    }],
  };
  const canonicalNegativeRelease = {
    ...redirectedRelease,
    assets: [{
      ...redirectedRelease.assets[0],
      browser_download_url: `https://github.com/${CORE_REPO}/releases/download/negative/redirected.bin`,
    }],
  };

  const outcomes = {
    missingProvenance: await expectGuard(
      "release_asset_inventory_mismatch",
      () => validateRelease(fakeRelease, {
        repo: CORE_REPO,
        id: "1",
        tag: "negative",
        revision: "0".repeat(40),
      }, ["missing.bin"]),
      mutationRoot,
    ),
    missingChecksum: await expectGuard(
      "missing_checksum_entry",
      () => parseChecksumManifest(
        [...checksumEntries].slice(0, -1).map(([name, digest]) => `${digest}  ${name}`).join("\n"),
        expectedNames,
      ),
      mutationRoot,
    ),
    emptyPayload: await expectGuard(
      "empty_download",
      () => verifyFileSha256(emptyPath, expectedCoreSha256, "negative empty payload"),
      mutationRoot,
    ),
    emptyChecksum: await expectGuard(
      "empty_checksum_manifest",
      () => parseChecksumManifest("", expectedNames),
      mutationRoot,
    ),
    malformedChecksum: await expectGuard(
      "malformed_checksum_manifest",
      () => parseChecksumManifest("not-a-checksum", expectedNames),
      mutationRoot,
    ),
    duplicateChecksum: await expectGuard(
      "duplicate_checksum_entry",
      () => parseChecksumManifest(`${validLines}\n${[...checksumEntries][0][1]}  ${expectedNames[0]}\n`, expectedNames),
      mutationRoot,
    ),
    unexpectedChecksum: await expectGuard(
      "unexpected_checksum_entry",
      () => parseChecksumManifest(`${validLines}\n${"0".repeat(64)}  unexpected.bin\n`, expectedNames),
      mutationRoot,
    ),
    mismatchedPayload: await expectGuard(
      "download_digest_mismatch",
      () => verifyFileSha256(coreAsset, "0".repeat(64), "negative mismatched payload"),
      mutationRoot,
    ),
    redirectedChecksum: await expectGuard(
      "redirected_checksum_entry",
      () => parseChecksumManifest(`${[...checksumEntries][0][1]}  ../${expectedNames[0]}\n`, expectedNames),
      mutationRoot,
    ),
    redirectedProvenance: await expectGuard(
      "redirected_asset_metadata",
      () => validateRelease(redirectedRelease, {
        repo: CORE_REPO,
        id: "1",
        tag: "negative",
        revision: "0".repeat(40),
      }, ["redirected.bin"]),
      mutationRoot,
    ),
    wrongHeadProvenance: await expectGuard(
      "release_revision_mismatch",
      () => validateRelease(canonicalNegativeRelease, {
        repo: CORE_REPO,
        id: "1",
        tag: "negative",
        revision: "1".repeat(40),
      }, ["redirected.bin"]),
      mutationRoot,
    ),
  };
  await rm(emptyPath, { force: true });
  return outcomes;
}

function assertChecksumRelease(entries, release) {
  const expected = new Map([
    ...Object.values(release.platforms).map(({ asset, sha256 }) => [asset, sha256]),
    ["service.json", release.manifestSha256],
  ]);
  for (const [name, digest] of expected) {
    if (entries.get(name) !== digest) {
      fail("checksum_release_mismatch", `${release.repo} checksum entry ${name} is not canonical.`);
    }
  }
}

function pinReleasedManifest(manifest, release) {
  if (manifest?.id !== (release === ADMIN_RELEASE ? "@serviceadmin" : "@secretsbroker")) {
    fail("released_manifest_identity_mismatch", `${release.repo} service manifest identity is invalid.`);
  }
  const source = manifest?.artifact?.source;
  if (source?.type !== "github-release" || source?.repo !== release.repo) {
    fail("released_manifest_source_mismatch", `${release.repo} service manifest source is invalid.`);
  }
  for (const [platform, expected] of Object.entries(release.platforms)) {
    const observed = manifest.artifact?.platforms?.[platform];
    if (
      observed?.assetName !== expected.asset ||
      observed?.checksum?.algorithm !== "sha256" ||
      observed?.checksum?.assetName !== "SHA256SUMS.txt"
    ) {
      fail("released_manifest_platform_mismatch", `${release.repo} ${platform} manifest policy is invalid.`);
    }
  }
  return {
    ...manifest,
    artifact: {
      ...manifest.artifact,
      source: {
        type: "github-release",
        repo: release.repo,
        tag: release.tag,
      },
    },
  };
}

async function findSingleFile(root, fileName) {
  const matches = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail("unsafe_extracted_entry", "Published archive contains a symbolic link.");
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile() && entry.name === fileName) matches.push(candidate);
    }
  }
  await visit(root);
  if (matches.length !== 1) fail("published_binary_inventory_mismatch", `Expected exactly one ${fileName}.`);
  return matches[0];
}

async function invokeCoreInstall(coreRoot, serviceId, servicesRoot, workspaceRoot, token) {
  const result = await runCommand(
    process.execPath,
    [
      path.join(coreRoot, "dist", "cli.js"),
      "install",
      serviceId,
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ],
    { cwd: coreRoot, env: { ...process.env, GITHUB_TOKEN: token } },
  );
  return parseCoreInstallOutput(result.stdout, serviceId);
}

async function assertCoreAcquisition(payload, release, platform) {
  const expected = release.platforms[platform];
  const artifact = payload?.state?.installArtifacts?.artifact;
  if (
    payload?.ok !== true ||
    payload?.action !== "install" ||
    artifact?.tag !== release.tag ||
    artifact?.assetName !== expected.asset ||
    artifact?.checksum?.algorithm !== "sha256" ||
    artifact?.checksum?.source !== "release-asset" ||
    artifact?.checksum?.checksumAssetName !== "SHA256SUMS.txt" ||
    artifact?.checksum?.expected?.toLowerCase() !== expected.sha256 ||
    artifact?.checksum?.actual?.toLowerCase() !== expected.sha256
  ) {
    fail("core_acquisition_contract_invalid", `Published Core acquisition did not bind ${release.repo}.`);
  }
  await requireRegularFile(artifact.archivePath, `${release.repo} retained archive`);
  const extracted = await lstat(artifact.extractedPath).catch(() => null);
  if (!extracted?.isDirectory() || extracted.isSymbolicLink()) {
    fail("core_acquisition_contract_invalid", `${release.repo} extraction root is invalid.`);
  }
  return artifact;
}

async function reservePort() {
  const { createServer } = await import("node:net");
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHealth(port, expectedVersion, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastHttpStatus = 0;
  let expectedBodyMatched = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      lastHttpStatus = response.status;
      if (response.ok) {
        const body = await response.json();
        expectedBodyMatched = body?.api?.version === expectedVersion;
        if (!expectedBodyMatched) {
          fail("published_runtime_version_mismatch", "Published runtime health version is not exact.");
        }
        const ownedProcess = inspectOwnedChild(child);
        const readiness = classifyReadinessSample({
          phase: QUALIFICATION_PHASES.CORE_STARTUP,
          httpStatus: response.status,
          expectedBodyMatched: true,
          sampledRunning: ownedProcess.status === "running" && ownedProcess.classification === "owned",
          ownedProcess,
          mutationCount: 0,
        });
        if (readiness.ready) return readiness;
        fail(readiness.failureCode, "Published runtime health succeeded without owned process evidence.");
      }
    } catch (error) {
      if (error?.code === "published_runtime_version_mismatch") throw error;
      if (error?.name === "QualificationError") throw error;
    }
    await delay(100);
  }
  const ownedProcess = inspectOwnedChild(child);
  const readiness = classifyReadinessSample({
    phase: QUALIFICATION_PHASES.CORE_STARTUP,
    httpStatus: lastHttpStatus,
    expectedBodyMatched,
    sampledRunning: false,
    ownedProcess,
    mutationCount: 0,
  });
  fail(
    readiness.failureCode === QUALIFICATION_FAILURE_CODES.readiness_sampling_lag
      ? QUALIFICATION_FAILURE_CODES.core_startup
      : readiness.failureCode === QUALIFICATION_FAILURE_CODES.product_start_failed
        ? QUALIFICATION_FAILURE_CODES.product_start_failed
        : "published_runtime_not_ready",
    "Published runtime did not become ready.",
  );
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("close", () => resolve(true))),
    delay(10_000).then(() => false),
  ]);
  if (!exited) {
    child.kill("SIGKILL");
    fail("published_runtime_cleanup_failed", "Published runtime did not stop within the bounded cleanup window.");
  }
}

async function runReleaseRuntimeSmoke(coreRoot, servicesRoot, workspaceRoot, version) {
  const port = await reservePort();
  const child = spawn(process.execPath, [path.join(coreRoot, "dist", "index.js")], {
    cwd: coreRoot,
    env: {
      ...process.env,
      SERVICE_LASSO_PORT: String(port),
      SERVICE_LASSO_SERVICES_ROOT: servicesRoot,
      SERVICE_LASSO_WORKSPACE_ROOT: workspaceRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  try {
    await waitForHealth(port, version, child);
  } catch (error) {
    if (typeof child.exitCode === "number") {
      fail(QUALIFICATION_FAILURE_CODES.core_startup, "Published runtime exited before readiness.");
    }
    throw error;
  } finally {
    await stopChild(child);
  }
  if (/token|secret|credential/iu.test(stdout + stderr)) {
    fail("published_runtime_log_leak", "Published runtime smoke emitted prohibited material markers.");
  }
}

async function runNpmConsumerSmoke({ npmTarball, consumerRoot, version, state }) {
  await mkdir(consumerRoot, { recursive: true });
  await writeFile(
    path.join(consumerRoot, "package.json"),
    `${JSON.stringify({ name: "service-lasso-published-consumer", private: true, type: "module" }, null, 2)}\n`,
  );
  await runNpmInstallWithRetry(npmTarball, consumerRoot, state);
  const packageRoot = path.join(consumerRoot, "node_modules", "@service-lasso", "service-lasso");
  const packageJson = await readJsonFile(path.join(packageRoot, "package.json"), "installed npm package.json");
  const publishManifest = await readJsonFile(
    path.join(packageRoot, "publish-artifact.json"),
    "installed npm publish manifest",
  );
  if (
    packageJson.name !== PACKAGE_NAME ||
    packageJson.version !== version ||
    publishManifest.version !== version ||
    publishManifest.artifactKind !== "bounded-npm-publish-payload"
  ) {
    fail("installed_npm_identity_mismatch", "Installed npm package identity is invalid.");
  }
  const cli = path.join(packageRoot, "cli.js");
  const cliVersion = await runCommand(process.execPath, [cli, "--version"], { cwd: consumerRoot });
  const cliHelp = await runCommand(process.execPath, [cli, "help"], { cwd: consumerRoot });
  if (cliVersion.stdout.trim() !== version || !cliHelp.stdout.includes("service-lasso")) {
    fail("installed_npm_cli_mismatch", "Installed npm CLI identity is invalid.");
  }

  const servicesRoot = path.join(consumerRoot, "services");
  const workspaceRoot = path.join(consumerRoot, "workspace");
  await mkdir(servicesRoot, { recursive: true });
  const probePath = path.join(consumerRoot, "runtime-probe.mjs");
  await writeFile(
    probePath,
    [
      `import { startApiServer } from ${JSON.stringify(new URL(`file:///${path.join(packageRoot, "index.js").replaceAll("\\", "/")}`).href)};`,
      `const api = await startApiServer({ servicesRoot: ${JSON.stringify(servicesRoot)}, workspaceRoot: ${JSON.stringify(workspaceRoot)}, port: 0, host: "127.0.0.1" });`,
      "try {",
      "  const response = await fetch(`${api.url}/api/health`);",
      "  const health = await response.json();",
      `  if (health?.api?.version !== ${JSON.stringify(version)}) throw new Error("npm runtime version mismatch");`,
      "} finally {",
      "  await api.stop();",
      "}",
      "",
    ].join("\n"),
  );
  await runCommand(process.execPath, [probePath], { cwd: consumerRoot });
}

async function appendGithubEnv(values) {
  const githubEnv = requiredEnv("GITHUB_ENV");
  for (const [name, value] of Object.entries(values)) {
    const normalized = String(value);
    if (!/^[A-Z0-9_]+$/u.test(name) || /[\r\n]/u.test(normalized)) {
      fail("unsafe_environment_output", "Qualification environment output is invalid.");
    }
    await writeFile(githubEnv, `${name}=${normalized}\n`, { flag: "a" });
  }
}

const platform = requiredEnv("QUALIFICATION_PLATFORM", /^(?:win32|linux|darwin)$/u);
if (!PLATFORM_VALUES.has(platform)) fail("invalid_platform", "Qualification platform is unsupported.");
const token = requiredEnv("GITHUB_TOKEN");
const workspace = path.resolve(requiredEnv("GITHUB_WORKSPACE"));
const runnerTemp = path.resolve(requiredEnv("RUNNER_TEMP"));
const coreReleaseId = String(requirePositiveInteger(requiredEnv("CORE_RELEASE_ID", /^[1-9][0-9]*$/u), "CORE_RELEASE_ID"));
const coreTag = requiredEnv("CORE_RELEASE_TAG", /^20[0-9]{2}\.[1-9][0-9]*\.[1-9][0-9]*-[0-9a-f]{7}$/u);
const coreRevision = requireSha(requiredEnv("CORE_REVISION"), "CORE_REVISION");
const coreNpmVersion = requiredEnv("CORE_NPM_VERSION", /^20[0-9]{2}\.[1-9][0-9]*\.[1-9][0-9]*-[0-9a-f]{7}$/u);
const coreAsset = requiredEnv("CORE_RELEASE_ASSET", /^service-lasso-20[0-9]{2}\.[1-9][0-9]*\.[1-9][0-9]*-[0-9a-f]{7}-(?:win32\.zip|linux\.tar\.gz|darwin\.tar\.gz)$/u);
const coreSha256 = requireSha256(requiredEnv("CORE_RELEASE_SHA256"), "CORE_RELEASE_SHA256");
const coreNpmIntegrity = requiredEnv("CORE_NPM_INTEGRITY", /^sha512-[A-Za-z0-9+/]+={0,2}$/u);
const adminHarnessRevision = requireSha(
  requiredEnv("ADMIN_HARNESS_REVISION"),
  "ADMIN_HARNESS_REVISION",
);
if (adminHarnessRevision !== ADMIN_HARNESS_REVISION) {
  fail("admin_harness_revision_mismatch", "Admin browser harness revision is not canonical.");
}
const safeStatePath = path.resolve(requiredEnv("QUALIFICATION_SAFE_STATE_PATH"));
const privateStatePath = path.resolve(requiredEnv("QUALIFICATION_PRIVATE_STATE_PATH"));
const runId = requiredEnv("GITHUB_RUN_ID", /^[1-9][0-9]*$/u);
const runAttempt = requiredEnv("GITHUB_RUN_ATTEMPT", /^[1-9][0-9]*$/u);
const workflowSha = requireSha(requiredEnv("GITHUB_SHA"), "GITHUB_SHA");

if (coreNpmVersion !== coreTag || !coreTag.endsWith(coreRevision.slice(0, 7))) {
  fail("core_publication_identity_mismatch", "Core release, npm version, and target revision are not one identity.");
}
const expectedCoreAsset = `service-lasso-${coreTag}-${platform === "win32" ? "win32.zip" : `${platform}.tar.gz`}`;
if (coreAsset !== expectedCoreAsset) fail("core_asset_name_mismatch", "Core release asset name is not exact.");

const suffix = `${runId}-${runAttempt}-${platform}`;
const downloadRoot = path.join(runnerTemp, `service-lasso-published-downloads-${suffix}`);
const mutationRoot = path.join(runnerTemp, `service-lasso-published-mutation-${suffix}`);
const safeState = {
  schema: QUALIFICATION_SCHEMA,
  retainedContent: "metadata_only",
  outcome: "failure",
  platform,
  core: {
    releaseId: coreReleaseId,
    tag: coreTag,
    revision: coreRevision,
    asset: coreAsset,
    sha256: coreSha256,
    npm: { name: PACKAGE_NAME, version: coreNpmVersion, integrity: coreNpmIntegrity, distTag: "latest" },
  },
  admin: {
    releaseId: ADMIN_RELEASE.id,
    tag: ADMIN_RELEASE.tag,
    revision: ADMIN_RELEASE.revision,
    asset: ADMIN_RELEASE.platforms[platform].asset,
    sha256: ADMIN_RELEASE.platforms[platform].sha256,
    checksumSource: "SHA256SUMS.txt",
  },
  broker: {
    releaseId: BROKER_RELEASE.id,
    tag: BROKER_RELEASE.tag,
    revision: BROKER_RELEASE.revision,
    asset: BROKER_RELEASE.platforms[platform].asset,
    sha256: BROKER_RELEASE.platforms[platform].sha256,
    checksumSource: "SHA256SUMS.txt",
  },
  adminHarnessRevision,
  harnessRevision: workflowSha,
  retentionDays: RETENTION_DAYS,
  mutationRetry: false,
  acquisitionRetry: false,
  startupRetry: false,
  firstFailure: null,
  failurePhase: null,
  failureCode: "preparation_incomplete",
  negativeProof: {},
  scenarios: {
    preMutationGuards: "blocked",
    releaseRuntime: "blocked",
    npmConsumer: "blocked",
    productionAcquisition: "blocked",
  },
};

await mkdir(path.dirname(safeStatePath), { recursive: true });
await writeFile(safeStatePath, `${JSON.stringify(safeState, null, 2)}\n`);
await writeFile(privateStatePath, `${JSON.stringify({ downloadRoot, mutationRoot }, null, 2)}\n`);

try {
  await assertMutationRootAbsent(mutationRoot);
  await rm(downloadRoot, { recursive: true, force: true });
  await mkdir(downloadRoot, { recursive: true });

  const [coreRelease, adminRelease, brokerRelease, npmMetadata, npmDistTags] = await Promise.all([
    readRelease(CORE_REPO, coreReleaseId, token),
    readRelease(ADMIN_RELEASE.repo, ADMIN_RELEASE.id, token),
    readRelease(BROKER_RELEASE.repo, BROKER_RELEASE.id, token),
    fetchJson(
      `https://registry.npmjs.org/%40service-lasso%2Fservice-lasso/${encodeURIComponent(coreNpmVersion)}`,
      { headers: { Accept: "application/json", "User-Agent": "service-lasso-published-package-qualification" } },
      "npm version metadata",
    ),
    fetchJson(
      "https://registry.npmjs.org/-/package/%40service-lasso%2Fservice-lasso/dist-tags",
      { headers: { Accept: "application/json", "User-Agent": "service-lasso-published-package-qualification" } },
      "npm dist-tags",
    ),
  ]);

  const coreAssets = validateRelease(
    coreRelease,
    { repo: CORE_REPO, id: coreReleaseId, tag: coreTag, revision: coreRevision },
    coreReleaseAssets(coreTag),
  );
  const adminAssets = validateRelease(adminRelease, ADMIN_RELEASE, releaseServiceAssets(ADMIN_RELEASE));
  const brokerAssets = validateRelease(brokerRelease, BROKER_RELEASE, releaseServiceAssets(BROKER_RELEASE));
  requireAssetDigest(coreAssets.get(coreAsset), coreSha256, "Core release asset");
  requireAssetDigest(
    adminAssets.get(ADMIN_RELEASE.platforms[platform].asset),
    ADMIN_RELEASE.platforms[platform].sha256,
    "Admin release asset",
  );
  requireAssetDigest(
    adminAssets.get(ADMIN_RELEASE.platforms[platform].sbom),
    ADMIN_RELEASE.platforms[platform].sbomSha256,
    "Admin release SBOM",
  );
  requireAssetDigest(
    brokerAssets.get(BROKER_RELEASE.platforms[platform].asset),
    BROKER_RELEASE.platforms[platform].sha256,
    "Broker release asset",
  );
  requireAssetDigest(
    brokerAssets.get(BROKER_RELEASE.platforms[platform].sbom),
    BROKER_RELEASE.platforms[platform].sbomSha256,
    "Broker release SBOM",
  );
  requireAssetDigest(adminAssets.get("service.json"), ADMIN_RELEASE.manifestSha256, "Admin service manifest");
  requireAssetDigest(adminAssets.get("SHA256SUMS.txt"), ADMIN_RELEASE.checksumSha256, "Admin checksum manifest");
  requireAssetDigest(brokerAssets.get("service.json"), BROKER_RELEASE.manifestSha256, "Broker service manifest");
  requireAssetDigest(brokerAssets.get("SHA256SUMS.txt"), BROKER_RELEASE.checksumSha256, "Broker checksum manifest");
  const npmTarballUrl = validateNpmMetadata(npmMetadata, npmDistTags, coreNpmVersion, coreNpmIntegrity);

  const files = {
    core: path.join(downloadRoot, coreAsset),
    npm: path.join(downloadRoot, "service-lasso-service-lasso.tgz"),
    adminArchive: path.join(downloadRoot, ADMIN_RELEASE.platforms[platform].asset),
    adminSbom: path.join(downloadRoot, ADMIN_RELEASE.platforms[platform].sbom),
    adminManifest: path.join(downloadRoot, "admin-service.json"),
    adminChecksums: path.join(downloadRoot, "admin-SHA256SUMS.txt"),
    brokerArchive: path.join(downloadRoot, BROKER_RELEASE.platforms[platform].asset),
    brokerSbom: path.join(downloadRoot, BROKER_RELEASE.platforms[platform].sbom),
    brokerManifest: path.join(downloadRoot, "broker-service.json"),
    brokerChecksums: path.join(downloadRoot, "broker-SHA256SUMS.txt"),
  };
  await Promise.all([
    downloadReleaseAsset(coreAssets.get(coreAsset), files.core, token, "Core release asset"),
    download(npmTarballUrl, files.npm, { headers: { "User-Agent": "service-lasso-published-package-qualification" } }, "npm tarball"),
    downloadReleaseAsset(adminAssets.get(ADMIN_RELEASE.platforms[platform].asset), files.adminArchive, token, "Admin release asset"),
    downloadReleaseAsset(adminAssets.get(ADMIN_RELEASE.platforms[platform].sbom), files.adminSbom, token, "Admin release SBOM"),
    downloadReleaseAsset(adminAssets.get("service.json"), files.adminManifest, token, "Admin service manifest"),
    downloadReleaseAsset(adminAssets.get("SHA256SUMS.txt"), files.adminChecksums, token, "Admin checksum manifest"),
    downloadReleaseAsset(brokerAssets.get(BROKER_RELEASE.platforms[platform].asset), files.brokerArchive, token, "Broker release asset"),
    downloadReleaseAsset(brokerAssets.get(BROKER_RELEASE.platforms[platform].sbom), files.brokerSbom, token, "Broker release SBOM"),
    downloadReleaseAsset(brokerAssets.get("service.json"), files.brokerManifest, token, "Broker service manifest"),
    downloadReleaseAsset(brokerAssets.get("SHA256SUMS.txt"), files.brokerChecksums, token, "Broker checksum manifest"),
  ]);

  await Promise.all([
    verifyFileSha256(files.core, coreSha256, "Core release asset"),
    verifyNpmTarballIntegrity(files.npm, coreNpmIntegrity),
    verifyFileSha256(files.adminArchive, ADMIN_RELEASE.platforms[platform].sha256, "Admin release asset"),
    verifyFileSha256(files.adminSbom, ADMIN_RELEASE.platforms[platform].sbomSha256, "Admin release SBOM"),
    verifyFileSha256(files.adminManifest, ADMIN_RELEASE.manifestSha256, "Admin service manifest"),
    verifyFileSha256(files.adminChecksums, ADMIN_RELEASE.checksumSha256, "Admin checksum manifest"),
    verifyFileSha256(files.brokerArchive, BROKER_RELEASE.platforms[platform].sha256, "Broker release asset"),
    verifyFileSha256(files.brokerSbom, BROKER_RELEASE.platforms[platform].sbomSha256, "Broker release SBOM"),
    verifyFileSha256(files.brokerManifest, BROKER_RELEASE.manifestSha256, "Broker service manifest"),
    verifyFileSha256(files.brokerChecksums, BROKER_RELEASE.checksumSha256, "Broker checksum manifest"),
  ]);
  const adminChecksumEntries = parseChecksumManifest(
    await readFile(files.adminChecksums, "utf8"),
    releaseServiceAssets(ADMIN_RELEASE).filter((name) => name !== "SHA256SUMS.txt"),
  );
  const brokerChecksumEntries = parseChecksumManifest(
    await readFile(files.brokerChecksums, "utf8"),
    releaseServiceAssets(BROKER_RELEASE).filter((name) => name !== "SHA256SUMS.txt"),
  );
  assertChecksumRelease(adminChecksumEntries, ADMIN_RELEASE);
  assertChecksumRelease(brokerChecksumEntries, BROKER_RELEASE);
  await verifyFileSha256(files.adminArchive, adminChecksumEntries.get(ADMIN_RELEASE.platforms[platform].asset), "Admin checksum-bound archive");
  await verifyFileSha256(files.adminSbom, adminChecksumEntries.get(ADMIN_RELEASE.platforms[platform].sbom), "Admin checksum-bound SBOM");
  await verifyFileSha256(files.brokerArchive, brokerChecksumEntries.get(BROKER_RELEASE.platforms[platform].asset), "Broker checksum-bound archive");
  await verifyFileSha256(files.brokerSbom, brokerChecksumEntries.get(BROKER_RELEASE.platforms[platform].sbom), "Broker checksum-bound SBOM");
  const adminManifest = pinReleasedManifest(await readJsonFile(files.adminManifest, "Admin service manifest"), ADMIN_RELEASE);
  const brokerManifest = pinReleasedManifest(await readJsonFile(files.brokerManifest, "Broker service manifest"), BROKER_RELEASE);

  safeState.negativeProof = await runNegativeGuards({
    downloadRoot,
    mutationRoot,
    coreAsset: files.core,
    expectedCoreSha256: coreSha256,
    checksumEntries: adminChecksumEntries,
  });
  safeState.scenarios.preMutationGuards = "success";
  await assertMutationRootAbsent(mutationRoot);

  const coreExtraction = path.join(mutationRoot, "core");
  const servicesRoot = path.join(mutationRoot, "services");
  const workspaceRoot = path.join(mutationRoot, "workspace");
  const smokeServicesRoot = path.join(mutationRoot, "smoke-services");
  const smokeWorkspaceRoot = path.join(mutationRoot, "smoke-workspace");
  const npmConsumerRoot = path.join(mutationRoot, "npm-consumer");
  await mkdir(mutationRoot, { recursive: true });
  await extractPublishedPackageArchive(files.core, coreExtraction, platform);
  const coreRoot = path.join(coreExtraction, `service-lasso-${coreTag}`);
  const releaseManifest = await readJsonFile(path.join(coreRoot, "release-artifact.json"), "Core release manifest");
  const corePackageJson = await readJsonFile(path.join(coreRoot, "package.json"), "Core release package.json");
  if (
    releaseManifest.artifactName !== `service-lasso-${coreTag}` ||
    releaseManifest.version !== coreTag ||
    releaseManifest.entrypoints?.runtime !== "dist/index.js" ||
    releaseManifest.entrypoints?.cli !== "packages/core/cli.js" ||
    corePackageJson.version !== coreTag
  ) {
    fail("extracted_core_identity_mismatch", "Extracted Core release identity is invalid.");
  }
  const runtimeEntrypoint = path.join(coreRoot, releaseManifest.entrypoints.runtime);
  const cliEntrypoint = path.join(coreRoot, releaseManifest.entrypoints.cli);
  await requireRegularFile(runtimeEntrypoint, "Core runtime entrypoint");
  await requireRegularFile(cliEntrypoint, "Core CLI entrypoint");
  const runtimeDigestBeforeHarness = await digestFile(runtimeEntrypoint);
  const cliDigestBeforeHarness = await digestFile(cliEntrypoint);

  for (const relativePath of CORE_HARNESS_FILES) {
    const source = path.join(workspace, relativePath);
    const destination = path.join(coreRoot, relativePath);
    await requireRegularFile(source, `Qualification harness ${relativePath}`);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  if (
    await digestFile(runtimeEntrypoint) !== runtimeDigestBeforeHarness ||
    await digestFile(cliEntrypoint) !== cliDigestBeforeHarness
  ) {
    fail("published_core_replaced_by_harness", "Qualification harness changed a published Core entrypoint.");
  }

  const releaseCliVersion = await runCommand(process.execPath, [cliEntrypoint, "--version"], { cwd: coreRoot });
  const releaseCliHelp = await runCommand(process.execPath, [cliEntrypoint, "help"], { cwd: coreRoot });
  if (releaseCliVersion.stdout.trim() !== coreTag || !releaseCliHelp.stdout.includes("service-lasso")) {
    fail("published_core_cli_mismatch", "Published Core CLI identity is invalid.");
  }
  await mkdir(smokeServicesRoot, { recursive: true });
  try {
    await runReleaseRuntimeSmoke(coreRoot, smokeServicesRoot, smokeWorkspaceRoot, coreTag);
  } catch (error) {
    const classified = classifyQualificationFailure({
      phase: QUALIFICATION_PHASES.CORE_STARTUP,
      error,
      mutationCount: 0,
    });
    safeState.firstFailure = preserveFirstFailure(safeState.firstFailure, classified);
    safeState.failurePhase = safeState.firstFailure.phase;
    safeState.failureCode = safeState.firstFailure.failureCode;
    if (!classified.retryAllowed || safeState.startupRetry === true) throw error;
    safeState.startupRetry = true;
    await runReleaseRuntimeSmoke(coreRoot, smokeServicesRoot, smokeWorkspaceRoot, coreTag);
  }
  safeState.scenarios.releaseRuntime = "success";

  await runNpmConsumerSmoke({
    npmTarball: files.npm,
    consumerRoot: npmConsumerRoot,
    version: coreNpmVersion,
    state: safeState,
  });
  safeState.scenarios.npmConsumer = "success";

  await mkdir(path.join(servicesRoot, "@serviceadmin"), { recursive: true });
  await mkdir(path.join(servicesRoot, "@secretsbroker"), { recursive: true });
  await writeFile(path.join(servicesRoot, "@serviceadmin", "service.json"), `${JSON.stringify(adminManifest, null, 2)}\n`);
  await writeFile(path.join(servicesRoot, "@secretsbroker", "service.json"), `${JSON.stringify(brokerManifest, null, 2)}\n`);
  const adminPayload = await invokeCoreInstall(coreRoot, "@serviceadmin", servicesRoot, workspaceRoot, token);
  const adminArtifact = await assertCoreAcquisition(adminPayload, ADMIN_RELEASE, platform);
  const brokerPayload = await invokeCoreInstall(coreRoot, "@secretsbroker", servicesRoot, workspaceRoot, token);
  const brokerArtifact = await assertCoreAcquisition(brokerPayload, BROKER_RELEASE, platform);
  const brokerBinary = await findSingleFile(brokerArtifact.extractedPath, BROKER_RELEASE.platforms[platform].binary);
  if (platform !== "win32") await chmod(brokerBinary, 0o755);
  safeState.scenarios.productionAcquisition = "success";
  safeState.failureCode = null;
  await writeFile(safeStatePath, `${JSON.stringify(safeState, null, 2)}\n`);
  await writeFile(
    privateStatePath,
    `${JSON.stringify({ downloadRoot, mutationRoot, coreRoot, adminRoot: adminArtifact.extractedPath, brokerBinary }, null, 2)}\n`,
  );
  await appendGithubEnv({
    SERVICE_LASSO_TEST_CORE_ROOT: coreRoot,
    SERVICE_LASSO_TEST_ADMIN_ROOT: adminArtifact.extractedPath,
    SERVICE_LASSO_TEST_BROKER_BINARY: brokerBinary,
    QUALIFICATION_PREPARED: "1",
  });
} catch (error) {
  const classified = classifyQualificationFailure({
    phase: safeState.failurePhase ?? QUALIFICATION_PHASES.NPM_ACQUISITION,
    error,
    mutationCount: 0,
  });
  safeState.firstFailure = preserveFirstFailure(safeState.firstFailure, classified);
  safeState.failurePhase = safeState.firstFailure.phase;
  safeState.failureCode = safeState.firstFailure.failureCode;
  await writeFile(safeStatePath, `${JSON.stringify(safeState, null, 2)}\n`).catch(() => {});
  throw error;
}

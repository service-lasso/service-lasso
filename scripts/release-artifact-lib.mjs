import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import AdmZip from "adm-zip";
import { SUPPORTED_RELEASE_PLATFORMS } from "./release-asset-policy.mjs";
import { getReleaseVersion, readRootPackageJson, RELEASE_VERSION_ENV } from "./release-version-lib.mjs";

export const RELEASE_FILES = [
  "LICENSE",
  "README.md",
  "package.json",
  "package-lock.json",
  "dist",
  "packages/core",
];

export const DEFAULT_BUNDLED_SERVICE_IDS = [
  "@java",
  "@localcert",
  "@nginx",
  "@traefik",
  "@node",
  "@secretsbroker",
  "echo-service",
  "@serviceadmin",
];

export async function ensureBuildOutput(repoRoot) {
  const distPath = path.join(repoRoot, "dist", "index.js");
  await stat(distPath);
  return distPath;
}

export function getArtifactName(version) {
  return `service-lasso-${version}`;
}

export function getBundledArtifactName(version) {
  return `service-lasso-bundled-${version}`;
}

async function copyReleasePath(repoRoot, artifactRoot, relativePath) {
  const sourcePath = path.join(repoRoot, relativePath);
  const targetPath = path.join(artifactRoot, relativePath);

  await mkdir(path.dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { recursive: true });
}

async function writeReleaseManifest({
  repoRoot,
  artifactRoot,
  artifactName,
  version,
  artifactKind = "bounded-runtime-download",
  shippedFiles = [...RELEASE_FILES, "node_modules"],
  runtimeRoots = {
    servicesRoot: "provided by the operator/consumer at runtime",
    workspaceRoot: "provided by the operator/consumer at runtime",
  },
  notes = [
    "This artifact is a bounded runtime download, not a finished npm publish payload.",
    "No service trees or workspace data are bundled into the artifact.",
    "The private core wrapper package remains a scaffold around the current built runtime.",
    "Production runtime dependencies are installed into node_modules so the staged artifact can boot directly.",
  ],
  bundledServices = [],
}) {
  const packageJson = await readRootPackageJson(repoRoot);
  await writeFile(
    path.join(artifactRoot, "package.json"),
    `${JSON.stringify({ ...packageJson, version }, null, 2)}\n`,
    "utf8",
  );

  const packageLockPath = path.join(artifactRoot, "package-lock.json");
  const packageLock = JSON.parse(await readFile(packageLockPath, "utf8"));
  packageLock.version = version;
  if (packageLock.packages?.[""]) {
    packageLock.packages[""].version = version;
  }
  await writeFile(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`, "utf8");

  const manifest = {
    artifactName,
    version,
    versionSource: process.env[RELEASE_VERSION_ENV]?.trim() ? RELEASE_VERSION_ENV : "package.json",
    node: packageJson.engines?.node ?? ">=22",
    packageBoundary: "@service-lasso/service-lasso",
    artifactKind,
    shippedFiles,
    entrypoints: {
      runtime: "dist/index.js",
      corePackage: "packages/core/index.js",
      cli: "packages/core/cli.js",
    },
    runtimeRoots,
    ...(bundledServices.length > 0 ? { bundledServices } : {}),
    notes,
  };

  await writeFile(
    path.join(artifactRoot, "release-artifact.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return manifest;
}

function relativizeBundledPath(serviceRoot, candidate) {
  if (!candidate || !path.isAbsolute(candidate)) {
    return candidate;
  }

  const relativePath = path.relative(serviceRoot, candidate);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return candidate;
  }

  return relativePath.split(path.sep).join("/");
}

async function rewriteInstallStateWithRelativeArtifactPaths(serviceRoot) {
  const installPath = path.join(serviceRoot, ".state", "install.json");
  const payload = JSON.parse(await readFile(installPath, "utf8"));
  if (!payload.artifact) {
    return;
  }

  payload.artifact.archivePath = relativizeBundledPath(serviceRoot, payload.artifact.archivePath ?? null);
  payload.artifact.extractedPath = relativizeBundledPath(serviceRoot, payload.artifact.extractedPath ?? null);
  await writeFile(installPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function acquireBundledServices({ repoRoot, artifactRoot, serviceIds = DEFAULT_BUNDLED_SERVICE_IDS }) {
  const [
    { discoverServices },
    { rehydrateDiscoveredServices },
    { DependencyGraph, createServiceRegistry },
    { installService },
    { writeServiceState },
    { resetLifecycleState },
  ] = await Promise.all([
    import(pathToFileURL(path.join(repoRoot, "dist", "runtime", "discovery", "discoverServices.js")).href),
    import(pathToFileURL(path.join(repoRoot, "dist", "runtime", "state", "rehydrate.js")).href),
    import(pathToFileURL(path.join(repoRoot, "dist", "runtime", "manager", "DependencyGraph.js")).href),
    import(pathToFileURL(path.join(repoRoot, "dist", "runtime", "lifecycle", "actions.js")).href),
    import(pathToFileURL(path.join(repoRoot, "dist", "runtime", "state", "writeState.js")).href),
    import(pathToFileURL(path.join(repoRoot, "dist", "runtime", "lifecycle", "store.js")).href),
  ]);
  const servicesRoot = path.join(artifactRoot, "services");
  const requested = new Set(serviceIds);

  resetLifecycleState();
  const discovered = await discoverServices(servicesRoot);
  await rehydrateDiscoveredServices(discovered);
  const registry = createServiceRegistry(discovered);
  const available = new Set(registry.list().map((service) => service.manifest.id));

  for (const serviceId of serviceIds) {
    if (!available.has(serviceId)) {
      throw new Error(`Bundled release requires service "${serviceId}", but it was not discovered.`);
    }
  }

  const serviceOrder = new DependencyGraph(registry)
    .getGlobalStartupOrder()
    .filter((serviceId) => requested.has(serviceId));
  const installed = [];

  for (const serviceId of serviceOrder) {
    const service = registry.getById(serviceId);
    if (!service) {
      throw new Error(`Bundled release internal error: service "${serviceId}" disappeared after ordering.`);
    }

    const result = await installService(service, registry);
    await writeServiceState(service, result.state);
    await rewriteInstallStateWithRelativeArtifactPaths(service.serviceRoot);
    installed.push({
      id: serviceId,
      version: service.manifest.version ?? null,
      artifactRepo: service.manifest.artifact?.source?.repo ?? null,
      artifactTag: result.state.installArtifacts.artifact?.tag ?? null,
      assetName: result.state.installArtifacts.artifact?.assetName ?? null,
    });
  }

  resetLifecycleState();
  return installed;
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed with exit code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    });
  });
}

function escapeWindowsCmdArg(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

export function runNpmCommand(args, options = {}) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

  if (process.platform !== "win32") {
    return runCommand(npmCommand, args, options);
  }

  const comspec = process.env.ComSpec ?? "cmd.exe";
  const commandLine = [npmCommand, ...args].map(escapeWindowsCmdArg).join(" ");

  return runCommand(comspec, ["/d", "/s", "/c", commandLine], options);
}

export async function createReleaseArchive(outputRoot, artifactName, archiveName = `${artifactName}.tar.gz`) {
  const archivePath = path.join(outputRoot, archiveName);
  await rm(archivePath, { force: true });
  await runCommand("tar", ["-czf", archivePath, "-C", outputRoot, artifactName]);
  return archivePath;
}

export async function createReleaseZipArchive(outputRoot, artifactName, archiveName = `${artifactName}.zip`) {
  const archivePath = path.join(outputRoot, archiveName);
  await rm(archivePath, { force: true });

  const archive = new AdmZip();
  archive.addLocalFolder(path.join(outputRoot, artifactName), artifactName);
  archive.writeZip(archivePath);

  return archivePath;
}

export async function createPlatformReleaseArchives(outputRoot, artifactName) {
  const archives = [];

  for (const platform of SUPPORTED_RELEASE_PLATFORMS) {
    const archiveName = platform === "win32" ? `${artifactName}-${platform}.zip` : `${artifactName}-${platform}.tar.gz`;
    const archivePath =
      platform === "win32"
        ? await createReleaseZipArchive(outputRoot, artifactName, archiveName)
        : await createReleaseArchive(outputRoot, artifactName, archiveName);

    archives.push({ platform, archiveName, archivePath });
  }

  return archives;
}

export async function stageReleaseArtifact({
  repoRoot,
  outputRoot = path.join(repoRoot, "artifacts"),
  version,
} = {}) {
  const resolvedVersion = version ?? (await getReleaseVersion(repoRoot));
  const artifactName = getArtifactName(resolvedVersion);
  const artifactRoot = path.join(outputRoot, artifactName);

  await ensureBuildOutput(repoRoot);
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  for (const relativePath of RELEASE_FILES) {
    await copyReleasePath(repoRoot, artifactRoot, relativePath);
  }

  await runNpmCommand(["install", "--omit=dev"], {
    cwd: artifactRoot,
  });

  const manifest = await writeReleaseManifest({
    repoRoot,
    artifactRoot,
    artifactName,
    version: resolvedVersion,
  });
  const archivePath = await createReleaseArchive(outputRoot, artifactName);
  const platformArchives = await createPlatformReleaseArchives(outputRoot, artifactName);

  return {
    artifactName,
    artifactRoot,
    archivePath,
    platformArchives,
    manifest,
  };
}

export async function stageBundledReleaseArtifact({
  repoRoot,
  outputRoot = path.join(repoRoot, "artifacts"),
  version,
  serviceIds = DEFAULT_BUNDLED_SERVICE_IDS,
} = {}) {
  const resolvedVersion = version ?? (await getReleaseVersion(repoRoot));
  const artifactName = getBundledArtifactName(resolvedVersion);
  const artifactRoot = path.join(outputRoot, artifactName);

  await ensureBuildOutput(repoRoot);
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  for (const relativePath of [...RELEASE_FILES, "services"]) {
    await copyReleasePath(repoRoot, artifactRoot, relativePath);
  }

  await runNpmCommand(["install", "--omit=dev"], {
    cwd: artifactRoot,
  });

  const bundledServices = await acquireBundledServices({
    repoRoot,
    artifactRoot,
    serviceIds,
  });
  const manifest = await writeReleaseManifest({
    repoRoot,
    artifactRoot,
    artifactName,
    version: resolvedVersion,
    artifactKind: "bundled-runtime",
    shippedFiles: [...RELEASE_FILES, "services", "node_modules"],
    runtimeRoots: {
      servicesRoot: "./services",
      workspaceRoot: "provided by the operator/consumer at runtime",
    },
    bundledServices,
    notes: [
      "This artifact is a runnable Service Lasso runtime with the checked-in baseline services folder included.",
      "Baseline service release archives are already acquired under each service .state folder, so startup does not need to download them again.",
      "Persisted artifact paths are stored relative to each service root and are resolved when the artifact is extracted elsewhere.",
      "Run with --services-root ./services from the extracted artifact root, and provide a workspace root for runtime state outside service manifests.",
    ],
  });
  const archivePath = await createReleaseArchive(outputRoot, artifactName);
  const platformArchives = await createPlatformReleaseArchives(outputRoot, artifactName);

  return {
    artifactName,
    artifactRoot,
    archivePath,
    platformArchives,
    manifest,
  };
}

export async function verifyStagedArtifact({
  repoRoot,
  artifactRoot,
  archivePath,
  version,
  bootPort = 18181,
} = {}) {
  const resolvedVersion = version ?? (await getReleaseVersion(repoRoot));
  const artifactName = getArtifactName(resolvedVersion);
  const stagedRoot = artifactRoot ?? path.join(repoRoot, "artifacts", artifactName);
  const stagedArchivePath = archivePath ?? path.join(repoRoot, "artifacts", `${artifactName}.tar.gz`);

  await stat(stagedArchivePath);
  await stat(path.join(stagedRoot, "release-artifact.json"));
  await stat(path.join(stagedRoot, "dist", "index.js"));
  await stat(path.join(stagedRoot, "packages", "core", "index.js"));
  await stat(path.join(stagedRoot, "packages", "core", "cli.js"));

  const coreModule = await import(pathToFileURL(path.join(stagedRoot, "packages", "core", "index.js")).href);
  if (typeof coreModule.createRuntime !== "function") {
    throw new Error("staged core wrapper does not expose createRuntime()");
  }

  const bootWorkspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-release-workspace-"));
  const bootLogNeedle = "[service-lasso] core API spine started";
  const child = spawn(process.execPath, [path.join(stagedRoot, "dist", "index.js")], {
    cwd: stagedRoot,
    env: {
      ...process.env,
      SERVICE_LASSO_PORT: String(bootPort),
      SERVICE_LASSO_SERVICES_ROOT: path.join(repoRoot, "services"),
      SERVICE_LASSO_WORKSPACE_ROOT: bootWorkspaceRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const booted = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("staged runtime did not boot within 10 seconds"));
      }, 10_000);

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
        if (stdout.includes(bootLogNeedle)) {
          clearTimeout(timeout);
          resolve({ stdout, stderr });
        }
      });

      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        reject(new Error(`staged runtime exited before boot completed with code ${code}`));
      });
    });

    const healthResponse = await fetch(`http://127.0.0.1:${bootPort}/api/health`);
    const health = await healthResponse.json();
    if (health?.api?.version !== resolvedVersion) {
      throw new Error(`staged runtime health version ${health?.api?.version} did not match ${resolvedVersion}.`);
    }

    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("close", resolve));

    return {
      artifactName,
      stagedRoot,
      stagedArchivePath,
      booted,
      health,
    };
  } finally {
    child.kill("SIGTERM");
    await rm(bootWorkspaceRoot, { recursive: true, force: true });
  }
}

export async function verifyBundledStagedArtifact({
  repoRoot,
  artifactRoot,
  archivePath,
  version,
  serviceIds = DEFAULT_BUNDLED_SERVICE_IDS,
} = {}) {
  const resolvedVersion = version ?? (await getReleaseVersion(repoRoot));
  const artifactName = getBundledArtifactName(resolvedVersion);
  const stagedRoot = artifactRoot ?? path.join(repoRoot, "artifacts", artifactName);
  const stagedArchivePath = archivePath ?? path.join(repoRoot, "artifacts", `${artifactName}.tar.gz`);

  await stat(stagedArchivePath);
  const manifest = JSON.parse(await readFile(path.join(stagedRoot, "release-artifact.json"), "utf8"));
  if (manifest.artifactKind !== "bundled-runtime") {
    throw new Error(`bundled artifact kind ${manifest.artifactKind} did not match bundled-runtime.`);
  }

  const [
    { discoverServices },
    { rehydrateDiscoveredServices },
    { getLifecycleState, resetLifecycleState },
  ] = await Promise.all([
    import(pathToFileURL(path.join(stagedRoot, "dist", "runtime", "discovery", "discoverServices.js")).href),
    import(pathToFileURL(path.join(stagedRoot, "dist", "runtime", "state", "rehydrate.js")).href),
    import(pathToFileURL(path.join(stagedRoot, "dist", "runtime", "lifecycle", "store.js")).href),
  ]);

  resetLifecycleState();
  const servicesRoot = path.join(stagedRoot, "services");
  const discovered = await discoverServices(servicesRoot);
  await rehydrateDiscoveredServices(discovered);

  for (const serviceId of serviceIds) {
    const service = discovered.find((candidate) => candidate.manifest.id === serviceId);
    if (!service) {
      throw new Error(`bundled service "${serviceId}" was not discovered.`);
    }

    const state = getLifecycleState(serviceId);
    if (!state.installed || !state.installArtifacts.artifact?.archivePath || !state.installArtifacts.artifact?.extractedPath) {
      throw new Error(`bundled service "${serviceId}" was not pre-acquired.`);
    }

    await stat(state.installArtifacts.artifact.archivePath);
    await stat(state.installArtifacts.artifact.extractedPath);
    if (!path.isAbsolute(state.installArtifacts.artifact.archivePath)) {
      throw new Error(`bundled service "${serviceId}" archive path did not rehydrate to an absolute path.`);
    }
  }

  resetLifecycleState();
  return {
    artifactName,
    stagedRoot,
    stagedArchivePath,
    manifest,
  };
}

export async function createTemporaryOutputRoot(prefix = "service-lasso-release-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

import { cp, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getReleaseVersion, readRootPackageJson, RELEASE_VERSION_ENV } from "./release-version-lib.mjs";

export const RELEASE_FILES = [
  "LICENSE",
  "README.md",
  "package.json",
  "package-lock.json",
  "dist",
  "packages/core",
];

export async function ensureBuildOutput(repoRoot) {
  const distPath = path.join(repoRoot, "dist", "index.js");
  await stat(distPath);
  return distPath;
}

export function getArtifactName(version) {
  return `service-lasso-${version}`;
}

async function copyReleasePath(repoRoot, artifactRoot, relativePath) {
  const sourcePath = path.join(repoRoot, relativePath);
  const targetPath = path.join(artifactRoot, relativePath);

  await mkdir(path.dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { recursive: true });
}

async function writeReleaseManifest({ repoRoot, artifactRoot, artifactName, version }) {
  const packageJson = await readRootPackageJson(repoRoot);
  const manifest = {
    artifactName,
    version,
    versionSource: process.env[RELEASE_VERSION_ENV]?.trim() ? RELEASE_VERSION_ENV : "package.json",
    node: packageJson.engines?.node ?? ">=22",
    packageBoundary: "@service-lasso/service-lasso",
    artifactKind: "bounded-runtime-download",
    shippedFiles: [...RELEASE_FILES, "node_modules"],
    entrypoints: {
      runtime: "dist/index.js",
      corePackage: "packages/core/index.js",
      cli: "packages/core/cli.js",
    },
    runtimeRoots: {
      servicesRoot: "provided by the operator/consumer at runtime",
      workspaceRoot: "provided by the operator/consumer at runtime",
    },
    notes: [
      "This artifact is a bounded runtime download, not a finished npm publish payload.",
      "No service trees or workspace data are bundled into the artifact.",
      "The private core wrapper package remains a scaffold around the current built runtime.",
      "Production runtime dependencies are installed into node_modules so the staged artifact can boot directly.",
    ],
  };

  await writeFile(
    path.join(artifactRoot, "release-artifact.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return manifest;
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

export async function createReleaseArchive(outputRoot, artifactName) {
  const archivePath = path.join(outputRoot, `${artifactName}.tar.gz`);
  await rm(archivePath, { force: true });
  await runCommand("tar", ["-czf", archivePath, "-C", outputRoot, artifactName]);
  return archivePath;
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

  return {
    artifactName,
    artifactRoot,
    archivePath,
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

  const bootLogNeedle = "[service-lasso] core API spine started";
  const child = spawn(process.execPath, [path.join(stagedRoot, "dist", "index.js")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SERVICE_LASSO_PORT: String(bootPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

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

  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("close", resolve));

  return {
    artifactName,
    stagedRoot,
    stagedArchivePath,
    booted,
  };
}

export async function createTemporaryOutputRoot(prefix = "service-lasso-release-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

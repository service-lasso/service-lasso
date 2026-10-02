import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  createTemporaryOutputRoot,
  ensureBuildOutput,
  runCommand,
  writeArtifactSBOM,
} from "./release-artifact-lib.mjs";
import {
  getReleaseVersion,
  readRootPackageJson,
  RELEASE_VERSION_ENV,
} from "./release-version-lib.mjs";
import {
  consumeReleaseMetadataToken,
  stageOperatorTools,
  verifyRetainedOperatorTools,
} from "./operator-tool-packaging-lib.mjs";

const NPM_COMMAND = process.platform === "win32" ? "npm.cmd" : "npm";
export const NPMJS_REGISTRY = "https://registry.npmjs.org";
const PACKAGE_STAGE_LOCK_TIMEOUT_MS = 120_000;
const PACKAGE_STAGE_LOCK_STALE_MS = 600_000;

function escapeWindowsCmdArg(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

function runNpmCommand(args, options = {}) {
  if (process.platform !== "win32") {
    return runCommand(NPM_COMMAND, args, options);
  }

  const comspec = process.env.ComSpec ?? "cmd.exe";
  const commandLine = [NPM_COMMAND, ...args].map(escapeWindowsCmdArg).join(" ");

  return runCommand(comspec, ["/d", "/s", "/c", commandLine], options);
}

export const PUBLISH_FILES = ["LICENSE", "README.md", "dist"];

export function getPublishedPackageArtifactName(version) {
  return `service-lasso-package-${version}`;
}

async function readOptionalLockMetadata(lockPath) {
  try {
    return await readFile(lockPath, "utf8");
  } catch {
    return null;
  }
}

async function acquirePackageStageLock(outputRoot) {
  await mkdir(outputRoot, { recursive: true });

  const lockRoot = path.join(outputRoot, ".stage.lock");
  const lockOwnerPath = path.join(lockRoot, "owner.json");
  const startedAt = Date.now();

  while (Date.now() - startedAt < PACKAGE_STAGE_LOCK_TIMEOUT_MS) {
    try {
      await mkdir(lockRoot);
      await writeFile(
        lockOwnerPath,
        JSON.stringify(
          {
            pid: process.pid,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      return async () => {
        await rm(lockRoot, { recursive: true, force: true });
      };
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "EEXIST") {
        throw error;
      }

      const lockStat = await stat(lockRoot).catch(() => null);
      if (
        lockStat &&
        Date.now() - lockStat.mtimeMs > PACKAGE_STAGE_LOCK_STALE_MS
      ) {
        await rm(lockRoot, { recursive: true, force: true });
        continue;
      }

      await delay(100);
    }
  }

  const metadata = await readOptionalLockMetadata(lockOwnerPath);
  throw new Error(
    `Timed out waiting for package staging lock at ${lockRoot}.` +
      (metadata ? ` Current lock metadata: ${metadata}` : ""),
  );
}

export async function withPackageStageLock(outputRoot, callback) {
  const release = await acquirePackageStageLock(outputRoot);
  try {
    return await callback();
  } finally {
    await release();
  }
}

function buildPublishedPackageJson(version, rootPackageJson) {
  return {
    name: "@service-lasso/service-lasso",
    version,
    description: "Core runtime and reusable package for Service Lasso.",
    license: "Apache-2.0",
    type: "module",
    main: "./index.js",
    types: "./index.d.ts",
    bin: {
      "service-lasso": "./cli.js",
    },
    exports: {
      ".": "./index.js",
      "./cli": "./cli.js",
      "./package.json": "./package.json",
    },
    files: [
      "LICENSE",
      "README.md",
      "dist",
      "index.js",
      "index.d.ts",
      "cli.js",
      "publish-artifact.json",
      "sbom.cdx.json",
      "operator-tools",
    ],
    engines: {
      node: ">=22",
    },
    dependencies: rootPackageJson.dependencies ?? {},
    publishConfig: {
      registry: NPMJS_REGISTRY,
      access: "public",
    },
    repository: {
      type: "git",
      url: "git+https://github.com/service-lasso/service-lasso.git",
    },
    bugs: {
      url: "https://github.com/service-lasso/service-lasso/issues",
    },
    homepage: "https://github.com/service-lasso/service-lasso#readme",
  };
}

async function copyPublishPath(repoRoot, artifactRoot, relativePath) {
  const sourcePath = path.join(repoRoot, relativePath);
  const targetPath = path.join(artifactRoot, relativePath);

  await mkdir(path.dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { recursive: true });
}

async function writePublishScaffold({ repoRoot, artifactRoot, version, operatorTools }) {
  const rootPackageJson = await readRootPackageJson(repoRoot);
  const packageJson = buildPublishedPackageJson(version, rootPackageJson);
  const manifest = {
    artifactName: getPublishedPackageArtifactName(version),
    packageName: packageJson.name,
    version,
    versionSource: process.env[RELEASE_VERSION_ENV]?.trim()
      ? RELEASE_VERSION_ENV
      : "package.json",
    artifactKind: "bounded-npm-publish-payload",
    registry: packageJson.publishConfig.registry,
    shippedFiles: [
      ...PUBLISH_FILES,
      "index.js",
      "index.d.ts",
      "cli.js",
      "package.json",
      "publish-artifact.json",
      "sbom.cdx.json",
      "operator-tools",
    ],
    entrypoints: {
      library: "index.js",
      cli: "cli.js",
      runtime: "dist/index.js",
    },
    operatorToolsManifest: operatorTools ? "operator-tools/manifest.json" : undefined,
    notes: [
      "This payload is self-contained and publishable to the public npm registry.",
      "Consumers must still provide servicesRoot and workspaceRoot at runtime.",
      "This does not bundle services, workspace data, or the starter repos.",
    ],
  };

  await writeFile(
    path.join(artifactRoot, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );

  await writeFile(
    path.join(artifactRoot, "index.js"),
    [
      "async function loadRuntimeApp() {",
      '  return import("./dist/runtime/app.js");',
      "}",
      "",
      "async function loadApiServer() {",
      '  return import("./dist/server/index.js");',
      "}",
      "",
      "export async function startRuntimeApp(options = {}) {",
      "  const runtimeModule = await loadRuntimeApp();",
      "  return runtimeModule.startRuntimeApp(options);",
      "}",
      "",
      "export const createRuntime = startRuntimeApp;",
      "",
      "export async function startApiServer(options = {}) {",
      "  const serverModule = await loadApiServer();",
      "  return serverModule.startApiServer(options);",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(artifactRoot, "cli.js"),
    ["#!/usr/bin/env node", "", 'await import("./dist/cli.js");', ""].join(
      "\n",
    ),
    "utf8",
  );

  await writeFile(
    path.join(artifactRoot, "index.d.ts"),
    [
      'export type { RuntimeApp } from "./dist/runtime/app.js";',
      'export type { ApiServerOptions, RunningApiServer } from "./dist/server/index.js";',
      "",
      "export declare function startRuntimeApp(",
      '  options?: import("./dist/server/index.js").ApiServerOptions,',
      '): Promise<import("./dist/runtime/app.js").RuntimeApp>;',
      "",
      "export declare const createRuntime: typeof startRuntimeApp;",
      "",
      "export declare function startApiServer(",
      '  options?: import("./dist/server/index.js").ApiServerOptions,',
      '): Promise<import("./dist/server/index.js").RunningApiServer>;',
      "",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(artifactRoot, "publish-artifact.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return manifest;
}

export async function stagePublishedPackage({
  repoRoot,
  outputRoot = path.join(repoRoot, "artifacts", "npm"),
  version,
  releaseMetadataToken,
  // Tests may provide a deterministic release-response fixture. It substitutes
  // acquisition bytes only; stageOperatorTools still validates the release
  // identity, inventory, manifests, and retained digests.
  testOnlyOperatorToolFixture,
  // This test-only observer brackets the complete locked staging transaction.
  // It cannot alter staging or verification behavior.
  testOnlyStageObserver,
} = {}) {
  const metadataToken = releaseMetadataToken ?? consumeReleaseMetadataToken();
  return await withPackageStageLock(outputRoot, async () => {
    await testOnlyStageObserver?.({ phase: "entered" });
    try {
      const resolvedVersion = version ?? (await getReleaseVersion(repoRoot));
      const artifactName = getPublishedPackageArtifactName(resolvedVersion);
      const artifactRoot = path.join(outputRoot, artifactName);

      await ensureBuildOutput(repoRoot);
      await rm(artifactRoot, { recursive: true, force: true });
      await mkdir(outputRoot, { recursive: true });

      for (const relativePath of PUBLISH_FILES) {
        await copyPublishPath(repoRoot, artifactRoot, relativePath);
      }

      await stageOperatorTools({
        artifactRoot,
        releaseMetadataToken: metadataToken,
        ...testOnlyOperatorToolFixture,
      });
      await verifyRetainedOperatorTools({ artifactRoot });

      const manifest = await writePublishScaffold({
        repoRoot,
        artifactRoot,
        version: resolvedVersion,
        operatorTools: true,
      });

      await writeArtifactSBOM({
        artifactRoot,
        artifactName,
        version: resolvedVersion,
        artifactKind: manifest.artifactKind,
        lockPath: path.join(repoRoot, "package-lock.json"),
      });

      const packResult = await runNpmCommand(["pack"], {
        cwd: artifactRoot,
      });

      const packageArchiveName = packResult.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1);

      if (!packageArchiveName) {
        throw new Error("npm pack did not report the generated archive name.");
      }

      const packageArchivePath = path.join(artifactRoot, packageArchiveName);
      await stat(packageArchivePath);

      return {
        artifactName,
        artifactRoot,
        packageArchivePath,
        manifest,
      };
    } finally {
      await testOnlyStageObserver?.({ phase: "leaving" });
    }
  });
}

export async function verifyPublishedPackage({
  repoRoot,
  artifactRoot,
  packageArchivePath,
  version,
  bootPort = 18191,
} = {}) {
  const resolvedVersion = version ?? (await getReleaseVersion(repoRoot));
  const artifactName = getPublishedPackageArtifactName(resolvedVersion);
  const stagedRoot =
    artifactRoot ?? path.join(repoRoot, "artifacts", "npm", artifactName);
  const stagedArchivePath =
    packageArchivePath ??
    path.join(
      stagedRoot,
      "service-lasso-service-lasso-" + resolvedVersion + ".tgz",
    );

  await stat(path.join(stagedRoot, "package.json"));
  await stat(path.join(stagedRoot, "publish-artifact.json"));
  await stat(path.join(stagedRoot, "dist", "index.js"));
  await stat(path.join(stagedRoot, "index.js"));
  await stat(path.join(stagedRoot, "cli.js"));
  await stat(path.join(stagedRoot, "index.d.ts"));
  await stat(path.join(stagedRoot, "operator-tools", "manifest.json"));
  const sbom = JSON.parse(
    await readFile(path.join(stagedRoot, "sbom.cdx.json"), "utf8"),
  );
  await stat(stagedArchivePath);

  if (
    sbom.bomFormat !== "CycloneDX" ||
    sbom.specVersion !== "1.6" ||
    sbom.metadata?.component?.name !== "@service-lasso/service-lasso" ||
    sbom.metadata?.component?.version !== resolvedVersion ||
    !Array.isArray(sbom.components) ||
    sbom.components.length === 0
  ) {
    throw new Error(
      "staged npm package has an invalid or empty CycloneDX SBOM",
    );
  }

  const packageJson = JSON.parse(
    await readFile(path.join(stagedRoot, "package.json"), "utf8"),
  );
  if (packageJson.name !== "@service-lasso/service-lasso") {
    throw new Error(`unexpected staged package name: ${packageJson.name}`);
  }

  const directModule = await import(
    pathToFileURL(path.join(stagedRoot, "index.js")).href
  );
  if (typeof directModule.createRuntime !== "function") {
    throw new Error("staged package does not expose createRuntime()");
  }

  const consumerRoot = await mkdtemp(
    path.join(os.tmpdir(), "service-lasso-package-consumer-"),
  );
  const workspaceRoot = path.join(consumerRoot, "workspace");
  const servicesRoot = path.join(repoRoot, "services");
  const probePath = path.join(consumerRoot, "consumer-probe.mjs");
  const relativeArchivePath = path
    .relative(consumerRoot, stagedArchivePath)
    .split(path.sep)
    .join("/");

  try {
    await writeFile(
      path.join(consumerRoot, "package.json"),
      JSON.stringify(
        {
          name: "service-lasso-package-consumer",
          private: true,
          type: "module",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    await runNpmCommand(["install", relativeArchivePath], {
      cwd: consumerRoot,
    });

    const installedToolsRoot = path.join(consumerRoot, "node_modules", "@service-lasso", "service-lasso", "operator-tools");
    const installedTools = JSON.parse(await readFile(path.join(installedToolsRoot, "manifest.json"), "utf8"));
    if (!Array.isArray(installedTools.tools) || installedTools.tools.length !== 2 || installedTools.tools.some((tool) => tool.status !== "available")) {
      throw new Error("consumer-installed package does not retain both available operator tools");
    }
    for (const tool of installedTools.tools) {
      for (const asset of tool.assets ?? []) {
        const bytes = await readFile(path.join(consumerRoot, "node_modules", "@service-lasso", "service-lasso", asset.relativePath));
        const actual = createHash("sha256").update(bytes).digest("hex");
        if (actual !== asset.sha256) throw new Error(`consumer-installed operator tool checksum mismatch for ${asset.name}`);
      }
    }

    await writeFile(
      probePath,
      [
        'import { startApiServer } from "@service-lasso/service-lasso";',
        'import { spawn } from "node:child_process";',
        'import { copyFile, mkdir, writeFile } from "node:fs/promises";',
        'import { fileURLToPath } from "node:url";',
        "",
        `const servicesRoot = ${JSON.stringify(servicesRoot)};`,
        `const workspaceRoot = ${JSON.stringify(workspaceRoot)};`,
        `const port = ${bootPort};`,
        `const expectedVersion = ${JSON.stringify(resolvedVersion)};`,
        `const packagedRoot = ${JSON.stringify(path.join(consumerRoot, "node_modules", "@service-lasso", "service-lasso"))};`,
        "const toolRoot = new URL(\"./operator-cli/\", import.meta.url);",
        "const toolRootPath = fileURLToPath(toolRoot);",
        "await mkdir(toolRoot, { recursive: true });",
        "await writeFile(new URL(\"./package.json\", toolRoot), JSON.stringify({ private: true, type: \"module\" }));",
        "",
        "function runCli(args) {",
        "  return new Promise((resolve, reject) => {",
        "    const child = spawn(process.execPath, args, { cwd: toolRootPath, stdio: [\"ignore\", \"pipe\", \"pipe\"] });",
        "    let stdout = \"\"; let stderr = \"\";",
        "    child.stdout.on(\"data\", (value) => { stdout += value; });",
        "    child.stderr.on(\"data\", (value) => { stderr += value; });",
        "    child.on(\"error\", reject);",
        "    child.on(\"close\", (code) => resolve({ code, stdout, stderr }));",
        "  });",
        "}",
        "",
        "const api = await startApiServer({ servicesRoot, workspaceRoot, port });",
        "const healthResponse = await fetch(`${api.url}/api/health`);",
        "const health = await healthResponse.json();",
        "if (health.api.version !== expectedVersion) {",
        "  throw new Error(`runtime health version ${health.api.version} did not match ${expectedVersion}`);",
        "}",
        "const cliArchive = fileURLToPath(new URL(\"./operator-cli/service-lassoctl.tgz\", import.meta.url));",
        "await copyFile(`${packagedRoot}/operator-tools/service-lassoctl/service-lassoctl-0.1.0-dev.24d756e.tgz`, cliArchive);",
        "const npmCommand = process.platform === \"win32\" ? { command: process.env.ComSpec ?? \"cmd.exe\", args: [\"/d\", \"/s\", \"/c\", `npm.cmd install ${cliArchive}`] } : { command: \"npm\", args: [\"install\", cliArchive] };",
        "const install = spawn(npmCommand.command, npmCommand.args, { cwd: toolRootPath, stdio: \"inherit\" });",
        "await new Promise((resolve, reject) => { install.on(\"error\", reject); install.on(\"close\", (code) => code === 0 ? resolve() : reject(new Error(`operator CLI install exited ${code}`))); });",
        "const cliPath = fileURLToPath(new URL(\"./operator-cli/node_modules/@service-lasso/cli/dist/index.js\", import.meta.url));",
        "const success = await runCli([cliPath, \"--core-url\", api.url, \"instance\", \"status\", \"--json\"]);",
        "if (success.code !== 0 || JSON.parse(success.stdout).api?.version !== expectedVersion) throw new Error(`operator CLI JSON status failed: ${success.stderr}`);",
        "const unreachable = await runCli([cliPath, \"--core-url\", \"http://127.0.0.1:1\", \"instance\", \"status\", \"--json\"]);",
        "if (unreachable.code !== 1 || !unreachable.stderr.includes(\"core_unreachable\")) throw new Error(`operator CLI safe error failed: ${unreachable.stderr}`);",
        "const confirmation = await runCli([cliPath, \"--core-url\", api.url, \"service\", \"start\", \"missing-service\", \"--json\"]);",
        "if (confirmation.code !== 1 || !confirmation.stderr.includes(\"confirmation_required\")) throw new Error(`operator CLI confirmation guard failed: ${confirmation.stderr}`);",
        "console.log(JSON.stringify({ ok: true, url: api.url, version: health.api.version }));",
        "await api.stop();",
        "",
      ].join("\n"),
      "utf8",
    );

    const probe = await runCommand(process.execPath, [probePath], {
      cwd: consumerRoot,
    });
    const cliVersion = await runCommand(
      process.execPath,
      [
        path.join(
          consumerRoot,
          "node_modules",
          "@service-lasso",
          "service-lasso",
          "cli.js",
        ),
        "--version",
      ],
      { cwd: consumerRoot },
    );
    const lastLine = probe.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    const summary = lastLine ? JSON.parse(lastLine) : null;

    if (!summary?.ok) {
      throw new Error(
        "consumer probe did not report a successful package boot.",
      );
    }

    const reportedVersion = cliVersion.stdout.trim();
    if (reportedVersion !== resolvedVersion) {
      throw new Error(
        `packaged CLI reported version ${reportedVersion}, expected ${resolvedVersion}.`,
      );
    }

    return {
      artifactName,
      stagedRoot,
      stagedArchivePath,
      summary: {
        ...summary,
        cliVersion: reportedVersion,
        operatorTools: installedTools.tools.map((tool) => ({ command: tool.command, status: tool.status })),
      },
    };
  } finally {
    await rm(consumerRoot, { recursive: true, force: true });
  }
}

export { createTemporaryOutputRoot };

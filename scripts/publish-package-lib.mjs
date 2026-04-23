import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createTemporaryOutputRoot,
  ensureBuildOutput,
  runCommand,
} from "./release-artifact-lib.mjs";
import { getReleaseVersion, readRootPackageJson, RELEASE_VERSION_ENV } from "./release-version-lib.mjs";

const NPM_COMMAND = process.platform === "win32" ? "npm.cmd" : "npm";

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

export const PUBLISH_FILES = [
  "LICENSE",
  "README.md",
  "dist",
];

export function getPublishedPackageArtifactName(version) {
  return `service-lasso-package-${version}`;
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
    ],
    engines: {
      node: ">=22",
    },
    dependencies: rootPackageJson.dependencies ?? {},
    publishConfig: {
      registry: "https://npm.pkg.github.com",
      access: "restricted",
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

async function writePublishScaffold({ repoRoot, artifactRoot, version }) {
  const rootPackageJson = await readRootPackageJson(repoRoot);
  const packageJson = buildPublishedPackageJson(version, rootPackageJson);
  const manifest = {
    artifactName: getPublishedPackageArtifactName(version),
    packageName: packageJson.name,
    version,
    versionSource: process.env[RELEASE_VERSION_ENV]?.trim() ? RELEASE_VERSION_ENV : "package.json",
    artifactKind: "bounded-npm-publish-payload",
    registry: packageJson.publishConfig.registry,
    shippedFiles: [
      ...PUBLISH_FILES,
      "index.js",
      "index.d.ts",
      "cli.js",
      "package.json",
      "publish-artifact.json",
    ],
    entrypoints: {
      library: "index.js",
      cli: "cli.js",
      runtime: "dist/index.js",
    },
    notes: [
      "This payload is self-contained and publishable to GitHub Packages.",
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
      'async function loadRuntimeApp() {',
      '  return import("./dist/runtime/app.js");',
      "}",
      "",
      'async function loadApiServer() {',
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
    [
      "#!/usr/bin/env node",
      "",
      "await import(\"./dist/cli.js\");",
      "",
    ].join("\n"),
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
} = {}) {
  const resolvedVersion = version ?? (await getReleaseVersion(repoRoot));
  const artifactName = getPublishedPackageArtifactName(resolvedVersion);
  const artifactRoot = path.join(outputRoot, artifactName);

  await ensureBuildOutput(repoRoot);
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  for (const relativePath of PUBLISH_FILES) {
    await copyPublishPath(repoRoot, artifactRoot, relativePath);
  }

  const manifest = await writePublishScaffold({
    repoRoot,
    artifactRoot,
    version: resolvedVersion,
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
  const stagedRoot = artifactRoot ?? path.join(repoRoot, "artifacts", "npm", artifactName);
  const stagedArchivePath =
    packageArchivePath ?? path.join(stagedRoot, "service-lasso-service-lasso-" + resolvedVersion + ".tgz");

  await stat(path.join(stagedRoot, "package.json"));
  await stat(path.join(stagedRoot, "publish-artifact.json"));
  await stat(path.join(stagedRoot, "dist", "index.js"));
  await stat(path.join(stagedRoot, "index.js"));
  await stat(path.join(stagedRoot, "cli.js"));
  await stat(path.join(stagedRoot, "index.d.ts"));
  await stat(stagedArchivePath);

  const packageJson = JSON.parse(await readFile(path.join(stagedRoot, "package.json"), "utf8"));
  if (packageJson.name !== "@service-lasso/service-lasso") {
    throw new Error(`unexpected staged package name: ${packageJson.name}`);
  }

  const directModule = await import(pathToFileURL(path.join(stagedRoot, "index.js")).href);
  if (typeof directModule.createRuntime !== "function") {
    throw new Error("staged package does not expose createRuntime()");
  }

  const consumerRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-package-consumer-"));
  const workspaceRoot = path.join(consumerRoot, "workspace");
  const servicesRoot = path.join(repoRoot, "services");
  const probePath = path.join(consumerRoot, "consumer-probe.mjs");
  const relativeArchivePath = path.relative(consumerRoot, stagedArchivePath).split(path.sep).join("/");

  try {
    await writeFile(
      path.join(consumerRoot, "package.json"),
      JSON.stringify({ name: "service-lasso-package-consumer", private: true, type: "module" }, null, 2) + "\n",
      "utf8",
    );

    await runNpmCommand(["install", relativeArchivePath], { cwd: consumerRoot });

    await writeFile(
      probePath,
      [
        'import { startApiServer } from "@service-lasso/service-lasso";',
        "",
        `const servicesRoot = ${JSON.stringify(servicesRoot)};`,
        `const workspaceRoot = ${JSON.stringify(workspaceRoot)};`,
        `const port = ${bootPort};`,
        `const expectedVersion = ${JSON.stringify(resolvedVersion)};`,
        "",
        "const api = await startApiServer({ servicesRoot, workspaceRoot, port });",
        'const healthResponse = await fetch(`${api.url}/api/health`);',
        "const health = await healthResponse.json();",
        "if (health.api.version !== expectedVersion) {",
        '  throw new Error(`runtime health version ${health.api.version} did not match ${expectedVersion}`);',
        "}",
        "console.log(JSON.stringify({ ok: true, url: api.url, version: health.api.version }));",
        "await api.stop();",
        "",
      ].join("\n"),
      "utf8",
    );

    const probe = await runCommand(process.execPath, [probePath], { cwd: consumerRoot });
    const cliVersion = await runCommand(
      process.execPath,
      [path.join(consumerRoot, "node_modules", "@service-lasso", "service-lasso", "cli.js"), "--version"],
      { cwd: consumerRoot },
    );
    const lastLine = probe.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    const summary = lastLine ? JSON.parse(lastLine) : null;

    if (!summary?.ok) {
      throw new Error("consumer probe did not report a successful package boot.");
    }

    const reportedVersion = cliVersion.stdout.trim();
    if (reportedVersion !== resolvedVersion) {
      throw new Error(`packaged CLI reported version ${reportedVersion}, expected ${resolvedVersion}.`);
    }

    return {
      artifactName,
      stagedRoot,
      stagedArchivePath,
      summary: {
        ...summary,
        cliVersion: reportedVersion,
      },
    };
  } finally {
    await rm(consumerRoot, { recursive: true, force: true });
  }
}

export { createTemporaryOutputRoot };

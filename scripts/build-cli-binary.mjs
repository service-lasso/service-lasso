import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import postjectPackage from "postject/package.json" with { type: "json" };

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromRepo = createRequire(path.join(repoRoot, "package.json"));
const outputRoot = path.join(repoRoot, "artifacts", "cli-binaries");
const seaFuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const supportedTargets = new Map([
  ["win32-x64", { platform: "win32", arch: "x64", extension: ".exe" }],
  ["linux-x64", { platform: "linux", arch: "x64", extension: "" }],
  ["darwin-x64", { platform: "darwin", arch: "x64", extension: "" }],
]);

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function packageVersion(packageName) {
  const contents = await readFile(path.join(repoRoot, "node_modules", packageName, "package.json"), "utf8");
  return JSON.parse(contents).version;
}

async function currentSourceSha() {
  const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  return stdout.trim();
}

function resolveTarget(argv) {
  const requested = argv[0] ?? `${process.platform}-${process.arch}`;
  const target = supportedTargets.get(requested);
  if (!target) throw new Error(`Unsupported CLI binary target: ${requested}. Supported targets: ${[...supportedTargets.keys()].join(", ")}.`);
  if (target.platform !== process.platform || target.arch !== process.arch) throw new Error(`Native build required for ${requested}; current host is ${process.platform}-${process.arch}.`);
  return { requested, ...target };
}

export async function buildCliBinary(argv = process.argv.slice(2)) {
  const target = resolveTarget(argv);
  const nodeVersion = process.version.replace(/^v/, "");
  if (nodeVersion !== "22.23.2") throw new Error(`Node 22.23.2 is required for SEA builds; found ${process.version}.`);
  const stagingRoot = path.join(outputRoot, `.staging-${target.requested}`);
  const binaryName = `service-lasso-${target.requested}${target.extension}`;
  const binaryPath = path.join(outputRoot, binaryName);
  const bundlePath = path.join(stagingRoot, "cli.cjs");
  const blobPath = path.join(stagingRoot, "sea-prep.blob");
  const configPath = path.join(stagingRoot, "sea-config.json");
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  await build({
    absWorkingDir: repoRoot,
    bundle: true,
    entryPoints: [path.join(repoRoot, "dist", "cli.js")],
    format: "cjs",
    outfile: bundlePath,
    platform: "node",
    sourcemap: false,
    target: "node22",
    legalComments: "none",
    plugins: [{
      name: "repo-package-resolution",
      setup(buildContext) {
        buildContext.onResolve({ filter: /^[^./]|^@/ }, (args) => {
          if (args.path.startsWith("node:") || builtinModules.includes(args.path)) return { path: args.path, external: true };
          return { path: requireFromRepo.resolve(args.path) };
        });
      },
    }],
  });
  await writeFile(configPath, JSON.stringify({ main: bundlePath, output: blobPath, disableExperimentalSEAWarning: true, useCodeCache: false, execArgvExtension: "none" }));
  await execFile(process.execPath, ["--experimental-sea-config", configPath], { cwd: stagingRoot });
  await rm(binaryPath, { force: true });
  await cp(process.execPath, binaryPath);
  if (target.platform === "darwin") await execFile("codesign", ["--remove-signature", binaryPath]);
  const postjectBin = path.join(repoRoot, "node_modules", "postject", "dist", "cli.js");
  const postjectArgs = [postjectBin, binaryPath, "NODE_SEA_BLOB", blobPath, "--sentinel-fuse", seaFuse];
  if (target.platform === "darwin") postjectArgs.push("--macho-segment-name", "NODE_SEA");
  await execFile(process.execPath, postjectArgs, { cwd: stagingRoot });
  if (target.platform === "darwin") await execFile("codesign", ["--sign", "-", binaryPath]);
  const [binary, sourceSha, esbuildVersion] = await Promise.all([readFile(binaryPath), currentSourceSha(), packageVersion("esbuild")]);
  const provenance = { schema: "service-lasso.cli-binary-provenance.v1", retainedContent: "metadata_only", sourceSha, target: { platform: target.platform, architecture: target.arch }, binary: { name: binaryName, sha256: sha256(binary), bytes: binary.byteLength }, tools: { node: nodeVersion, esbuild: esbuildVersion, postject: postjectPackage.version } };
  const provenancePath = path.join(outputRoot, `${binaryName}.provenance.json`);
  await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
  await rm(stagingRoot, { recursive: true, force: true });
  return { binaryPath, provenancePath, provenance };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await buildCliBinary();
  console.log(JSON.stringify(result.provenance));
}

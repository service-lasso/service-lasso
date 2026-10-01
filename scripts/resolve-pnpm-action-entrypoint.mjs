import { spawnSync } from "node:child_process";
import { access, appendFile, lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ACTION_REF = "ea17c68df8912ef543352723c149a84f56e3d413";
const ACTION_BOOTSTRAP_VERSION = "11.25.0";
const PNPM_VERSION = "10.34.5";
const MAX_OUTPUT_BYTES = 65_536;
const VERSION_TIMEOUT_MS = 20_000;

function fail(message) { throw new Error(`Pinned pnpm action entrypoint: ${message}`); }

function isDescendant(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

function equalPath(left, right) { return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right; }

async function regular(file, label) {
  const info = await lstat(file).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) fail(`${label} is not a regular file`);
  return info;
}

async function selectedPnpmFromPath(environment, actionBin) {
  const entries = String(environment.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? String(environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((value) => value.toLowerCase()) : [""];
  for (const entry of entries) {
    const resolvedEntry = await realpath(entry).catch(() => null);
    if (!resolvedEntry) continue;
    for (const extension of extensions) {
      const executable = path.join(resolvedEntry, `pnpm${extension}`);
      const info = await lstat(executable).catch(() => null);
      if (info?.isFile() || info?.isSymbolicLink()) return { pathEntry: resolvedEntry, executable };
    }
  }
  fail("pnpm is not present on PATH");
}

function executeActionPnpm(executable, environment) {
  if (process.platform !== "win32") return spawnSync(executable, ["--version"], { encoding: "utf8", shell: false, windowsHide: true, timeout: VERSION_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, env: environment });
  return spawnSync(executable, ["--version"], { encoding: "utf8", shell: true, windowsHide: true, timeout: VERSION_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, env: environment });
}

export async function verifyPinnedPnpmActionProvision(environment = process.env) {
  const { RUNNER_TEMP: runnerTemp, PNPM_ACTION_BIN_DEST: actionBinDest } = environment;
  if (!runnerTemp || !actionBinDest) fail("RUNNER_TEMP and PNPM_ACTION_BIN_DEST are required");
  const [tempRoot, actionBin] = await Promise.all([
    realpath(runnerTemp).catch(() => fail("RUNNER_TEMP does not exist")),
    realpath(actionBinDest).catch(() => fail("the action-reported bin_dest does not exist")),
  ]);
  if (!isDescendant(tempRoot, actionBin)) fail("the action-reported bin_dest must remain below RUNNER_TEMP");
  if (process.versions.node.split(".")[0] !== "22") fail("the caller guard requires Node 22");
  const selected = await selectedPnpmFromPath(environment, actionBin);
  if (!equalPath(selected.pathEntry, actionBin)) fail("the PATH-selected pnpm does not bind to the action-reported bin_dest");
  const pnpmHome = path.dirname(actionBin), nodeModules = path.dirname(pnpmHome);
  if (path.basename(actionBin) !== "bin" || path.basename(pnpmHome) !== ".bin" || path.basename(nodeModules) !== "node_modules") fail("the action-reported bin_dest does not have the pinned self-update layout");
  const bootstrapRoot = path.join(nodeModules, "pnpm"), bootstrapManifestPath = path.join(bootstrapRoot, "package.json"), bootstrapEntrypoint = path.join(bootstrapRoot, "bin", "pnpm.mjs");
  let bootstrapManifest;
  try { bootstrapManifest = JSON.parse(await readFile(bootstrapManifestPath, "utf8")); } catch { fail("the action bootstrap manifest is invalid"); }
  if (bootstrapManifest?.name !== "pnpm" || bootstrapManifest.version !== ACTION_BOOTSTRAP_VERSION || bootstrapManifest.bin?.pnpm !== "bin/pnpm.mjs") fail("the action bootstrap is not pinned pnpm@11.25.0");
  await regular(bootstrapEntrypoint, "the action bootstrap pnpm.mjs");
  if (!equalPath(path.dirname(selected.executable), actionBin)) fail("the PATH-selected pnpm executable does not remain in the action-reported bin_dest");
  const version = executeActionPnpm(selected.executable, environment);
  if (version.error || version.status !== 0 || version.signal || version.stdout.trim() !== PNPM_VERSION || Buffer.byteLength(version.stdout) > MAX_OUTPUT_BYTES || Buffer.byteLength(version.stderr) > MAX_OUTPUT_BYTES) fail("the PATH-selected action self-update did not execute exactly pnpm@10.34.5");
  return { tempRoot, actionBin, selected, bootstrapManifestPath, bootstrapEntrypoint };
}

async function appendEnvironment(values) {
  const environmentFile = process.env.GITHUB_ENV;
  if (!environmentFile) fail("GITHUB_ENV is required to bind the caller for later steps");
  await appendFile(environmentFile, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`, "utf8");
}

export async function resolvePinnedPnpmActionEntrypoint(environment = process.env) {
  const { ADMIN_PNPM_PREFIX: prefix } = environment;
  if (!prefix) fail("ADMIN_PNPM_PREFIX is required");
  const { tempRoot, actionBin, selected, bootstrapManifestPath, bootstrapEntrypoint } = await verifyPinnedPnpmActionProvision(environment);
  const resolvedPrefix = await realpath(prefix).catch(() => fail("the isolated pnpm prefix does not exist"));
  if (!isDescendant(tempRoot, resolvedPrefix)) fail("the isolated caller path must remain below RUNNER_TEMP");
  const packageRoot = path.join(resolvedPrefix, "node_modules", "pnpm");
  const manifestPath = path.join(packageRoot, "package.json");
  const entrypoint = path.join(packageRoot, "bin", "pnpm.cjs");
  const [manifestText] = await Promise.all([
    readFile(manifestPath, "utf8"),
    regular(entrypoint, "the isolated pnpm.cjs entrypoint"),
  ]);
  let manifest;
  try { manifest = JSON.parse(manifestText); } catch { fail("the isolated package manifest is invalid"); }
  if (manifest?.name !== "pnpm" || manifest.version !== PNPM_VERSION || manifest.bin?.pnpm !== "bin/pnpm.cjs") fail("the isolated package manifest does not bind pnpm@10.34.5 to pnpm.cjs");
  await access(entrypoint);
  const node = await realpath(process.execPath);
  const version = spawnSync(node, [entrypoint, "--version"], { encoding: "utf8", shell: false, windowsHide: true, timeout: VERSION_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, env: environment });
  if (version.error || version.status !== 0 || version.signal || version.stdout.trim() !== PNPM_VERSION || Buffer.byteLength(version.stdout) > MAX_OUTPUT_BYTES || Buffer.byteLength(version.stderr) > MAX_OUTPUT_BYTES) fail("the isolated absolute Node and pnpm.cjs argv did not execute exactly pnpm@10.34.5");
  const [manifestBytes, entrypointBytes] = await Promise.all([readFile(manifestPath), readFile(entrypoint)]);
  const evidenceDirectory = path.join(tempRoot, "pnpm-action-pinned-entrypoint");
  await mkdir(evidenceDirectory, { recursive: true });
  const evidencePath = path.join(evidenceDirectory, "identity.json");
  const evidence = {
    schema: "service-lasso.pnpm-action-pinned-entrypoint.v1",
    action: { repository: "pnpm/action-setup", ref: ACTION_REF, binDest: actionBin, bootstrap: { package: "pnpm", version: ACTION_BOOTSTRAP_VERSION, manifestSha256: sha256(await readFile(bootstrapManifestPath)), entrypointSha256: sha256(await readFile(bootstrapEntrypoint)) }, selfUpdated: { executable: selected.executable, version: PNPM_VERSION, sha256: sha256(await readFile(selected.executable)) } },
    caller: { package: "pnpm", version: PNPM_VERSION, node, entrypoint, manifestSha256: sha256(manifestBytes), entrypointSha256: sha256(entrypointBytes) },
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence)}\n`, "utf8");
  return { node, entrypoint, evidencePath, evidence };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes("--verify-action-binding")) await verifyPinnedPnpmActionProvision();
  else {
    const result = await resolvePinnedPnpmActionEntrypoint();
    await appendEnvironment({ ADMIN_PNPM_NODE: result.node, ADMIN_PNPM_ENTRYPOINT: result.entrypoint, ADMIN_PNPM_ACTION_ENTRYPOINT_EVIDENCE: result.evidencePath });
  }
}

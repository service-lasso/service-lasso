import { spawnSync } from "node:child_process";
import { access, appendFile, lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ACTION_REF = "ea17c68df8912ef543352723c149a84f56e3d413";
const PNPM_VERSION = "10.34.5";
const MAX_OUTPUT_BYTES = 65_536;
const VERSION_TIMEOUT_MS = 20_000;

function fail(message) { throw new Error(`Pinned pnpm action entrypoint: ${message}`); }

function isDescendant(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

async function appendEnvironment(values) {
  const environmentFile = process.env.GITHUB_ENV;
  if (!environmentFile) fail("GITHUB_ENV is required to bind the caller for later steps");
  await appendFile(environmentFile, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`, "utf8");
}

export async function resolvePinnedPnpmActionEntrypoint(environment = process.env) {
  const { RUNNER_TEMP: runnerTemp, PNPM_ACTION_BIN_DEST: actionBinDest, ADMIN_PNPM_PREFIX: prefix } = environment;
  if (!runnerTemp || !actionBinDest || !prefix) fail("RUNNER_TEMP, PNPM_ACTION_BIN_DEST, and ADMIN_PNPM_PREFIX are required");
  const tempRoot = await realpath(runnerTemp).catch(() => fail("RUNNER_TEMP does not exist"));
  const actionBin = await realpath(actionBinDest).catch(() => fail("the action-reported bin_dest does not exist"));
  const resolvedPrefix = await realpath(prefix).catch(() => fail("the isolated pnpm prefix does not exist"));
  if (!isDescendant(tempRoot, actionBin) || !isDescendant(tempRoot, resolvedPrefix)) fail("action and isolated caller paths must remain below RUNNER_TEMP");
  const packageRoot = path.join(resolvedPrefix, "node_modules", "pnpm");
  const manifestPath = path.join(packageRoot, "package.json");
  const entrypoint = path.join(packageRoot, "bin", "pnpm.cjs");
  const [manifestText, entrypointInfo] = await Promise.all([
    readFile(manifestPath, "utf8"),
    lstat(entrypoint).catch(() => fail("the isolated package has no pnpm.cjs entrypoint")),
  ]);
  let manifest;
  try { manifest = JSON.parse(manifestText); } catch { fail("the isolated package manifest is invalid"); }
  if (manifest?.name !== "pnpm" || manifest.version !== PNPM_VERSION || manifest.bin?.pnpm !== "bin/pnpm.cjs") fail("the isolated package manifest does not bind pnpm@10.34.5 to pnpm.cjs");
  if (!entrypointInfo.isFile() || entrypointInfo.isSymbolicLink()) fail("the isolated pnpm.cjs entrypoint is not a regular file");
  await access(entrypoint);
  const node = await realpath(process.execPath);
  const version = spawnSync(node, [entrypoint, "--version"], { encoding: "utf8", shell: false, windowsHide: true, timeout: VERSION_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES });
  if (version.error || version.status !== 0 || version.signal || version.stdout.trim() !== PNPM_VERSION || Buffer.byteLength(version.stdout) > MAX_OUTPUT_BYTES || Buffer.byteLength(version.stderr) > MAX_OUTPUT_BYTES) fail("the isolated absolute Node and pnpm.cjs argv did not execute exactly pnpm@10.34.5");
  const [manifestBytes, entrypointBytes] = await Promise.all([readFile(manifestPath), readFile(entrypoint)]);
  const evidenceDirectory = path.join(tempRoot, "pnpm-action-pinned-entrypoint");
  await mkdir(evidenceDirectory, { recursive: true });
  const evidencePath = path.join(evidenceDirectory, "identity.json");
  const evidence = {
    schema: "service-lasso.pnpm-action-pinned-entrypoint.v1",
    action: { repository: "pnpm/action-setup", ref: ACTION_REF, binDest: actionBin },
    caller: { package: "pnpm", version: PNPM_VERSION, node, entrypoint, manifestSha256: sha256(manifestBytes), entrypointSha256: sha256(entrypointBytes) },
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence)}\n`, "utf8");
  return { node, entrypoint, evidencePath, evidence };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await resolvePinnedPnpmActionEntrypoint();
  await appendEnvironment({ ADMIN_PNPM_NODE: result.node, ADMIN_PNPM_ENTRYPOINT: result.entrypoint, ADMIN_PNPM_ACTION_ENTRYPOINT_EVIDENCE: result.evidencePath });
}

import { appendFile, lstat, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { verifyPinnedPnpmActionProvision, resolvePinnedPnpmActionEntrypoint } from "./resolve-pnpm-action-entrypoint.mjs";
import { recordPrebrowserFailure } from "./record-admin-trusted-unlock-prebrowser-failure.mjs";

const STAGES = ["action_binding", "fresh_prefix", "isolated_install", "package_identity"];

function fail(message) { throw new Error(`Trusted-unlock caller establishment: ${message}`); }
async function npmCli() {
  if (process.platform !== "win32") return { command: "npm", args: [] };
  return { command: process.execPath, args: [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")] };
}
async function retain(stage) {
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp) fail("RUNNER_TEMP is required for failed caller custody");
  const output = path.join(await realpath(runnerTemp).catch(() => fail("RUNNER_TEMP is not an existing runner-owned directory")), "admin-trusted-unlock-prebrowser-failure.json");
  await recordPrebrowserFailure({ output, stage, platform: process.env.ADMIN_PLATFORM ?? process.env.QUALIFICATION_PLATFORM, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT });
  if (!process.env.GITHUB_ENV) fail("GITHUB_ENV is required for failed caller custody");
  await appendFile(process.env.GITHUB_ENV, `ADMIN_TRUSTED_UNLOCK_PREBROWSER_FAILURE_PATH=${output}\n`, "utf8");
}
async function stage(name, action) {
  try { await action(); } catch {
    await retain(name);
    fail(`closed ${name} failure retained`);
  }
}

await stage("action_binding", () => verifyPinnedPnpmActionProvision());
await stage("fresh_prefix", async () => {
  if (await lstat(process.env.ADMIN_PNPM_PREFIX ?? "").catch(() => null)) fail("isolated pnpm prefix already exists");
});
await stage("isolated_install", async () => {
  const npm = await npmCli();
  const result = spawnSync(npm.command, [...npm.args, "install", "--prefix", process.env.ADMIN_PNPM_PREFIX ?? "", "--ignore-scripts", "--no-save", "--package-lock=false", "--no-audit", "--no-fund", "pnpm@10.34.5"], { encoding: "utf8", shell: false, windowsHide: true, env: process.env });
  if (result.error || result.status !== 0 || result.signal) fail("isolated pnpm installation failed");
});
let identity;
await stage("package_identity", async () => { identity = await resolvePinnedPnpmActionEntrypoint(); });
if (!process.env.GITHUB_ENV) fail("GITHUB_ENV is required to bind the caller for later steps");
await appendFile(process.env.GITHUB_ENV, `ADMIN_PNPM_NODE=${identity.node}\nADMIN_PNPM_ENTRYPOINT=${identity.entrypoint}\nADMIN_PNPM_ACTION_ENTRYPOINT_EVIDENCE=${identity.evidencePath}\n`, "utf8");

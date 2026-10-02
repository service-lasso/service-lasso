import { lstat, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { strictJson } from "./consume-admin-trusted-unlock-receipt.mjs";

export const PREBROWSER_FAILURE_SCHEMA = "service-lasso.admin-trusted-unlock-prebrowser-failure.v1";
const STAGES = new Set(["action_binding", "fresh_prefix", "isolated_install", "package_identity"]);

function required(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

export function parsePrebrowserFailure(source) {
  if (!strictJson(source)) return null;
  let value;
  try { value = JSON.parse(source); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const expected = ["outcome", "platform", "run", "schema", "stage"].sort().join(",");
  if (Object.keys(value).sort().join(",") !== expected || value.schema !== PREBROWSER_FAILURE_SCHEMA || value.outcome !== "failure" || !["linux", "win32", "darwin"].includes(value.platform) || !STAGES.has(value.stage)) return null;
  if (!value.run || typeof value.run !== "object" || Array.isArray(value.run) || Object.keys(value.run).sort().join(",") !== "attempt,id" || !Number.isSafeInteger(value.run.id) || value.run.id <= 0 || !Number.isSafeInteger(value.run.attempt) || value.run.attempt <= 0) return null;
  return value;
}

export async function recordPrebrowserFailure({ output, platform, stage, runId, runAttempt }) {
  const value = {
    schema: PREBROWSER_FAILURE_SCHEMA,
    outcome: "failure",
    platform: required(platform, /^(?:linux|win32|darwin)$/u, "platform"),
    stage: required(stage, /^(?:action_binding|fresh_prefix|isolated_install|package_identity)$/u, "stage"),
    run: { id: Number(required(String(runId), /^[1-9][0-9]*$/u, "run ID")), attempt: Number(required(String(runAttempt), /^[1-9][0-9]*$/u, "run attempt")) },
  };
  const target = path.resolve(output);
  const existing = await lstat(target).catch(() => null);
  if (existing) throw new Error("Pre-browser failure output already exists.");
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, target);
  return value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const output = process.argv[process.argv.indexOf("--output") + 1];
  const stage = process.argv[process.argv.indexOf("--stage") + 1];
  if (!output || !stage) throw new Error("Pre-browser failure arguments are incomplete.");
  await recordPrebrowserFailure({ output, stage, platform: process.env.ADMIN_PLATFORM ?? process.env.QUALIFICATION_PLATFORM, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT });
}

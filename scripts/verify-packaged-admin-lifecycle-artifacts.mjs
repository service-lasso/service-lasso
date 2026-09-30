import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { hasObservedConsumerReceipt, parseConsumerReceipt } from "./consume-admin-trusted-unlock-receipt.mjs";
const platforms = ["linux", "win32", "darwin"];
function required(name, pattern = /^.+$/u) { const value = process.env[name]; if (!value || !pattern.test(value)) throw new Error(`Invalid ${name}.`); return value; }
async function regular(file, label) { const info = await lstat(file).catch(() => null); if (!info?.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > 16384) throw new Error(`${label} is missing, private, or invalid.`); return readFile(file, "utf8"); }
export async function verifyArtifacts({ root, runId, runAttempt, workflowSha }) {
  const expected = new Set(platforms.map((platform) => `packaged-admin-lifecycle-${platform}-${runId}-${runAttempt}`));
  const directories = await readdir(root, { withFileTypes: true });
  if (directories.length !== expected.size || directories.some((entry) => !entry.isDirectory() || !expected.has(entry.name))) throw new Error("Downloaded artifacts are not the exact current attempt.");
  for (const platform of platforms) {
    const name = `packaged-admin-lifecycle-${platform}-${runId}-${runAttempt}`, directory = path.join(root, name), files = await readdir(directory, { withFileTypes: true });
    const evidenceName = `packaged-admin-lifecycle-${platform}.json`, receiptName = "admin-trusted-unlock-receipt.json";
    if (files.length !== 2 || files.some((entry) => !entry.isFile() || entry.isSymbolicLink()) || !files.some((entry) => entry.name === evidenceName) || !files.some((entry) => entry.name === receiptName)) throw new Error(`${platform} artifact inventory is invalid.`);
    const evidence = JSON.parse(await regular(path.join(directory, evidenceName), `${platform} evidence`));
    const receipt = parseConsumerReceipt(await regular(path.join(directory, receiptName), `${platform} receipt`));
    if (!receipt || !hasObservedConsumerReceipt(receipt) || evidence?.schema !== "service-lasso.packaged-admin-lifecycle.v1" || evidence?.platform !== platform || evidence?.run?.id !== runId || evidence?.run?.attempt !== runAttempt || evidence?.run?.workflowSha !== workflowSha || evidence?.consumer?.attempt !== "real_browser" || JSON.stringify(evidence.consumer) !== JSON.stringify({ attempt: "real_browser", ...receipt })) throw new Error(`${platform} receipt custody validation failed.`);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await verifyArtifacts({ root: required("PACKAGED_ARTIFACTS_ROOT"), runId: required("GITHUB_RUN_ID", /^[1-9][0-9]*$/u), runAttempt: required("GITHUB_RUN_ATTEMPT", /^[1-9][0-9]*$/u), workflowSha: required("GITHUB_SHA", /^[0-9a-f]{40}$/u) });

import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isRetainableConsumerReceipt, parseConsumerReceipt, strictJson } from "./consume-admin-trusted-unlock-receipt.mjs";

function required(name, pattern) { const value = process.env[name]; if (typeof value !== "string" || !pattern.test(value)) throw new Error(`Invalid ${name}.`); return value; }

export async function retainReceipt({ receiptPath, evidencePath, retainedPath, runId, runAttempt, candidateSha, eventSha, platform }) {
  const info = await lstat(receiptPath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > 2048) throw new Error("Consumer receipt is missing, private, or out of bounds.");
  const receipt = parseConsumerReceipt(await readFile(receiptPath, "utf8"));
  if (!receipt || !isRetainableConsumerReceipt(receipt)) throw new Error("Consumer receipt is missing, malformed, private, or invalid.");
  const evidenceInfo = await lstat(evidencePath).catch(() => null);
  if (!evidenceInfo?.isFile() || evidenceInfo.isSymbolicLink() || evidenceInfo.size <= 0 || evidenceInfo.size > 16384) throw new Error("Platform evidence is missing, private, or out of bounds.");
  const evidenceSource = await readFile(evidencePath, "utf8");
  if (!strictJson(evidenceSource)) throw new Error("Platform evidence is malformed or has duplicate keys.");
  const evidence = JSON.parse(evidenceSource);
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) || evidence.platform !== platform) throw new Error("Platform evidence does not bind this platform.");
  evidence.run = { id: runId, attempt: runAttempt, candidateSha, eventSha };
  evidence.consumer = { attempt: "real_browser", ...receipt };
  await writeFile(`${evidencePath}.tmp`, `${JSON.stringify(evidence)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(`${evidencePath}.tmp`, evidencePath);
  await writeFile(retainedPath, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const receiptPath = process.argv[process.argv.indexOf("--receipt") + 1], evidencePath = process.argv[process.argv.indexOf("--evidence") + 1], retainedPath = process.argv[process.argv.indexOf("--retained") + 1];
  if (!receiptPath || !evidencePath || !retainedPath) throw new Error("Receipt retention arguments are incomplete.");
  await retainReceipt({ receiptPath, evidencePath, retainedPath, runId: required("GITHUB_RUN_ID", /^[1-9][0-9]*$/u), runAttempt: required("GITHUB_RUN_ATTEMPT", /^[1-9][0-9]*$/u), candidateSha: required("QUALIFICATION_CANDIDATE_SHA", /^[0-9a-f]{40}$/u), eventSha: required("QUALIFICATION_EVENT_SHA", /^[0-9a-f]{40}$/u), platform: required("ADMIN_PLATFORM", /^(linux|win32|darwin)$/u) });
}

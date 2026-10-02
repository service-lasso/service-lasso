// Produces the only first-custody material that may leave the runner.  The
// source receipt and journal remain private because they include local paths,
// process identity, and filesystem observations.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function required(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${flag}.`);
  return path.resolve(process.argv[index + 1]);
}
const input = required("--input");
const journal = required("--journal");
const output = required("--output");
const receiptSource = await readFile(input, "utf8");
const receipt = JSON.parse(receiptSource);
const exactKeys = (value, keys) => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const fileState = (value) => exactKeys(value, ["state", "size", "sha256"]) && value.state === "FILE" && Number.isSafeInteger(value.size) && value.size > 0 && /^[0-9a-f]{64}$/u.test(value.sha256);
if (!exactKeys(receipt, ["schema", "private", "platform", "run", "source", "runner", "ownedPaths", "registries", "journal"]) || receipt.schema !== "service-lasso.qualification-initial-receipt.v2" || receipt.private !== true || !["linux", "win32", "darwin"].includes(receipt.platform) || !exactKeys(receipt.run, ["id", "attempt"]) || !/^[1-9][0-9]*$/u.test(String(receipt.run.id)) || !/^[1-9][0-9]*$/u.test(String(receipt.run.attempt)) || !exactKeys(receipt.source, ["head", "tree"]) || !/^[0-9a-f]{40}$/u.test(receipt.source.head) || !/^[0-9a-f]{40}$/u.test(receipt.source.tree) || !exactKeys(receipt.runner, ["platform", "arch", "release", "pid", "ppid", "executable"]) || !fileState(receipt.runner.executable) || !Array.isArray(receipt.ownedPaths) || receipt.ownedPaths.length !== 12 || !receipt.ownedPaths.every((entry) => exactKeys(entry, ["path", "parents", "file"]) && typeof entry.path === "string" && Array.isArray(entry.parents) && entry.parents.length > 0 && fileState(entry.file)) || !Array.isArray(receipt.registries) || receipt.registries.length !== 2 || !receipt.registries.every((entry) => exactKeys(entry, ["path", "state"]) && typeof entry.path === "string" && entry.state === "ABSENT") || receipt.journal !== "first-custody-journal.json") throw new Error("Private first-custody receipt is invalid.");
const journalSource = await readFile(journal, "utf8");
const journalValue = JSON.parse(journalSource);
const validCommand = (entry) => (exactKeys(entry, ["command", "status", "stdoutSha256", "stderrSha256"]) || exactKeys(entry, ["command", "status", "unavailable", "stdoutSha256", "stderrSha256"])) && Array.isArray(entry.command) && (Number.isSafeInteger(entry.status) || entry.status === null) && (entry.unavailable === undefined || entry.unavailable === true) && /^[0-9a-f]{64}$/u.test(entry.stdoutSha256) && /^[0-9a-f]{64}$/u.test(entry.stderrSha256);
if (!exactKeys(journalValue, ["schema", "private", "commands"]) || journalValue.schema !== "service-lasso.qualification-first-custody-journal.v1" || journalValue.private !== true || !Array.isArray(journalValue.commands) || journalValue.commands.length !== 4 || !journalValue.commands.every(validCommand)) throw new Error("Private first-custody journal is invalid.");
const journalDigest = createHash("sha256").update(journalSource).digest("hex");
const projection = {
  schema: "service-lasso.qualification-first-custody-projection.v1",
  candidate: { head: receipt.source.head, tree: receipt.source.tree },
  platform: receipt.platform,
  run: { id: String(receipt.run.id), attempt: String(receipt.run.attempt) },
  privateInitialReceiptSha256: createHash("sha256").update(receiptSource).digest("hex"),
  privateJournalSha256: journalDigest,
  localValidatorAttestation: { schema: "service-lasso.qualification-local-validator-attestation.v1", validated: true },
};
await writeFile(output, `${JSON.stringify(projection)}\n`, { encoding: "utf8", flag: "wx" });

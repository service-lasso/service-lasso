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
if (receipt?.schema !== "service-lasso.qualification-initial-receipt.v2" || receipt?.private !== true || !/^[0-9a-f]{40}$/u.test(receipt?.source?.head) || !/^[0-9a-f]{40}$/u.test(receipt?.source?.tree) || !["linux", "win32", "darwin"].includes(receipt?.platform) || !Number.isSafeInteger(Number(receipt?.run?.id)) || !Number.isSafeInteger(Number(receipt?.run?.attempt))) throw new Error("Private first-custody receipt is invalid.");
const journalDigest = createHash("sha256").update(await readFile(journal)).digest("hex");
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

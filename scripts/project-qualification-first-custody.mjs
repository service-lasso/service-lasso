import { createHash } from "node:crypto";
import { lstat, open, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`first_custody_${name.toLowerCase()}_missing`);
  return value;
}

const privatePath = path.resolve(required("QUALIFICATION_PRIVATE_INITIAL_RECEIPT_PATH"));
const projectionPath = path.resolve(required("QUALIFICATION_INITIAL_RECEIPT_PATH"));
const source = await readFile(privatePath, "utf8");
const receipt = JSON.parse(source);
if (!receipt || receipt.schema !== "service-lasso.qualification-initial-receipt.v3" || receipt.private !== true) {
  throw new Error("first_custody_private_receipt_invalid");
}
const exact = (value) => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const inventory = receipt.source?.inventory;
if (!Array.isArray(inventory) || inventory.length === 0 || !inventory.every((entry) => exact(entry.sha256) && exact(entry.gitBlob) && Number.isSafeInteger(entry.size) && entry.size >= 0)) {
  throw new Error("first_custody_source_inventory_invalid");
}
const native = receipt.ownedPaths;
if (!Array.isArray(native) || native.length !== 19 || !native.every((entry) => exact(entry.file?.sha256))) {
  throw new Error("first_custody_native_inventory_invalid");
}
const digest = (value) => createHash("sha256").update(value).digest("hex");
const projection = {
  schema: "service-lasso.qualification-first-custody-projection.v1",
  retainedContent: "closed_digest_projection",
  platform: receipt.platform,
  run: receipt.run,
  source: {
    head: receipt.source.head,
    tree: receipt.source.tree,
    status: receipt.source.status,
    trackedFileCount: inventory.length,
    inventorySha256: digest(JSON.stringify(inventory)),
    nativeFileCount: native.length,
    nativeInventorySha256: digest(JSON.stringify(native.map((entry) => ({ sha256: entry.file.sha256, size: entry.file.size })))),
  },
  firstRecordSha256: digest(source),
  journalSha256: receipt.journalSha256,
  terminal: "UNRESOLVED",
};
const parent = path.dirname(projectionPath);
const info = await lstat(privatePath);
if (!info.isFile() || info.isSymbolicLink()) throw new Error("first_custody_private_receipt_unsafe");
const handle = await open(projectionPath, "wx", 0o600);
try { await handle.writeFile(`${JSON.stringify(projection)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }

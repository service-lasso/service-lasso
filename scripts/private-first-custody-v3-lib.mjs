import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { strictJson } from "./consume-admin-trusted-unlock-receipt.mjs";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const SHA = /^[0-9a-f]{40}$/u;
export const DIGEST = /^[0-9a-f]{64}$/u;
export const exact = (value, keys) => !!value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
export function requireStrictJson(source, label) {
  if (!strictJson(source)) throw new Error(label + "_duplicate_or_malformed_json");
  return JSON.parse(source);
}
export function inside(child, root) {
  const resolvedChild = path.resolve(child), resolvedRoot = path.resolve(root);
  return resolvedChild === resolvedRoot || resolvedChild.startsWith(resolvedRoot + path.sep);
}
export async function regularClosedFile(file, root) {
  const target = path.resolve(file), boundary = path.resolve(root);
  if (!inside(target, boundary)) throw new Error("first_custody_boundary_escape");
  const before = await lstat(target);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("first_custody_nonregular_or_reparse_file");
  for (let cursor = path.dirname(target); ; cursor = path.dirname(cursor)) {
    const entry = await lstat(cursor);
    if (entry.isSymbolicLink()) throw new Error("first_custody_reparse_parent");
    if (cursor === boundary) break;
    if (cursor === path.dirname(cursor)) throw new Error("first_custody_parent_boundary_escape");
  }
  const bytes = await readFile(target);
  const after = await lstat(target);
  if (before.size !== after.size || before.ino !== after.ino || after.isSymbolicLink()) {
    throw new Error("first_custody_file_changed_during_hash");
  }
  return { size: bytes.length, sha256: sha256(bytes) };
}

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { strictJson } from "./consume-admin-trusted-unlock-receipt.mjs";

const execute = promisify(execFile);
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const SHA = /^[0-9a-f]{40}$/u;
export const DIGEST = /^[0-9a-f]{64}$/u;
export const exact = (value, keys) => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
export function requireStrictJson(source, label) { if (!strictJson(source)) throw new Error(label + "_duplicate_or_malformed_json"); return JSON.parse(source); }
export function inside(child, root) { const relative = path.relative(path.resolve(root), path.resolve(child)); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
function identity(entry) { return { dev: Number.isSafeInteger(entry.dev) ? entry.dev : null, ino: Number.isSafeInteger(entry.ino) ? entry.ino : null, size: entry.size, mtimeMs: entry.mtimeMs }; }
function sameIdentity(a, b) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs; }
async function windowsAcl(directory) {
  const icacls = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "icacls.exe");
  const { stdout, stderr } = await execute(icacls, [directory], { windowsHide: true, maxBuffer: 256 * 1024 });
  const raw = Buffer.concat([Buffer.from(stdout, "utf8"), Buffer.from(stderr, "utf8")]);
  if (!raw.length || (/\bEveryone:|\bBUILTIN\\Users:/iu.test(stdout) && /\((?:F|M|W)\)/u.test(stdout))) throw new Error("first_custody_windows_acl_not_private");
  return { checked: true, tool: "icacls", rawSha256: sha256(raw) };
}
export async function nonReparseDirectory(directory, boundary) {
  const target = path.resolve(directory), root = path.resolve(boundary); if (!inside(target, root)) throw new Error("first_custody_boundary_escape"); const resolvedRoot = await realpath(root);
  for (let cursor = target; ; cursor = path.dirname(cursor)) {
    const entry = await lstat(cursor);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("first_custody_reparse_parent");
    const resolved = await realpath(cursor); if (!inside(resolved, resolvedRoot)) throw new Error("first_custody_realpath_escape");
    if (cursor === root) return; if (cursor === path.dirname(cursor)) throw new Error("first_custody_parent_boundary_escape");
  }
}
export async function ownership(directory, boundary) {
  await nonReparseDirectory(directory, boundary); const entry = await stat(directory), resolved = await realpath(directory);
  const acl = process.platform === "win32" ? await windowsAcl(resolved) : { checked: true, tool: "posix", rawSha256: null };
  if (process.platform !== "win32" && (entry.mode & 0o077) !== 0) throw new Error("first_custody_acl_not_private");
  return { path: resolved, uid: Number.isSafeInteger(entry.uid) ? entry.uid : null, gid: Number.isSafeInteger(entry.gid) ? entry.gid : null, mode: entry.mode & 0o777, acl, identity: identity(entry) };
}
export async function createExclusiveDirectory(directory, boundary) { const target = path.resolve(directory); if (!inside(target, boundary)) throw new Error("first_custody_owned_root_escape"); if (await lstat(target).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error))) throw new Error("first_custody_owned_root_exists"); await nonReparseDirectory(path.dirname(target), boundary); await mkdir(target, { mode: 0o700 }); return ownership(target, boundary); }
export async function absentLeaf(file, boundary) { const target = path.resolve(file); await nonReparseDirectory(path.dirname(target), boundary); if (await lstat(target).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error))) throw new Error("first_custody_registry_present"); return { path: target, state: "ABSENT", parent: await ownership(path.dirname(target), boundary) }; }
export async function regularClosedFile(file, root) {
  const target = path.resolve(file), boundary = path.resolve(root); if (!inside(target, boundary)) throw new Error("first_custody_boundary_escape"); await nonReparseDirectory(path.dirname(target), boundary);
  const beforePath = await lstat(target); if (!beforePath.isFile() || beforePath.isSymbolicLink()) throw new Error("first_custody_nonregular_or_reparse_file");
  const handle = await open(target, "r"); let bytes;
  try { const before = await handle.stat(); if (!before.isFile()) throw new Error("first_custody_held_not_regular"); const chunks = [], block = Buffer.allocUnsafe(64 * 1024); for (;;) { const { bytesRead } = await handle.read(block, 0, block.length, null); if (!bytesRead) break; chunks.push(Buffer.from(block.subarray(0, bytesRead))); } const after = await handle.stat(); if (!sameIdentity(identity(before), identity(after))) throw new Error("first_custody_held_file_changed_during_hash"); bytes = Buffer.concat(chunks); } finally { await handle.close(); }
  const afterPath = await lstat(target); if (!afterPath.isFile() || afterPath.isSymbolicLink() || !sameIdentity(identity(beforePath), identity(afterPath))) throw new Error("first_custody_path_swapped_during_hash");
  return { size: bytes.length, sha256: sha256(bytes) };
}
export async function exclusiveJson(file, value, root) { await nonReparseDirectory(path.dirname(file), root); const handle = await open(file, "wx", 0o600); try { await handle.writeFile(JSON.stringify(value) + "\n"); await handle.sync(); } finally { await handle.close(); } return regularClosedFile(file, root); }
export async function exclusiveBytes(file, value, root) { await nonReparseDirectory(path.dirname(file), root); const handle = await open(file, "wx", 0o600); try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); } return regularClosedFile(file, root); }

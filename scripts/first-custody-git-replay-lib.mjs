// Replay the retained binary protocol without invoking Git or trusting receipt OIDs.
import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { regularClosedBytes, SHA, sha256 } from "./private-first-custody-v3-lib.mjs";

export function objectId(type, bytes) {
  return createHash("sha1").update(Buffer.from(`${type} ${bytes.length}\0`, "ascii")).update(bytes).digest("hex");
}
export function treeEntries(bytes) {
  const entries = []; let at = 0; const names = new Set();
  while (at < bytes.length) {
    const space = bytes.indexOf(32, at), nul = bytes.indexOf(0, space + 1);
    if (space < at || nul < space || nul + 21 > bytes.length) throw new Error("first_custody_tree_invalid");
    const mode = bytes.subarray(at, space).toString("ascii"), nameBytes = bytes.subarray(space + 1, nul), name = nameBytes.toString("utf8");
    if (!/^(?:100644|100755|40000)$/u.test(mode) || !name || !Buffer.from(name).equals(nameBytes) || /[\/\\\n\r\0]/u.test(name) || [".", "..", ".git"].includes(name) || names.has(name)) throw new Error("first_custody_tree_entry_invalid");
    names.add(name); entries.push({ mode, name, oid: bytes.subarray(nul + 1, nul + 21).toString("hex") }); at = nul + 21;
  }
  return entries;
}
export function replayGit(bytes, expectedHead) {
  let at = 0;
  function next(body) {
    const end = bytes.indexOf(10, at); if (end < 0) throw new Error("first_custody_git_replay_short_header");
    const header = bytes.subarray(at, end).toString("ascii"), match = /^([0-9a-f]{40}) (commit|tree|blob) (0|[1-9][0-9]*)$/u.exec(header);
    if (!match || !Number.isSafeInteger(Number(match[3]))) throw new Error("first_custody_git_replay_header_invalid");
    at = end + 1; const record = { oid: match[1], type: match[2], size: Number(match[3]), body: null };
    if (body) { const stop = at + record.size; if (stop >= bytes.length || bytes[stop] !== 10) throw new Error("first_custody_git_replay_body_invalid"); record.body = bytes.subarray(at, stop); at = stop + 1; if (objectId(record.type, record.body) !== record.oid) throw new Error("first_custody_git_replay_object_hash_invalid"); }
    return record;
  }
  const headInfo = next(false), treeInfo = next(false), commit = next(true), root = next(true);
  if (headInfo.type !== "commit" || headInfo.oid !== expectedHead || commit.type !== "commit" || commit.oid !== headInfo.oid || commit.size !== headInfo.size || treeInfo.type !== "tree" || root.type !== "tree" || root.oid !== treeInfo.oid || root.size !== treeInfo.size || commit.body.subarray(0, 46).toString("ascii") !== `tree ${root.oid}\n`) throw new Error("first_custody_git_replay_head_tree_invalid");
  const pending = [{ ...root, prefix: "" }], tracked = [];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of treeEntries(current.body)) {
      const name = current.prefix + entry.name;
      if (entry.mode === "40000") { const child = next(true); if (child.type !== "tree" || child.oid !== entry.oid) throw new Error("first_custody_git_replay_subtree_invalid"); pending.push({ ...child, prefix: name + "/" }); }
      else tracked.push({ path: name, gitBlob: entry.oid, mode: entry.mode });
    }
  }
  if (!tracked.length || new Set(tracked.map(entry => entry.path)).size !== tracked.length) throw new Error("first_custody_git_replay_inventory_invalid");
  for (const entry of tracked) { const blob = next(true); if (blob.type !== "blob" || blob.oid !== entry.gitBlob) throw new Error("first_custody_git_replay_blob_invalid"); entry.bytes = blob.body; }
  if (at !== bytes.length) throw new Error("first_custody_git_replay_trailing_bytes");
  return { head: headInfo.oid, tree: root.oid, tracked };
}
function parseIndex(bytes) {
  if (bytes.length < 32 || bytes.subarray(0, 4).toString("ascii") !== "DIRC" || ![2, 3].includes(bytes.readUInt32BE(4)) || createHash("sha1").update(bytes.subarray(0, -20)).digest("hex") !== bytes.subarray(-20).toString("hex")) throw new Error("first_custody_index_invalid");
  const count = bytes.readUInt32BE(8), entries = []; let at = 12;
  for (let i = 0; i < count; i++) {
    const start = at; if (at + 62 >= bytes.length - 20) throw new Error("first_custody_index_short");
    const flags = bytes.readUInt16BE(at + 60), mode = bytes.readUInt32BE(at + 24).toString(8), oid = bytes.subarray(at + 40, at + 60).toString("hex");
    if ((flags & 0xf000) !== 0 || !["100644", "100755"].includes(mode)) throw new Error("first_custody_index_stage_or_flags_invalid");
    at += 62; const nul = bytes.indexOf(0, at); if (nul < 0 || nul >= bytes.length - 20) throw new Error("first_custody_index_name_invalid");
    const raw = bytes.subarray(at, nul), name = raw.toString("utf8"); if (!name || !Buffer.from(name).equals(raw) || (flags & 0xfff) !== Math.min(raw.length, 0xfff)) throw new Error("first_custody_index_name_invalid");
    at = start + Math.ceil((nul + 1 - start) / 8) * 8; if (at > bytes.length - 20 || bytes.subarray(nul, at).some(byte => byte !== 0)) throw new Error("first_custody_index_padding_invalid");
    entries.push({ path: name, gitBlob: oid, mode });
  }
  while (at < bytes.length - 20) { if (at + 8 > bytes.length - 20) throw new Error("first_custody_index_extension_invalid"); const signature = bytes.subarray(at, at + 4).toString("ascii"), size = bytes.readUInt32BE(at + 4); if (!/^[A-Z][A-Za-z0-9]{3}$/u.test(signature) || at + 8 + size > bytes.length - 20) throw new Error("first_custody_index_required_extension_unsupported"); at += 8 + size; }
  return entries;
}
export async function gitMetadata(workspace, expected, tracked) {
  const proofs = []; async function held(file) { const bytes = await regularClosedBytes(file, path.parse(file).root); proofs.push({ path: file, size: bytes.length, sha256: sha256(bytes) }); return bytes; }
  const marker = path.join(workspace, ".git"), state = await lstat(marker); let directory;
  if (state.isDirectory() && !state.isSymbolicLink()) directory = await realpath(marker);
  else { const text = (await held(marker)).toString("utf8"); if (!/^gitdir: [^\r\n]+\r?\n?$/u.test(text)) throw new Error("first_custody_git_directory_invalid"); directory = await realpath(path.resolve(workspace, text.trim().slice(8))); }
  let common = directory; const commonFile = path.join(directory, "commondir");
  if (await lstat(commonFile).catch(error => error.code === "ENOENT" ? null : Promise.reject(error))) common = await realpath(path.resolve(directory, (await held(commonFile)).toString("utf8").trim()));
  const headText = (await held(path.join(directory, "HEAD"))).toString("utf8").trim(); let head = headText;
  if (headText.startsWith("ref: ")) { const ref = headText.slice(5); if (!/^refs\/[A-Za-z0-9_./-]+$/u.test(ref) || ref.split("/").some(part => part === ".." || part === "." || !part)) throw new Error("first_custody_head_ref_invalid"); const loose = path.join(common, ref); if (await lstat(loose).catch(error => error.code === "ENOENT" ? null : Promise.reject(error))) head = (await held(loose)).toString("utf8").trim(); else { const matches = (await held(path.join(common, "packed-refs"))).toString("utf8").split(/\r?\n/u).filter(line => line.endsWith(` ${ref}`)); if (matches.length !== 1) throw new Error("first_custody_head_ref_missing"); head = matches[0].split(" ")[0]; } }
  if (!SHA.test(head) || head !== expected) throw new Error("first_custody_current_head_changed");
  const index = parseIndex(await held(path.join(directory, "index"))), wanted = tracked.map(({ path: name, gitBlob, mode }) => ({ path: name, gitBlob, mode })).sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(index.sort((a, b) => a.path.localeCompare(b.path))) !== JSON.stringify(wanted)) throw new Error("first_custody_index_tree_mismatch");
  // Local Git configuration changes are source-input drift, even if HEAD agrees.
  for (const file of new Set([path.join(common, "config"), path.join(directory, "config.worktree")])) if (await lstat(file).catch(error => error.code === "ENOENT" ? null : Promise.reject(error))) await held(file);
  return { directory, common, head, files: proofs };
}

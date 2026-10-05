import path from "node:path";
import { lstat, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { extractZipSafely } from "../dist/runtime/files/safe-zip.js";
import { digest } from "./ga-platform-scope-lib.mjs";
import { assertScopedTarFraming, readScopedTarEntries } from "./scoped-tar-framing-lib.mjs";

// This is Core outer archive preflight, not staged-service transport or CLI
// native TAR grammar. Effective GNU/PAX names are checked before extraction.
export async function preflightScopedCoreTar(bytes, rootName) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 256 * 1024 * 1024 || !/^[A-Za-z0-9._-]+$/u.test(rootName)) throw new Error("Core outer TAR original byte/root budget differs");
  const rows = new Map(), folded = new Set();
  let size = 0, count = 0, failure;
  let expanded;
  try { expanded = gunzipSync(bytes, { maxOutputLength: 512 * 1024 * 1024 }); }
  catch { throw new Error("Core outer TAR gzip/expanded byte budget differs"); }
  const ordinaryEntries = assertScopedTarFraming(expanded);
  const safe = raw => {
    if (typeof raw !== "string" || raw !== raw.normalize("NFC") || Buffer.byteLength(raw) > 4096 || /[\\:\x00-\x1f\x7f]/u.test(raw) || raw.startsWith("/") || raw.split("/").some(part => part === "." || part === ".." || !part)) throw new Error("Core outer TAR path unsafe");
    if (raw !== rootName && !raw.startsWith(`${rootName}/`)) throw new Error("Core outer TAR root differs");
    return raw;
  };
  await readScopedTarEntries(expanded, ordinaryEntries, entry => {
      const authority = ordinaryEntries[count++], effectiveSize = authority?.size;
      let observedSize = 0;
      entry.on("data", chunk => {
        observedSize += chunk.length;
        if (observedSize > 256 * 1024 * 1024) failure ??= new Error("Core outer TAR member byte budget exceeded");
      });
      entry.on("end", () => {
        if (observedSize !== effectiveSize) failure ??= new Error("Core outer TAR observed member byte count differs");
      });
      try {
        if (!authority || authority.type !== entry.type || authority.path !== entry.path) throw new Error("Core outer TAR framing/member identity differs");
        const name = safe(authority.type === "Directory" ? authority.path.replace(/\/$/u, "") : authority.path);
        const key = name.toLowerCase();
        if (rows.has(name) || folded.has(key) || !["File", "Directory", "SymbolicLink", "Link"].includes(entry.type) || !Number.isSafeInteger(effectiveSize) || effectiveSize < 0 || effectiveSize > 256 * 1024 * 1024 || entry.header.size !== effectiveSize || rows.size >= 100_000) throw new Error("Core outer TAR member inventory differs");
        size += effectiveSize;
        if (size > 512 * 1024 * 1024) throw new Error("Core outer TAR expanded byte budget exceeded");
        let target = null;
        if (["SymbolicLink", "Link"].includes(entry.type)) {
          const linkpath = authority.linkpath;
          if (entry.linkpath !== linkpath) throw new Error("Core outer TAR emitted link target interpretation differs");
          if (typeof linkpath !== "string" || !linkpath || /[\\:\x00-\x1f\x7f]/u.test(linkpath) || linkpath.startsWith("/") || effectiveSize !== 0) throw new Error("Core outer TAR link unsafe");
          target = entry.type === "Link" ? safe(linkpath) : safe(path.posix.normalize(path.posix.join(path.posix.dirname(name), linkpath)));
        }
        rows.set(name, { type: entry.type, target }); folded.add(key);
      } catch (error) { failure ??= error; }
      entry.resume();
    }, entry => {
      failure ??= new Error("Core outer TAR ignored member/metadata differs");
      entry.resume();
    }).catch(error => { throw failure ?? error; });
  if (failure) throw failure;
  if (count !== ordinaryEntries.length) throw new Error("Core outer TAR framing/member count differs");
  if (rows.size === 0 || rows.get(rootName)?.type !== "Directory") throw new Error("Core outer TAR complete root directory missing");
  for (const name of rows.keys()) {
    const parts = name.split("/");
    for (let end = 1; end < parts.length; end++) if (rows.get(parts.slice(0, end).join("/"))?.target) throw new Error("Core outer TAR member descends through directory/link alias");
  }
  const resolveLink = (name, seen = new Set()) => {
    if (seen.has(name) || seen.size > 64) throw new Error("Core outer TAR link cycle/depth differs");
    seen.add(name);
    const segments = name.split("/");
    for (let end = 1; end <= segments.length; end++) {
      const prefix = segments.slice(0, end).join("/"), row = rows.get(prefix);
      if (row?.target) return resolveLink(safe(path.posix.join(row.target, ...segments.slice(end))), seen);
    }
    if (!rows.has(name)) throw new Error("Core outer TAR link target absent");
    return rows.get(name);
  };
  for (const [name, row] of rows) if (row.target) {
    const target = resolveLink(name);
    if (row.type === "Link" && target.type !== "File") throw new Error("Core outer TAR hardlink target is not regular");
  }
  return rows;
}

export async function extractScopedCoreArchive(bytes, extractionRoot, platform, rootName, expectedSha256) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 256 * 1024 * 1024 || !/^[a-f0-9]{64}$/u.test(expectedSha256 ?? "") || digest(bytes) !== expectedSha256) throw new Error("Core outer archive original held buffer differs");
  const destination = await lstat(extractionRoot);
  if (!destination.isDirectory() || destination.isSymbolicLink() || (await readdir(extractionRoot)).length !== 0) throw new Error("Core outer archive extraction requires a fresh empty regular directory");
  if (platform === "win32") return extractZipSafely(bytes, extractionRoot, rootName, { rejectUnsafeEntries: true });
  if (platform !== "linux" || process.platform !== "linux") throw new Error("Core outer archive native platform outside scoped policy");
  await preflightScopedCoreTar(bytes, rootName);
  const child = spawn("tar", ["-xzf", "-", "-C", extractionRoot], { shell: false, windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
  let spawnError;
  child.once("error", error => { spawnError = error; });
  const closed = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
  const written = new Promise((resolve, reject) => {
    child.stdin.once("error", reject); child.stdin.once("finish", resolve); child.stdin.end(bytes);
  });
  try { await written; }
  catch {
    child.kill(); await closed;
    throw new Error("Core outer TAR original stdin/EOF transfer failed");
  }
  const exit = await closed;
  if (spawnError || exit.code !== 0 || exit.signal !== null) throw new Error("Core outer TAR native extraction did not close successfully");
}

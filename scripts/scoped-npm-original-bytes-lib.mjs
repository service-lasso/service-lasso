import { gunzipSync } from "node:zlib";
import { digest } from "./ga-platform-scope-lib.mjs";
import { assertNames } from "./scoped-release-evidence-lib.mjs";
import { assertScopedTarFraming, readScopedTarEntries } from "./scoped-tar-framing-lib.mjs";

// Read the registry's original package tarball without materialization, imports,
// lifecycle scripts or native execution. Tool bytes remain opaque retained files.
export async function verifyNpmOriginalToolBytes(tarball, manifestBytes, originals) {
  if (!Buffer.isBuffer(tarball) || !Buffer.isBuffer(manifestBytes) || !(originals instanceof Map)) throw new Error("npm original byte custody missing");
  if (tarball.length === 0 || tarball.length > 256 * 1024 * 1024) throw new Error("npm archive compressed byte budget exceeded");
  const archiveBytes = gunzipSync(tarball, { maxOutputLength: 512 * 1024 * 1024 });
  const ordinaryEntries = assertScopedTarFraming(archiveBytes);
  const wanted = new Map([...originals].map(([name, bytes]) => [`package/${name}`, bytes]));
  wanted.set("package/operator-tools/manifest.json", manifestBytes);
  const observed = new Map(), seen = new Set();
  let expanded = 0, count = 0, failure;
  await readScopedTarEntries(archiveBytes, ordinaryEntries, entry => {
      const authority = ordinaryEntries[count];
      const name = authority?.path, effectiveSize = authority?.size;
      count++;
      if (count > 100_000 || typeof name !== "string" || name !== entry.path || authority?.type !== entry.type || name.includes("\\") || name.startsWith("/") || name.split("/").some(part => part === "." || part === "..") || !name.startsWith("package/") || seen.has(name) || !["File", "Directory"].includes(entry.type) || !Number.isSafeInteger(effectiveSize) || effectiveSize < 0 || effectiveSize > 256 * 1024 * 1024 || entry.header.size !== effectiveSize) failure ??= new Error("npm archive member safety/inventory differs");
      seen.add(name);
      expanded += effectiveSize;
      if (expanded > 512 * 1024 * 1024) failure ??= new Error("npm expanded archive byte budget exceeded");
      if (typeof name === "string" && name.startsWith("package/operator-tools/") && entry.type === "File" && !wanted.has(name)) failure ??= new Error("npm original operator inventory expands");
      const parts = []; let size = 0;
      entry.on("data", chunk => {
        size += chunk.length;
        if (size > 256 * 1024 * 1024) failure ??= new Error("npm archive member byte budget exceeded");
        if (wanted.has(name) && !failure) parts.push(Buffer.from(chunk));
      });
      entry.on("end", () => {
        if (size !== effectiveSize) failure ??= new Error("npm archive observed member byte count differs");
        if (wanted.has(name)) {
          const bytes = Buffer.concat(parts);
          if (entry.type !== "File" || size !== effectiveSize || !bytes.equals(wanted.get(name))) failure ??= new Error("public npm original operator bytes differ");
          observed.set(name, digest(bytes));
        }
      });
      entry.resume();
    }, entry => {
      failure ??= new Error("npm archive ignored member/metadata differs");
      entry.resume();
    }).catch(error => { throw failure ?? error; });
  if (failure) throw failure;
  if (count !== ordinaryEntries.length) throw new Error("npm archive framing/member count differs");
  assertNames([...observed.keys()], [...wanted.keys()]);
  return observed;
}

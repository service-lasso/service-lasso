import { ZipArchive } from "../dist/runtime/files/safe-zip.js";
import { digest } from "./ga-platform-scope-lib.mjs";
import { assertNames } from "./scoped-release-evidence-lib.mjs";

// Provider metadata transport only: no extraction, service/CLI ZIP grammar or
// public raw custody. Inspect declared inventory/budgets before decompression.
export function readOriginalMetadataArtifact(bytes, expectedNames, expectedDigest) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > 256 * 1024 * 1024 || expectedDigest !== `sha256:${digest(bytes)}`) throw new Error("original metadata artifact body differs");
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0 || bytes.readUInt16LE(end + 8) !== bytes.readUInt16LE(end + 10)) throw new Error("metadata artifact directory framing differs");
  const count = bytes.readUInt16LE(end + 10), start = bytes.readUInt32LE(end + 16), length = bytes.readUInt32LE(end + 12);
  if (count !== expectedNames.length || count === 0 || count >= 0xffff || start + length !== end) throw new Error("metadata artifact declared inventory differs");
  const names = [], sizes = new Map(), intervals = [];
  let position = start;
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || bytes.readUInt32LE(position) !== 0x02014b50) throw new Error("metadata artifact central member differs");
    const flags = bytes.readUInt16LE(position + 8), method = bytes.readUInt16LE(position + 10), compressed = bytes.readUInt32LE(position + 20), expanded = bytes.readUInt32LE(position + 24), nameLength = bytes.readUInt16LE(position + 28), extra = bytes.readUInt16LE(position + 30), comment = bytes.readUInt16LE(position + 32), local = bytes.readUInt32LE(position + 42);
    const next = position + 46 + nameLength + extra + comment;
    if (next > end || flags & ~0x0808 || ![0, 8].includes(method) || compressed >= 0xffffffff || expanded > 256 * 1024 * 1024 || bytes.readUInt16LE(position + 34) !== 0 || local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error("metadata artifact member flags/budget/local framing differs");
    const rawName = bytes.subarray(position + 46, position + 46 + nameLength), name = rawName.toString("ascii");
    if (!rawName.equals(Buffer.from(name, "ascii")) || !expectedNames.includes(name) || sizes.has(name)) throw new Error("metadata artifact member name duplicate/unknown");
    const localName = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28), data = local + 30 + localName + localExtra;
    if (bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method || localName !== nameLength || !bytes.subarray(local + 30, local + 30 + localName).equals(rawName) || data + compressed > start) throw new Error("metadata artifact local/central identity differs");
    names.push(name); sizes.set(name, expanded); intervals.push([local, data + compressed]); position = next;
  }
  if (position !== end) throw new Error("metadata artifact central directory expands");
  assertNames(names, expectedNames);
  intervals.sort((a, b) => a[0] - b[0]);
  if (intervals.some((range, index) => index > 0 && range[0] < intervals[index - 1][1])) throw new Error("metadata artifact members overlap");
  const entries = new ZipArchive(bytes).getEntries();
  assertNames(entries.map(entry => entry.entryName), expectedNames);
  const held = new Map();
  for (const entry of entries) {
    const body = entry.getData();
    if (entry.isDirectory || body.length !== sizes.get(entry.entryName)) throw new Error("metadata artifact expanded byte count differs");
    held.set(entry.entryName, body);
  }
  return held;
}

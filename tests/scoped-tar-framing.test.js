import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { verifyNpmOriginalToolBytes } from "../scripts/scoped-npm-original-bytes-lib.mjs";
import { preflightScopedCoreTar } from "../scripts/scoped-core-archive-lib.mjs";

// AC-7G.scoped-tar-parser.R1/R2. Additive finite actual-reader cases; UNEXECUTED
// until different whole-source GO and fresh complete execution-input admission.
function member(name, body = Buffer.alloc(0), type = "0", declaredSize = body.length, linkpath = "") {
  const header = Buffer.alloc(512);
  header.write(name); header.write("0000644\0", 100);
  header.write(declaredSize.toString(8).padStart(11, "0") + "\0", 124);
  header.fill(32, 148, 156); header[156] = type.charCodeAt(0);
  header.write(linkpath, 157);
  header.write("ustar\0", 257); header.write("00", 263);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);
  return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)]);
}
function pax(fields) {
  return Buffer.from(Object.entries(fields).map(([key, value]) => {
    const suffix = ` ${key}=${value}\n`;
    let size = Buffer.byteLength(suffix) + 1;
    while (String(size).length + Buffer.byteLength(suffix) !== size) size = String(size).length + Buffer.byteLength(suffix);
    return `${size}${suffix}`;
  }).join(""));
}
const eof = Buffer.alloc(1024);
const manifest = Buffer.from("opaque manifest"), tool = Buffer.from([255, 254, 0, 1]);
const manifestName = "package/operator-tools/manifest.json";
const toolName = "package/operator-tools/tool.bin";
const originals = new Map([["operator-tools/tool.bin", tool]]);
const npmRaw = () => Buffer.concat([member(manifestName, manifest), member(toolName, tool)]);
const coreRaw = () => Buffer.concat([member("core/", undefined, "5"), member("core/data", tool)]);
const npmRead = raw => verifyNpmOriginalToolBytes(gzipSync(raw), manifest, originals);
const coreRead = raw => preflightScopedCoreTar(gzipSync(raw), "core");

test("#1562 both actual readers reject ignored unknown members and oversized GNU metadata", async () => {
  for (const [read, raw, hidden] of [[npmRead, npmRaw(), "package/operator-tools/undeclared"], [coreRead, coreRaw(), "other-root/hidden"], [coreRead, coreRaw(), "core/../escape"]]) {
    await assert.rejects(read(Buffer.concat([raw, member(hidden, tool, "Z"), eof])), /ignored member\/metadata/);
    const metadata = member("././@LongLink", Buffer.alloc(1024 * 1024 + 1, 97), "L");
    await assert.rejects(read(Buffer.concat([raw, metadata, member(hidden, tool), eof])), /ignored member\/metadata/);
  }
});

test("#1562 complete payloads still require complete original framing and EOF in both readers", async () => {
  for (const [read, raw] of [[npmRead, npmRaw()], [coreRead, coreRaw()]]) {
    await read(Buffer.concat([raw, eof, Buffer.alloc(512 * 18)]));
    for (const malformed of [
      raw, // All member payload/padding complete, no EOF.
      Buffer.concat([raw, Buffer.from([1])]), // Partial next header.
      Buffer.concat([raw, Buffer.alloc(512)]), // Only one EOF block.
      Buffer.concat([raw, eof, Buffer.from([1])]), // Nonzero trailing partial block.
      Buffer.concat([raw, eof, Buffer.concat([Buffer.from([1]), Buffer.alloc(511)])]),
      Buffer.concat([raw, eof, member("after-eof", tool), eof]),
      Buffer.concat([raw, eof, Buffer.alloc(1)]), // Partial zero trailing block.
      Buffer.concat([raw, member("PaxHeader/dangling", pax({ path: "unused" }), "x"), eof]),
    ]) await assert.rejects(read(malformed), /framing\/EOF/);
  }
});

test("#1562 actual npm/Core readers preserve GNU and PAX effective names and sizes", async () => {
  const root = member("core/", undefined, "5");
  for (const type of ["L", "x"]) {
    const metadata = name => member("PaxHeader/name", type === "L" ? Buffer.from(`${name}\0`) : pax({ path: name }), type);
    const result = await npmRead(Buffer.concat([metadata(manifestName), member("short-manifest", manifest), metadata(toolName), member("short-tool", tool), eof]));
    assert.deepEqual([...result.keys()].sort(), [manifestName, toolName].sort());
    const rows = await coreRead(Buffer.concat([root, metadata("core/data"), member("short-data", tool), eof]));
    assert.equal(rows.get("core/data").type, "File");
  }
  // A local size override survives intervening GNU metadata; the raw short
  // header size deliberately differs, so physical raw-size scanning is wrong.
  const extended = name => Buffer.concat([member("PaxHeader/size", pax({ size: tool.length }), "x"), member("././@LongLink", Buffer.from(`${name}\0`), "L"), member("short", tool, "0", 0)]);
  await npmRead(Buffer.concat([member(manifestName, manifest), extended(toolName), eof]));
  await coreRead(Buffer.concat([root, extended("core/data"), eof]));
  // Global size affects the following ordinary member, not intermediary PAX.
  const global = member("PaxHeader/global", pax({ size: tool.length }), "g");
  await npmRead(Buffer.concat([member(manifestName, manifest), global, member("PaxHeader/path", pax({ path: toolName }), "x"), member("short", tool, "0", 0), eof]));
  const rows = await coreRead(Buffer.concat([root, global, member("PaxHeader/path", pax({ path: "core/data" }), "x"), member("short", tool, "0", 0), eof]));
  assert.equal(rows.get("core/data").type, "File");
  for (const metadata of [member("././@LongLink", Buffer.from("data\0"), "K"), member("PaxHeader/link", pax({ linkpath: "data" }), "x")]) {
    const links = await coreRead(Buffer.concat([coreRaw(), metadata, member("core/alias", undefined, "2", 0, "fallback"), eof]));
    assert.deepEqual(links.get("core/alias"), { type: "SymbolicLink", target: "core/data" });
  }
});

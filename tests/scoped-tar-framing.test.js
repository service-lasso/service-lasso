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

test("#1562 physical metadata bound survives pending local and global PAX size in both actual readers", async () => {
  for (const [read, prefix, name] of [[npmRead, member(manifestName, manifest), toolName], [coreRead, member("core/", undefined, "5"), "core/data"]]) {
    for (const pendingType of ["x", "g"]) {
      const pending = member("PaxHeader/pending", pax({ size: tool.length }), pendingType);
      for (const type of ["L", "N", "K", "x", "X", "g"]) {
        const content = ["L", "N", "K"].includes(type) ? Buffer.from(`${name}\0`) : pax({ path: name });
        const oversized = Buffer.concat([content, Buffer.alloc(1024 * 1024 + 1 - content.length, 97)]);
        await assert.rejects(read(Buffer.concat([prefix, pending, member("PaxHeader/oversized", oversized, type), member(name, tool), eof])), /physical byte budget/);
      }
      // Exact physical bound is supported, including a pending small size.
      const nameBody = Buffer.from(`${name}\0`);
      const bounded = Buffer.concat([nameBody, Buffer.alloc(1024 * 1024 - nameBody.length, 97)]);
      await read(Buffer.concat([prefix, pending, member("././@LongLink", bounded, "L"), member("short", tool, "0", 0), eof]));
    }
  }
});

test("#1562 local PAX size overrides global in both actual readers without losing original byte checks", async () => {
  for (const globalSize of [4, 1024 * 1024]) {
    const global = member("PaxHeader/global", pax({ size: globalSize }), "g");
    const local = (name, body) => Buffer.concat([member("PaxHeader/local", pax({ size: body.length, path: name }), "x"), member("short", body, "0", 0)]);
    const npm = await npmRead(Buffer.concat([global, local(manifestName, manifest), local(toolName, tool), eof]));
    assert.deepEqual([...npm.keys()].sort(), [manifestName, toolName].sort());
    const rows = await coreRead(Buffer.concat([member("core/", undefined, "5"), global, local("core/data", manifest), local("core/second", tool), eof]));
    assert.equal(rows.get("core/data").type, "File");
    assert.equal(rows.get("core/second").type, "File");
    const substituted = Buffer.from(manifest); substituted[0] ^= 1;
    await assert.rejects(npmRead(Buffer.concat([global, local(manifestName, substituted), local(toolName, tool), eof])), /original operator bytes/);
  }
});

test("#1562 effective ordinary member budget cannot be reduced by conflicting global PAX size", async () => {
  for (const [read, prefix, name] of [[npmRead, member(manifestName, manifest), toolName], [coreRead, member("core/", undefined, "5"), "core/data"]]) {
    const global = member("PaxHeader/global", pax({ size: 4 }), "g");
    const oversized = member("PaxHeader/local", pax({ size: 256 * 1024 * 1024 + 1 }), "x");
    await assert.rejects(read(Buffer.concat([prefix, global, oversized, member(name, tool), eof])), /framing\/EOF/);
    // Local state is consumed once; the following member again uses global.
    const smallLocal = member("PaxHeader/local", pax({ size: 4 }), "x");
    const largeGlobal = member("PaxHeader/global", pax({ size: 256 * 1024 * 1024 + 1 }), "g");
    await assert.rejects(read(Buffer.concat([prefix, largeGlobal, smallLocal, member(name, tool), member(`${name}-second`, tool), eof])), /framing\/EOF/);
  }
});

test("#1562 Core rejects misleading emitted global targets under unchanged safety policy", async () => {
  for (const type of ["1", "2"]) {
    const target = type === "1" ? "core/data" : "data";
    for (const localType of ["x", "K"]) {
      const global = member("PaxHeader/global", pax({ path: "other-root/ignored", linkpath: "../outside", size: 4 }), "g");
      const localTarget = member("PaxHeader/target", localType === "x" ? pax({ linkpath: target }) : Buffer.from(`${target}\0`), localType);
      const localSize = member("PaxHeader/size", pax({ size: 0 }), "x");
      await assert.rejects(coreRead(Buffer.concat([coreRaw(), global, localTarget, localSize, member("core/alias", undefined, type, 0, "fallback"), eof])), /emitted link target interpretation/);
    }
    const safeGlobal = member("PaxHeader/global", pax({ linkpath: target, size: 4 }), "g");
    for (const unsafe of ["../outside", "/outside", "core/../outside", "bad\\target", "bad:target"]) {
      const local = member("PaxHeader/local", pax({ linkpath: unsafe, size: 0 }), "x");
      await assert.rejects(coreRead(Buffer.concat([coreRaw(), safeGlobal, local, member("core/alias", undefined, type, 0, target), eof])));
    }
    // A safe global target cannot hide an unsafe authoritative raw target.
    const globalTargetOnly = member("PaxHeader/global", pax({ linkpath: target }), "g");
    await assert.rejects(coreRead(Buffer.concat([coreRaw(), globalTargetOnly, member("core/alias", undefined, type, 0, "../outside"), eof])));
    // A global zero cannot conceal the effective local nonzero link body.
    const globalZero = member("PaxHeader/global", pax({ size: 0, linkpath: target }), "g");
    // Original ordering is retained; R5 additionally covers global-zero first.
    const localBody = member("PaxHeader/local", pax({ size: 4, linkpath: target }), "x");
    await assert.rejects(coreRead(Buffer.concat([coreRaw(), localBody, globalZero, member("core/alias", tool, type, 0, target), eof])), /link unsafe/);
  }
  const globalSafe = member("PaxHeader/global", pax({ linkpath: "data" }), "g");
  const self = member("PaxHeader/local", pax({ linkpath: "alias" }), "x");
  await assert.rejects(coreRead(Buffer.concat([coreRaw(), globalSafe, self, member("core/alias", undefined, "2", 0, "data"), eof])), /emitted link target interpretation/);
  const dataTarget = member("PaxHeader/local", pax({ linkpath: "data" }), "x");
  await assert.rejects(coreRead(Buffer.concat([coreRaw(), globalSafe, dataTarget, member("core/alias", undefined, "2", 0, "data"), member("core/alias/child", tool), eof])), /descends through/);
});

// R5/R6 additional actual-reader cases, SOURCE_UNRUN. No native equivalence.
test("#1562 pending zero or large ordinary sizes cannot control bounded intermediary dispatch", async () => {
  for (const [read, prefix, name] of [[npmRead, member(manifestName, manifest), toolName], [coreRead, member("core/", undefined, "5"), "core/data"]]) {
    for (const pendingType of ["g", "x"]) for (const pendingSize of [0, 1024 * 1024 + 1]) {
      for (const metadataType of ["L", "N", "x", "X"]) {
        const pending = member("PaxHeader/pending", pax({ size: pendingSize }), pendingType);
        const nameMetadata = member("PaxHeader/name", ["L", "N"].includes(metadataType) ? Buffer.from(`${name}\0`) : pax({ path: name }), metadataType);
        const finalSize = member("PaxHeader/final-size", pax({ size: tool.length }), "x");
        await read(Buffer.concat([prefix, pending, nameMetadata, finalSize, member("short", tool, "0", 0), eof]));
        const wrong = Buffer.from(tool); wrong[0] ^= 1;
        if (read === npmRead) await assert.rejects(read(Buffer.concat([prefix, pending, nameMetadata, finalSize, member("short", wrong, "0", 0), eof])), /original operator bytes/);
      }
    }
  }
  for (const pendingSize of [0, 1024 * 1024 + 1]) for (const metadataType of ["K", "x"]) {
    const pending = member("PaxHeader/pending", pax({ size: pendingSize }), "x");
    const link = member("PaxHeader/target", metadataType === "K" ? Buffer.from("data\0") : pax({ linkpath: "data" }), metadataType);
    const finalSize = member("PaxHeader/final", pax({ size: 0 }), "x");
    const rows = await coreRead(Buffer.concat([coreRaw(), pending, link, finalSize, member("core/alias", undefined, "2", 0, "fallback"), eof]));
    assert.deepEqual(rows.get("core/alias"), { type: "SymbolicLink", target: "core/data" });
  }
});

test("#1562 Core rejects every known emitted target disagreement before original extraction", async () => {
  for (const type of ["1", "2"]) {
    const target = type === "1" ? "core/data" : "data";
    for (const alternate of ["../outside", "/outside", type === "1" ? "core/second" : "second", type === "1" ? "core/alias" : "alias", type === "1" ? "core/absent" : "absent"]) {
      const global = member("PaxHeader/global", pax({ linkpath: alternate, size: 0 }), "g");
      for (const localType of [null, "x", "K"]) {
        const local = localType === null ? Buffer.alloc(0) : member("PaxHeader/local", localType === "K" ? Buffer.from(`${target}\0`) : pax({ linkpath: target, size: 0 }), localType);
        await assert.rejects(coreRead(Buffer.concat([coreRaw(), member("core/second", tool), global, local, member("core/alias", undefined, type, 0, target), eof])), /emitted link target interpretation/);
      }
    }
    // Matching actual/local interpretations retain legitimate bounded metadata.
    const global = member("PaxHeader/global", pax({ linkpath: target, size: 0 }), "g");
    const local = member("PaxHeader/local", pax({ linkpath: target, size: 0 }), "x");
    const rows = await coreRead(Buffer.concat([coreRaw(), global, local, member("core/alias", undefined, type, 0, target), eof]));
    assert.equal(rows.get("core/alias").target, "core/data");
  }
  // With agreement, existing graph rejection remains independently exercised.
  for (const target of ["alias", "absent"]) {
    const local = member("PaxHeader/local", pax({ linkpath: target }), "x");
    await assert.rejects(coreRead(Buffer.concat([coreRaw(), local, member("core/alias", undefined, "2", 0, target), eof])), target === "alias" ? /cycle/ : /target absent/);
  }
});

test("#1562 framing-driven decoder retains strict invalid-header rejection", async () => {
  for (const [read, prefix, name] of [[npmRead, npmRaw(), "package/extra"], [coreRead, coreRaw(), "core/extra"]]) {
    const invalid = [member("", tool), member(name, tool, "0", tool.length, "forbidden"), member(name, undefined, "2", 0, "")];
    const checksum = member(name, tool); checksum[148] ^= 1; invalid.push(checksum);
    for (const entry of invalid) await assert.rejects(read(Buffer.concat([prefix, entry, eof])), /framing\/EOF/);
  }
});

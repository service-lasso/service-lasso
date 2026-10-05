import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import { verifyNpmOriginalToolBytes } from "../scripts/scoped-npm-original-bytes-lib.mjs";
import { preflightScopedCoreTar } from "../scripts/scoped-core-archive-lib.mjs";
import { fixtureTar } from "./fixtures/protected-operator-cli.mjs";

// SPEC-007 AC-7G.scoped-tar-parser. SOURCE UNEXECUTED until whole-source
// independent review and new complete-input admission. Opaque data only.
function coreArchive() {
  const raw = gunzipSync(fixtureTar([["core/", Buffer.alloc(0)], ["core/data", Buffer.from("held data")]]));
  raw[156] = 53; // Turn the first zero-sized USTAR entry into a directory.
  raw.fill(32, 148, 156);
  const sum = raw.subarray(0, 512).reduce((total, byte) => total + byte, 0);
  raw.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return gzipSync(raw);
}

test("#1562 locked tar ESM API consumes both actual scoped reader paths", async () => {
  const manifest = Buffer.from('{"opaque":"original"}');
  const tool = Buffer.from([0xff, 0xfe, 0, 1]);
  const originals = new Map([["operator-tools/service-lassoctl/candidate.json", tool]]);
  const entries = [["package/operator-tools/manifest.json", manifest], ["package/operator-tools/service-lassoctl/candidate.json", tool]];
  const result = await verifyNpmOriginalToolBytes(fixtureTar(entries), manifest, originals);
  assert.deepEqual([...result.keys()].sort(), entries.map(([name]) => name).sort());
  const rows = await preflightScopedCoreTar(coreArchive(), "core");
  assert.deepEqual([...rows], [["core", { type: "Directory", target: null }], ["core/data", { type: "File", target: null }]]);

  await assert.rejects(verifyNpmOriginalToolBytes(fixtureTar([...entries, ["package/../escape", "bad"]]), manifest, originals), /safety\/inventory/);
  await assert.rejects(verifyNpmOriginalToolBytes(fixtureTar([entries[0], [entries[1][0], Buffer.from([0xfe, 0xff, 0, 1])]]), manifest, originals), /original operator bytes/);
  await assert.rejects(verifyNpmOriginalToolBytes(fixtureTar([...entries, entries[1]]), manifest, originals), /safety\/inventory/);
  const truncated = gzipSync(gunzipSync(fixtureTar(entries)).subarray(0, 513));
  await assert.rejects(verifyNpmOriginalToolBytes(truncated, manifest, originals));
  await assert.rejects(preflightScopedCoreTar(gzipSync(gunzipSync(coreArchive()).subarray(0, 1025)), "core"));
  await assert.rejects(preflightScopedCoreTar(fixtureTar([["../escape", "bad"]]), "core"), /path unsafe/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageLock = JSON.parse(
  await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
);

test("development dependency replacements resolve to the reviewed safe boundaries", () => {
  assert.equal(
    packageLock.packages["node_modules/image-size"].link,
    true,
    "image-size must resolve to the fail-closed workspace replacement",
  );
  assert.equal(
    packageLock.packages["packages/image-size-safe"].version,
    "2.0.3",
  );
  assert.equal(
    packageLock.packages["node_modules/serialize-javascript"].version,
    "7.1.0",
  );
});

test("image dimension parsing fails closed instead of accepting attacker-controlled formats", async () => {
  const imageSize = await import("image-size");
  assert.deepEqual(imageSize.types, []);
  assert.throws(
    () => imageSize.imageSize(new Uint8Array([0x69, 0x63, 0x6e, 0x73])),
    /image dimension parsing is disabled/i,
  );

  const fromFile = await import("image-size/fromFile");
  await assert.rejects(
    fromFile.imageSizeFromFile("untrusted.icns"),
    /image dimension parsing is disabled/i,
  );
});

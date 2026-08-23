import test from "node:test";
import assert from "node:assert/strict";
import { findSha256InChecksumFile } from "../dist/runtime/setup/acquire.js";

const selectedAsset = "secretsbroker-linux.tar.gz";
const siblingAsset = "service.json";
const checksumAsset = "SHA256SUMS.txt";
const selectedDigest = "1".repeat(64);
const siblingDigest = "2".repeat(64);
const releaseAssets = [selectedAsset, siblingAsset, checksumAsset];

test("release checksum parser accepts one exact direct entry per released asset", () => {
  const content = `${selectedDigest}  ${selectedAsset}\n${siblingDigest}  ${siblingAsset}\n`;
  assert.equal(findSha256InChecksumFile(content, selectedAsset, checksumAsset, releaseAssets), selectedDigest);
});

test("release checksum parser rejects ambiguous or redirected evidence", () => {
  const cases = [
    {
      name: "duplicate",
      content: `${selectedDigest}  ${selectedAsset}\n${selectedDigest}  ${selectedAsset}\n`,
      expected: /duplicate entry/i,
    },
    {
      name: "unexpected",
      content: `${selectedDigest}  ${selectedAsset}\n${siblingDigest}  unlisted.zip\n`,
      expected: /unexpected entry/i,
    },
    {
      name: "forward-slash redirect",
      content: `${selectedDigest}  nested/${selectedAsset}\n`,
      expected: /redirected entry/i,
    },
    {
      name: "backslash redirect",
      content: `${selectedDigest}  nested\\${selectedAsset}\n`,
      expected: /redirected entry/i,
    },
    {
      name: "malformed",
      content: `not-a-checksum  ${selectedAsset}\n`,
      expected: /invalid entry/i,
    },
    {
      name: "missing selected asset",
      content: `${siblingDigest}  ${siblingAsset}\n`,
      expected: /did not contain an entry/i,
    },
  ];

  for (const fixture of cases) {
    assert.throws(
      () => findSha256InChecksumFile(fixture.content, selectedAsset, checksumAsset, releaseAssets),
      fixture.expected,
      fixture.name,
    );
  }
});

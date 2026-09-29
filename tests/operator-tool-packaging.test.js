import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertExactToolRelease, stageOperatorTools } from "../scripts/operator-tool-packaging-lib.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const assets = ["darwin-amd64", "darwin-arm64", "linux-amd64", "win32-amd64"].map((platform) => ({ platform, name: `tool-${platform}.tar.gz`, sha256: hash(platform) }));
const release = { repository: "service-lasso/service-lasso-tui", tag: "candidate-2026.9.29-f33ba22", targetCommit: "f33ba22be3ccf97cec03b3ad5254abbe80c6cfa0", checksumManifest: { name: "SHA256SUMS.txt", sha256: "" }, assets };

test("operator tools stage only checksum-verified immutable release bytes", async () => {
  const sums = Buffer.from(assets.map((asset) => `${asset.sha256}  ${asset.name}`).join("\n") + "\n");
  release.checksumManifest.sha256 = hash(sums);
  const root = await mkdtemp(path.join(os.tmpdir(), "operator-tools-"));
  try {
    const fetchImpl = async (url) => {
      const name = new URL(url).pathname.split("/").at(-1);
      const body = name === "SHA256SUMS.txt" ? sums : Buffer.from(assets.find((asset) => asset.name === name)?.platform ?? "");
      return new Response(body, { status: 200 });
    };
    const manifest = await stageOperatorTools({ artifactRoot: root, fetchImpl, release });
    assert.equal(manifest.tools[0].command, "service-lassoctl");
    assert.equal(manifest.tools[0].status, "unavailable");
    assert.equal(manifest.tools[1].assets.length, 4);
    assert.equal(await readFile(path.join(root, "operator-tools", "service-lasso-tui", assets[0].name), "utf8"), assets[0].platform);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("operator tool identity rejects incomplete platform inventory", () => {
  assert.throws(() => assertExactToolRelease({ ...release, assets: release.assets.slice(1) }), /incomplete/u);
});

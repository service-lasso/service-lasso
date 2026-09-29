import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertExactCliRelease, assertExactToolRelease, stageOperatorTools } from "../scripts/operator-tool-packaging-lib.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const assets = ["darwin-amd64", "darwin-arm64", "linux-amd64", "win32-amd64"].map((platform) => ({ platform, name: `tool-${platform}.tar.gz`, sha256: hash(platform) }));
const release = { repository: "service-lasso/service-lasso-tui", tag: "candidate-2026.9.30-9ac25a1", targetCommit: "9ac25a1bb8c63d9f564743e7ee0c8956304b1db3", checksumManifest: { name: "SHA256SUMS.txt", sha256: "" }, candidateManifest: { name: "candidate-manifest.json", sha256: hash("candidate") }, assets };
const cliRelease = { repository: "service-lasso/service-lasso-cli", tag: "cli-v0.1.0-dev.1234567-candidate-1234567", targetCommit: "1234567890123456789012345678901234567890", asset: { name: "service-lassoctl-0.1.0-dev.1234567.tgz", sha256: hash("cli") }, checksumManifest: { name: "SHA256SUMS.txt", sha256: hash(Buffer.from(`${hash("cli")}  service-lassoctl-0.1.0-dev.1234567.tgz\n`)) }, candidateManifest: { name: "candidate.json", sha256: hash("candidate-cli") } };

test("operator tools stage only checksum-verified immutable release bytes", async () => {
  const sums = Buffer.from(assets.map((asset) => `${asset.sha256}  ${asset.name}`).join("\n") + "\n");
  release.checksumManifest.sha256 = hash(sums);
  const root = await mkdtemp(path.join(os.tmpdir(), "operator-tools-"));
  try {
    const fetchImpl = async (url) => {
		const parsed = new URL(url);
		if (parsed.hostname === "api.github.com") {
			const cli = parsed.pathname.includes("service-lasso-cli");
			const listed = cli ? [cliRelease.asset, cliRelease.checksumManifest, cliRelease.candidateManifest] : [...assets, release.checksumManifest, release.candidateManifest];
			return Response.json({ tag_name: cli ? cliRelease.tag : release.tag, target_commitish: cli ? cliRelease.targetCommit : release.targetCommit, prerelease: true, draft: false, assets: listed.map((asset) => ({ name: asset.name, digest: `sha256:${asset.sha256}` })) });
		}
		const name = parsed.pathname.split("/").at(-1);
      const body = name === "SHA256SUMS.txt" ? (new URL(url).pathname.includes("service-lasso-cli") ? Buffer.from(`${hash("cli")}  ${cliRelease.asset.name}\n`) : sums) : Buffer.from(assets.find((asset) => asset.name === name)?.platform ?? (name === cliRelease.asset.name ? "cli" : ""));
      return new Response(body, { status: 200 });
    };
    const manifest = await stageOperatorTools({ artifactRoot: root, fetchImpl, release, cliRelease });
    assert.equal(manifest.tools[0].command, "service-lassoctl");
    assert.equal(manifest.tools[0].status, "available");
    assert.equal(manifest.tools[1].assets.length, 4);
    assert.equal(await readFile(path.join(root, "operator-tools", "service-lasso-tui", assets[0].name), "utf8"), assets[0].platform);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("operator tool identity rejects incomplete platform inventory", () => {
  assert.throws(() => assertExactToolRelease({ ...release, assets: release.assets.slice(1) }), /incomplete/u);
  assert.throws(() => assertExactCliRelease({ ...cliRelease, repository: "other/cli" }), /identity/u);
  assert.throws(() => assertExactCliRelease({ ...cliRelease, tag: "latest" }), /identity/u);
});

test("operator tools reject duplicate or mismatched GitHub release inventory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "operator-tools-duplicate-"));
  try {
    const duplicateFetch = async () => Response.json({ tag_name: release.tag, target_commitish: release.targetCommit, prerelease: true, draft: false, assets: [{ name: assets[0].name, digest: `sha256:${assets[0].sha256}` }, { name: assets[0].name, digest: `sha256:${assets[0].sha256}` }, ...assets.slice(1).map((asset) => ({ name: asset.name, digest: `sha256:${asset.sha256}` })), { name: release.checksumManifest.name, digest: `sha256:${release.checksumManifest.sha256}` }, { name: release.candidateManifest.name, digest: `sha256:${release.candidateManifest.sha256}` }] });
    await assert.rejects(stageOperatorTools({ artifactRoot: root, fetchImpl: duplicateFetch, release }), /duplicate|inventory/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

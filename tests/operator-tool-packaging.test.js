import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertExactCliRelease, assertExactToolRelease, CURRENT_CLI_RELEASE, CURRENT_TUI_RELEASE, bootstrapReleaseMetadataToken, consumeReleaseMetadataToken, operatorToolFailureDiagnostic, takeBootstrappedReleaseMetadataToken, stageOperatorTools, verifyRetainedOperatorTools } from "../scripts/operator-tool-packaging-lib.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const assets = ["darwin-amd64", "darwin-arm64", "linux-amd64", "win32-amd64"].map((platform) => ({ platform, name: `tool-${platform}.tar.gz`, sha256: hash(platform) }));
const tuiSums = Buffer.from(assets.map((asset) => `${asset.sha256}  ${asset.name}`).join("\n") + "\n");
const tuiCandidate = Buffer.from(JSON.stringify({ schemaVersion: 1, kind: "develop-prerelease-candidate", source: { repository: "service-lasso/service-lasso-tui", commit: "9ac25a1bb8c63d9f564743e7ee0c8956304b1db3" }, release: { tag: "candidate-2026.9.30-9ac25a1", prerelease: true }, checksumManifest: { name: "SHA256SUMS.txt", sha256: hash(tuiSums) }, assets }));
const release = { repository: "service-lasso/service-lasso-tui", tag: "candidate-2026.9.30-9ac25a1", targetCommit: "9ac25a1bb8c63d9f564743e7ee0c8956304b1db3", checksumManifest: { name: "SHA256SUMS.txt", sha256: hash(tuiSums) }, candidateManifest: { name: "candidate-manifest.json", sha256: hash(tuiCandidate) }, assets };
const cliCandidate = Buffer.from(JSON.stringify({ schemaVersion: 1, candidateTag: "cli-v0.1.0-dev.1234567-candidate-1234567", source: { repository: "service-lasso/service-lasso-cli", commit: "1234567890123456789012345678901234567890" }, package: { command: "service-lassoctl", node: ">=22.12.0" }, platforms: ["win32", "linux", "darwin"], assets: [{ name: "service-lassoctl-0.1.0-dev.1234567.tgz", sha256: hash("cli") }] }));
const cliSums = Buffer.from(`${hash("cli")}  service-lassoctl-0.1.0-dev.1234567.tgz\n${hash(cliCandidate)}  candidate.json\n`);
const cliRelease = { repository: "service-lasso/service-lasso-cli", tag: "cli-v0.1.0-dev.1234567-candidate-1234567", targetCommit: "1234567890123456789012345678901234567890", asset: { name: "service-lassoctl-0.1.0-dev.1234567.tgz", sha256: hash("cli") }, checksumManifest: { name: "SHA256SUMS.txt", sha256: hash(cliSums) }, candidateManifest: { name: "candidate.json", sha256: hash(cliCandidate) }, supportedPlatforms: ["win32", "linux", "darwin"] };

test("operator tools stage only checksum-verified immutable release bytes", async () => {
  const sums = tuiSums;
  const root = await mkdtemp(path.join(os.tmpdir(), "operator-tools-"));
  const downloadHosts = [];
  const metadataAuthorization = [];
  const assetAuthorization = [];
  try {
    const fetchImpl = async (url, options = {}) => {
		const parsed = new URL(url);
		if (parsed.hostname === "api.github.com" && parsed.pathname.includes("/releases/assets/")) {
      assetAuthorization.push(options.headers?.authorization);

			const cli = parsed.pathname.includes("service-lasso-cli");
			const listed = cli ? [cliRelease.asset, cliRelease.checksumManifest, cliRelease.candidateManifest] : [...assets, release.checksumManifest, release.candidateManifest];
			const asset = listed[Number(parsed.pathname.split("/").at(-1)) - 1];
			const body = asset.name === "SHA256SUMS.txt" ? (cli ? cliSums : sums) : Buffer.from(assets.find((candidate) => candidate.name === asset.name)?.platform ?? (asset.name === cliRelease.asset.name ? "cli" : asset.name === "candidate-manifest.json" ? tuiCandidate : asset.name === "candidate.json" ? cliCandidate : ""));
			return new Response(body, { status: 200 });
		}
		if (parsed.hostname === "api.github.com") {
      metadataAuthorization.push(options.headers?.authorization);
			const cli = parsed.pathname.includes("service-lasso-cli");
			const listed = cli ? [cliRelease.asset, cliRelease.checksumManifest, cliRelease.candidateManifest] : [...assets, release.checksumManifest, release.candidateManifest];
			return Response.json({ tag_name: cli ? cliRelease.tag : release.tag, target_commitish: cli ? cliRelease.targetCommit : release.targetCommit, prerelease: true, draft: false, assets: listed.map((asset, index) => ({ name: asset.name, digest: `sha256:${asset.sha256}`, url: `https://api.github.com/repos/service-lasso/${cli ? "service-lasso-cli" : "service-lasso-tui"}/releases/assets/${index + 1}` })) });
		}
		const cli = parsed.pathname.includes("service-lasso-cli");
    assetAuthorization.push(options.headers?.authorization);
		downloadHosts.push(parsed.hostname);
		const name = parsed.pathname.split("/").at(-1);
		const body = name === "SHA256SUMS.txt" ? (cli ? cliSums : sums) : Buffer.from(assets.find((asset) => asset.name === name)?.platform ?? (name === cliRelease.asset.name ? "cli" : name === "candidate-manifest.json" ? tuiCandidate : name === "candidate.json" ? cliCandidate : ""));
		return new Response(body, { status: 200 });
    };
    const manifest = await stageOperatorTools({ artifactRoot: root, fetchImpl, release, cliRelease, releaseMetadataToken: "test-read-token" });
    assert.equal(manifest.tools[0].command, "service-lassoctl");
    assert.equal(manifest.tools[0].status, "available");
    assert.equal(manifest.tools[0].candidateManifest.relativePath, "operator-tools/service-lassoctl/candidate.json");
    assert.deepEqual(manifest.tools[0].supportedPlatforms, ["win32", "linux", "darwin"]);
    assert.equal(manifest.tools[1].assets.length, 4);
    assert.equal(manifest.tools[1].candidateManifest.relativePath, "operator-tools/service-lasso-tui/candidate-manifest.json");
    assert.equal(await readFile(path.join(root, "operator-tools", "service-lasso-tui", assets[0].name), "utf8"), assets[0].platform);
    const retained = await verifyRetainedOperatorTools({ artifactRoot: root });
    assert.deepEqual(retained.manifest.tools[0].supportedPlatforms, ["win32", "linux", "darwin"]);
    assert.deepEqual([...new Set(downloadHosts)], ["github.com"]);
    assert.deepEqual(metadataAuthorization, ["Bearer test-read-token", "Bearer test-read-token"]);
    assert.ok(assetAuthorization.every((authorization) => authorization === undefined));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("operator tool identity rejects incomplete platform inventory", () => {
  assertExactToolRelease(CURRENT_TUI_RELEASE);
  assertExactCliRelease(CURRENT_CLI_RELEASE);
  assert.deepEqual(
    { tag: CURRENT_TUI_RELEASE.tag, targetCommit: CURRENT_TUI_RELEASE.targetCommit, assets: CURRENT_TUI_RELEASE.assets.map((asset) => asset.name) },
    { tag: "candidate-2026.9.30-727f812", targetCommit: "727f812eaab9537af8a9cb369169c45caec5aa2f", assets: ["service-lasso-tui-2026.9.30-727f812-win32-amd64.zip", "service-lasso-tui-2026.9.30-727f812-linux-amd64.tar.gz", "service-lasso-tui-2026.9.30-727f812-darwin-amd64.tar.gz", "service-lasso-tui-2026.9.30-727f812-darwin-arm64.tar.gz"] },
  );
  assert.deepEqual(
    { tag: CURRENT_CLI_RELEASE.tag, targetCommit: CURRENT_CLI_RELEASE.targetCommit, asset: CURRENT_CLI_RELEASE.asset.name },
    { tag: "cli-v0.1.0-dev.d3a3814-candidate-d3a3814", targetCommit: "d3a381402c26686aa0b618055a45d525605bdbea", asset: "service-lassoctl-0.1.0-dev.d3a3814.tgz" },
  );
  assert.throws(() => assertExactToolRelease({ ...release, assets: release.assets.slice(1) }), /incomplete/u);
  assert.throws(() => assertExactCliRelease({ ...cliRelease, repository: "other/cli" }), /identity/u);
  assert.throws(() => assertExactCliRelease({ ...cliRelease, tag: "latest" }), /identity/u);
});

test("release metadata token is consumed and removed before child work", () => {
  const environment = { SERVICE_LASSO_RELEASE_METADATA_TOKEN: " test-read-token " };
  assert.equal(consumeReleaseMetadataToken(environment), "test-read-token");
  assert.equal("SERVICE_LASSO_RELEASE_METADATA_TOKEN" in environment, false);
  const bootstrapEnvironment = { SERVICE_LASSO_RELEASE_METADATA_TOKEN: "bootstrap-token" };
  bootstrapReleaseMetadataToken(bootstrapEnvironment);
  assert.equal("SERVICE_LASSO_RELEASE_METADATA_TOKEN" in bootstrapEnvironment, false);
  assert.equal(takeBootstrappedReleaseMetadataToken(), "bootstrap-token");
  assert.equal(takeBootstrappedReleaseMetadataToken(), undefined);
});

test("operator tools expose only a fixed release-metadata failure class", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "operator-tools-metadata-"));
  try {
    await assert.rejects(stageOperatorTools({ artifactRoot: root, fetchImpl: async () => new Response(null, { status: 403 }), release, cliRelease: null, releaseMetadataToken: "denied-read-token" }), (error) => {
      assert.deepEqual(operatorToolFailureDiagnostic(error), { boundary: "github_release_metadata", httpStatus: 403 });
      return true;
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("operator tools reject duplicate or mismatched GitHub release inventory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "operator-tools-duplicate-"));
  try {
    const duplicateFetch = async () => Response.json({ tag_name: release.tag, target_commitish: release.targetCommit, prerelease: true, draft: false, assets: [{ name: assets[0].name, digest: `sha256:${assets[0].sha256}`, url: "https://api.github.com/repos/service-lasso/service-lasso-tui/releases/assets/1" }, { name: assets[0].name, digest: `sha256:${assets[0].sha256}`, url: "https://api.github.com/repos/service-lasso/service-lasso-tui/releases/assets/2" }, ...assets.slice(1).map((asset, index) => ({ name: asset.name, digest: `sha256:${asset.sha256}`, url: `https://api.github.com/repos/service-lasso/service-lasso-tui/releases/assets/${index + 3}` })), { name: release.checksumManifest.name, digest: `sha256:${release.checksumManifest.sha256}`, url: "https://api.github.com/repos/service-lasso/service-lasso-tui/releases/assets/7" }, { name: release.candidateManifest.name, digest: `sha256:${release.candidateManifest.sha256}`, url: "https://api.github.com/repos/service-lasso/service-lasso-tui/releases/assets/8" }] });
    await assert.rejects(stageOperatorTools({ artifactRoot: root, fetchImpl: duplicateFetch, release }), /duplicate|inventory/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("operator tools reject a pinned candidate manifest with mismatched source identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "operator-tools-candidate-"));
  const sums = tuiSums;
  const mismatchedRelease = { ...release, targetCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
  try {
    const fetchImpl = async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.includes("/releases/tags/")) return Response.json({ tag_name: mismatchedRelease.tag, target_commitish: mismatchedRelease.targetCommit, prerelease: true, draft: false, assets: [...assets, mismatchedRelease.checksumManifest, mismatchedRelease.candidateManifest].map((asset, index) => ({ name: asset.name, digest: `sha256:${asset.sha256}`, url: `https://api.github.com/repos/service-lasso/service-lasso-tui/releases/assets/${index + 1}` })) });
      const name = parsed.pathname.split("/").at(-1);
      const body = name === "SHA256SUMS.txt" ? sums : name === "candidate-manifest.json" ? tuiCandidate : Buffer.from(assets.find((asset) => asset.name === name)?.platform ?? "");
      return new Response(body);
    };
    await assert.rejects(stageOperatorTools({ artifactRoot: root, fetchImpl, release: mismatchedRelease, cliRelease: null }), /candidate manifest/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("operator tools retry only a transient 5xx asset response before checksum verification", async () => {
  const retryAssets = ["win32-amd64", "linux-amd64", "darwin-amd64", "darwin-arm64"].map((platform) => ({ platform, name: `retry-${platform}.zip`, sha256: hash(platform) }));
  const retrySums = Buffer.from(retryAssets.map((asset) => `${asset.sha256}  ${asset.name}`).join("\n") + "\n");
  const retryCandidate = Buffer.from(JSON.stringify({ schemaVersion: 1, kind: "develop-prerelease-candidate", source: { repository: "service-lasso/service-lasso-tui", commit: "abcdef1234567890abcdef1234567890abcdef12" }, release: { tag: "candidate-2026.9.30-abcdef1", prerelease: true }, checksumManifest: { name: "SHA256SUMS.txt", sha256: hash(retrySums) }, assets: retryAssets }));
  const retryRelease = { repository: "service-lasso/service-lasso-tui", tag: "candidate-2026.9.30-abcdef1", targetCommit: "abcdef1234567890abcdef1234567890abcdef12", checksumManifest: { name: "SHA256SUMS.txt", sha256: hash(retrySums) }, candidateManifest: { name: "candidate-manifest.json", sha256: hash(retryCandidate) }, assets: retryAssets };
  const root = await mkdtemp(path.join(os.tmpdir(), "operator-tools-retry-"));
  let checksumAttempts = 0;
  try {
    const fetchImpl = async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.includes("/releases/tags/")) return Response.json({ tag_name: retryRelease.tag, target_commitish: retryRelease.targetCommit, prerelease: true, draft: false, assets: [...retryAssets, retryRelease.checksumManifest, retryRelease.candidateManifest].map((asset, index) => ({ name: asset.name, digest: `sha256:${asset.sha256}`, url: `https://api.github.com/repos/service-lasso/service-lasso-tui/releases/assets/${index + 1}` })) });
      const asset = parsed.hostname === "github.com" ? [...retryAssets, retryRelease.checksumManifest, retryRelease.candidateManifest].find((candidate) => candidate.name === parsed.pathname.split("/").at(-1)) : [...retryAssets, retryRelease.checksumManifest, retryRelease.candidateManifest][Number(parsed.pathname.split("/").at(-1)) - 1];
      if (asset.name === "SHA256SUMS.txt" && checksumAttempts++ === 0) return new Response("temporary upstream failure", { status: 500 });
      const body = asset.name === "SHA256SUMS.txt" ? retrySums : asset.name === "candidate-manifest.json" ? retryCandidate : Buffer.from(asset.platform);
      return new Response(body, { status: 200 });
    };
    const manifest = await stageOperatorTools({ artifactRoot: root, fetchImpl, release: retryRelease, cliRelease: null });
    assert.equal(checksumAttempts, 2);
    assert.equal(manifest.tools[1].status, "available");
  } finally { await rm(root, { recursive: true, force: true }); }
});

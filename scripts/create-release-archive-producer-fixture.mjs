import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FULL_SHA = /^[0-9a-f]{40}$/iu;
const DECIMAL_ID = /^\d+$/u;
const MAX_TAG_PEEL_DEPTH = 8;

function fail(message) { throw new Error(message); }

function exactAssetEndpoint(repository, assetId) {
  return `https://api.github.com/repos/${repository}/releases/assets/${assetId}`;
}

function matchingAsset(release, asset) {
  if (!Array.isArray(release.assets)) fail("The supplied release did not contain an asset list.");
  const matches = release.assets.filter((candidate) => String(candidate?.id) === String(asset.id));
  if (matches.length !== 1) fail("The selected asset ID was not a unique member of the supplied release.");
  const listed = matches[0];
  for (const key of ["id", "url", "name", "size", "digest"]) {
    if ((listed[key] ?? null) !== (asset[key] ?? null)) fail("The selected asset metadata did not match its release member.");
  }
}

function peelTagTarget(repository, tagName, request) {
  if (typeof tagName !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(tagName)) fail("The release tag name was not a bounded tag reference.");
  let object = request(`repos/${repository}/git/ref/tags/${encodeURIComponent(tagName)}`)?.object;
  for (let depth = 0; depth < MAX_TAG_PEEL_DEPTH; depth += 1) {
    if (!object || typeof object.type !== "string" || !FULL_SHA.test(object.sha ?? "")) fail("The release tag did not resolve to a Git object.");
    if (object.type === "commit") return object.sha.toLowerCase();
    if (object.type !== "tag") fail("The release tag did not resolve to a commit.");
    object = request(`repos/${repository}/git/tags/${object.sha}`)?.object;
  }
  fail("The release tag exceeded the bounded annotated-tag peel depth.");
}

export function resolveProducerReleaseIdentity({ sourceRevision, releaseId, assetId, repository, request }) {
  if (!FULL_SHA.test(sourceRevision ?? "") || !DECIMAL_ID.test(releaseId ?? "") || !DECIMAL_ID.test(assetId ?? "")
    || typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) || typeof request !== "function") {
    fail("A full source revision plus server-resolved repository, release, and asset IDs are required for a producer receipt.");
  }
  const release = request(`repos/${repository}/releases/${releaseId}`);
  const asset = request(`repos/${repository}/releases/assets/${assetId}`);
  if (!release || !asset || String(release.id) !== releaseId || String(asset.id) !== assetId || release.draft || release.prerelease || !release.published_at
    || asset.url !== exactAssetEndpoint(repository, assetId)) fail("The supplied release and asset IDs did not resolve to one published release asset.");
  matchingAsset(release, asset);
  const releaseTarget = peelTagTarget(repository, release.tag_name, request);
  if (releaseTarget !== sourceRevision.toLowerCase()) fail("The release tag target did not match the exact source revision.");
  return {
    repository,
    releaseId,
    releaseTag: release.tag_name,
    releaseTarget,
    assetId,
    assetName: asset.name,
    assetDigest: asset.digest ?? null,
    assetByteLength: asset.size,
  };
}

function commandVersion() {
  for (const args of [["--version"], ["-version"]]) {
    try { return execFileSync("tar", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* try BSD spelling */ }
  }
  fail("The native tar producer did not return a version.");
}

function githubJson(endpoint) {
  return JSON.parse(execFileSync("gh", ["api", endpoint], { encoding: "utf8" }));
}

async function main() {
  const output = path.resolve(process.env.RELEASE_ARCHIVE_FIXTURE_OUTPUT ?? "artifacts/release-archive-producer-fixture");
  const sourceRevision = process.env.RELEASE_ARCHIVE_SOURCE_REVISION;
  const releaseId = process.env.RELEASE_ARCHIVE_RELEASE_ID;
  const assetId = process.env.RELEASE_ARCHIVE_ASSET_ID;
  const repository = process.env.GITHUB_REPOSITORY;
  const serverResolved = resolveProducerReleaseIdentity({ sourceRevision, releaseId, assetId, repository, request: githubJson });
  const source = path.join(output, "source", "bundle");
  await mkdir(path.join(source, "nested"), { recursive: true });
  await writeFile(path.join(source, "service.json"), '{"id":"release-archive-fixture"}\n', "utf8");
  await writeFile(path.join(source, "nested", "payload.txt"), "producer fixture\n", "utf8");
  const archive = path.join(output, "release-archive-profile-v1.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", path.dirname(source), "bundle"], { stdio: "inherit" });
  const archiveBytes = await readFile(archive);
  const receipt = {
    schema: "release-archive-producer-receipt-v1",
    producer: { command: "tar -czf <archive> -C <source-parent> bundle", version: commandVersion(), platform: process.platform },
    sourceRevision: sourceRevision.toLowerCase(),
    serverResolved,
    archive: { name: path.basename(archive), sha256: createHash("sha256").update(archiveBytes).digest("hex"), byteLength: archiveBytes.length },
    qualification: "fixture-parser-proof-only",
    tarRuntimeAdmission: "disabled pending independent T1-T5 gates",
  };
  await writeFile(path.join(output, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

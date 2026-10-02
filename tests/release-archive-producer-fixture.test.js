import assert from "node:assert/strict";
import test from "node:test";
import { resolveProducerReleaseIdentity } from "../scripts/create-release-archive-producer-fixture.mjs";

const REPOSITORY = "example/release-producer";
const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";
const TAG_OBJECT_SHA = "1111111111111111111111111111111111111111";
const ASSET_URL = `https://api.github.com/repos/${REPOSITORY}/releases/assets/17`;

function fixture({ release = {}, asset = {}, tagObject = { type: "tag", sha: TAG_OBJECT_SHA }, peeledObject = { type: "commit", sha: SOURCE_SHA } } = {}) {
  const canonicalAsset = { id: 17, url: ASSET_URL, name: "example-linux.tar.gz", size: 42, digest: "sha256:abc" };
  const canonicalRelease = { id: 7, draft: false, prerelease: false, published_at: "2026-10-01T00:00:00Z", tag_name: "2026.10.1-0123456", assets: [canonicalAsset] };
  const values = {
    [`repos/${REPOSITORY}/releases/7`]: { ...canonicalRelease, ...release },
    [`repos/${REPOSITORY}/releases/assets/17`]: { ...canonicalAsset, ...asset },
    [`repos/${REPOSITORY}/git/ref/tags/${encodeURIComponent(canonicalRelease.tag_name)}`]: { object: tagObject },
    [`repos/${REPOSITORY}/git/tags/${TAG_OBJECT_SHA}`]: { object: peeledObject },
  };
  return (endpoint) => values[endpoint];
}

function resolve(request) {
  return resolveProducerReleaseIdentity({ sourceRevision: SOURCE_SHA, releaseId: "7", assetId: "17", repository: REPOSITORY, request });
}

test("producer receipt binds an actual release fixture asset to its selected release and peels its tag through the provider API", () => {
  const resolved = resolve(fixture());
  assert.deepEqual(resolved, { repository: REPOSITORY, releaseId: "7", releaseTag: "2026.10.1-0123456", releaseTarget: SOURCE_SHA, assetId: "17", assetName: "example-linux.tar.gz", assetDigest: "sha256:abc", assetByteLength: 42 });
});

test("producer receipt rejects an independently fetched selected ID absent from release.assets", () => {
  assert.throws(() => resolve(fixture({ release: { assets: [] } })), /unique member/);
});

test("producer receipt rejects a selected asset whose release-member metadata identifies another release asset", () => {
  assert.throws(() => resolve(fixture({ asset: { name: "other-release.tar.gz" } })), /metadata did not match/);
});

test("producer receipt rejects the obsolete release-ID-scoped asset endpoint", () => {
  assert.throws(() => resolve(fixture({ asset: { url: `https://api.github.com/repos/${REPOSITORY}/releases/7/assets/17` } })), /published release asset/);
});

test("producer receipt rejects draft, prerelease, and mismatched exact-target releases", () => {
  assert.throws(() => resolve(fixture({ release: { draft: true } })), /published release asset/);
  assert.throws(() => resolve(fixture({ release: { prerelease: true } })), /published release asset/);
  assert.throws(() => resolve(fixture({ peeledObject: { type: "commit", sha: "fedcba9876543210fedcba9876543210fedcba98" } })), /target did not match/);
});

test("producer receipt accepts an exact-SHA checkout proof without consulting a local tag", () => {
  const calls = [];
  const request = (endpoint) => { calls.push(endpoint); return fixture()(endpoint); };
  assert.equal(resolve(request).releaseTarget, SOURCE_SHA);
  assert.ok(calls.every((endpoint) => endpoint.startsWith(`repos/${REPOSITORY}/`)));
  assert.ok(calls.some((endpoint) => endpoint.includes("git/ref/tags/")));
});

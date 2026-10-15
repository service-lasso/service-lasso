import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.SERVICE_PRODUCER_POLICY_ROOT
  ? path.resolve(process.env.SERVICE_PRODUCER_POLICY_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const policyPath = "fixtures/service-producer-release-policy/valid-policy.json";
const policy = JSON.parse(read(policyPath));
const doc = read("docs/reference/service-producer-release-policy.md");
const spec = read(".governance/specs/SPEC-002-core-standalone-runtime.md");
const transfer = read("docs/api/staged-service-transfer.md");

const sha256 = /^[a-f0-9]{64}$/u;
const targetSha = /^[a-f0-9]{40}$/u;
const tag = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;
const serviceId = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;
const assetName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u;
const allowedPlatforms = new Set(["win32", "linux", "darwin"]);
const policyAssetName = "service-lasso-release-policy.json";

function fail(message) {
  throw new Error(`Service-producer release policy mismatch: ${message}`);
}

function expect(value, message) {
  if (!value) fail(message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function expectExactKeys(value, keys, message) {
  expect(isPlainObject(value), `${message} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  expect(actual.length === expected.length && actual.every((key, index) => key === expected[index]), `${message} has unknown or missing fields`);
}

expectExactKeys(policy, ["schema", "serviceId", "release", "manifest", "platforms"], "policy");
expect(policy.schema === "service-lasso.service-producer-release-policy/v1", "schema must be v1");
expect(serviceId.test(policy.serviceId ?? ""), "serviceId must use target-service grammar");
expectExactKeys(policy.release, ["tag", "targetSha"], "release");
expect(tag.test(policy.release?.tag ?? ""), "release tag must use staged-transfer grammar");
expect(targetSha.test(policy.release?.targetSha ?? ""), "release targetSha must be lowercase full SHA");
expectExactKeys(policy.manifest, ["assetName", "sha256"], "manifest");
expect(policy.manifest?.assetName === "service.json", "manifest must be the dedicated service.json asset");
expect(sha256.test(policy.manifest?.sha256 ?? ""), "manifest must have a lowercase SHA-256");

const platformEntries = Object.entries(policy.platforms ?? {});
expect(platformEntries.length > 0, "at least one explicit platform must be declared");
const nonChecksumAssetNames = new Set([policyAssetName, policy.manifest.assetName]);
const checksumAssets = new Map();
for (const [platform, entry] of platformEntries) {
  expect(allowedPlatforms.has(platform), `unknown or fallback platform ${platform}`);
  expectExactKeys(entry, ["assetName", "archiveType", "sha256", "checksum"], `${platform} platform`);
  expect(assetName.test(entry?.assetName ?? ""), `${platform} archive asset name is invalid`);
  expect(sha256.test(entry?.sha256 ?? ""), `${platform} archive digest is invalid`);
  expectExactKeys(entry?.checksum, ["assetName", "sha256"], `${platform} checksum`);
  expect(assetName.test(entry?.checksum?.assetName ?? ""), `${platform} checksum asset name is invalid`);
  expect(sha256.test(entry?.checksum?.sha256 ?? ""), `${platform} checksum digest is invalid`);
  expect(!nonChecksumAssetNames.has(entry.assetName) && !checksumAssets.has(entry.assetName), `${platform} archive asset name overlaps a fixed, checksum, or duplicate asset`);
  nonChecksumAssetNames.add(entry.assetName);
  expect(!nonChecksumAssetNames.has(entry.checksum.assetName), `${platform} checksum asset name overlaps a fixed or archive asset`);
  const previousChecksumDigest = checksumAssets.get(entry.checksum.assetName);
  expect(previousChecksumDigest === undefined || previousChecksumDigest === entry.checksum.sha256, `${platform} shared checksum asset has an incoherent digest`);
  checksumAssets.set(entry.checksum.assetName, entry.checksum.sha256);
  const allowedType = platform === "win32"
    ? entry.archiveType === "zip"
    : entry.archiveType === "tar.gz" || entry.archiveType === "tgz";
  expect(allowedType, `${platform} archive type is not policy-approved`);
}

for (const phrase of [
  "exactly one release asset named `service-lasso-release-policy.json`",
  "exactly one release asset named `service.json`",
  "The policy describes that stream's digest; it does not embed a self-digest in `service.json`.",
  "This policy adds no fields to `service.json` and does not invent a manifest-side target-SHA field",
  "A checksum identity may be shared by several platforms only when every use declares the same asset name and SHA-256",
  "Only that owner approval can create or update the catalog pin.",
]) {
  expect(doc.includes(phrase), `policy document lost required statement: ${phrase}`);
}
expect(spec.includes("#1524 owns that producer policy and its owner-approved Core catalog pin"), "SPEC-002 must retain #1524 prerequisite");
expect(transfer.includes("service-producer-policy manifest source"), "staged-transfer contract must retain producer-policy source");

console.log("Service-producer release-policy fixture and #1524 contract are consistent.");

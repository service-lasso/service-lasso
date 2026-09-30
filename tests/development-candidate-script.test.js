import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("AC-4BZ.3 candidate builder binds exactly six platform archives to the full source SHA", async () => {
  const source = await readFile(new URL("../scripts/create-development-candidate.mjs", import.meta.url), "utf8");
  assert.match(source, /\^\[a-f0-9\]\{40\}\$/u);
  assert.match(source, /archives\.length !== requiredPairs\.size/u);
  assert.match(source, /exactly six unique bundled and unbundled platform archives/u);
  assert.match(source, /copyFile\(archive\.path, path\.join\(outputRoot, archive\.name\)\)/u);
  assert.match(source, /candidate-manifest\.json/u);
  assert.match(source, /SHA256SUMS\.txt/u);
  assert.match(source, /consumeReleaseMetadataToken\(\)/u);
  assert.match(source, /nonGoals: \["github-release", "npm-publication", "deployment", "promotion", "release-environment", "ga"\]/u);
});

test("AC-4BZ.3 consumer verifier validates an exact six-file inventory before startup", async () => {
  const source = await readFile(new URL("../scripts/verify-development-candidate.mjs", import.meta.url), "utf8");
  assert.match(source, /manifest\?\.source\?\.commit !== candidateSha/u);
  assert.match(source, /return \[match\[2\], match\[1\]\]/u);
  assert.match(source, /Candidate checksum verification failed/u);
  assert.match(source, /Candidate manifest checksum verification failed/u);
  assert.match(source, /Candidate artifact contains unexpected files/u);
  assert.doesNotMatch(source, /release-artifact-lib/u);
  assert.doesNotMatch(source, /repoRoot, "services"/u);
  assert.match(source, /Owned candidate Core did not exit before cleanup/u);
  assert.match(source, /consumerSmoke: "passed"/u);
});

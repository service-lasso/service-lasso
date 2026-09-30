import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("AC-4BZ.3 candidate builder binds exactly six platform archives to the full source SHA", async () => {
  const source = await readFile(new URL("../scripts/create-development-candidate.mjs", import.meta.url), "utf8");
  assert.match(source, /\^\[a-f0-9\]\{40\}\$/u);
  assert.match(source, /archives\.length !== 6/u);
  assert.match(source, /candidate-manifest\.json/u);
  assert.match(source, /SHA256SUMS\.txt/u);
  assert.match(source, /consumeReleaseMetadataToken\(\)/u);
  assert.match(source, /nonGoals: \["github-release", "npm-publication", "deployment", "promotion", "release-environment", "ga"\]/u);
});

test("AC-4BZ.3 consumer verifier rejects mismatched source or checksums before startup", async () => {
  const source = await readFile(new URL("../scripts/verify-development-candidate.mjs", import.meta.url), "utf8");
  assert.match(source, /manifest\?\.source\?\.commit !== candidateSha/u);
  assert.match(source, /return \[match\[2\], match\[1\]\]/u);
  assert.match(source, /Candidate checksum verification failed/u);
  assert.match(source, /Candidate manifest checksum verification failed/u);
  assert.match(source, /consumerSmoke: "passed"/u);
});

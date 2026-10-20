import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(new URL("../.github/workflows/core-development-candidate.yml", import.meta.url), "utf8");

test("AC-4BZ.3 development candidate workflow is exact-develop, read-only, and nonpublishing", () => {
  assert.match(workflow, /workflow_dispatch:[\s\S]*?candidate_sha:/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/develop'/u);
  assert.match(workflow, /git merge-base --is-ancestor "\$\{CANDIDATE_SHA\}" origin\/develop/u);
  assert.match(workflow, /permissions:\s*\n\s*actions: read\s*\n\s*contents: read/u);
  assert.doesNotMatch(workflow, /environment: release|npm publish|gh release|attest-build-provenance|contents: write|id-token: write/u);
});

test("AC-4BZ.3 binds every consumer to the immutable uploaded artifact and exercises each clean OS consumer", () => {
  assert.match(workflow, /scripts\/create-development-candidate\.mjs/u);
  assert.match(workflow, /scripts\/verify-development-candidate-artifact\.mjs/u);
  assert.match(workflow, /artifact_id: \$\{\{ steps\.upload\.outputs\.artifact-id \}\}/u);
  assert.match(workflow, /artifact_digest: \$\{\{ steps\.upload\.outputs\.artifact-digest \}\}/u);
  assert.match(workflow, /dispatch_sha: \$\{\{ env\.DISPATCH_SHA \}\}/u);
  assert.match(workflow, /DEVELOPMENT_CANDIDATE_ARTIFACT_ID: \$\{\{ needs\.build-candidate\.outputs\.artifact_id \}\}/u);
  assert.match(workflow, /DEVELOPMENT_CANDIDATE_ARTIFACT_DIGEST: \$\{\{ needs\.build-candidate\.outputs\.artifact_digest \}\}/u);
  assert.match(workflow, /DEVELOPMENT_CANDIDATE_DISPATCH_SHA: \$\{\{ needs\.build-candidate\.outputs\.dispatch_sha \}\}/u);
  assert.match(workflow, /artifact-ids: \$\{\{ needs\.build-candidate\.outputs\.artifact_id \}\}/u);
  assert.match(workflow, /actions\/download-artifact@/u);
  assert.match(workflow, /windows-latest[\s\S]*?win32/u);
  assert.match(workflow, /ubuntu-latest[\s\S]*?linux/u);
  assert.match(workflow, /macos-latest[\s\S]*?darwin/u);
  assert.match(workflow, /scripts\/verify-development-candidate\.mjs/u);
});

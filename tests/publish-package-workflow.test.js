import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflowUrl = new URL("../.github/workflows/publish-package.yml", import.meta.url);

test("AC-4S publish workflow preserves OIDC, token fallback, and exact-version idempotency", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /permissions:\s*\n\s+contents: read\s*\n\s+id-token: write/);
  assert.match(
    workflow,
    /- name: Install npm with trusted publishing support\s*\n\s+run: npm install --global npm@11\.18\.0/,
  );
  assert.match(
    workflow,
    /- name: Check whether package version already exists[\s\S]*?id: package_exists[\s\S]*?npm view @service-lasso\/service-lasso@\$\{\{ steps\.publish_version\.outputs\.version \}\}/,
  );
  assert.match(
    workflow,
    /- name: Publish package to npm\s*\n\s+if: steps\.package_exists\.outputs\.exists != 'true'[\s\S]*?NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}[\s\S]*?run: npm publish --access public/,
  );
  assert.doesNotMatch(workflow, /Check npm token is configured|NPM_TOKEN repository secret is required/);
});

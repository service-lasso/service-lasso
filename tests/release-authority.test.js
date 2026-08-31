import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();

/**
 * True when a workflow `uses:` value is a 40-character commit SHA pin.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isShaPinnedAction(value) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*@[0-9a-f]{40}(?:\s+#.+)?$/.test(value.trim());
}

test("CODEOWNERS and SECURITY.md exist for Core 1.0 release authority", async () => {
  const codeowners = await readFile(path.join(repoRoot, ".github", "CODEOWNERS"), "utf8");
  const security = await readFile(path.join(repoRoot, "SECURITY.md"), "utf8");
  assert.match(codeowners, /@wildone/);
  assert.match(codeowners, /\/\.github\//);
  assert.match(security, /GitHub Security Advisories/);
  assert.match(security, /npm audit --omit=dev/);
});

test("every GitHub Actions workflow pins third-party actions to a commit SHA", async () => {
  const workflowsDir = path.join(repoRoot, ".github", "workflows");
  const names = await readdir(workflowsDir);
  const workflowNames = names.filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
  assert.ok(workflowNames.length > 0, "expected hosted workflows");

  const unpinned = [];
  for (const name of workflowNames) {
    const source = await readFile(path.join(workflowsDir, name), "utf8");
    for (const [index, line] of source.split("\n").entries()) {
      const match = line.match(/^\s*uses:\s*(.+)$/);
      if (!match) {
        continue;
      }
      const action = match[1].trim();
      if (action.startsWith("./") || action.startsWith("docker://")) {
        continue;
      }
      if (!isShaPinnedAction(action)) {
        unpinned.push(`${name}:${index + 1}: ${action}`);
      }
    }
  }

  assert.deepEqual(unpinned, []);
});

test("npm publish is bound to the protected release environment", async () => {
  const source = await readFile(path.join(repoRoot, ".github", "workflows", "publish-package.yml"), "utf8");
  assert.match(source, /publish-package:/);
  assert.match(source, /^\s+environment:\s+release\s*$/m);
});

test("Dependabot covers npm and GitHub Actions", async () => {
  const source = await readFile(path.join(repoRoot, ".github", "dependabot.yml"), "utf8");
  assert.match(source, /package-ecosystem:\s+"github-actions"/);
  assert.match(source, /package-ecosystem:\s+"npm"/);
});

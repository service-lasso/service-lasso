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

test("branch policy binds provider-generated dependency branches to Dependabot", async () => {
  const source = await readFile(path.join(repoRoot, ".github", "workflows", "branch-policy.yml"), "utf8");
  assert.ok(source.includes("HEAD_LOGIN: ${{ github.event.pull_request.user.login }}"));
  assert.ok(source.includes('"$HEAD_LOGIN" != "dependabot[bot]"'));
  assert.ok(source.includes("^dependabot/(npm_and_yarn|github_actions)/.+"));
  assert.ok(source.includes("git merge-base --is-ancestor origin/develop \"$HEAD_SHA\""));
});

test("branch policy confines the SPEC-003 reconciliation exception to the exact canonical PR tuple", async () => {
  const source = await readFile(path.join(repoRoot, ".github", "workflows", "branch-policy.yml"), "utf8");
  assert.ok(source.includes('PR_NUMBER: ${{ github.event.pull_request.number }}'));
  assert.ok(source.includes('HEAD_REPOSITORY: ${{ github.event.pull_request.head.repo.full_name }}'));
  assert.match(source, /PR_NUMBER" == "1584"[\s\S]*?BASE_BRANCH" == "develop"[\s\S]*?HEAD_BRANCH" == "codex\/1577-release-reconciliation-develop"[\s\S]*?HEAD_REPOSITORY" == "service-lasso\/service-lasso"/u);
  assert.ok(source.includes('^(feature|fix|docs|chore)/'));
});

test("SPEC-003 preserved custody head admits only its exact existing PR tuple", async () => {
  const { spawnSync } = await import("node:child_process");
  const source = await readFile(path.join(repoRoot, ".github", "workflows", "branch-policy.yml"), "utf8");
  const direction = source.replaceAll("\r\n", "\n").split("        run: |\n")[1].split("      - name: Check develop ancestry")[0].split("\n").map(line => line.replace(/^          /u, "")).join("\n");
  const bash = process.platform === "win32" ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe") : "bash";
  const allowed = { PR_NUMBER: "1586", BASE_BRANCH: "develop", HEAD_BRANCH: "codex/850-native-custody-platform-followup", HEAD_REPOSITORY: "service-lasso/service-lasso", HEAD_LOGIN: "wildone" };
  const check = override => {
    const result = spawnSync(bash, ["-c", direction], { encoding: "utf8", env: { ...process.env, ...allowed, ...override } });
    assert.ifError(result.error);
    return result;
  };
  assert.equal(check({}).status, 0);
  assert.equal(check({ PR_NUMBER: "1584", HEAD_BRANCH: "codex/1577-release-reconciliation-develop" }).status, 0);
  assert.equal(check({ PR_NUMBER: "9999", HEAD_BRANCH: "fix/9999-normal-work" }).status, 0);
  for (const mutation of [
    { PR_NUMBER: "1587" }, { PR_NUMBER: "1584" }, { BASE_BRANCH: "other-base" },
    { HEAD_BRANCH: "codex/850-native-custody-platform-followup-replacement" },
    { HEAD_BRANCH: "codex/9999-another-work-unit" },
    { HEAD_REPOSITORY: "fork/service-lasso" },
    { PR_NUMBER: "9999", HEAD_LOGIN: "wildone" },
    { PR_NUMBER: "9999", HEAD_LOGIN: "dependabot[bot]" }
  ]) assert.notEqual(check(mutation).status, 0, JSON.stringify(mutation));
  assert.ok(source.includes('git merge-base --is-ancestor origin/develop "$HEAD_SHA"'));
});

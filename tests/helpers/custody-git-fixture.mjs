import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";

// Nested repositories own their Git input authority. Do not carry runner checkout
// redirections, injected config, global hooks or object stores into these fixtures.
// This changes fixture inputs only; actual producers retain their strict checks.
export function fixtureGitEnvironment(base = process.env) {
  const environment = { ...base };
  for (const key of Object.keys(environment)) if (/^GIT_/iu.test(key)) delete environment[key];
  return { ...environment, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.autocrlf", GIT_CONFIG_VALUE_0: "false" };
}
export function fixtureGit(args, cwd, environment = fixtureGitEnvironment()) {
  const result = spawnSync("git", args, { cwd, env: environment, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, `${args.join(" ")}: ${result.error?.message ?? ""}\n${result.stderr}`);
  return result.stdout.trim();
}
export async function fetchedCheckout(workspace, source, head, tree, environment = fixtureGitEnvironment()) {
  assert.match(head, /^[0-9a-f]{40}$/u);
  assert.match(tree, /^[0-9a-f]{40}$/u);
  await mkdir(workspace);
  fixtureGit(["init"], workspace, environment);
  fixtureGit(["config", "core.autocrlf", "false"], workspace, environment);
  fixtureGit(["fetch", "--no-tags", source, head], workspace, environment);
  assert.equal(fixtureGit(["rev-parse", "FETCH_HEAD^{commit}"], workspace, environment), head);
  assert.equal(fixtureGit(["rev-parse", `${head}^{tree}`], workspace, environment), tree);
  fixtureGit(["checkout", "--detach", head], workspace, environment);
  assert.equal(fixtureGit(["rev-parse", "HEAD"], workspace, environment), head);
  assert.equal(fixtureGit(["rev-parse", "HEAD^{tree}"], workspace, environment), tree);
  assert.equal(fixtureGit(["status", "--porcelain=v1", "--untracked-files=all"], workspace, environment), "");
  return { workspace, head, tree, environment };
}

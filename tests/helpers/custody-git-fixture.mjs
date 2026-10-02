import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

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
  const expectedGitDirectory=await realpath(path.join(workspace,".git"));
  const gitDirectory=fixtureGit(["rev-parse","--absolute-git-dir"],workspace,environment);
  assert.equal(await realpath(gitDirectory),expectedGitDirectory,"fixture Git must own the newly initialized checkout");
  const fetched=spawnSync("git",["fetch","--no-tags",source,head],{cwd:workspace,env:environment,encoding:"utf8",shell:false});
  const fetchObservation={status:fetched.status,signal:fetched.signal,errorCode:fetched.error?.code??null,stdout:fetched.stdout,stderr:fetched.stderr};
  const diagnostic=JSON.stringify({gitDirectory,fetch:fetchObservation});
  assert.equal(fetched.error,undefined,diagnostic);assert.equal(fetched.signal,null,diagnostic);assert.equal(fetched.status,0,diagnostic);
  assert.equal(await realpath(fixtureGit(["rev-parse","--absolute-git-dir"],workspace,environment)),expectedGitDirectory,diagnostic);
  const fetchHeadPath=path.join(expectedGitDirectory,"FETCH_HEAD");
  const fetchHeadStat=await lstat(fetchHeadPath).catch(error=>{assert.fail(JSON.stringify({gitDirectory,fetch:fetchObservation,fetchHead:{state:"unreadable",errorCode:error.code??null}}));});
  assert.equal(fetchHeadStat.isSymbolicLink(),false,diagnostic);assert.equal(fetchHeadStat.isFile(),true,diagnostic);
  const fetchHead=await readFile(fetchHeadPath,"utf8");
  // Observe the real fetch side effect; do not manufacture a ref to mask the
  // retained hosted FETCH_HEAD failure or substitute an object-only check.
  assert.ok(fetchHead.split("\n").some(line=>line.startsWith(`${head}\t`)),JSON.stringify({gitDirectory,fetch:fetchObservation,fetchHead}));
  assert.equal(fixtureGit(["rev-parse", "FETCH_HEAD^{commit}"], workspace, environment), head);
  assert.equal(fixtureGit(["rev-parse", `${head}^{tree}`], workspace, environment), tree);
  fixtureGit(["checkout", "--detach", head], workspace, environment);
  assert.equal(fixtureGit(["rev-parse", "HEAD"], workspace, environment), head);
  assert.equal(fixtureGit(["rev-parse", "HEAD^{tree}"], workspace, environment), tree);
  assert.equal(fixtureGit(["status", "--porcelain=v1", "--untracked-files=all"], workspace, environment), "");
  return { workspace, head, tree, environment };
}

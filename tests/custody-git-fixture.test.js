import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { fetchedCheckout, fixtureGit, fixtureGitEnvironment } from "./helpers/custody-git-fixture.mjs";

// BR-008 acquisition proof uses an independent two-commit repository. Git's
// actual depth-one transport creates the shallow boundary; no .git file is
// authored or mocked. Full workflow tests separately require native custody.
async function shallowSource(root) {
  const environment=fixtureGitEnvironment(),origin=path.join(root,"origin");await mkdir(origin);
  fixtureGit(["init","--initial-branch=fixture-source"],origin,environment);
  fixtureGit(["config","user.name","Custody fixture"],origin,environment);
  fixtureGit(["config","user.email","custody-fixture@example.invalid"],origin,environment);
  await writeFile(path.join(origin,"candidate.txt"),"first\n");
  fixtureGit(["add","candidate.txt"],origin,environment);fixtureGit(["commit","-m","first fixture"],origin,environment);
  const previousHead=fixtureGit(["rev-parse","HEAD"],origin,environment),previousTree=fixtureGit(["rev-parse","HEAD^{tree}"],origin,environment);
  await writeFile(path.join(origin,"candidate.txt"),"exact candidate\n");
  fixtureGit(["add","candidate.txt"],origin,environment);fixtureGit(["commit","-m","exact fixture"],origin,environment);
  const head=fixtureGit(["rev-parse","HEAD"],origin,environment),tree=fixtureGit(["rev-parse","HEAD^{tree}"],origin,environment),source=path.join(root,"shallow");
  assert.notEqual(head,previousHead);assert.notEqual(tree,previousTree);
  fixtureGit(["clone","--no-local","--depth=1","--no-tags","--branch","fixture-source",pathToFileURL(origin).href,source],root,environment);
  assert.equal(fixtureGit(["rev-parse","--is-shallow-repository"],source,environment),"true");
  assert.equal(fixtureGit(["rev-list","--count","HEAD"],source,environment),"1");
  assert.equal(fixtureGit(["rev-parse","HEAD"],source,environment),head);
  assert.equal(fixtureGit(["rev-parse","HEAD^{tree}"],source,environment),tree);
  assert.equal(fixtureGit(["status","--porcelain=v1","--untracked-files=all"],source,environment),"");
  const boundary=path.join(source,".git","shallow"),stat=await lstat(boundary);
  assert.equal(stat.isSymbolicLink(),false);assert.equal(stat.isFile(),true);
  assert.equal((await readFile(boundary,"utf8")).trim(),head);
  return {origin,source,head,tree,previousHead,previousTree,environment};
}
async function fixture(t) {
  const root=await realpath(await mkdtemp(path.join(tmpdir(),"custody-shallow-git-")));
  t.after(async()=>{await rm(root,{recursive:true,force:true});});
  return {root,...await shallowSource(root)};
}
async function assertFetchHead(workspace,head,environment) {
  const gitDirectory=await realpath(path.join(workspace,".git"));
  assert.equal(await realpath(fixtureGit(["rev-parse","--absolute-git-dir"],workspace,environment)),gitDirectory);
  const file=path.join(gitDirectory,"FETCH_HEAD"),stat=await lstat(file);
  assert.equal(stat.isSymbolicLink(),false);assert.equal(stat.isFile(),true);
  assert.ok((await readFile(file,"utf8")).split("\n").some(line=>line.startsWith(`${head}\t`)));
  assert.equal(fixtureGit(["rev-parse","FETCH_HEAD^{commit}"],workspace,environment),head);
}
for(const aliasedParent of [false,true]) {
  test(`BR008 exact shallow source acquires real FETCH_HEAD and clean candidate${aliasedParent?" through a physical parent alias":""}`,async(t)=>{
    const {root,source,head,tree,environment}=await fixture(t);
    const physical=path.join(root,"physical");await mkdir(physical);
    let parent=physical;
    if(aliasedParent) {
      const alias=path.join(root,"alias");await symlink(physical,alias,process.platform==="win32"?"junction":"dir");
      assert.equal((await lstat(alias)).isSymbolicLink(),true);assert.equal(await realpath(alias),physical);
      parent=await realpath(alias);assert.notEqual(parent,alias);
    }
    const workspace=path.join(parent,"checkout");await fetchedCheckout(workspace,source,head,tree,environment);
    await assertFetchHead(workspace,head,environment);
    assert.equal(fixtureGit(["rev-parse","HEAD"],workspace,environment),head);
    assert.equal(fixtureGit(["rev-parse","HEAD^{tree}"],workspace,environment),tree);
    assert.equal(fixtureGit(["status","--porcelain=v1","--untracked-files=all"],workspace,environment),"");
    assert.equal(await readFile(path.join(workspace,"candidate.txt"),"utf8"),"exact candidate\n");
    // A second real acquisition covers the separate Admin-fetch caller too.
    const admin=path.join(root,"admin");await fetchedCheckout(admin,workspace,head,tree,environment);
    await assertFetchHead(admin,head,environment);
    assert.equal(await readFile(path.join(admin,"candidate.txt"),"utf8"),"exact candidate\n");
  });
}
test("BR008 valid wrong tree fails after genuine shallow acquisition before checkout",async(t)=>{
  const {root,source,head,tree,previousTree,environment}=await fixture(t),workspace=path.join(root,"wrong-tree");
  await assert.rejects(fetchedCheckout(workspace,source,head,previousTree,environment),error=>{
    assert.equal(error.code,"ERR_ASSERTION");assert.equal(error.actual,tree);assert.equal(error.expected,previousTree);return true;
  });
  await assertFetchHead(workspace,head,environment);
  const result=spawnSync("git",["rev-parse","--verify","HEAD"],{cwd:workspace,env:environment,encoding:"utf8",shell:false});
  assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.notEqual(result.status,0);
});
test("BR008 existing wrong commit cannot satisfy the intended candidate tree",async(t)=>{
  const {root,origin,tree,previousHead,previousTree,environment}=await fixture(t),workspace=path.join(root,"wrong-commit");
  await assert.rejects(fetchedCheckout(workspace,origin,previousHead,tree,environment),error=>{
    assert.equal(error.code,"ERR_ASSERTION");assert.equal(error.actual,previousTree);assert.equal(error.expected,tree);return true;
  });
  await assertFetchHead(workspace,previousHead,environment);
  const result=spawnSync("git",["rev-parse","--verify","HEAD"],{cwd:workspace,env:environment,encoding:"utf8",shell:false});
  assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.notEqual(result.status,0);
});
for(const failure of ["wrong-head","missing-source"]) {
  test(`BR008 ${failure} is an actual failed fetch, never an accepted checkout`,async(t)=>{
    const {root,source,head,tree,environment}=await fixture(t),workspace=path.join(root,failure);
    const unavailableHead="0".repeat(40);
    assert.notEqual(unavailableHead,head);
    await assert.rejects(fetchedCheckout(workspace,failure==="missing-source"?path.join(root,"absent-source"):source,failure==="wrong-head"?unavailableHead:head,tree,environment),error=>{
      assert.equal(error.code,"ERR_ASSERTION");
      const observation=JSON.parse(error.message.split("\n")[0]);
      assert.equal(path.resolve(observation.gitDirectory),path.join(workspace,".git"));
      assert.equal(observation.fetch.errorCode,null);assert.equal(observation.fetch.signal,null);
      assert.equal(typeof observation.fetch.status,"number");assert.notEqual(observation.fetch.status,0);
      assert.equal(typeof observation.fetch.stderr,"string");assert.ok(observation.fetch.stderr.length>0);return true;
    });
    const result=spawnSync("git",["rev-parse","--verify","HEAD"],{cwd:workspace,env:environment,encoding:"utf8",shell:false});
    assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.notEqual(result.status,0);
  });
}

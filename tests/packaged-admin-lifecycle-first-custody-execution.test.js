import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseDocument } from "yaml";
import { fetchedCheckout, fixtureGit, fixtureGitEnvironment } from "./helpers/custody-git-fixture.mjs";

const bash=process.platform==="win32"?path.join(process.env.ProgramFiles??"C:\\Program Files","Git","bin","bash.exe"):"bash";
function run(command,args,environment,cwd=process.cwd()) { return spawnSync(command,args,{encoding:"utf8",env:environment,cwd,shell:false}); }
async function firstCustodyStep(name) {
  const source=await readFile(new URL(`../.github/workflows/${name}.yml`,import.meta.url),"utf8"),document=parseDocument(source,{uniqueKeys:true});
  assert.equal(document.errors.length,0,document.errors.map(String).join("\n"));
  const data=document.toJS(),job=data.jobs[name],steps=job.steps, index=steps.findIndex(step=>step.name==="Establish unique qualification custody before dependencies");
  assert.equal(job.env.QUALIFICATION_PLATFORM,name==="packaged-admin-lifecycle"?"${{ matrix.admin_platform }}":"${{ matrix.platform }}");
  assert.ok(data.env.QUALIFICATION_CANDIDATE_SHA);assert.equal(job.env.GIT_CONFIG_COUNT,"1");assert.equal(job.env.GIT_CONFIG_KEY_0,"core.autocrlf");assert.equal(job.env.GIT_CONFIG_VALUE_0,"false");
  assert.ok(steps.findIndex(step=>step.with?.repository==="service-lasso/lasso-serviceadmin")>index,"foreign checkout must follow exact Core custody");
  assert.equal(steps[index].shell,"bash");assert.match(steps[index].run,/^set -euo pipefail$/m);
  return steps[index].run;
}
async function checkout(root) {
  const environment=fixtureGitEnvironment({...process.env,GIT_DIR:path.join(root,"foreign.git"),GIT_WORK_TREE:root,GIT_INDEX_FILE:path.join(root,"foreign-index"),GIT_OBJECT_DIRECTORY:path.join(root,"foreign-objects"),GIT_CONFIG_COUNT:"2",GIT_CONFIG_KEY_0:"core.worktree",GIT_CONFIG_VALUE_0:root});
  for(const key of ["GIT_DIR","GIT_WORK_TREE","GIT_INDEX_FILE","GIT_OBJECT_DIRECTORY","GIT_CONFIG_KEY_1"])assert.equal(environment[key],undefined);
  const head=fixtureGit(["rev-parse","HEAD"],process.cwd(),environment),tree=fixtureGit(["rev-parse",`${head}^{tree}`],process.cwd(),environment);
  return fetchedCheckout(path.join(root,"checkout"),process.cwd(),head,tree,environment);
}
function environment(root,workspace,head,name,attempt="2") { return {...fixtureGitEnvironment(),RUNNER_TEMP:root,GITHUB_RUN_ID:"431",GITHUB_JOB:name,GITHUB_RUN_ATTEMPT:attempt,ADMIN_PLATFORM:process.platform,QUALIFICATION_PLATFORM:process.platform,GITHUB_ENV:path.join(root,`${name}-${attempt}.github-env`),GITHUB_WORKSPACE:workspace,QUALIFICATION_CANDIDATE_SHA:head}; }
function receiptPath(root,name,attempt) { return path.join(root,`${name}-431-${name}-${attempt}-${process.platform}`,"private","initial-receipt.json"); }
// Each required OS runs its actual native platform; no Linux process masquerades
// as Darwin or Windows. Git copies only the exact candidate into a fresh root,
// excluding the test runner's installed dependencies and generated dist.
for(const name of ["packaged-admin-lifecycle","published-package-qualification"]) {
  test(`BR008 ${name} executes actual isolated host-native predependency custody and distinct attempts`,async()=>{
    const script=await firstCustodyStep(name),root=await mkdtemp(path.join(tmpdir(),"workflow-first-custody-"));
    try {
      const {workspace,head,tree}=await checkout(root);
      assert.equal(fixtureGit(["status","--porcelain=v1","--untracked-files=all"],workspace),"");
      for(const attempt of ["2","3"]) {
        const env=environment(root,workspace,head,name,attempt),result=run(bash,["-c",script],env,workspace);assert.equal(result.status,0,result.stderr);
        const receipt=JSON.parse(await readFile(receiptPath(root,name,attempt),"utf8"));assert.equal(receipt.platform,process.platform);assert.equal(receipt.source.head,head);assert.deepEqual(receipt.run,{id:"431",attempt});
        const seal=JSON.parse(await readFile(path.join(path.dirname(receiptPath(root,name,attempt)),"bootstrap-seal.json"),"utf8"));assert.equal(seal.private,true);assert.ok(process.platform==="win32"?seal.commands.length>0:seal.commands.length===0);
        const exported=await readFile(env.GITHUB_ENV,"utf8");for(const key of ["QUALIFICATION_WORKSPACE_ROOT","SERVICE_LASSO_INSTANCE_REGISTRY_PATH","SERVICE_LASSO_HOST_PORT_REGISTRY_PATH","QUALIFICATION_EVIDENCE_ROOT","QUALIFICATION_PRIVATE_CUSTODY_ROOT","QUALIFICATION_INITIAL_RECEIPT_PATH","QUALIFICATION_INITIAL_PROJECTION_PATH"])assert.match(exported,new RegExp(`^${key}=.+`,"m"));
      }
      assert.notEqual(receiptPath(root,name,"2"),receiptPath(root,name,"3"));
      const workflow=parseDocument(await readFile(new URL(`../.github/workflows/${name}.yml`,import.meta.url),"utf8"),{uniqueKeys:true}).toJS();
      const adminScript=workflow.jobs[name].steps.find(step=>step.name==="Bind exact separate Admin checkout before dependencies").run;
      const admin=path.join(workspace,"qualification","admin");await mkdir(path.dirname(admin),{recursive:true});
      await fetchedCheckout(admin,workspace,head,tree);
      const env={...environment(root,workspace,head,name,"2"),ADMIN_HARNESS_REVISION:head},result=run(bash,["-c",adminScript],env,workspace);assert.equal(result.status,0,result.stderr);
      const adminRoot=path.join(root,`admin-harness-custody-431-${name}-2-${process.platform}`),adminReceipt=JSON.parse(await readFile(path.join(adminRoot,"private","initial-receipt.json"),"utf8"));
      assert.equal(adminReceipt.source.head,head);assert.equal(adminReceipt.source.tracked.length,JSON.parse(await readFile(receiptPath(root,name,"2"),"utf8")).source.tracked.length);
      assert.equal(JSON.parse(await readFile(path.join(adminRoot,"evidence","initial-projection.json"),"utf8")).candidate.head,head);
      // The full inventory also rejects ignored foreign input after Git status
      // remains clean; moving checkout cannot become a broad ignore exception.
      await mkdir(path.join(admin,"node_modules"));await writeFile(path.join(admin,"node_modules","foreign.txt"),"unadmitted");
      assert.equal(fixtureGit(["status","--porcelain=v1","--untracked-files=all"],admin),"");
      assert.notEqual(run(bash,["-c",adminScript],{...env,GITHUB_RUN_ATTEMPT:"6"},workspace).status,0);
    }finally{await rm(root,{recursive:true,force:true});}
  });
  test(`BR008 ${name} rejects missing platform, foreign inputs and a cross-platform claim`,async()=>{
    const script=await firstCustodyStep(name),root=await mkdtemp(path.join(tmpdir(),"workflow-first-custody-negative-"));
    try {
      const {workspace,head}=await checkout(root),env=environment(root,workspace,head,name);
      const missing={...env};delete missing.QUALIFICATION_PLATFORM;assert.notEqual(run(bash,["-c",script],missing,workspace).status,0);
      const cross={...env,GITHUB_RUN_ATTEMPT:"4",QUALIFICATION_PLATFORM:process.platform==="linux"?"darwin":"linux"};assert.notEqual(run(bash,["-c",script],cross,workspace).status,0);
      await mkdir(path.join(workspace,"qualification","admin"),{recursive:true});await writeFile(path.join(workspace,"qualification","admin","foreign.txt"),"foreign\n");
      assert.notEqual(run(bash,["-c",script],{...env,GITHUB_RUN_ATTEMPT:"5"},workspace).status,0);
    }finally{await rm(root,{recursive:true,force:true});}
  });
}

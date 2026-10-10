import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { fixtureGit, fixtureGitEnvironment } from "./custody-git-fixture.mjs";
import { validInitialProjection } from "../../scripts/public-first-custody-projection-lib.mjs";

export async function hostCustodyFixture(root, runId, runAttempt) {
  root = await realpath(root);
  const workspace = path.join(root,"source"), custody = path.join(root,"custody"), privateRoot = path.join(custody,"private"), evidence = path.join(custody,"evidence");
  await mkdir(workspace);
  await writeFile(path.join(workspace,"package.json"),"{\"name\":\"host-custody-fixture\"}\n");
  const environment = fixtureGitEnvironment();
  for(const args of [["init"],["config","user.email","fixture@example.invalid"],["config","user.name","fixture"],["add","."],["commit","-m","host custody fixture"]]) fixtureGit(args,workspace,environment);
  const head=fixtureGit(["rev-parse","HEAD"],workspace,environment),tree=fixtureGit(["rev-parse","HEAD^{tree}"],workspace,environment);
  assert.equal(fixtureGit(["status","--porcelain=v1","--untracked-files=all"],workspace,environment),"");
  const env={...environment,RUNNER_TEMP:root,GITHUB_WORKSPACE:workspace,GITHUB_RUN_ID:runId,GITHUB_RUN_ATTEMPT:runAttempt,QUALIFICATION_PLATFORM:process.platform,ADMIN_PLATFORM:process.platform,QUALIFICATION_CANDIDATE_SHA:head,QUALIFICATION_PRIVATE_CUSTODY_ROOT:privateRoot,QUALIFICATION_INITIAL_RECEIPT_PATH:path.join(privateRoot,"initial-receipt.json"),QUALIFICATION_INITIAL_PROJECTION_PATH:path.join(evidence,"initial-projection.json"),QUALIFICATION_EVIDENCE_ROOT:evidence,SERVICE_LASSO_WORKSPACE_ROOT:path.join(custody,"workspace"),SERVICE_LASSO_INSTANCE_REGISTRY_PATH:path.join(custody,"instance-registry.json"),SERVICE_LASSO_HOST_PORT_REGISTRY_PATH:path.join(custody,"host-port-registry.json")};
  for(const [name,args] of [["record-packaged-admin-first-custody.mjs",[]],["project-packaged-admin-first-custody.mjs",["--input",env.QUALIFICATION_INITIAL_RECEIPT_PATH,"--journal",path.join(privateRoot,"first-custody-journal.json"),"--output",env.QUALIFICATION_INITIAL_PROJECTION_PATH]]]) {
    const result=spawnSync(process.execPath,[fileURLToPath(new URL(`../../scripts/${name}`,import.meta.url)),...args],{cwd:workspace,env,encoding:"utf8",shell:false});
    assert.equal(result.status,0,`${result.error?.message??""}\n${result.stderr}`);
  }
  const projection=JSON.parse(await readFile(env.QUALIFICATION_INITIAL_PROJECTION_PATH,"utf8"));
  assert.equal(validInitialProjection(projection,process.platform,runId,runAttempt,head),true);
  assert.deepEqual(projection.candidate,{head,tree});
  const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
  assert.equal(projection.privateInitialReceiptSha256,digest(await readFile(env.QUALIFICATION_INITIAL_RECEIPT_PATH)));
  assert.equal(projection.privateJournalSha256,digest(await readFile(path.join(privateRoot,"first-custody-journal.json"))));
  // Private v3 bytes remain outside all artifact directories.
  assert.equal(JSON.parse(await readFile(env.QUALIFICATION_INITIAL_RECEIPT_PATH,"utf8")).private,true);
  return {env,projection,workspace,privateRoot,evidence};
}

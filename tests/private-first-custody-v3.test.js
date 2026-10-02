import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink, rename, open, realpath, lstat, link } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";
import { sha256, validAcl, darwinCacheHeader, nonReparseDirectory, createExclusiveDirectory, ownership, chain, recheck, exclusiveBytes, regularClosedBytes, regularClosedFile, bootstrapProtocolScript, beginBootstrapCapture, publishAfterBootstrap, closeBootstrapSession } from "../scripts/private-first-custody-v3-lib.mjs";
import { startHeld, heldImageBytes, imageParents, recheckImageParents } from "../scripts/native-tool-journal-v4-lib.mjs";
import { validInitialProjection } from "../scripts/public-first-custody-projection-lib.mjs";
import { fixtureGit, fixtureGitEnvironment } from "./helpers/custody-git-fixture.mjs";

const exec = promisify(execFile);
const producer = new URL("../scripts/record-packaged-admin-first-custody.mjs", import.meta.url);
const projector = new URL("../scripts/project-packaged-admin-first-custody.mjs", import.meta.url);
// Reseal the outer hashes so a semantic adversary reaches the inner predicate.
async function reseal(f) {
  const journalPath=path.join(f.privateRoot,"first-custody-journal.json"), receiptPath=f.env.QUALIFICATION_INITIAL_RECEIPT_PATH;
  const journalBytes=await readFile(journalPath), receipt=JSON.parse(await readFile(receiptPath,"utf8"));
  receipt.journal.file={size:journalBytes.length,sha256:sha256(journalBytes)};
  const receiptBytes=JSON.stringify(receipt)+"\n";await writeFile(receiptPath,receiptBytes);
  const sealPath=path.join(f.privateRoot,"bootstrap-seal.json"), seal=JSON.parse(await readFile(sealPath,"utf8"));
  seal.receiptSha256=sha256(receiptBytes);seal.journalSha256=sha256(journalBytes);await writeFile(sealPath,JSON.stringify(seal)+"\n");
}
async function command(file, args, cwd, env) { return exec(process.execPath, [fileURLToPath(file), ...args], { cwd, env, windowsHide: true }); }
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "service-lasso-private-v3-")));
  const workspace = path.join(root, "checkout"), custody = path.join(root, "custody"), runtime = path.join(custody, "workspace"), privateRoot = path.join(custody, "private"), evidence = path.join(custody, "evidence");
  await mkdir(path.join(workspace, "native"), { recursive: true });
  await writeFile(path.join(workspace, "native", "asset.cs"), "sealed-native-source\n");
  await writeFile(path.join(workspace,"native","binary.bin"),Buffer.from([0,255,128,10,0,13]));
  await writeFile(path.join(workspace, "package.json"), "{\"name\":\"private-v3-fixture\"}\n");
  const gitEnvironment = fixtureGitEnvironment();
  fixtureGit(["init"], workspace, gitEnvironment);
  await exec("git", ["config", "user.email", "fixture@example.invalid"], { cwd: workspace, env: gitEnvironment });
  await exec("git", ["config", "user.name", "fixture"], { cwd: workspace, env: gitEnvironment });
  await exec("git", ["add", "."], { cwd: workspace, env: gitEnvironment }); await exec("git", ["commit", "-m", "fixture"], { cwd: workspace, env: gitEnvironment });
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: workspace, env: gitEnvironment });
  return { root, workspace, privateRoot, evidence, env: { ...gitEnvironment, QUALIFICATION_PLATFORM: process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux", GITHUB_RUN_ID: "42", GITHUB_RUN_ATTEMPT: "1", GITHUB_WORKSPACE: workspace, QUALIFICATION_CANDIDATE_SHA: stdout.trim(), QUALIFICATION_PRIVATE_CUSTODY_ROOT: privateRoot, QUALIFICATION_INITIAL_RECEIPT_PATH: path.join(privateRoot, "initial-receipt.json"), QUALIFICATION_INITIAL_PROJECTION_PATH: path.join(evidence,"initial-projection.json"), QUALIFICATION_EVIDENCE_ROOT: evidence, SERVICE_LASSO_WORKSPACE_ROOT: runtime, SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(custody, "instance-registry.json"), SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(custody, "host-port-registry.json") } };
}
async function produce(f) { await command(producer, [], f.workspace, f.env); await command(projector, ["--input", f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "--journal", path.join(f.privateRoot, "first-custody-journal.json"), "--output", path.join(f.evidence, "initial-projection.json")], f.workspace, f.env); }
function publicFixture(f){return {schema:"service-lasso.qualification-first-custody-projection.v2",privateVersion:"v3",candidate:{head:f.env.QUALIFICATION_CANDIDATE_SHA,tree:"a".repeat(40)},platform:process.platform,run:{id:"42",attempt:"1"},privateInitialReceiptSha256:"a".repeat(64),privateJournalSha256:"b".repeat(64),localValidatorAttestation:{schema:"service-lasso.qualification-local-validator-attestation.v2",validated:true}};}
async function absentPublic(target){assert.equal(await lstat(target).catch(error=>error.code==="ENOENT"?null:Promise.reject(error)),null);}
test("BR008 terminal bootstrap and stage/seal write or fsync failures never publish a validated projection",async()=>{
  const scenarios=["seal-exists","stage-write","stage-fsync","seal-write","seal-fsync","public-link"];
  if(process.platform==="win32")scenarios.push("terminal-nonzero","terminal-signal","terminal-eof","terminal-raw-mismatch");
  for(const scenario of scenarios){const f=await fixture();try{
    await command(producer,[],f.workspace,f.env);
    const target=f.env.QUALIFICATION_INITIAL_PROJECTION_PATH;
    if(scenario==="seal-exists")await writeFile(path.join(f.privateRoot,"validator-bootstrap-seal.json"),"retained collision\n");
    beginBootstrapCapture();
    const io={link:async(...args)=>{if(scenario==="public-link")throw new Error("injected_public_link");return link(...args);},open:async(file,...args)=>{
      const handle=await open(file,...args),stage=path.basename(file)==="validator-projection.staged.json",failWrite=scenario===(stage?"stage-write":"seal-write"),failSync=scenario===(stage?"stage-fsync":"seal-fsync");
      return new Proxy(handle,{get(object,key){if(key==="writeFile"&&failWrite)return async()=>{await handle.writeFile("partial private bytes");throw new Error("injected_write");};if(key==="sync"&&failSync)return async()=>{throw new Error("injected_fsync");};const value=Reflect.get(object,key,object);return typeof value==="function"?value.bind(object):value;}});
    },beforeTerminal:async session=>{
      if(!scenario.startsWith("terminal-"))return;assert.ok(session,"actual Windows validator-owned bootstrap must exist");assert.equal(session.probe.native.pid,session.probe.child.pid);
      if(scenario==="terminal-nonzero")session.probe.child.stdin.write("{}\n");
      if(scenario==="terminal-signal"){assert.equal(session.probe.child.kill(),true);await session.probe.closed;}
      if(scenario==="terminal-eof")session.probe.child.stdout.destroy();
      if(scenario==="terminal-raw-mismatch")session.results.push(Buffer.from("unobserved extra result\n"));
    }};
    const expected=scenario==="seal-exists"?/EEXIST/u:scenario.startsWith("terminal-")?/first_custody_bootstrap_terminal_closure_invalid/u:scenario==="public-link"?/injected_public_link/u:scenario.endsWith("write")?/injected_write/u:/injected_fsync/u;
    await assert.rejects(publishAfterBootstrap(f.privateRoot,target,publicFixture(f),path.join(f.privateRoot,"first-custody-journal.json"),f.evidence,io),expected);
    await absentPublic(target);
  }finally{await rm(f.root,{recursive:true,force:true});}}
});
test("BR008 actual projector seal collision leaves no eligible public output",async()=>{
  const f=await fixture();try{await command(producer,[],f.workspace,f.env);await writeFile(path.join(f.privateRoot,"validator-bootstrap-seal.json"),"retained prior seal\n");await assert.rejects(command(projector,["--input",f.env.QUALIFICATION_INITIAL_RECEIPT_PATH,"--journal",path.join(f.privateRoot,"first-custody-journal.json"),"--output",f.env.QUALIFICATION_INITIAL_PROJECTION_PATH],f.workspace,f.env),/EEXIST/u);await absentPublic(f.env.QUALIFICATION_INITIAL_PROJECTION_PATH);}finally{await rm(f.root,{recursive:true,force:true});}
});
test("BR008 an independently owned process crash after private seal and before public commit leaves no projection",async()=>{
  const f=await fixture();try{
    await command(producer,[],f.workspace,f.env);
    const moduleUrl=new URL("../scripts/private-first-custody-v3-lib.mjs",import.meta.url).href,harness=path.join(f.root,"owned-crash.mjs");
    await writeFile(harness,`import {open} from 'node:fs/promises';import {beginBootstrapCapture,publishAfterBootstrap} from ${JSON.stringify(moduleUrl)};beginBootstrapCapture();await publishAfterBootstrap(${JSON.stringify(f.privateRoot)},${JSON.stringify(f.env.QUALIFICATION_INITIAL_PROJECTION_PATH)},${JSON.stringify(publicFixture(f))},${JSON.stringify(path.join(f.privateRoot,"first-custody-journal.json"))},${JSON.stringify(f.evidence)},{open,link:()=>process.exit(42)});`);
    await assert.rejects(exec(process.execPath,[harness],{cwd:f.workspace,env:f.env,windowsHide:true}),error=>error.code===42);
    assert.ok(await lstat(path.join(f.privateRoot,"validator-bootstrap-seal.json")));await absentPublic(f.env.QUALIFICATION_INITIAL_PROJECTION_PATH);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test("BR008 actual owned native terminal stderr and raw mismatch cannot satisfy validator closure",{skip:process.platform!=="win32"},async()=>{
  const requested=path.join(process.env.SystemRoot,"System32","WindowsPowerShell","v1.0","powershell.exe"),resolved=await realpath(requested),tool={name:"powershell",requested,resolved,file:await regularClosedFile(resolved,path.parse(resolved).root)};
  for(const scenario of ["valid","stderr","raw-mismatch"]){
    const script="$null=[Console]::In.ReadLine();"+(scenario==="stderr"?"[Console]::Error.Write('unexpected stderr');":"[Console]::Out.Write('observed');"),probe=await startHeld(tool,["-NoLogo","-NoProfile","-NonInteractive","-Command",script],process.cwd()),session={tool,args:["-NoLogo","-NoProfile","-NonInteractive","-Command",script],probe,requests:[],results:scenario==="valid"?[Buffer.from("observed")]:[]};
    if(scenario==="valid"){const closed=await closeBootstrapSession(session);assert.equal(closed.result.exitCode,0);assert.equal(closed.result.stdoutEof,true);assert.equal(closed.result.stderrEof,true);}else await assert.rejects(closeBootstrapSession(session),/first_custody_bootstrap_terminal_closure_invalid/u);
  }
});
test("BR008 Windows coherently resealed helper library substitution reaches requested physical resolution",{skip:process.platform!=="win32"},async()=>{
  const valid=await fixture();try{await produce(valid);assert.equal(validInitialProjection(JSON.parse(await readFile(valid.env.QUALIFICATION_INITIAL_PROJECTION_PATH,"utf8")),"win32","42","1",valid.env.QUALIFICATION_CANDIDATE_SHA),true);}finally{await rm(valid.root,{recursive:true,force:true});}
  for(const scope of ["journal","bootstrap"]){const f=await fixture();try{
    await command(producer,[],f.workspace,f.env);
    const journalPath=path.join(f.privateRoot,"first-custody-journal.json"),sealPath=path.join(f.privateRoot,"bootstrap-seal.json"),journal=JSON.parse(await readFile(journalPath,"utf8")),seal=JSON.parse(await readFile(sealPath,"utf8")),helper=(scope==="journal"?journal.commands[0]:seal.session).native.helper;
    const resolved=await realpath(process.execPath),file=await regularClosedFile(resolved,path.parse(resolved).root),library=helper.libraries[0];assert.notEqual(await realpath(library.requested),resolved);
    Object.assign(library,{resolved,...file});
    for(const probe of [helper.first,helper.second]){const raw=JSON.parse(Buffer.from(probe.stdout.data).toString("utf8"));raw.libraryFiles[0]={...library};const bytes=Buffer.from(JSON.stringify(raw));probe.stdout=bytes;probe.stdoutSha256=sha256(bytes);}
    await writeFile(journalPath,JSON.stringify(journal)+"\n");await writeFile(sealPath,JSON.stringify(seal)+"\n");await reseal(f);
    await assert.rejects(command(projector,["--input",f.env.QUALIFICATION_INITIAL_RECEIPT_PATH,"--journal",journalPath,"--output",f.env.QUALIFICATION_INITIAL_PROJECTION_PATH],f.workspace,f.env),/first_custody_validator_helper_library_alias_changed/u);await absentPublic(f.env.QUALIFICATION_INITIAL_PROJECTION_PATH);
  }finally{await rm(f.root,{recursive:true,force:true});}}
});
test("BR008 native and bootstrap held image reader rejects real persistent and changed physical parents",async()=>{
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),"native-held-parent-")));
  try{
    const parent=path.join(root,"parent"),retained=path.join(root,"retained"),alias=path.join(root,"alias");await mkdir(parent);const file=path.join(parent,"library");await writeFile(file,"verified bytes");
    assert.equal((await heldImageBytes(file)).toString(),"verified bytes");
    await symlink(parent,alias,process.platform==="win32"?"junction":"dir");await assert.rejects(heldImageBytes(path.join(alias,"library")),/first_custody_native_reparse_parent/u);
    const snapshot=await imageParents(file);await rename(parent,retained);await mkdir(parent);await writeFile(file,"verified bytes");await assert.rejects(recheckImageParents(snapshot),/first_custody_native_parent_changed/u);
    await assert.rejects(heldImageBytes(file,{open:async(target,flags)=>{const handle=await open(target,flags);await rename(parent,path.join(root,"opened-parent"));await symlink(path.join(root,"opened-parent"),parent,process.platform==="win32"?"junction":"dir");return handle;}}),/first_custody_native_parent_changed/u);
  }finally{await rm(root,{recursive:true,force:true});}
});
test("BR008 held reader rejects an actual open-time object substitution restored before its named postcheck", async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),"custody-held-named-"));
  try {
    const file=path.join(root,"source"), retained=path.join(root,"retained"), substitute=path.join(root,"substitute");
    await writeFile(file,"original");await writeFile(substitute,"different");
    assert.equal((await regularClosedBytes(file,root)).toString(),"original");
    await assert.rejects(regularClosedBytes(file,root,{open:async(target,flags)=>{
      await rename(target,retained);await rename(substitute,target);const handle=await open(target,flags);
      await rename(target,substitute);await rename(retained,target);return handle;
    }}),/first_custody_held_not_named_file/u);
    assert.equal(await readFile(file,"utf8"),"original");
  } finally { await rm(root,{recursive:true,force:true}); }
});
  for(const mutation of ["head","tree","currentHead","index","metadata","nodeVersion","nativeDigest","toolName","requested","runner","run","platform","runtime","registryDuplicate","registrySwap","registryParent","expectedRegistryPresent","gitRawBody","gitRawHeader","compilerVersion","compilerScript","helperPid","helperScript","helperActualChild","bootstrapScript","bootstrapRaw","bootstrapEof","bootstrapExit","bootstrapOrder","bootstrapRequest","bootstrapMissing"]) {
  test(`BR008 independently established coherent ${mutation} substitution is rejected`, async () => {
    const f=await fixture();
    try {
      await command(producer,[],f.workspace,f.env);
      const receiptPath=f.env.QUALIFICATION_INITIAL_RECEIPT_PATH,journalPath=path.join(f.privateRoot,"first-custody-journal.json"),sealPath=path.join(f.privateRoot,"bootstrap-seal.json"),receipt=JSON.parse(await readFile(receiptPath,"utf8")),journal=JSON.parse(await readFile(journalPath,"utf8")),seal=JSON.parse(await readFile(sealPath,"utf8"));
      const before=structuredClone({receipt,journal,seal});
      if(mutation==="head")receipt.source.head="0".repeat(40);
      if(mutation==="tree")receipt.source.tree="0".repeat(40);
      if(mutation==="currentHead"){await writeFile(path.join(f.workspace,".git","HEAD"),"f".repeat(40)+"\n");assert.equal(await readFile(path.join(f.workspace,".git","HEAD"),"utf8"),"f".repeat(40)+"\n");}
      if(mutation==="index") {
        const wrong=path.join(f.root,"wrong-index-blob.json");await writeFile(wrong,"{\"name\":\"wrong-index-object\"}\n");
        const oid=fixtureGit(["hash-object","-w",wrong],f.workspace,f.env);
        assert.match(oid,/^[0-9a-f]{40}$/u);assert.notEqual(oid,"0".repeat(40));
        const original=fixtureGit(["rev-parse","HEAD:package.json"],f.workspace,f.env);assert.notEqual(oid,original);
        fixtureGit(["update-index","--cacheinfo","100644",oid,"package.json"],f.workspace,f.env);
        assert.equal(fixtureGit(["ls-files","--stage","package.json"],f.workspace,f.env),`100644 ${oid} 0\tpackage.json`);
        assert.equal(fixtureGit(["cat-file","-p",oid],f.workspace,f.env),"{\"name\":\"wrong-index-object\"}");
      }
      if(mutation==="metadata"){fixtureGit(["config","fixture.drift","true"],f.workspace,f.env);assert.equal(fixtureGit(["config","--get","fixture.drift"],f.workspace,f.env),"true");}
      if(mutation==="nodeVersion")journal.toolMetadata.nodeVersion="v0.0.0";
      if(mutation==="nativeDigest")journal.commands[0].native.imageSha256="0".repeat(64);
      if(mutation==="toolName")receipt.tools[0].name="node";
      if(mutation==="requested")receipt.tools[0].requested=receipt.tools[1].requested;
      if(mutation==="runner")receipt.runner.nativeBirthCustody="UNOBSERVED";
      if(mutation==="run")receipt.run.attempt="2";
      if(mutation==="platform")receipt.platform=process.platform==="linux"?"darwin":"linux";
      if(mutation==="runtime")receipt.roots.workspaceRoot={...receipt.roots.privateRoot};
      if(mutation==="registryDuplicate")receipt.registries[1]=receipt.registries[0];
      if(mutation==="registrySwap")receipt.registries.reverse();
      if(mutation==="registryParent")receipt.registries[0].parent={...receipt.roots.privateRoot};
      if(mutation==="expectedRegistryPresent"){await writeFile(f.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH,"present");receipt.registries[0].path=path.join(path.dirname(f.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH),"substitute-absent.json");}
      if(mutation==="gitRawBody"||mutation==="gitRawHeader"){const file=path.join(f.privateRoot,"journal-0.stdout"),bytes=await readFile(file);if(mutation==="gitRawHeader")bytes[0]=bytes[0]===48?49:48;else {const index=bytes.indexOf(Buffer.from("sealed-native-source"));assert.ok(index>=0);bytes[index]=88;}await writeFile(file,bytes);journal.commands[0].result.stdout={size:bytes.length,sha256:sha256(bytes)};}
      if(mutation==="compilerVersion"||mutation==="compilerScript"){if(process.platform!=="win32"){assert.equal(journal.toolMetadata.csc,null);return;}assert.ok(journal.toolMetadata.csc,"actual Windows compiler metadata must be retained");if(mutation==="compilerVersion")journal.toolMetadata.csc.observation.version.FileVersion="forged";else journal.commands[2].command.args[4]+=";exit 0";}
      if(mutation==="helperPid"||mutation==="helperScript"||mutation==="helperActualChild") { const helper=journal.commands[0].native.helper;if(process.platform==="linux"){assert.equal(helper,null);return;}assert.ok(helper);if(mutation==="helperPid")helper.first.spawnedPid+=1;else if(mutation==="helperScript")helper.scriptSha256="0".repeat(64);else {const raw=JSON.parse(Buffer.from(helper.first.stdout.data).toString("utf8"));raw.self.pid+=1;raw.self.chain[0].pid=raw.self.pid;helper.first.selfIdentity={...raw.self.chain[0]};const bytes=Buffer.from(JSON.stringify(raw));helper.first.stdout=bytes;helper.first.stdoutSha256=sha256(bytes);} }
      if(mutation.startsWith("bootstrap")) {
        if(process.platform!=="win32"){assert.equal(seal.session,null);assert.equal(seal.commands.length,0);return;}
        assert.ok(seal.commands.length);const probe=seal.commands[0];
        if(mutation==="bootstrapScript")seal.session.args[4]+=";exit 0";
        if(mutation==="bootstrapRaw"){probe.stdout=Buffer.from("{}\n");probe.stdoutSha256=sha256("{}\n");}
        if(mutation==="bootstrapEof")seal.session.result.stdoutEof=false;
        if(mutation==="bootstrapExit")seal.session.result.exitCode=1;
        if(mutation==="bootstrapOrder")seal.commands.reverse();
        if(mutation==="bootstrapRequest")probe.target=path.join(f.root,"substitute");
        if(mutation==="bootstrapMissing")seal.commands=seal.commands.filter(probe=>probe.purpose!=="acl_read");
      }
      if(!["currentHead","index","metadata"].includes(mutation))assert.notDeepEqual({receipt,journal,seal},before,`${mutation} must establish its actual adversary before reseal`);
      await writeFile(receiptPath,JSON.stringify(receipt)+"\n");await writeFile(journalPath,JSON.stringify(journal)+"\n");await writeFile(sealPath,JSON.stringify(seal)+"\n");await reseal(f);
      await assert.rejects(command(projector,["--input",receiptPath,"--journal",journalPath,"--output",f.env.QUALIFICATION_INITIAL_PROJECTION_PATH],f.workspace,f.env));
    }finally{await rm(f.root,{recursive:true,force:true});}
  });
}
test("BR008 projector requires literal workspace and candidate configuration", async()=>{
  const f=await fixture();try {
    await command(producer,[],f.workspace,f.env);
    for(const key of ["GITHUB_WORKSPACE","QUALIFICATION_CANDIDATE_SHA","QUALIFICATION_PRIVATE_CUSTODY_ROOT","SERVICE_LASSO_WORKSPACE_ROOT"]){const env={...f.env};delete env[key];await assert.rejects(command(projector,["--input",f.env.QUALIFICATION_INITIAL_RECEIPT_PATH,"--journal",path.join(f.privateRoot,"first-custody-journal.json"),"--output",f.env.QUALIFICATION_INITIAL_PROJECTION_PATH],f.workspace,env),new RegExp(key.toLowerCase()+"_missing","u"));}
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test("BR008 actual native bootstrap protocol closes valid, invalid-request and owned-crash streams on its host", async()=>{
  if(process.platform!=="win32"){assert.ok(["linux","darwin"].includes(process.platform));return;}
  const root=await mkdtemp(path.join(os.tmpdir(),"bootstrap-protocol-native-"));
  try {
    const requested=path.join(process.env.SystemRoot,"System32","WindowsPowerShell","v1.0","powershell.exe"),resolved=await realpath(requested),tool={name:"powershell",requested,resolved,file:await regularClosedFile(resolved,path.parse(resolved).root)};
    for(const scenario of ["valid","unknown-purpose","malformed","owned-crash"]){
      const held=await startHeld(tool,["-NoLogo","-NoProfile","-NonInteractive","-Command",bootstrapProtocolScript()],process.cwd());
      assert.equal(held.native.pid,held.child.pid);for(const probe of [held.native.helper.first,held.native.helper.second])assert.equal(probe.spawnedPid,probe.selfIdentity.pid);
      if(scenario==="owned-crash")assert.equal(held.child.kill(),true);
      else held.child.stdin.end(scenario==="malformed"?"{\n":JSON.stringify({purpose:scenario==="valid"?"reparse":"unknown",target:root})+"\n");
      const closed=await held.closed;assert.equal(closed.stdoutEof,true);assert.equal(closed.stderrEof,true);
      if(scenario==="valid"){assert.equal(closed.exitCode,0);assert.equal(closed.signal,null);assert.equal(JSON.parse(closed.stdout.toString()).reparse,false);assert.equal(closed.stderr.length,0);}
      else assert.ok(closed.exitCode!==0||closed.signal!==null,scenario);
    }
  }finally{await rm(root,{recursive:true,force:true});}
});
test("BR008 private v3 producer holds an observed native Git protocol and projects only closed identifiers", async () => {
  const f = await fixture(); try { await produce(f); const publicSource = await readFile(path.join(f.evidence, "initial-projection.json"), "utf8"); const privateSource = await readFile(f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "utf8"); const pub = JSON.parse(publicSource), priv = JSON.parse(privateSource);
    assert.equal(priv.schema, "service-lasso.qualification-initial-receipt.v3"); assert.equal(priv.source.tracked.length, 3); assert.equal(priv.runner.nativeBirthCustody, "HELD_NATIVE_V1"); const journal=JSON.parse(await readFile(priv.journal.path,"utf8"));assert.match(journal.commands[0].native.id,/^native-/u); assert.equal(pub.privateVersion, "v3"); assert.deepEqual(Object.keys(pub.localValidatorAttestation).sort(), ["schema", "validated"]); assert.equal(pub.privateInitialReceiptSha256, sha256(privateSource)); assert.equal(publicSource.includes(f.workspace), false); assert.equal(publicSource.includes("journal-0.stdout"), false); assert.equal(publicSource.includes("pid"), false);
    const validatorSeal=JSON.parse(await readFile(path.join(f.privateRoot,"validator-bootstrap-seal.json"),"utf8"));assert.equal(validatorSeal.receiptSha256,sha256(publicSource));assert.equal(await readFile(path.join(f.privateRoot,"validator-projection.staged.json"),"utf8"),publicSource);assert.ok(process.platform==="win32"?validatorSeal.session.result.naturalWaitForExit&&validatorSeal.session.result.exitCode===0&&validatorSeal.session.result.stdoutEof&&validatorSeal.session.result.stderrEof:validatorSeal.session===null);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("BR008 validator rejects workspace/native state, registry, journal, native witness, raw output, duplicate JSON and output-boundary tampering", async () => {
  for (const mutation of ["tracked", "registry", "journal", "native", "raw", "eof", "duplicate", "output", "blob", "extra", "compiler", "parent", "lineage", "order", "tool", "caller", "birth", "pidReuse", "helper", "helperLibrary", "helperSelf", "helperTarget", "privacy"]) { const f = await fixture(); try { await produce(f);
      if (mutation === "tracked") await writeFile(path.join(f.workspace, "native", "asset.cs"), "tampered\n");
      if (mutation === "registry") await writeFile(f.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH, "present\n");
      if (mutation === "journal") await writeFile(path.join(f.privateRoot, "first-custody-journal.json"), "{\"schema\":\"service-lasso.qualification-first-custody-journal.v3\",\"private\":true,\"commands\":[],\"toolMetadata\":{}}\n");
      if (mutation === "native") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands[0].native.birthObserved = false; await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
      if (mutation === "raw") await writeFile(path.join(f.privateRoot, "journal-0.stdout"), "forged output\n");
      if (mutation === "blob") { const receipt = JSON.parse(await readFile(f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "utf8")); receipt.source.tracked[0].gitBlob = "0".repeat(40); await writeFile(f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, JSON.stringify(receipt) + "\n"); }
      if (mutation === "extra") await writeFile(path.join(f.workspace, "untracked-extra.txt"), "untracked\n");
      if (mutation === "compiler") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.toolMetadata.sourceStatus = "CLEAN_BY_HEAD_TREE_AND_TRACKED_BYTES"; await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
      if (mutation === "parent") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands[0].native.parents[0].pid = 1; await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
       if (mutation === "lineage") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands[0].native.parents[0].ppid = journal.commands[0].native.parents.at(-1).pid; await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
       if (mutation === "caller") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands[0].native.sourceCaller.imageSha256 = "0".repeat(64); await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
       if (mutation === "birth") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands[0].native.parents[0].birth = "0"; await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
       if (mutation === "pidReuse") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands[0].native.parents[1].pid = journal.commands[0].native.parents[0].pid; await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
       if (mutation === "helper") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands[0].native.helper = { platform: "win32" }; await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
       if (mutation === "helperLibrary") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands[0].native.helper = { platform: "darwin", executable: "/bin/false", executableSha256: "0".repeat(64), scriptSha256: "0".repeat(64), scriptBytes: 1, libraries: [], first: {}, second: {} }; await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
       if (mutation === "helperSelf" || mutation === "helperTarget") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")), helper = journal.commands[0].native.helper; if (!helper) journal.commands[0].native.birthObserved = false; else { const raw = JSON.parse(Buffer.from(helper.first.stdout.data).toString("utf8")); if (mutation === "helperSelf") raw.self.chain[0].birth = "0"; else raw.target.chain[0].imageSha256 = "0".repeat(64); const bytes = Buffer.from(JSON.stringify(raw)); helper.first.stdout = bytes; helper.first.stdoutSha256 = sha256(bytes); } await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
       if (mutation === "eof") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands[1].result.stdoutEof = false; await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
       if (mutation === "tool") { const receipt = JSON.parse(await readFile(f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "utf8")); receipt.tools[0].file.sha256 = "0".repeat(64); await writeFile(f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, JSON.stringify(receipt) + "\n"); }
      if (mutation === "order") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands.reverse(); await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
      if (mutation === "duplicate") await writeFile(f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "{\"schema\":\"x\",\"schema\":\"x\"}\n");
      if(!["duplicate","raw"].includes(mutation))await reseal(f);
      const target = mutation === "output" ? path.join(f.evidence, "initial-projection.json") : mutation === "privacy" ? path.join(f.evidence, "private", "initial-projection.json") : path.join(f.evidence, mutation + ".json");
      await assert.rejects(command(projector, ["--input", f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "--journal", path.join(f.privateRoot, "first-custody-journal.json"), "--output", target], f.workspace, { ...f.env, QUALIFICATION_INITIAL_PROJECTION_PATH:target }));
    } finally { await rm(f.root, { recursive: true, force: true }); } }
});
// Policy models cover SID deduplication; they do not claim a SYSTEM token exists.
test("BR008 exact Windows SID policy accepts unique ordinary/SYSTEM/Admin sets and rejects effective ACE drift", () => {
  for (const current of ["S-1-5-21-123-456-789-1001", "S-1-5-18", "S-1-5-32-544"]) {
    const proof = { owner: current, current, protected: true, rules: [...new Set([current, "S-1-5-18", "S-1-5-32-544"])].map(sid => ({ sid, type: "Allow", rights: 2032127, inherited: false, inheritance: 3, propagation: 0 })) };
    assert.equal(validAcl(proof), true);
    for (const mutate of [
      p => p.rules.push({ ...p.rules[0] }),
      p => p.rules[0].sid = "S-1-1-0",
      p => p.rules[0].sid = "S-1-5-21-999-999-999-999",
      p => p.rules[0].inherited = true,
      p => p.rules[0].rights = 2,
      p => p.rules[0].inheritance = 0,
      p => p.rules[0].propagation = 1,
      p => p.rules[0].type = "Deny",
      p => p.protected = false,
      p => p.owner = "S-1-1-0"
    ]) { const changed = structuredClone(proof); mutate(changed); assert.equal(validAcl(changed), false); }
  }
});
test("BR008 directory boundary rejects an actual symlink or Windows junction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "custody-parent-"));
  try {
    const actual = path.join(root, "actual"), alias = path.join(root, "alias");
    await mkdir(actual);
    await symlink(actual, alias, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(nonReparseDirectory(alias, root));
    await mkdir(path.join(actual, "child"));
    await assert.rejects(nonReparseDirectory(path.join(alias, "child"), root));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("BR008 Darwin complete cache mutations fail despite coherently resealed journal and receipt", { skip: process.platform !== "darwin" }, async () => {
  const valid=await fixture();
  try{await produce(valid);assert.equal(validInitialProjection(JSON.parse(await readFile(valid.env.QUALIFICATION_INITIAL_PROJECTION_PATH,"utf8")),"darwin","42","1",valid.env.QUALIFICATION_CANDIDATE_SHA),true);assert.ok(await lstat(path.join(valid.privateRoot,"validator-bootstrap-seal.json")));}finally{await rm(valid.root,{recursive:true,force:true});}
  for (const scenario of ["cachePath", "loadedImageUuid", "cacheUuid", "cacheHeaderUuid", "cacheHeaderSha256", "cacheHeaderSha256:raw", "cacheUuid:raw"]) {
    const key = scenario.split(":")[0];
    const f = await fixture();
    try {
      // Producer only: the validator's terminal seal must still be absent.
      await command(producer,[],f.workspace,f.env);
      const journalPath = path.join(f.privateRoot, "first-custody-journal.json");
      const journal = JSON.parse(await readFile(journalPath, "utf8"));
      for (const command of journal.commands) {
        const library = command.native.helper.libraries[0];
        library[key] = key === "cachePath" ? "/System/forged-cache" : "0".repeat(key === "cacheHeaderSha256" ? 64 : 32);
        if (key === "cacheUuid") library.cacheHeaderUuid = library.cacheUuid;
        if (key === "cacheHeaderUuid") library.cacheUuid = library.cacheHeaderUuid;
        if (scenario.endsWith(":raw")) for (const probe of [command.native.helper.first, command.native.helper.second]) {
          const raw = JSON.parse(Buffer.from(probe.stdout.data).toString("utf8")); raw.dyldCache = { ...library }; const bytes = Buffer.from(JSON.stringify(raw)); probe.stdout = bytes; probe.stdoutSha256 = sha256(bytes);
        }
      }
      const bytes = JSON.stringify(journal) + "\n";
      await writeFile(journalPath, bytes);
      await reseal(f);
      const target=path.join(f.evidence,scenario.replace(":","-")+".json");
      const intended=scenario.endsWith(":raw")?/first_custody_validator_darwin_cache_header_mismatch/u:/first_custody_validator_darwin_cache_witness_invalid/u;
      await assert.rejects(command(projector, ["--input", f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "--journal", journalPath, "--output", target], f.workspace, { ...f.env, QUALIFICATION_INITIAL_PROJECTION_PATH:target }),intended);
      assert.equal(await lstat(target).catch(error=>error.code==="ENOENT"?null:Promise.reject(error)),null,scenario);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});
test("BR008 Darwin held cache header refuses non-OS writable fixtures and physical aliases", { skip: process.platform !== "darwin" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "custody-cache-"));
  try {
    const file = path.join(root, "cache"), alias = path.join(root, "alias");
    const header = Buffer.alloc(104); header.write("dyld_"); await writeFile(file, header);
    await assert.rejects(darwinCacheHeader(file));
    await symlink(file, alias);
    await assert.rejects(darwinCacheHeader(alias));
  } finally { await rm(root, { recursive: true, force: true }); }
});
// This exercises the actual current Windows identity; SYSTEM/Admin policy models above
// are explicitly not substitutes for native receipts under those tokens.
test("BR008 native Windows owned root rejects broad foreign and inherited ACL writers", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "custody-acl-"));
  const powershell = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  try {
    for (const sid of ["S-1-1-0", "S-1-5-32-545"]) {
      const directory = path.join(root, sid);
      await createExclusiveDirectory(directory, root);
      await ownership(directory, root);
      const script = "$ErrorActionPreference='Stop';$p=$env:SERVICE_LASSO_CUSTODY_TARGET;$i=Get-Item -LiteralPath $p;$a=$i.GetAccessControl();$a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($env:SERVICE_LASSO_TEST_SID,'Write','Allow')));$i.SetAccessControl($a)";
      await exec(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, env: { ...process.env, SERVICE_LASSO_CUSTODY_TARGET: directory, SERVICE_LASSO_TEST_SID: sid } });
      await assert.rejects(ownership(directory, root));
    }
    const directory = path.join(root, "inherited");
    await createExclusiveDirectory(directory, root);
    const script = "$ErrorActionPreference='Stop';$i=Get-Item -LiteralPath $env:SERVICE_LASSO_CUSTODY_TARGET;$a=$i.GetAccessControl();$a.SetAccessRuleProtection($false,$true);$i.SetAccessControl($a)";
    await exec(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, env: { ...process.env, SERVICE_LASSO_CUSTODY_TARGET: directory } });
    await assert.rejects(ownership(directory, root));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("BR008 actual directory parent replacement invalidates its retained identity snapshot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "custody-replace-"));
  try {
    const parent = path.join(root, "parent");
    await mkdir(parent);
    const snapshot = await chain(parent, root);
    await rename(parent, path.join(root, "retained-original"));
    await mkdir(parent);
    await assert.rejects(recheck(snapshot), /first_custody_parent_replaced/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("BR008 own mkdir and exclusive writes preserve retained directory object identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "custody-own-mutation-"));
  try {
    const directory = path.join(root, "private");
    const before = await chain(root, root);
    const original = await createExclusiveDirectory(directory, root);
    await recheck(before);
    const snapshot = await chain(directory, root);
    await createExclusiveDirectory(path.join(directory, "child"), root);
    const file = await exclusiveBytes(path.join(directory, "raw.stdout"), Buffer.from("closed raw output"), directory);
    await recheck(snapshot);
    const after = await ownership(directory, root);
    assert.deepEqual(after, original);
    assert.equal(file.size, Buffer.byteLength("closed raw output"));
    assert.equal(file.sha256, sha256("closed raw output"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("BR008 projector rejects actual retained root replacement after legitimate producer writes", async () => {
  const f = await fixture();
  try {
    await command(producer, [], f.workspace, f.env);
    await rename(f.evidence, f.evidence + "-retained-original");
    await createExclusiveDirectory(f.evidence, path.dirname(f.privateRoot));
    await assert.rejects(command(projector, ["--input", f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "--journal", path.join(f.privateRoot, "first-custody-journal.json"), "--output", path.join(f.evidence, "initial-projection.json")], f.workspace, f.env), /first_custody_validator_root_changed/u);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

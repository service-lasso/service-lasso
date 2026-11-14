#!/usr/bin/env node
// Ordinary source/API smoke fixture; never native/package qualification.
import {createPrivateDirectory,writePrivateFile} from './operator-e2e-fixture-private.mjs';
import {spawn,spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile,readdir,unlink,realpath,lstat,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
const hash=b=>createHash('sha256').update(b).digest('hex');
function git(root,...args){const r=spawnSync('git',['-C',root,...args],{encoding:'utf8'});if(r.status!==0)throw Error('Selected Core Git identity unavailable');return r.stdout.trim();}
async function inventory(root,directory){const rows=[];async function walk(dir){for(const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Symlink in Core artifact inventory');if(e.isDirectory())await walk(p);else if(e.isFile())rows.push({path:path.relative(root,p).split(path.sep).join('/'),sha256:hash(await readFile(p))});}}await walk(path.join(root,directory));return rows;}
export async function main(args=process.argv.slice(2)){
 const options={};for(let i=0;i<args.length;i++){const key=args[i];if(['--build-core','--allow-unqualified-artifact'].includes(key)){if(options[key])throw Error('Duplicate option');options[key]=true;}else{if(!['--core-dir','--expected-core-revision','--output-dir','--expected-core-artifact-sha256','--timeout-ms','--npm-cli'].includes(key)||options[key]!==undefined||!args[i+1])throw Error('Invalid fixture arguments');options[key]=args[++i];}}
 const root=options['--core-dir'],out=options['--output-dir'],expected=options['--expected-core-revision'];
 if(!root||!path.isAbsolute(root)||!out||!path.isAbsolute(out)||!/^\w{40}$/.test(expected??'')||! /^[a-f0-9]{40}$/.test(expected))throw Error('Absolute Core/output paths and full expected revision are required');
 if(Boolean(options['--build-core'])===Boolean(options['--allow-unqualified-artifact']))throw Error('Select exactly one source build or unqualified artifact mode');
 const timeout=Number(options['--timeout-ms']??180000);if(!Number.isInteger(timeout)||timeout<1000||timeout>600000)throw Error('Fixture timeout must be 1000..600000ms');
 const samePath=(a,b)=>process.platform==='win32'?path.normalize(a).toLowerCase()===path.normalize(b).toLowerCase():a===b;
 if(!samePath(path.resolve(root),root)||!samePath(await realpath(root),root)||!samePath(path.resolve(out),out)||!samePath(await realpath(path.dirname(out)),path.dirname(out)))throw Error('Core/output paths must be canonical without symlink parents');
 if(out===root||out.startsWith(root+path.sep))throw Error('Output must be outside selected Core checkout');
 if(process.platform==='win32'&&options['--build-core']&&!options['--npm-cli'])throw Error('Windows source build requires explicit --npm-cli');
 const privateProof=await createPrivateDirectory(out);const privateProofBytes=JSON.stringify(privateProof)+'\n';await writePrivateFile(path.join(out,'privacy-proof.private.json'),privateProofBytes);const privacy={verified:privateProof.verified,platform:privateProof.platform,policy:privateProof.policy,proofSHA256:hash(privateProofBytes)};
 const receiptFile=path.join(out,'receipt.json');let child;let stopped=false;let timer;let exited;let exitCode=1;let timedOut=false;let protocolFailed=false;let sawReady=false;let readinessWrite=Promise.resolve();let termTimer;let killTimer;let forced=false;
 const receipt={schemaVersion:1,coreRevision:expected,coreArtifactSHA256:null,url:null,stage:'identity',status:'starting',classification:options['--build-core']?'source-built-ordinary-smoke':'unqualified-artifact',cleanup:{status:'pending'},privacy,tools:{node:process.version}};
 const save=()=>writeFile(receiptFile,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
 const terminate=(signal)=>{if(!child||child.exitCode!==null||child.signalCode!==null)return;forced=true;if(process.platform==='win32'){const systemRoot=process.env.SystemRoot;if(!systemRoot||!path.win32.isAbsolute(systemRoot)){child.kill(signal);return;}const killer=path.win32.join(systemRoot,'System32','taskkill.exe');const result=spawnSync(killer,['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:3000,encoding:'utf8'});receipt.forcedTreeTermination={tool:'taskkill',exitCode:result.status};if(result.status!==0)child.kill(signal);}else child.kill(signal);};
 const stop=()=>{if(stopped)return;stopped=true;if(child?.stdin.writable)child.stdin.end('stop\n');if(child){termTimer=setTimeout(()=>terminate('SIGTERM'),3000);killTimer=setTimeout(()=>terminate('SIGKILL'),6000);}};
 const onData=b=>{if(b.toString().includes('stop'))stop();};const onEnd=()=>stop();const onSignal=()=>stop();
 try{
  if(git(root,'rev-parse','HEAD')!==expected)throw Error('Core revision mismatch');
  if(git(root,'status','--porcelain','--untracked-files=all')!=='')throw Error('Core checkout must be clean');
  receipt.coreTree=git(root,'rev-parse','HEAD^{tree}');receipt.cleanSource=true;
  const tracked=git(root,'ls-files','-z','src','tsconfig.json','package.json','package-lock.json','scripts/copy-runtime-assets.mjs').split('\0').filter(Boolean);
  const sourceInputs=[];for(const name of tracked)sourceInputs.push({path:name,sha256:hash(await readFile(path.join(root,name)))});
  receipt.sourceInputSHA256=hash(JSON.stringify(sourceInputs));await writeFile(path.join(out,'source-inputs.json'),JSON.stringify(sourceInputs,null,2),{mode:0o600});
  if(options['--build-core']){
   try{await lstat(path.join(root,'dist'));throw Error('Source build requires absent dist; use a fresh selected checkout');}catch(error){if(error.code!=='ENOENT')throw error;}
   receipt.stage='build';await save();const npmCLI=options['--npm-cli'];let npmCommand='npm';let npmPrefix=[];
   receipt.tools.nodeSHA256=hash(await readFile(process.execPath));
   if(npmCLI){const info=await lstat(npmCLI);if(!path.isAbsolute(npmCLI)||info.isSymbolicLink()||!info.isFile()||!samePath(await realpath(npmCLI),npmCLI)||path.basename(npmCLI)!=='npm-cli.js')throw Error('Invalid explicit npm CLI');const npmPackage=JSON.parse(await readFile(path.join(path.dirname(npmCLI),'..','package.json'),'utf8'));if(npmPackage.name!=='npm')throw Error('Explicit npm package mismatch');npmCommand=process.execPath;npmPrefix=[npmCLI];receipt.tools.npmCLI={path:npmCLI,sha256:hash(await readFile(npmCLI)),packageVersion:npmPackage.version};}
   for(const directory of ['npm-home','npm-appdata','npm-localappdata','npm-tmp','npm-cache'])await mkdir(path.join(out,directory),{mode:0o700});
   const buildEnv={PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot,WINDIR:process.env.SystemRoot,ComSpec:path.win32.join(process.env.SystemRoot,'System32','cmd.exe')}:{}),HOME:path.join(out,'npm-home'),USERPROFILE:path.join(out,'npm-home'),APPDATA:path.join(out,'npm-appdata'),LOCALAPPDATA:path.join(out,'npm-localappdata'),TEMP:path.join(out,'npm-tmp'),TMP:path.join(out,'npm-tmp'),TMPDIR:path.join(out,'npm-tmp'),XDG_CONFIG_HOME:path.join(out,'npm-home'),XDG_CACHE_HOME:path.join(out,'npm-cache'),npm_config_cache:path.join(out,'npm-cache'),npm_config_userconfig:path.join(out,'npm-home','.npmrc')};
   const version=spawnSync(npmCommand,[...npmPrefix,'--version'],{encoding:'utf8',timeout:15000,windowsHide:true,env:buildEnv});if(version.status!==0)throw Error('Selected npm version probe failed');receipt.tools.npm=version.stdout?.trim();
   const compiler=path.join(root,'node_modules/typescript/package.json');receipt.tools.typescript=JSON.parse(await readFile(compiler,'utf8')).version;receipt.tools.compilerSHA256=hash(await readFile(path.join(root,'node_modules/typescript/lib/_tsc.js')).catch(()=>readFile(path.join(root,'node_modules/typescript/lib/tsc.js'))));const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));receipt.installedDependencies={};for(const name of Object.keys(pkg.dependencies??{})){const bytes=await readFile(path.join(root,'node_modules',name,'package.json'));receipt.installedDependencies[name]={version:JSON.parse(bytes).version,packageSHA256:hash(bytes)};}
   const build=spawnSync(npmCommand,[...npmPrefix,'run','build'],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,env:buildEnv});
   await writeFile(path.join(out,'build.log'),(build.stdout??'')+(build.stderr??''),{mode:0o600});receipt.build={command:[npmCommand,...npmPrefix,'run','build'],exitCode:build.status,signal:build.signal};if(build.status!==0)throw Error('Core build failed; stale artifact will not execute');
  }
  for(const row of sourceInputs)if(hash(await readFile(path.join(root,row.path)))!==row.sha256)throw Error('Core source changed during preparation');
  if(git(root,'rev-parse','HEAD')!==expected||git(root,'status','--porcelain','--untracked-files=all')!=='')throw Error('Core source changed during preparation');
  const artifact=path.join(root,'dist/server/index.js');receipt.coreArtifactSHA256=hash(await readFile(artifact));
  if(options['--allow-unqualified-artifact']&&receipt.coreArtifactSHA256!==options['--expected-core-artifact-sha256'])throw Error('Unqualified artifact hash mismatch');
  const outputs=await inventory(root,'dist');await writeFile(path.join(out,'artifact-inventory.json'),JSON.stringify(outputs,null,2),{mode:0o600});receipt.artifactInventorySHA256=hash(JSON.stringify(outputs));
  receipt.stage='startup';await save();
  const env={PATH:process.env.PATH,HOME:path.join(out,'home'),USERPROFILE:path.join(out,'home'),XDG_CONFIG_HOME:path.join(out,'config'),XDG_CACHE_HOME:path.join(out,'cache'),APPDATA:path.join(out,'appdata'),LOCALAPPDATA:path.join(out,'localappdata'),TMPDIR:path.join(out,'tmp'),TEMP:path.join(out,'tmp'),TMP:path.join(out,'tmp'),LANG:'C.UTF-8',...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),SERVICE_LASSO_FIXTURE_CONFIG:JSON.stringify({root,out,artifactSHA256:receipt.coreArtifactSHA256,sourceBuilt:Boolean(options['--build-core']),timeout})};
  child=spawn(process.execPath,[fileURLToPath(new URL('./operator-e2e-fixture-worker.mjs',import.meta.url))],{cwd:out,env,stdio:['pipe','pipe','pipe']});
  exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  let buffer='';child.stdout.on('data',b=>{buffer+=b;if(buffer.length>16384){protocolFailed=true;stop();return;}const end=buffer.indexOf('\n');if(end>=0){try{const ready=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(sawReady||ready.ready!==true||!/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(ready.url)||typeof ready.initializationAPI!=='boolean')throw Error('Invalid ready frame');sawReady=true;receipt.url=ready.url;receipt.stage='ready';receipt.status='running';receipt.initializationAPI=ready.initializationAPI;readinessWrite=save().then(()=>process.stdout.write(JSON.stringify({ready:true,connectionFile:path.join(out,'connection.json'),receiptFile})+'\n')).catch(()=>{protocolFailed=true;stop();});}catch{protocolFailed=true;stop();}}});
  // Worker diagnostics are deliberately closed; never relay raw transport errors.
  child.stderr.resume();process.stdin.on('data',onData);process.stdin.once('end',onEnd);process.once('SIGINT',onSignal);process.once('SIGTERM',onSignal);process.stdin.resume();timer=setTimeout(()=>{timedOut=true;stop();},timeout);
  if(stopped)child.stdin.end('stop\n');const result=await exited;await readinessWrite;clearTimeout(termTimer);clearTimeout(killTimer);exitCode=result.code===0&&sawReady&&!protocolFailed&&!timedOut&&!forced?0:1;receipt.childExit=result;receipt.timedOut=timedOut;receipt.forcedTermination=forced;
  await unlink(path.join(out,'connection.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});
  let credentialAbsent=false;try{await access(path.join(out,'connection.json'));}catch(e){if(e.code==='ENOENT')credentialAbsent=true;else throw e;}
  let cleanup;try{cleanup=JSON.parse(await readFile(path.join(out,'worker-cleanup.json'),'utf8'));}catch{cleanup={status:'failed',workerReceiptMissing:true};}
  let portClosed=null;if(receipt.url){const port=Number(new URL(receipt.url).port);portClosed=await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();resolve(false);});socket.once('error',e=>resolve(e.code==='ECONNREFUSED'));socket.setTimeout(1000,()=>{socket.destroy();resolve(false);});});}
  receipt.cleanup={...cleanup,parentPortClosed:portClosed,parentCredentialRemoved:credentialAbsent,forcedTermination:forced};if(portClosed!==true||!credentialAbsent||forced)receipt.cleanup.status='failed';
  receipt.status=exitCode===0&&receipt.cleanup.status==='complete'?'passed':'failed';if(receipt.status!=='passed')exitCode=1;receipt.stage='closed';await save();
 }catch{exitCode=1;stop();if(exited)await exited.catch(()=>{});receipt.status='failed';receipt.stage='failed';await unlink(path.join(out,'connection.json')).catch(()=>{});receipt.cleanup={status:'startup-failed'};await save();process.stderr.write('Operator E2E fixture failed; inspect private receipt.\n');}
 finally{clearTimeout(timer);clearTimeout(termTimer);clearTimeout(killTimer);process.stdin.removeListener('data',onData);process.stdin.removeListener('end',onEnd);process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);process.stdin.pause();}
 process.exitCode=exitCode;
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(error.code==='ordinary_fixture_windows_private_setup'?error.message+'\n':'Operator E2E fixture arguments/output rejected.\n');process.exitCode=1;});

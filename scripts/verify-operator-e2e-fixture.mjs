// Actual source-built ordinary Core verification; no API substitutions.
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {readFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const output=option('--output-dir');const npmCLI=option('--npm-cli');
assert.ok(output&&path.isAbsolute(output),'Explicit absent absolute output required');
if(process.platform==='win32')assert.ok(npmCLI,'Windows proof requires explicit npm-cli');
const revision=execFileSync('git',['-C',sourceRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const childArgs=[fileURLToPath(new URL('./operator-e2e-fixture.mjs',import.meta.url)),'--core-dir',sourceRoot,'--expected-core-revision',revision,'--output-dir',output,'--build-core','--timeout-ms','120000',...(npmCLI?['--npm-cli',npmCLI]:[])];
const child=spawn(process.execPath,childArgs,{env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH},stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
const stop=()=>{if(!child.stdin.destroyed&&!child.stdin.writableEnded)child.stdin.end('stop\n');};
let stdout='',stderr='',readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
child.stdout.on('data',bytes=>{stdout+=bytes;if(stdout.length>16384){readyReject(Error('Fixture ready protocol exceeded bound'));stop();return;}if(stdout.includes('\n')){try{readyResolve(JSON.parse(stdout.trim()));}catch{readyReject(Error('Invalid fixture ready JSON'));}}});
child.stderr.on('data',bytes=>{stderr+=bytes;if(stderr.length>16384)stderr=stderr.slice(0,16384);});
const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>{readyReject(Error('Fixture exited before ready'));resolve({code,signal});});});
async function waitForExit(milliseconds){let timer;try{return await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),milliseconds);})]);}finally{clearTimeout(timer);}}
function terminateOwnedTree(signal){if(child.exitCode!==null||child.signalCode!==null)return;if(process.platform==='win32'){const systemRoot=process.env.SystemRoot;if(systemRoot)spawnSync(path.win32.join(systemRoot,'System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:3000,stdio:'ignore'});else child.kill(signal);}else{try{process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}}}
let privateToken;let primaryFailure;
const deadline=setTimeout(()=>{readyReject(Error('Actual fixture proof deadline'));stop();},170000);
try{
 const frame=await ready;assert.deepEqual(frame,{ready:true,connectionFile:path.join(output,'connection.json'),receiptFile:path.join(output,'receipt.json')});
 const connection=JSON.parse(await readFile(frame.connectionFile));privateToken=connection.token;assert.equal(typeof privateToken==='string'&&/^[A-Za-z0-9_-]{43}$/.test(privateToken),true,'Private token format invalid');
 const initial=JSON.parse(await readFile(frame.receiptFile));assert.equal(initial.coreRevision,revision);assert.equal(initial.classification,'source-built-ordinary-smoke');assert.equal(initial.cleanSource,true);assert.equal(initial.initializationAPI,true);assert.equal(initial.privacy.verified,true);assert.equal(initial.privacy.ownerSid,undefined);assert.equal(initial.privacy.rules,undefined);
 const proof=await readFile(path.join(output,'privacy-proof.private.json'));assert.equal(createHash('sha256').update(proof).digest('hex'),initial.privacy.proofSHA256);
 for(const header of [{'x-service-lasso-admin-token':privateToken},{authorization:`Bearer ${privateToken}`}]){
  const r=await fetch(connection.url+'/api/runtime/security',{headers:header,signal:AbortSignal.timeout(5000)});assert.equal(r.status,200);const auth=await r.json();assert.equal(auth.auth.actor.kind,'local-token');assert.equal(auth.auth.actor.authenticated,true);assert.equal(auth.auth.policy.localTokenConfigured,true);
 }
 for(const route of ['/api/health','/api/services','/api/runtime/instance','/api/runtime/capabilities']){const r=await fetch(connection.url+route,{headers:{'x-service-lasso-admin-token':privateToken},signal:AbortSignal.timeout(5000)});assert.equal(r.status,200);await r.json();}
} catch(error){primaryFailure=error;}
finally{
 stop();let result=await waitForExit(12000);if(!result){primaryFailure??=Error('Fixture did not close within normal teardown deadline');terminateOwnedTree('SIGTERM');result=await waitForExit(7000);if(!result){terminateOwnedTree('SIGKILL');result=await waitForExit(3000);}if(!result){child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();child.unref();throw Error('Owned fixture termination unresolved');}}clearTimeout(deadline);assert.deepEqual(result,{code:0,signal:null});
 const receipt=JSON.parse(await readFile(path.join(output,'receipt.json')));assert.equal(receipt.status,'passed');assert.equal(receipt.cleanup.status,'complete');assert.equal(receipt.cleanup.parentCredentialRemoved,true);assert.equal(receipt.cleanup.parentPortClosed,true);assert.equal(receipt.forcedTermination,false);
 await assert.rejects(access(path.join(output,'connection.json')),{code:'ENOENT'});await assert.rejects(fetch(receipt.url+'/api/health',{signal:AbortSignal.timeout(1000)}));
 assert.equal(stdout.includes(privateToken??'NEVER_A_TOKEN'),false);assert.equal(stderr.includes(privateToken??'NEVER_A_TOKEN'),false);assert.equal(JSON.stringify(receipt).includes(privateToken??'NEVER_A_TOKEN'),false);privateToken=undefined;
 if(primaryFailure)throw primaryFailure;
 process.stdout.write(JSON.stringify({passed:true,classification:receipt.classification,platform:process.platform,coreRevision:revision,privacy:receipt.privacy,receiptFile:path.join(output,'receipt.json')})+'\n');
}

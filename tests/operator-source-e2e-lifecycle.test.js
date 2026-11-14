// Linux source/API integration with real host Node fixture processes.
// This is not template creation, installed native or published-product qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import net from 'node:net';
import {mkdtemp,mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {exportJWK,generateKeyPair,SignJWT} from 'jose';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const targetId='source-e2e-target';
const controlId='source-e2e-control';

async function poll(read,accept,label,timeout=10000){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){const value=await read();if(accept(value))return value;await new Promise(r=>setTimeout(r,25));}
 throw Error(`Timed out: ${label}`);
}
async function birth(pid){
 if(!Number.isInteger(pid)||pid<=0)return null;
 try{const raw=await readFile(`/proc/${pid}/stat`,'utf8');const fields=raw.slice(raw.lastIndexOf(')')+2).trim().split(/\s+/);return {pid,startTimeTicks:fields[19],state:fields[0]};}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function sameBirth(left,right){return Boolean(left&&right&&left.pid===right.pid&&left.startTimeTicks===right.startTimeTicks);}
async function assertGone(identity){if(identity)await poll(()=>birth(identity.pid),value=>!sameBirth(identity,value),'original owned process absence');}
async function closedPort(port){return await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();resolve(false);});socket.once('error',error=>resolve(error.code==='ECONNREFUSED'));socket.setTimeout(1000,()=>{socket.destroy();resolve(false);});});}
async function fileEvidence(file){try{const [bytes,info]=await Promise.all([readFile(file),stat(file,{bigint:true})]);return {sha256:digest(bytes),mtimeNs:String(info.mtimeNs),size:String(info.size)};}catch(error){if(error.code==='ENOENT')return null;throw error;}}

// Run as its own Node test process: the runtime module globals belong only to
// these two private services. All environment paths are selected before imports.
test('source API five-action effects preserve a running control and enforce OAuth/replay', {skip:process.platform!=='linux',timeout:120000},async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'operator-source-lifecycle-'));
 const servicesRoot=path.join(root,'services');const workspaceRoot=path.join(root,'workspace');
 for(const name of ['services','workspace','home','config','registry'])await mkdir(path.join(root,name),{mode:0o700});
 const previous={...process.env};for(const key of Object.keys(process.env))if(key.startsWith('SERVICE_LASSO_')||['NODE_OPTIONS','NODE_PATH'].includes(key))delete process.env[key];
 Object.assign(process.env,{HOME:path.join(root,'home'),USERPROFILE:path.join(root,'home'),XDG_CONFIG_HOME:path.join(root,'config'),SERVICE_LASSO_WORKSPACE_ROOT:workspaceRoot,SERVICE_LASSO_SERVICES_ROOT:servicesRoot,SERVICE_LASSO_INSTANCE_REGISTRY_PATH:path.join(root,'registry','instances.json'),SERVICE_LASSO_HOST_PORT_REGISTRY_PATH:path.join(root,'registry','ports.json')});
 const evidence={schemaVersion:1,classification:'linux-source-api-integration',status:'running',actions:[],negative:[],cleanup:{status:'pending'}};
 const owned=[];let api,jwks,apiPort,jwksPort,getLifecycleState,stopAllManagedProcesses,token;let primaryFailure;
 let request;
 const trackedIdentity=async id=>{const identity=await birth(getLifecycleState(id).runtime.pid);if(identity&&!owned.some(value=>sameBirth(value,identity)))owned.push(identity);return identity;};
 const files=async id=>Object.fromEntries(await Promise.all(['service.json','runtime/fixture-service.mjs','runtime/install.txt','runtime/config.env'].map(async name=>[name,await fileEvidence(path.join(servicesRoot,id,name))])));
 const operationIds=async()=>{const result=await request('/api/operator/lifecycle/operations');assert.equal(result.status,200);assert.ok(Array.isArray(result.body.operations));return result.body.operations.map(value=>value.operationId).sort();};
 const snapshot=async()=>({operations:await operationIds(),target:await trackedIdentity(targetId),control:await trackedIdentity(controlId),targetFiles:await files(targetId),controlFiles:await files(controlId)});
 async function execute(action,id,key=`source-e2e-${action}-${randomUUID()}`){
  const preview=await request('/api/operator/lifecycle/operations','POST',{action,serviceId:id});assert.equal(preview.status,200,`preview ${action}: HTTP ${preview.status}`);assert.equal(preview.body.confirmation?.status,'pending');
  const submission={action,serviceId:id,execute:true,idempotencyKey:key,confirmationId:preview.body.confirmation.id,confirmationPhrase:preview.body.confirmation.confirmationPhrase};
  const accepted=await request('/api/operator/lifecycle/operations','POST',submission);assert.equal(accepted.status,202,`execute ${action}: HTTP ${accepted.status}`);const operationId=accepted.body.operation.operationId;assert.match(operationId,/^mcp-operation-/);
  const terminal=await poll(()=>request(`/api/operator/lifecycle/operations/${operationId}`),value=>value.status===200&&value.body.operation?.outcome!==null,`terminal ${action}`);
  assert.equal(terminal.body.operation.outcome,'succeeded');assert.equal(terminal.body.operation.operationId,operationId);assert.equal(terminal.body.operation.action,action==='config'?'service_configure':`service_${action}`);assert.deepEqual(terminal.body.operation.targets,[id]);
  await trackedIdentity(id);return {operationId,submission};
 }
 try{
  evidence.coreRevision=execFileSync('git',['-C',sourceRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim();evidence.coreArtifactSHA256=digest(await readFile(path.join(sourceRoot,'dist/server/index.js')));
  const core=await import('../dist/server/index.js');({getLifecycleState}=await import('../dist/runtime/lifecycle/store.js'));({stopAllManagedProcesses}=await import('../dist/runtime/execution/supervisor.js'));
  const {writeExecutableFixtureService}=await import('./test-helpers.js');
  await writeExecutableFixtureService(servicesRoot,targetId,{install:{files:[{path:'./runtime/install.txt',content:'installed source-e2e-target\n'}]},config:{files:[{path:'./runtime/config.env',content:'CONFIGURED=source-e2e-target\n'}]}});
  await writeExecutableFixtureService(servicesRoot,controlId,{config:{files:[{path:'./runtime/config.env',content:'CONTROL=stable\n'}]}});
  await writeFile(path.join(servicesRoot,controlId,'runtime/config.env'),'CONTROL=stable\n');
  const issuer='https://source-e2e-issuer.example';const audience='source-e2e-core';const resource='https://source-e2e-resource.example/api/mcp';const kid='source-e2e-key';
  const keys=await generateKeyPair('RS256');const jwk=await exportJWK(keys.publicKey);Object.assign(jwk,{kid,alg:'RS256',use:'sig'});
  jwks=createServer((q,r)=>{if(q.url!=='/jwks'){r.writeHead(404);r.end();return;}r.setHeader('content-type','application/json');r.end(JSON.stringify({keys:[jwk]}));});jwks.listen(0,'127.0.0.1');await once(jwks,'listening');jwksPort=jwks.address().port;
  const sign=async(scope,key=keys.privateKey)=>new SignJWT({client_id:'source-e2e-client',scope}).setProtectedHeader({alg:'RS256',kid}).setIssuer(issuer).setAudience(audience).setSubject('source-e2e-actor').setIssuedAt().setExpirationTime('5m').sign(key);
  // Core's maintainer profile requires all four supported scopes, including
  // update:write; no runtime-admin scope is granted to this test actor.
  token=await sign('service-lasso:read service-lasso:lifecycle:write service-lasso:config:write service-lasso:update:write');const reader=await sign('service-lasso:read');const wrong=await generateKeyPair('RS256');const invalid=await sign('service-lasso:read service-lasso:lifecycle:write',wrong.privateKey);
  api=core.createApiServer({host:'127.0.0.1',servicesRoot,workspaceRoot,autostart:false,monitor:false,updateScheduler:false,mcpHttpIdentity:{env:{SERVICE_LASSO_MCP_MODE:'guarded',SERVICE_LASSO_MCP_OAUTH_ISSUER:issuer,SERVICE_LASSO_MCP_OAUTH_JWKS_URI:`http://127.0.0.1:${jwksPort}/jwks`,SERVICE_LASSO_MCP_RESOURCE_URI:resource,SERVICE_LASSO_MCP_OAUTH_AUDIENCE:audience}}});await core.waitForApiServerInitialization(api);api.listen(0,'127.0.0.1');await once(api,'listening');apiPort=api.address().port;
  request=async(route,method='GET',body,credential=token)=>{const r=await fetch(`http://127.0.0.1:${apiPort}${route}`,{method,headers:{authorization:`Bearer ${credential}`,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});return {status:r.status,body:await r.json()};};
  await execute('start',controlId);const control=await trackedIdentity(controlId);assert.ok(control&&control.state!=='Z');const controlFiles=await files(controlId);
  async function unchangedControl(){assert.ok(sameBirth(control,await trackedIdentity(controlId)));assert.deepEqual(await files(controlId),controlFiles);}
  for(const action of ['install','config','start','stop','restart']){
   const before=await trackedIdentity(targetId);const result=await execute(action,targetId);const after=await trackedIdentity(targetId);
   if(action==='install')assert.equal(await readFile(path.join(servicesRoot,targetId,'runtime/install.txt'),'utf8'),'installed source-e2e-target\n');
   if(action==='config')assert.equal(await readFile(path.join(servicesRoot,targetId,'runtime/config.env'),'utf8'),'CONFIGURED=source-e2e-target\n');
   if(action==='start'||action==='restart')assert.ok(after&&after.state!=='Z');
   if(action==='stop'){assert.equal(after,null);await assertGone(before);}
   await unchangedControl();evidence.actions.push({action,operationId:result.operationId,before,after});
  }
  // Restart again while actually running: distinguish replacement from start.
  const old=await trackedIdentity(targetId);const restarted=await execute('restart',targetId,'source-e2e-running-restart-key');const replacement=await trackedIdentity(targetId);assert.ok(!sameBirth(old,replacement));await assertGone(old);await unchangedControl();
  const beforeReplay=await snapshot();const replay=await request('/api/operator/lifecycle/operations','POST',restarted.submission);assert.equal(replay.status,202);assert.equal(replay.body.operation.operationId,restarted.operationId);assert.deepEqual(await snapshot(),beforeReplay);evidence.replay={operationId:restarted.operationId,old,replacement,noAdditionalEffects:true};
  const conflict=await request('/api/operator/lifecycle/operations','POST',{...restarted.submission,action:'stop'});assert.equal(conflict.status,409);assert.deepEqual(await snapshot(),beforeReplay);
  for(const [name,credential,status] of [['reader',reader,403],['invalid-signature',invalid,401]]){const before=await snapshot();const denied=await request('/api/operator/lifecycle/operations','POST',{action:'stop',serviceId:targetId},credential);assert.equal(denied.status,status);assert.deepEqual(await snapshot(),before);await unchangedControl();evidence.negative.push({name,status,noAdditionalEffects:true});}
  assert.equal(new Set(evidence.actions.map(value=>value.operationId)).size,5);evidence.control={identity:control,files:controlFiles,preserved:true};evidence.status='passed';
 }catch(error){primaryFailure=error;evidence.status='failed';}
 finally{
  const cleanupFailures=[];let forced=false;
  if(getLifecycleState){for(const id of [targetId,controlId]){try{const current=await trackedIdentity(id);if(current&&request){await execute('stop',id);await assertGone(current);}}catch(error){cleanupFailures.push(error);}}}
  if(cleanupFailures.length&&stopAllManagedProcesses){forced=true;try{await stopAllManagedProcesses();}catch(error){cleanupFailures.push(error);}}
  for(const identity of owned){try{await assertGone(identity);}catch(error){forced=true;cleanupFailures.push(error);try{if(sameBirth(identity,await birth(identity.pid)))process.kill(identity.pid,'SIGTERM');await assertGone(identity);}catch(finalError){cleanupFailures.push(finalError);}}}
  for(const [server,port] of [[api,apiPort],[jwks,jwksPort]]){try{if(server?.listening){const close=once(server,'close');server.close();server.closeIdleConnections?.();server.closeAllConnections?.();await close;}if(port)assert.equal(await closedPort(port),true);}catch(error){cleanupFailures.push(error);}}
  evidence.cleanup={status:cleanupFailures.length||forced?'failed':'complete',forced,ownedProcesses:owned.length,allOriginalsAbsent:(await Promise.all(owned.map(identity=>birth(identity.pid)))).every((value,index)=>!sameBirth(owned[index],value)),apiPortClosed:apiPort?await closedPort(apiPort):null,jwksPortClosed:jwksPort?await closedPort(jwksPort):null};
  if(cleanupFailures.length||forced)evidence.status='failed';await writeFile(path.join(root,'receipt.json'),JSON.stringify(evidence,null,2),{mode:0o600});
  for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);t.diagnostic(`Source API evidence retained at ${root}/receipt.json`);
  if(primaryFailure||cleanupFailures.length)throw new AggregateError([...(primaryFailure?[primaryFailure]:[]),...cleanupFailures],'Source lifecycle effects or owned cleanup failed');
 }
});

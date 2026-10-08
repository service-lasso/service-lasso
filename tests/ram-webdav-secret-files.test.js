import net from "node:net";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { once } from "node:events";
import { ramSecretFilesDirectory, revokeRAMSecretFileGrant } from "../dist/runtime/broker/ram-webdav.js";
import { requestSecretsBrokerHttp } from "../dist/runtime/broker/ipc-transport.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { installService, configService, startService, restartService, stopService } from "../dist/runtime/lifecycle/actions.js";
import { getLifecycleState, resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { materializeEphemeralSecretFiles } from "../dist/runtime/setup/materialize.js";
import { makeTempServicesRoot } from "./test-helpers.js";

test("ESM-7 RAM directory accepts only loopback and formats Windows UNC / HTTP paths", () => {
 const token="a".repeat(64);
 assert.equal(ramSecretFilesDirectory("http://127.0.0.1:8080",token,"linux"),`http://127.0.0.1:8080/${token}`);
 assert.equal(ramSecretFilesDirectory("http://127.0.0.1:8080",token,"win32"),`\\\\127.0.0.1@8080\\DavWWWRoot\\${token}`);
 for(const base of ["http://example.com:8080","http://127.0.0.1","http://user:pass@127.0.0.1:8080","http://127.0.0.1:8080/path","http://127.0.0.1:8080?x=1","https://127.0.0.1:8080"]) assert.throws(()=>ramSecretFilesDirectory(base,token));
 assert.throws(()=>ramSecretFilesDirectory("http://127.0.0.1:8080","bad"));
});

test("ESM-7 default refuses unavailable RAM provider without creating disk outputs", async()=>{
 const {tempRoot,servicesRoot}=await makeTempServicesRoot("ram-no-provider-");
 const before=process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT;delete process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT;
 try {
  const root=path.join(servicesRoot,"app");await mkdir(root);await writeFile(path.join(root,"service.json"),JSON.stringify({id:"app",name:"App",description:"RAM fixture",config:{files:[{path:"key",content:"synthetic",ephemeral:true}]}}));
  const [service]=await discoverServices(servicesRoot);
  await assert.rejects(materializeEphemeralSecretFiles(service,{},{}),/preparation failed/);
  await assert.rejects(readFile(path.join(root,"key")),{code:"ENOENT"});
 } finally {if(before===undefined)delete process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT;else process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT=before;await rm(tempRoot,{recursive:true,force:true});}
});

// Runs actual source-built Broker over production peer-bound Unix IPC, then an
// actual managed child consumes the separate RAM HTTP endpoint. Synthetic values.
test("ESM-7..10 native Broker/Core launch, env compatibility, replacement rotation and stop revocation",{
 skip:process.platform!=="linux"||!process.env.SERVICE_LASSO_TEST_BROKER_BIN,
},async()=>{
 const {tempRoot,servicesRoot}=await makeTempServicesRoot("ram-broker-core-");
 const before=process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT;delete process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT;
 const binary=process.env.SERVICE_LASSO_TEST_BROKER_BIN;
 const apiToken="synthetic-operator-token",signingKey="synthetic-distinct-signing-key";
 const broker=spawn(binary,["serve","--mode","production","--audit-hash-chain","--transport","unix-socket","--unix-socket",path.join(tempRoot,"broker.sock"),"--state","ready","--store",path.join(tempRoot,"vault.json"),"--audit",path.join(tempRoot,"audit.jsonl"),"--wrapper",path.join(tempRoot,"wrapper.json")],{
  env:{...process.env,SECRETSBROKER_MASTER_KEY:"synthetic-distinct-master-key",SECRETSBROKER_API_TOKEN:apiToken,SECRETSBROKER_LAUNCH_IDENTITY_SIGNING_KEY:signingKey},stdio:["ignore","ignore","pipe"],
 });
 let brokerDiagnostics="";broker.stderr.on("data",data=>{brokerDiagnostics=(brokerDiagnostics+data.toString()).slice(0,16384);});
 const target={kind:"unix-socket",socketPath:path.join(tempRoot,"broker.sock")};
 const request=input=>requestSecretsBrokerHttp(target,{...input,headers:{...input.headers,authorization:`Bearer ${apiToken}`}});
 const post=(route,body)=>request({method:"POST",pathWithQuery:route,headers:{"content-type":"application/json"},body:Buffer.from(JSON.stringify(body))});
 let service;resetLifecycleState();
 try {
  let ready=false;for(let i=0;i<100;i++){try{const result=await request({method:"GET",pathWithQuery:"/health",headers:{},timeoutMs:200});if(result.status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}
  assert.equal(ready,true,`source Broker did not become available: ${brokerDiagnostics}`);
  const root=path.join(servicesRoot,"ram-app");await mkdir(root);
  await writeFile(path.join(root,"service.json"),JSON.stringify({id:"ram-app",name:"RAM app",description:"Synthetic RAM consumer",executable:process.execPath,args:["app.mjs"],env:{PASSWORD:"${database.PASSWORD}",PASSWORD_FILE:"${SERVICE_LASSO_SECRETS_DIR}/password"},broker:{imports:[{namespace:"shared/database",ref:"database.PASSWORD",required:true}]},config:{files:[{path:"password",content:"${database.PASSWORD}",ephemeral:true}]}}));
  await writeFile(path.join(root,"app.mjs"),`import {writeFileSync} from 'node:fs';
    const response=await fetch(process.env.PASSWORD_FILE);const content=await response.text();
    writeFileSync('consumed.json',JSON.stringify({matches:response.ok&&content===process.env.PASSWORD}));setInterval(()=>{},1000);`);
  const registry=createServiceRegistry(await discoverServices(servicesRoot));service=registry.getById("ram-app");
  const issuer={workspaceId:"test-workspace",command:{command:binary,env:{...process.env,SECRETSBROKER_LAUNCH_IDENTITY_SIGNING_KEY:signingKey}}};
  const lookup=async({refs,identityLease,service:lookupService})=>{
   const resolved=await post("/v1/resolve",{serviceId:lookupService.manifest.id,workspaceId:"test-workspace",identityLease,refs:refs.map(ref=>`${ref.startsWith("echo.")?"shared/echo":"shared/database"}/${ref}`)});
   assert.equal(resolved.status,200,resolved.status===200?undefined:resolved.body.toString());const payload=JSON.parse(resolved.body.toString());
   return refs.map((ref,i)=>({ref,status:payload.results[i].outcome==="ready"?"resolved":"missing",value:payload.results[i].value}));
  };
  let latestURL,denyRevocation=false;const runtime={lookup,operatorRequest:async input=>{
   if(denyRevocation&&input.pathWithQuery==="/v1/file-grants/revoke")throw new Error("Synthetic IPC outage");
   const result=await request(input);if(input.pathWithQuery==="/v1/file-grants"&&result.status===201){const grant=JSON.parse(result.body.toString());latestURL=`${grant.baseUrl}/${grant.token}/password`;}
   return result;
  },serverEnv:{},transportBinding:{kind:"unix-uid",subject:String(process.getuid())},launchLeaseIssuer:issuer};
  const options={brokerRuntime:runtime};
  assert.equal((await post("/v1/secrets",{ref:"shared/database/database.PASSWORD",value:"synthetic-first"})).status,200);
  await installService(service,registry);await configService(service,registry,options);
  const consume=async()=>{for(let i=0;i<100;i++){try{return JSON.parse(await readFile(path.join(root,"consumed.json"),"utf8"));}catch{}await new Promise(r=>setTimeout(r,50));}throw new Error("child did not consume RAM secret");};
  let started=await startService(service,registry,options);assert.equal((await consume()).matches,true);const firstURL=latestURL;
  assert.equal(JSON.stringify(started.state).includes(firstURL.split("/")[3]),false);assert.equal(JSON.stringify(started.state).includes("synthetic-first"),false);
  await rm(path.join(root,"consumed.json"));assert.equal((await post("/v1/secrets",{ref:"shared/database/database.PASSWORD",value:"synthetic-replacement"})).status,200);
  await restartService(service,registry,options);assert.equal((await consume()).matches,true);assert.notEqual(latestURL,firstURL);assert.equal((await fetch(firstURL)).status,404);
  await stopService(service);assert.equal((await fetch(latestURL)).status,404);await assert.rejects(readFile(path.join(root,"password")),{code:"ENOENT"});
  for(const file of ["vault.json","audit.jsonl"]){const data=await readFile(path.join(tempRoot,file),"utf8");assert.equal(data.includes("synthetic-first"),false);assert.equal(data.includes("synthetic-replacement"),false);assert.equal(data.includes(latestURL.split("/")[3]),false);}
  // A secret file may also contain local/environment inputs with no Broker refs;
  // its grant lease has only a service-specific file namespace and resolve scope.
  delete service.manifest.broker;service.manifest.env.PASSWORD="synthetic-static";
  service.manifest.config.files[0].content="synthetic-static";await rm(path.join(root,"consumed.json"));
  const staticOptions={...options,brokerLookup:()=>[]};
  await startService(service,registry,staticOptions);assert.equal((await consume()).matches,true);
  denyRevocation=true;const stopped=await stopService(service);assert.equal(stopped.state.running,false);assert.match(stopped.message,/revocation is pending/);
  denyRevocation=false;assert.equal(await revokeRAMSecretFileGrant(service),true);assert.equal((await fetch(latestURL)).status,404);
  service.manifest.args=["${SERVICE_LASSO_SECRETS_DIR}"];
  await assert.rejects(startService(service,registry,staticOptions),/preparation failed/);
  assert.equal(getLifecycleState(service.manifest.id).runtime.pid,null);
  // Optional actual Echo consumer: use its checked-in sample manifest unchanged
  // except executable, test-owned runtime paths and ephemeral listening ports.
  if (process.env.SERVICE_LASSO_TEST_ECHO_BIN && process.env.SERVICE_LASSO_TEST_ECHO_MANIFEST) {
   const echoRoot=path.join(servicesRoot,"echo-webdav");await mkdir(echoRoot);
   const manifest=JSON.parse(await readFile(process.env.SERVICE_LASSO_TEST_ECHO_MANIFEST,"utf8"));
   manifest.executable=process.env.SERVICE_LASSO_TEST_ECHO_BIN;manifest.args=[];delete manifest.endpoints;
   const port=await new Promise((resolve,reject)=>{const listener=net.createServer();listener.once("error",reject);listener.listen(0,"127.0.0.1",()=>{const port=listener.address().port;listener.close(error=>error?reject(error):resolve(port));});});
   Object.assign(manifest.env,{ECHO_PORT:String(port),ECHO_HTTP_HEALTH_PORT:"0",ECHO_TCP_PORT:"0",ECHO_LOG_PATH:path.join(echoRoot,"echo.log"),ECHO_STATE_PATH:path.join(echoRoot,"state.json"),ECHO_DB_PATH:path.join(echoRoot,"echo.sqlite")});
   await writeFile(path.join(echoRoot,"service.json"),JSON.stringify(manifest));
   const echoRegistry=createServiceRegistry(await discoverServices(servicesRoot));service=echoRegistry.getById("echo-webdav");
   assert.equal((await post("/v1/secrets",{ref:"shared/echo/echo.DEMO_CREDENTIAL",value:"synthetic-demo-credential"})).status,200);
   await installService(service,echoRegistry);await configService(service,echoRegistry,options);
   await startService(service,echoRegistry,options);
   let echoStatus;
   for(let i=0;i<100;i++){try{const response=await fetch(`http://127.0.0.1:${port}/secret-file`);if(response.ok){echoStatus=await response.json();break;}}catch{}await new Promise(r=>setTimeout(r,50));}
   assert.equal(echoStatus?.status,"loaded");assert.equal(echoStatus.reads,1);
   assert.equal((await (await fetch(`http://127.0.0.1:${port}/secret-file`,{method:"POST"})).json()).reads,2);
   const statusResponse=await request({method:"GET",pathWithQuery:"/v1/file-grants/status?limit=100&cursor=0",headers:{}});
   assert.equal(statusResponse.status,200);const inventory=JSON.parse(statusResponse.body.toString());
   const row=inventory.files.find(file=>file.serviceId==="echo-webdav");assert.equal(row.path,"demo-config.json");assert.equal(row.downloads,2);assert.equal(row.sizeBytes,echoStatus.sizeBytes);assert.equal(row.servedBytes,row.sizeBytes*2);
   const environment=await (await fetch(`http://127.0.0.1:${port}/env`)).text();
   assert.equal(environment.includes(latestURL.split("/")[3]),false);
   for(const file of ["echo.log","state.json"]){const content=await readFile(path.join(echoRoot,file),"utf8");assert.equal(content.includes("synthetic-demo-credential"),false);assert.equal(content.includes(latestURL.split("/")[3]),false);}
   await stopService(service);
   const after=JSON.parse((await request({method:"GET",pathWithQuery:"/v1/file-grants/status",headers:{}})).body.toString());
   assert.equal(after.files.some(file=>file.serviceId==="echo-webdav"),false);
  }

 } finally {
  if(service&&getLifecycleState(service.manifest.id).running)await stopService(service);
  broker.kill("SIGTERM");if(broker.exitCode===null)await once(broker,"exit");resetLifecycleState();
  if(before===undefined)delete process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT;else process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT=before;
  await rm(tempRoot,{recursive:true,force:true});
 }
});

import net from "node:net";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, rm, copyFile, chmod } from "node:fs/promises";
import { once } from "node:events";
import { ramSecretFilesDirectory, revokeRAMSecretFileGrant } from "../dist/runtime/broker/ram-webdav.js";
import { requestSecretsBrokerHttp } from "../dist/runtime/broker/ipc-transport.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { installService, configService, startService, restartService, stopService } from "../dist/runtime/lifecycle/actions.js";
import { getLifecycleState, resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { materializeEphemeralSecretFiles } from "../dist/runtime/setup/materialize.js";
import { resolveServiceStartupBrokerResolution } from "../dist/runtime/broker/launch-resolution.js";
import { makeTempServicesRoot } from "./test-helpers.js";

test("ESM-13 file-only secrets go to Broker as references while explicit env delivery remains resolved", async () => {
 const {tempRoot,servicesRoot}=await makeTempServicesRoot("broker-owned-files-");
 const before=process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT;delete process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT;
 try {
  const root=path.join(servicesRoot,"app");await mkdir(root);
  await writeFile(path.join(root,"service.json"),JSON.stringify({id:"app",name:"App",description:"Broker-owned file",broker:{imports:[{namespace:"shared/app",ref:"app.KEY",required:true}],files:[{path:"key",content:"${app.KEY}"}]}}));
  const [service]=await discoverServices(servicesRoot);
  const resolution=await resolveServiceStartupBrokerResolution(service,()=>assert.fail("File-only secret must not be returned to Core"));
  assert.deepEqual(resolution.plan.brokerRefs,[]);
  let sent;
  assert.equal(await materializeEphemeralSecretFiles(service,{}, {},{brokerValues:{"app.KEY":"must-not-send-plaintext"}},undefined,async files=>{sent=files;return "synthetic-private-directory";}),"synthetic-private-directory");
  assert.deepEqual(sent,[{path:"key",content:"${app.KEY}"}]);
  service.manifest.env={KEY:"${app.KEY}"};
  let requested;
  const envResolution=await resolveServiceStartupBrokerResolution(service,({refs})=>{requested=refs;return [{ref:"app.KEY",status:"resolved",value:"synthetic-env-value"}];});
  assert.deepEqual(requested,["app.KEY"]);assert.equal(envResolution.variableResolution.brokerValues["app.KEY"],"synthetic-env-value");
  delete service.manifest.env;process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT="tmpfs";
  await resolveServiceStartupBrokerResolution(service,({refs})=>{assert.deepEqual(refs,["app.KEY"]);return [{ref:"app.KEY",status:"resolved",value:"synthetic-tmpfs-value"}];});
  delete process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT;
  service.manifest.broker.files[0].content="${other.UNDECLARED}";
  await assert.rejects(materializeEphemeralSecretFiles(service,{}, {},{},undefined,()=>assert.fail("Unimported secret must not reach Broker")),/preparation failed/);
 } finally {if(before===undefined)delete process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT;else process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT=before;await rm(tempRoot,{recursive:true,force:true});}
});

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
  const root=path.join(servicesRoot,"app");await mkdir(root);await writeFile(path.join(root,"service.json"),JSON.stringify({id:"app",name:"App",description:"RAM fixture",broker:{files:[{path:"key",content:"synthetic"}]}}));
  const [service]=await discoverServices(servicesRoot);
  await assert.rejects(materializeEphemeralSecretFiles(service,{},{}),/preparation failed/);
  await assert.rejects(readFile(path.join(root,"key")),{code:"ENOENT"});
 } finally {if(before===undefined)delete process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT;else process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT=before;await rm(tempRoot,{recursive:true,force:true});}
});

// Runs actual source-built Broker over production peer-bound OS IPC, then an
// actual managed child consumes the separate RAM HTTP endpoint. Synthetic values.
test("ESM-7..10 native Broker/Core launch, env compatibility, replacement rotation and stop revocation",{
 skip:!process.env.SERVICE_LASSO_TEST_BROKER_BIN && process.env.SERVICE_LASSO_REQUIRE_SECRET_FILES_NATIVE !== "1",
},async()=>{
 const binary=process.env.SERVICE_LASSO_TEST_BROKER_BIN;
 assert.ok(binary,"Native secret-file qualification requires the pinned Broker binary");
 if(process.env.SERVICE_LASSO_REQUIRE_SECRET_FILES_NATIVE === "1") {
  assert.ok(process.env.SERVICE_LASSO_TEST_ECHO_BIN,"Native qualification requires the pinned Echo binary");
  assert.ok(process.env.SERVICE_LASSO_TEST_ECHO_MANIFEST,"Native qualification requires the Echo manifest");
  assert.ok(process.env.SERVICE_LASSO_TEST_ECHO_CHECK,"Native qualification requires the Echo checker");
 }
 const {tempRoot,servicesRoot}=await makeTempServicesRoot("ram-broker-core-");
 const before=process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT;delete process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT;
 const windows=process.platform === "win32";
 const subject=windows ? execFileSync(path.join(process.env.SystemRoot,"System32","WindowsPowerShell","v1.0","powershell.exe"),["-NoProfile","-NonInteractive","-Command","[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value"],{encoding:"utf8",windowsHide:true,timeout:5000}).trim() : String(process.getuid());
 const socketPath=windows ? "\\\\.\\pipe\\sl-secret-files-"+path.basename(tempRoot) : path.join(tempRoot,"broker.sock");
 const target={kind:windows ? "windows-named-pipe" : "unix-socket",socketPath};
 const transportArgs=windows ? ["--transport","windows-named-pipe","--named-pipe",socketPath,"--named-pipe-allowed-sid",subject] : ["--transport","unix-socket","--unix-socket",socketPath];
 const apiToken="synthetic-operator-token",signingKey="synthetic-distinct-signing-key";
 const broker=spawn(binary,["serve","--mode","production","--audit-hash-chain",...transportArgs,"--state","ready","--store",path.join(tempRoot,"vault.json"),"--audit",path.join(tempRoot,"audit.jsonl"),"--wrapper",path.join(tempRoot,"wrapper.json")],{
  env:{...process.env,SECRETSBROKER_MASTER_KEY:"synthetic-distinct-master-key",SECRETSBROKER_API_TOKEN:apiToken,SECRETSBROKER_LAUNCH_IDENTITY_SIGNING_KEY:signingKey},stdio:["ignore","ignore","pipe"],
 });
 let brokerDiagnostics="";broker.stderr.on("data",data=>{brokerDiagnostics=(brokerDiagnostics+data.toString()).slice(0,16384);});
 const request=input=>requestSecretsBrokerHttp(target,{...input,headers:{...input.headers,authorization:`Bearer ${apiToken}`}});
 const post=(route,body)=>request({method:"POST",pathWithQuery:route,headers:{"content-type":"application/json"},body:Buffer.from(JSON.stringify(body))});
 let service;resetLifecycleState();
 try {
  let ready=false;for(let i=0;i<100;i++){try{const result=await request({method:"GET",pathWithQuery:"/health",headers:{},timeoutMs:200});if(result.status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}
  assert.equal(ready,true,`source Broker did not become available: ${brokerDiagnostics}`);
  const root=path.join(servicesRoot,"ram-app");await mkdir(root);
  await writeFile(path.join(root,"service.json"),JSON.stringify({id:"ram-app",name:"RAM app",description:"Synthetic RAM consumer",executable:process.execPath,args:["app.mjs"],env:{PASSWORD:"${database.PASSWORD}",PASSWORD_FILE:"${SERVICE_LASSO_SECRETS_DIR}/password"},broker:{imports:[{namespace:"shared/database",ref:"database.PASSWORD",required:true}],files:[{path:"password",content:"${database.PASSWORD}"}]}}));
  await writeFile(path.join(root,"app.mjs"),`import {writeFileSync} from 'node:fs';
    const location=process.env.PASSWORD_FILE,parts=location.split(String.fromCharCode(92));
    const endpoint=parts.find(p=>p.startsWith("127.0.0.1@"));
    const url=endpoint ? "http://127.0.0.1:"+endpoint.split("@")[1]+"/"+parts.at(-1) : location;
    const response=await fetch(url);const content=await response.text();
    writeFileSync('consumed.json',JSON.stringify({matches:response.ok&&content===process.env.PASSWORD}));setInterval(()=>{},1000);`);
  const registry=createServiceRegistry(await discoverServices(servicesRoot));service=registry.getById("ram-app");
  const issuer={workspaceId:"test-workspace",command:{command:binary,env:{...process.env,SECRETSBROKER_LAUNCH_IDENTITY_SIGNING_KEY:signingKey}}};
  const lookup=async({refs,identityLease,service:lookupService})=>{
   assert.equal(lookupService.manifest.id === "echo-webdav",false,"Echo file-only secret must remain inside Broker");
   const resolved=await post("/v1/resolve",{serviceId:lookupService.manifest.id,workspaceId:"test-workspace",identityLease,refs:refs.map(ref=>`${ref.startsWith("echo.")?"shared/echo":"shared/database"}/${ref}`)});
   assert.equal(resolved.status,200,resolved.status===200?undefined:resolved.body.toString());const payload=JSON.parse(resolved.body.toString());
   return refs.map((ref,i)=>({ref,status:payload.results[i].outcome==="ready"?"resolved":"missing",value:payload.results[i].value}));
  };
  let latestURL,denyRevocation=false;const runtime={lookup,operatorRequest:async input=>{
   if(denyRevocation&&input.pathWithQuery==="/v1/file-grants/revoke")throw new Error("Synthetic IPC outage");
   if(input.pathWithQuery==="/v1/file-grants") {
    const body=JSON.parse(input.body.toString());
    if(body.serviceId==="echo-webdav") {
     const selector=body.bindings[0].selector;assert.ok(["echo.DEMO_CREDENTIAL","echo.MISSING"].includes(selector));
     assert.deepEqual(body.bindings,[{selector,ref:`shared/echo/${selector}`,required:true}]);
     assert.equal(body.files[0].content,`{"demoCredential":"\${${selector}}"}`);
     assert.equal(input.body.toString().includes("synthetic-demo-credential"),false);
    }
   }
   const result=await request(input);if(input.pathWithQuery==="/v1/file-grants"&&result.status===201){const grant=JSON.parse(result.body.toString());latestURL=`${grant.baseUrl}/${grant.token}/password`;}
   return result;
  },serverEnv:{},transportBinding:{kind:windows ? "windows-sid" : "unix-uid",subject},launchLeaseIssuer:issuer};
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
  service.manifest.broker = { files: service.manifest.broker.files };service.manifest.env.PASSWORD="synthetic-static";
  service.manifest.broker.files[0].content="synthetic-static";await rm(path.join(root,"consumed.json"));
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
   assert.equal(manifest.executable,"./echo-secret-demo");assert.deepEqual(manifest.args,[]);
   const echoName=windows ? "echo-secret-demo.exe" : "echo-secret-demo";
   await copyFile(process.env.SERVICE_LASSO_TEST_ECHO_BIN,path.join(echoRoot,echoName));await chmod(path.join(echoRoot,echoName),0o700);
   manifest.executable="./"+echoName;
   Object.assign(manifest.env,{ECHO_LOG_PATH:path.join(echoRoot,"echo.log"),ECHO_STATE_PATH:path.join(echoRoot,"state.json"),ECHO_DB_PATH:path.join(echoRoot,"echo.sqlite")});
   await writeFile(path.join(echoRoot,"service.json"),JSON.stringify(manifest));
   const echoRegistry=createServiceRegistry(await discoverServices(servicesRoot));service=echoRegistry.getById("echo-webdav");
   assert.equal((await post("/v1/secrets",{ref:"shared/echo/echo.DEMO_CREDENTIAL",value:"synthetic-demo-credential"})).status,200);
   await installService(service,echoRegistry);await configService(service,echoRegistry,options);
   await startService(service,echoRegistry,options);
   const port=getLifecycleState(service.manifest.id).runtime.ports.service;
   let echoStatus;
   for(let i=0;i<100;i++){try{const response=await fetch(`http://127.0.0.1:${port}/secret-file`);if(response.ok){echoStatus=await response.json();break;}}catch{}await new Promise(r=>setTimeout(r,50));}
   assert.equal(echoStatus?.status,"loaded");assert.equal(echoStatus.reads,1);
   if(process.env.SERVICE_LASSO_TEST_ECHO_CHECK) {
    const {checkEchoSecretFile}=await import(pathToFileURL(process.env.SERVICE_LASSO_TEST_ECHO_CHECK).href);
    assert.deepEqual(await checkEchoSecretFile(`http://127.0.0.1:${port}`),{status:"loaded",sizeBytes:echoStatus.sizeBytes,reads:2});
   } else assert.equal((await (await fetch(`http://127.0.0.1:${port}/secret-file`,{method:"POST"})).json()).reads,2);
   const statusResponse=await request({method:"GET",pathWithQuery:"/v1/file-grants/status?limit=100&cursor=0",headers:{}});
   assert.equal(statusResponse.status,200);const inventory=JSON.parse(statusResponse.body.toString());
   const row=inventory.files.find(file=>file.serviceId==="echo-webdav");assert.equal(row.path,"demo-config.json");assert.equal(row.downloads,2);assert.equal(row.sizeBytes,echoStatus.sizeBytes);assert.equal(row.servedBytes,row.sizeBytes*2);
   const environment=await (await fetch(`http://127.0.0.1:${port}/env`)).text();
   assert.equal(environment.includes(latestURL.split("/")[3]),false);
   for(const file of ["echo.log","state.json"]){const content=await readFile(path.join(echoRoot,file),"utf8");assert.equal(content.includes("synthetic-demo-credential"),false);assert.equal(content.includes(latestURL.split("/")[3]),false);}
   await stopService(service);
   const after=JSON.parse((await request({method:"GET",pathWithQuery:"/v1/file-grants/status",headers:{}})).body.toString());
   assert.equal(after.files.some(file=>file.serviceId==="echo-webdav"),false);
   service.manifest.broker.imports[0].ref="echo.MISSING";
   service.manifest.broker.files[0].content='{"demoCredential":"${echo.MISSING}"}';
   await assert.rejects(startService(service,echoRegistry,options),/preparation failed/);
   assert.equal(getLifecycleState(service.manifest.id).runtime.pid,null);
   const denied=JSON.parse((await request({method:"GET",pathWithQuery:"/v1/file-grants/status",headers:{}})).body.toString());
   assert.equal(denied.files.some(file=>file.serviceId==="echo-webdav"),false);
  }

 } finally {
  if(service&&getLifecycleState(service.manifest.id).running)await stopService(service);
  broker.kill("SIGTERM");if(broker.exitCode===null)await once(broker,"exit");resetLifecycleState();
  if(before===undefined)delete process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT;else process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT=before;
  await rm(tempRoot,{recursive:true,force:true});
 }
});

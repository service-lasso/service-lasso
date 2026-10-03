import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { owningResourceObservations, ownedCommandStderr, relayOwningResourceObservations, runCommand } from "../scripts/mcp-product-acceptance-lib.mjs";
const prefix = "[owning-resource-observation] ";
const decode = text => text.split("\n").filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));

// AC-6G.owning-resource-observation: actual consumer owner code, including its
// original catch/finally, is exercised; no second close algorithm is modeled.
test("consumer creation and exceptional finally preserve exact resource correlation and close order", async () => {
  const source = await readFile(new URL("../scripts/mcp-packaged-consumer-runner.mjs", import.meta.url), "utf8");
  const allocation = source.slice(source.indexOf('const allocateResource = owningResourceObservations("consumer");'), source.indexOf("const configuration = JSON.parse"));
  const body = source.slice(source.indexOf("let httpClient;"));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const failing of ["server_create", "transport_create", "client_create", "connect", "read", "acceptance_and_close", "inspector", "close", "server_stop", "stdio_transport_create", "stdio_client_create", "stdio_connect", "stdio_close", "none"]) {
    let output = "";
    let clients = 0;
    const calls = [];
    const primary = Object.create(null);
    Object.defineProperty(primary, "message", { get() { assert.fail("raw error getter"); } });
    class SafeAcceptanceFailure extends Error { constructor(diagnostic) { super("fixed"); this.diagnostic = diagnostic; } }
    const acceptanceFailure = new SafeAcceptanceFailure({stage:"original_acceptance",errorCode:"original_failure"});
    class Client {
      constructor() { if (failing === "client_create" || failing === "stdio_client_create" && clients > 0) throw primary; this.stdio = clients++ > 0; }
      async connect() { if (failing === "connect" || failing === "stdio_connect" && this.stdio) throw primary; }
      async listTools() { if (failing === "acceptance_and_close") throw acceptanceFailure; if (failing === "read") throw primary; return { tools: Array.from({length:this.stdio ? 15 : 27}, () => ({inputSchema:{additionalProperties:false},outputSchema:{additionalProperties:false}})) }; }
      async listResources() { return {resources:[{},{}]}; }
      async callTool({name,arguments:args}) {
        if (args?.additionalProperty) return {isError:true};
        if (name === "service_lasso_runtime_status") return {structuredContent:{runtime:{status:"ready"}}};
        if (name === "service_lasso_list_services") return {structuredContent:{services:[{id:"fixture"}]}};
        if (!args.execute) return {structuredContent:{status:"preflight",confirmation:{id:"test",confirmationPhrase:"test"}}};
        const replayed = this.executed === true; this.executed = true;
        return {structuredContent:{status:replayed ? "replayed" : "succeeded",idempotency:{replayed},correlationId:"test",result:{resultingState:[{running:true}]}}};
      }
      async close() { calls.push(this.stdio ? "stdio_close" : "http_close"); if (["close", "acceptance_and_close"].includes(failing) && !this.stdio || failing === "stdio_close" && this.stdio) throw primary; }
    }
    class StreamableHTTPClientTransport { constructor() { if (failing === "transport_create") throw primary; this.protocolVersion="test"; } }
    class StdioClientTransport { constructor() { if (failing === "stdio_transport_create") throw primary; } }
    const context = {
      owningResourceObservations: boundary => owningResourceObservations(boundary, value => { output += value; }),
      packaged: {startApiServer:async()=>{ if(failing === "server_create") throw primary; return {url:"http://127.0.0.1",stop:async()=>{calls.push("server_stop");if (failing === "server_stop") throw primary;}}; }},
      configuration:{servicesRoot:"private",httpWorkspaceRoot:"private",stdioWorkspaceRoot:"private",version:"test",serviceId:"fixture",candidateSha:"a".repeat(40)},
      Client,StreamableHTTPClientTransport,StdioClientTransport,SafeAcceptanceFailure, URL,
      reportStage:()=>{},supportedMcpVersions:async()=>({protocolVersion:"test",sdk:{},inspector:{}}),verifyProtocolMatrix:async()=>{},
      payload:value=>value,runInspector:async options=>{ if (failing === "inspector") throw primary; options.resourceObservation.record("creation_attempted");options.resourceObservation.record("created");options.resourceObservation.record("exit_observed");options.resourceObservation.record("close_observed");return {tools:Array(27),resources:[],structuredContent:{runtime:{status:"ready"}}}; },
      path:{join:()=>"private"},installedRoot:"private",consumerRoot:"private",isolatedRuntimeEnvironment:value=>value,
      stableDiagnosticCode:()=>"fixed",currentStage:"http",MCP_PACKAGED_COVERAGE_KEYS:["test"],inspectorEnvironment:{},
      process:{execPath:"private",platform:"linux",exitCode:0,stdout:{write(){}},stderr:{write:value=>{output+=value;}}},
    };
    await new AsyncFunction(...Object.keys(context),allocation+body)(...Object.values(context));
    const rows = decode(output);
    const statuses = role => rows.filter(row=>row.role===role).map(row=>row.status);
    assert.deepEqual(rows.slice(0,8).map(row=>row.sequence),[1,2,3,4,5,6,7,8]);
    for (const role of new Set(rows.map(row=>row.role))) assert.equal(new Set(rows.filter(row=>row.role===role).map(row=>row.sequence)).size, role === "inspector_command" ? 3 : 1);
    if (failing === "acceptance_and_close") {
      assert.equal(output.includes(JSON.stringify(acceptanceFailure.diagnostic)),true);
      assert.deepEqual(calls,["http_close","server_stop"]);
      assert.deepEqual(statuses("http_client").slice(-2),["close_attempted","close_rejected"]);
    }
    assert.equal(output.includes("private"),false);
    assert.equal(context.process.exitCode,failing === "none" ? 0 : 1);
    if(failing === "server_create") { assert.deepEqual(statuses("http_server"),["not_created","creation_attempted","creation_rejected"]);assert.deepEqual(calls,[]); }
    if(failing === "connect") { assert.deepEqual(calls,["http_close","server_stop"]);assert.deepEqual(statuses("http_client").slice(-2),["close_attempted","close_resolved"]); }
    if(failing === "close") { assert.deepEqual(calls,["http_close","http_close","server_stop"]);assert.deepEqual(statuses("http_client").slice(-4),["close_attempted","close_rejected","close_attempted","close_rejected"]); }
    if(failing === "none") assert.deepEqual(calls,["http_close","server_stop","stdio_close"]);
    const reachedStdio = ["stdio_client_create", "stdio_connect", "stdio_close", "none"].includes(failing);
    assert.deepEqual(statuses("stdio_transport"),reachedStdio ? ["not_created","creation_attempted","created","unavailable"] : failing === "stdio_transport_create" ? ["not_created","creation_attempted","creation_rejected"] : ["not_created"]);
    if (failing === "stdio_close") assert.deepEqual(calls,["http_close","server_stop","stdio_close","stdio_close"]);
    if (failing === "server_stop") assert.deepEqual(calls,["http_close","server_stop","server_stop"]);
  }
});

test("owner wrappers preserve hostile rejection identity and ignore failing sinks",async()=>{
  let traps=0;const hostile=new Proxy({}, {get(){traps++;throw 1;},getOwnPropertyDescriptor(){traps++;throw 1;},getPrototypeOf(){traps++;throw 1;}});
  const owner=owningResourceObservations("consumer",()=>{throw hostile;})("http_client");
  for(const operation of ["create","close"]) {let caught;try{await owner[operation](()=>{throw hostile;});}catch(error){caught=error;}assert.equal(caught,hostile);}
  assert.equal(ownedCommandStderr(hostile),undefined);assert.equal(traps,0);
});

test("closed relay rejects contradictory roles, unknown fields and raw output",()=>{
  let input="";const owner=owningResourceObservations("consumer",value=>{input+=value;})("http_client");owner.record("creation_attempted");owner.record("created");owner.record("close_attempted");owner.record("close_rejected");
  const valid=decode(input);const forged={...valid[0],private:"private-token"};
  input+=prefix+JSON.stringify(forged)+"\n"+prefix+JSON.stringify({...valid[2],role:"http_server"})+"\nprivate-token\n";
  let relayed="";relayOwningResourceObservations(input,value=>{relayed+=value;});assert.deepEqual(decode(relayed),valid);assert.equal(relayed.includes("private"),false);
});

test("actual direct commands emit returned-child exit and close separately",async()=>{
  for(const code of [0,3]) {let output="";const resourceObservation=owningResourceObservations("verifier",value=>{output+=value;})("candidate_command");try{await runCommand(process.execPath,["-e",`process.exit(${code})`],{resourceObservation});}catch(error){assert.equal(error.code,code);}assert.deepEqual(decode(output).map(row=>row.status),["not_created","creation_attempted","created","exit_observed","close_observed"]);}
});
// Actual Inspector entrypoint/command owner wiring, with controlled boundary
// outcomes. Full installed Inspector and native package proof remain required.
test("Inspector owner stays not-created before entrypoint failure and uses the same command observation", async()=>{
  const source=await readFile(new URL("../scripts/mcp-product-acceptance-lib.mjs",import.meta.url),"utf8");
  const body=source.slice(source.indexOf("export async function runInspector("),source.indexOf("export const MCP_PRODUCT_EVIDENCE_CONTRACT"));
  for(const unavailable of [true,false]) {
    let output="";const resourceObservation=owningResourceObservations("consumer",value=>{output+=value;})("inspector_command");
    const primary=new Error("private-token");
    const run=new Function("inspectorEntrypoint","runCommand","process",body.replace("export async function","async function")+";return runInspector;")(
      async()=>{if(unavailable)throw primary;return "private-entrypoint";},
      async(command,args,options)=>{assert.equal(options.resourceObservation,resourceObservation);resourceObservation.record("creation_attempted");resourceObservation.record("created");resourceObservation.record("exit_observed");resourceObservation.record("close_observed");return {stdout:"{}"};},
      {execPath:"private-node"});
    let caught;try{await run({serverUrl:"private-url",method:"tools/list",resourceObservation});}catch(error){caught=error;}
    assert.equal(caught,unavailable ? primary : undefined);
    assert.deepEqual(decode(output).map(row=>row.status),unavailable ? ["not_created"] : ["not_created","creation_attempted","created","exit_observed","close_observed"]);
    assert.equal(output.includes("private"),false);
  }
});

test("direct command observations never replace original result when observer throws",async()=>{
  await runCommand(process.execPath,["-e","process.exit(0)"],{resourceObservation:{record(){throw new Error("private");}}});
  let caught;try{await runCommand(process.execPath,["-e","process.exit(4)"],{resourceObservation:{record(){throw new Error("private");}}});}catch(error){caught=error;}
  assert.equal(caught.code,4);
});
test("nested staging command uses actual release command exit/close and preserves rejection",async()=>{
  const source=await readFile(new URL("../scripts/release-artifact-lib.mjs",import.meta.url),"utf8");
  const body=source.slice(source.indexOf("export function runCommand("),source.indexOf("function escapeWindowsCmdArg("));
  const {EventEmitter}=await import("node:events");
  for(const outcome of ["success","nonzero","spawn_error"]) {
    let output="";const resourceObservation=owningResourceObservations("verifier",value=>{output+=value;})("pack_command");
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
    const primary=new Error("private-token");
    const run=new Function("spawn",body.replace("export function","function")+";return runCommand;")(()=>child);
    const promise=run("private-command",["private-arg"],{resourceObservation});
    if(outcome === "spawn_error")child.emit("error",primary);
    else child.emit("exit",outcome === "success" ? 0 : 4);
    child.emit("close",outcome === "success" ? 0 : outcome === "nonzero" ? 4 : null);
    let caught;try{await promise;}catch(error){caught=error;}
    if(outcome === "spawn_error")assert.equal(caught,primary);
    if(outcome === "success")assert.equal(caught,undefined);
    if(outcome === "nonzero")assert.equal(caught instanceof Error,true);
    assert.deepEqual(decode(output).map(row=>row.status),["not_created","creation_attempted","created",outcome === "spawn_error" ? "creation_rejected" : "exit_observed","close_observed"]);
    assert.equal(output.includes("private"),false);
  }
});
test("actual staging lock finally records release without changing callback/release precedence",async()=>{
  const source=await readFile(new URL("../scripts/publish-package-lib.mjs",import.meta.url),"utf8");
  const body=source.slice(source.indexOf("export async function withPackageStageLock("),source.indexOf("function buildPublishedPackageJson("));
  for(const fail of ["acquire","callback","release","both","none"]) {
    let output="";const resourceObservation=owningResourceObservations("verifier",value=>{output+=value;})("stage_lock");
    const primary=Object.create(null);const releaseFailure=Object.create(null);let releases=0;
    const run=new Function("acquirePackageStageLock",body.replace("export async function","async function")+";return withPackageStageLock;")(async()=>{
      if(fail === "acquire")throw primary;
      return async()=>{releases++;if(["release","both"].includes(fail))throw releaseFailure;};
    });
    let caught;try{await run("private",async()=>{if(["callback","both"].includes(fail))throw primary;return "passed";},resourceObservation);}catch(error){caught=error;}
    assert.equal(caught,["release","both"].includes(fail) ? releaseFailure : ["acquire","callback"].includes(fail) ? primary : undefined);
    assert.equal(releases,fail === "acquire" ? 0 : 1);
    assert.deepEqual(decode(output).map(row=>row.status),fail === "acquire" ? ["not_created","creation_attempted","creation_rejected"] : ["not_created","creation_attempted","created","close_attempted",["release","both"].includes(fail) ? "close_rejected" : "close_resolved"]);
    assert.equal(output.includes("private"),false);
  }
});
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
    let relayed = "";
    relayOwningResourceObservations(output, value => { relayed += value; });
    assert.deepEqual(decode(relayed), rows, `actual consumer owner relay: ${failing}`);
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
    let relayed="";relayOwningResourceObservations(output,value=>{relayed+=value;});assert.deepEqual(decode(relayed),decode(output));
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

// AC-6G.owning-resource-observation F1: each forged row is canonical and
// independently reaches a real family state. Rejection must not advance state.
test("canonical relay rejects every role family's incompatible lifecycle and boundary", () => {
  const encode = (role, statuses, boundary = "consumer") => statuses.map(status => prefix + JSON.stringify({
    schema: "service-lasso.owning-resource-observation.v1", boundary, role, sequence: 1, status,
  }) + "\n").join("");
  const relay = input => { let output = ""; relayOwningResourceObservations(input, value => { output += value; }); return output; };
  const created = ["not_created", "creation_attempted", "created"];
  for (const role of [null, 1, [], { toString: "private" }, "toString", "__proto__"]) {
    assert.equal(relay(encode(role, created)), "");
    assert.throws(() => owningResourceObservations("consumer", () => {})(role), /Invalid resource observation role/);
  }
  for (const role of ["http_server", "http_client", "stdio_client"]) {
    for (const contradiction of ["creation_rejected", "exit_observed", "close_observed", "unavailable", "close_resolved", "close_rejected"]) {
      const valid = [...created, "close_attempted", "close_rejected", "close_attempted", "close_resolved"];
      assert.equal(relay(encode(role, [...created, contradiction, ...valid.slice(3)])), encode(role, valid), `${role}/${contradiction}`);
    }
    for (const phase of ["close_attempted", "close_rejected", "close_resolved"]) {
      const prior = [...created, "close_attempted", ...(phase === "close_attempted" ? [] : [phase])];
      for (const contradiction of ["creation_rejected", "exit_observed", "close_observed", "unavailable"]) {
        assert.equal(relay(encode(role, [...prior, contradiction])), encode(role, prior), `${role}/${phase}/${contradiction}`);
      }
    }
  }
  for (const role of ["http_transport", "stdio_transport"]) {
    for (const contradiction of ["creation_rejected", "exit_observed", "close_observed", "close_attempted", "close_resolved", "close_rejected"]) {
      assert.equal(relay(encode(role, [...created, contradiction, "unavailable"])), encode(role, [...created, "unavailable"]), `${role}/${contradiction}`);
    }
    for (const contradiction of ["exit_observed", "close_observed", "close_attempted", "unavailable"]) {
      assert.equal(relay(encode(role, [...created, "unavailable", contradiction])), encode(role, [...created, "unavailable"]));
    }
  }
  for (const contradiction of ["close_attempted", "close_resolved", "close_rejected"]) {
    assert.equal(relay(encode("inspector_command", [...created, contradiction, "exit_observed", "close_observed"])), encode("inspector_command", [...created, "exit_observed", "close_observed"]));
  }
  for (const role of ["inspector_command", "http_server", "http_client", "stdio_client", "http_transport", "stdio_transport"]) {
    const rejected = ["not_created", "creation_attempted", "creation_rejected"];
    for (const contradiction of ["created", "exit_observed", "close_observed", "close_attempted", "unavailable"]) assert.equal(relay(encode(role, [...rejected, contradiction])), encode(role, rejected));
  }
  for (const role of ["candidate_command", "provenance_command", "install_command", "pack_command", "stage_lock", "consumer_command"]) {
    assert.equal(relay(encode(role, [...created, "exit_observed", "close_observed"])), "", role);
    assert.throws(() => owningResourceObservations("consumer", () => {})(role), /Invalid resource observation role/);
  }
  for (const role of ["inspector_command", "http_server", "http_client", "stdio_client", "http_transport", "stdio_transport"]) {
    assert.equal(relay(encode(role, created, "verifier")), "");
    assert.throws(() => owningResourceObservations("verifier", () => {})(role), /Invalid resource observation role/);
  }
});

test("owning producer rejects incompatible statuses for all verifier and consumer role families", () => {
  for (const [boundary, roles, invalid, terminal] of [
    ["verifier", ["candidate_command", "provenance_command", "install_command", "pack_command", "consumer_command"], ["close_attempted", "close_resolved", "close_rejected"], ["exit_observed", "close_observed"]],
    ["consumer", ["inspector_command"], ["close_attempted", "close_resolved", "close_rejected"], ["exit_observed", "close_observed"]],
    ["verifier", ["stage_lock"], ["creation_rejected", "exit_observed", "close_observed", "unavailable"], ["close_attempted", "close_resolved"]],
    ["consumer", ["http_server", "http_client", "stdio_client"], ["creation_rejected", "exit_observed", "close_observed", "unavailable"], ["close_attempted", "close_rejected", "close_attempted", "close_resolved"]],
    ["consumer", ["http_transport", "stdio_transport"], ["creation_rejected", "exit_observed", "close_observed", "close_attempted", "close_resolved", "close_rejected"], ["unavailable"]],
  ]) {
    for (const role of roles) {
      let output = "";
      const owner = owningResourceObservations(boundary, value => { output += value; })(role);
      owner.record("creation_attempted");owner.record("created");
      for (const status of invalid) owner.record(status);
      for (const status of terminal) owner.record(status);
      assert.deepEqual(decode(output).map(row => row.status), ["not_created", "creation_attempted", "created", ...terminal], `${boundary}/${role}`);
      if (boundary === "consumer") { let relayed = "";relayOwningResourceObservations(output, value => { relayed += value; });assert.equal(relayed, output); }
    }
  }
});

// Execute the original direct-command owner body with controlled child events
// and clock callbacks. These prospective fixtures do not claim native custody.
test("actual command owner preserves returned-child error, close without exit and late events after unavailable", async () => {
  const source = await readFile(new URL("../scripts/mcp-product-acceptance-lib.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export async function runCommand("), source.indexOf("function markRunCommandFailure("));
  const { EventEmitter } = await import("node:events");
  for (const outcome of ["sync_spawn_error", "returned_spawn_error", "returned_error_exit", "close_without_exit", "late_exit_close", "late_error_exit_close"]) {
    const primary = new Error("private-command-error");
    const child = new EventEmitter();child.stdout = new EventEmitter();child.stderr = new EventEmitter();child.kill = () => true;
    child.exitCode = null;child.signalCode = null;
    const timers = [];
    const run = new Function("spawn", "setTimeout", "clearTimeout", "markRunCommandFailure", "repoRoot", "MAX_CAPTURE_BYTES", "Buffer", body.replace("export async function", "async function") + ";return runCommand;")(
      () => { if (outcome === "sync_spawn_error") throw primary;return child; },
      callback => { const timer = { callback, unref() {} };timers.push(timer);return timer; },
      () => {}, error => error, "private-root", 1024, Buffer);
    let output = "";
    const resourceObservation = owningResourceObservations("consumer", value => { output += value; })("inspector_command");
    const result = run("private-command", [], { resourceObservation }).then(value => ({ value }), error => ({ error }));
    if (outcome.startsWith("late_")) { timers[0].callback();timers[1].callback(); }
    if (["returned_spawn_error", "returned_error_exit", "late_error_exit_close"].includes(outcome)) child.emit("error", primary);
    if (["returned_error_exit", "late_exit_close", "late_error_exit_close"].includes(outcome)) child.emit("exit", 3, null);
    if (outcome !== "sync_spawn_error") child.emit("close", null, null);
    const settled = await result;
    assert.equal(Boolean(settled.error), true);
    if (["sync_spawn_error", "returned_spawn_error", "returned_error_exit"].includes(outcome)) assert.equal(settled.error, primary);
    const expected = outcome === "sync_spawn_error" ? ["not_created", "creation_attempted", "creation_rejected"]
      : ["not_created", "creation_attempted", "created", ...(outcome.startsWith("late_") ? ["unavailable"] : []),
        ...(["returned_spawn_error", "returned_error_exit", "late_error_exit_close"].includes(outcome) ? ["creation_rejected"] : []),
        ...(["returned_error_exit", "late_exit_close", "late_error_exit_close"].includes(outcome) ? ["exit_observed"] : []), "close_observed"];
    assert.deepEqual(decode(output).map(row => row.status), expected, outcome);
    let relayed = "";relayOwningResourceObservations(output, value => { relayed += value; });assert.equal(relayed, output, outcome);
    assert.equal(output.includes("private"), false);
  }
});

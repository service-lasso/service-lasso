import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { owningResourceObservations, ownedCommandStderr, relayOwningResourceObservations, runCommand } from "../scripts/mcp-product-acceptance-lib.mjs";
const prefix = "[owning-resource-observation] ";
const decode = text => text.split("\n").filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
async function sourceBody(name) {
  return (await readFile(new URL(`../scripts/${name}`, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
}
function originalBody(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Actual owner boundary: ${start}`);
  return source.slice(first, last);
}

// Prospective actual scoped caller fixtures. Controlled dependency boundaries
// do not supply native, package, provider or complete-input acceptance.
test("scoped candidate and four provenance owners preserve skips, order and original rejection", async () => {
  const source = await sourceBody("verify-mcp-packaged-scoped.mjs");
  const allocation = originalBody(source, 'const allocateResource = owningResourceObservations("verifier");', "const repoRoot =");
  const candidate = originalBody(source, "async function exactCandidateSha(", "async function requirePathAbsent(");
  const provenance = originalBody(source, "async function runWindowsProvenanceVerifier(", "function isolatedConsumerEnvironment(");
  const path = (await import("node:path")).default;
  for (const scenario of ["configured", "linux", "windows", "invalid_root", "candidate_failure", "provenance_failure"]) {
    let output = ""; const calls = []; const primary = new Error("private-original");
    const context = {
      owningResourceObservations: boundary => owningResourceObservations(boundary, value => { output += value; }),
      repoRoot: "private-source", path,
      process: { platform: scenario === "linux" ? "linux" : "win32", env: { CANDIDATE_SHA: scenario === "configured" ? "A".repeat(40) : undefined, SystemRoot: scenario === "invalid_root" ? "relative" : "C:\\Windows" }, stderr: { write() {} } },
      runCommand: async (command, args, options) => {
        calls.push({ command, args, options });
        options.resourceObservation.record("creation_attempted");
        if (scenario === "candidate_failure" || scenario === "provenance_failure" && calls.length === 3) { options.resourceObservation.record("creation_rejected"); throw primary; }
        options.resourceObservation.record("created"); options.resourceObservation.record("exit_observed"); options.resourceObservation.record("close_observed");
        return { stdout: "a".repeat(40) };
      },
    };
    const run = new AsyncFunction(...Object.keys(context), allocation + candidate + provenance + `
      const sha = await exactCandidateSha();
      await verifyWindowsProcessInspectorProvenance();
      await verifyWindowsManagedLauncherNativeProvenance();
      await verifyWindowsDpapiHelperProvenance();
      await verifyWindowsDirectorySyncHelperProvenance();
      return sha;
    `);
    let caught, value; try { value = await run(...Object.values(context)); } catch (error) { caught = error; }
    const rows = decode(output); assert.equal(rows.filter(row => row.status === "not_created").length, 9);
    assert.deepEqual(rows.slice(0, 9).map(row => row.sequence), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    if (scenario.endsWith("failure")) assert.equal(caught, primary);
    else if (scenario === "invalid_root") assert.match(caught.message, /absolute Windows system root/);
    else assert.equal(value, "a".repeat(40));
    const reached = calls.filter(call => call.command !== "git");
    for (const call of reached) { assert.equal(call.options.timeoutMs, 60_000); assert.equal(call.command, path.win32.join("C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")); }
    assert.deepEqual(reached.map(call => call.options.resourceObservation), [...new Set(reached.map(call => call.options.resourceObservation))]);
    if (scenario === "windows" || scenario === "configured") assert.equal(reached.length, 4);
    if (scenario === "configured") assert.equal(rows.filter(row => row.role === "candidate_command").length, 1);
    if (scenario === "linux") assert.equal(reached.length, 0);
    assert.equal(output.includes("private"), false);
  }
});

test("entire scoped verifier owns nested staging, installation, consumer relay and exceptional finally", async () => {
  const source = await sourceBody("verify-mcp-packaged-scoped.mjs");
  const allocation = originalBody(source, 'const allocateResource = owningResourceObservations("verifier");', "const repoRoot =");
  const body = source.slice(source.indexOf("let verificationFailure = null;"));
  const library = await sourceBody("mcp-product-acceptance-lib.mjs");
  const commandBody = originalBody(library, "export async function runCommand(", "async function inspectorEntrypoint(").replaceAll("export ", "");
  const kinds = originalBody(library, "const RUN_COMMAND_FAILURE_KINDS =", "const SAFE_DIAGNOSTIC_CODE =");
  const release = await sourceBody("release-artifact-lib.mjs");
  const packBody = originalBody(release, "export function runCommand(", "export function runNpmCommand(").replace("export ", "");
  const publish = await sourceBody("publish-package-lib.mjs");
  const lockBody = originalBody(publish, "export async function withPackageStageLock(", "function buildPublishedPackageJson(").replace("export ", "");
  const stageBody = originalBody(publish, "export async function stagePublishedPackage(", "export async function verifyPublishedPackage(").replace("export ", "");
  const { EventEmitter } = await import("node:events");
  const path = (await import("node:path")).default;
  const { createHash } = await import("node:crypto");
  const { dependencyAcquisitionReceipt, packagedVerificationDiagnostic } = await import("../scripts/packaged-verification-diagnostics.mjs");
  const { ownedTempCleanupObservation, removeOwnedTempRoot } = await import("../scripts/owned-temp-cleanup.mjs");
  const { parsePackagedAcceptanceFailure, runCommandFailureKind } = await import("../scripts/mcp-product-acceptance-lib.mjs");
  for (const scenario of ["success", "setup", "lock_acquire", "pack", "lock_release", "pack_and_release", "install", "consumer", "unclosed", "accessor", "cleanup", "consumer_and_cleanup"]) {
    let stderr = "", stdout = "", releases = 0, cleanups = 0, writes = 0; const commands = [], copies = [], buffers = [];
    const primary = new Error("private-original"), releaseError = new Error("private-release"); const cleanupError = Object.assign(new Error("private-cleanup"), { code: "EACCES" });
    let consumerStderr = "";
    const consumerOwner = owningResourceObservations("consumer", value => { consumerStderr += value; })("http_client");
    for (const status of ["creation_attempted", "created", "close_attempted", "close_rejected", "close_attempted", "close_resolved"]) consumerOwner.record(status);
    const validConsumer = decode(consumerStderr);
    consumerStderr += "private-token\n" + prefix + JSON.stringify({ ...validConsumer[0], private: "private-token" }) + "\n";
    consumerStderr += prefix + JSON.stringify({ ...validConsumer[0], boundary: "verifier", role: "install_command" }) + "\n";
    consumerStderr += prefix + JSON.stringify({ ...validConsumer[0], role: "stdio_client", status: "close_resolved" }) + "\n";
    consumerStderr += prefix + '{"schema":"service-lasso.owning-resource-observation.v1","boundary":"consumer","role":"http_client","sequence":2,"sequence":2,"status":"not_created"}\n';
    consumerStderr += prefix + JSON.stringify({ ...validConsumer[0], role: "__proto__", sequence: 2 }) + "\n";
    const spawn = (command, args, options) => {
      const phase = args.includes("pack") ? "pack" : args.includes("install") ? "install" : "consumer";
      commands.push({ phase, command, args, options });
      if (phase === "pack") { assert.equal(options.shell, false); assert.equal(options.windowsVerbatimArguments, false); }
      else { assert.equal(options.shell, undefined); assert.equal(options.windowsVerbatimArguments, undefined); }
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.exitCode = null; child.signalCode = null; child.kill = () => true;
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from(phase === "pack" ? "fixture.tgz\n" : phase === "consumer" ? JSON.stringify({ sdk: { protocolVersion: "test", version: "1.0.0" }, inspector: { version: "2.4.0" }, packagedRuntime: {}, canonical: {}, coverage: {}, assertions: {} }) : ""));
        if (phase === "consumer") child.stderr.emit("data", Buffer.from(consumerStderr));
        if (scenario === phase || phase === "consumer" && scenario === "consumer_and_cleanup" || phase === "pack" && scenario === "pack_and_release") child.emit("error", primary);
        child.emit("exit", 0, null); child.emit("close", 0, null);
      });
      return child;
    };
    const mcpCommand = new Function("spawn", "repoRoot", "MAX_CAPTURE_BYTES", kinds + commandBody + ";return runCommand;")(spawn, "private-source", 2 * 1024 * 1024);
    const packCommand = new Function("spawn", packBody + ";return runCommand;")(spawn);
    const lock = new Function("acquirePackageStageLock", lockBody + ";return withPackageStageLock;")(async () => {
      if (scenario === "lock_acquire") throw primary;
      return async () => { releases++; if (["lock_release", "pack_and_release"].includes(scenario)) throw releaseError; };
    });
    const scope = Object.freeze({ fixture: "private-policy" });
    const stageContext = {
      path, withPackageStageLock: lock, consumeReleaseMetadataToken: () => "private-token", getPublishedPackageArtifactName: () => "fixture-package",
      ensureBuildOutput: async () => {}, rm: async () => {}, mkdir: async () => {}, PUBLISH_FILES: [], copyPublishPath: async () => {},
      stageOperatorTools: async options => assert.equal(options.scope, scope), verifyRetainedOperatorTools: async () => {},
      writePublishScaffold: async () => ({ artifactKind: "fixture" }), writeArtifactSBOM: async () => {}, stat: async () => {},
      runNpmCommand: async (args, options) => {
        try { return await packCommand("private-node", ["private-npm", ...args], options); }
        catch (error) { assert.equal(error, primary); throw error; }
      },
    };
    const stage = new Function(...Object.keys(stageContext), stageBody + ";return stagePublishedPackage;")(...Object.values(stageContext));
    const context = {
      path, createHash, scope, ownedCommandStderr,
      owningResourceObservations: boundary => owningResourceObservations(boundary, value => { stderr += value; }),
      relayOwningResourceObservations: value => relayOwningResourceObservations(value, line => { stderr += line; }),
      dependencyAcquisitionReceipt, packagedVerificationDiagnostic, runCommandFailureKind, ownedTempCleanupObservation, parsePackagedAcceptanceFailure,
      ownPackagedAcceptanceDiagnostic: error => Object.getOwnPropertyDescriptor(error, "packagedAcceptanceDiagnostic")?.value,
      operatorToolFailureDiagnostic: () => undefined, releaseMetadataToken: "private-token",
      tempRoot: "private-root", consumerRoot: "private-root/consumer", servicesRoot: "private-services", httpWorkspaceRoot: "private-http", stdioWorkspaceRoot: "private-stdio",
      repoRoot: "private-source", packageOutputRoot: "private-output", version: "0.1.0", candidateSha: "a".repeat(40), platform: "linux", pinnedSdkVersion: "1.0.0", npmEntrypoint: "private-npm", evidencePath: "private-evidence", MCP_PRODUCT_EVIDENCE_CONTRACT: "test",
      mkdir: async () => { if (scenario === "setup") throw primary; }, writeCanonicalService: async () => "fixture",
      stagePublishedPackage: async options => {
        try { return await stage(options); }
        catch (error) { assert.equal(error, ["lock_release", "pack_and_release"].includes(scenario) ? releaseError : primary); throw error; }
      },
      readFile: async file => { if (file.endsWith("package.json")) return JSON.stringify({ name: "@service-lasso/service-lasso", version: "0.1.0" }); const bytes = Buffer.from("held same native bytes"); buffers.push(bytes); return bytes; },
      writeFile: async file => { if (file === "private-evidence") writes++; }, copyFile: async (from, to) => { copies.push({ from, to }); }, requirePathAbsent: async () => {}, isolatedConsumerEnvironment: value => value,
      runCommand: async (command, args, options) => {
        const isConsumer = options.timeoutMs === 900_000;
        if (isConsumer && scenario === "accessor") { const error = new Error("private-accessor"); Object.defineProperty(error, "stderr", { get() { assert.fail("stderr getter invoked"); } }); throw error; }
        let result;
        try { result = await mcpCommand(command, args, options); }
        catch (error) { assert.equal(error, primary); throw error; }
        return isConsumer && scenario === "unclosed" ? { ...result, closeObserved: false } : result;
      },
      validateMcpProductEvidence: evidence => assert.equal(Object.hasOwn(evidence, "resourceObservations"), false),
      removeOwnedTempRoot: root => removeOwnedTempRoot(root, { remove: async () => { cleanups++; if (["cleanup", "consumer_and_cleanup"].includes(scenario)) throw cleanupError; }, wait: async () => assert.fail("nonretryable cleanup waited") }),
      process: { execPath: "private-node", platform: "linux", env: {}, arch: "x64", version: "test", exitCode: 0, stderr: { write: value => { stderr += value; } }, stdout: { write: value => { stdout += value; } } },
    };
    await new AsyncFunction(...Object.keys(context), allocation + body)(...Object.values(context));
    assert.equal(cleanups, 1); assert.equal(context.process.exitCode, scenario === "success" ? 0 : 1);
    const rows = decode(stderr), statuses = role => rows.filter(row => row.boundary === "verifier" && row.role === role).map(row => row.status);
    assert.equal(rows.filter(row => row.boundary === "verifier" && row.status === "not_created").length, 9);
    assert.deepEqual(statuses("candidate_command"), ["not_created"]); assert.equal(rows.filter(row => row.role === "provenance_command").length, 4);
    const reachedStage = scenario !== "setup", acquired = reachedStage && scenario !== "lock_acquire";
    assert.equal(releases, acquired ? 1 : 0);
    assert.deepEqual(statuses("stage_lock"), !reachedStage ? ["not_created"] : !acquired ? ["not_created", "creation_attempted", "creation_rejected"] : ["not_created", "creation_attempted", "created", "close_attempted", ["lock_release", "pack_and_release"].includes(scenario) ? "close_rejected" : "close_resolved"]);
    for (const role of ["pack_command", "install_command", "consumer_command"]) {
      const phase = role.split("_")[0], call = commands.find(command => command.phase === phase);
      assert.deepEqual(statuses(role), call ? ["not_created", "creation_attempted", "created", ...(scenario === phase || phase === "consumer" && scenario === "consumer_and_cleanup" || phase === "pack" && scenario === "pack_and_release" ? ["creation_rejected"] : []), "exit_observed", "close_observed"] : ["not_created"], `${scenario}/${role}`);
    }
    const install = commands.find(command => command.phase === "install"), consumer = commands.find(command => command.phase === "consumer");
    if (install) assert.deepEqual(install.args.slice(0, 7), ["private-npm", "install", "--json", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact"]);
    if (consumer) { assert.equal(copies.length, 2); assert.deepEqual(copies.map(copy => path.basename(copy.to)), ["mcp-packaged-consumer-runner.mjs", "mcp-product-acceptance-lib.mjs"]); assert.deepEqual(rows.filter(row => row.boundary === "consumer"), validConsumer); }
    if (["consumer", "consumer_and_cleanup", "install"].includes(scenario)) assert.equal(ownedCommandStderr(primary), scenario.startsWith("consumer") ? consumerStderr : "");
    assert.equal(stderr.includes("private"), false); assert.equal(stdout.includes("private"), false);
    if (["cleanup", "consumer_and_cleanup"].includes(scenario)) { const error = JSON.parse(stderr.split("\n").find(line => line.startsWith("[mcp-package-verification-error] ")).slice("[mcp-package-verification-error] ".length)); assert.equal(error.stage, "temp_cleanup"); if (scenario === "consumer_and_cleanup") assert.equal(error.verificationStage, "consumer_runner"); }
    assert.equal(writes, ["success", "cleanup"].includes(scenario) ? 1 : 0);
    if (copies.length) assert.equal(buffers.slice(1).every(bytes => bytes.every(byte => byte === 0)), true);
  }
});

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
  const start=source.indexOf("export function runCommand(");
  const end=source.indexOf("export function runNpmCommand(",start);
  assert.ok(start>=0 && end>start,"actual release command export boundary");
  const body=source.slice(start,end);
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

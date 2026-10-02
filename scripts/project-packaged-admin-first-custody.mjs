import { rawBuffer, sameIdentity, nativeProof, validateCommand } from "./command-native-proof-lib.mjs";
import { validDirectoryIdentity } from "./exact-native-file-identity-lib.mjs";
// Strict local validator and the only public projector for private v3 custody.
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { beginBootstrapCapture, publishAfterBootstrap, bootstrapProtocolScript, DIGEST, validAcl, darwinCacheHeader, exact, inside, nonReparseDirectory, ownership, regularClosedBytes, regularClosedFile, requireStrictJson, SHA, sha256 } from "./private-first-custody-v3-lib.mjs";

import { replayGit, gitMetadata } from "./first-custody-git-replay-lib.mjs";

function argument(flag) { const index = process.argv.indexOf(flag); if (index < 0 || !process.argv[index + 1]) throw new Error(`first_custody_${flag}_missing`); return path.resolve(process.argv[index + 1]); }
function fileProof(value) { return exact(value, ["size", "sha256"]) && Number.isSafeInteger(value.size) && value.size >= 0 && DIGEST.test(value.sha256); }
function rootProof(value) { const acl=value?.acl, posix=exact(acl,["checked","tool","rawSha256"])&&acl.checked===true&&acl.tool==="posix"&&acl.rawSha256===null, windows=exact(acl,["checked","tool","ownerSid","currentSid","rules"])&&acl.checked===true&&acl.tool==="windows_sid_dacl"&&typeof acl.ownerSid==="string"&&acl.ownerSid===acl.currentSid&&validAcl({owner:acl.ownerSid,current:acl.currentSid,protected:true,rules:acl.rules}); return exact(value, ["path", "uid", "gid", "mode", "acl", "identity"]) && typeof value.path === "string" && Number.isInteger(value.mode) && (posix||windows) && validDirectoryIdentity(value.identity); }
async function sourceFiles(root, relative = "") { const files = []; for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) { if (!relative && entry.name === ".git") continue; const item = path.join(relative, entry.name); if (entry.isDirectory()) files.push(...await sourceFiles(root, item)); else if (entry.isFile()) files.push(item.replaceAll("\\", "/")); else throw new Error("first_custody_validator_workspace_reparse"); } return files; }
beginBootstrapCapture();
const required = ["GITHUB_WORKSPACE", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "QUALIFICATION_PLATFORM", "QUALIFICATION_CANDIDATE_SHA", "QUALIFICATION_PRIVATE_CUSTODY_ROOT", "QUALIFICATION_INITIAL_RECEIPT_PATH", "QUALIFICATION_INITIAL_PROJECTION_PATH", "QUALIFICATION_EVIDENCE_ROOT", "SERVICE_LASSO_WORKSPACE_ROOT", "SERVICE_LASSO_INSTANCE_REGISTRY_PATH", "SERVICE_LASSO_HOST_PORT_REGISTRY_PATH"];
for (const key of required) if (!process.env[key]) throw new Error(`first_custody_validator_${key.toLowerCase()}_missing`);
for(const key of required.filter(key=>key.endsWith("_ROOT")||key.endsWith("_PATH")||key==="GITHUB_WORKSPACE"))if(!path.isAbsolute(process.env[key]))throw new Error("first_custody_validator_literal_path_not_absolute");
const literal = key => path.resolve(process.env[key]);
const input = argument("--input"), journalPath = argument("--journal"), output = argument("--output"), workspace = literal("GITHUB_WORKSPACE"), privateRoot = literal("QUALIFICATION_PRIVATE_CUSTODY_ROOT"), evidenceRoot = literal("QUALIFICATION_EVIDENCE_ROOT"), boundary = path.dirname(privateRoot);
if (workspace!==path.resolve(process.cwd())||input !== literal("QUALIFICATION_INITIAL_RECEIPT_PATH") || output !== literal("QUALIFICATION_INITIAL_PROJECTION_PATH") || journalPath !== path.join(privateRoot, "first-custody-journal.json") || path.dirname(input) !== privateRoot || path.dirname(output) !== evidenceRoot || !inside(evidenceRoot, boundary) || inside(evidenceRoot, workspace) || inside(privateRoot, workspace) || privateRoot === evidenceRoot) throw new Error("first_custody_validator_projection_boundary_invalid");
// Semantic parsing uses the same verified held bytes that supply the digest.
const sourceBytes = await regularClosedBytes(input, privateRoot), journalBytes = await regularClosedBytes(journalPath, privateRoot), source = sourceBytes.toString("utf8"), receipt = requireStrictJson(source, "first_custody_validator_receipt"), journal = requireStrictJson(journalBytes.toString("utf8"), "first_custody_validator_journal");
const journalFile = { size: journalBytes.length, sha256: sha256(journalBytes) };
if (!exact(receipt, ["schema", "private", "platform", "run", "source", "roots", "registries", "runner", "tools", "journal"]) || receipt.schema !== "service-lasso.qualification-initial-receipt.v3" || receipt.private !== true || receipt.platform !== process.platform || receipt.platform !== process.env.QUALIFICATION_PLATFORM || !exact(receipt.run, ["id", "attempt"]) || receipt.run.id !== process.env.GITHUB_RUN_ID || receipt.run.attempt !== process.env.GITHUB_RUN_ATTEMPT || !/^[1-9][0-9]*$/u.test(receipt.run.id) || !/^[1-9][0-9]*$/u.test(receipt.run.attempt) || !exact(receipt.source, ["head", "tree", "clean", "tracked", "gitMetadata"]) || receipt.source.head !== process.env.QUALIFICATION_CANDIDATE_SHA || !SHA.test(receipt.source.head) || !SHA.test(receipt.source.tree) || receipt.source.clean !== true || !Array.isArray(receipt.source.tracked) || !receipt.source.tracked.length) throw new Error("first_custody_validator_receipt_shape_invalid");
const expectedRoots = { privateRoot, evidenceRoot, workspaceRoot: literal("SERVICE_LASSO_WORKSPACE_ROOT"), instanceRegistryParent: path.dirname(literal("SERVICE_LASSO_INSTANCE_REGISTRY_PATH")), hostPortRegistryParent: path.dirname(literal("SERVICE_LASSO_HOST_PORT_REGISTRY_PATH")) };
if (!exact(receipt.roots, Object.keys(expectedRoots))) throw new Error("first_custody_validator_root_shape_invalid");
for (const [role, expectedPath] of Object.entries(expectedRoots)) {
  const root = receipt.roots[role]; if (!rootProof(root) || root.path !== expectedPath || !inside(expectedPath, boundary) || inside(expectedPath, workspace)) throw new Error("first_custody_validator_root_proof_invalid");
  const current = await ownership(expectedPath, boundary); if (JSON.stringify(current) !== JSON.stringify(root)) throw new Error("first_custody_validator_root_changed");
}
await nonReparseDirectory(path.dirname(output), evidenceRoot);
if (await lstat(output).catch(error => error.code === "ENOENT" ? null : Promise.reject(error))) throw new Error("first_custody_validator_output_exists");
if (!exact(journal, ["schema", "private", "commands", "toolMetadata"]) || journal.schema !== "service-lasso.qualification-first-custody-journal.v3" || journal.private !== true || !Array.isArray(journal.commands) || !exact(journal.toolMetadata, ["sourceStatus", "nodeVersion", "csc"]) || journal.toolMetadata.sourceStatus !== "CLEAN_BY_HEAD_TREE_BLOB_BODIES_AND_TRACKED_BYTES" || !/^v\d+\.\d+\.\d+$/u.test(journal.toolMetadata.nodeVersion) || journal.commands.length !== (journal.toolMetadata.csc === null ? 2 : 3)) throw new Error("first_custody_validator_journal_shape_invalid");
const expectedTools = journal.toolMetadata.csc === null ? ["git", "node"] : ["git", "node", "csc", "powershell"];
if (!Array.isArray(receipt.tools) || receipt.tools.length !== expectedTools.length || receipt.tools.some((tool, index) => !exact(tool, ["name", "requested", "resolved", "file"]) || tool.name !== expectedTools[index] || typeof tool.requested !== "string" || path.resolve(tool.requested) !== tool.requested || typeof tool.resolved !== "string" || path.resolve(tool.resolved) !== tool.resolved || !fileProof(tool.file))) throw new Error("first_custody_validator_tool_binding_invalid");
const toolMap = new Map(receipt.tools.map(tool => [tool.name, tool]));
async function currentGitRequest() {
  for (const folder of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) for (const suffix of process.platform === "win32" ? [".exe", ""] : [""]) {
    const file=path.resolve(folder,"git"+suffix),entry=await lstat(file).catch(error=>error.code==="ENOENT"?null:Promise.reject(error));if(entry?.isFile()||entry?.isSymbolicLink())return file;
  }
  throw new Error("first_custody_validator_git_unresolved");
}
if(toolMap.get("git").requested!==await currentGitRequest()||toolMap.get("node").requested!==path.resolve(process.execPath))throw new Error("first_custody_validator_literal_tool_request_changed");
if(receipt.platform==="win32") {
  const compilerPath=path.join(process.env.WINDIR??"C:\\Windows","Microsoft.NET","Framework64","v4.0.30319","csc.exe"),presentCompiler=await lstat(compilerPath).catch(error=>error.code==="ENOENT"?null:Promise.reject(error));
  if(Boolean(presentCompiler)!==(journal.toolMetadata.csc!==null)||presentCompiler&&(toolMap.get("csc").requested!==path.resolve(compilerPath)||toolMap.get("powershell").requested!==path.resolve(path.join(process.env.SystemRoot??process.env.WINDIR,"System32","WindowsPowerShell","v1.0","powershell.exe"))))throw new Error("first_custody_validator_compiler_literal_changed");
}
for (const tool of receipt.tools) { if (await realpath(tool.requested) !== tool.resolved) throw new Error("first_custody_validator_tool_alias_changed"); const actual = await regularClosedFile(tool.resolved, path.parse(tool.resolved).root); if (actual.size !== tool.file.size || actual.sha256 !== tool.file.sha256) throw new Error("first_custody_validator_tool_tampered"); }
const runner = receipt.runner, node = toolMap.get("node");
if (!exact(runner, ["platform", "arch", "release", "executable", "nativeBirthCustody"]) || runner.platform !== receipt.platform || runner.arch !== process.arch || runner.release !== os.release() || runner.nativeBirthCustody !== "HELD_NATIVE_V1" || !exact(runner.executable, ["requested", "resolved", "file"]) || runner.executable.requested !== node.requested || runner.executable.resolved !== node.resolved || !fileProof(runner.executable.file) || JSON.stringify(runner.executable.file) !== JSON.stringify(node.file) || await realpath(process.execPath) !== node.resolved) throw new Error("first_custody_validator_runner_invalid");
const raw = [];
for (const [index, command] of journal.commands.entries()) {
  validateCommand(index, command, journal, toolMap, node, workspace, receipt.platform, metadataScript);
  const streams = {};
  for (const stream of ["stdout", "stderr"]) { const expectedStream = command.result[stream]; if (!fileProof(expectedStream)) throw new Error("first_custody_validator_raw_closure_invalid"); const bytes = await regularClosedBytes(path.join(privateRoot, `journal-${index}.${stream}`), privateRoot); if (bytes.length !== expectedStream.size || sha256(bytes) !== expectedStream.sha256) throw new Error("first_custody_validator_raw_tampered"); streams[stream] = bytes; }
  if (streams.stderr.length !== 0) throw new Error("first_custody_validator_unexpected_stderr"); raw.push(streams.stdout);
}
if (raw[1].toString("utf8") !== journal.toolMetadata.nodeVersion + "\n" || journal.toolMetadata.nodeVersion !== process.version) throw new Error("first_custody_validator_node_version_mismatch");
if (journal.toolMetadata.csc !== null) {
  const compiler = toolMap.get("csc"), metadata = journal.toolMetadata.csc;
  if (receipt.platform !== "win32" || !compiler || !exact(metadata, ["file", "observation"]) || JSON.stringify(metadata.file) !== JSON.stringify(compiler.file) || !exact(metadata.observation, ["status", "reason", "source", "version"]) || metadata.observation.status !== "NOT_INVOKED" || metadata.observation.reason !== "NO_PREDEPENDENCY_COMPILER_ACTION_IS_AUTHORISED" || metadata.observation.source !== "WINDOWS_FILEVERSIONINFO_V1" || !exact(metadata.observation.version, ["FileVersion", "ProductVersion", "OriginalFilename"]) || !Object.values(metadata.observation.version).every(value => typeof value === "string" && value) || JSON.stringify(requireStrictJson(raw[2].toString("utf8"), "first_custody_validator_compiler_raw")) !== JSON.stringify(metadata.observation.version)) throw new Error("first_custody_validator_compiler_provenance_invalid");
}
function metadataScript(resolved) { if (!resolved) return ""; return `$null=[Console]::In.ReadLine();$v=(Get-Item -LiteralPath '${resolved.replaceAll("'", "''")}').VersionInfo;[ordered]@{FileVersion=$v.FileVersion;ProductVersion=$v.ProductVersion;OriginalFilename=$v.OriginalFilename}|ConvertTo-Json -Compress`; }
const replay = replayGit(raw[0], receipt.source.head);
if (replay.tree !== receipt.source.tree || replay.tracked.length !== receipt.source.tracked.length) throw new Error("first_custody_validator_git_tree_mismatch");
const present = await sourceFiles(workspace);
if (present.length !== replay.tracked.length) throw new Error("first_custody_validator_inventory_incomplete");
for (const [index, retained] of receipt.source.tracked.entries()) {
  const entry = replay.tracked[index];
  if (!exact(retained, ["path", "gitBlob", "mode", "file"]) || retained.path !== entry.path || retained.gitBlob !== entry.gitBlob || retained.mode !== entry.mode || !fileProof(retained.file) || !present.includes(entry.path)) throw new Error("first_custody_validator_inventory_invalid");
  const file = path.resolve(workspace, entry.path); if (!inside(file, workspace) || file === workspace) throw new Error("first_custody_validator_inventory_escape");
  const bytes = await regularClosedBytes(file, workspace); if (!bytes.equals(entry.bytes) || bytes.length !== retained.file.size || sha256(bytes) !== retained.file.sha256) throw new Error("first_custody_validator_workspace_tampered");
}
const currentMetadata = await gitMetadata(workspace, replay.head, replay.tracked);
if (JSON.stringify(currentMetadata) !== JSON.stringify(receipt.source.gitMetadata)) throw new Error("first_custody_validator_git_metadata_changed");
if (!exact(receipt.journal, ["path", "file"]) || receipt.journal.path !== journalPath || !fileProof(receipt.journal.file) || receipt.journal.file.size !== journalFile.size || receipt.journal.file.sha256 !== journalFile.sha256) throw new Error("first_custody_validator_journal_tampered");
const expectedRegistries = [literal("SERVICE_LASSO_INSTANCE_REGISTRY_PATH"), literal("SERVICE_LASSO_HOST_PORT_REGISTRY_PATH")];
if (expectedRegistries[0] === expectedRegistries[1] || !Array.isArray(receipt.registries) || receipt.registries.length !== 2) throw new Error("first_custody_validator_registry_roles_invalid");
for (const [index, registry] of receipt.registries.entries()) {
  if (!exact(registry, ["path", "state", "parent"]) || registry.path !== expectedRegistries[index] || !inside(registry.path, boundary) || inside(registry.path, workspace) || registry.state !== "ABSENT" || !rootProof(registry.parent) || registry.parent.path !== path.dirname(registry.path) || JSON.stringify(await ownership(path.dirname(registry.path), boundary)) !== JSON.stringify(registry.parent) || await lstat(registry.path).catch(error => error.code === "ENOENT" ? null : Promise.reject(error))) throw new Error("first_custody_validator_registry_present");
}
const bootstrapSeal=requireStrictJson((await regularClosedBytes(path.join(privateRoot,"bootstrap-seal.json"),privateRoot)).toString("utf8"),"first_custody_validator_bootstrap");
if(!exact(bootstrapSeal,["schema","private","receiptSha256","journalSha256","session","commands"])||bootstrapSeal.schema!=="service-lasso.qualification-bootstrap-seal.v1"||bootstrapSeal.private!==true||bootstrapSeal.receiptSha256!==sha256(sourceBytes)||bootstrapSeal.journalSha256!==sha256(journalBytes)||!Array.isArray(bootstrapSeal.commands)||(receipt.platform==="win32"?!bootstrapSeal.session||bootstrapSeal.commands.length===0:bootstrapSeal.session!==null||bootstrapSeal.commands.length!==0))throw new Error("first_custody_validator_bootstrap_seal_invalid");
if(bootstrapSeal.session!==null) {
  const session=bootstrapSeal.session,tool=session.tool,result=session.result,requested=path.join(process.env.SystemRoot??"C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe");
  if(!exact(session,["tool","args","native","result"])||!exact(tool,["name","requested","resolved","file"])||tool.name!=="powershell"||tool.requested!==requested||!fileProof(tool.file)||JSON.stringify(session.args)!==JSON.stringify(["-NoLogo","-NoProfile","-NonInteractive","-Command",bootstrapProtocolScript()])||!nativeProof(session.native,tool.resolved,workspace,receipt.platform)||session.native.imageSha256!==tool.file.sha256||!sameIdentity(session.native.parents.at(-1),journal.commands[0].native.parents.at(-1))||!exact(result,["naturalWaitForExit","exitCode","signal","stdoutEof","stderrEof","stdin","stdout","stderr","stdinSha256","stdoutSha256","stderrSha256"])||result.naturalWaitForExit!==true||result.exitCode!==0||result.signal!==null||result.stdoutEof!==true||result.stderrEof!==true||!rawBuffer(result.stdin,result.stdinSha256)||!rawBuffer(result.stdout,result.stdoutSha256)||!rawBuffer(result.stderr,result.stderrSha256)||result.stderr.data.length!==0)throw new Error("first_custody_validator_bootstrap_native_invalid");
  const actual=await regularClosedFile(tool.resolved,path.parse(tool.resolved).root);if(actual.size!==tool.file.size||actual.sha256!==tool.file.sha256||await realpath(tool.requested)!==tool.resolved)throw new Error("first_custody_validator_bootstrap_tool_changed");
  const requests=[],outputs=[];
  for(const probe of bootstrapSeal.commands){
    if(!exact(probe,["purpose","target","requestSha256","stdout","stdoutSha256"])||!["acl_read","acl_set","reparse"].includes(probe.purpose)||typeof probe.target!=="string"||!path.isAbsolute(probe.target)||!rawBuffer(probe.stdout,probe.stdoutSha256))throw new Error("first_custody_validator_bootstrap_request_invalid");
    const request=Buffer.from(JSON.stringify({purpose:probe.purpose,target:probe.target})+"\n"),stdout=Buffer.from(probe.stdout.data);if(sha256(request)!==probe.requestSha256||!stdout.length||stdout.at(-1)!==10||stdout.subarray(0,-1).includes(10))throw new Error("first_custody_validator_bootstrap_request_result_invalid");requests.push(request);outputs.push(stdout);
    const value=requireStrictJson(stdout.toString("utf8"),"first_custody_validator_bootstrap_result");if(probe.purpose==="acl_read"?!validAcl(value):probe.purpose==="acl_set"?(!exact(value,["applied"])||value.applied!==true):(!exact(value,["attributes","reparse","tag"])||!Number.isSafeInteger(value.attributes)||(value.attributes&16)===0||(value.attributes&1024)!==0||value.reparse!==false||value.tag!==null))throw new Error("first_custody_validator_bootstrap_result_invalid");
  }
  if(!Buffer.concat(requests).equals(Buffer.from(result.stdin.data))||!Buffer.concat(outputs).equals(Buffer.from(result.stdout.data)))throw new Error("first_custody_validator_bootstrap_order_or_closure_invalid");
}
if(receipt.platform==="win32") {
  for(const root of Object.values(receipt.roots))if(root.acl.currentSid!==journal.commands[0].native.sourceCaller.uid)throw new Error("first_custody_validator_bootstrap_root_sid_mismatch");
  const operations=new Map();for(const probe of bootstrapSeal.commands){const key=probe.purpose+"\0"+probe.target;if(!operations.has(key))operations.set(key,[]);operations.get(key).push(requireStrictJson(Buffer.from(probe.stdout.data).toString("utf8"),"first_custody_validator_bootstrap_coverage"));}
  for(const root of Object.values(receipt.roots)){const reads=operations.get("acl_read\0"+root.path)??[];if(!reads.some(value=>value.owner===root.acl.ownerSid&&value.current===root.acl.currentSid&&JSON.stringify(value.rules)===JSON.stringify(root.acl.rules)))throw new Error("first_custody_validator_bootstrap_root_result_missing");}
  for(const root of [boundary,privateRoot,evidenceRoot,receipt.roots.workspaceRoot.path])if(!operations.has("acl_set\0"+root))throw new Error("first_custody_validator_bootstrap_root_creation_missing");
  const directories=new Set();function parents(directory,stop){for(let cursor=directory;;cursor=path.dirname(cursor)){directories.add(cursor);if(cursor===stop)return;if(cursor===path.dirname(cursor))throw new Error("first_custody_validator_bootstrap_parent_escape");}}
  for(const entry of receipt.source.tracked)parents(path.dirname(path.resolve(workspace,entry.path)),workspace);
  for(const file of [...receipt.source.gitMetadata.files,...receipt.tools.map(tool=>({path:tool.resolved}))])parents(path.dirname(file.path),path.parse(file.path).root);
  for(const directory of Object.values(expectedRoots))parents(directory,boundary);
  for(const directory of directories)if(!operations.has("reparse\0"+directory))throw new Error("first_custody_validator_bootstrap_parent_observation_missing");
}
for (const command of [...journal.commands,...(bootstrapSeal.session===null?[]:[bootstrapSeal.session])]) if (command.native.helper !== null) {
  const helper = command.native.helper, executable = await regularClosedFile(helper.executable, path.parse(helper.executable).root);
  const expectedHelper=helper.platform==="win32"?path.join(process.env.SystemRoot??process.env.WINDIR,"System32","WindowsPowerShell","v1.0","powershell.exe"):"/usr/bin/python3";
  if(await realpath(expectedHelper)!==helper.executable)throw new Error("first_custody_validator_literal_helper_changed");
  if (executable.sha256 !== helper.executableSha256) throw new Error("first_custody_validator_helper_executable_tampered");
  for (const library of helper.libraries) { if (helper.platform === "darwin") { const actual = await darwinCacheHeader(library.cachePath); if (actual.uuid !== library.cacheUuid || actual.uuid !== library.cacheHeaderUuid || actual.sha256 !== library.cacheHeaderSha256) throw new Error("first_custody_validator_darwin_cache_header_mismatch"); } else { if(await realpath(library.requested)!==library.resolved)throw new Error("first_custody_validator_helper_library_alias_changed"); const actual = await regularClosedFile(library.resolved, path.parse(library.resolved).root); if (actual.size !== library.size || actual.sha256 !== library.sha256) throw new Error("first_custody_validator_helper_library_tampered"); } }
}
await publishAfterBootstrap(privateRoot, output, { schema: "service-lasso.qualification-first-custody-projection.v2", privateVersion: "v3", candidate: { head: receipt.source.head, tree: receipt.source.tree }, platform: receipt.platform, run: receipt.run, privateInitialReceiptSha256: sha256(sourceBytes), privateJournalSha256: journalFile.sha256, localValidatorAttestation: { schema: "service-lasso.qualification-local-validator-attestation.v2", validated: true } }, journalPath, evidenceRoot);

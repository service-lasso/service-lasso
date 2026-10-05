import assert from "node:assert/strict";
import test from "node:test";
import { nativeProof, validateCommand } from "../scripts/command-native-proof-lib.mjs";
import { legacyNativeProof } from "./helpers/command-native-proof-717-reference.mjs";
import { commandValidationReasons, observeCommandValidation } from "../scripts/command-validation-observation-lib.mjs";
import { nativeHelperScript } from "../scripts/native-tool-journal-v4-lib.mjs";
import { sha256 } from "../scripts/private-first-custody-v3-lib.mjs";
import { validInitialProjection } from "../scripts/public-first-custody-projection-lib.mjs";

// SPEC-006 AC-6G.command-validation-observation / SPEC-003 BR-008 / #1608.
// Constructed proof objects prove validator contracts only; no native observation.
const digest = "a".repeat(64), workspace = "/private-workspace";
const decode = line => JSON.parse(line.slice("[command-validation-failure-observation] ".length));
const clone = value => structuredClone(value);
function fixture(platform = "linux") {
  const caller = { pid: 10, ppid: 1, birth: "private-caller-birth", image: "/private-node", imageSha256: digest, uid: 1000 };
  const target = { pid: 20, ppid: 10, birth: "private-target-birth", image: "/private-git", imageSha256: digest, uid: 1000 };
  const native = { id: "", pid: 20, ppid: 10, image: target.image, imageSha256: digest, parents: [target, caller], sourceCaller: { pid: 10, birth: caller.birth, image: caller.image, imageSha256: digest, uid: 1000, cwd: workspace }, helper: null, birthObserved: true, nativeBirthCustody: "HELD_NATIVE_V1" };
  if (platform !== "linux") {
    const script = nativeHelperScript(platform, 20, 10);
    const library = platform === "darwin" ? { requested: "private-library", logicalPath: "/private-logical", loadedImageUuid: "b".repeat(32), cachePath: "/private-cache", cacheUuid: "c".repeat(32), cacheHeaderUuid: "c".repeat(32), cacheHeaderSha256: digest } : { requested: "private-library", resolved: "/private-library", size: 1, sha256: digest };
    const helper = { platform, executable: "/private-helper", args: platform === "win32" ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script] : ["-c", script, "20", "10"], executableSha256: digest, scriptSha256: sha256(script), scriptBytes: Buffer.byteLength(script), first: null, second: null, libraries: [library] };
    for (const [field, pid] of [["first", 30], ["second", 40]]) {
      const self = { pid, ppid: 10, birth: "private-helper-birth", image: helper.executable, imageSha256: digest, uid: 1000 };
      const raw = { self: { pid, chain: [self, clone(caller)] }, target: { chain: clone(native.parents) }, libraries: [library.requested], ...(platform === "darwin" ? { dyldCache: clone(library) } : { libraryFiles: [clone(library)] }) };
      const bytes = Buffer.from(JSON.stringify(raw)), empty = Buffer.alloc(0);
      helper[field] = { exitCode: 0, signal: null, spawnedPid: pid, selfIdentity: clone(self), stdout: bytes.toJSON(), stderr: empty.toJSON(), stdoutEof: true, stderrEof: true, stdoutSha256: sha256(bytes), stderrSha256: sha256(empty) };
    }
    native.helper = helper;
  }
  seal(native);
  const node = { resolved: caller.image, file: { sha256: digest } }, git = { requested: "/private-git-request", resolved: target.image, file: { sha256: digest } };
  const command = { command: { tool: "git", requested: git.requested, resolved: git.resolved, args: ["cat-file", "--batch-command", "--buffer"], protocol: "CAT_FILE_BATCH_V1" }, native, result: { naturalWaitForExit: true, exitCode: 0, signal: null, stdoutEof: true, stderrEof: true, stdout: {}, stderr: {} } };
  return { native, command, journal: { commands: [command] }, tools: new Map([["git", git]]), node, platform };
}
function seal(native) { native.id = `native-${native.pid}-${sha256(JSON.stringify(native.parents)).slice(0,16)}`; }
function run(f, lines = [], report = line => lines.push(line)) { validateCommand(0, f.command, f.journal, f.tools, f.node, workspace, f.platform, () => "metadata", report); return lines; }
function refuse(f, expected) {
  const lines = [];
  assert.throws(() => run(f, lines), /first_custody_validator_(?:native_journal|darwin_cache_witness)_invalid/u);
  assert.equal(lines.length, 1);
  assert.equal(decode(lines[0]).reason, expected);
  assert.equal(decode(lines[0]).observationStatus, "captured");
  assert.equal(decode(lines[0]).commandOrdinal, 1);
  assert.ok(lines[0].length < 500);
  for (const value of [workspace, "/private-", digest, "private-library", "private-caller-birth", "private-helper-birth"]) assert.equal(lines[0].includes(value), false);
}

test("actual complete command/native proof accepts all three constructed platforms silently and matches original native result", () => {
  for (const platform of ["linux", "win32", "darwin"]) { const f = fixture(platform); assert.equal(legacyNativeProof(f.native, f.command.command.resolved, workspace, platform), true); assert.equal(nativeProof(f.native, f.command.command.resolved, workspace, platform), true); assert.deepEqual(run(f), []); }
});

test("the actual node and Windows compiler-metadata selectors accept only their unchanged literal argument vectors", () => {
  for (const index of [1, 2]) {
    const f = fixture(index === 2 ? "win32" : "linux"), lines = [];
    const tool = index === 1 ? "node" : "powershell", resolved = index === 1 ? f.node.resolved : "/private-powershell";
    const args = index === 1 ? ["-e", "process.stdin.once('data',()=>process.stdout.write(process.version+'\\n'))"] : ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "metadata"];
    f.tools.set(tool, { requested: resolved, resolved, file: { sha256: digest } });
    f.tools.set("csc", { resolved: "/private-csc" });
    f.native.image = resolved; f.native.parents[0].image = resolved; seal(f.native);
    if (f.native.helper) for (const probe of [f.native.helper.first, f.native.helper.second]) {
      const raw = JSON.parse(Buffer.from(probe.stdout.data).toString("utf8")); raw.target.chain = clone(f.native.parents);
      const bytes = Buffer.from(JSON.stringify(raw)); probe.stdout = bytes.toJSON(); probe.stdoutSha256 = sha256(bytes);
    }
    f.command.command = { tool, requested: resolved, resolved, args, protocol: index === 1 ? "STDIN_HELD_VERSION_V1" : "WINDOWS_FILEVERSIONINFO_CSC_NOT_INVOKED_V1" };
    validateCommand(index, f.command, f.journal, f.tools, f.node, workspace, f.platform, compiler => { assert.equal(compiler, "/private-csc"); return "metadata"; }, line => lines.push(line));
    assert.deepEqual(lines, []);
    f.command.command.args = ["private-wrong-vector"];
    assert.throws(() => validateCommand(index, f.command, f.journal, f.tools, f.node, workspace, f.platform, () => "metadata", line => lines.push(line)), /first_custody_validator_native_journal_invalid/u);
    assert.equal(decode(lines[0]).reason, "command_arguments"); assert.equal(decode(lines[0]).commandOrdinal, index + 1);
  }
});

const nativeCases = [
  ["native_shape", n => { n.extra = "private"; }], ["native_birth_observed", n => { n.birthObserved = false; }], ["native_birth_custody", n => { n.nativeBirthCustody = "wrong"; }],
  ["native_pid", n => { n.pid = 1.5; }], ["native_ppid", n => { n.ppid = 1.5; }], ["native_image_type", n => { n.image = null; }], ["native_image_binding", n => { n.image = "/other"; }], ["native_image_digest", n => { n.imageSha256 = "invalid"; }],
  ["native_parents_type", n => { n.parents = {}; }], ["native_parents_empty", n => { n.parents = []; }], ["caller_shape", n => { n.sourceCaller.extra = true; }], ["caller_pid", n => { n.sourceCaller.pid = 1.5; }], ["caller_birth_type", n => { n.sourceCaller.birth = null; }], ["caller_birth_empty", n => { n.sourceCaller.birth = ""; }], ["caller_image_type", n => { n.sourceCaller.image = null; }], ["caller_image_digest", n => { n.sourceCaller.imageSha256 = "invalid"; }], ["caller_uid", n => { n.sourceCaller.uid = null; }], ["caller_workspace", n => { n.sourceCaller.cwd = "/other"; }],
  ["linux_helper_present", n => { n.helper = {}; }], ["parent_identity", n => { n.parents[0].birth = ""; }], ["parent_duplicate", n => { n.parents[1].pid = 20; n.parents[0].ppid = 20; }], ["parent_edge", n => { n.parents[0].ppid = 15; }], ["native_id", n => { n.id = "wrong"; }],
  ["target_pid", n => { n.parents[0].pid = 21; seal(n); }], ["target_ppid", n => { n.ppid = 11; seal(n); }], ["target_image", n => { n.parents[0].image = "/other"; seal(n); }], ["target_image_digest", n => { n.parents[0].imageSha256 = "b".repeat(64); seal(n); }],
  ["chain_caller_pid", n => { n.sourceCaller.pid = 11; }], ["chain_caller_birth", n => { n.sourceCaller.birth = "other"; }], ["chain_caller_image", n => { n.sourceCaller.image = "/other"; }], ["chain_caller_image_digest", n => { n.sourceCaller.imageSha256 = "b".repeat(64); }], ["chain_caller_uid", n => { n.sourceCaller.uid = 1001; }], ["target_uid", n => { n.parents[0].uid = 1001; seal(n); }],
];
test("each native header/parent/final binding negative reaches the actual predicate with unchanged original refusal", () => {
  for (const [reason, mutate] of nativeCases) { const f = fixture(); mutate(f.native); assert.equal(legacyNativeProof(f.native, f.command.command.resolved, workspace, f.platform), false, reason); assert.equal(nativeProof(f.native, f.command.command.resolved, workspace, f.platform), false, reason); refuse(f, reason); }
});

test("actual outer command selector and all post-native result/binding disjuncts refuse with the original error", () => {
  const cases = [
    ["command_shape", f => { f.command.extra = true; }], ["command_descriptor_shape", f => { f.command.command.extra = true; }], ["command_tool", f => { f.command.command.tool = "node"; }], ["command_protocol", f => { f.command.command.protocol = "other"; }], ["command_arguments", f => { f.command.command.args = ["private-arguments"]; }], ["command_requested", f => { f.command.command.requested = "/other"; }], ["command_resolved", f => { f.command.command.resolved = "/other"; }],
    ["command_native_digest", f => { f.tools.get("git").file.sha256 = "b".repeat(64); }], ["command_caller_image", f => { f.node.resolved = "/other"; }], ["command_caller_digest", f => { f.node.file.sha256 = "b".repeat(64); }], ["command_common_caller", f => { f.journal = { commands: [{ native: { parents: [ { ...f.native.parents.at(-1), birth: "other" } ] } }] }; }],
    ["command_result_shape", f => { f.command.result.extra = true; }], ["command_natural_exit", f => { f.command.result.naturalWaitForExit = false; }], ["command_exit", f => { f.command.result.exitCode = 1; }], ["command_signal", f => { f.command.result.signal = "SIGTERM"; }], ["command_stdout_eof", f => { f.command.result.stdoutEof = false; }], ["command_stderr_eof", f => { f.command.result.stderrEof = false; }],
  ];
  for (const [reason, mutate] of cases) { const f = fixture(); mutate(f); refuse(f, reason); }
});

test("actual helper/script/library/probe disjuncts preserve legacy native refusal", () => {
  const cases = [
    ["helper_missing", n => { n.helper = null; }], ["helper_shape", n => { n.helper.extra = true; }], ["helper_platform", n => { n.helper.platform = "darwin"; }], ["helper_executable_digest", n => { n.helper.executableSha256 = "invalid"; }], ["helper_script_digest_type", n => { n.helper.scriptSha256 = "invalid"; }], ["helper_script_bytes_type", n => { n.helper.scriptBytes = 1.5; }], ["helper_script_bytes_positive", n => { n.helper.scriptBytes = 0; }], ["helper_libraries_type", n => { n.helper.libraries = {}; }], ["helper_libraries_empty", n => { n.helper.libraries = []; }], ["helper_script_digest_binding", n => { n.helper.scriptSha256 = "b".repeat(64); }], ["helper_script_bytes_binding", n => { n.helper.scriptBytes++; }], ["helper_arguments", n => { n.helper.args = ["private-arguments"]; }], ["library_proof", n => { n.helper.libraries[0].sha256 = "invalid"; }], ["library_duplicate", n => { n.helper.libraries.push(clone(n.helper.libraries[0])); }],
    ["probe_shape", n => { n.helper.first.extra = true; }], ["probe_exit", n => { n.helper.first.exitCode = 1; }], ["probe_signal", n => { n.helper.first.signal = "SIGTERM"; }], ["probe_stdout_eof", n => { n.helper.first.stdoutEof = false; }], ["probe_stderr_eof", n => { n.helper.first.stderrEof = false; }], ["probe_stdout_digest", n => { n.helper.first.stdoutSha256 = "invalid"; }], ["probe_stderr_digest", n => { n.helper.first.stderrSha256 = "invalid"; }], ["probe_stdout_buffer", n => { n.helper.first.stdout.data[0] ^= 1; }], ["probe_stderr_buffer", n => { n.helper.first.stderr.data.push(1); }],
  ];
  for (const [reason, mutate] of cases) { const f = fixture("win32"); mutate(f.native); assert.equal(legacyNativeProof(f.native, f.command.command.resolved, workspace, f.platform), false, reason); refuse(f, reason); }
});

function mutateWitness(f, mutate) { const probe = f.native.helper.first, raw = JSON.parse(Buffer.from(probe.stdout.data).toString("utf8")); mutate(raw, probe, f.native); const bytes = Buffer.from(JSON.stringify(raw)); probe.stdout = bytes.toJSON(); probe.stdoutSha256 = sha256(bytes); }
test("actual parsed helper witnesses retain every shape/chain/library/self/caller failure and original cache exception", () => {
  const cases = [
    ["witness_shape", r => { r.extra = true; }], ["witness_self_shape", r => { r.self.extra = true; }], ["witness_self_pid", r => { r.self.pid++; }], ["witness_target_shape", r => { r.target.extra = true; }], ["witness_self_chain", r => { r.self.chain[0].birth = ""; }], ["witness_target_chain", r => { r.target.chain[0].birth = ""; }], ["witness_libraries_type", r => { r.libraries = {}; }], ["witness_libraries_empty", r => { r.libraries = []; }], ["witness_library_names", r => { r.libraries = [0]; }], ["witness_library_count", r => { r.libraries.push("other"); }], ["witness_library_binding", r => { r.libraries[0] = "other"; }], ["witness_target_binding", r => { r.target.chain[0].birth = "other"; }],
    ["witness_spawned_pid", (r, p) => { p.spawnedPid++; }], ["witness_self_identity", (r, p) => { p.selfIdentity.birth = ""; }], ["witness_self_binding", (r, p) => { p.selfIdentity.birth = "other"; }], ["witness_uid", (r, p) => { r.self.chain[0].uid = 1001; p.selfIdentity.uid = 1001; }], ["witness_image", (r, p) => { r.self.chain[0].image = "/other"; p.selfIdentity.image = "/other"; }], ["witness_image_digest", (r, p) => { r.self.chain[0].imageSha256 = "b".repeat(64); p.selfIdentity.imageSha256 = "b".repeat(64); }], ["witness_caller_pid", (r, p) => { r.self.chain[1].pid = 11; r.self.chain[0].ppid = 11; p.selfIdentity.ppid = 11; }], ["witness_caller_birth", r => { r.self.chain[1].birth = "other"; }], ["witness_caller_image", r => { r.self.chain[1].image = "/other"; }], ["witness_caller_image_digest", r => { r.self.chain[1].imageSha256 = "b".repeat(64); }], ["witness_caller_uid", r => { r.self.chain[1].uid = 1001; }],
  ];
  for (const [reason, mutate] of cases) { const f = fixture("win32"); mutateWitness(f, mutate); assert.equal(legacyNativeProof(f.native, f.command.command.resolved, workspace, f.platform), false, reason); refuse(f, reason); }
  const malformed = fixture("win32"), bytes = Buffer.from("not-json-private"); malformed.native.helper.first.stdout = bytes.toJSON(); malformed.native.helper.first.stdoutSha256 = sha256(bytes); refuse(malformed, "witness_raw_json");
  const cache = fixture("darwin"); mutateWitness(cache, r => { r.dyldCache.cacheUuid = "d".repeat(32); }); assert.throws(() => legacyNativeProof(cache.native, cache.command.command.resolved, workspace, cache.platform), /first_custody_validator_darwin_cache_witness_invalid/u); refuse(cache, "darwin_cache_witness");
});

test("every finite enum retains only the first entered rejection, exactly once, with no private source or later predicate evaluation", () => {
  assert.equal(new Set(commandValidationReasons).size, commandValidationReasons.length);
  for (const reason of commandValidationReasons) {
    const lines = [], primary = new Error("private exception values"); let calls = 0;
    assert.throws(() => observeCommandValidation(2, observation => { assert.equal(observation.fail(reason, () => { calls++; return true; }) || observation.fail("command_exit", () => assert.fail("short circuit")), true); throw primary; }, line => lines.push(line)), error => error === primary);
    assert.equal(calls, 1); assert.equal(decode(lines[0]).reason, reason); assert.equal(decode(lines[0]).commandOrdinal, 3); assert.equal(lines[0].includes(primary.message), false);
  }
  // This tests enum/capture transport, not reachability of redundant outer
  // fallback checks such as command_native_proof/probe_witness/target_changed.
});

test("unavailable selector/evaluation and hostile exception/capture failures preserve exact primary without inspection", () => {
  let traps = 0;
  const primary = new Proxy({}, { get() { traps++; throw new Error("private"); }, getOwnPropertyDescriptor() { traps++; throw new Error("private"); }, ownKeys() { traps++; throw new Error("private"); } });
  for (const reportFails of [false, true]) {
    const lines = [];
    let caught;
    try { observeCommandValidation(0, observation => observation.fail("command_arguments", () => { throw primary; }), line => { lines.push(line); if (reportFails) throw primary; }); } catch (error) { caught = error; }
    assert.equal(caught === primary, true); assert.equal(traps, 0);
    assert.deepEqual(decode(lines[0]), { schema: "service-lasso.command-validation-failure-observation.v1", boundary: "command_native_journal", privateIdentity: "unavailable", commandOrdinal: 1, observationStatus: "unavailable", reason: "command_arguments" });
  }
  const lines = [], f = fixture(); const tools = { get() { throw primary; } }; let caught;
  try { validateCommand(0, f.command, f.journal, tools, f.node, workspace, "linux", () => "unused", line => lines.push(line)); } catch (error) { caught = error; }
  assert.equal(caught === primary, true); assert.equal(decode(lines[0]).reason, "command_selector_unavailable"); assert.equal(decode(lines[0]).observationStatus, "unavailable"); assert.equal(traps, 0);
  const unknown = [], hostile = new Proxy({}, { get() { traps++; throw primary; } });
  try { observeCommandValidation(hostile, observation => { observation.rejected(hostile); throw primary; }, line => unknown.push(line)); } catch (error) { assert.equal(error === primary, true); }
  assert.equal(Object.hasOwn(decode(unknown[0]), "commandOrdinal"), false); assert.equal(decode(unknown[0]).reason, "command_selector_unavailable"); assert.equal(traps, 0);
  assert.equal(decode(unknown[0]).observationStatus, "unavailable");
});

test("actual unavailable getter evaluation retains the original error and does not inspect it or replace it on capture failure", () => {
  let traps = 0;
  const primary = new Proxy({}, { get() { traps++; throw new Error("private exception"); }, ownKeys() { traps++; throw new Error("private exception"); } });
  for (const captureFails of [false, true]) {
    const f = fixture(), lines = []; let reads = 0, caught;
    Object.defineProperty(f.native, "image", { enumerable: true, get() { reads++; throw primary; } });
    try { legacyNativeProof(f.native, f.command.command.resolved, workspace, "linux"); } catch (error) { caught = error; }
    assert.equal(caught === primary, true); assert.equal(reads, 1);
    caught = undefined; reads = 0;
    try { run(f, lines, line => { lines.push(line); if (captureFails) throw primary; }); } catch (error) { caught = error; }
    assert.equal(caught === primary, true); assert.equal(reads, 1); assert.equal(traps, 0);
    assert.equal(decode(lines[0]).observationStatus, "unavailable"); assert.equal(decode(lines[0]).reason, "native_image_type");
  }
});

test("compound malformed native proofs preserve original result and caller getter evaluation counts", () => {
  for (const field of ["pid", "ppid", "birth", "image", "imageSha256", "uid"]) {
    for (const value of [null, {}, [], "", 1.5]) {
      const f = fixture(); f.native.parents[0][field] = value; seal(f.native);
      assert.equal(nativeProof(f.native, f.command.command.resolved, workspace, "linux"), legacyNativeProof(f.native, f.command.command.resolved, workspace, "linux"));
    }
  }
  const f = fixture(); let reads = 0;
  Object.defineProperty(f.native, "birthObserved", { enumerable: true, get() { reads++; return true; } });
  assert.equal(legacyNativeProof(f.native, f.command.command.resolved, workspace, "linux"), true); const originalReads = reads; reads = 0;
  assert.deepEqual(run(f), []); assert.equal(reads, originalReads); assert.equal(reads, 1);
});

test("the separate observation neither qualifies custody nor expands the public-v2 projection", () => {
  const head = "a".repeat(40), projection = { schema: "service-lasso.qualification-first-custody-projection.v2", privateVersion: "v3", candidate: { head, tree: "b".repeat(40) }, platform: "darwin", run: { id: "42", attempt: "1" }, privateInitialReceiptSha256: "c".repeat(64), privateJournalSha256: "d".repeat(64), localValidatorAttestation: { schema: "service-lasso.qualification-local-validator-attestation.v2", validated: true } };
  assert.equal(validInitialProjection(projection, "darwin", "42", "1", head), true);
  const observation = { schema: "service-lasso.command-validation-failure-observation.v1", boundary: "command_native_journal", privateIdentity: "unavailable", commandOrdinal: 1, observationStatus: "captured", reason: "native_shape" };
  assert.equal(validInitialProjection(observation, "darwin", "42", "1", head), false);
  assert.equal(validInitialProjection({ ...projection, commandObservation: observation }, "darwin", "42", "1", head), false);
});

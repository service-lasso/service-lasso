import { DIGEST, exact, requireStrictJson, sha256 } from "./private-first-custody-v3-lib.mjs";
import { nativeHelperScript } from "./native-tool-journal-v4-lib.mjs";
function refused(observation, reason, predicate) { return observation ? observation.fail(reason, predicate) : predicate(); }
function accepted(observation, reason, predicate) { return observation ? observation.pass(reason, predicate) : predicate(); }
export function rawBuffer(value, digest) { return exact(value, ["type", "data"]) && value.type === "Buffer" && Array.isArray(value.data) && value.data.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255) && sha256(Buffer.from(value.data)) === digest; }
function processIdentity(value) { return exact(value, ["pid", "ppid", "birth", "image", "imageSha256", "uid"]) && Number.isSafeInteger(value.pid) && value.pid>0 && Number.isSafeInteger(value.ppid) && value.ppid>0 && typeof value.birth === "string" && value.birth && typeof value.image === "string" && DIGEST.test(value.imageSha256) && ((typeof value.uid === "string" && value.uid) ||
    Number.isSafeInteger(value.uid)); }
function processChain(value) { if (!Array.isArray(value) ||
    !value.length) return false; const seen = new Set(); return value.every((item, index) => processIdentity(item) && !seen.has(item.pid) && (seen.add(item.pid), true) && (index + 1 === value.length ||
    item.ppid === value[index + 1].pid)); }
export function sameIdentity(left, right) { return left.pid === right.pid && left.ppid === right.ppid && left.birth === right.birth && left.image === right.image && left.imageSha256 === right.imageSha256 && left.uid === right.uid; }
function sameChain(left, right) { return left.length === right.length && left.every((item, index) => sameIdentity(item, right[index])); }
function helperWitness(native, helper, probe, observation) { observation?.enter("helper_witness_evaluation"); let raw; try { raw = requireStrictJson(Buffer.from(probe.stdout.data).toString("utf8"),"first_custody_validator_native_raw"); } catch { observation?.rejected("witness_raw_json"); return null; } const darwinCache = helper.platform === "darwin" && exact(raw.dyldCache, ["requested", "logicalPath", "loadedImageUuid", "cachePath", "cacheUuid", "cacheHeaderUuid", "cacheHeaderSha256"]) && raw.dyldCache.cacheUuid === raw.dyldCache.cacheHeaderUuid && helper.libraries.length === 1 && Object.keys(raw.dyldCache).every(key => raw.dyldCache[key] === helper.libraries[0][key]); if(refused(observation, 'darwin_cache_witness', () => (helper.platform==="darwin"&&!darwinCache)))throw new Error("first_custody_validator_darwin_cache_witness_invalid"); if (refused(observation, 'witness_shape', () => (!(helper.platform === "darwin" ? darwinCache && exact(raw, ["self", "target", "libraries", "dyldCache"]) : exact(raw, ["self", "target", "libraries", "libraryFiles"]) && Array.isArray(raw.libraryFiles) && JSON.stringify(raw.libraryFiles) === JSON.stringify(helper.libraries)))) ||
    refused(observation, 'witness_self_shape', () => (!exact(raw.self, ["pid", "chain"]))) ||
    refused(observation, 'witness_self_pid', () => (raw.self.pid !== raw.self.chain?.[0]?.pid)) ||
    refused(observation, 'witness_target_shape', () => (!exact(raw.target, ["chain"]))) ||
    refused(observation, 'witness_self_chain', () => (!processChain(raw.self.chain))) ||
    refused(observation, 'witness_target_chain', () => (!processChain(raw.target.chain))) ||
    refused(observation, 'witness_libraries_type', () => (!Array.isArray(raw.libraries))) ||
    refused(observation, 'witness_libraries_empty', () => (!raw.libraries.length)) ||
    refused(observation, 'witness_library_names', () => (!raw.libraries.every(value => typeof value === "string" && value))) ||
    refused(observation, 'witness_library_count', () => (raw.libraries.length !== helper.libraries.length)) ||
    refused(observation, 'witness_library_binding', () => (raw.libraries.some((value, index) => value !== helper.libraries[index].requested))) ||
    refused(observation, 'witness_target_binding', () => (!sameChain(raw.target.chain, native.parents)))) return null; const self = raw.self.chain[0]; if(refused(observation, 'witness_spawned_pid', () => (probe.spawnedPid!==self.pid))||refused(observation, 'witness_self_identity', () => (!processIdentity(probe.selfIdentity)))||refused(observation, 'witness_self_binding', () => (!sameIdentity(self,probe.selfIdentity))))return null; const caller = raw.self.chain.at(-1), expected = native.sourceCaller; if (refused(observation, 'witness_uid', () => (self.uid!==expected.uid)) ||
    refused(observation, 'witness_image', () => (self.image !== helper.executable)) ||
    refused(observation, 'witness_image_digest', () => (self.imageSha256 !== helper.executableSha256)) ||
    refused(observation, 'witness_caller_pid', () => (caller.pid !== expected.pid)) ||
    refused(observation, 'witness_caller_birth', () => (caller.birth !== expected.birth)) ||
    refused(observation, 'witness_caller_image', () => (caller.image !== expected.image)) ||
    refused(observation, 'witness_caller_image_digest', () => (caller.imageSha256 !== expected.imageSha256)) ||
    refused(observation, 'witness_caller_uid', () => (caller.uid !== expected.uid))) return null; return raw.target.chain.map(item => [item.pid, item.ppid, item.birth, item.image, item.imageSha256, item.uid]); }
export function nativeProof(native, resolved, workspace, platform, observation) {
  if (refused(observation, 'native_shape', () => (!exact(native, ["id", "pid", "ppid", "image", "imageSha256", "parents", "sourceCaller", "helper", "birthObserved", "nativeBirthCustody"]))) ||
    refused(observation, 'native_birth_observed', () => (native.birthObserved !== true)) ||
    refused(observation, 'native_birth_custody', () => (native.nativeBirthCustody !== "HELD_NATIVE_V1")) ||
    refused(observation, 'native_pid', () => (!Number.isSafeInteger(native.pid))) ||
    refused(observation, 'native_ppid', () => (!Number.isSafeInteger(native.ppid))) ||
    refused(observation, 'native_image_type', () => (typeof native.image !== "string")) ||
    refused(observation, 'native_image_binding', () => (native.image !== resolved)) ||
    refused(observation, 'native_image_digest', () => (!DIGEST.test(native.imageSha256))) ||
    refused(observation, 'native_parents_type', () => (!Array.isArray(native.parents))) ||
    refused(observation, 'native_parents_empty', () => (!native.parents.length)) ||
    refused(observation, 'caller_shape', () => (!exact(native.sourceCaller, ["pid", "birth", "image", "imageSha256", "uid", "cwd"]))) ||
    refused(observation, 'caller_pid', () => (!Number.isSafeInteger(native.sourceCaller.pid))) ||
    refused(observation, 'caller_birth_type', () => (typeof native.sourceCaller.birth !== "string")) ||
    refused(observation, 'caller_birth_empty', () => (!native.sourceCaller.birth)) ||
    refused(observation, 'caller_image_type', () => (typeof native.sourceCaller.image !== "string")) ||
    refused(observation, 'caller_image_digest', () => (!DIGEST.test(native.sourceCaller.imageSha256))) ||
    refused(observation, 'caller_uid', () => (!((typeof native.sourceCaller.uid === "string" && native.sourceCaller.uid) ||
    Number.isSafeInteger(native.sourceCaller.uid)))) ||
    refused(observation, 'caller_workspace', () => (native.sourceCaller.cwd !== workspace))) return false;
  if (platform === "linux" ? refused(observation, 'linux_helper_present', () => (native.helper !== null)) : refused(observation, 'helper_missing', () => (!native.helper)) ||
    refused(observation, 'helper_shape', () => (!exact(native.helper, ["platform", "executable", "args", "executableSha256", "scriptSha256", "scriptBytes", "first", "second", "libraries"]))) ||
    refused(observation, 'helper_platform', () => (native.helper.platform !== platform)) ||
    refused(observation, 'helper_executable_digest', () => (!DIGEST.test(native.helper.executableSha256))) ||
    refused(observation, 'helper_script_digest_type', () => (!DIGEST.test(native.helper.scriptSha256))) ||
    refused(observation, 'helper_script_bytes_type', () => (!Number.isSafeInteger(native.helper.scriptBytes))) ||
    refused(observation, 'helper_script_bytes_positive', () => (native.helper.scriptBytes <= 0)) ||
    refused(observation, 'helper_libraries_type', () => (!Array.isArray(native.helper.libraries))) ||
    refused(observation, 'helper_libraries_empty', () => (!native.helper.libraries.length))) return false;
  if(native.helper!==null){observation?.enter("helper_script_generation");const script=nativeHelperScript(platform,native.pid,native.sourceCaller.pid);if(refused(observation, 'helper_script_digest_binding', () => (native.helper.scriptSha256!==sha256(script)))||refused(observation, 'helper_script_bytes_binding', () => (native.helper.scriptBytes!==Buffer.byteLength(script)))||refused(observation, 'helper_arguments', () => (JSON.stringify(native.helper.args)!==JSON.stringify(platform==="win32"?["-NoLogo","-NoProfile","-NonInteractive","-Command",script]:["-c",script,String(native.pid),String(native.sourceCaller.pid)]))))return false;}
  if (native.helper !== null) { const libraryNames = new Set(); for (const library of native.helper.libraries) { observation?.enter("library_evaluation");const cache = platform === "darwin" && exact(library, ["requested", "logicalPath", "loadedImageUuid", "cachePath", "cacheUuid", "cacheHeaderUuid", "cacheHeaderSha256"]) && typeof library.requested === "string" && typeof library.logicalPath === "string" && typeof library.cachePath === "string" && /^[0-9a-f]{32}$/u.test(library.loadedImageUuid) && /^[0-9a-f]{32}$/u.test(library.cacheUuid) && library.cacheUuid === library.cacheHeaderUuid && DIGEST.test(library.cacheHeaderSha256); const file = exact(library, ["requested", "resolved", "size", "sha256"]) && typeof library.requested === "string" && typeof library.resolved === "string" && Number.isSafeInteger(library.size) && library.size >= 0 && DIGEST.test(library.sha256); const key = cache ? library.cachePath : library.resolved; if (refused(observation, 'library_proof', () => ((!cache && !file))) ||
    refused(observation, 'library_duplicate', () => (libraryNames.has(key)))) return false; libraryNames.add(key); } const targets=[]; for (const probe of [native.helper.first, native.helper.second]) { if (refused(observation, 'probe_shape', () => (!exact(probe, ["exitCode", "signal", "spawnedPid", "selfIdentity", "stdout", "stderr", "stdoutEof", "stderrEof", "stdoutSha256", "stderrSha256"]))) ||
    refused(observation, 'probe_exit', () => (probe.exitCode !== 0)) ||
    refused(observation, 'probe_signal', () => (probe.signal !== null)) ||
    refused(observation, 'probe_stdout_eof', () => (probe.stdoutEof !== true)) ||
    refused(observation, 'probe_stderr_eof', () => (probe.stderrEof !== true)) ||
    refused(observation, 'probe_stdout_digest', () => (!DIGEST.test(probe.stdoutSha256))) ||
    refused(observation, 'probe_stderr_digest', () => (!DIGEST.test(probe.stderrSha256))) ||
    refused(observation, 'probe_stdout_buffer', () => (!rawBuffer(probe.stdout, probe.stdoutSha256))) ||
    refused(observation, 'probe_stderr_buffer', () => (!rawBuffer(probe.stderr, probe.stderrSha256)))) return false; const target = helperWitness(native, native.helper, probe, observation); if (refused(observation, 'probe_witness', () => (!target))) return false; targets.push(target); } if (refused(observation, 'probe_target_changed', () => (JSON.stringify(targets[0]) !== JSON.stringify(targets[1])))) return false; }
  const seen = new Set();
  for (const [index, item] of native.parents.entries()) { if (refused(observation, 'parent_identity', () => (!processIdentity(item))) ||
    refused(observation, 'parent_duplicate', () => (seen.has(item.pid))) ||
    refused(observation, 'parent_edge', () => ((index + 1 < native.parents.length && item.ppid !== native.parents[index + 1].pid)))) return false; seen.add(item.pid); }
  if(refused(observation, 'native_id', () => (native.id!==`native-${native.pid}-${sha256(JSON.stringify(native.parents)).slice(0,16)}`)))return false;
  const caller = native.parents.at(-1); return accepted(observation, 'target_pid', () => (native.parents[0].pid === native.pid)) && accepted(observation, 'target_ppid', () => (native.parents[0].ppid === native.ppid)) && accepted(observation, 'target_image', () => (native.parents[0].image === native.image)) && accepted(observation, 'target_image_digest', () => (native.parents[0].imageSha256 === native.imageSha256)) && accepted(observation, 'chain_caller_pid', () => (caller.pid === native.sourceCaller.pid)) && accepted(observation, 'chain_caller_birth', () => (caller.birth === native.sourceCaller.birth)) && accepted(observation, 'chain_caller_image', () => (caller.image === native.sourceCaller.image)) && accepted(observation, 'chain_caller_image_digest', () => (caller.imageSha256 === native.sourceCaller.imageSha256)) && accepted(observation, 'chain_caller_uid', () => (caller.uid === native.sourceCaller.uid)) && accepted(observation, 'target_uid', () => (native.parents[0].uid===native.sourceCaller.uid));
}
import { observeCommandValidation } from "./command-validation-observation-lib.mjs";
export function validateCommand(index, command, journal, toolMap, node, workspace, platform, metadataScript, report) {
  observeCommandValidation(index, observation => {
  const expected = index === 0 ? { tool: "git", args: ["cat-file", "--batch-command", "--buffer"], protocol: "CAT_FILE_BATCH_V1" } : index === 1 ? { tool: "node", args: ["-e", "process.stdin.once('data',()=>process.stdout.write(process.version+'\\n'))"], protocol: "STDIN_HELD_VERSION_V1" } : { tool: "powershell", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", metadataScript(toolMap.get("csc")?.resolved)], protocol: "WINDOWS_FILEVERSIONINFO_CSC_NOT_INVOKED_V1" };
  const tool = toolMap.get(expected.tool);
  if (observation.fail('command_shape', () => (!exact(command, ["command", "native", "result"]))) ||
    observation.fail('command_descriptor_shape', () => (!exact(command.command, ["tool", "requested", "resolved", "args", "protocol"]))) ||
    observation.fail('command_tool', () => (command.command.tool !== expected.tool)) ||
    observation.fail('command_protocol', () => (command.command.protocol !== expected.protocol)) ||
    observation.fail('command_arguments', () => (JSON.stringify(command.command.args) !== JSON.stringify(expected.args))) ||
    observation.fail('command_requested', () => (command.command.requested !== tool.requested)) ||
    observation.fail('command_resolved', () => (command.command.resolved !== tool.resolved)) ||
    observation.fail('command_native_proof', () => (!nativeProof(command.native, tool.resolved, workspace, platform, observation))) ||
    observation.fail('command_native_digest', () => (command.native.imageSha256 !== tool.file.sha256)) ||
    observation.fail('command_caller_image', () => (command.native.sourceCaller.image !== node.resolved)) ||
    observation.fail('command_caller_digest', () => (command.native.sourceCaller.imageSha256 !== node.file.sha256)) ||
    observation.fail('command_common_caller', () => (!sameIdentity(command.native.parents.at(-1), journal.commands[0].native.parents.at(-1)))) ||
    observation.fail('command_result_shape', () => (!exact(command.result, ["naturalWaitForExit", "exitCode", "signal", "stdoutEof", "stderrEof", "stdout", "stderr"]))) ||
    observation.fail('command_natural_exit', () => (command.result.naturalWaitForExit !== true)) ||
    observation.fail('command_exit', () => (command.result.exitCode !== 0)) ||
    observation.fail('command_signal', () => (command.result.signal !== null)) ||
    observation.fail('command_stdout_eof', () => (command.result.stdoutEof !== true)) ||
    observation.fail('command_stderr_eof', () => (command.result.stderrEof !== true))) throw new Error("first_custody_validator_native_journal_invalid");
  }, report);
}

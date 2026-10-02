// Native process observation is deliberately self-contained: it runs before
// dependency installation and never imports Service Lasso product code.
import { createHash } from "node:crypto";
import { readFile, realpath, lstat, open } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { strictJson } from "./consume-admin-trusted-unlock-receipt.mjs";
function nativeJson(source){if(!strictJson(source))throw new Error("first_custody_native_duplicate_or_malformed_json");return JSON.parse(source);}

const digest = value => createHash("sha256").update(value).digest("hex");
const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

// Self-contained physical closure avoids recursively starting a bootstrap helper
// while reading that helper's own executable. Windows raw probes additionally
// reject native ReparsePoint attributes at their actual observation.
// Separate finite observation only; neither private custody nor acceptance evidence.
function reportParentFailure(observation, report) {
  try { report(`[native-boundary-failure-observation] ${JSON.stringify({
    schema: "service-lasso.native-boundary-failure-observation.v1",
    boundary: "image_parent", privateIdentity: "unavailable", ...observation,
  })}\n`); } catch { /* Observation cannot replace the original refusal. */ }
}
export async function imageParents(file, io = { lstat, realpath }, report = value => process.stderr.write(value)) {
  const target=path.resolve(file), parents=[];
  for(let cursor=path.dirname(target);;cursor=path.dirname(cursor)) {
    let entry, resolved, acquisition = "lstat", predicates;
    try {
      entry=await io.lstat(cursor);
      acquisition="realpath";resolved=await io.realpath(cursor);
      acquisition="predicate";
      predicates={directory:Boolean(entry.isDirectory()),symlink:Boolean(entry.isSymbolicLink()),samePhysicalPath:path.relative(cursor,resolved)==="",inoSafeInteger:Number.isSafeInteger(entry.ino),inoPositive:entry.ino>0};
    } catch(error) {
      reportParentFailure({observationStatus:"unavailable",acquisition},report);
      throw error;
    }
    const failedPredicates=[];
    if(!predicates.directory)failedPredicates.push("directory");
    if(predicates.symlink)failedPredicates.push("symlink");
    if(!predicates.samePhysicalPath)failedPredicates.push("samePhysicalPath");
    if(!predicates.inoSafeInteger)failedPredicates.push("inoSafeInteger");
    if(!predicates.inoPositive)failedPredicates.push("inoPositive");
    if(failedPredicates.length){
      reportParentFailure({observationStatus:"captured",predicates,failedPredicates},report);
      throw new Error("first_custody_native_reparse_parent");
    }
    parents.push({cursor,resolved,dev:entry.dev,ino:entry.ino,uid:entry.uid,gid:entry.gid,mode:entry.mode});if(cursor===path.dirname(cursor))break;
  }
  return parents;
}
export async function recheckImageParents(parents){for(const item of parents){const now=await lstat(item.cursor);if(!now.isDirectory()||now.isSymbolicLink()||now.dev!==item.dev||now.ino!==item.ino||now.uid!==item.uid||now.gid!==item.gid||now.mode!==item.mode||await realpath(item.cursor)!==item.resolved)throw new Error("first_custody_native_parent_changed");}}
export async function heldImageBytes(file, io = { open }) {
  const target=path.resolve(file),parents=await imageParents(target);
  await recheckImageParents(parents);
  const named=await lstat(target),handle=await io.open(target,"r");
  const same=(left,right)=>left.dev===right.dev&&left.ino===right.ino&&left.size===right.size&&left.mtimeMs===right.mtimeMs;
  try { const first=await handle.stat();if(!named.isFile()||named.isSymbolicLink()||!first.isFile()||!same(named,first))throw new Error("first_custody_native_held_image_identity");const bytes=await handle.readFile(),last=await handle.stat(),after=await lstat(target);if(!same(first,last)||!after.isFile()||after.isSymbolicLink()||!same(first,after))throw new Error("first_custody_native_held_image_changed");await recheckImageParents(parents);return bytes; }finally{await handle.close();}
}
async function linuxOne(id) {
  const stat = await readFile(`/proc/${id}/stat`, "utf8"), end = stat.lastIndexOf(")");
  if (end < 0) throw new Error("first_custody_native_stat_invalid");
  const fields = stat.slice(end + 2).trim().split(/\s+/u), image = await realpath(`/proc/${id}/exe`), status = await readFile(`/proc/${id}/status`, "utf8");
  const pid = positive(id), ppid = positive(fields[1]), birth = fields[19], uid = status.match(/^Uid:\s+(\d+)/mu)?.[1] ?? null;
  if (!pid || !ppid || !/^[0-9]+$/u.test(birth) || uid === null) throw new Error("first_custody_native_linux_identity_invalid");
  return { pid, ppid, birth, image, imageSha256: digest(await heldImageBytes(image)), uid };
}
async function linux(pid, caller) {
  const chain = [];
  for (let current = await linuxOne(pid); chain.length < 64; current = await linuxOne(current.ppid)) {
    if (chain.some(item => item.pid === current.pid)) throw new Error("first_custody_native_lineage_cycle");
    chain.push(current);
    if (current.pid === caller) return { chain, helper: null };
    if (current.ppid <= 1) throw new Error("first_custody_native_qualified_caller_missing");
  }
  throw new Error("first_custody_native_parent_depth");
}
async function capture(executable, args) {
  const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [], stderr = []; let stdoutEof = false, stderrEof = false;
  child.stdout.on("data", value => stdout.push(Buffer.from(value))); child.stderr.on("data", value => stderr.push(Buffer.from(value)));
  child.stdout.once("end", () => { stdoutEof = true; }); child.stderr.once("end", () => { stderrEof = true; });
  const state = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (exitCode, signal) => resolve({ exitCode, signal: signal ?? null })); });
  const out = Buffer.concat(stdout), err = Buffer.concat(stderr);
  if (state.exitCode !== 0 || state.signal !== null || !stdoutEof || !stderrEof) throw new Error("first_custody_native_helper_incomplete");
  let witness;try{witness=nativeJson(out.toString("utf8"));}catch{throw new Error("first_custody_native_helper_json_invalid");}if(!positive(child.pid)||witness.self?.pid!==child.pid||witness.self?.chain?.[0]?.pid!==child.pid)throw new Error("first_custody_native_helper_actual_child_mismatch");return { ...state, spawnedPid:child.pid, selfIdentity:witness.self.chain[0], stdout: out, stderr: err, stdoutEof, stderrEof, stdoutSha256: digest(out), stderrSha256: digest(err) };
}
function witnessTarget(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.target?.chain) || !value.target.chain.length) throw new Error("first_custody_native_helper_target_invalid");
  return JSON.stringify(value.target);
}
async function helper(executable, script, args) {
  const resolved = await realpath(executable), parents=await imageParents(resolved), before = await heldImageBytes(resolved), first = await capture(resolved, args(script)), second = await capture(resolved, args(script));
  // A helper's own identity is deliberately different for each probe.  The
  // held target observation is the stable comparison; each raw helper-self
  // witness is retained for independent validator closure below.
  let firstWitness, secondWitness;
  try { firstWitness = nativeJson(first.stdout.toString("utf8")); secondWitness = nativeJson(second.stdout.toString("utf8")); } catch { throw new Error("first_custody_native_helper_json_invalid"); }
  if (witnessTarget(firstWitness) !== witnessTarget(secondWitness)) throw new Error("first_custody_native_helper_target_changed");
  const after=await heldImageBytes(resolved);await recheckImageParents(parents);if(await realpath(executable)!==resolved||!before.equals(after))throw new Error("first_custody_native_helper_executable_changed");
  return { executable: resolved, args:args(script), executableSha256: digest(after), scriptSha256: digest(script), scriptBytes: Buffer.byteLength(script), first, second };
}
async function helperLibraries(requested, firstFiles, secondFiles) {
  if (!Array.isArray(requested) || !requested.length) throw new Error("first_custody_native_helper_library_missing");
  if(!Array.isArray(firstFiles)||!Array.isArray(secondFiles)||JSON.stringify(firstFiles)!==JSON.stringify(secondFiles)||firstFiles.length!==requested.length)throw new Error("first_custody_native_helper_library_observation_changed");
  const seen = new Set(), libraries = [];
  for (const item of requested) {
    if (typeof item !== "string" || !item || seen.has(item)) throw new Error("first_custody_native_helper_library_invalid");
    seen.add(item);
    const resolved = await realpath(item);
    const bytes = await heldImageBytes(resolved);
    if(await realpath(item)!==resolved)throw new Error("first_custody_native_helper_library_alias_changed");
    const proof={ requested: item, resolved, size: bytes.length, sha256: digest(bytes) };
    if(JSON.stringify(firstFiles[libraries.length])!==JSON.stringify(proof))throw new Error("first_custody_native_helper_library_held_mismatch");
    libraries.push(proof);
  }
  return libraries;
}
async function windows(pid, caller) {
  // Win32_Process/GetOwnerSid is the OS-supported process/owner source.
  const root = process.env.SystemRoot ?? process.env.WINDIR;
  if (!root) throw new Error("first_custody_native_windows_root_missing");
  const script = nativeHelperScript("win32",pid,caller);
  const witness = await helper(`${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, script, body => ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", body]);
  const parsed = nativeJson(witness.first.stdout.toString("utf8"));
  if (!parsed || !Array.isArray(parsed.target?.chain)) throw new Error("first_custody_native_windows_witness_invalid");
  const second=nativeJson(witness.second.stdout.toString("utf8"));
  return { chain: parsed.target.chain, helper: { platform: "win32", ...witness, libraries: await helperLibraries(parsed.libraries,parsed.libraryFiles,second.libraryFiles) } };
}
async function darwin(pid, caller) {
  // proc_pidinfo exposes the kernel start timeval, avoiding ps lstart's
  // second-level granularity for PID-reuse custody.
  // dyld_priv.h supplies these SPI declarations; dyld_cache_format.h fixes
  // the header UUID field at byte offset 88.  Only the fixed header is read.
  const script = nativeHelperScript("darwin",pid,caller);
  const witness = await helper("/usr/bin/python3", script, body => ["-c", body, String(pid), String(caller)]);
  const parsed = nativeJson(witness.first.stdout.toString("utf8"));
  if (!parsed || !Array.isArray(parsed.target?.chain)) throw new Error("first_custody_native_darwin_witness_invalid");
  if (!parsed?.dyldCache || parsed.dyldCache.cacheUuid !== parsed.dyldCache.cacheHeaderUuid) throw new Error("first_custody_native_darwin_cache_invalid");
  return { chain: parsed.target.chain, helper: { platform: "darwin", ...witness, libraries: [parsed.dyldCache] } };
}

export async function startHeld(tool, args, sourceRoot) {
  const executableParents=await imageParents(tool.resolved), executableBytes=await heldImageBytes(tool.resolved);
  if(await realpath(tool.requested)!==tool.resolved||digest(executableBytes)!==tool.file.sha256||executableBytes.length!==tool.file.size)throw new Error("first_custody_native_prelaunch_tool_changed");
  const child = spawn(tool.resolved, args, { cwd: sourceRoot, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const stdout = [], stderr = []; let stdoutEof = false, stderrEof = false, startError = null, notify = null;
  child.stdout.on("data", value => { stdout.push(Buffer.from(value)); notify?.(); notify = null; }); child.stderr.on("data", value => stderr.push(Buffer.from(value)));
  child.stdout.once("end", () => { stdoutEof = true; }); child.stderr.once("end", () => { stderrEof = true; }); child.once("error", error => { startError = error; notify?.(); notify = null; });
  const closed = new Promise(resolve => child.once("close", (exitCode, signal) => { notify?.();notify=null;resolve({ exitCode, signal: signal ?? null, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), stdoutEof, stderrEof, startError }); }));
  if (!positive(child.pid) || child.exitCode !== null) throw new Error("first_custody_native_child_not_live");
  try {
    const observed = process.platform === "linux" ? await linux(child.pid, process.pid) : process.platform === "win32" ? await windows(child.pid, process.pid) : process.platform === "darwin" ? await darwin(child.pid, process.pid) : Promise.reject(new Error("first_custody_native_platform_unsupported"));
    await recheckImageParents(executableParents);
    const parents = observed.chain, image = await realpath(parents[0]?.image ?? "");
    if (child.exitCode !== null || !parents.length || parents[0].pid !== child.pid || image !== tool.resolved || digest(await heldImageBytes(image)) !== tool.file.sha256) throw new Error("first_custody_native_image_mismatch");
    const caller = parents.at(-1), callerImage = await realpath(process.execPath);
    if (caller.pid !== process.pid || caller.imageSha256 !== digest(await heldImageBytes(callerImage))) throw new Error("first_custody_native_qualified_caller_mismatch");
    return { child, closed, output: () => Buffer.concat(stdout), waitForOutput: before => new Promise(resolve => { if (Buffer.concat(stdout).length !== before || child.exitCode !== null || startError) resolve(); else notify = resolve; }), native: { id: `native-${child.pid}-${digest(JSON.stringify(parents)).slice(0, 16)}`, pid: child.pid, ppid: parents[0].ppid, image, imageSha256: digest(await heldImageBytes(image)), parents, sourceCaller: { pid: caller.pid, birth: caller.birth, image: caller.image, imageSha256: caller.imageSha256, uid: caller.uid, cwd: sourceRoot }, helper: observed.helper, birthObserved: true, nativeBirthCustody: "HELD_NATIVE_V1" } };
  } catch (error) { child.stdin.end(); await closed; throw error; }
}

function windowsPhysicalScript() {
  return "$ErrorActionPreference='Stop';function H([string]$p){$n=Get-Item -LiteralPath $p -Force -ErrorAction Stop;if(($n.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0 -or $n.PSIsContainer){throw 'image_leaf_reparse'};$parents=@();for($d=$n.Directory;$null -ne $d;$d=$d.Parent){$v=Get-Item -LiteralPath $d.FullName -Force -ErrorAction Stop;if(($v.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0 -or -not $v.PSIsContainer){throw 'image_parent_reparse'};$parents+=@{path=$v.FullName;birth=$v.CreationTimeUtc.Ticks;attributes=[int64]$v.Attributes}};$length=$n.Length;$modified=$n.LastWriteTimeUtc.Ticks;$s=[IO.File]::OpenRead($n.FullName);try{if($s.Length -ne $length){throw 'image_held_length'};$h=([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($s))).Replace('-','').ToLowerInvariant();if($s.Length -ne $length){throw 'image_held_changed'}}finally{$s.Dispose()};$after=Get-Item -LiteralPath $n.FullName -Force -ErrorAction Stop;if(($after.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0 -or $after.Length -ne $length -or $after.LastWriteTimeUtc.Ticks -ne $modified){throw 'image_named_changed'};foreach($parent in $parents){$v=Get-Item -LiteralPath $parent.path -Force -ErrorAction Stop;if(-not $v.PSIsContainer -or [int64]$v.Attributes -ne $parent.attributes -or $v.CreationTimeUtc.Ticks -ne $parent.birth -or ($v.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){throw 'image_parent_changed'}};return [ordered]@{requested=$p;resolved=$n.FullName;size=[int64]$length;sha256=[string]$h}}";
}
export function nativeHelperScript(platform,pid,caller) { if(platform==="win32") return `${windowsPhysicalScript()};function L($p,$stop){$r=@();while($p -gt 0 -and $r.Count -lt 64){$q=Get-CimInstance Win32_Process -Filter ('ProcessId='+$p);if($null -eq $q){throw 'missing_process'};$o=Invoke-CimMethod -InputObject $q -MethodName GetOwnerSid;if($o.ReturnValue -ne 0 -or [string]::IsNullOrWhiteSpace($q.ExecutablePath)){throw 'identity_incomplete'};$b=if($q.CreationDate -is [datetime]){$q.CreationDate.ToUniversalTime().Ticks}else{[Management.ManagementDateTimeConverter]::ToDateTime([string]$q.CreationDate).ToUniversalTime().Ticks};$proof=H ([string]$q.ExecutablePath);$h=$proof.sha256;$r+=[ordered]@{pid=[int]$q.ProcessId;ppid=[int]$q.ParentProcessId;birth=[string]$b;image=[string]$q.ExecutablePath;imageSha256=[string]$h;uid=[string]$o.Sid};if($q.ProcessId -eq $stop){break};$p=[int]$q.ParentProcessId};if($r.Count -eq 0 -or $r.Count -ge 64 -or $r[$r.Count-1].pid -ne $stop){throw 'qualified_caller_missing'};return $r};$self=L $PID ${caller};$target=L ${pid} ${caller};$library=[string][Management.ManagementDateTimeConverter].Assembly.Location;$libraryProof=H $library;[ordered]@{self=[ordered]@{pid=[int]$PID;chain=$self};target=[ordered]@{chain=$target};libraries=@($library);libraryFiles=@($libraryProof)}|ConvertTo-Json -Compress -Depth 8`; if(platform==="darwin") return "import ctypes,hashlib,json,os,stat,sys\nclass B(ctypes.Structure):_fields_=[('f',ctypes.c_uint32),('s',ctypes.c_uint32),('x',ctypes.c_uint32),('pid',ctypes.c_uint32),('ppid',ctypes.c_uint32),('uid',ctypes.c_uint32),('gid',ctypes.c_uint32),('ruid',ctypes.c_uint32),('rgid',ctypes.c_uint32),('svuid',ctypes.c_uint32),('svgid',ctypes.c_uint32),('rfu',ctypes.c_uint32),('comm',ctypes.c_char*16),('name',ctypes.c_char*32),('nfiles',ctypes.c_uint32),('pgid',ctypes.c_uint32),('pjobc',ctypes.c_uint32),('tdev',ctypes.c_uint32),('tpgid',ctypes.c_uint32),('nice',ctypes.c_int32),('ts',ctypes.c_uint64),('tu',ctypes.c_uint64)]\nrt=ctypes.CDLL(None);lib=ctypes.CDLL('/usr/lib/libproc.dylib');lib.proc_pidinfo.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_uint64,ctypes.c_void_p,ctypes.c_int];lib.proc_pidpath.argtypes=[ctypes.c_int,ctypes.c_void_p,ctypes.c_uint32]\nrt.dyld_image_header_containing_address.argtypes=[ctypes.c_void_p];rt.dyld_image_header_containing_address.restype=ctypes.c_void_p;rt._dyld_get_image_uuid.argtypes=[ctypes.c_void_p,ctypes.c_void_p];rt._dyld_get_image_uuid.restype=ctypes.c_bool;rt._dyld_get_shared_cache_uuid.argtypes=[ctypes.c_void_p];rt._dyld_get_shared_cache_uuid.restype=ctypes.c_bool;rt.dyld_shared_cache_file_path.restype=ctypes.c_char_p;rt._dyld_shared_cache_real_path.argtypes=[ctypes.c_char_p];rt._dyld_shared_cache_real_path.restype=ctypes.c_char_p\ndef h(x):return bytes(x).hex()\ndef physical_bytes(file):\n target=os.path.realpath(file);parents=[];cursor=os.path.dirname(target)\n while True:\n  item=os.lstat(cursor)\n  if not stat.S_ISDIR(item.st_mode) or os.path.realpath(cursor)!=cursor:raise RuntimeError('image_parent_reparse')\n  parents.append((cursor,item.st_dev,item.st_ino,item.st_uid,item.st_gid,item.st_mode))\n  parent=os.path.dirname(cursor)\n  if parent==cursor:break\n  cursor=parent\n named=os.lstat(target)\n if not stat.S_ISREG(named.st_mode):raise RuntimeError('image_leaf_reparse')\n def same(a,b):return (a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns)==(b.st_dev,b.st_ino,b.st_size,b.st_mtime_ns)\n with open(target,'rb') as held:\n  before=os.fstat(held.fileno())\n  if not same(named,before):raise RuntimeError('image_held_not_named')\n  value=held.read()\n  if not same(before,os.fstat(held.fileno())) or not same(before,os.lstat(target)):raise RuntimeError('image_changed')\n for entry in parents:\n  item=os.lstat(entry[0])\n  if (entry[0],item.st_dev,item.st_ino,item.st_uid,item.st_gid,item.st_mode)!=entry or os.path.realpath(entry[0])!=entry[0]:raise RuntimeError('image_parent_changed')\n if os.path.realpath(file)!=target:raise RuntimeError('image_alias_changed')\n return value\ndef one(p):\n b=B();\n if lib.proc_pidinfo(p,3,0,ctypes.byref(b),ctypes.sizeof(b))!=ctypes.sizeof(b):raise RuntimeError('bsdinfo_unavailable')\n out=ctypes.create_string_buffer(4096)\n if lib.proc_pidpath(p,out,4096)<=0:raise RuntimeError('image_unavailable')\n image=out.value.decode();return {'pid':p,'ppid':int(b.ppid),'birth':str(b.ts)+':'+str(b.tu),'image':image,'imageSha256':hashlib.sha256(physical_bytes(image)).hexdigest(),'uid':str(b.uid)}\ndef chain(p,stop):\n out=[];seen=set()\n while p>0 and len(out)<64:\n  if p in seen:raise RuntimeError('lineage_cycle')\n  seen.add(p);x=one(p);out.append(x)\n  if p==stop:break\n  p=x['ppid']\n if not out or len(out)>=64 or out[-1]['pid']!=stop:raise RuntimeError('qualified_caller_missing')\n return out\nlogical=b'/usr/lib/libproc.dylib';mh=rt.dyld_image_header_containing_address(ctypes.cast(lib.proc_pidinfo,ctypes.c_void_p));iu=(ctypes.c_ubyte*16)();cu=(ctypes.c_ubyte*16)();cp=rt.dyld_shared_cache_file_path();rp=rt._dyld_shared_cache_real_path(logical)\nif not mh or not rt._dyld_get_image_uuid(mh,iu) or not rt._dyld_get_shared_cache_uuid(cu) or not cp or not rp:raise RuntimeError('dyld_cache_spi_unavailable')\ncache=cp.decode();header=open(cache,'rb').read(104)\nif len(header)!=104 or header[:5]!=b'dyld_' or h(header[88:104])!=h(cu):raise RuntimeError('dyld_cache_header_uuid_mismatch')\nproof={'requested':logical.decode(),'logicalPath':rp.decode(),'loadedImageUuid':h(iu),'cachePath':cache,'cacheUuid':h(cu),'cacheHeaderUuid':h(header[88:104]),'cacheHeaderSha256':hashlib.sha256(header).hexdigest()}\nprint(json.dumps({'self':{'pid':os.getpid(),'chain':chain(os.getpid(),int(sys.argv[2]))},'target':{'chain':chain(int(sys.argv[1]),int(sys.argv[2]))},'libraries':[logical.decode()],'dyldCache':proof},separators=(',',':')))";throw new Error("first_custody_native_helper_platform_invalid"); }

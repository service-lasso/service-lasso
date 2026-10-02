// Native process observation is deliberately self-contained: it runs before
// dependency installation and never imports Service Lasso product code.
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import process from "node:process";

const digest = value => createHash("sha256").update(value).digest("hex");
const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

async function linuxOne(id) {
  const stat = await readFile(`/proc/${id}/stat`, "utf8"), end = stat.lastIndexOf(")");
  if (end < 0) throw new Error("first_custody_native_stat_invalid");
  const fields = stat.slice(end + 2).trim().split(/\s+/u), image = await realpath(`/proc/${id}/exe`), status = await readFile(`/proc/${id}/status`, "utf8");
  const pid = positive(id), ppid = positive(fields[1]), birth = fields[19], uid = status.match(/^Uid:\s+(\d+)/mu)?.[1] ?? null;
  if (!pid || !ppid || !/^[0-9]+$/u.test(birth) || uid === null) throw new Error("first_custody_native_linux_identity_invalid");
  return { pid, ppid, birth, image, imageSha256: digest(await readFile(image)), uid };
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
  return { ...state, stdout: out, stderr: err, stdoutEof, stderrEof, stdoutSha256: digest(out), stderrSha256: digest(err) };
}
function witnessTarget(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.target?.chain) || !value.target.chain.length) throw new Error("first_custody_native_helper_target_invalid");
  return JSON.stringify(value.target);
}
async function helper(executable, script, args) {
  const resolved = await realpath(executable), first = await capture(resolved, args(script)), second = await capture(resolved, args(script));
  // A helper's own identity is deliberately different for each probe.  The
  // held target observation is the stable comparison; each raw helper-self
  // witness is retained for independent validator closure below.
  let firstWitness, secondWitness;
  try { firstWitness = JSON.parse(first.stdout.toString("utf8")); secondWitness = JSON.parse(second.stdout.toString("utf8")); } catch { throw new Error("first_custody_native_helper_json_invalid"); }
  if (witnessTarget(firstWitness) !== witnessTarget(secondWitness)) throw new Error("first_custody_native_helper_target_changed");
  return { executable: resolved, executableSha256: digest(await readFile(resolved)), scriptSha256: digest(script), scriptBytes: Buffer.byteLength(script), first, second };
}
async function helperLibraries(requested) {
  if (!Array.isArray(requested) || !requested.length) throw new Error("first_custody_native_helper_library_missing");
  const seen = new Set(), libraries = [];
  for (const item of requested) {
    if (typeof item !== "string" || !item || seen.has(item)) throw new Error("first_custody_native_helper_library_invalid");
    seen.add(item);
    const resolved = await realpath(item);
    const bytes = await readFile(resolved);
    libraries.push({ requested: item, resolved, size: bytes.length, sha256: digest(bytes) });
  }
  return libraries;
}
async function windows(pid, caller) {
  // Win32_Process/GetOwnerSid is the OS-supported process/owner source.
  const root = process.env.SystemRoot ?? process.env.WINDIR;
  if (!root) throw new Error("first_custody_native_windows_root_missing");
  const script = `$ErrorActionPreference='Stop';function L($p,$stop){$r=@();while($p -gt 0 -and $r.Count -lt 64){$q=Get-CimInstance Win32_Process -Filter ('ProcessId='+$p);if($null -eq $q){throw 'missing_process'};$o=Invoke-CimMethod -InputObject $q -MethodName GetOwnerSid;if($o.ReturnValue -ne 0 -or [string]::IsNullOrWhiteSpace($q.ExecutablePath)){throw 'identity_incomplete'};$b=if($q.CreationDate -is [datetime]){$q.CreationDate.ToUniversalTime().Ticks}else{[Management.ManagementDateTimeConverter]::ToDateTime([string]$q.CreationDate).ToUniversalTime().Ticks};$s=[IO.File]::OpenRead($q.ExecutablePath);try{$h=([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($s))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};$r+=[ordered]@{pid=[int]$q.ProcessId;ppid=[int]$q.ParentProcessId;birth=[string]$b;image=[string]$q.ExecutablePath;imageSha256=[string]$h;uid=[string]$o.Sid};if($q.ProcessId -eq $stop){break};$p=[int]$q.ParentProcessId};if($r.Count -eq 0 -or $r.Count -ge 64 -or $r[$r.Count-1].pid -ne $stop){throw 'qualified_caller_missing'};return $r};$self=L $PID ${caller};$target=L ${pid} ${caller};[ordered]@{self=[ordered]@{pid=[int]$PID;chain=$self};target=[ordered]@{chain=$target};libraries=@([string][Management.ManagementDateTimeConverter].Assembly.Location)}|ConvertTo-Json -Compress -Depth 8`;
  const witness = await helper(`${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, script, body => ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", body]);
  const parsed = JSON.parse(witness.first.stdout.toString("utf8"));
  if (!parsed || !Array.isArray(parsed.target?.chain)) throw new Error("first_custody_native_windows_witness_invalid");
  return { chain: parsed.target.chain, helper: { platform: "win32", ...witness, libraries: await helperLibraries(parsed.libraries) } };
}
async function darwin(pid, caller) {
  // proc_pidinfo exposes the kernel start timeval, avoiding ps lstart's
  // second-level granularity for PID-reuse custody.
  // dyld_priv.h supplies these SPI declarations; dyld_cache_format.h fixes
  // the header UUID field at byte offset 88.  Only the fixed header is read.
  const script = "import ctypes,hashlib,json,os,sys\nclass B(ctypes.Structure):_fields_=[('f',ctypes.c_uint32),('s',ctypes.c_uint32),('x',ctypes.c_uint32),('pid',ctypes.c_uint32),('ppid',ctypes.c_uint32),('uid',ctypes.c_uint32),('gid',ctypes.c_uint32),('ruid',ctypes.c_uint32),('rgid',ctypes.c_uint32),('svuid',ctypes.c_uint32),('svgid',ctypes.c_uint32),('rfu',ctypes.c_uint32),('comm',ctypes.c_char*16),('name',ctypes.c_char*32),('nfiles',ctypes.c_uint32),('pgid',ctypes.c_uint32),('pjobc',ctypes.c_uint32),('tdev',ctypes.c_uint32),('tpgid',ctypes.c_uint32),('nice',ctypes.c_int32),('ts',ctypes.c_uint64),('tu',ctypes.c_uint64)]\nrt=ctypes.CDLL(None);lib=ctypes.CDLL('/usr/lib/libproc.dylib');lib.proc_pidinfo.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_uint64,ctypes.c_void_p,ctypes.c_int];lib.proc_pidpath.argtypes=[ctypes.c_int,ctypes.c_void_p,ctypes.c_uint32]\nrt.dyld_image_header_containing_address.argtypes=[ctypes.c_void_p];rt.dyld_image_header_containing_address.restype=ctypes.c_void_p;rt._dyld_get_image_uuid.argtypes=[ctypes.c_void_p,ctypes.c_void_p];rt._dyld_get_image_uuid.restype=ctypes.c_bool;rt._dyld_get_shared_cache_uuid.argtypes=[ctypes.c_void_p];rt._dyld_get_shared_cache_uuid.restype=ctypes.c_bool;rt.dyld_shared_cache_file_path.restype=ctypes.c_char_p;rt._dyld_shared_cache_real_path.argtypes=[ctypes.c_char_p];rt._dyld_shared_cache_real_path.restype=ctypes.c_char_p\ndef h(x):return bytes(x).hex()\ndef one(p):\n b=B();\n if lib.proc_pidinfo(p,3,0,ctypes.byref(b),ctypes.sizeof(b))!=ctypes.sizeof(b):raise RuntimeError('bsdinfo_unavailable')\n out=ctypes.create_string_buffer(4096)\n if lib.proc_pidpath(p,out,4096)<=0:raise RuntimeError('image_unavailable')\n image=out.value.decode();return {'pid':p,'ppid':int(b.ppid),'birth':str(b.ts)+':'+str(b.tu),'image':image,'imageSha256':hashlib.sha256(open(image,'rb').read()).hexdigest(),'uid':str(b.uid)}\ndef chain(p,stop):\n out=[];seen=set()\n while p>0 and len(out)<64:\n  if p in seen:raise RuntimeError('lineage_cycle')\n  seen.add(p);x=one(p);out.append(x)\n  if p==stop:break\n  p=x['ppid']\n if not out or len(out)>=64 or out[-1]['pid']!=stop:raise RuntimeError('qualified_caller_missing')\n return out\nlogical=b'/usr/lib/libproc.dylib';mh=rt.dyld_image_header_containing_address(ctypes.cast(lib.proc_pidinfo,ctypes.c_void_p));iu=(ctypes.c_ubyte*16)();cu=(ctypes.c_ubyte*16)();cp=rt.dyld_shared_cache_file_path();rp=rt._dyld_shared_cache_real_path(logical)\nif not mh or not rt._dyld_get_image_uuid(mh,iu) or not rt._dyld_get_shared_cache_uuid(cu) or not cp or not rp:raise RuntimeError('dyld_cache_spi_unavailable')\ncache=cp.decode();header=open(cache,'rb').read(104)\nif len(header)!=104 or header[:5]!=b'dyld_' or h(header[88:104])!=h(cu):raise RuntimeError('dyld_cache_header_uuid_mismatch')\nproof={'requested':logical.decode(),'logicalPath':rp.decode(),'loadedImageUuid':h(iu),'cachePath':cache,'cacheUuid':h(cu),'cacheHeaderUuid':h(header[88:104]),'cacheHeaderSha256':hashlib.sha256(header).hexdigest()}\nprint(json.dumps({'self':{'pid':os.getpid(),'chain':chain(os.getpid(),int(sys.argv[2]))},'target':{'chain':chain(int(sys.argv[1]),int(sys.argv[2]))},'libraries':[logical.decode()],'dyldCache':proof},separators=(',',':')))";
  const preliminary = await capture("/usr/bin/python3", ["-c", script, String(pid), String(caller)]);
  const initial = JSON.parse(preliminary.stdout.toString("utf8"));
  const witness = await helper("/usr/bin/python3", script, body => ["-c", body, String(pid), String(caller)]);
  const parsed = JSON.parse(witness.first.stdout.toString("utf8"));
  if (!parsed || !Array.isArray(parsed.target?.chain)) throw new Error("first_custody_native_darwin_witness_invalid");
  if (!initial?.dyldCache || initial.dyldCache.cacheUuid !== initial.dyldCache.cacheHeaderUuid) throw new Error("first_custody_native_darwin_cache_invalid");
  return { chain: parsed.target.chain, helper: { platform: "darwin", ...witness, libraries: [initial.dyldCache] } };
}

export async function startHeld(tool, args, sourceRoot) {
  const child = spawn(tool.resolved, args, { cwd: sourceRoot, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const stdout = [], stderr = []; let stdoutEof = false, stderrEof = false, startError = null, notify = null;
  child.stdout.on("data", value => { stdout.push(Buffer.from(value)); notify?.(); notify = null; }); child.stderr.on("data", value => stderr.push(Buffer.from(value)));
  child.stdout.once("end", () => { stdoutEof = true; }); child.stderr.once("end", () => { stderrEof = true; }); child.once("error", error => { startError = error; notify?.(); notify = null; });
  const closed = new Promise(resolve => child.once("close", (exitCode, signal) => resolve({ exitCode, signal: signal ?? null, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), stdoutEof, stderrEof, startError })));
  if (!positive(child.pid) || child.exitCode !== null) throw new Error("first_custody_native_child_not_live");
  try {
    const observed = process.platform === "linux" ? await linux(child.pid, process.pid) : process.platform === "win32" ? await windows(child.pid, process.pid) : process.platform === "darwin" ? await darwin(child.pid, process.pid) : Promise.reject(new Error("first_custody_native_platform_unsupported"));
    const parents = observed.chain, image = await realpath(parents[0]?.image ?? "");
    if (child.exitCode !== null || !parents.length || parents[0].pid !== child.pid || image !== tool.resolved || digest(await readFile(image)) !== tool.file.sha256) throw new Error("first_custody_native_image_mismatch");
    const caller = parents.at(-1), callerImage = await realpath(process.execPath);
    if (caller.pid !== process.pid || caller.imageSha256 !== digest(await readFile(callerImage))) throw new Error("first_custody_native_qualified_caller_mismatch");
    return { child, closed, output: () => Buffer.concat(stdout), waitForOutput: before => new Promise(resolve => { if (Buffer.concat(stdout).length !== before || child.exitCode !== null || startError) resolve(); else notify = resolve; }), native: { id: `native-${child.pid}-${digest(JSON.stringify(parents)).slice(0, 16)}`, pid: child.pid, ppid: parents[0].ppid, image, imageSha256: digest(await readFile(image)), parents, sourceCaller: { pid: caller.pid, birth: caller.birth, image: caller.image, imageSha256: caller.imageSha256, uid: caller.uid, cwd: sourceRoot }, helper: observed.helper, birthObserved: true, nativeBirthCustody: "HELD_NATIVE_V1" } };
  } catch (error) { child.stdin.end(); await closed; throw error; }
}

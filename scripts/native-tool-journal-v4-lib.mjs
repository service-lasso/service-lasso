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
async function helper(executable, script, args) {
  const resolved = await realpath(executable), first = await capture(resolved, args(script)), second = await capture(resolved, args(script));
  if (!first.stdout.equals(second.stdout)) throw new Error("first_custody_native_helper_probe_changed");
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
  const script = `$ErrorActionPreference='Stop';$p=${pid};$stop=${caller};$r=@();while($p -gt 0 -and $r.Count -lt 64){$q=Get-CimInstance Win32_Process -Filter ('ProcessId='+$p);if($null -eq $q){throw 'missing_process'};$o=Invoke-CimMethod -InputObject $q -MethodName GetOwnerSid;if($o.ReturnValue -ne 0 -or [string]::IsNullOrWhiteSpace($q.ExecutablePath)){throw 'identity_incomplete'};$b=if($q.CreationDate -is [datetime]){$q.CreationDate.ToUniversalTime().Ticks}else{[Management.ManagementDateTimeConverter]::ToDateTime([string]$q.CreationDate).ToUniversalTime().Ticks};$s=[IO.File]::OpenRead($q.ExecutablePath);try{$h=([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($s))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};$r+=[ordered]@{pid=[int]$q.ProcessId;ppid=[int]$q.ParentProcessId;birth=[string]$b;image=[string]$q.ExecutablePath;imageSha256=[string]$h;uid=[string]$o.Sid};if($q.ProcessId -eq $stop){break};$p=[int]$q.ParentProcessId};if($r.Count -eq 0 -or $r.Count -ge 64 -or $r[$r.Count-1].pid -ne $stop){throw 'qualified_caller_missing'};[ordered]@{chain=@($r);libraries=@([string][Management.ManagementDateTimeConverter].Assembly.Location)}|ConvertTo-Json -Compress`;
  const witness = await helper(`${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, script, body => ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", body]);
  const parsed = JSON.parse(witness.first.stdout.toString("utf8"));
  if (!parsed || !Array.isArray(parsed.chain)) throw new Error("first_custody_native_windows_witness_invalid");
  return { chain: parsed.chain, helper: { platform: "win32", ...witness, libraries: await helperLibraries(parsed.libraries) } };
}
async function darwin(pid, caller) {
  // libproc supplies the target image; ps supplies documented parent/UID data.
  const script = "import ctypes,hashlib,json,subprocess,sys\npid=int(sys.argv[1]);stop=int(sys.argv[2]);rows={}\nfor line in subprocess.check_output(['/bin/ps','-ax','-o','pid=,ppid=,uid=,lstart='],text=True).splitlines():\n p=line.split();\n if len(p)>=8:rows[int(p[0])]=(int(p[1]),p[2],' '.join(p[3:8]))\nlib_path='/usr/lib/libproc.dylib';lib=ctypes.CDLL(lib_path);out=[];seen=set();p=pid\nwhile p>0 and len(out)<64:\n if p in seen or p not in rows:raise RuntimeError('lineage_incomplete')\n seen.add(p);b=ctypes.create_string_buffer(4096)\n if lib.proc_pidpath(p,b,4096)<=0:raise RuntimeError('image_unavailable')\n image=b.value.decode();pp,uid,birth=rows[p];out.append({'pid':p,'ppid':pp,'birth':birth,'image':image,'imageSha256':hashlib.sha256(open(image,'rb').read()).hexdigest(),'uid':uid})\n if p==stop:break\n p=pp\nif not out or len(out)>=64 or out[-1]['pid']!=stop:raise RuntimeError('qualified_caller_missing')\nprint(json.dumps({'chain':out,'libraries':[lib_path]},separators=(',',':')))";
  const witness = await helper("/usr/bin/python3", script, body => ["-c", body, String(pid), String(caller)]);
  const parsed = JSON.parse(witness.first.stdout.toString("utf8"));
  if (!parsed || !Array.isArray(parsed.chain)) throw new Error("first_custody_native_darwin_witness_invalid");
  return { chain: parsed.chain, helper: { platform: "darwin", ...witness, libraries: await helperLibraries(parsed.libraries) } };
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

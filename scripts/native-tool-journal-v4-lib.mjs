import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import process from "node:process";

const digest = value => createHash("sha256").update(value).digest("hex");
async function linux(pid) {
  const one = async id => { const stat = await readFile(`/proc/${id}/stat`, "utf8"); const end = stat.lastIndexOf(")"); if (end < 0) throw new Error("first_custody_native_stat_invalid"); const fields = stat.slice(end + 2).trim().split(/\s+/u), image = await realpath(`/proc/${id}/exe`), status = await readFile(`/proc/${id}/status`, "utf8"); return { pid: Number(id), ppid: Number(fields[1]), birth: fields[19], image, imageSha256: digest(await readFile(image)), uid: status.match(/^Uid:\s+(\d+)/mu)?.[1] ?? null }; };
  const chain = []; let current = await one(pid);
  for (let count = 0; count < 64; count += 1) { if (!Number.isSafeInteger(current.pid) || !Number.isSafeInteger(current.ppid) || !current.birth || !current.image || chain.some(item => item.pid === current.pid)) throw new Error("first_custody_native_lineage_invalid"); chain.push(current); if (current.ppid <= 1) return chain; current = await one(current.ppid); }
  throw new Error("first_custody_native_parent_depth");
}
async function windows(pid) {
  const script = `$p=${pid};$r=@();while($p -gt 0 -and $r.Count -lt 64){$q=Get-CimInstance Win32_Process -Filter "ProcessId=$p";if($null -eq $q){throw 'missing_parent'};$o=Invoke-CimMethod -InputObject $q -MethodName GetOwnerSid;if($o.ReturnValue -ne 0 -or [string]::IsNullOrWhiteSpace($q.ExecutablePath)){throw 'identity_incomplete'};$b=[Management.ManagementDateTimeConverter]::ToDateTime($q.CreationDate).ToUniversalTime().Ticks;if($r.Count -gt 0 -and $b -gt $r[$r.Count-1].birth){throw 'parent_newer_than_child'};$h=(Get-FileHash -LiteralPath $q.ExecutablePath -Algorithm SHA256).Hash.ToLowerInvariant();$r+=[pscustomobject]@{pid=[int]$q.ProcessId;ppid=[int]$q.ParentProcessId;birth=[string]$b;image=[string]$q.ExecutablePath;imageSha256=[string]$h;uid=[string]$o.Sid};if($q.ParentProcessId -le 0){break};$p=[int]$q.ParentProcessId};if($r.Count -eq 0 -or $r.Count -ge 64){throw 'lineage_incomplete'};$r|ConvertTo-Json -Compress`;
  const shell = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const child = spawn(shell, ["-NoProfile", "-NonInteractive", "-Command", script], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }), chunks = [];
  child.stdout.on("data", value => chunks.push(Buffer.from(value))); const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  if (code !== 0) throw new Error("first_custody_native_windows_lineage_failed"); const value = JSON.parse(Buffer.concat(chunks).toString("utf8")); return Array.isArray(value) ? value : [value];
}
async function darwin(pid) {
  const script = `import ctypes,hashlib,json,subprocess,sys\npid=int(sys.argv[1]); rows={}\nfor line in subprocess.check_output(['/bin/ps','-ax','-o','pid=,ppid=,uid=,lstart='],text=True).splitlines():\n p=line.split();\n if len(p)>=8: rows[int(p[0])]=(int(p[1]),p[2],' '.join(p[3:8]))\nlib=ctypes.CDLL('/usr/lib/libproc.dylib'); out=[]; seen=set(); p=pid\nwhile p>0 and len(out)<64:\n if p in seen or p not in rows: raise RuntimeError('lineage_incomplete')\n seen.add(p); b=ctypes.create_string_buffer(4096)\n if lib.proc_pidpath(p,b,4096)<=0: raise RuntimeError('image_unavailable')\n image=b.value.decode(); pp,uid,birth=rows[p]; out.append({'pid':p,'ppid':pp,'birth':birth,'image':image,'imageSha256':hashlib.sha256(open(image,'rb').read()).hexdigest(),'uid':uid})\n if pp<=1: break\n p=pp\nif not out or len(out)>=64: raise RuntimeError('lineage_depth')\nprint(json.dumps(out,separators=(',',':')))`;
  const child = spawn("/usr/bin/python3", ["-c", script, String(pid)], { shell: false, stdio: ["ignore", "pipe", "pipe"] }), chunks = [];
  child.stdout.on("data", value => chunks.push(Buffer.from(value))); const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }); if (code !== 0) throw new Error("first_custody_native_darwin_lineage_failed"); return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function startHeld(tool, args, sourceRoot) {
  const child = spawn(tool.resolved, args, { cwd: sourceRoot, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const stdout = [], stderr = []; let stdoutEof = false, stderrEof = false, startError = null, notify = null;
  child.stdout.on("data", value => { stdout.push(Buffer.from(value)); if (notify) { notify(); notify = null; } }); child.stderr.on("data", value => stderr.push(Buffer.from(value))); child.stdout.once("end", () => { stdoutEof = true; }); child.stderr.once("end", () => { stderrEof = true; }); child.once("error", error => { startError = error; if (notify) { notify(); notify = null; } });
  const closed = new Promise(resolve => child.once("close", (exitCode, signal) => resolve({ exitCode, signal: signal ?? null, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), stdoutEof, stderrEof, startError })));
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0 || child.exitCode !== null) throw new Error("first_custody_native_child_not_live");
  try {
    const parents = await (process.platform === "linux" ? linux(child.pid) : process.platform === "win32" ? windows(child.pid) : process.platform === "darwin" ? darwin(child.pid) : Promise.reject(new Error("first_custody_native_platform_unsupported")));
    if (child.exitCode !== null || !parents.length || parents[0].pid !== child.pid) throw new Error("first_custody_native_observation_incomplete"); const image = await realpath(parents[0].image), imageSha256 = digest(await readFile(image)); if (image !== tool.resolved || imageSha256 !== tool.file.sha256) throw new Error("first_custody_native_image_mismatch");
    return { child, closed, output: () => Buffer.concat(stdout), waitForOutput: before => new Promise(resolve => { if (Buffer.concat(stdout).length !== before || child.exitCode !== null || startError) resolve(); else notify = resolve; }), native: { id: `native-${child.pid}-${digest(JSON.stringify(parents)).slice(0,16)}`, pid: child.pid, ppid: parents[0].ppid, image, imageSha256, parents, sourceCaller: { pid: process.pid, cwd: sourceRoot }, birthObserved: true, nativeBirthCustody: "HELD_NATIVE_V1" } };
  } catch (error) { child.stdin.end(); await closed; throw error; }
}

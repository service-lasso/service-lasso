import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { promisify } from "node:util";
import { strictJson } from "./consume-admin-trusted-unlock-receipt.mjs";

const execute = promisify(execFile), SYSTEM = "S-1-5-18", ADMINS = "S-1-5-32-544";
export const sha256 = value => createHash("sha256").update(value).digest("hex");
export const SHA = /^[0-9a-f]{40}$/u;
export const DIGEST = /^[0-9a-f]{64}$/u;
export const exact = (value, keys) => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
export function requireStrictJson(source, label) { if (!strictJson(source)) throw new Error(label + "_duplicate_or_malformed_json"); return JSON.parse(source); }
export function inside(child, root) { const relative = path.relative(path.resolve(root), path.resolve(child)); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
function identity(entry) { return { dev: Number.isSafeInteger(entry.dev) ? entry.dev : null, ino: Number.isSafeInteger(entry.ino) ? entry.ino : null, size: entry.size, mtimeMs: entry.mtimeMs }; }
function sameIdentity(a, b) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs; }
const psPath = () => path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
async function psJson(directory, script, error) { const { stdout, stderr } = await execute(psPath(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, maxBuffer: 256 * 1024, env: { ...process.env, SERVICE_LASSO_CUSTODY_TARGET: directory } }); if (stderr || !stdout) throw new Error(error); try { return JSON.parse(stdout); } catch { throw new Error(error); } }
const aclRead = "$ErrorActionPreference='Stop';$p=[Environment]::GetEnvironmentVariable('SERVICE_LASSO_CUSTODY_TARGET','Process');$i=[Security.Principal.WindowsIdentity]::GetCurrent();$a=(Get-Item -LiteralPath $p -Force -ErrorAction Stop).GetAccessControl();$r=@($a.Access|%{$s=$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;[ordered]@{sid=[string]$s;type=[string]$_.AccessControlType;rights=[int64]$_.FileSystemRights;inherited=[bool]$_.IsInherited;inheritance=[int]$_.InheritanceFlags;propagation=[int]$_.PropagationFlags}}|sort sid,type,rights,inherited,inheritance,propagation);[ordered]@{owner=[string]$a.GetOwner([Security.Principal.SecurityIdentifier]).Value;current=[string]$i.User.Value;protected=[bool]$a.AreAccessRulesProtected;rules=@($r)}|ConvertTo-Json -Compress -Depth 4";
const aclSet = "$ErrorActionPreference='Stop';$p=[Environment]::GetEnvironmentVariable('SERVICE_LASSO_CUSTODY_TARGET','Process');$i=[Security.Principal.WindowsIdentity]::GetCurrent();$item=Get-Item -LiteralPath $p -Force -ErrorAction Stop;$a=$item.GetAccessControl();$a.SetOwner($i.User);$a.SetAccessRuleProtection($true,$false);@($a.Access)|%{$a.RemoveAccessRuleSpecific($_)};$inh=[Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit';$none=[Security.AccessControl.PropagationFlags]::None;$allow=[Security.AccessControl.AccessControlType]::Allow;@($i.User.Value,'S-1-5-18','S-1-5-32-544')|Select-Object -Unique|%{$a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($_,[Security.AccessControl.FileSystemRights]::FullControl,$inh,$none,$allow)))};$item.SetAccessControl($a)";
export function validAcl(proof) { if (!exact(proof, ["owner", "current", "protected", "rules"]) || proof.owner !== proof.current || typeof proof.current !== "string" || !/^S-1-[0-9]+(?:-[0-9]+)+$/u.test(proof.current) || proof.protected !== true || !Array.isArray(proof.rules)) return false; const trusted = new Set([proof.current, SYSTEM, ADMINS]); return proof.rules.length === trusted.size && proof.rules.every(rule => exact(rule, ["sid", "type", "rights", "inherited", "inheritance", "propagation"]) && trusted.has(rule.sid) && rule.type === "Allow" && rule.rights === 2032127 && rule.inherited === false && rule.inheritance === 3 && rule.propagation === 0) && new Set(proof.rules.map(rule => rule.sid)).size === trusted.size; }
async function windowsAcl(directory) { const proof = await psJson(directory, aclRead, "first_custody_windows_acl_probe_invalid"); if (!validAcl(proof)) throw new Error("first_custody_windows_acl_not_exclusive"); return { checked: true, tool: "windows_sid_dacl", ownerSid: proof.owner, currentSid: proof.current, rules: proof.rules }; }
async function windowsReparse(directory) { const script = "$ErrorActionPreference='Stop';$p=[Environment]::GetEnvironmentVariable('SERVICE_LASSO_CUSTODY_TARGET','Process');$i=Get-Item -LiteralPath $p -Force -ErrorAction Stop;$r=($i.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0;$t=$null;if($r){$f=Join-Path $env:SystemRoot 'System32\\fsutil.exe';$o=&$f reparsepoint query $p 2>&1;if($LASTEXITCODE-ne 0){throw 'tag_unavailable'};$m=([string]($o -join [Environment]::NewLine)|Select-String 'Reparse Tag Value\\s*:\\s*(0x[0-9A-Fa-f]+)' -AllMatches).Matches;if($m.Count-ne 1){throw 'tag_invalid'};$t=$m[0].Groups[1].Value};[ordered]@{attributes=[int64]$i.Attributes;reparse=[bool]$r;tag=$t}|ConvertTo-Json -Compress"; const result = await psJson(directory, script, "first_custody_windows_reparse_probe_invalid"); if (!exact(result, ["attributes", "reparse", "tag"]) || typeof result.reparse !== "boolean" || (result.reparse ? typeof result.tag !== "string" : result.tag !== null) || result.reparse) throw new Error("first_custody_windows_reparse_parent"); }
export async function chain(directory, boundary) { const target = path.resolve(directory), root = path.resolve(boundary); if (!inside(target, root)) throw new Error("first_custody_boundary_escape"); const resolvedRoot = await realpath(root), entries=[]; for (let cursor=target;;cursor=path.dirname(cursor)) { const entry=await lstat(cursor); if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("first_custody_reparse_parent"); if (process.platform === "win32") await windowsReparse(cursor); const resolved=await realpath(cursor); if (!inside(resolved,resolvedRoot)) throw new Error("first_custody_realpath_escape"); entries.push({cursor,resolved,identity:identity(entry)}); if(cursor===root)return {entries}; if(cursor===path.dirname(cursor))throw new Error("first_custody_parent_boundary_escape"); } }
export async function recheck(snapshot) { for (const item of snapshot.entries) { const now=await lstat(item.cursor); if(!now.isDirectory()||now.isSymbolicLink()||!sameIdentity(item.identity,identity(now)))throw new Error("first_custody_parent_replaced"); if(process.platform==="win32")await windowsReparse(item.cursor); if(await realpath(item.cursor)!==item.resolved)throw new Error("first_custody_parent_realpath_replaced"); } }
export async function nonReparseDirectory(directory,boundary) { await recheck(await chain(directory,boundary)); }
export async function ownership(directory,boundary) { const snapshot=await chain(directory,boundary), entry=await stat(directory), resolved=await realpath(directory), acl=process.platform==="win32"?await windowsAcl(resolved):{checked:true,tool:"posix",rawSha256:null}; if(process.platform!=="win32"&&(entry.mode&0o077)!==0)throw new Error("first_custody_acl_not_private"); await recheck(snapshot); return {path:resolved,uid:Number.isSafeInteger(entry.uid)?entry.uid:null,gid:Number.isSafeInteger(entry.gid)?entry.gid:null,mode:entry.mode&0o777,acl,identity:identity(entry)}; }
export async function createExclusiveDirectory(directory,boundary) { const target=path.resolve(directory); if(!inside(target,boundary))throw new Error("first_custody_owned_root_escape"); if(await lstat(target).catch(error=>error.code==="ENOENT"?null:Promise.reject(error)))throw new Error("first_custody_owned_root_exists"); const parents=await chain(path.dirname(target),boundary); await mkdir(target,{mode:0o700}); if(process.platform==="win32")await psJson(target,aclSet,"first_custody_windows_acl_set_failed"); await recheck(parents); return ownership(target,boundary); }
export async function absentLeaf(file,boundary) { const target=path.resolve(file), parents=await chain(path.dirname(target),boundary); if(await lstat(target).catch(error=>error.code==="ENOENT"?null:Promise.reject(error)))throw new Error("first_custody_registry_present"); await recheck(parents); return {path:target,state:"ABSENT",parent:await ownership(path.dirname(target),boundary)}; }
export async function regularClosedFile(file,root) { const target=path.resolve(file), boundary=path.resolve(root); if(!inside(target,boundary))throw new Error("first_custody_boundary_escape"); const parents=await chain(path.dirname(target),boundary), beforePath=await lstat(target); if(!beforePath.isFile()||beforePath.isSymbolicLink())throw new Error("first_custody_nonregular_or_reparse_file"); const handle=await open(target,"r"); let bytes; try { const before=await handle.stat(); if(!before.isFile())throw new Error("first_custody_held_not_regular"); const chunks=[],block=Buffer.allocUnsafe(65536); for(;;){const {bytesRead}=await handle.read(block,0,block.length,null);if(!bytesRead)break;chunks.push(Buffer.from(block.subarray(0,bytesRead)));} const after=await handle.stat();if(!sameIdentity(identity(before),identity(after)))throw new Error("first_custody_held_file_changed_during_hash");bytes=Buffer.concat(chunks);}finally{await handle.close();} await recheck(parents);const afterPath=await lstat(target);if(!afterPath.isFile()||afterPath.isSymbolicLink()||!sameIdentity(identity(beforePath),identity(afterPath)))throw new Error("first_custody_path_swapped_during_hash");return {size:bytes.length,sha256:sha256(bytes)}; }
async function exclusiveWrite(file,value,root) { const target=path.resolve(file),parents=await chain(path.dirname(target),root);if(await lstat(target).catch(error=>error.code==="ENOENT"?null:Promise.reject(error)))throw new Error("first_custody_output_exists");const handle=await open(target,"wx",0o600);try{await handle.writeFile(value);await handle.sync();const held=await handle.stat(),named=await lstat(target);if(!held.isFile()||!named.isFile()||named.isSymbolicLink()||!sameIdentity(identity(held),identity(named)))throw new Error("first_custody_output_path_swapped");await recheck(parents);}finally{await handle.close();}await recheck(parents);return regularClosedFile(target,root); }
export async function exclusiveJson(file,value,root) { return exclusiveWrite(file,JSON.stringify(value)+"\n",root); }
export async function exclusiveBytes(file,value,root) { return exclusiveWrite(file,value,root); }
// This proves only the fixed dyld header, never the complete cache or libproc file.
// Parent snapshots detect replacement; they are not an atomic directory anchor.
export async function darwinCacheHeader(file) {
  const target = path.resolve(file), boundary = path.parse(target).root;
  if (target !== file || await realpath(target) !== target) throw new Error("first_custody_darwin_cache_alias");
  const parents = await chain(path.dirname(target), boundary);
  const secureParents = async () => {
    await recheck(parents);
    for (const item of parents.entries) {
      const entry = await lstat(item.cursor);
      if (entry.uid !== 0 || (entry.mode & 0o022) !== 0) throw new Error("first_custody_darwin_cache_parent_not_os_owned");
    }
  };
  await secureParents();
  const named = await lstat(target);
  if (!named.isFile() || named.isSymbolicLink() || named.uid !== 0 || (named.mode & 0o022) !== 0) throw new Error("first_custody_darwin_cache_not_os_owned");
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  let header;
  try {
    const held = await handle.stat();
    if (!held.isFile() || !sameIdentity(identity(named), identity(held)) || held.uid !== 0 || (held.mode & 0o022) !== 0) throw new Error("first_custody_darwin_cache_held_identity");
    header = Buffer.alloc(104);
    let offset = 0;
    while (offset < header.length) {
      const { bytesRead } = await handle.read(header, offset, header.length - offset, offset);
      if (!bytesRead) throw new Error("first_custody_darwin_cache_short_header");
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (!sameIdentity(identity(held), identity(after)) || after.uid !== held.uid || after.mode !== held.mode) throw new Error("first_custody_darwin_cache_changed");
    if (header.subarray(0, 5).toString("ascii") !== "dyld_") throw new Error("first_custody_darwin_cache_magic");
    await secureParents();
    const current = await lstat(target);
    if (!sameIdentity(identity(held), identity(current)) || current.uid !== held.uid || current.mode !== held.mode || await realpath(target) !== target) throw new Error("first_custody_darwin_cache_replaced");
  } finally { await handle.close(); }
  await secureParents();
  return { uuid: header.subarray(88, 104).toString("hex"), sha256: sha256(header) };
}

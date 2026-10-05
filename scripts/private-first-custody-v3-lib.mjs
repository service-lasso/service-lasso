import { nativeIdentity, sameNativeIdentity, directoryIdentity, sameDirectoryIdentity, nativeOwnerNumber } from "./exact-native-file-identity-lib.mjs";
import { createHash } from "node:crypto";
import { heldImageBytes, imageParents, recheckImageParents, startHeld } from "./native-tool-journal-v4-lib.mjs";
import { link, lstat, mkdir, open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";

import { strictJson } from "./consume-admin-trusted-unlock-receipt.mjs";

const SYSTEM = "S-1-5-18", ADMINS = "S-1-5-32-544";
export const sha256 = value => createHash("sha256").update(value).digest("hex");
export const SHA = /^[0-9a-f]{40}$/u;
export const DIGEST = /^[0-9a-f]{64}$/u;
export const exact = (value, keys) => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
export function requireStrictJson(source, label) { if (!strictJson(source)) throw new Error(label + "_duplicate_or_malformed_json"); return JSON.parse(source); }
export function inside(child, root) { const relative = path.relative(path.resolve(root), path.resolve(child)); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
const identity = nativeIdentity;
const sameIdentity = sameNativeIdentity;
const psPath = () => path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
let bootstrap = null, bootstrapSession = null;
export function beginBootstrapCapture() { if(bootstrap!==null||bootstrapSession!==null)throw new Error("first_custody_bootstrap_already_started");bootstrap=[]; }
export function bootstrapProtocolScript() {
  const quote=value=>"'"+value.replaceAll("'","''")+"'";
  return "$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$read=[scriptblock]::Create("+quote(aclRead)+");$set=[scriptblock]::Create("+quote(aclSet)+");$reparse=[scriptblock]::Create("+quote(reparseRead)+");while($null -ne ($line=[Console]::ReadLine())){$q=$line|ConvertFrom-Json -ErrorAction Stop;if($null -eq $q -or @($q.PSObject.Properties).Count -ne 2 -or $q.purpose -isnot [string] -or $q.target -isnot [string] -or [string]::IsNullOrWhiteSpace($q.target) -or -not [IO.Path]::IsPathRooted($q.target)){throw 'request_invalid'};$env:SERVICE_LASSO_CUSTODY_TARGET=[string]$q.target;switch([string]$q.purpose){'acl_read'{&$read};'acl_set'{&$set};'reparse'{&$reparse};default{throw 'purpose_invalid'}}}";
}
async function startBootstrapSession() {
  const executable=await realpath(psPath()),parents=await imageParents(executable),bytes=await heldImageBytes(executable);
  const tool={name:"powershell",requested:psPath(),resolved:executable,file:{size:bytes.length,sha256:sha256(bytes)}},args=["-NoLogo","-NoProfile","-NonInteractive","-Command",bootstrapProtocolScript()],probe=await startHeld(tool,args,process.env.GITHUB_WORKSPACE??process.cwd());
  await recheckImageParents(parents);
  return {tool,args,probe,offset:0,requests:[],results:[],parents};
}
export async function closeBootstrapSession(session) {
  session.probe.child.stdin.end();const closed=await session.probe.closed;
  const result={naturalWaitForExit:true,exitCode:closed.exitCode,signal:closed.signal,stdoutEof:closed.stdoutEof,stderrEof:closed.stderrEof,stdin:Buffer.concat(session.requests),stdout:closed.stdout,stderr:closed.stderr,stdinSha256:sha256(Buffer.concat(session.requests)),stdoutSha256:sha256(closed.stdout),stderrSha256:sha256(closed.stderr)};
  if(closed.startError||closed.exitCode!==0||closed.signal!==null||!closed.stdoutEof||!closed.stderrEof||closed.stderr.length||!closed.stdout.equals(Buffer.concat(session.results)))throw new Error("first_custody_bootstrap_terminal_closure_invalid");
  if(session.parents)await recheckImageParents(session.parents);
  return {tool:session.tool,args:session.args,native:session.probe.native,result};
}
async function psJson(directory,purpose,error) {
  const standalone=bootstrap===null,session=standalone?await startBootstrapSession():bootstrapSession??(bootstrapSession=await startBootstrapSession()),request=Buffer.from(JSON.stringify({purpose,target:directory})+"\n");
  session.requests.push(request);session.probe.child.stdin.write(request);let output;
  try {
    for(;;){const bytes=session.probe.output(),end=bytes.indexOf(10,session.offset);if(end>=0){output=Buffer.from(bytes.subarray(session.offset,end+1));session.offset=end+1;break;}await session.probe.waitForOutput(bytes.length);if(session.probe.child.exitCode!==null)throw new Error(error);}
    session.results.push(output);const value=requireStrictJson(output.toString("utf8"),error);bootstrap?.push({purpose,target:directory,requestSha256:sha256(request),stdout:output,stdoutSha256:sha256(output)});
    if(standalone)await closeBootstrapSession(session);return value;
  }catch(cause){session.probe.child.stdin.end();await session.probe.closed;throw cause;}
}
const aclRead = "$ErrorActionPreference='Stop';$p=[Environment]::GetEnvironmentVariable('SERVICE_LASSO_CUSTODY_TARGET','Process');$i=[Security.Principal.WindowsIdentity]::GetCurrent();$a=(Get-Item -LiteralPath $p -Force -ErrorAction Stop).GetAccessControl();$r=@($a.Access|%{$s=$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;[ordered]@{sid=[string]$s;type=[string]$_.AccessControlType;rights=[int64]$_.FileSystemRights;inherited=[bool]$_.IsInherited;inheritance=[int]$_.InheritanceFlags;propagation=[int]$_.PropagationFlags}}|sort sid,type,rights,inherited,inheritance,propagation);[ordered]@{owner=[string]$a.GetOwner([Security.Principal.SecurityIdentifier]).Value;current=[string]$i.User.Value;protected=[bool]$a.AreAccessRulesProtected;rules=@($r)}|ConvertTo-Json -Compress -Depth 4";
const aclSet = "$ErrorActionPreference='Stop';$p=[Environment]::GetEnvironmentVariable('SERVICE_LASSO_CUSTODY_TARGET','Process');$i=[Security.Principal.WindowsIdentity]::GetCurrent();$item=Get-Item -LiteralPath $p -Force -ErrorAction Stop;$a=$item.GetAccessControl();$a.SetOwner($i.User);$a.SetAccessRuleProtection($true,$false);@($a.Access)|%{$a.RemoveAccessRuleSpecific($_)};$inh=[Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit';$none=[Security.AccessControl.PropagationFlags]::None;$allow=[Security.AccessControl.AccessControlType]::Allow;@($i.User.Value,'S-1-5-18','S-1-5-32-544')|Select-Object -Unique|%{$a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($_,[Security.AccessControl.FileSystemRights]::FullControl,$inh,$none,$allow)))};$item.SetAccessControl($a);[ordered]@{applied=$true}|ConvertTo-Json -Compress";
export function validAcl(proof) { if (!exact(proof, ["owner", "current", "protected", "rules"]) || proof.owner !== proof.current || typeof proof.current !== "string" || !/^S-1-[0-9]+(?:-[0-9]+)+$/u.test(proof.current) || proof.protected !== true || !Array.isArray(proof.rules)) return false; const trusted = new Set([proof.current, SYSTEM, ADMINS]); return proof.rules.length === trusted.size && proof.rules.every(rule => exact(rule, ["sid", "type", "rights", "inherited", "inheritance", "propagation"]) && trusted.has(rule.sid) && rule.type === "Allow" && rule.rights === 2032127 && rule.inherited === false && rule.inheritance === 3 && rule.propagation === 0) && new Set(proof.rules.map(rule => rule.sid)).size === trusted.size; }
async function windowsAcl(directory) { const proof = await psJson(directory, "acl_read", "first_custody_windows_acl_probe_invalid"); if (!validAcl(proof)) throw new Error("first_custody_windows_acl_not_exclusive"); return { checked: true, tool: "windows_sid_dacl", ownerSid: proof.owner, currentSid: proof.current, rules: proof.rules }; }
const reparseRead = "$ErrorActionPreference='Stop';$p=[Environment]::GetEnvironmentVariable('SERVICE_LASSO_CUSTODY_TARGET','Process');$i=Get-Item -LiteralPath $p -Force -ErrorAction Stop;$r=($i.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0;if($r){throw 'reparse_parent'};[ordered]@{attributes=[int64]$i.Attributes;reparse=$false;tag=$null}|ConvertTo-Json -Compress";
async function windowsReparse(directory) { const result = await psJson(directory, "reparse", "first_custody_windows_reparse_probe_invalid"); if (!exact(result, ["attributes", "reparse", "tag"]) || typeof result.reparse !== "boolean" || !Number.isSafeInteger(result.attributes) || (result.attributes&16)===0 || (result.attributes&1024)!==0 || (result.reparse ? typeof result.tag !== "string" : result.tag !== null) || result.reparse) throw new Error("first_custody_windows_reparse_parent"); }
export async function chain(directory, boundary) { const target = path.resolve(directory), root = path.resolve(boundary); if (!inside(target, root)) throw new Error("first_custody_boundary_escape"); const resolvedRoot = await realpath(root), entries=[]; for (let cursor=target;;cursor=path.dirname(cursor)) { const entry=await lstat(cursor,{bigint:true}); if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("first_custody_reparse_parent"); if (process.platform === "win32") await windowsReparse(cursor); const resolved=await realpath(cursor); if (!inside(resolved,resolvedRoot)) throw new Error("first_custody_realpath_escape"); entries.push({cursor,resolved,identity:directoryIdentity(entry),uid:entry.uid,gid:entry.gid,mode:entry.mode}); if(cursor===root)return {entries}; if(cursor===path.dirname(cursor))throw new Error("first_custody_parent_boundary_escape"); } }
export async function recheck(snapshot) { for (const item of snapshot.entries) { const now=await lstat(item.cursor,{bigint:true}); if(!now.isDirectory()||now.isSymbolicLink()||!sameDirectoryIdentity(item.identity,directoryIdentity(now))||item.uid!==now.uid||item.gid!==now.gid||item.mode!==now.mode)throw new Error("first_custody_parent_replaced"); if(process.platform==="win32")await windowsReparse(item.cursor); if(await realpath(item.cursor)!==item.resolved)throw new Error("first_custody_parent_realpath_replaced"); } }
export async function nonReparseDirectory(directory,boundary) { await recheck(await chain(directory,boundary)); }
export async function ownership(directory,boundary) { const snapshot=await chain(directory,boundary), entry=await stat(directory,{bigint:true}), resolved=await realpath(directory), acl=process.platform==="win32"?await windowsAcl(resolved):{checked:true,tool:"posix",rawSha256:null}; if(process.platform!=="win32"&&(entry.mode&0o077n)!==0n)throw new Error("first_custody_acl_not_private"); await recheck(snapshot); return {path:resolved,uid:nativeOwnerNumber(entry.uid),gid:nativeOwnerNumber(entry.gid),mode:nativeOwnerNumber(entry.mode&0o777n),acl,identity:directoryIdentity(entry)}; }
export async function createExclusiveDirectory(directory,boundary) { const target=path.resolve(directory); if(!inside(target,boundary))throw new Error("first_custody_owned_root_escape"); if(await lstat(target,{bigint:true}).catch(error=>error.code==="ENOENT"?null:Promise.reject(error)))throw new Error("first_custody_owned_root_exists"); const parents=await chain(path.dirname(target),boundary); await mkdir(target,{mode:0o700}); if(process.platform==="win32")await psJson(target,"acl_set","first_custody_windows_acl_set_failed"); await recheck(parents); return ownership(target,boundary); }
export async function absentLeaf(file,boundary) { const target=path.resolve(file), parents=await chain(path.dirname(target),boundary); if(await lstat(target,{bigint:true}).catch(error=>error.code==="ENOENT"?null:Promise.reject(error)))throw new Error("first_custody_registry_present"); await recheck(parents); return {path:target,state:"ABSENT",parent:await ownership(path.dirname(target),boundary)}; }
export async function regularClosedBytes(file,root,io={open}) { const target=path.resolve(file), boundary=path.resolve(root); if(!inside(target,boundary))throw new Error("first_custody_boundary_escape"); const parents=await chain(path.dirname(target),boundary), beforePath=await lstat(target,{bigint:true}); if(!beforePath.isFile()||beforePath.isSymbolicLink())throw new Error("first_custody_nonregular_or_reparse_file"); const handle=await io.open(target,"r"); let bytes; try { const before=await handle.stat({bigint:true}); if(!before.isFile()||!sameIdentity(identity(beforePath),identity(before)))throw new Error("first_custody_held_not_named_file"); const chunks=[],block=Buffer.allocUnsafe(65536); for(;;){const {bytesRead}=await handle.read(block,0,block.length,null);if(!bytesRead)break;chunks.push(Buffer.from(block.subarray(0,bytesRead)));} const after=await handle.stat({bigint:true});if(!sameIdentity(identity(before),identity(after)))throw new Error("first_custody_held_file_changed_during_hash");bytes=Buffer.concat(chunks);if(BigInt(bytes.length)!==before.size)throw new Error("first_custody_held_file_length_mismatch");}finally{await handle.close();} await recheck(parents);const afterPath=await lstat(target,{bigint:true});if(!afterPath.isFile()||afterPath.isSymbolicLink()||!sameIdentity(identity(beforePath),identity(afterPath)))throw new Error("first_custody_path_swapped_during_hash");return bytes; }
export async function regularClosedFile(file,root) { const bytes=await regularClosedBytes(file,root);return {size:bytes.length,sha256:sha256(bytes)}; }
async function exclusiveWrite(file,value,root,io={open}) { const target=path.resolve(file),parents=await chain(path.dirname(target),root);if(await lstat(target,{bigint:true}).catch(error=>error.code==="ENOENT"?null:Promise.reject(error)))throw new Error("first_custody_output_exists");const handle=await io.open(target,"wx",0o600);try{await handle.writeFile(value);await handle.sync();const held=await handle.stat({bigint:true}),named=await lstat(target,{bigint:true});if(!held.isFile()||!named.isFile()||named.isSymbolicLink()||!sameIdentity(identity(held),identity(named)))throw new Error("first_custody_output_path_swapped");await recheck(parents);}finally{await handle.close();}await recheck(parents);return regularClosedFile(target,root); }
export async function exclusiveJson(file,value,root,io={open}) { return exclusiveWrite(file,JSON.stringify(value)+"\n",root,io); }
export async function exclusiveBytes(file,value,root) { return exclusiveWrite(file,value,root); }
// The terminal seal is written after all native bootstrap probes have naturally
// closed. Its own write uses held/named FS identities and the retained physical
// parent snapshot, so sealing does not generate another unrecorded native probe.
export async function sealBootstrap(privateRoot, receiptPath, journalPath, fileName="bootstrap-seal.json", io={open}) {
  if (bootstrap === null) throw new Error("first_custody_bootstrap_not_started");
  const receipt = await regularClosedBytes(receiptPath, path.dirname(receiptPath)), journal = await regularClosedBytes(journalPath, privateRoot), snapshot = await chain(privateRoot, privateRoot);
  await recheck(snapshot);
  const records = bootstrap;let session;
  try {
    // An in-process fault observer may operate only on the actual owned child;
    // it cannot supply or replace the terminal result. Production has no hook.
    if(io.beforeTerminal)try{await io.beforeTerminal(bootstrapSession);}catch(error){
      if(bootstrapSession)try{await closeBootstrapSession(bootstrapSession);}catch(closure){throw new AggregateError([error,closure],"first_custody_bootstrap_fault_observer_and_terminal_failure");}
      throw error;
    }
    session=bootstrapSession===null?null:await closeBootstrapSession(bootstrapSession);
  } finally { bootstrap=null;bootstrapSession=null; }
  const bytes = Buffer.from(JSON.stringify({ schema: "service-lasso.qualification-bootstrap-seal.v1", private: true, receiptSha256: sha256(receipt), journalSha256: sha256(journal), session, commands: records }) + "\n");
  const target = path.join(privateRoot, fileName), handle = await io.open(target, "wx", 0o600);
  async function physicalRecheck() { for (const item of snapshot.entries) { const now = await lstat(item.cursor,{bigint:true}); if (!now.isDirectory() || now.isSymbolicLink() || !sameDirectoryIdentity(item.identity, directoryIdentity(now)) || now.uid !== item.uid || now.gid !== item.gid || now.mode !== item.mode || await realpath(item.cursor) !== item.resolved) throw new Error("first_custody_bootstrap_seal_parent_changed"); } }
  try { await physicalRecheck(); await handle.writeFile(bytes); await handle.sync(); const held = await handle.stat({bigint:true}), named = await lstat(target,{bigint:true}); if (!held.isFile() || !named.isFile() || named.isSymbolicLink() || !sameIdentity(identity(held), identity(named))) throw new Error("first_custody_bootstrap_seal_path_changed"); await physicalRecheck(); } finally { await handle.close(); }
  await physicalRecheck();
}
// All bytes and native probes are completed privately. The exclusive hard link
// is the final public commit point: there is no partial public write or later
// validation/fsync that could fail after validated:true becomes consumable.
export async function publishAfterBootstrap(privateRoot, output, value, journalPath, evidenceRoot, io={open,link}) {
  try {
    const staged=path.join(privateRoot,"validator-projection.staged.json");
    await exclusiveJson(staged,value,privateRoot,io);
    const outputParents=await imageParents(output),stagedParents=await imageParents(staged);
    const stagedState=await lstat(staged,{bigint:true});
    await sealBootstrap(privateRoot,staged,journalPath,"validator-bootstrap-seal.json",io);
    await recheckImageParents(stagedParents);await recheckImageParents(outputParents);
    const current=await lstat(staged,{bigint:true});
    if(!current.isFile()||current.isSymbolicLink()||!sameIdentity(identity(stagedState),identity(current))||!inside(output,evidenceRoot)||path.dirname(output)!==evidenceRoot)throw new Error("first_custody_validator_staged_projection_changed");
    // link fails exclusively if the public name already exists and cannot expose
    // partially written bytes. Retain the private staging inode as evidence.
    await io.link(staged,output);
  } catch(error) {
    // A private staging failure must still naturally settle our owned session.
    // Keep the original error primary; never signal or publish on failure.
    const session=bootstrapSession;bootstrap=null;bootstrapSession=null;
    if(session)try{await closeBootstrapSession(session);}catch(closure){throw new AggregateError([error,closure],"first_custody_validator_private_failure_and_terminal_failure");}
    throw error;
  }
}
// This proves only the fixed dyld header, never the complete cache or libproc file.
// Parent snapshots detect replacement; they are not an atomic directory anchor.
export async function darwinCacheHeader(file) {
  const target = path.resolve(file), boundary = path.parse(target).root;
  if (target !== file || await realpath(target) !== target) throw new Error("first_custody_darwin_cache_alias");
  const parents = await chain(path.dirname(target), boundary);
  const secureParents = async () => {
    await recheck(parents);
    for (const item of parents.entries) {
      const entry = await lstat(item.cursor,{bigint:true});
      if (entry.uid !== 0n || (entry.mode & 0o022n) !== 0n) throw new Error("first_custody_darwin_cache_parent_not_os_owned");
    }
  };
  await secureParents();
  const named = await lstat(target,{bigint:true});
  if (!named.isFile() || named.isSymbolicLink() || named.uid !== 0n || (named.mode & 0o022n) !== 0n) throw new Error("first_custody_darwin_cache_not_os_owned");
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  let header;
  try {
    const held = await handle.stat({bigint:true});
    if (!held.isFile() || !sameIdentity(identity(named), identity(held)) || held.uid !== 0n || (held.mode & 0o022n) !== 0n) throw new Error("first_custody_darwin_cache_held_identity");
    header = Buffer.alloc(104);
    let offset = 0;
    while (offset < header.length) {
      const { bytesRead } = await handle.read(header, offset, header.length - offset, offset);
      if (!bytesRead) throw new Error("first_custody_darwin_cache_short_header");
      offset += bytesRead;
    }
    const after = await handle.stat({bigint:true});
    if (!sameIdentity(identity(held), identity(after)) || after.uid !== held.uid || after.mode !== held.mode) throw new Error("first_custody_darwin_cache_changed");
    if (header.subarray(0, 5).toString("ascii") !== "dyld_") throw new Error("first_custody_darwin_cache_magic");
    await secureParents();
    const current = await lstat(target,{bigint:true});
    if (!sameIdentity(identity(held), identity(current)) || current.uid !== held.uid || current.mode !== held.mode || await realpath(target) !== target) throw new Error("first_custody_darwin_cache_replaced");
  } finally { await handle.close(); }
  await secureParents();
  return { uuid: header.subarray(88, 104).toString("hex"), sha256: sha256(header) };
}

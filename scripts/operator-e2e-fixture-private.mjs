// Reusable ordinary test privacy setup. Importing this module has no IO effects.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,lstat,realpath,open,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const run = promisify(execFile);
const setup = fileURLToPath(new URL('./operator-e2e-fixture-private-dir.ps1',import.meta.url));
const samePath = (a,b) => process.platform==='win32' ? path.normalize(a).toLowerCase()===path.normalize(b).toLowerCase() : a===b;

async function noRedirectedPath(target) {
  if(!path.isAbsolute(target)||!samePath(path.resolve(target),target)||!samePath(await realpath(target),target))throw Error('Private path must be canonical');
  let current=target;
  for(;;){const entry=await lstat(current);if(entry.isSymbolicLink())throw Error('Private path is redirected');const parent=path.dirname(current);if(parent===current)break;current=parent;}
}
async function windows(mode,target) {
  const systemRoot=process.env.SystemRoot;
  if(!systemRoot||!path.win32.isAbsolute(systemRoot))throw Error('Windows private setup system path is unavailable');
  const executable=path.win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  try {
    const operation=run(executable,['-NoLogo','-NoProfile','-NonInteractive','-File',setup,'-Mode',mode,'-Target',target],{
      windowsHide:true,timeout:15000,maxBuffer:32768,
      env:{SystemRoot:systemRoot,WINDIR:systemRoot,PATH:path.win32.join(systemRoot,'System32')},
    });
    operation.child.stdin.end();
    const {stdout}=await operation;
    const observed=JSON.parse(stdout);
    if(observed?.verified!==true||observed.platform!=='win32'||observed.policy!=='current-owner-and-system')throw Error('Unverified private setup');
    return observed;
  }catch(error){const code=/^(?:[A-Z_]+|[0-9]+)$/.test(String(error.code))?String(error.code):'unknown';const signal=/^SIG[A-Z]+$/.test(error.signal??'')?error.signal:'none';const stages=[...String(error.stderr??'').matchAll(/ORDINARY_PRIVATE_STAGE:(entry|identity|create|created|ancestors|readback|complete)/g)].map(value=>value[1]);const stage=stages.at(-1)??'startup';const safe=Error(`Ordinary fixture Windows private setup failed (${mode}; stage=${stage}; code=${code}; signal=${signal}; terminated=${error.killed===true})`);safe.code='ordinary_fixture_windows_private_setup';throw safe;}
}
async function verifyObject(target,directory) {
  await noRedirectedPath(target);
  const entry=await lstat(target);
  if(directory?!entry.isDirectory():!entry.isFile())throw Error('Private object has wrong kind');
  if(process.platform==='win32')return windows(directory?'verify-directory':'verify-file',target);
  const mode=directory?0o700:0o600;
  if(entry.uid!==process.getuid()||(entry.mode&0o777)!==mode)throw Error('Ordinary fixture POSIX private permissions failed');
  return {platform:process.platform,policy:'current-owner-mode',uid:entry.uid,mode,verified:true};
}
export async function createPrivateDirectory(target) {
  if(!path.isAbsolute(target))throw Error('Absolute private directory required');
  await noRedirectedPath(path.dirname(target));
  if(process.platform==='win32'){const observed=await windows('create-directory',target);await noRedirectedPath(target);return observed;}
  await mkdir(target,{mode:0o700});return verifyObject(target,true);
}
export async function verifyPrivateDirectory(target) {return verifyObject(target,true);}
export async function verifyPrivateFile(target) {return verifyObject(target,false);}
export async function writePrivateFile(file,value) {
  if(typeof value!=='string'&&!(value instanceof Uint8Array))throw Error('Ordinary private file requires bytes or text');
  const length=typeof value==='string'?Buffer.byteLength(value):value.byteLength;
  if(length>8*1024*1024)throw Error('Ordinary private file exceeds limit');
  const parent=path.dirname(file);
  await verifyPrivateDirectory(parent);
  // Always copy: erasing our owned working bytes must not modify the caller.
  const bytes=Buffer.from(value);
  let handle;
  try {
    handle=await open(file,'wx',0o600);
    if(process.platform==='win32')await windows('prepare-empty-file',file);
    await verifyPrivateFile(file); // Empty file owner/ACL is observed before data.
    const before=await handle.stat();
    await handle.writeFile(bytes);await handle.sync();
    const after=await lstat(file);
    if(after.isSymbolicLink()||!after.isFile()||before.dev!==after.dev||before.ino!==after.ino)throw Error('Private file identity changed');
    await verifyPrivateDirectory(parent);await verifyPrivateFile(file);
  }catch(error){if(handle)await unlink(file).catch(()=>{});throw error;}
  finally{bytes.fill(0);await handle?.close();}
}
export async function writePrivateJsonFile(file,value) {
  const bytes=Buffer.from(JSON.stringify(value)+'\n');
  try {
    if(bytes.length>1024*1024)throw Error('Ordinary private JSON exceeds limit');
    await writePrivateFile(file,bytes);
  }finally{bytes.fill(0);}
}

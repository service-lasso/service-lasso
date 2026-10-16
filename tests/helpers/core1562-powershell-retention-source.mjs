// Selected supplementary F25 witness. Only the official parser child interprets
// PowerShell. No handwritten lexer, source snapshot, hash oracle or fallback.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./core1562-powershell-retention-ast.ps1', import.meta.url));
const cwd = fileURLToPath(new URL('../../', import.meta.url));
const file = 'scripts/verify-windows-managed-launcher-bootstrap.ps1';
const denials = new WeakSet();
export const isF25AstRejection = error => error !== null && typeof error === 'object' && denials.has(error);
const privateFailures = new WeakMap();
const infrastructure = () => new Error('F25 actual parser/owned transport is unavailable or invalid.');
function ownedFailure(stage, original) {
  const failure = infrastructure();
  privateFailures.set(failure, { primary: original, originals: [{ stage, original }] });
  return failure;
}
export function f25ClosedFailureDiagnostic(error) {
  const owner = error !== null && typeof error === 'object' ? privateFailures.get(error) : undefined;
  if (!owner) return undefined;
  const result = { schema: 'core1562.f25.transport-failure.v1', stages: owner.originals.map(row => row.stage), count: owner.originals.length };
  if (owner.receipt) {
    const r = owner.receipt;
    result.closure = { code: r.code, signal: r.signal, delivered: r.delivered, stdinFinish: r.stdinFinish,
      stdoutEnd: r.stdoutEnd, stderrEnd: r.stderrEnd, exitObserved: r.exitObserved,
      stdoutBytes: r.stdout.length, stderrBytes: r.stderr.length };
  }
  return result;
}
export function decodeF25AstResponse(bytes, digest, exitCode) {
  let text, result;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); result = JSON.parse(text); }
  catch (original) { throw ownedFailure('response_decode', original); }
  const keys = ['schema', 'status', 'sourceSha256', 'reason'];
  if (!result || Object.getPrototypeOf(result) !== Object.prototype ||
      JSON.stringify(Object.keys(result)) !== JSON.stringify(keys) ||
      `${JSON.stringify(result)}\n` !== text || result.schema !== 'core1562.f25.ast-result.v1' ||
      result.sourceSha256 !== digest ||
      !(exitCode === 0 && result.status === 'conformant' && result.reason === 'none' ||
        exitCode === 2 && result.status === 'rejected' && ['parse_error', 'shape_mismatch'].includes(result.reason))) {
    throw ownedFailure('response_shape', { bytes: Buffer.from(bytes), digest, exitCode });
  }
  return result;
}
// Pure receipt validator for transport adversaries. It cannot authenticate a
// source denial: only check() after the actual owned child can do that.
export function validateF25AstClosure(receipt) {
  const { delivered, stdinFinish, stdoutEnd, stderrEnd, exitObserved,
    exitCode, exitSignal, code, signal, stderr } = receipt;
  if (!delivered || !stdinFinish || !stdoutEnd || !stderrEnd || !exitObserved ||
      exitCode !== code || exitSignal !== signal || signal !== null ||
      !Buffer.isBuffer(stderr) || stderr.length !== 0 || ![0, 2].includes(code)) {
    const failure = ownedFailure('closure', receipt);
    throw failure;
  }
}
function configuration() {
  // Fixed platform recipes only. Actual physical tool/runtime/environment
  // qualification belongs to NEW external ROOT, never an environment selector.
  const temp = path.join(cwd, '.tmp', 'f25-ast-runtime');
  if (process.platform === 'win32') return { executable: 'C:/Program Files/PowerShell/7/pwsh.exe', env: {
    SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    TEMP: temp, TMP: temp, PATH: 'C:\\Windows\\System32', PSModulePath: '',
  } };
  if (process.platform === 'linux') return { executable: '/opt/microsoft/powershell/7/pwsh', env: {
    TEMP: temp, TMP: temp, PATH: '/usr/bin:/bin', PSModulePath: '',
  } };
  throw infrastructure();
}
async function check(source) {
  let bytes;
  if (typeof source === 'string') {
    if (!source.isWellFormed()) throw infrastructure();
    bytes = Buffer.from(source, 'utf8');
  } else if (Buffer.isBuffer(source)) {
    bytes = Buffer.from(source);
  } else throw infrastructure();
  try { new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch (original) { throw ownedFailure('source_decode', original); }
  const digest = createHash('sha256').update(bytes).digest('hex');
  const input = Buffer.from(`${JSON.stringify({ schema: 'core1562.f25.ast-input.v1', sourceFile: file,
    sourceByteLength: bytes.length, sourceSha256: digest, sourceBase64: bytes.toString('base64') })}\n`, 'utf8');
  const result = await observeF25AstFrame(input, digest);
  if (result.status === 'rejected') {
    const denial = new Error(`F25 selected source rejected: ${result.reason}`);
    denials.add(denial); throw denial;
  }
}
// Raw frame seam exercises the same fixed owned child. It never authenticates
// source denials and cannot select a different executable, script or environment.
export async function observeF25AstFrame(input, digest) {
  if (!Buffer.isBuffer(input) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/u.test(digest)) throw infrastructure();
  const { executable, env } = configuration();
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script], {
      cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    }); } catch (original) { reject(ownedFailure('spawn', original)); return; }
    let failure, delivered = false, stdoutEnd = false, stderrEnd = false, stdinFinish = false, exitObserved = false, exitCode, exitSignal;
    const stdout = [], stderr = [];
    const fail = (stage, original) => {
      if (!failure) failure = ownedFailure(stage, original);
      else privateFailures.get(failure).originals.push({ stage, original });
    };
    // No adapter-owned timer/cancellation/retry. External admitted supervision
    // retains its original bound/authority; this promise requires real closure.
    child.once('error', original => fail('spawn', original));
    child.stdin.once('error', original => fail('stdin', original));
    child.stdin.once('finish', () => { stdinFinish = true; });
    child.stdout.once('error', original => fail('stdout', original));
    child.stderr.once('error', original => fail('stderr', original));
    child.stdout.once('end', () => { stdoutEnd = true; }); child.stderr.once('end', () => { stderrEnd = true; });
    child.stdout.on('data', chunk => { stdout.push(chunk); });
    child.stderr.on('data', chunk => { stderr.push(chunk); });
    child.once('exit', (code, signal) => { exitObserved = true; exitCode = code; exitSignal = signal; });
    child.once('close', (code, signal) => {
      const receipt = { delivered, stdinFinish, stdoutEnd, stderrEnd, exitObserved, exitCode, exitSignal, code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
      try { validateF25AstClosure(receipt); } catch (original) {
        if (!failure) failure = original;
        else privateFailures.get(failure).originals.push({ stage: 'closure', original });
      }
      if (failure) { privateFailures.get(failure).receipt = receipt; reject(failure); return; }
      try { resolve(decodeF25AstResponse(Buffer.concat(stdout), digest, code)); } catch (error) { reject(error); }
    });
    try { child.stdin.end(input, error => { if (error) fail('stdin_end', error); else delivered = true; }); } catch (original) { fail('stdin_end', original); }
  });
}
export const assertPowerShellOriginalRetention = check;
export const assertPowerShellRecorderReleaseRetention = check;

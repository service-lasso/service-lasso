// Selected supplementary F25 witness. Only the official parser child interprets
// PowerShell. No handwritten lexer, source snapshot, hash oracle or fallback.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createF25PrivateTemp } from './core1562-f25-private-temp.mjs';
import { F25_INFRASTRUCTURE_CASES, prepareF25InfrastructureFixture } from './core1562-f25-infrastructure-fixtures.mjs';
const script = fileURLToPath(new URL('./core1562-powershell-retention-bootstrap.ps1', import.meta.url));
const cwd = fileURLToPath(new URL('../../', import.meta.url));
const file = 'scripts/verify-windows-managed-launcher-bootstrap.ps1';
const denials = new WeakSet();
export const isF25AstRejection = error => error !== null && typeof error === 'object' && denials.has(error);
const privateFailures = new WeakMap();
const actualChildFailures = new WeakSet();
export const F25_INFRASTRUCTURE_OPERATIONS = Object.freeze(['bootstrap_setup', 'witness_invocation', 'witness_exit',
  'source_read', 'source_decode', 'source_frame', 'source_integrity', 'catalogue_read', 'catalogue_decode', 'catalogue_shape',
  'target_parse', 'semantic_match', 'response_encode', 'response_open', 'response_write', 'response_flush']);
export const F25_STDOUT_LIMIT = 4096;
export const F25_STDERR_LIMIT = 16384;
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
    result.firstReason = owner.firstReason;
    if (actualChildFailures.has(error) && owner.childOperation) result.childOperation = owner.childOperation;
  }
  return result;
}
// Correspondence only for event-driven surrogate assertions. This cannot mint
// the actual-child observation or a source denial.
export function f25TransportFailureObservation(error) {
  const owner = error !== null && typeof error === 'object' ? privateFailures.get(error) : undefined;
  return owner?.receipt ? { firstReason: owner.firstReason, childOperation: owner.childOperation } : undefined;
}
// Identity-only assertion seam: no raw original, getter, cause or diagnostic
// text crosses the private owner boundary.
export function f25FailureHasOriginals(error, originals, trailingClosure = false) {
  const owner = error !== null && typeof error === 'object' ? privateFailures.get(error) : undefined;
  return !!owner && owner.primary === originals[0] && owner.originals.length === originals.length + (trailingClosure ? 1 : 0) &&
    originals.every((original, index) => owner.originals[index].original === original) &&
    (!trailingClosure || owner.originals.at(-1).stage === 'closure');
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
function configuration(temp) {
  // Fixed platform recipes only. Actual physical tool/runtime/environment
  // qualification belongs to NEW external ROOT, never an environment selector.
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
  return runOwnedF25Frame(input, digest, null);
}
// Finite actual-tool infrastructure fixtures only. This does not accept a
// script/executable/environment operand and cannot authenticate source denials.
export async function observeF25InfrastructureFixture(name, input, digest) {
  if (!F25_INFRASTRUCTURE_CASES.some(row => row.name === name)) throw infrastructure();
  return runOwnedF25Frame(input, digest, name);
}
async function runOwnedF25Frame(input, digest, fixture) {
  if (!Buffer.isBuffer(input) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/u.test(digest)) throw infrastructure();
  let temp;
  try { temp = await createF25PrivateTemp(); } catch (original) { throw ownedFailure('temp_acquire', original); }
  let failed = false, failure, result;
  try {
    result = await temp.borrow(async () => {
      const { executable, env } = configuration(temp.root);
      const selectedScript = fixture === null ? script : await prepareF25InfrastructureFixture(temp.root, fixture);
      let child;
      try { child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', selectedScript], {
          cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      }); } catch (original) { throw ownedFailure('spawn', original); }
      try { return await collectF25AstChild(child, input, digest); }
      catch (original) {
        if (privateFailures.has(original)) actualChildFailures.add(original);
        throw original;
      }
    });
  } catch (original) {
    failed = true; failure = privateFailures.has(original) ? original : ownedFailure('temp_borrow', original);
  }
  try { await temp.settle(!failed); }
  catch (original) {
    if (!failed) { failed = true; failure = ownedFailure('temp_settlement', original); }
    else privateFailures.get(failure).originals.push({ stage: 'temp_settlement', original });
  }
  if (failed) { privateFailures.get(failure).tempOwner = temp; throw failure; }
  return result;
}
// Event-driven collector shared with explicitly labelled transport surrogates.
// It cannot select tools or authenticate a source denial. Only check() after
// its fixed actual spawn owns the private denial issuer.
export function collectF25AstChild(child, input, digest) {
  return new Promise((resolve, reject) => {
    let failure, delivered = false, stdoutEnd = false, stderrEnd = false, stdinFinish = false, exitObserved = false, exitCode, exitSignal;
    let firstReasonRecorded = false, firstReason, stdoutInvalid = false, stderrInvalid = false, callbackRecorded = false;
    let stdoutCount = 0, stderrCount = 0, stdoutOverflow = false, stderrOverflow = false, stderrPresent = false;
    const stdout = [], stderr = [];
    const reason = value => { if (!firstReasonRecorded) { firstReasonRecorded = true; firstReason = value; } };
    const fail = (stage, original, classification = stage) => {
      reason(classification);
      if (!failure) failure = ownedFailure(stage, original);
      else privateFailures.get(failure).originals.push({ stage, original });
    };
    // No adapter-owned timer/cancellation/retry. External admitted supervision
    // retains its original bound/authority; this promise requires real closure.
    child.on('error', original => fail('spawn', original));
    child.stdin.on('error', original => fail('stdin', original));
    child.stdin.once('finish', () => { stdinFinish = true; });
    child.stdout.on('error', original => { stdoutInvalid = true; fail('stdout', original, 'stdout_error'); });
    child.stderr.on('error', original => fail('stderr', original, 'stderr_error'));
    child.stdout.once('end', () => { stdoutEnd = true; }); child.stderr.once('end', () => { stderrEnd = true; });
    child.stdout.on('data', chunk => {
      try {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), remaining = Math.max(0, F25_STDOUT_LIMIT - stdoutCount);
        if (bytes.length && stdoutEnd) { stdoutInvalid = true; fail('stdout', new Error('F25 stdout data followed EOF.'), 'stdout_error'); }
        if (remaining && bytes.length) stdout.push(Buffer.from(bytes.subarray(0, remaining)));
        stdoutCount = Math.min(Number.MAX_SAFE_INTEGER, stdoutCount + bytes.length);
        if (stdoutCount > F25_STDOUT_LIMIT && !stdoutOverflow) {
          stdoutOverflow = true; stdoutInvalid = true; fail('stdout_overflow', new Error('F25 stdout bound exceeded.'));
        }
      } catch (original) { stdoutInvalid = true; fail('stdout', original, 'stdout_error'); }
    });
    child.stderr.on('data', chunk => {
      try {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), remaining = Math.max(0, F25_STDERR_LIMIT - stderrCount);
        if (bytes.length && stderrEnd) { stderrInvalid = true; fail('stderr', new Error('F25 stderr data followed EOF.'), 'stderr_error'); }
        if (remaining && bytes.length) stderr.push(Buffer.from(bytes.subarray(0, remaining)));
        stderrCount = Math.min(Number.MAX_SAFE_INTEGER, stderrCount + bytes.length);
        if (bytes.length && !stderrPresent) { stderrPresent = true; fail('stderr_present', new Error('F25 private stderr rejected.')); }
        if (stderrCount > F25_STDERR_LIMIT && !stderrOverflow) {
          stderrOverflow = true; fail('stderr_overflow', new Error('F25 stderr bound exceeded.'));
        }
      } catch (original) { fail('stderr', original, 'stderr_error'); }
    });
    child.once('exit', (code, signal) => { exitObserved = true; exitCode = code; exitSignal = signal; });
    child.once('close', (code, signal) => {
      const receipt = { delivered, stdinFinish, stdoutEnd, stderrEnd, exitObserved, exitCode, exitSignal, code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
      if (!delivered) reason('stdin_end');
      else if (!stdinFinish) reason('stdin_finish_missing');
      else if (!stdoutEnd) reason('stdout_end_missing');
      else if (!stderrEnd) reason('stderr_end_missing');
      else if (!exitObserved) reason('exit_missing');
      else if (exitCode !== code || exitSignal !== signal) reason('exit_mismatch');
      else if (signal !== null) reason('exit_signal');
      else if (![0, 2].includes(code)) reason('exit_unexpected');
      try { validateF25AstClosure(receipt); } catch (original) {
        if (!failure) failure = original;
        else privateFailures.get(failure).originals.push({ stage: 'closure', original });
      }
      if (failure) {
        const owner = privateFailures.get(failure);
        owner.receipt = receipt; owner.firstReason = firstReason;
        // Negative correspondence survives stderr-first only after complete
        // strict stdout, EOF, matching exit and actual close. Never a result.
        if (!stdoutInvalid && !stderrInvalid && !stdoutOverflow && stdoutEnd && stderrEnd && delivered && stdinFinish &&
            exitObserved && exitCode === code && exitSignal === signal && signal === null && code === 3 && receipt.stdout.length <= 128) {
          const text = receipt.stdout.toString('ascii');
          const operation = F25_INFRASTRUCTURE_OPERATIONS.find(value => text === `F25I1|${value}\n`);
          if (operation && receipt.stdout.every(byte => byte < 128)) owner.childOperation = operation;
        }
        reject(failure); return;
      }
      try { resolve(decodeF25AstResponse(receipt.stdout, digest, code)); }
      catch (original) {
        const owner = privateFailures.get(original);
        if (owner) { owner.receipt = receipt; owner.firstReason = owner.originals[0].stage === 'response_decode' ? 'frame_decode' : 'frame_shape'; }
        reject(original);
      }
    });
    try { child.stdin.end(input, error => {
      if (callbackRecorded) { fail('stdin_end', new Error('F25 input callback repeated.')); return; }
      callbackRecorded = true;
      if (error !== null && error !== undefined) fail('stdin_end', error); else delivered = true;
    }); } catch (original) { fail('stdin_end', original); }
  });
}
export const assertPowerShellOriginalRetention = check;
export const assertPowerShellRecorderReleaseRetention = check;

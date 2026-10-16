import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { inspectProcess } from "../dist/runtime/process/identity.js";
import { collectDiagnosticHoldTransport, encodeGuardianCommand, acquireDiagnosticHoldCorrespondence } from "./fixture-diagnostic-hold-protocol.js";

const observationByError = new WeakMap();
const privateReceiptByError = new WeakMap();
export function diagnosticHoldFailureObservation(error) {
  return error !== null && (typeof error === "object" || typeof error === "function") ? observationByError.get(error) : undefined;
}

// Only this actual fixed spawn path can record provenance; shared transport
// surrogates expose correspondence only, never this private WeakMap writer.
export async function holdDiagnosticRootWindows(root, diagnosticRoot) {
  const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await readFile(new URL("./fixture-diagnostic-hold.ps1", import.meta.url)));
  const child = spawn("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodeGuardianCommand(source)],
    { windowsHide: true, shell: false, cwd: root, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env,
      SERVICE_LASSO_HELD_FIXTURE_ROOT: root, SERVICE_LASSO_HELD_FIXTURE_ROLE: "diagnostic" } });
  const callerPid = process.pid, transport = collectDiagnosticHoldTransport(child, callerPid);
  let receiptAttempted = false;
  const acquisition = await acquireDiagnosticHoldCorrespondence(transport, child.pid, callerPid, inspectProcess);
  const { nativeIdentity, callerIdentity } = acquisition;
  const retainReceipt = async () => {
    if (receiptAttempted) throw new Error("Diagnostic guardian receipt already attempted.");
    receiptAttempted = true;
    if (!diagnosticRoot) throw new Error("Diagnostic guardian private receipt root unavailable.");
    const state = transport.snapshot();
    const failures = [];
    for (const [name, bytes] of [["stdout", state.stdout], ["stderr", state.stderr]]) {
      try { await writeFile(path.join(diagnosticRoot, `diagnostic-guardian-${name}.bin`), bytes, { flag: "wx", mode: 0o600 }); }
      catch (original) { failures.push(original); }
    }
    try { await writeFile(path.join(diagnosticRoot, "diagnostic-guardian-custody.json"), JSON.stringify({
      callerPid, childPid: child.pid, callerIdentity, nativeIdentity, guardianWitness: state.readyWitness,
      closure: { closed: state.closed, exit: state.exit }, stdoutEof: state.stdoutEof, stderrEof: state.stderrEof,
      stdinFinished: state.stdinFinished, childFailure: state.childFailure, acquireOperation: state.acquireOperation,
      firstTransportReason: state.firstFailureRecorded ? state.firstFailure.reason : undefined,
      stdout: { bytes: state.stdout.length, observedBytes: state.stdoutCount, sha256: createHash("sha256").update(state.stdout).digest("hex") },
      stderr: { bytes: state.stderr.length, observedBytes: state.stderrCount, sha256: createHash("sha256").update(state.stderr).digest("hex") },
    }), { flag: "wx", mode: 0o600 }); } catch (original) { failures.push(original); }
    if (failures.length) throw new AggregateError(failures, "Diagnostic guardian private receipt failed.");
  };
  if (acquisition.failed) {
    const primary = acquisition.original, operationFailure = acquisition.operationFailure;
    const errors = [primary, ...acquisition.observationFailures];
    try { await transport.release(); } catch (original) { errors.push(original); }
    try { await retainReceipt(); } catch (original) { errors.push(original); }
    const aggregate = new AggregateError(errors, "Fixture handle acquisition failed.");
    privateReceiptByError.set(aggregate, transport);
    if (operationFailure && Object.is(operationFailure.original, primary)) {
      const state = transport.failureObservation();
      const transportReason = acquisition.transportFailure && Object.is(acquisition.transportFailure.original, primary)
        ? acquisition.transportFailure.reason : undefined;
      observationByError.set(aggregate, Object.freeze({ operation: operationFailure.operation, childOperation: state.childFailure, acquireOperation: state.acquireOperation, transportReason }));
    }
    throw aggregate;
  }
  return { verify: async () => { await transport.verify(); transport.assertLive(); }, remove: async () => { throw new Error("Fixture writer exclusion is unavailable; original retained."); }, async release() {
    const errors = [];
    try { await transport.release(); } catch (original) { errors.push(original); }
    try { await retainReceipt(); } catch (original) { errors.push(original); }
    if (errors.length) {
      const aggregate = new AggregateError(errors, "Fixture guardian settlement failed.");
      privateReceiptByError.set(aggregate, transport);
      throw aggregate;
    }
  } };
}

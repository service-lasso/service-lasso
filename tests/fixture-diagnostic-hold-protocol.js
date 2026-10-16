export const DIAGNOSTIC_HOLD_PARENT_OPERATIONS = Object.freeze(["ready_receipt", "child_inspection", "caller_inspection"]);
export const DIAGNOSTIC_HOLD_CHILD_OPERATIONS = Object.freeze(["bootstrap", "acquire_chain", "initial_verify", "ready_emit"]);
export const DIAGNOSTIC_HOLD_ACQUIRE_OPERATIONS = Object.freeze(["chain_build", "owner_read", "owner_root", "owner_ancestor", "attributes", "open", "identity", "retain",
  "owner_read_acl_get", "owner_read_owner_get", "owner_read_sid_value"]);
export const DIAGNOSTIC_HOLD_TRANSPORT_REASONS = Object.freeze(["spawn_error", "stdin_error", "stdout_error", "stderr_error",
  "stdin_write", "stdin_end", "callback_state", "stderr_content", "stdout_capacity", "stdout_bytes", "stdout_framing",
  "child_failure_frame", "ready_decode", "stdout_eof", "exit_status", "close_state", "receipt_state", "not_live"]);
export const GUARDIAN_ENCODED_COMMAND_LIMIT = 32600;
export function encodeGuardianCommand(source) {
  const encoded = Buffer.from(source, "utf16le").toString("base64");
  if (!source.length || encoded.length > GUARDIAN_ENCODED_COMMAND_LIMIT) throw new Error("Fixture guardian source capacity rejected.");
  return encoded;
}

// Shared actual-event machinery; receipts from a surrogate never mint native
// provenance. Only the private actual-spawn caller records an owned failure.
export function collectDiagnosticHoldTransport(child, callerPid) {
  const originals = [], stdout = [], stderr = [];
  let stdoutCount = 0, stderrCount = 0, buffer = "", pending, firstFrame = false;
  let readyWitness, childFailureCandidate, acquireFailureCandidate, stdoutInvalid = false, observationClosure = false, closed = false, stdoutEof = false, stderrEof = false, stdinFinished = false, endAttempted = false;
  let exit, close;
  let firstFailureRecorded = false, firstFailure;
  let writes = 0, settleWrites;
  const writesDone = new Promise(resolve => { settleWrites = resolve; });
  const write = (method, text) => {
    writes++;
    let completed = false;
    const done = original => {
      if (completed) { if (original !== undefined && original !== null) failure(method === "write" ? "stdin_write" : "stdin_end", original); reject("callback_state"); return; }
      completed = true; writes--;
      if (original !== undefined && original !== null) failure(method === "write" ? "stdin_write" : "stdin_end", original);
      if (closed && writes === 0) settleWrites();
    };
    try { child.stdin[method](text, done); }
    catch (original) {
      if (!completed) { completed = true; writes--; }
      failure(method === "write" ? "stdin_write" : "stdin_end", original);
      if (closed && writes === 0) settleWrites();
    }
  };
  const recordFailure = (reason, original) => {
    if (!firstFailureRecorded) { firstFailureRecorded = true; firstFailure = { reason, original }; }
    originals.push(original);
  };
  const failure = (reason, original) => { recordFailure(reason, original); pending?.reject(original); pending = undefined; };
  let channelRejected = false;
  const reject = reason => { if (!channelRejected) { channelRejected = true; failure(reason, new Error("Diagnostic guardian channel rejected.")); } };
  const rejectStdout = reason => { stdoutInvalid = true; reject(reason); };
  const observedChildFailure = () => observationClosure && !buffer.length && !stdoutInvalid ? childFailureCandidate : undefined;
  const observedAcquireFailure = () => observedChildFailure() === "acquire_chain" ? acquireFailureCandidate : undefined;
  const closure = new Promise(resolve => { close = resolve; });
  const ready = line => {
    if (firstFrame) return rejectStdout("stdout_framing");
    firstFrame = true;
    if (line.startsWith("GDH1|fail|")) {
      const fields = line.slice("GDH1|fail|".length).split("|"), operation = fields[0];
      if (!DIAGNOSTIC_HOLD_CHILD_OPERATIONS.includes(operation) || fields.length > 2 ||
          (fields.length === 2 && (operation !== "acquire_chain" || !DIAGNOSTIC_HOLD_ACQUIRE_OPERATIONS.includes(fields[1])))) return rejectStdout("stdout_framing");
      childFailureCandidate = operation;
      acquireFailureCandidate = fields.length === 2 ? fields[1] : undefined;
      return reject("child_failure_frame");
    }
    let row;
    try {
      if (!line.startsWith("{") || !line.endsWith("}")) return rejectStdout("stdout_framing");
      // The actual compact producer has four flat literal fields. Admit only
      // that closed ASCII subset, rejecting duplicate/escaped/extra keys before
      // JSON decoding; no generic JSON normalization or nested grammar.
      const fields = line.slice(1, -1).split(",");
      const keys = fields.map(field => {
        const match = /^(?:"(kind|ownerSid)":"[A-Za-z0-9-]+"|"(pid|parentPid)":([1-9][0-9]*))$/.exec(field);
        return match?.[1] ?? match?.[2];
      });
      if (fields.length !== 4 || keys.some(key => key === undefined) || new Set(keys).size !== 4) return rejectStdout("stdout_framing");
      try { row = JSON.parse(line); } catch (original) { stdoutInvalid = true; failure("ready_decode", original); return; }
      if (!row || Array.isArray(row) || Object.keys(row).sort().join(",") !== "kind,ownerSid,parentPid,pid" ||
          row.kind !== "ready" || !Number.isSafeInteger(row.pid) || row.pid < 1 || row.pid !== child.pid ||
          !Number.isSafeInteger(row.parentPid) || row.parentPid < 1 || row.parentPid !== callerPid ||
          typeof row.ownerSid !== "string" || !/^S-[0-9-]{1,184}$/.test(row.ownerSid)) return rejectStdout("stdout_framing");
    } catch (original) { stdoutInvalid = true; failure("ready_decode", original); return; }
    // A prior rejection may leave a useful negative frame, never a ready authority.
    if (!pending || pending.kind !== "ready" || firstFailureRecorded) return rejectStdout("stdout_framing");
    readyWitness = row;
    const waiter = pending; pending = undefined; waiter?.resolve();
  };
  child.stdout.on("data", chunk => {
    const bytes = Buffer.from(chunk);
    stdout.push(bytes.subarray(0, Math.max(0, 480 - stdoutCount))); stdoutCount += bytes.length;
    if (stdoutEof || closed) return rejectStdout("stdout_framing");
    if (stdoutCount > 480) return rejectStdout("stdout_capacity");
    if (bytes.some(byte => byte > 127 || byte === 0 || byte === 13)) return rejectStdout("stdout_bytes");
    buffer += bytes.toString("ascii");
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      if (!firstFrame) ready(line);
      else if (readyWitness && line === "verified" && pending?.kind === "verify") {
        const waiter = pending; pending = undefined; waiter.resolve();
      } else rejectStdout("stdout_framing");
    }
  });
  child.stderr.on("data", chunk => {
    const bytes = Buffer.from(chunk);
    stderr.push(bytes.subarray(0, Math.max(0, 16384 - stderrCount))); stderrCount += bytes.length;
    // ANY stderr fails, including valid failure frames and otherwise ready children.
    reject("stderr_content");
  });
  child.on("error", original => failure("spawn_error", original));
  for (const [stream, reason] of [[child.stdin, "stdin_error"], [child.stdout, "stdout_error"], [child.stderr, "stderr_error"]])
    stream.on("error", original => { if (reason === "stdout_error") stdoutInvalid = true; failure(reason, original); });
  child.stdin.once("finish", () => { stdinFinished = true; });
  child.stdout.once("end", () => { stdoutEof = true; if (buffer.length) stdoutInvalid = true; if (buffer.length || pending) reject("stdout_eof"); });
  child.stderr.once("end", () => { stderrEof = true; });
  child.once("exit", (code, signal) => { exit = { code, signal }; if (code !== 0 || signal !== null) reject("exit_status"); });
  child.once("close", (code, signal) => {
    closed = true;
    observationClosure = stdoutEof && stderrEof && Boolean(exit) && exit.code === code && exit.signal === signal;
    if (pending || buffer.length || !stdoutEof || !stderrEof || !stdinFinished || !exit ||
        code !== 0 || signal !== null || exit.code !== code || exit.signal !== signal) reject("close_state");
    close({ code, signal });
    if (writes === 0) settleWrites();
  });
  const receipt = kind => new Promise((resolve, rejectPromise) => {
    if (originals.length) { rejectPromise(originals[0]); return; }
    if (closed || pending || (kind === "ready" ? firstFrame : !readyWitness)) {
      const original = new Error("Diagnostic guardian receipt unavailable."); recordFailure("receipt_state", original); rejectPromise(original); return;
    }
    pending = { kind, resolve, reject: rejectPromise };
    if (kind === "verify") {
      write("write", "verify\n");
    }
  });
  return {
    ready: () => receipt("ready"), verify: () => receipt("verify"),
    assertLive() {
      if (originals.length) throw originals[0];
      if (closed || exit || stdoutEof || stderrEof) {
        const original = new Error("Diagnostic guardian is not live."); recordFailure("not_live", original); throw original;
      }
    },
    async release() {
      if (!endAttempted) {
        endAttempted = true;
        if (!closed) {
          write("end", "close\n");
        }
      }
      const result = await closure;
      await writesDone;
      if (originals.length) throw new AggregateError([...originals], "Diagnostic guardian settlement failed.");
      return result;
    },
    snapshot() { return { originals: [...originals], firstFailureRecorded, firstFailure: firstFailure && { ...firstFailure }, readyWitness, childFailure: observedChildFailure(), acquireOperation: observedAcquireFailure(), closed, exit,
      stdoutEof, stderrEof, stdinFinished, stdoutCount, stderrCount,
      stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }; },
    failureObservation() { return { firstFailureRecorded, firstFailure: firstFailure && { ...firstFailure }, childFailure: observedChildFailure(), acquireOperation: observedAcquireFailure() }; },
  };
}

// Plain correspondence only. Tests may supply observers here; this function
// cannot write the native caller's private provenance map.
export async function acquireDiagnosticHoldCorrespondence(transport, childPid, callerPid, inspect) {
  let operationFailure, nativeIdentity, callerIdentity, transportFailure;
  const observationFailures = [];
  const observeTransportFailure = original => {
    try {
      const state = transport.failureObservation?.();
      if (state?.firstFailureRecorded && Object.is(state.firstFailure.original, original)) transportFailure = state.firstFailure;
    } catch (secondary) { observationFailures.push(secondary); }
  };
  const invokeTransport = action => {
    try { return action(); }
    catch (original) { observeTransportFailure(original); throw original; }
  };
  const invoke = async (operation, action) => {
    try { return await action(); }
    catch (original) { operationFailure = { operation, original }; throw original; }
  };
  try {
    await invoke("ready_receipt", async () => {
      try { await transport.ready(); transport.assertLive(); }
      catch (original) { observeTransportFailure(original); throw original; }
    });
    await invoke("child_inspection", async () => {
      const inspection = await inspect(childPid, { deadlineMs: Date.now() + 5_000 });
      invokeTransport(() => transport.assertLive());
      if (inspection.status !== "running" || inspection.identity.pid !== childPid) throw new Error("Fixture guardian native child identity is unresolved.");
      nativeIdentity = inspection.identity;
    });
    await invoke("caller_inspection", async () => {
      const caller = await inspect(callerPid, { deadlineMs: Date.now() + 5_000 });
      invokeTransport(() => transport.assertLive());
      if (caller.status !== "running" || caller.identity.pid !== callerPid) throw new Error("Fixture guardian native caller identity is unresolved.");
      callerIdentity = caller.identity;
    });
    return { failed: false, nativeIdentity, callerIdentity };
  } catch (original) { return { failed: true, original, operationFailure, transportFailure, observationFailures, nativeIdentity, callerIdentity }; }
}

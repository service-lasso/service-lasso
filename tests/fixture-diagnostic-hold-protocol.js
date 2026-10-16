export const DIAGNOSTIC_HOLD_PARENT_OPERATIONS = Object.freeze(["ready_receipt", "child_inspection", "caller_inspection"]);
export const DIAGNOSTIC_HOLD_CHILD_OPERATIONS = Object.freeze(["bootstrap", "acquire_chain", "initial_verify", "ready_emit"]);
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
  let readyWitness, childFailure, closed = false, stdoutEof = false, stderrEof = false, stdinFinished = false, endAttempted = false;
  let exit, close;
  let writes = 0, settleWrites;
  const writesDone = new Promise(resolve => { settleWrites = resolve; });
  const write = (method, text) => {
    writes++;
    let completed = false;
    const done = original => {
      if (completed) { if (original !== undefined && original !== null) failure(original); reject(); return; }
      completed = true; writes--;
      if (original !== undefined && original !== null) failure(original);
      if (closed && writes === 0) settleWrites();
    };
    try { child.stdin[method](text, done); }
    catch (original) {
      if (!completed) { completed = true; writes--; }
      failure(original);
      if (closed && writes === 0) settleWrites();
    }
  };
  const failure = original => { originals.push(original); pending?.reject(original); pending = undefined; };
  let channelRejected = false;
  const reject = () => { if (!channelRejected) { channelRejected = true; failure(new Error("Diagnostic guardian channel rejected.")); } };
  const closure = new Promise(resolve => { close = resolve; });
  const ready = line => {
    if (firstFrame) return reject();
    firstFrame = true;
    if (line.startsWith("GDH1|fail|")) {
      const operation = line.slice("GDH1|fail|".length);
      if (!DIAGNOSTIC_HOLD_CHILD_OPERATIONS.includes(operation)) return reject();
      childFailure = operation;
      return reject();
    }
    let row;
    try {
      if (!line.startsWith("{") || !line.endsWith("}")) return reject();
      // The actual compact producer has four flat literal fields. Admit only
      // that closed ASCII subset, rejecting duplicate/escaped/extra keys before
      // JSON decoding; no generic JSON normalization or nested grammar.
      const fields = line.slice(1, -1).split(",");
      const keys = fields.map(field => {
        const match = /^(?:"(kind|ownerSid)":"[A-Za-z0-9-]+"|"(pid|parentPid)":([1-9][0-9]*))$/.exec(field);
        return match?.[1] ?? match?.[2];
      });
      if (fields.length !== 4 || keys.some(key => key === undefined) || new Set(keys).size !== 4) return reject();
      row = JSON.parse(line);
      if (!row || Array.isArray(row) || Object.keys(row).sort().join(",") !== "kind,ownerSid,parentPid,pid" ||
          row.kind !== "ready" || !Number.isSafeInteger(row.pid) || row.pid < 1 || row.pid !== child.pid ||
          !Number.isSafeInteger(row.parentPid) || row.parentPid < 1 || row.parentPid !== callerPid ||
          typeof row.ownerSid !== "string" || !/^S-[0-9-]{1,184}$/.test(row.ownerSid)) return reject();
    } catch (original) { failure(original); return; }
    readyWitness = row;
    const waiter = pending; pending = undefined; waiter?.resolve();
  };
  child.stdout.on("data", chunk => {
    const bytes = Buffer.from(chunk);
    stdout.push(bytes.subarray(0, Math.max(0, 480 - stdoutCount))); stdoutCount += bytes.length;
    if (stdoutCount > 480 || bytes.some(byte => byte > 127 || byte === 0 || byte === 13)) return reject();
    buffer += bytes.toString("ascii");
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      if (!firstFrame) { if (!pending || pending.kind !== "ready") reject(); else ready(line); }
      else if (readyWitness && line === "verified" && pending?.kind === "verify") {
        const waiter = pending; pending = undefined; waiter.resolve();
      } else reject();
    }
  });
  child.stderr.on("data", chunk => {
    const bytes = Buffer.from(chunk);
    stderr.push(bytes.subarray(0, Math.max(0, 16384 - stderrCount))); stderrCount += bytes.length;
    // ANY stderr fails, including valid failure frames and otherwise ready children.
    reject();
  });
  child.on("error", failure);
  for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on("error", failure);
  child.stdin.once("finish", () => { stdinFinished = true; });
  child.stdout.once("end", () => { stdoutEof = true; if (buffer.length || pending) reject(); });
  child.stderr.once("end", () => { stderrEof = true; });
  child.once("exit", (code, signal) => { exit = { code, signal }; if (code !== 0 || signal !== null) reject(); });
  child.once("close", (code, signal) => {
    closed = true;
    if (pending || buffer.length || !stdoutEof || !stderrEof || !stdinFinished || !exit ||
        code !== 0 || signal !== null || exit.code !== code || exit.signal !== signal) reject();
    close({ code, signal });
    if (writes === 0) settleWrites();
  });
  const receipt = kind => new Promise((resolve, rejectPromise) => {
    if (originals.length) { rejectPromise(originals[0]); return; }
    if (closed || pending || (kind === "ready" ? firstFrame : !readyWitness)) { rejectPromise(new Error("Diagnostic guardian receipt unavailable.")); return; }
    pending = { kind, resolve, reject: rejectPromise };
    if (kind === "verify") {
      write("write", "verify\n");
    }
  });
  return {
    ready: () => receipt("ready"), verify: () => receipt("verify"),
    assertLive() { if (closed || exit || stdoutEof || stderrEof || originals.length) throw originals.length ? originals[0] : new Error("Diagnostic guardian is not live."); },
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
    snapshot() { return { originals: [...originals], readyWitness, childFailure, closed, exit,
      stdoutEof, stderrEof, stdinFinished, stdoutCount, stderrCount,
      stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }; },
  };
}

// Plain correspondence only. Tests may supply observers here; this function
// cannot write the native caller's private provenance map.
export async function acquireDiagnosticHoldCorrespondence(transport, childPid, callerPid, inspect) {
  let operationFailure, nativeIdentity, callerIdentity;
  const invoke = async (operation, action) => {
    try { return await action(); }
    catch (original) { operationFailure = { operation, original }; throw original; }
  };
  try {
    await invoke("ready_receipt", async () => { await transport.ready(); transport.assertLive(); });
    await invoke("child_inspection", async () => {
      const inspection = await inspect(childPid, { deadlineMs: Date.now() + 5_000 });
      transport.assertLive();
      if (inspection.status !== "running" || inspection.identity.pid !== childPid) throw new Error("Fixture guardian native child identity is unresolved.");
      nativeIdentity = inspection.identity;
    });
    await invoke("caller_inspection", async () => {
      const caller = await inspect(callerPid, { deadlineMs: Date.now() + 5_000 });
      transport.assertLive();
      if (caller.status !== "running" || caller.identity.pid !== callerPid) throw new Error("Fixture guardian native caller identity is unresolved.");
      callerIdentity = caller.identity;
    });
    return { failed: false, nativeIdentity, callerIdentity };
  } catch (original) { return { failed: true, original, operationFailure, nativeIdentity, callerIdentity }; }
}

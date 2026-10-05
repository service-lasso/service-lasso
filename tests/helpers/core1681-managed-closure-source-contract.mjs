// AC-4DI.4 / R3 / C3 / G1: source conformance only, never native closure proof.
// Token boundaries exclude comments/literals as alternate owners. This finite
// lexer is not a C# compiler; unsupported or unbalanced source fails the guard.
function tokens(source) {
  const result = [];
  const pattern = /\s+|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|@"(?:[^"]|"")*"|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[A-Za-z_][A-Za-z_0-9]*|[0-9]+|==|!=|\+\+|\|=|=>|&&|\|\||[^\s]/gy;
  let offset = 0;
  while (offset < source.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(source);
    if (!match) throw new Error("managed closure source token boundary");
    offset = pattern.lastIndex;
    if (!/^\s|^\/\//u.test(match[0]) && !match[0].startsWith("/*")) result.push(match[0]);
  }
  return result;
}

function locations(body, text) {
  const expected = tokens(text);
  const found = [];
  for (let index = 0; index <= body.length - expected.length; index += 1) {
    if (expected.every((token, ordinal) => body[index + ordinal] === token)) found.push(index);
  }
  return found;
}

function once(body, text) {
  const found = locations(body, text);
  if (found.length !== 1) throw new Error(`managed closure requires one owning ${text}`);
  return found[0];
}

function block(body, opening) {
  if (body[opening] !== "{") throw new Error("managed closure requires owning block");
  let depth = 1;
  for (let index = opening + 1; index < body.length; index += 1) {
    if (body[index] === "{") depth += 1;
    if (body[index] === "}") depth -= 1;
    if (depth === 0) return { body: body.slice(opening + 1, index), end: index };
  }
  throw new Error("managed closure has unclosed owning block");
}

function method(source, signature) {
  const opening = once(source, signature) + tokens(signature).length;
  return block(source, opening).body;
}

function ordered(body, statements) {
  let previous = -1;
  for (const statement of statements) {
    const current = once(body, statement);
    if (current <= previous) throw new Error("managed closure owning order changed");
    previous = current;
  }
}

function reject(body, text) {
  if (locations(body, text).length) throw new Error(`managed closure forbids ${text}`);
}

function owningDepth(body, text, expected) {
  const at = once(body, text);
  let depth = 0;
  for (let index = 0; index < at; index += 1) {
    if (body[index] === "{") depth += 1;
    if (body[index] === "}") depth -= 1;
  }
  if (depth !== expected) throw new Error("managed closure conditional or alternate owner");
}

function returns(body, expected) {
  const count = body.filter((token) => token === "return").length;
  if (count !== expected.length) throw new Error("managed closure alternative return");
  for (const text of expected) once(body, text);
}

export function assertManagedClosureSourceConformance(source) {
  const all = tokens(source);
  const caller = method(all, "internal static int RunManagedInvocation(ManagedInvocation invocation)");
  const release = method(all, "internal bool ReleaseFile(FileStream file, int ordinal)");
  const finish = method(all, "internal static void FinishManagedReleases(ManagedInvocation invocation, ref IntPtr thread, ref IntPtr process)");
  const retain = method(all, "internal static void RetainManagedInvocation(ManagedInvocation owner)");

  // Only the OUTERMOST finally of the actual caller owns this chain. A nested
  // finally, comment, quoted snippet or another method cannot satisfy it.
  let depth = 0;
  const finalizers = [];
  for (let index = 0; index < caller.length; index += 1) {
    if (caller[index] === "finally" && depth === 0) finalizers.push(index);
    if (caller[index] === "{") depth += 1;
    if (caller[index] === "}") depth -= 1;
  }
  if (finalizers.length !== 1 || depth !== 0) throw new Error("managed closure outer finally ownership");
  const finallyAt = finalizers[0];
  const finalizer = block(caller, finallyAt + 1);
  if (finalizer.end !== caller.length - 1) throw new Error("managed closure bypass after finally");
  const before = caller.slice(0, finallyAt);
  ordered(before, ["List<FileStream> boundFiles = invocation.Files;", "FileStream boundFile = new FileStream(", "boundFiles.Add(boundFile);", "targetAssignedToJob = true;"]);
  for (const name of ["ReleaseFile", "FinishManagedReleases", "Dispose"]) reject(before, name);
  returns(before, ["return invocation.PrimaryResult;", "return failureExitCode;"]);

  const final = finalizer.body;
  ordered(final, [
    "invocation.Job = jobHandle; invocation.Process = processHandle; invocation.Thread = threadHandle;",
    "try { ContainManagedJobBeforeFileRelease(ref jobHandle, processHandle, targetAssignedToJob, invocation); }",
    "catch (Exception failure) { invocation.Observe(\"managed-containment-unknown-return\", 0, true, failure); RetainManagedInvocation(invocation); }",
    "FinishManagedReleases(invocation, ref threadHandle, ref processHandle);",
  ]);
  owningDepth(final, "try { ContainManagedJobBeforeFileRelease", 0);
  owningDepth(final, "catch (Exception failure) { invocation.Observe(\"managed-containment-unknown-return\"", 0);
  owningDepth(final, "FinishManagedReleases(invocation, ref threadHandle, ref processHandle);", 0);
  once(final, "RetainManagedInvocation");
  reject(final, "if");
  reject(final, "Release");
  for (const name of ["return", "Dispose", "ReleaseFile"]) reject(final, name);
  once(final, "ContainManagedJobBeforeFileRelease");
  once(final, "FinishManagedReleases");
  if (once(final, "FinishManagedReleases(invocation, ref threadHandle, ref processHandle);") + tokens("FinishManagedReleases(invocation, ref threadHandle, ref processHandle);").length !== final.length) throw new Error("managed closure work after finisher");

  // Lookup precedes acquisition of the original attempt; no retry may bypass
  // the already-attempted site/ordinal. The retained original is the SAME file.
  ordered(release, [
    "OriginalObservation previous = Outcomes.Find(o => o.Site == \"bound-file-release\" && o.Ordinal == ordinal && o.Attempted);",
    "if (previous != null) return previous.Closed;",
    "OriginalObservation original = new OriginalObservation { Site = \"bound-file-release\", Ordinal = ordinal, File = file, Attempted = true };",
    "Outcomes.Add(original);",
    "try { file.Dispose(); original.Closed = true; }",
    "catch (Exception failure) { original.Exception = failure; original.Failed = true; }",
    "Failed |= original.Failed;",
    "return original.Closed;",
  ]);
  once(release, "Dispose");
  once(release, "Outcomes.Find");
  once(release, "Outcomes.Add");
  for (const text of ["OriginalObservation previous =", "if (previous != null)", "OriginalObservation original =", "Outcomes.Add(original);", "try { file.Dispose();", "catch (Exception failure)", "Failed |= original.Failed;", "return original.Closed;"]) owningDepth(release, text, 0);
  once(release, "if");
  once(release, "try");
  once(release, "catch");
  for (const text of ["throw", "for", "while", "goto"]) reject(release, text);
  returns(release, ["return previous.Closed;", "return original.Closed;"]);
  for (const text of ["File = null", "file =", "Outcomes.Clear", "Outcomes.Remove", "Failed = false", "original.Failed = false"]) reject(release, text);

  // Failure is tested AFTER all independently safe original releases. A failed
  // earlier close must not condition or terminate the later file iteration.
  ordered(finish, [
    "invocation.Release(ref thread, \"target-thread-release\", 0);",
    "invocation.Release(ref process, \"target-process-release\", 0);",
    "for (int ordinal = 0; ordinal < invocation.Files.Count; ordinal++) invocation.ReleaseFile(invocation.Files[ordinal], ordinal);",
    "if (invocation.Failed) RetainManagedInvocation(invocation);",
  ]);
  once(finish, "ReleaseFile");
  once(finish, "for");
  once(finish, "if");
  for (const text of ["invocation.Release(ref thread,", "invocation.Release(ref process,", "for (int ordinal =", "if (invocation.Failed)"]) owningDepth(finish, text, 0);
  if (finish[finish.length - 1] !== ";" || once(finish, "if (invocation.Failed) RetainManagedInvocation(invocation);") + tokens("if (invocation.Failed) RetainManagedInvocation(invocation);").length !== finish.length) throw new Error("managed closure failure gate must finish releases");
  for (const text of ["return", "throw", "break", "continue", "Files.Clear", "Files.Remove", "Failed = false"]) reject(finish, text);
  ordered(retain, ["for (;;)", "try { Thread.Sleep(Timeout.Infinite); }", "catch (Exception failure) { owner.Observe(\"retention-interrupted\", 0, true, failure); }", "GC.KeepAlive(owner);"]);
  once(retain, "for");
  owningDepth(retain, "for (;;)", 0);
  owningDepth(retain, "GC.KeepAlive(owner);", 1);
  for (const text of ["return", "break", "owner =", "Outcomes.Clear", "Files.Clear"]) reject(retain, text);
}

// AC-4DI.4 / R3 / C3 / G1. A deliberately closed SOURCE grammar, not a C#
// compiler or native proof. Every owning statement is consumed. Unknown flow,
// effects, aliases and syntax deny; comments/spacing and harmless braces do not.
function fail(detail) { throw new Error(`managed closure ${detail}`); }

function tokens(source) {
  const result = [];
  // Independent closed C# trivia/literal intake for the WHOLE actual owner.
  // Do not use JS \s or a fallback that repairs unsupported original bytes.
  const newline = ch => /[\r\n\u0085\u2028\u2029]/u.test(ch);
  const whitespace = ch => /[\u0009\u000b\u000c\u0020\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\r\n\u0085\u2028\u2029]/u.test(ch);
  const operators = ["==", "!=", "<=", ">=", "++", "+=", "|=", "=>", "&&", "||", "??"];
  let offset = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (offset < source.length) {
    const start = offset, ch = source[offset];
    if (whitespace(ch)) { offset++; continue; }
    if (source.startsWith("//", offset)) {
      offset += 2;
      while (offset < source.length && !newline(source[offset])) offset++;
      continue;
    }
    if (source.startsWith("/*", offset)) {
      const end = source.indexOf("*/", offset + 2);
      if (end < 0) fail("unterminated comment");
      offset = end + 2; continue;
    }
    if (source.startsWith('@"', offset)) {
      offset += 2; let closed = false;
      while (offset < source.length) {
        if (source[offset++] !== '"') continue;
        if (source[offset] === '"') { offset++; continue; }
        closed = true; break;
      }
      if (!closed) fail("unterminated verbatim literal");
      result.push(source.slice(start, offset)); continue;
    }
    if (ch === '"' || ch === "'") {
      offset++; let closed = false, units = 0;
      while (offset < source.length) {
        const value = source[offset++];
        if (value === ch) { closed = true; break; }
        if (newline(value)) fail("raw newline in ordinary literal");
        if (value === "\\") {
          if (offset === source.length || newline(source[offset])) fail("unavailable/newline escape");
          const escaped = source[offset++];
          if (!"\\'\"0abfnrtv".includes(escaped)) {
            let width = escaped === "u" ? 4 : escaped === "U" ? 8 : 0;
            if (escaped === "x") {
              width = 0;
              while (width < 4 && /[0-9a-fA-F]/u.test(source[offset + width] ?? "")) width++;
            }
            if (!width || !new RegExp(`^[0-9a-fA-F]{${width}}$`, "u").test(source.slice(offset, offset + width))) fail("unsupported literal escape");
            const scalar = Number.parseInt(source.slice(offset, offset + width), 16);
            if (escaped === "U" && (scalar > 0x10ffff || scalar >= 0xd800 && scalar <= 0xdfff)) fail("invalid scalar escape");
            units += escaped === "U" && scalar > 0xffff ? 1 : 0;
            offset += width;
          }
        }
        units++;
      }
      if (!closed || ch === "'" && units !== 1) fail("unterminated/invalid ordinary literal");
      result.push(source.slice(start, offset)); continue;
    }
    if (/[A-Za-z_]/u.test(ch)) {
      offset++;
      while (offset < source.length && /[A-Za-z_0-9]/u.test(source[offset])) offset++;
      result.push(source.slice(start, offset)); continue;
    }
    if (/[0-9]/u.test(ch)) {
      offset++;
      while (offset < source.length && /[0-9]/u.test(source[offset])) offset++;
      result.push(source.slice(start, offset)); continue;
    }
    const operator = operators.find(value => source.startsWith(value, offset));
    if (operator) { result.push(operator); offset += operator.length; continue; }
    if ("{}[]();,.:?+-*/%=!~<>&|^".includes(ch)) { result.push(ch); offset++; continue; }
    fail("unsupported original token character");
  }
  // Conditional compilation cannot create a different reachable owning program.
  if (result.includes("#") || result.includes("$")) fail("unsupported preprocessing/interpolation");
  return result;
}
function same(actual, expected) {
  const want = Array.isArray(expected) ? expected : tokens(expected);
  return actual.length === want.length && actual.every((value, index) => value === want[index]);
}
function group(body, at, open = "{", close = "}") {
  if (body[at] !== open) fail(`expected ${open}`);
  let depth = 1;
  for (let index = at + 1; index < body.length; index += 1) {
    if (body[index] === open) depth += 1;
    if (body[index] === close) depth -= 1;
    if (!depth) return { body: body.slice(at + 1, index), end: index + 1 };
  }
  fail("unclosed region");
}
function region(all, signature) {
  const want = tokens(signature), found = [];
  let depth = 0;
  for (let at = 0; at <= all.length - want.length; at += 1) {
    if (!depth && same(all.slice(at, at + want.length), want)) found.push(at + want.length);
    if (all[at] === "{") depth += 1;
    if (all[at] === "}") depth -= 1;
  }
  if (found.length !== 1) fail(`unique actual owner ${signature}`);
  return group(all, found[0]).body;
}
function method(all, signature) { return parse(region(all, signature)); }
function members(body) {
  const result = [];
  let start = 0, depth = 0;
  for (let at = 0; at < body.length; at += 1) {
    if (body[at] === "(") depth += 1;
    if (body[at] === ")") depth -= 1;
    if (!depth && body[at] === ";") {
      result.push({ header: body.slice(start, at), body: null }); start = at + 1;
    } else if (!depth && body[at] === "{") {
      const value = group(body, at);
      result.push({ header: body.slice(start, at), body: value.body });
      at = value.end - 1; start = value.end;
    }
  }
  if (start !== body.length) fail("unconsumed owner declaration");
  return result;
}
function fieldSet(actual, expected) {
  if (actual.length !== expected.length || actual.some((value) => value.body !== null)) fail("field/property ownership");
  const names = actual.map((value) => value.header.join(" ")).sort();
  const wanted = expected.map((value) => tokens(value).join(" ")).sort();
  if (!names.every((value, at) => value === wanted[at])) fail("original declared field/type binding");
}
function initializer(node, prefix, fields, suffix = "}") {
  if (node?.kind !== "leaf") fail("original observation initializer");
  const before = tokens(prefix), after = tokens(suffix), expression = node.expression;
  if (!same(expression.slice(0, before.length), before) || !same(expression.slice(-after.length), after)) fail("original observation declaration");
  const actual = expression.slice(before.length, -after.length).join(" ").split(" , ").sort();
  const want = fields.map((value) => tokens(value).join(" ")).sort();
  if (actual.length !== want.length || !actual.every((value, at) => value === want[at])) fail("original observation field identity");
}

// Only these statement categories exist in the accepted subset. In particular,
// labels/goto/switch/return inside finally/local functions/lock/delegates/unsafe
// expressions cannot be disguised as arbitrary intervening token strings.
function parse(body) {
  let at = 0;
  const take = (value) => { if (body[at++] !== value) fail(`expected ${value}`); };
  function enclosed(open, close) {
    const value = group(body, at, open, close); at = value.end; return value.body;
  }
  function statement() {
    const kind = body[at];
    if (kind === ";") { at += 1; return { kind: "empty" }; }
    if (kind === "{") return { kind: "block", body: parse(enclosed("{", "}")) };
    if (["if", "for", "foreach", "using", "while"].includes(kind)) {
      at += 1; const condition = enclosed("(", ")"), child = statement();
      if (body[at] === "else") fail("unsupported else");
      return { kind, condition, body: flatten([child]) };
    }
    if (kind === "try") {
      at += 1; const child = statement();
      if (child.kind !== "block") fail("try block");
      const catches = [];
      while (body[at] === "catch") {
        at += 1; const binding = body[at] === "(" ? enclosed("(", ")") : [];
        const caught = statement();
        if (caught.kind !== "block") fail("catch block");
        catches.push({ binding, body: flatten(caught.body) });
      }
      let final = null;
      if (body[at] === "finally") {
        at += 1; const cleanup = statement();
        if (cleanup.kind !== "block") fail("finally block");
        final = flatten(cleanup.body);
      }
      if (!catches.length && !final) fail("unhandled try");
      return { kind, body: flatten(child.body), catches, final };
    }
    if (["goto", "do", "switch", "lock", "fixed", "unsafe", "yield"].includes(kind)) fail("unsupported flow");
    const start = at;
    let parentheses = 0, brackets = 0, initializer = 0;
    while (at < body.length) {
      const value = body[at++];
      if (value === "(") parentheses += 1;
      if (value === ")" && --parentheses < 0) fail("unbalanced expression");
      if (value === "[") brackets += 1;
      if (value === "]" && --brackets < 0) fail("unbalanced index");
      if (value === "{") initializer += 1;
      if (value === "}" && --initializer < 0) fail("unexpected body");
      if (value === ";" && !parentheses && !brackets && !initializer) {
        return { kind: "leaf", expression: body.slice(start, at - 1) };
      }
    }
    fail("unterminated statement");
  }
  const result = [];
  while (at < body.length) result.push(statement());
  return flatten(result);
}
function flatten(nodes) {
  return nodes.flatMap((node) => node.kind === "empty" ? [] : node.kind === "block" ? flatten(node.body) : [node]);
}
function leaf(node, expression) { return node?.kind === "leaf" && same(node.expression, expression); }
function requireLeaf(node, expression) { if (!leaf(node, expression)) fail(`effect role ${expression}`); }
function count(nodes, length) { if (nodes.length !== length) fail("unexamined statement/effect"); }
function branch(node, condition, expressions, kind = "if") {
  if (node?.kind !== kind || !same(node.condition, condition)) fail(`control role ${condition}`);
  count(node.body, expressions.length);
  expressions.forEach((expression, at) => requireLeaf(node.body[at], expression));
}
function caught(node, body, binding, handler) {
  if (node?.kind !== "try" || node.final !== null || node.catches.length !== 1 || !same(node.catches[0].binding, binding)) fail("caught effect region");
  count(node.body, body.length); count(node.catches[0].body, handler.length);
  body.forEach((value, at) => requireLeaf(node.body[at], value));
  handler.forEach((value, at) => requireLeaf(node.catches[0].body[at], value));
}

function fileRelease(nodes) {
  count(nodes, 7);
  requireLeaf(nodes[0], 'OriginalObservation previous = Outcomes.Find(o => o.Site == "bound-file-release" && o.Ordinal == ordinal && o.Attempted)');
  branch(nodes[1], "previous != null", ["return previous.Closed"]);
  // Field order in an object initializer is not ownership order: each value is
  // effect-free. Accept any permutation of these four original field bindings.
  const original = nodes[2];
  if (original.kind !== "leaf") fail("original attempt declaration");
  const prefix = tokens("OriginalObservation original = new OriginalObservation {");
  if (!same(original.expression.slice(0, prefix.length), prefix) || original.expression.at(-1) !== "}") fail("original attempt owner");
  const fields = original.expression.slice(prefix.length, -1).join(" ").split(" , ").sort();
  const expected = ['Site = "bound-file-release"', "Ordinal = ordinal", "File = file", "Attempted = true"].sort();
  if (fields.length !== expected.length || !fields.every((field, at) => field === expected[at])) fail("original attempt identity");
  requireLeaf(nodes[3], "Outcomes.Add(original)");
  caught(nodes[4], ["file.Dispose()", "original.Closed = true"], "Exception failure", ["original.Exception = failure", "original.Failed = true"]);
  requireLeaf(nodes[5], "Failed |= original.Failed");
  requireLeaf(nodes[6], "return original.Closed");
}

function finalizer(nodes) {
  count(nodes, 7);
  caught(nodes[0], ["ClearLaunchEnvironment(invocation)"], "Exception failure", ['invocation.Observe("launch-environment-retirement", 0, true, failure)']);
  caught(nodes[1], ["RetireProgress(invocation)"], "Exception failure", ['invocation.Observe("progress-retirement", 0, true, failure)']);
  requireLeaf(nodes[2], "invocation.Job = jobHandle");
  requireLeaf(nodes[3], "invocation.Process = processHandle");
  requireLeaf(nodes[4], "invocation.Thread = threadHandle");
  caught(nodes[5], ["ContainManagedJobBeforeFileRelease(ref jobHandle, processHandle, targetAssignedToJob, invocation)"], "Exception failure", ['invocation.Observe("managed-containment-unknown-return", 0, true, failure)', "RetainManagedInvocation(invocation)"]);
  requireLeaf(nodes[6], "FinishManagedReleases(invocation, ref threadHandle, ref processHandle)");
}

function finisher(nodes) {
  count(nodes, 4);
  recordingProtected(nodes[0], 'invocation.Release(ref thread, "target-thread-release", 0)');
  recordingProtected(nodes[1], 'invocation.Release(ref process, "target-process-release", 0)');
  const loop = nodes[2];
  if (loop?.kind !== "for" || !["int ordinal = 0; ordinal < invocation.Files.Count; ordinal++", "int ordinal = 0; ordinal < invocation.Files.Count; ordinal += 1"].some((value) => same(loop.condition, value))) fail("every original file loop");
  count(loop.body, 1);
  recordingProtected(loop.body[0], "invocation.ReleaseFile(invocation.Files[ordinal], ordinal)");
  branch(nodes[3], "invocation.Failed", ["RetainManagedInvocation(invocation)"]);
}
function recordingProtected(node, effect) {
  caught(node, [effect], "Exception recording", ["invocation.RecordingFailure = recording", "invocation.Failed = true"]);
}
function recordingInitializer(node, fields) {
  if (node?.kind !== 'try' || node.final !== null || node.catches.length !== 1 || !same(node.catches[0].binding, 'Exception recording')) fail('recording initializer exception enclosure');
  count(node.body, 1); count(node.catches[0].body, 2);
  initializer(node.body[0], 'invocation.Outcomes.Add(new OriginalObservation {', fields, '})');
  requireLeaf(node.catches[0].body[0], 'invocation.RecordingFailure = recording');
  requireLeaf(node.catches[0].body[1], 'invocation.Failed = true');
}
function retention(nodes) {
  count(nodes, 1);
  const loop = nodes[0];
  if (loop.kind !== "for" || !same(loop.condition, ";;")) fail("indefinite same-owner retention");
  count(loop.body, 2);
  caught(loop.body[0], ["Thread.Sleep(Timeout.Infinite)"], "Exception failure", ['owner.Observe("retention-interrupted", 0, true, failure)']);
  requireLeaf(loop.body[1], "GC.KeepAlive(owner)");
}
function invocationBindings(body) {
  const declared = members(body), fields = declared.filter((value) => value.body === null), methods = declared.filter((value) => value.body !== null);
  fieldSet(fields, ["internal readonly List<OriginalObservation> Outcomes = new List<OriginalObservation>()", "internal readonly List<FileStream> Files",
    "internal IntPtr Job, Process, Thread, Directory", "internal Exception Primary", "internal Exception RecordingFailure", "internal Exception UnrecordedException", "internal int PrimaryResult", "internal bool Failed",
    "internal bool ChildIssuanceUnresolved", "internal bool PrimaryWaitPending", "internal bool PrimaryWaitFailed", "internal HMACSHA256 Progress", "internal readonly List<EnvironmentOverride> EnvironmentOwners = new List<EnvironmentOverride>()"]);
  if (methods.length !== 5 || !["internal ManagedInvocation(List<FileStream> files)", "internal void Observe(string site, int status, bool failed, Exception exception)", "internal void ObservePrimary(string site, int status, bool failed, Exception exception)", "internal bool Release(ref IntPtr handle, string site, int ordinal)", "internal bool ReleaseFile(FileStream file, int ordinal)"].every((header) => methods.filter((value) => same(value.header, header)).length === 1)) fail("original invocation callee/member bindings");
  const constructor = method(body, "internal ManagedInvocation(List<FileStream> files)");
  count(constructor, 1); requireLeaf(constructor[0], "Files = files");
  const observe = method(body, "internal void Observe(string site, int status, bool failed, Exception exception)");
  count(observe, 2);
  requireLeaf(observe[0], "Failed |= failed");
  const guardedObservation = node => {
    if (node?.kind !== 'try' || node.final !== null || node.catches.length !== 1 || !same(node.catches[0].binding, 'Exception recording')) fail('observation recording exception enclosure');
    count(node.body, 1); count(node.catches[0].body, 3);
    initializer(node.body[0], "Outcomes.Add(new OriginalObservation {", ["Site = site", "Ordinal = Outcomes.Count", "NativeStatus = status", "Failed = failed", "Exception = exception"], "})");
    requireLeaf(node.catches[0].body[0], 'UnrecordedException = exception');
    requireLeaf(node.catches[0].body[1], 'RecordingFailure = recording');
    requireLeaf(node.catches[0].body[2], 'Failed = true');
  };
  guardedObservation(observe[1]);
  const primary = method(body, "internal void ObservePrimary(string site, int status, bool failed, Exception exception)");
  count(primary, 1);
  guardedObservation(primary[0]);
  const release = method(body, "internal bool Release(ref IntPtr handle, string site, int ordinal)");
  count(release, 9);
  requireLeaf(release[0], "OriginalObservation previous = Outcomes.Find(o => o.Site == site && o.Ordinal == ordinal && o.Attempted)");
  branch(release[1], "previous != null", ["return previous.Closed"]);
  branch(release[2], "handle == IntPtr.Zero", ["return true"]);
  initializer(release[3], "OriginalObservation original = new OriginalObservation {", ["Site = site", "Ordinal = ordinal", "Handle = handle", "Attempted = true"]);
  requireLeaf(release[4], "Outcomes.Add(original)");
  caught(release[5], ["original.Closed = CloseHandle(original.Handle)", "original.NativeStatus = original.Closed ? 0 : Marshal.GetLastWin32Error()", "original.Failed = !original.Closed"], "Exception failure", ["original.Exception = failure", "original.Failed = true"]);
  requireLeaf(release[6], "Failed |= original.Failed");
  branch(release[7], "original.Closed", ["handle = IntPtr.Zero"]);
  requireLeaf(release[8], "return original.Closed");
}

// Consume the actual reachable owning callees by resource roles. Statement
// grouping and effect-free initializer field order are independent of these
// relations; bodies are neither hashed nor compared to production snapshots.
function owningCallees(launcher) {
  const completeContainment = method(launcher, "private static void ContainManagedJobBeforeFileRelease(ref IntPtr jobHandle, IntPtr processHandle, bool targetAssignedToJob, ManagedInvocation invocation)");
  count(completeContainment, 10);
  branch(completeContainment[0], 'invocation.ChildIssuanceUnresolved || invocation.Outcomes.Exists(o => o.Site == "target-primary-wait" && o.Failed) || invocation.PrimaryWaitFailed || invocation.PrimaryWaitPending', ["RetainManagedInvocation(invocation)"]);
  const containment = completeContainment.slice(1);
  count(containment, 9);
  const unassigned = containment[0];
  if (unassigned.kind !== "if" || !same(unassigned.condition, "!targetAssignedToJob && processHandle != IntPtr.Zero")) fail("unassigned original process owner");
  count(unassigned.body, 7);
  ["bool terminated = TerminateProcess(processHandle, 1)", "int terminateError = terminated ? 0 : Marshal.GetLastWin32Error()",
    'invocation.Observe("unassigned-process-terminate", terminateError, !terminated, null)',
    "uint waited = WaitForSingleObject(processHandle, Infinite)", "int waitError = waited == UInt32.MaxValue ? Marshal.GetLastWin32Error() : unchecked((int)waited)",
    'invocation.Observe("unassigned-process-wait", waitError, waited != WaitObject0, null)'].forEach((effect, at) => requireLeaf(unassigned.body[at], effect));
  branch(unassigned.body[6], "!terminated || waited != WaitObject0", ["RetainManagedInvocation(invocation)"]);
  branch(containment[1], "jobHandle == IntPtr.Zero", ["return"]);
  requireLeaf(containment[2], "bool jobTerminated = TerminateJobObject(jobHandle, 1)");
  requireLeaf(containment[3], "int jobError = jobTerminated ? 0 : Marshal.GetLastWin32Error()");
  requireLeaf(containment[4], 'invocation.Observe("managed-job-terminate", jobError, !jobTerminated, null)');
  branch(containment[5], "!jobTerminated", ["RetainManagedInvocation(invocation)"]);
  const drain = containment[6];
  if (drain.kind !== "while" || !same(drain.condition, "true")) fail("original job drain loop");
  count(drain.body, 4);
  requireLeaf(drain.body[0], "JobObjectBasicAccountingInformation accounting");
  branch(drain.body[1], "!QueryInformationJobObject(jobHandle, 1, out accounting, (uint)Marshal.SizeOf(typeof(JobObjectBasicAccountingInformation)), IntPtr.Zero)", [
    "int accountingError = Marshal.GetLastWin32Error()", 'invocation.Observe("managed-job-accounting", accountingError, true, null)', "RetainManagedInvocation(invocation)"]);
  branch(drain.body[2], "accounting.ActiveProcesses == 0", ["break"]);
  requireLeaf(drain.body[3], "Thread.Sleep(10)");
  const process = containment[7];
  if (process.kind !== "if" || !same(process.condition, "processHandle != IntPtr.Zero")) fail("original process closure owner");
  count(process.body, 4);
  requireLeaf(process.body[0], "uint waited = WaitForSingleObject(processHandle, Infinite)");
  requireLeaf(process.body[1], "int waitError = waited == UInt32.MaxValue ? Marshal.GetLastWin32Error() : unchecked((int)waited)");
  requireLeaf(process.body[2], 'invocation.Observe("managed-process-wait", waitError, waited != WaitObject0, null)');
  branch(process.body[3], "waited != WaitObject0", ["RetainManagedInvocation(invocation)"]);
  recordingProtected(containment[8], 'invocation.Release(ref jobHandle, "managed-job-release", 0)');

  const launch = method(launcher, "private static void ClearLaunchEnvironment(ManagedInvocation invocation)");
  count(launch, 2);
  requireLeaf(launch[0], "string[] names = { PayloadEnvironmentName, GateEnvironmentName, ProgressEnvironmentName }");
  if (launch[1]?.kind !== 'for' || !same(launch[1].condition, 'int index = 0; index < names.Length; index++')) fail('every launch environment name');
  count(launch[1].body, 1);
  recordingProtected(launch[1].body[0], 'RetireEnvironmentName(invocation, names[index], names[index], "launch-environment-clear", index)');
  const clear = method(launcher, "internal static void ClearTargetEnvironmentOverrides(EnvironmentOverride[] environmentOverrides, ManagedInvocation invocation, int count)");
  count(clear, 1);
  if (clear[0]?.kind !== 'for' || !same(clear[0].condition, 'int index = 0; index < count; index++')) fail('every original target environment name');
  count(clear[0].body, 2); requireLeaf(clear[0].body[0], 'EnvironmentOverride environmentOverride = environmentOverrides[index]');
  recordingProtected(clear[0].body[1], 'RetireEnvironmentName(invocation, environmentOverride.name, environmentOverride, "target-environment-clear", index)');
  const name = method(launcher, "private static void RetireEnvironmentName(ManagedInvocation invocation, string name, object resource, string site, int ordinal)");
  count(name, 4);
  branch(name[0], "invocation.Outcomes.Exists(o => o.Site == site && o.Ordinal == ordinal && o.Attempted)", ["return"]);
  initializer(name[1], "OriginalObservation original = new OriginalObservation {", ["Site = site", "Ordinal = ordinal", "Resource = resource", "Attempted = true"]);
  requireLeaf(name[2], "invocation.Outcomes.Add(original)");
  caught(name[3], ["Environment.SetEnvironmentVariable(name, null, EnvironmentVariableTarget.Process)", "original.Closed = true"], "Exception failure",
    ["original.Exception = failure", "original.Failed = true", "invocation.Failed = true"]);
  const progress = method(launcher, "internal static void RetireProgress(ManagedInvocation invocation)");
  count(progress, 2); requireLeaf(progress[0], "progressToken = null"); requireLeaf(progress[1], "RetireProgressOwned(invocation, ref progressHmac)");
  const hmac = method(launcher, "internal static void RetireProgressOwned(ManagedInvocation invocation, ref HMACSHA256 originalHmac)");
  count(hmac, 6);
  branch(hmac[0], 'invocation.Outcomes.Exists(o => o.Site == "progress-retirement" && o.Attempted)', ["return"]);
  branch(hmac[1], "originalHmac == null", ["return"]);
  requireLeaf(hmac[2], "invocation.Progress = originalHmac");
  initializer(hmac[3], "OriginalObservation original = new OriginalObservation {", ['Site = "progress-retirement"', "Ordinal = 0", "Resource = originalHmac", "Attempted = true"]);
  requireLeaf(hmac[4], "invocation.Outcomes.Add(original)");
  caught(hmac[5], ["invocation.Progress.Dispose()", "original.Closed = true", "originalHmac = null"], "Exception failure",
    ["original.Exception = failure", "original.Failed = true", "invocation.Failed = true"]);
  const apply = method(launcher, "internal static void ApplyTargetEnvironmentOverrides(EnvironmentOverride[] environmentOverrides, ManagedInvocation invocation)");
  count(apply, 2); requireLeaf(apply[0], "int appliedCount = 0");
  const attempt = apply[1];
  if (attempt.kind !== "try" || attempt.final !== null || attempt.catches.length !== 1 || !same(attempt.catches[0].binding, "Exception primary")) fail("original environment application exception region");
  count(attempt.body, 1);
  const each = attempt.body[0];
  if (each.kind !== "foreach" || !same(each.condition, "EnvironmentOverride environmentOverride in environmentOverrides")) fail("original environment application roster");
  count(each.body, 4);
  requireLeaf(each.body[0], "invocation.EnvironmentOwners.Add(environmentOverride)");
  requireLeaf(each.body[1], "Environment.SetEnvironmentVariable(environmentOverride.name, environmentOverride.value, EnvironmentVariableTarget.Process)");
  requireLeaf(each.body[2], "appliedCount += 1");
  recordingInitializer(each.body[3], ['Site = "target-environment-apply"', "Ordinal = appliedCount - 1", "Resource = environmentOverride", "Attempted = true", "Closed = true"]);
  const failed = attempt.catches[0].body;
  count(failed, 4); requireLeaf(failed[0], "invocation.Primary = primary");
  recordingInitializer(failed[1], ['Site = "target-environment-apply"', "Ordinal = appliedCount", "Resource = environmentOverrides[appliedCount]", "Attempted = true", "Failed = true", "Exception = primary"]);
  caught(failed[2], ["ClearTargetEnvironmentOverrides(environmentOverrides, invocation, appliedCount + 1)"], "Exception later", ['invocation.Observe("target-environment-rollback-unknown-return", 0, true, later)']);
  requireLeaf(failed[3], "throw");
  const originalFailure = method(launcher, "private static void ThrowOriginalRetirementFailure(ManagedInvocation invocation)");
  count(originalFailure, 3);
  requireLeaf(originalFailure[0], "OriginalObservation original = invocation.Outcomes.Find(o => o.Failed && o.Exception != null)");
  branch(originalFailure[1], "original != null", ["throw original.Exception"]);
  requireLeaf(originalFailure[2], 'throw new InvalidOperationException("Managed original retirement failed.")');
  const configure = method(launcher, "private static void ConfigureKillOnClose(IntPtr jobHandle)");
  count(configure, 5);
  ["JobObjectExtendedLimitInformation information = new JobObjectExtendedLimitInformation()", "information.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose",
    "int informationSize = Marshal.SizeOf(typeof(JobObjectExtendedLimitInformation))", "IntPtr informationPointer = Marshal.AllocHGlobal(informationSize)"].forEach((role, at) => requireLeaf(configure[at], role));
  const configured = configure[4];
  if (configured.kind !== "try" || configured.catches.length || configured.final === null) fail("original job configuration input enclosure");
  count(configured.body, 2); count(configured.final, 1);
  requireLeaf(configured.body[0], "Marshal.StructureToPtr(information, informationPointer, false)");
  branch(configured.body[1], "!SetInformationJobObject(jobHandle, JobObjectExtendedLimitInformationClass, informationPointer, (uint)informationSize)", ['throw new Win32Exception(Marshal.GetLastWin32Error(), "Managed launch job configuration failed.")']);
  requireLeaf(configured.final[0], "Marshal.FreeHGlobal(informationPointer)");
  const initialize = method(launcher, "private static void InitializeProgress()");
  count(initialize, 4);
  requireLeaf(initialize[0], "progressToken = Environment.GetEnvironmentVariable(ProgressEnvironmentName, EnvironmentVariableTarget.Process)");
  branch(initialize[1], "!IsLowerHex64(progressToken)", ["progressToken = null", "return"]);
  requireLeaf(initialize[2], "byte[] key = StrictUtf8.GetBytes(progressToken)");
  const keyOwner = initialize[3];
  if (keyOwner.kind !== "try" || keyOwner.catches.length !== 1 || keyOwner.catches[0].binding.length || keyOwner.final === null) fail("original progress constructor/input enclosure");
  count(keyOwner.body, 1); count(keyOwner.catches[0].body, 1); count(keyOwner.final, 1);
  requireLeaf(keyOwner.body[0], "progressHmac = new HMACSHA256(key)");
  requireLeaf(keyOwner.catches[0].body[0], "progressHmac = null");
  requireLeaf(keyOwner.final[0], "Array.Clear(key, 0, key.Length)");
  const progressWrite = method(launcher, "private static void SetProgress(string phase, string payloadFailureBoundary = null)");
  count(progressWrite, 1);
  const diagnostic = progressWrite[0];
  if (diagnostic.kind !== "try" || diagnostic.final !== null || diagnostic.catches.length !== 1 || diagnostic.catches[0].binding.length) fail("observational progress exception boundary");
  count(diagnostic.catches[0].body, 0); count(diagnostic.body, 6);
  branch(diagnostic.body[0], 'progressHmac == null || !IsProgressPhase(phase) || (payloadFailureBoundary != null && (!String.Equals(phase, "launcher_payload_validation", StringComparison.Ordinal) || !IsPayloadFailureBoundary(payloadFailureBoundary)))', ["return"]);
  requireLeaf(diagnostic.body[1], 'string authenticatedRecord = payloadFailureBoundary == null ? phase : phase + ":" + payloadFailureBoundary');
  requireLeaf(diagnostic.body[2], "byte[] phaseBytes = StrictUtf8.GetBytes(authenticatedRecord)");
  requireLeaf(diagnostic.body[3], "byte[] digest");
  const hash = diagnostic.body[4], write = diagnostic.body[5];
  for (const region of [hash, write]) if (region.kind !== "try" || region.catches.length || region.final === null) fail("original progress transient buffer enclosure");
  count(hash.body, 1); count(hash.final, 1); count(write.body, 1); count(write.final, 1);
  requireLeaf(hash.body[0], "digest = progressHmac.ComputeHash(phaseBytes)");
  requireLeaf(hash.final[0], "Array.Clear(phaseBytes, 0, phaseBytes.Length)");
  requireLeaf(write.body[0], 'Console.Error.WriteLine(ProgressPrefix + authenticatedRecord + ":" + ToLowerHex(digest))');
  requireLeaf(write.final[0], "Array.Clear(digest, 0, digest.Length)");
  const gate = method(launcher, "private static void WaitForGate(string path, string expectedToken, TimeSpan timeout)");
  count(gate, 2); requireLeaf(gate[0], "DateTime deadline = DateTime.UtcNow.Add(timeout)");
  if (gate[1].kind !== "while" || !same(gate[1].condition, "!GateMatches(path, expectedToken)")) fail("original gate observation loop");
  count(gate[1].body, 2);
  branch(gate[1].body[0], "DateTime.UtcNow >= deadline", ['throw new TimeoutException("Managed launch gate timed out.")']);
  requireLeaf(gate[1].body[1], "Thread.Sleep(25)");
}

// Transitive helpers with no live-resource parameters may parse/validate values
// and allocate their own strings/collections. They cannot reach a native effect,
// an owning retirement seam, a new receiver/property or a static owner alias.
// The grammar constrains effects; it does not snapshot their validation logic.
function valueCalleeClosure(launcher) {
  const declared = members(launcher);
  const names = new Set([
    "ParseLaunchPayload", "ValidateStrictJsonSyntax", "ParseJsonValue", "ParseJsonObject", "ParseJsonArray", "ParseJsonString", "ParseJsonNumber",
    "ConsumeJsonLiteral", "SkipJsonWhitespace", "HexDigitValue", "RequireObject", "RequireArray", "RequireString", "RequireInt", "RequireLong", "RequireBoolean", "RequireExactKeys",
    "ValidatePayload", "ValidateNativeLayouts", "ValidateApprovedFile", "IsFullyQualifiedWindowsPath", "IsDirectorySeparator", "IndexOfDirectorySeparator", "IsLoaderSensitiveEnvironmentName",
    "AssertBootstrapEnvironmentSanitized", "BoundPathAt", "GateMatches", "BuildCommandLine", "QuoteCommandLineArgument", "RequiresCommandLineQuoting", "NormalizeFinalPath",
    "IsProgressPhase", "IsPayloadFailureBoundary", "IsLowerHex64", "ToLowerHex", "TargetCreationFailureExitCode",
  ]);
  const constructors = new Set(["InvalidOperationException", "JavaScriptSerializer", "LaunchPayload", "ApprovedFile", "ArgumentBinding", "EnvironmentOverride", "StringBuilder", "HashSet"]);
  const calls = new Set(["String.IsNullOrWhiteSpace", "String.Equals", "Char.IsLetter", "Marshal.SizeOf", "Environment.GetEnvironmentVariables", "File.Exists", "File.ReadAllText", "BitConverter.ToString",
    "json.Substring", "value.Substring", "value.IndexOf", "value.StartsWith", "name.StartsWith", "environmentOverride.name.IndexOf", "environmentOverride.value.IndexOf", "text.IndexOf",
    "keys.Add", "argumentIndexes.Add", "environmentNames.Add", "record.ContainsKey", "value.Append", "value.ToString", "commandLine.Append", "commandLine.ToString", "result.Append", "result.ToString",
    // Chained string calls below are still restricted to declared value identities.
    "DeserializeObject", "Trim", "Replace", "ToLowerInvariant", "typeof", "if", "for", "foreach", "while", "switch", "catch", "return"]);
  const identifiers = new Set([
    ...names, ...constructors, ...[...calls].flatMap((value) => value.split(".")),
    "private", "static", "string", "char", "int", "long", "uint", "bool", "object", "void", "ref", "new", "return", "throw", "true", "false", "null", "else", "case", "default", "break", "continue", "try", "finally", "in", "as", "is",
    "IDictionary", "DictionaryEntry", "StringComparer", "StringComparison", "Ordinal", "OrdinalIgnoreCase", "StrictUtf8", "File", "Path", "Char", "Marshal", "IntPtr", "Size", "System", "EnvironmentVariableTarget", "Process",
    "payloadJson", "parsed", "root", "rawArgs", "args", "index", "rawApprovedFiles", "approvedFiles", "rawApprovedFile", "rawArgumentBindings", "argumentBindings", "rawBinding", "rawEnvironmentOverrides", "targetEnvironmentOverrides", "rawEnvironmentOverride",
    "payload", "binding", "approvedFile", "environmentOverride", "tokens", "argumentIndexes", "environmentNames", "entry", "Key", "record", "expectedKeys", "key", "label", "value", "items", "maximumLength", "text", "allowEmpty", "json", "depth", "marker", "character", "escape", "codeUnit", "offset", "digit", "integerStart", "fractionStart", "exponentStart", "literal",
    "expectedStartupInfoSize", "expectedProcessInformationSize", "expectedJobInformationSize", "expectedJobAccountingSize", "StartupInfo", "ProcessInformation", "JobObjectExtendedLimitInformation", "JobObjectBasicAccountingInformation", "serverEnd", "shareEnd", "startIndex", "name", "boundFilePaths", "path", "actualToken", "expectedToken", "IOException", "UnauthorizedAccessException", "executable", "argument", "commandLine", "result", "backslashes", "phase", "boundary", "bytes", "errorCode",
    "Length", "Count", "executable", "workingDirectory", "ackPath", "filesBoundPath", "continuePath", "releaseToken", "filesBoundToken", "continueToken", "ackToken", "file", "sha256", "size", "bindingIndex", "prefix", "executableBindingIndex", "requireExecutableBinding", "targetEnvironmentOverrides", "postResumeDelayMilliseconds", "Empty", "x20",
  ]);
  // A declared C# const is value-only. No arbitrary field/getter may supply it.
  for (const member of declared) {
    if (same(member.header.slice(0, 2), "private const")) identifiers.add(member.header[3]);
    if (member.body !== null && !member.header.includes("(") && !["class", "struct"].some((kind) => member.header.includes(kind))) fail("unbound static property receiver");
  }
  for (const name of names) {
    const candidates = declared.filter((member) => member.header.some((value, at) => value === name && member.header[at + 1] === "("));
    if (candidates.length !== 1 || candidates[0].body === null) fail(`unique actual value callee ${name}`);
    const body = candidates[0].body;
    for (let at = 0; at < body.length; at += 1) {
      const value = body[at];
      if (/^[A-Za-z_][A-Za-z_0-9]*$/u.test(value) && !identifiers.has(value)) fail(`unbound value callee identity ${name}:${value}`);
      if (value === "new" && !constructors.has(body[at + 1]) && !["string", "ApprovedFile", "ArgumentBinding", "EnvironmentOverride"].includes(body[at + 1])) fail(`unbound value constructor ${name}`);
      if (body[at + 1] !== "(" || !/^[A-Za-z_]/u.test(value)) continue;
      let start = at;
      while (start >= 2 && body[start - 1] === "." && /^[A-Za-z_]/u.test(body[start - 2])) start -= 2;
      const call = body.slice(start, at + 1).join("");
      if (body[start - 1] === "new" && constructors.has(call)) continue;
      if (!names.has(call) && !calls.has(call)) fail(`unbound value callee effect ${name}:${call}`);
    }
  }
}

function typeBindings(all, launcher) {
  const rootHeader = tokens("public static class ServiceLassoManagedLauncherNative");
  let rootAt = -1;
  for (let at = 0; at <= all.length - rootHeader.length; at += 1) if (same(all.slice(at, at + rootHeader.length), rootHeader)) { if (rootAt !== -1) fail("outer type ambiguity"); rootAt = at; }
  if (rootAt < 0 || group(all, rootAt + rootHeader.length).end !== all.length) fail("outer source/type boundary");
  // Imports are namespace-only. No using/extern alias can change CLR identities.
  const imports = all.slice(0, rootAt).join(" ").split(" ; ");
  if (imports.at(-1) === "") imports.pop();
  // The final semicolon has no following token in the prefix.
  if (imports.at(-1)?.endsWith(" ;")) imports[imports.length - 1] = imports.at(-1).slice(0, -2);
  const namespaces = ["System", "System.Collections", "System.Collections.Generic", "System.ComponentModel", "System.IO", "System.Runtime.InteropServices", "System.Security.Cryptography", "System.Text", "System.Threading", "System.Web.Script.Serialization"];
  const expected = namespaces.map((value) => tokens(`using ${value}`).join(" ")).sort();
  imports.sort();
  if (imports.length !== expected.length || !imports.every((value, at) => value === expected[at])) fail("CLR import/type alias");
  const clr = new Set(["System", "List", "FileStream", "Exception", "IntPtr", "UIntPtr", "Thread", "GC", "Timeout", "Marshal", "Environment", "File", "Directory", "String", "StringComparison", "EnvironmentVariableTarget", "UInt32", "SHA256", "HMACSHA256", "UTF8Encoding", "FileMode", "FileAccess", "FileShare", "StringBuilder", "Win32Exception", "InvalidOperationException", "TimeoutException", "IOException", "UnauthorizedAccessException", "HashSet", "IDictionary", "DictionaryEntry", "JavaScriptSerializer", "Char", "Path", "Array", "Convert", "StringComparer", "BitConverter", "DateTime", "TimeSpan", "Console"]);
  for (let at = 0; at < launcher.length - 1; at += 1) if (["class", "struct", "enum", "interface"].includes(launcher[at]) && clr.has(launcher[at + 1])) fail("source shadows original CLR type/callee");
  fieldSet(members(region(launcher, "internal sealed class OriginalObservation")), ["internal string Site", "internal int Ordinal", "internal IntPtr Handle", "internal FileStream File", "internal object Resource", "internal bool Attempted, Closed, Failed", "internal int NativeStatus", "internal Exception Exception"]);
  fieldSet(members(region(launcher, "private struct ProcessInformation")), ["public IntPtr hProcess", "public IntPtr hThread", "public uint dwProcessId", "public uint dwThreadId"]);
  const nativeClose = tokens('[DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);');
  let found = 0, depth = 0;
  for (let at = 0; at < launcher.length; at += 1) {
    if (!depth && same(launcher.slice(at, at + nativeClose.length), nativeClose)) found += 1;
    if (!depth && clr.has(launcher[at]) && ["=", "=>", ";", "{", "("].includes(launcher[at + 1]) && launcher[at - 1] !== "new") fail("member shadows original CLR receiver");
    if (launcher[at] === "{") depth += 1;
    if (launcher[at] === "}") depth -= 1;
  }
  if (found !== 1) fail("original native CloseHandle declaration");
  const declared = members(launcher);
  const properties = {
    'private sealed class LaunchPayload': ["string executable", "string[] args", "string workingDirectory", "string ackPath", "string filesBoundPath", "string continuePath", "string releaseToken", "string filesBoundToken", "string continueToken", "string ackToken", "ApprovedFile[] approvedFiles", "int executableBindingIndex", "bool requireExecutableBinding", "ArgumentBinding[] argumentBindings", "EnvironmentOverride[] targetEnvironmentOverrides", "int postResumeDelayMilliseconds"],
    'private sealed class ApprovedFile': ["string file", "string sha256", "long size"],
    'private sealed class ArgumentBinding': ["int index", "string prefix", "int bindingIndex"],
    'internal sealed class EnvironmentOverride': ["string name", "string value"],
  };
  for (const [signature, fields] of Object.entries(properties)) {
    const actual = members(region(launcher, signature));
    count(actual, fields.length);
    for (const field of fields) {
      const rows = actual.filter((member) => same(member.header, `public ${field}`));
      if (rows.length !== 1 || rows[0].body === null || !same(rows[0].body, "get; set;")) fail(`value receiver property ${field}`);
    }
  }
  const native = [
    ['IntPtr CreateJobObjectW(IntPtr jobAttributes, string name)', true, false],
    ['bool SetInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint informationLength)', false, true],
    ['bool QueryInformationJobObject(IntPtr job, int informationClass, out JobObjectBasicAccountingInformation information, uint informationLength, IntPtr returnLength)', false, true],
    ['bool TerminateJobObject(IntPtr job, uint exitCode)', false, true],
    ['bool AssignProcessToJobObject(IntPtr job, IntPtr process)', false, true],
    ['uint ResumeThread(IntPtr thread)', false, false],
    ['uint WaitForSingleObject(IntPtr handle, uint milliseconds)', false, false],
    ['bool GetExitCodeProcess(IntPtr process, out uint exitCode)', false, true],
    ['bool TerminateProcess(IntPtr process, uint exitCode)', false, true],
    ['bool CloseHandle(IntPtr handle)', false, true],
    ['IntPtr GetStdHandle(int standardHandle)', false, false],
    ['uint GetFinalPathNameByHandleW(IntPtr file, StringBuilder filePath, uint filePathLength, uint flags)', true, false],
    ['bool CreateProcessW(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref StartupInfo startupInfo, out ProcessInformation processInformation)', true, true],
  ];
  for (const [signature, unicode, boolean] of native) {
    const name = tokens(signature)[1];
    const candidates = declared.filter((member) => member.header.some((token, at) => token === name && member.header[at + 1] === "("));
    const header = `[DllImport("kernel32.dll", ${unicode ? "CharSet = CharSet.Unicode, " : ""}SetLastError = true)] ${boolean ? "[return: MarshalAs(UnmanagedType.Bool)] " : ""}private static extern ${signature}`;
    if (candidates.length !== 1 || candidates[0].body !== null || !same(candidates[0].header, header)) fail(`original native effect binding ${name}`);
  }
  for (const constant of ["private const uint CreateSuspended = 0x00000004", "private const uint Infinite = 0xFFFFFFFF", "private const uint WaitObject0 = 0",
    "private const uint JobObjectLimitKillOnJobClose = 0x00002000", "private const int JobObjectExtendedLimitInformationClass = 9",
    'private const string PayloadEnvironmentName = "SERVICE_LASSO_MANAGED_LAUNCH_PAYLOAD"', 'private const string GateEnvironmentName = "SERVICE_LASSO_MANAGED_LAUNCH_GATE"',
    'private const string ProgressEnvironmentName = "SERVICE_LASSO_MANAGED_LAUNCH_PROGRESS_TOKEN"', "private static string progressToken", "private static HMACSHA256 progressHmac"])
    if (declared.filter((member) => member.body === null && same(member.header, constant)).length !== 1) fail("original lifecycle constant/field binding");
  const layouts = {
    JobObjectBasicAccountingInformation: ["public long TotalUserTime", "public long TotalKernelTime", "public long ThisPeriodTotalUserTime", "public long ThisPeriodTotalKernelTime", "public uint TotalPageFaultCount", "public uint TotalProcesses", "public uint ActiveProcesses", "public uint TotalTerminatedProcesses"],
    JobObjectBasicLimitInformation: ["public long PerProcessUserTimeLimit", "public long PerJobUserTimeLimit", "public uint LimitFlags", "public UIntPtr MinimumWorkingSetSize", "public UIntPtr MaximumWorkingSetSize", "public uint ActiveProcessLimit", "public UIntPtr Affinity", "public uint PriorityClass", "public uint SchedulingClass"],
    IoCounters: ["public ulong ReadOperationCount", "public ulong WriteOperationCount", "public ulong OtherOperationCount", "public ulong ReadTransferCount", "public ulong WriteTransferCount", "public ulong OtherTransferCount"],
    JobObjectExtendedLimitInformation: ["public JobObjectBasicLimitInformation BasicLimitInformation", "public IoCounters IoInfo", "public UIntPtr ProcessMemoryLimit", "public UIntPtr JobMemoryLimit", "public UIntPtr PeakProcessMemoryUsed", "public UIntPtr PeakJobMemoryUsed"],
    ProcessInformation: ["public IntPtr hProcess", "public IntPtr hThread", "public uint dwProcessId", "public uint dwThreadId"],
  };
  for (const [name, fields] of Object.entries(layouts)) {
    const candidates = declared.filter((member) => member.header.includes(name) && member.header.includes("struct"));
    if (candidates.length !== 1 || !same(candidates[0].header, `[StructLayout(LayoutKind.Sequential)] private struct ${name}`)) fail(`native layout header ${name}`);
    const actual = members(candidates[0].body);
    count(actual, fields.length);
    // Native layout field order is significant, unlike a managed initializer.
    fields.forEach((field, at) => { if (actual[at].body !== null || !same(actual[at].header, field)) fail(`native layout field ${name}`); });
  }
  const startup = declared.filter((member) => member.header.includes("struct") && member.header.includes("StartupInfo"));
  if (startup.length !== 1 || !same(startup[0].header, "[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct StartupInfo")) fail("original StartupInfo layout header");
  const startupFields = ["int cb", "string lpReserved", "string lpDesktop", "string lpTitle", "int dwX", "int dwY", "int dwXSize", "int dwYSize", "int dwXCountChars", "int dwYCountChars", "int dwFillAttribute", "int dwFlags", "short wShowWindow", "short cbReserved2", "IntPtr lpReserved2", "IntPtr hStdInput", "IntPtr hStdOutput", "IntPtr hStdError"];
  const startupMembers = members(startup[0].body); count(startupMembers, startupFields.length);
  startupFields.forEach((field, at) => { if (startupMembers[at].body !== null || !same(startupMembers[at].header, `public ${field}`)) fail("original StartupInfo layout field"); });
  owningCallees(launcher);
  valueCalleeClosure(launcher);
}

// The caller's non-retirement expressions have a closed call/assignment universe.
// No caller expression may leak invocation/roster/file/handle aliases except the
// explicitly named effect roles below. Pure/read calls cannot receive an owner.
const callerCalls = new Set([
  "ValidateNativeLayouts", "InitializeProgress", "SetProgress", "Environment.GetEnvironmentVariable",
  "String.IsNullOrWhiteSpace", "IsFullyQualifiedWindowsPath", "Convert.FromBase64String", "String.Equals",
  "Convert.ToBase64String", "StrictUtf8.GetString", "Array.Clear", "ParseLaunchPayload", "ValidatePayload",
  "WaitForGate", "TimeSpan.FromSeconds", "ValidateApprovedFile", "SHA256.Create", "ToLowerHex",
  "GetFinalPathNameByHandleW", "NormalizeFinalPath", "finalPathBuffer.ToString", "Path.IsPathRooted", "BoundPathAt",
  "payload.args.Clone", "File.WriteAllText", "CreateJobObjectW", "Marshal.GetLastWin32Error", "ConfigureKillOnClose",
  "Marshal.SizeOf", "typeof", "GetStdHandle", "BuildCommandLine", "File.Exists", "Directory.Exists",
  "CreateProcessW", "TargetCreationFailureExitCode", "AssignProcessToJobObject", "ResumeThread", "Thread.Sleep",
  "processInformation.dwProcessId.ToString", "WaitForSingleObject", "unchecked", "GetExitCodeProcess",
]);
const callerWrites = new Set([
  "encodedPayload", "gatePath", "payloadBytes", "payloadJson", "payload", "boundFilePaths", "approvedFile",
  "actualSha256", "finalPathBuffer", "finalPathLength", "finalPath", "resolvedExecutable", "resolvedArgs", "boundPath",
  "failureExitCode", "startupInfo", "startupInfo.cb", "startupInfo.dwFlags", "startupInfo.wShowWindow",
  "startupInfo.hStdInput", "startupInfo.hStdOutput", "startupInfo.hStdError", "commandLine", "targetCreated",
  "targetCreationError", "original", "acknowledgment", "targetWait", "targetWaitError",
]);
const declarations = new Set(["string", "byte", "LaunchPayload", "ApprovedFile", "FileStream", "StringBuilder", "uint", "bool", "int", "StartupInfo", "ProcessInformation", "Win32Exception", "OriginalObservation"]);
// Reads are closed as well as calls/writes. An unknown receiver could be a
// property getter carrying a hidden alias mutation even without call tokens.
const callerIdentifiers = new Set([
  ...declarations, ...[...callerCalls].flatMap((value) => value.split(".")),
  ...[...callerWrites].flatMap((value) => value.split(".")),
  "new", "throw", "return", "true", "false", "null", "ref", "out",
  "payload", "index", "argumentBinding", "sha256", "exitCode", "System", "Globalization", "CultureInfo", "InvariantCulture",
  "PayloadEnvironmentName", "GateEnvironmentName", "EnvironmentVariableTarget", "Process", "MaximumPayloadCharacters",
  "StringComparison", "Ordinal", "StrictUtf8", "Length", "approvedFiles", "args", "executable", "executableBindingIndex",
  "argumentBindings", "bindingIndex", "prefix", "Empty", "Capacity", "ToString", "cb", "dwFlags", "wShowWindow",
  "hStdInput", "hStdOutput", "hStdError", "StartfUseShowWindow", "StartfUseStdHandles", "StdInputHandle", "StdOutputHandle", "StdErrorHandle",
  "UInt32", "MaxValue", "FailureExitCodeJobCreation", "FailureExitCodeTargetCreation", "FailureExitCodeResolvedExecutableMissing",
  "InvalidOperationException",
  "FailureExitCodeWorkingDirectoryMissing", "FailureExitCodeJobAssignment", "FailureExitCodeTargetResume", "FailureExitCodeTargetThreadClose",
  "FailureExitCodeAcknowledgmentWrite",
]);
const controls = new Set([
  "String.IsNullOrWhiteSpace(encodedPayload) || encodedPayload.Length > MaximumPayloadCharacters || String.IsNullOrWhiteSpace(gatePath) || !IsFullyQualifiedWindowsPath(gatePath)",
  "!String.Equals(Convert.ToBase64String(payloadBytes), encodedPayload, StringComparison.Ordinal)",
  "invocation.Failed", "boundFile.Length != approvedFile.size",
  "!String.Equals(actualSha256, approvedFile.sha256, StringComparison.Ordinal)",
  "finalPathLength == 0 || finalPathLength >= finalPathBuffer.Capacity", "!Path.IsPathRooted(finalPath)",
  "payload.requireExecutableBinding && payload.executableBindingIndex < 0", "payload.executableBindingIndex >= 0",
  "argumentBinding == null || argumentBinding.index < 0 || argumentBinding.index >= resolvedArgs.Length",
  "jobHandle == IntPtr.Zero", "!File.Exists(resolvedExecutable)", "!Directory.Exists(payload.workingDirectory)",
  "!targetCreated", "targetCreated", "invocation.Primary == null",
  "processHandle == IntPtr.Zero || threadHandle == IntPtr.Zero || processInformation.dwProcessId == 0",
  "!AssignProcessToJobObject(jobHandle, processHandle)", "ResumeThread(threadHandle) == UInt32.MaxValue",
  "payload.postResumeDelayMilliseconds > 0", '!invocation.Release(ref threadHandle, "target-thread-release", 0)',
  "original.Exception != null", "targetWait != WaitObject0", "!GetExitCodeProcess(processHandle, out exitCode)",
].map((value) => tokens(value).join(" ")));
const protectedNames = new Set(["invocation", "boundFiles", "boundFile", "jobHandle", "processHandle", "threadHandle", "targetAssignedToJob", "targetCreated", "processInformation", "original", "Outcomes", "Files", "Primary", "PrimaryResult", "Failed", "Exception"]);
const ownershipEffects = [
  "ClearLaunchEnvironment(invocation)", "ThrowOriginalRetirementFailure(invocation)",
  "ValidateNativeLayouts()", "InitializeProgress()",
  "FileStream boundFile = new FileStream(approvedFile.file, FileMode.Open, FileAccess.Read, FileShare.Read)",
  "boundFiles.Add(boundFile)", "actualSha256 = ToLowerHex(sha256.ComputeHash(boundFile))",
  "boundFiles.Capacity = checked(boundFiles.Count + payload.approvedFiles.Length)",
  "uint finalPathLength = GetFinalPathNameByHandleW(boundFile.SafeFileHandle.DangerousGetHandle(), finalPathBuffer, (uint)finalPathBuffer.Capacity, 0)",
  "RetireProgress(invocation)", "jobHandle = CreateJobObjectW(IntPtr.Zero, null)", "ConfigureKillOnClose(jobHandle)",
  "ApplyTargetEnvironmentOverrides(payload.targetEnvironmentOverrides, invocation)",
  "invocation.ChildIssuanceUnresolved = true", "invocation.ChildIssuanceUnresolved = false",
  "ProcessInformation processInformation",
  "bool targetCreated",
  "targetCreated = CreateProcessW(resolvedExecutable, commandLine, IntPtr.Zero, IntPtr.Zero, true, CreateSuspended, IntPtr.Zero, payload.workingDirectory, ref startupInfo, out processInformation)",
  'Win32Exception original = new Win32Exception(targetCreationError, "Managed target creation failed.")', "throw original",
  "invocation.Primary = original", 'invocation.ObservePrimary("target-original-create", targetCreationError, true, original)',
  "processHandle = processInformation.hProcess", "threadHandle = processInformation.hThread",
  'invocation.Observe("target-original-create", 0, false, null)',
  'invocation.Observe("target-original-create-throw", 0, true, original)',
  "ClearTargetEnvironmentOverrides(payload.targetEnvironmentOverrides, invocation, payload.targetEnvironmentOverrides.Length)",
  'invocation.Observe("target-environment-retirement-unknown-return", 0, true, later)',
  "targetAssignedToJob = true", 'OriginalObservation original = invocation.Outcomes.Find(o => o.Site == "target-thread-release" && o.Attempted)',
  'throw new Win32Exception(original.NativeStatus, "Managed target thread handle close failed.")',
  'string acknowledgment = "{\\"token\\":\\"" + payload.ackToken + "\\",\\"pid\\":" + processInformation.dwProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}"',
  "throw original.Exception", "uint targetWait = WaitForSingleObject(processHandle, Infinite)",
  "invocation.PrimaryWaitPending = true", "invocation.PrimaryWaitPending = false",
  "invocation.PrimaryWaitFailed = targetWait != WaitObject0",
  'invocation.Observe("target-primary-wait", targetWaitError, targetWait != WaitObject0, null)',
  "invocation.PrimaryResult = unchecked((int)exitCode)", "return invocation.PrimaryResult",
  "invocation.Primary = primary", "invocation.PrimaryResult = failureExitCode",
  "Thread.Sleep(payload.postResumeDelayMilliseconds)",
  "WaitForGate(gatePath, payload.releaseToken, TimeSpan.FromSeconds(45))",
  "WaitForGate(payload.continuePath, payload.continueToken, TimeSpan.FromSeconds(45))",
  "Array.Clear(payloadBytes, 0, payloadBytes.Length)",
  "File.WriteAllText(payload.filesBoundPath, payload.filesBoundToken, StrictUtf8)",
  "File.WriteAllText(payload.ackPath, acknowledgment, StrictUtf8)",
].map(tokens);

function safeExpression(expression) {
  if (!expression.length) fail("empty expression");
  if (expression.includes(":") && !expression.includes("?")) fail("unsupported label");
  const boundedEffects = ["Thread", "WaitForGate", "Array", "File"];
  if (expression.some((value, at) => boundedEffects.includes(value) && (value !== "File" || expression[at + 2] === "WriteAllText") && (value !== "Thread" || expression[at + 2] === "Sleep"))) {
    if (!ownershipEffects.some((value) => same(expression, value))) fail("unknown bounded caller effect");
    return;
  }
  // Only these original effect expressions can mention a protected identity.
  if (expression.some((value) => protectedNames.has(value))) {
    if (!ownershipEffects.some((value) => same(expression, value))) fail("unknown ownership effect/alias");
    return;
  }
  if (expression[0] === "return") { if (!same(expression, "return failureExitCode")) fail("alternate return"); return; }
  if (expression[0] === "throw") {
    if (!same(expression, "throw") && !same(expression, "throw original") && !["InvalidOperationException", "Win32Exception"].includes(expression[2])) fail("unknown exception effect");
  }
  for (const value of expression) if (/^[A-Za-z_][A-Za-z_0-9]*$/u.test(value) && !callerIdentifiers.has(value)) fail(`unknown read receiver ${value}`);
  // Arrow/lambda/initializer/local-function effects are confined to declared
  // ownership roles. No ref/out alias can escape through a newly added call.
  for (const value of ["=>", "{", "}", "++", "|=", "+="]) if (expression.includes(value)) fail("unsupported expression effect");
  const assignments = expression.flatMap((value, at) => value === "=" ? [at] : []);
  if (assignments.length > 1) fail("chained assignment");
  if (!assignments.length && expression[0] !== "throw") {
    const declaration = ["byte[] payloadBytes", "string payloadJson", "LaunchPayload payload", "string actualSha256", "uint exitCode"].some((value) => same(expression, value));
    const call = expression[1] === "(" || (expression[1] === "." && expression[3] === "(");
    if (!declaration && (!call || expression.at(-1) !== ")")) fail("unknown expression statement");
  }
  if (assignments.length) {
    let left = expression.slice(0, assignments[0]);
    if (declarations.has(left[0])) left = left.slice(1);
    if (same(left.slice(0, 2), "[ ]")) left = left.slice(2);
    const target = left.join("");
    if (!callerWrites.has(target) && !same(left, "boundFilePaths[index]") && !same(left, "resolvedArgs[argumentBinding.index]")) fail("unknown write target");
    if (target === "failureExitCode" && ![
      "FailureExitCodeJobCreation", "FailureExitCodeTargetCreation", "FailureExitCodeResolvedExecutableMissing", "FailureExitCodeWorkingDirectoryMissing",
      "FailureExitCodeJobAssignment", "FailureExitCodeTargetResume", "FailureExitCodeTargetThreadClose", "FailureExitCodeAcknowledgmentWrite",
      "TargetCreationFailureExitCode(targetCreationError)",
    ].some((value) => same(expression.slice(assignments[0] + 1), value))) fail("original failure result replacement");
  }
  for (let at = 0; at < expression.length - 1; at += 1) {
    if (expression[at + 1] !== "(" || !/^[A-Za-z_]/u.test(expression[at])) continue;
    let start = at;
    while (start >= 2 && expression[start - 1] === ".") start -= 2;
    const name = expression.slice(start, at + 1).join("");
    if (expression[start - 1] === "new") {
      if (!["InvalidOperationException", "Win32Exception", "StringBuilder", "StartupInfo"].includes(name)) fail("unknown constructor effect");
    } else if (!callerCalls.has(name)) fail(`unknown call effect ${name}`);
  }
  if (expression.includes("ref") || expression.includes("out")) {
    if (!same(expression, "targetCreated = CreateProcessW(resolvedExecutable, commandLine, IntPtr.Zero, IntPtr.Zero, true, CreateSuspended, IntPtr.Zero, payload.workingDirectory, ref startupInfo, out processInformation)")) fail("unexamined by-reference effect");
  }
}

function caller(nodes) {
  count(nodes, 7);
  ["IntPtr jobHandle = IntPtr.Zero", "IntPtr processHandle = IntPtr.Zero", "IntPtr threadHandle = IntPtr.Zero", "bool targetAssignedToJob = false", "List<FileStream> boundFiles = invocation.Files", "int failureExitCode = FailureExitCodeUnknown"].forEach((value, at) => requireLeaf(nodes[at], value));
  const outer = nodes[6];
  if (outer.kind !== "try" || outer.catches.length !== 1 || !same(outer.catches[0].binding, "Exception primary") || outer.final === null) fail("whole caller exception enclosure");
  const handler = outer.catches[0].body;
  count(handler, 4);
  branch(handler[0], "invocation.Primary == null", ["invocation.Primary = primary"]);
  requireLeaf(handler[1], "invocation.PrimaryResult = failureExitCode");
  branch(handler[2], "invocation.PrimaryWaitPending", ['invocation.Observe("target-primary-wait-unavailable", 0, true, primary)']);
  requireLeaf(handler[3], "return failureExitCode");
  finalizer(outer.final);

  const seen = new Map(), loops = [], returns = [], predicates = new Map(), events = [];
  function walk(body, ancestors = []) {
    for (const node of body) {
      if (node.kind === "leaf") {
        safeExpression(node.expression);
        const key = node.expression.join(" ");
        if (!seen.has(key)) seen.set(key, []);
        seen.get(key).push({ node, ancestors, body });
        events.push(node);
        if (node.expression[0] === "return") returns.push(node);
      } else if (node.kind === "if") {
        if (!controls.has(node.condition.join(" "))) fail("unknown branch condition");
        const key = node.condition.join(" ");
        if (!predicates.has(key)) predicates.set(key, []);
        predicates.get(key).push({ node, ancestors, body });
        // The predicate is evaluated before the branch body, including when
        // that body is empty. Consume its effect role as an event in that order.
        events.push(node);
        walk(node.body, [...ancestors, node]);
      } else if (["for", "foreach", "using"].includes(node.kind)) {
        loops.push(node);
        const headers = { for: "int index = 0; index < payload.approvedFiles.Length; index += 1", foreach: "ArgumentBinding argumentBinding in payload.argumentBindings", using: "SHA256 sha256 = SHA256.Create()" };
        if (!same(node.condition, headers[node.kind])) fail("unknown iteration/resource owner");
        walk(node.body, [...ancestors, node]);
      } else if (node.kind === "try") {
        walk(node.body, [...ancestors, node]);
        for (const handler of node.catches) {
          if (!["", "Exception original", "Exception later"].some((value) => same(handler.binding, value))) fail("unknown caller exception binding");
          walk(handler.body, [...ancestors, node, handler]);
        }
        if (node.final) walk(node.final, [...ancestors, node, node.final]);
      } else fail("unsupported caller statement");
    }
  }
  walk(outer.body);
  if (loops.length !== 3 || !["for", "foreach", "using"].every((kind) => loops.filter((node) => node.kind === kind).length === 1)) fail("caller loop ownership");
  if (returns.length !== 1 || outer.body.at(-1) !== returns[0] || !leaf(returns[0], "return invocation.PrimaryResult")) fail("reachable original return");
  const lookup = (expression, number = 1) => {
    const found = seen.get(tokens(expression).join(" ")) ?? [];
    if (found.length !== number) fail(`once-only caller role ${expression}`);
    return found;
  };
  const predicate = (condition, number = 1) => {
    const found = predicates.get(tokens(condition).join(" ")) ?? [];
    if (found.length !== number) fail(`once-only predicate role ${condition}`);
    return found;
  };
  // Every control is consumed with original multiplicity. This also prevents
  // accepted pure branch text from enclosing/making an original effect optional.
  for (const condition of controls) predicate(condition, same(tokens(condition), "invocation.Failed") ? 3 : 1);
  const assignment = predicate("!AssignProcessToJobObject(jobHandle, processHandle)")[0];
  const resume = predicate("ResumeThread(threadHandle) == UInt32.MaxValue")[0];
  const release = predicate('!invocation.Release(ref threadHandle, "target-thread-release", 0)')[0];
  const exit = predicate("!GetExitCodeProcess(processHandle, out exitCode)")[0];
  for (const row of [assignment, resume, release, exit]) if (row.ancestors.length) fail("conditional original predicate effect");
  branch(assignment.node, "!AssignProcessToJobObject(jobHandle, processHandle)", ['throw new Win32Exception(Marshal.GetLastWin32Error(), "Managed target job assignment failed.")']);
  branch(resume.node, "ResumeThread(threadHandle) == UInt32.MaxValue", ['throw new Win32Exception(Marshal.GetLastWin32Error(), "Managed target resume failed.")']);
  count(release.node.body, 3);
  requireLeaf(release.node.body[0], 'OriginalObservation original = invocation.Outcomes.Find(o => o.Site == "target-thread-release" && o.Attempted)');
  branch(release.node.body[1], "original.Exception != null", ["throw original.Exception"]);
  requireLeaf(release.node.body[2], 'throw new Win32Exception(original.NativeStatus, "Managed target thread handle close failed.")');
  branch(exit.node, "!GetExitCodeProcess(processHandle, out exitCode)", ['throw new Win32Exception(Marshal.GetLastWin32Error(), "Managed target exit-code query failed.")']);
  const ordered = [
    lookup("ValidateNativeLayouts()")[0].node, lookup("InitializeProgress()")[0].node,
    lookup("ClearLaunchEnvironment(invocation)")[0].node,
    lookup("WaitForGate(gatePath, payload.releaseToken, TimeSpan.FromSeconds(45))")[0].node,
    lookup("boundFiles.Capacity = checked(boundFiles.Count + payload.approvedFiles.Length)")[0].node,
    lookup("FileStream boundFile = new FileStream(approvedFile.file, FileMode.Open, FileAccess.Read, FileShare.Read)")[0].node,
    lookup("boundFiles.Add(boundFile)")[0].node,
    lookup("actualSha256 = ToLowerHex(sha256.ComputeHash(boundFile))")[0].node,
    lookup("RetireProgress(invocation)")[0].node,
    lookup("File.WriteAllText(payload.filesBoundPath, payload.filesBoundToken, StrictUtf8)")[0].node,
    lookup("WaitForGate(payload.continuePath, payload.continueToken, TimeSpan.FromSeconds(45))")[0].node,
    lookup("jobHandle = CreateJobObjectW(IntPtr.Zero, null)")[0].node,
    lookup("ConfigureKillOnClose(jobHandle)")[0].node,
    lookup("ApplyTargetEnvironmentOverrides(payload.targetEnvironmentOverrides, invocation)")[0].node,
    lookup("invocation.ChildIssuanceUnresolved = true")[0].node,
    lookup("targetCreated = CreateProcessW(resolvedExecutable, commandLine, IntPtr.Zero, IntPtr.Zero, true, CreateSuspended, IntPtr.Zero, payload.workingDirectory, ref startupInfo, out processInformation)")[0].node,
    lookup("processHandle = processInformation.hProcess")[0].node,
    lookup("threadHandle = processInformation.hThread")[0].node,
    lookup("ClearTargetEnvironmentOverrides(payload.targetEnvironmentOverrides, invocation, payload.targetEnvironmentOverrides.Length)")[0].node,
    predicate("processHandle == IntPtr.Zero || threadHandle == IntPtr.Zero || processInformation.dwProcessId == 0")[0].node,
    lookup("invocation.ChildIssuanceUnresolved = false", 2).find(row => row.ancestors.length === 0)?.node,
    assignment.node, lookup("targetAssignedToJob = true")[0].node, resume.node,
    lookup("Thread.Sleep(payload.postResumeDelayMilliseconds)")[0].node, release.node,
    lookup("File.WriteAllText(payload.ackPath, acknowledgment, StrictUtf8)")[0].node,
    lookup("invocation.PrimaryWaitPending = true")[0].node,
    lookup("uint targetWait = WaitForSingleObject(processHandle, Infinite)")[0].node,
    lookup("invocation.PrimaryWaitFailed = targetWait != WaitObject0")[0].node,
    lookup('invocation.Observe("target-primary-wait", targetWaitError, targetWait != WaitObject0, null)')[0].node,
    lookup("invocation.PrimaryWaitPending = false")[0].node,
    predicate("targetWait != WaitObject0")[0].node, exit.node,
    lookup("invocation.PrimaryResult = unchecked((int)exitCode)")[0].node, returns[0],
  ].map((node) => events.indexOf(node));
  if (ordered.some((position, at) => position < 0 || (at && position <= ordered[at - 1]))) fail("original lifecycle effect order");
  const waitAt = outer.body.indexOf(lookup("invocation.PrimaryWaitPending = true")[0].node);
  // Pending is immediately before THIS initiating call, never an earlier
  // unrelated operation; observation is complete before it can be resolved.
  ["invocation.PrimaryWaitPending = true", "uint targetWait = WaitForSingleObject(processHandle, Infinite)",
    "int targetWaitError = targetWait == UInt32.MaxValue ? Marshal.GetLastWin32Error() : unchecked((int)targetWait)",
    "invocation.PrimaryWaitFailed = targetWait != WaitObject0",
    'invocation.Observe("target-primary-wait", targetWaitError, targetWait != WaitObject0, null)',
    "invocation.PrimaryWaitPending = false"].forEach((effect, at) => requireLeaf(outer.body[waitAt + at], effect));
  // Cardinality excludes additional accepted-looking calls/writes as well as
  // indirect aliases. Location excludes unreachable/conditional original roles.
  for (const effect of ownershipEffects) {
    if (["invocation.Primary = primary", "invocation.PrimaryResult = failureExitCode"].some((value) => same(effect, value))) continue;
    lookup(effect.join(" "), same(effect, "ThrowOriginalRetirementFailure(invocation)") ? 3 : same(effect, "invocation.Primary = original") || same(effect, "invocation.ChildIssuanceUnresolved = false") ? 2 : 1);
  }
  const acquired = lookup("FileStream boundFile = new FileStream(approvedFile.file, FileMode.Open, FileAccess.Read, FileShare.Read)")[0];
  const roster = lookup("boundFiles.Add(boundFile)")[0];
  const files = loops.find((node) => node.kind === "for");
  const reservation = lookup('boundFiles.Capacity = checked(boundFiles.Count + payload.approvedFiles.Length)')[0];
  if (reservation.ancestors.length || outer.body.indexOf(reservation.node) !== outer.body.indexOf(files) - 1) fail('file roster capacity reserved before original acquisition');
  if (acquired.ancestors.length !== 1 || acquired.ancestors[0] !== files || roster.ancestors.length !== 1 || roster.ancestors[0] !== files || files.body.indexOf(roster.node) !== files.body.indexOf(acquired.node) + 1) fail("reachable original file acquisition/roster");
  for (const expression of ["ValidateNativeLayouts()", "InitializeProgress()", "jobHandle = CreateJobObjectW(IntPtr.Zero, null)", "ConfigureKillOnClose(jobHandle)", "ApplyTargetEnvironmentOverrides(payload.targetEnvironmentOverrides, invocation)", "targetAssignedToJob = true", "invocation.PrimaryWaitPending = true", "uint targetWait = WaitForSingleObject(processHandle, Infinite)", "invocation.PrimaryWaitPending = false", "invocation.PrimaryResult = unchecked((int)exitCode)"]) {
    if (lookup(expression)[0].ancestors.length) fail("conditional original caller effect");
  }
  const sleeping = lookup("Thread.Sleep(payload.postResumeDelayMilliseconds)")[0];
  if (sleeping.ancestors.length !== 1 || sleeping.ancestors[0].kind !== "if" || !same(sleeping.ancestors[0].condition, "payload.postResumeDelayMilliseconds > 0")) fail("bounded original delay");
  for (const expression of ["processHandle = processInformation.hProcess", "threadHandle = processInformation.hThread"]) {
    const row = lookup(expression)[0];
    if (row.ancestors.length !== 2 || row.ancestors[0].kind !== "try" || row.ancestors[1].kind !== "if" || !same(row.ancestors[1].condition, "targetCreated")) fail("original created handle aliases");
  }
  const create = lookup("targetCreated = CreateProcessW(resolvedExecutable, commandLine, IntPtr.Zero, IntPtr.Zero, true, CreateSuspended, IntPtr.Zero, payload.workingDirectory, ref startupInfo, out processInformation)")[0];
  const creation = create.ancestors[0];
  if (create.ancestors.length !== 1 || creation.kind !== "try" || creation.catches.length !== 1 || !same(creation.catches[0].binding, "Exception original") || creation.final === null) fail("original creation enclosure");
  count(creation.body, 4);
  requireLeaf(creation.body[0], "invocation.ChildIssuanceUnresolved = true");
  if (creation.body[1] !== create.node) fail("creation precedes original handle publication");
  branch(creation.body[2], "!targetCreated", ["targetCreationError = Marshal.GetLastWin32Error()", "failureExitCode = TargetCreationFailureExitCode(targetCreationError)", 'Win32Exception original = new Win32Exception(targetCreationError, "Managed target creation failed.")', "invocation.Primary = original", "invocation.ChildIssuanceUnresolved = false", 'invocation.ObservePrimary("target-original-create", targetCreationError, true, original)', "throw original"]);
  branch(creation.body[3], "targetCreated", ["processHandle = processInformation.hProcess", "threadHandle = processInformation.hThread", 'invocation.Observe("target-original-create", 0, false, null)']);
  count(creation.catches[0].body, 2);
  branch(creation.catches[0].body[0], "invocation.Primary == null", ["invocation.Primary = original", 'invocation.Observe("target-original-create-throw", 0, true, original)']);
  requireLeaf(creation.catches[0].body[1], "throw");
  const resolved = lookup("invocation.ChildIssuanceUnresolved = false", 2);
  if (resolved.filter(row => row.ancestors.length === 0).length !== 1 ||
      resolved.filter(row => row.ancestors.length === 2 && row.ancestors[0] === creation && row.ancestors[1] === creation.body[2]).length !== 1)
    fail("issuance resolved only by original FALSE or valid original TRUE evidence");
  count(creation.final, 1);
  caught(creation.final[0], ["ClearTargetEnvironmentOverrides(payload.targetEnvironmentOverrides, invocation, payload.targetEnvironmentOverrides.Length)"], "Exception later", ['invocation.Observe("target-environment-retirement-unknown-return", 0, true, later)']);
}

// F19: classify original known failed effects separately from unresolved
// issuance/closure and consume each directory route settlement statement.
function directorySettlement(launcher) {
  const wait = method(launcher, "internal static bool ObserveDirectorySyncChildWait(ManagedInvocation invocation, IntPtr childProcess)");
  count(wait, 4);
  ['uint waited = WaitForSingleObject(childProcess, Infinite)',
    'int status = waited == UInt32.MaxValue ? Marshal.GetLastWin32Error() : unchecked((int)waited)',
    'invocation.Observe("directory-sync-child-wait", status, waited != WaitObject0, null)',
    'return waited == WaitObject0'].forEach((role, at) => requireLeaf(wait[at], role));
  const query = method(launcher, "internal static bool ObserveDirectorySyncChildExit(ManagedInvocation invocation, IntPtr childProcess, out uint exitCode)");
  count(query, 6);
  requireLeaf(query[0], 'bool exitKnown = GetExitCodeProcess(childProcess, out exitCode)');
  requireLeaf(query[1], 'int exitError = exitKnown ? 0 : Marshal.GetLastWin32Error()');
  requireLeaf(query[2], 'Win32Exception original = exitKnown ? null : new Win32Exception(exitError, "Directory sync child exit-code query failed.")');
  branch(query[3], '!exitKnown', ['invocation.Primary = original']);
  requireLeaf(query[4], 'invocation.ObservePrimary("directory-sync-child-exit-query", exitError, !exitKnown, original)');
  requireLeaf(query[5], 'return exitKnown');
  const finish = method(launcher, 'internal static void FinishDirectorySyncInvocation(ManagedInvocation invocation, bool childClosed, ref IntPtr childThread, ref IntPtr childProcess, ref IntPtr directory)');
  count(finish, 6);
  branch(finish[0], 'invocation.ChildIssuanceUnresolved || (childProcess != IntPtr.Zero && !childClosed)', ['RetainManagedInvocation(invocation)']);
  ['invocation.Release(ref childThread, "directory-sync-thread-release", 0)',
    'invocation.Release(ref childProcess, "directory-sync-process-release", 0)',
    'invocation.Release(ref directory, "directory-sync-directory-release", 0)'].forEach((role, at) => recordingProtected(finish[at + 1], role));
  const fileLoop = finish[4];
  if (fileLoop?.kind !== 'for' || !same(fileLoop.condition, 'int ordinal = 0; ordinal < invocation.Files.Count; ordinal++')) fail('every original directory file loop');
  count(fileLoop.body, 1); recordingProtected(fileLoop.body[0], 'invocation.ReleaseFile(invocation.Files[ordinal], ordinal)');
  branch(finish[5], 'invocation.Failed', ['RetainManagedInvocation(invocation)']);
  const route = method(launcher, 'private static int RunDirectorySyncLaunch(string encodedPayload)');
  count(route, 7);
  ['FileStream helperHandle = null', 'IntPtr directoryHandle = IntPtr.Zero', 'IntPtr childProcess = IntPtr.Zero',
    'IntPtr childThread = IntPtr.Zero', 'ManagedInvocation invocation = new ManagedInvocation(new List<FileStream>())',
    'bool childClosed = false'].forEach((role, at) => requireLeaf(route[at], role));
  const owned = route[6];
  if (owned.kind !== 'try' || owned.catches.length !== 1 || !same(owned.catches[0].binding, 'Exception primary') || !owned.final) fail('original directory invocation enclosure');
  count(owned.body, 41); count(owned.catches[0].body, 3); count(owned.final, 4);
  requireLeaf(owned.body[8], 'invocation.Files.Capacity = 1');
  // Consume the sole pre-acquisition reservation before the unchanged roles.
  owned.body.splice(8, 1);
  ['invocation.Primary = primary', 'invocation.PrimaryResult = DirectorySyncLaunchBindingInvalid', 'return DirectorySyncLaunchBindingInvalid'].forEach((role, at) => requireLeaf(owned.catches[0].body[at], role));
  ['invocation.Process = childProcess', 'invocation.Thread = childThread', 'invocation.Directory = directoryHandle',
    'FinishDirectorySyncInvocation(invocation, childClosed, ref childThread, ref childProcess, ref directoryHandle)'].forEach((role, at) => requireLeaf(owned.final[at], role));
  const effects = new Map([
    [0, 'byte[] payloadBytes = Convert.FromBase64String(encodedPayload)'], [1, 'string payloadJson'],
    [3, 'DirectorySyncLaunchPayload payload = ParseDirectorySyncLaunchPayload(payloadJson)'],
    [5, 'string requestedHelper = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(typeof(ServiceLassoManagedLauncherNative).Assembly.Location), DirectorySyncHelperRelativePath))'],
    [6, 'string requestedDirectory = Path.GetFullPath(payload.directory)'],
    [8, 'helperHandle = new FileStream(requestedHelper, FileMode.Open, FileAccess.Read, FileShare.Read)'], [9, 'invocation.Files.Add(helperHandle)'], [11, 'string helperDigest'],
    [14, 'string helperFinalPath = FinalPathForHandle(helperHandle.SafeFileHandle.DangerousGetHandle())'],
    [16, 'directoryHandle = CreateFileW(requestedDirectory, GenericRead, ShareRead | ShareWrite, IntPtr.Zero, OpenExisting, FileFlagBackupSemantics, IntPtr.Zero)'],
    [18, 'string directoryFinalPath = FinalPathForHandle(directoryHandle)'], [20, 'WaitForDirectorySyncTestGate()'],
    [21, 'StartupInfo startupInfo = new StartupInfo()'], [22, 'startupInfo.cb = Marshal.SizeOf(typeof(StartupInfo))'], [23, 'ProcessInformation processInformation'],
    [24, 'StringBuilder commandLine = new StringBuilder(BuildCommandLine(helperFinalPath, new[] { directoryFinalPath }))'],
    [25, 'invocation.ChildIssuanceUnresolved = true'],
    [26, 'bool childCreated = CreateProcessW(helperFinalPath, commandLine, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, null, ref startupInfo, out processInformation)'],
    [28, 'childProcess = processInformation.hProcess'], [29, 'childThread = processInformation.hThread'],
    [30, 'invocation.ObservePrimary("directory-sync-child-create", 0, false, null)'], [32, 'invocation.ChildIssuanceUnresolved = false'],
    [33, 'childClosed = ObserveDirectorySyncChildWait(invocation, childProcess)'], [35, 'uint exitCode'],
    [36, 'bool exitKnown = ObserveDirectorySyncChildExit(invocation, childProcess, out exitCode)'], [38, 'invocation.PrimaryResult = 0'], [39, 'return 0'],
  ]);
  for (const [at, role] of effects) requireLeaf(owned.body[at], role);
  const bytes = owned.body[2];
  if (bytes.kind !== 'try' || bytes.catches.length || !bytes.final) fail('directory original payload bytes');
  count(bytes.body, 2); count(bytes.final, 1);
  branch(bytes.body[0], '!String.Equals(Convert.ToBase64String(payloadBytes), encodedPayload, StringComparison.Ordinal)', ['return DirectorySyncLaunchPayloadInvalid']);
  requireLeaf(bytes.body[1], 'payloadJson = StrictUtf8.GetString(payloadBytes)');
  requireLeaf(bytes.final[0], 'Array.Clear(payloadBytes, 0, payloadBytes.Length)');
  branch(owned.body[4], 'payload == null || !IsFullyQualifiedWindowsPath(payload.directory)', ['return DirectorySyncLaunchPayloadInvalid']);
  branch(owned.body[7], '(File.GetAttributes(requestedHelper) & FileAttributes.ReparsePoint) != 0', ['return DirectorySyncLaunchBindingInvalid']);
  branch(owned.body[10], 'helperHandle.Length != DirectorySyncHelperByteLength', ['return DirectorySyncLaunchBindingInvalid']);
  branch(owned.body[12], 'SHA256 sha256 = SHA256.Create()', ['helperDigest = ToLowerHex(sha256.ComputeHash(helperHandle))'], 'using');
  branch(owned.body[13], '!String.Equals(helperDigest, DirectorySyncHelperSha256, StringComparison.Ordinal)', ['return DirectorySyncLaunchBindingInvalid']);
  branch(owned.body[15], '!SameWindowsPath(helperFinalPath, requestedHelper)', ['return DirectorySyncLaunchBindingInvalid']);
  branch(owned.body[17], 'directoryHandle == new IntPtr(-1)', ['directoryHandle = IntPtr.Zero', 'return DirectorySyncLaunchBindingInvalid']);
  branch(owned.body[19], '!SameWindowsPath(directoryFinalPath, requestedDirectory)', ['return DirectorySyncLaunchBindingInvalid']);
  branch(owned.body[27], '!childCreated', ['int createError = Marshal.GetLastWin32Error()',
    'Win32Exception original = new Win32Exception(createError, "Directory sync child creation failed.")', 'invocation.Primary = original',
    'invocation.PrimaryResult = DirectorySyncLaunchCreateFailed', 'invocation.ObservePrimary("directory-sync-child-create", createError, true, original)',
    'invocation.ChildIssuanceUnresolved = false', 'return DirectorySyncLaunchCreateFailed']);
  branch(owned.body[31], 'childProcess == IntPtr.Zero || childThread == IntPtr.Zero || processInformation.dwProcessId == 0', ['throw new InvalidOperationException("Directory sync child process evidence was invalid.")']);
  branch(owned.body[34], '!childClosed', ['invocation.PrimaryResult = DirectorySyncLaunchChildFailed', 'return DirectorySyncLaunchChildFailed']);
  branch(owned.body[37], '!exitKnown || exitCode != 0', ['invocation.PrimaryResult = DirectorySyncLaunchChildFailed', 'return DirectorySyncLaunchChildFailed']);
}

export function assertManagedClosureSourceConformance(source) {
  const all = tokens(source);
  const launcher = region(all, "public static class ServiceLassoManagedLauncherNative");
  const invocation = region(launcher, "internal sealed class ManagedInvocation");
  typeBindings(all, launcher);
  invocationBindings(invocation);
  // A real method in an unrelated/nested class cannot supply an owning role.
  const entry = method(launcher, "public static int Main()");
  count(entry, 4);
  caught(entry[0], ["AssertBootstrapEnvironmentSanitized()"], "", ["return FailureExitCodeUnknown"]);
  requireLeaf(entry[1], "string directorySyncPayload = Environment.GetEnvironmentVariable(DirectorySyncPayloadEnvironmentName, EnvironmentVariableTarget.Process)");
  branch(entry[2], "!String.IsNullOrWhiteSpace(directorySyncPayload)", ["return RunDirectorySyncLaunch(directorySyncPayload)"]);
  requireLeaf(entry[3], "return RunManagedInvocation(new ManagedInvocation(new List<FileStream>()))");
  caller(method(launcher, "internal static int RunManagedInvocation(ManagedInvocation invocation)"));
  fileRelease(method(invocation, "internal bool ReleaseFile(FileStream file, int ordinal)"));
  finisher(method(launcher, "internal static void FinishManagedReleases(ManagedInvocation invocation, ref IntPtr thread, ref IntPtr process)"));
  retention(method(launcher, "internal static void RetainManagedInvocation(ManagedInvocation owner)"));
  directorySettlement(launcher);
}

// F25 transitive C# recording/retention SOURCE conformance. This closed role
// checker consumes the actual owning statement trees, never callbacks/fixtures
// as native return authority. It is deliberately not a compiler/proof kernel.
export function assertAcquisitionRecordingSourceConformance(acquisitionSource, msiSource, trustSource) {
  const namespace = source => region(tokens(source), 'namespace ServiceLasso.SourceAcquisition');
  const acquisition = namespace(acquisitionSource), msi = region(namespace(msiSource), 'internal sealed class MsiReadOnly');
  const trust = region(namespace(trustSource), 'internal sealed class OfflineAuthenticode');
  const retained = region(acquisition, 'internal sealed class RetentionState');
  const interrupted = method(retained, 'internal void Interrupted(Exception original)');
  count(interrupted, 2); requireLeaf(interrupted[0], 'LastInterruptionException = original');
  caught(interrupted[1], ['Volatile.Write(ref interruptions, new RetentionInterruption(interruptions, original))'],
    'Exception recording', ['RecordingFailure = recording']);
  const lifetime = method(region(acquisition, 'internal static class Lifetime'), 'internal static void Retain(IOriginalNativeModule module, RetentionState retained)');
  count(lifetime, 2);
  const callback = lifetime[0];
  if (callback.kind !== 'try' || callback.catches.length !== 1 || !same(callback.catches[0].binding, 'Exception original') || callback.final === null) fail('once-only original retention callback enclosure');
  count(callback.body, 1); requireLeaf(callback.body[0], 'module.RetainUnknownOriginalOwner(retained.Owner, retained.Reason)');
  count(callback.catches[0].body, 1); requireLeaf(callback.catches[0].body[0], 'retained.CallbackFailure = original');
  count(callback.final, 1); requireLeaf(callback.final[0], 'retained.CallbackCompleted = true');
  const loop = lifetime[1];
  if (loop.kind !== 'for' || !same(loop.condition, ';;')) fail('same original lifetime never returns');
  count(loop.body, 4);
  caught(loop.body[0], ['Thread.Sleep(1000)'], 'Exception original', ['retained.Interrupted(original)']);
  ['GC.KeepAlive(retained.Owner)', 'GC.KeepAlive(retained)', 'GC.KeepAlive(module)'].forEach((effect, at) => requireLeaf(loop.body[at + 1], effect));
  for (const [owner, constructor] of [[msi, 'internal MsiReadOnly(MsiExports exports, IHeldInput input)'],
    [trust, 'internal OfflineAuthenticode(WintrustExports exports, IHeldInput held, RootPolicyInput rootPolicy, IIndependentChainObserver chainObserver)']]) {
    const fields = members(owner);
    if (fields.filter(row => row.body === null && same(row.header, 'private readonly RetentionState preparedRetention')).length !== 1) fail('private prepared retention field');
    const ctor = method(owner, constructor);
    count(ctor, owner === msi ? 5 : 7);
    requireLeaf(ctor.at(-1), 'preparedRetention = new RetentionState(this, null)');
    // Constructor has no native acquisition. No allocation can be moved to Retain.
    for (const node of ctor.slice(1, -1)) if (node.kind !== 'leaf' || node.expression.some(value => ['new', 'Call', 'Read', 'WinVerifyTrust', 'Retain'].includes(value))) fail('retention prepared before native ownership');
    const barrier = method(owner, 'private void Retain(string reason)');
    count(barrier, 3);
    ['CurrentRetention = preparedRetention', 'CurrentRetention.Reason = reason', 'Lifetime.Retain(api.Module, CurrentRetention)'].forEach((effect, at) => requireLeaf(barrier[at], effect));
  }
  const invoke = method(msi, 'private T Call<T>(string operation, Func<T> originalCall)');
  count(invoke, 2); requireLeaf(invoke[0], 'pendingCall = originalCall');
  const original = invoke[1];
  if (original.kind !== 'try' || original.final !== null || original.catches.length !== 1 || !same(original.catches[0].binding, 'Exception original')) fail('original call pending enclosure');
  count(original.body, 3);
  ['T result = originalCall()', 'pendingCall = null', 'return result'].forEach((effect, at) => requireLeaf(original.body[at], effect));
  const failure = original.catches[0].body; count(failure, 6);
  requireLeaf(failure[0], 'pendingException = original');
  branch(failure[1], 'receipt.OriginalException == null', ['receipt.OriginalException = original']);
  caught(failure[2], ['receipt.Observations.Add(new NativeObservation(receipt.Observations.Count + 1, operation + ":unknown-return", -1, null, original))'], 'Exception recording', ['receipt.RecordingFailure = recording']);
  ['GC.KeepAlive(pendingCall)', 'Retain("UNKNOWN_ORIGINAL_MSI_CALL_RETURN")', 'throw'].forEach((effect, at) => requireLeaf(failure[at + 3], effect));
  const reserve = method(msi, 'private NativeResource Reserve(string kind, bool view = false)');
  count(reserve, 3);
  ['var resource = new NativeResource(receipt.Resources.Count + 1, kind, 0, view)', 'pendingResource = resource', 'return resource'].forEach((effect, at) => requireLeaf(reserve[at], effect));
  const publish = method(msi, 'private void Publish(NativeResource resource, uint handle, long originalResult)');
  count(publish, 5);
  ['resource.Handle = handle', 'resource.AcquisitionResult = originalResult', 'resource.AcquisitionReturned = true'].forEach((effect, at) => requireLeaf(publish[at], effect));
  if (publish[3].kind !== 'if' || !same(publish[3].condition, 'handle != 0')) fail('zero output never invents acquired resource');
  count(publish[3].body, 1);
  caught(publish[3].body[0], ['receipt.Resources.Add(resource)'], 'Exception recording', ['receipt.RecordingFailure = recording', 'Retain("UNPUBLISHED_ORIGINAL_MSI_RESOURCE")']);
  requireLeaf(publish[4], 'pendingResource = null');
  function leaves(nodes) {
    return nodes.flatMap(node => node.kind === 'leaf' ? [{ node, siblings: nodes }] : [
      ...leaves(node.body ?? []), ...(node.catches ?? []).flatMap(handler => leaves(handler.body)), ...leaves(node.final ?? [])]);
  }
  for (const [signature, reservation, call] of [
    ['private void CaptureOneExtendedError(string operation, uint status)', 'NativeResource resource = Reserve("extended-error-record")', 'uint handle = Call("MsiGetLastErrorRecord", () => { uint value = api.Error(); Publish(resource, value, value); return value; })'],
    ['private string[] Info(uint view, uint kind)', 'var resource = Reserve("column-info-" + kind)', 'uint status = Call("MsiViewGetColumnInfo", () => { uint value = api.Columns(view, kind, out record); Publish(resource, record, value); return value; })'],
    ['private void ReadTable(uint database, string name)', 'var resource = Reserve("view:" + name, true)', 'uint status = Call("MsiDatabaseOpenViewW", () => { uint value = api.View(database, "SELECT * FROM `" + name + "`", out view); Publish(resource, view, value); return value; })'],
    ['private void ReadTable(uint database, string name)', 'var recordResource = Reserve("row:" + name + ":" + row)', 'status = Call("MsiViewFetch", () => { uint value = api.Next(view, out record); Publish(recordResource, record, value); return value; })'],
    ['private void ReadSummary(uint database)', 'var resource = Reserve("summary")', 'uint status = Call("MsiGetSummaryInformationW", () => { uint value = api.SummaryInfo(database, null, 0, out summary); Publish(resource, summary, value); return value; })'],
    ['internal MsiReceipt Read()', 'resource = Reserve("database")', 'uint status = Call("MsiOpenDatabaseW", () => { uint value = api.Database(held.OriginalPath, IntPtr.Zero, out database); Publish(resource, database, value); return value; })'],
  ]) {
    const body = method(msi, signature), matches = leaves(body).filter(row => leaf(row.node, reservation));
    if (matches.length !== 1) fail('one genuine pre-effect resource slot');
    const at = matches[0].siblings.indexOf(matches[0].node);
    requireLeaf(matches[0].siblings[at + 1], call);
    if (leaves(body).filter(row => leaf(row.node, call)).length !== 1) fail('original acquisition issued once');
  }
  // Every acquired-resource owner encloses fallible records in its own finally.
  for (const [signature, length, finalEffect] of [
    ['private void CaptureOneExtendedError(string operation, uint status)', 5, 'Release(resource)'],
    ['private string[] Info(uint view, uint kind)', 5, 'Release(resource)'],
    ['private void ReadTable(uint database, string name)', 7, 'Release(resource)'],
    ['private void ReadSummary(uint database)', 5, 'Release(resource)'],
  ]) {
    const owning = method(msi, signature); count(owning, length);
    const enclosure = owning.at(-1);
    if (enclosure.kind !== 'try' || enclosure.catches.length || enclosure.final === null) fail('original acquired resource finally');
    count(enclosure.final, 1); requireLeaf(enclosure.final[0], finalEffect);
    if (signature.includes('CaptureOneExtendedError')) requireLeaf(enclosure.body[0], 'var fields = new List<MsiErrorField>()');
    if (signature.includes('ReadTable')) {
      const row = enclosure.body.find(node => node.kind === 'for');
      if (!row) fail('actual original row owner');
      const rowEnclosure = row.body.at(-1);
      if (rowEnclosure.kind !== 'try' || rowEnclosure.catches.length || rowEnclosure.final === null) fail('original row acquired resource finally');
      count(rowEnclosure.final, 1); requireLeaf(rowEnclosure.final[0], 'Release(recordResource)');
    }
  }
  const release = method(msi, 'private void Release(NativeResource resource)');
  count(release, 3);
  branch(release[0], 'pendingCall != null', ['Retain("PENDING_ORIGINAL_MSI_CALL")']);
  branch(release[1], 'resource == null || resource.Handle == 0 || resource.CloseStatus.HasValue', ['return']);
  const close = release[2];
  if (close.kind !== 'try' || close.final !== null || close.catches.length !== 1 || !same(close.catches[0].binding, 'Exception original')) fail('original release pending enclosure');
  count(close.body, 6);
  if (close.body[0].kind !== 'if' || !same(close.body[0].condition, 'resource.View')) fail('original view close');
  count(close.body[0].body, 4);
  ['Before("MsiViewClose", resource.Ordinal.ToString())', 'uint viewStatus = Call("MsiViewClose", () => api.ViewClose(resource.Handle))', 'Observe("MsiViewClose", viewStatus)'].forEach((effect, at) => requireLeaf(close.body[0].body[at], effect));
  branch(close.body[0].body[3], 'viewStatus != 0', ['Retain("FAILED_ORIGINAL_VIEW_CLOSE")']);
  ['Before("MsiCloseHandle", resource.Ordinal.ToString())', 'uint status = Call("MsiCloseHandle", () => api.HandleClose(resource.Handle))',
    'resource.CloseStatus = status', 'Observe("MsiCloseHandle", status)'].forEach((effect, at) => requireLeaf(close.body[at + 1], effect));
  branch(close.body[5], 'status != 0', ['Retain("FAILED_ORIGINAL_HANDLE_CLOSE")']);
  const closingFailure = close.catches[0].body; count(closingFailure, 3);
  requireLeaf(closingFailure[0], 'pendingException = original');
  caught(closingFailure[1], ['receipt.Observations.Add(new NativeObservation(receipt.Observations.Count + 1, "resource-close-exception", -1, null, original))'],
    'Exception recording', ['receipt.RecordingFailure = recording']);
  requireLeaf(closingFailure[2], 'Retain("UNKNOWN_ORIGINAL_HANDLE_CLOSE")');
  const observation = method(msi, 'private void Observe(string operation, uint status, bool error = true)');
  count(observation, 7);
  ['receipt.LastOriginalOperation = operation', 'receipt.LastOriginalStatus = status',
    'var original = new NativeObservation(receipt.Observations.Count + 1, operation, status, null, null)', 'receipt.Observations.Add(original)'].forEach((effect, at) => requireLeaf(observation[at], effect));
  branch(observation[4], 'error && !capturingExtendedError && status != 0 && status != 234 && status != 259', ['CaptureExtendedError(operation, status)']);
  requireLeaf(observation[5], 'api.Module.ObserveOriginalCall(operation, status)'); requireLeaf(observation[6], 'budget.Charge(128)');
  const read = method(msi, 'internal MsiReceipt Read()'); count(read, 6);
  branch(read[0], 'closing', ['throw new InvalidOperationException("OWNER_ALREADY_ENTERED")']);
  ['closing = true', 'held.ObserveBefore()', 'uint database = 0', 'NativeResource resource = null'].forEach((effect, at) => requireLeaf(read[at + 1], effect));
  const readBoundary = read[5];
  if (readBoundary.kind !== 'try' || readBoundary.catches.length !== 1 || !same(readBoundary.catches[0].binding, 'Exception original') || readBoundary.final === null) fail('original database held dependency enclosure');
  const handler = readBoundary.catches[0].body; count(handler, 4);
  requireLeaf(handler[0], 'receipt.OriginalException = original'); requireLeaf(handler[1], 'receipt.Eligibility = "UNQUALIFIED_INPUT"');
  caught(handler[2], ['api.Module.ObserveOriginalException("MsiReadOnly.Read", original)'], 'Exception observer', ['receipt.ObserverFailure = observer']);
  requireLeaf(handler[3], 'return receipt');
  const final = readBoundary.final; count(final, 5);
  branch(final[0], 'pendingCall != null', ['Retain("PENDING_ORIGINAL_MSI_DATABASE_DEPENDENCIES")']);
  requireLeaf(final[1], 'Release(resource)');
  caught(final[2], ['held.ObserveAfterOriginalClosure()'], 'Exception observer', ['receipt.ObserverFailure = observer']);
  requireLeaf(final[3], 'GC.KeepAlive(held)'); requireLeaf(final[4], 'GC.KeepAlive(api)');
  const reportException = method(trust, 'private void ReportException(string operation, Exception original)');
  count(reportException, 1);
  caught(reportException[0],
    ['api.Module.ObserveOriginalException(operation, original)'], 'Exception observer', ['receipt.ObserverException = observer']);
}

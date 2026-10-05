// AC-4DI.4 / R3 / C3 / G1. A deliberately closed SOURCE grammar, not a C#
// compiler or native proof. Every owning statement is consumed. Unknown flow,
// effects, aliases and syntax deny; comments/spacing and harmless braces do not.
function fail(detail) { throw new Error(`managed closure ${detail}`); }

function tokens(source) {
  const result = [];
  const pattern = /\s+|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|@"(?:[^"]|"")*"|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[A-Za-z_][A-Za-z_0-9]*|[0-9]+|==|!=|<=|>=|\+\+|\+=|\|=|=>|&&|\|\||\?\?|[^\s]/gy;
  let offset = 0;
  while (offset < source.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(source);
    if (!match) fail("token boundary");
    offset = pattern.lastIndex;
    if (!/^\s|^\/\//u.test(match[0]) && !match[0].startsWith("/*")) result.push(match[0]);
  }
  // Conditional compilation cannot create a different reachable owning program.
  if (result.includes("#")) fail("unsupported preprocessing");
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
    if (["if", "for", "foreach", "using"].includes(kind)) {
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
    if (["goto", "while", "do", "switch", "break", "continue", "lock", "fixed", "unsafe", "yield"].includes(kind)) fail("unsupported flow");
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
  requireLeaf(nodes[0], 'invocation.Release(ref thread, "target-thread-release", 0)');
  requireLeaf(nodes[1], 'invocation.Release(ref process, "target-process-release", 0)');
  const loop = nodes[2];
  if (loop?.kind !== "for" || !["int ordinal = 0; ordinal < invocation.Files.Count; ordinal++", "int ordinal = 0; ordinal < invocation.Files.Count; ordinal += 1"].some((value) => same(loop.condition, value))) fail("every original file loop");
  count(loop.body, 1);
  requireLeaf(loop.body[0], "invocation.ReleaseFile(invocation.Files[ordinal], ordinal)");
  branch(nodes[3], "invocation.Failed", ["RetainManagedInvocation(invocation)"]);
}
function retention(nodes) {
  count(nodes, 1);
  const loop = nodes[0];
  if (loop.kind !== "for" || !same(loop.condition, ";;")) fail("indefinite same-owner retention");
  count(loop.body, 2);
  caught(loop.body[0], ["Thread.Sleep(Timeout.Infinite)"], "Exception failure", ['owner.Observe("retention-interrupted", 0, true, failure)']);
  requireLeaf(loop.body[1], "GC.KeepAlive(owner)");
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
  "uint finalPathLength = GetFinalPathNameByHandleW(boundFile.SafeFileHandle.DangerousGetHandle(), finalPathBuffer, (uint)finalPathBuffer.Capacity, 0)",
  "RetireProgress(invocation)", "jobHandle = CreateJobObjectW(IntPtr.Zero, null)", "ConfigureKillOnClose(jobHandle)",
  "ApplyTargetEnvironmentOverrides(payload.targetEnvironmentOverrides, invocation)",
  "ProcessInformation processInformation",
  "bool targetCreated",
  "targetCreated = CreateProcessW(resolvedExecutable, commandLine, IntPtr.Zero, IntPtr.Zero, true, CreateSuspended, IntPtr.Zero, payload.workingDirectory, ref startupInfo, out processInformation)",
  'Win32Exception original = new Win32Exception(targetCreationError, "Managed target creation failed.")', "throw original",
  "invocation.Primary = original", 'invocation.Observe("target-original-create", targetCreationError, true, original)',
  "processHandle = processInformation.hProcess", "threadHandle = processInformation.hThread",
  'invocation.Observe("target-original-create", 0, false, null)',
  'invocation.Observe("target-original-create-throw", 0, true, original)',
  "ClearTargetEnvironmentOverrides(payload.targetEnvironmentOverrides, invocation, payload.targetEnvironmentOverrides.Length)",
  'invocation.Observe("target-environment-retirement-unknown-return", 0, true, later)',
  "targetAssignedToJob = true", 'OriginalObservation original = invocation.Outcomes.Find(o => o.Site == "target-thread-release" && o.Attempted)',
  'throw new Win32Exception(original.NativeStatus, "Managed target thread handle close failed.")',
  'string acknowledgment = "{\\"token\\":\\"" + payload.ackToken + "\\",\\"pid\\":" + processInformation.dwProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}"',
  "throw original.Exception", "uint targetWait = WaitForSingleObject(processHandle, Infinite)",
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
  count(handler, 3);
  branch(handler[0], "invocation.Primary == null", ["invocation.Primary = primary"]);
  requireLeaf(handler[1], "invocation.PrimaryResult = failureExitCode"); requireLeaf(handler[2], "return failureExitCode");
  finalizer(outer.final);

  const seen = new Map(), loops = [], returns = [];
  function walk(body, ancestors = []) {
    for (const node of body) {
      if (node.kind === "leaf") {
        safeExpression(node.expression);
        const key = node.expression.join(" ");
        if (!seen.has(key)) seen.set(key, []);
        seen.get(key).push({ node, ancestors, body });
        if (node.expression[0] === "return") returns.push(node);
      } else if (node.kind === "if") {
        if (!controls.has(node.condition.join(" "))) fail("unknown branch condition");
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
  // Cardinality excludes additional accepted-looking calls/writes as well as
  // indirect aliases. Location excludes unreachable/conditional original roles.
  for (const effect of ownershipEffects) {
    if (["invocation.Primary = primary", "invocation.PrimaryResult = failureExitCode"].some((value) => same(effect, value))) continue;
    lookup(effect.join(" "), same(effect, "ThrowOriginalRetirementFailure(invocation)") ? 3 : same(effect, "invocation.Primary = original") ? 2 : 1);
  }
  const acquired = lookup("FileStream boundFile = new FileStream(approvedFile.file, FileMode.Open, FileAccess.Read, FileShare.Read)")[0];
  const roster = lookup("boundFiles.Add(boundFile)")[0];
  const files = loops.find((node) => node.kind === "for");
  if (acquired.ancestors.length !== 1 || acquired.ancestors[0] !== files || roster.ancestors.length !== 1 || roster.ancestors[0] !== files || files.body.indexOf(roster.node) !== files.body.indexOf(acquired.node) + 1) fail("reachable original file acquisition/roster");
  for (const expression of ["ValidateNativeLayouts()", "InitializeProgress()", "jobHandle = CreateJobObjectW(IntPtr.Zero, null)", "ConfigureKillOnClose(jobHandle)", "ApplyTargetEnvironmentOverrides(payload.targetEnvironmentOverrides, invocation)", "targetAssignedToJob = true", "uint targetWait = WaitForSingleObject(processHandle, Infinite)", "invocation.PrimaryResult = unchecked((int)exitCode)"]) {
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
  count(creation.body, 3);
  if (creation.body[0] !== create.node) fail("creation precedes original handle publication");
  branch(creation.body[1], "!targetCreated", ["targetCreationError = Marshal.GetLastWin32Error()", "failureExitCode = TargetCreationFailureExitCode(targetCreationError)", 'Win32Exception original = new Win32Exception(targetCreationError, "Managed target creation failed.")', "invocation.Primary = original", 'invocation.Observe("target-original-create", targetCreationError, true, original)', "throw original"]);
  branch(creation.body[2], "targetCreated", ["processHandle = processInformation.hProcess", "threadHandle = processInformation.hThread", 'invocation.Observe("target-original-create", 0, false, null)']);
  count(creation.catches[0].body, 2);
  branch(creation.catches[0].body[0], "invocation.Primary == null", ["invocation.Primary = original", 'invocation.Observe("target-original-create-throw", 0, true, original)']);
  requireLeaf(creation.catches[0].body[1], "throw");
  count(creation.final, 1);
  caught(creation.final[0], ["ClearTargetEnvironmentOverrides(payload.targetEnvironmentOverrides, invocation, payload.targetEnvironmentOverrides.Length)"], "Exception later", ['invocation.Observe("target-environment-retirement-unknown-return", 0, true, later)']);
}

export function assertManagedClosureSourceConformance(source) {
  const all = tokens(source);
  const launcher = region(all, "public static class ServiceLassoManagedLauncherNative");
  const invocation = region(launcher, "internal sealed class ManagedInvocation");
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
}

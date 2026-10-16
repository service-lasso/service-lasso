// F25 supplementary PowerShell SOURCE grammar. No native/PowerShell execution.
const refuse = () => { throw new Error('F25 original active retention source is unresolved.'); };
function lex(source) {
  const out = [];
  const spans = [];
  Object.defineProperty(out, 'spans', { value: spans });
  const emit = (value, start, end) => { out.push(value); spans.push({ start, end }); };
  for (let at = 0; at < source.length;) {
    const ch = source[at];
    if (/\s/u.test(ch)) { at++; continue; }
    if (ch === '#') { while (at < source.length && !/[\r\n]/u.test(source[at])) at++; continue; }
    if (ch === "'" || ch === '"') {
      const start = at++, quote = ch; let closed = false;
      while (at < source.length) {
        if (source[at] === '`' && quote === '"') { at += 2; continue; }
        if (source[at++] !== quote) continue;
        if (source[at] === quote) { at++; continue; }
        closed = true; break;
      }
      if (!closed) refuse(); emit(source.slice(start, at), start, at); continue;
    }
    const word = /^(?:\$[A-Za-z_][A-Za-z_0-9:]*|[A-Za-z_][A-Za-z_0-9-]*|\d+)/u.exec(source.slice(at));
    if (word) { emit(word[0], at, at + word[0].length); at += word[0].length; continue; }
    emit(ch, at, at + 1); at++;
  }
  return out;
}
function region(ts, name) {
  const matches = [];
  for (let at = 0; at < ts.length - 2; at++) if (ts[at] === 'function' && ts[at + 1] === name) matches.push(at);
  if (matches.length !== 1) refuse();
  const start = matches[0]; let open = start + 2;
  while (open < ts.length && ts[open] !== '{') open++;
  let depth = 1, end = open + 1;
  for (; end < ts.length && depth; end++) { if (ts[end] === '{') depth++; if (ts[end] === '}') depth--; }
  if (depth) refuse();
  return { start, open, end, body: ts.slice(open + 1, end - 1) };
}
function assertCallerPrefix(ts, caller, rootEnd) {
  let at = caller.open + 1;
  const need = text => { for (const expected of lex(text)) if (ts[at++] !== expected) refuse(); };
  need('$start = [Diagnostics.ProcessStartInfo]::new()');
  for (const [key, value] of [['FileName', '$file'], ['WorkingDirectory', '$temporaryRoot'], ['UseShellExecute', '$false'],
    ['RedirectStandardInput', '$true'], ['RedirectStandardOutput', '$true'], ['RedirectStandardError', '$true']]) need(`$start.${key} = ${value}`);
  need('$start.Environment.Clear()');
  need('foreach ($entry in $environment.GetEnumerator()) { $start.Environment.Add($entry.Key, $entry.Value) }');
  need('if ([string]::IsNullOrEmpty($nativeArguments)) { foreach ($argument in $arguments) { $start.ArgumentList.Add($argument) } } else { $start.Arguments = $nativeArguments }');
  need('$key = "$temporaryRoot|$label"');
  need('if ($script:NativeToolOwners.ContainsKey($key)) { throw "An original tool owner already exists; no retry." }');
  need('$owner = @{');
  const fields = [['process', '$null'], ['stdinSource', '$null'], ['stdinClosed', '$false'], ['stdoutRaw', '$null'], ['stderrRaw', '$null'],
    ['startAttempted', '$false'], ['startReturned', '$false'], ['started', '$null'], ['attached', '$false'], ['exitObserved', '$false'],
    ['exitCode', '$null'], ['settled', '$false'], ['recordingFailed', '$false'], ['recordingFailure', '$null'], ['lastOriginalError', '$null'],
    ['primaryError', '$null'], ['errors', '[Collections.Generic.List[object]]::new()']];
  for (const [key, value] of fields) need(`${key} = ${value};`);
  need('copies = @{');
  for (const [index, name] of ['stdout', 'stderr'].entries()) {
    if (index) need(';');
    need(`${name} = @{ source = $null; task = $null; terminal = $false; observation = $null }`);
  }
  need('} } $script:NativeToolOwners.Add($key, $owner)');
  if (at !== rootEnd) refuse();
}
export function assertPowerShellOriginalRetention(source) {
  const ts = lex(source), caller = region(ts, 'Invoke-RetainedNativeTool'), retained = region(ts, 'Retain-ActiveOriginalOwner');
  if (retained.start <= caller.open || retained.end >= caller.end) refuse();
  const root = lex('$script:NativeToolOwners.Add($key, $owner)');
  // Rooting must be a direct owning caller statement before nested functions,
  // never a matching fragment in another function or a conditional/try block.
  let depth = 0, roots = 0, rootEnd;
  for (let at = caller.open + 1; at < retained.start; at++) {
    if (ts[at] === '{') depth++;
    if (ts[at] === '}') depth--;
    if (depth === 0 && root.every((value, offset) => ts[at + offset] === value)) { roots++; rootEnd = at + root.length; }
  }
  if (roots !== 1) refuse();
  assertCallerPrefix(ts, caller, rootEnd);
  let next = rootEnd;
  for (const name of ['Add-OriginalToolError', 'Write-OriginalToolRecord', 'Observe-OriginalCopy']) {
    const helper = region(ts, name);
    if (helper.start !== next || helper.end > retained.start) refuse();
    next = helper.end;
  }
  if (next !== retained.start) refuse();
  const body = retained.body; let at = 0;
  const command = text => {
    const start = at;
    need(text);
    const first = ts.spans[retained.open + 1 + start];
    const last = ts.spans[retained.open + at];
    // A line break ends a PowerShell command unless an explicitly modeled
    // continuation applies. This selected grammar admits no continuation.
    if (!first || !last || /[\r\n\u0085\u2028\u2029#`]/u.test(source.slice(first.start, last.end))) refuse();
  };
  const need = text => { for (const expected of lex(text)) if (body[at++] !== expected) refuse(); };
  const recordingCatch = phase => {
    need('catch { try {');
    command(`Add-OriginalToolError '${phase}' $_.Exception`);
    need('} catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true } }');
  };
  need("try { foreach ($name in @('stdout', 'stderr')) { if ($owner.copies.$name.task -and -not $owner.copies.$name.terminal) { Observe-OriginalCopy $name } } }");
  recordingCatch('retention-copy-observation');
  need("try { Write-OriginalToolRecord 'ACTIVE-CUSTODY' @{");
  const fields = [
    ['state', "'ACTIVE_INVOCATION_RETAINS_UNRESOLVED_ORIGINAL_RESOURCES'"], ['ownerKey', '$key'], ['invocationPid', '$PID'], ['recipe', '$recipe'],
    ...['startAttempted', 'startReturned', 'started', 'attached', 'exitObserved', 'exitCode'].map(key => [key, `$owner.${key}`]),
    ['stdoutCopy', '$owner.copies.stdout.observation'], ['stderrCopy', '$owner.copies.stderr.observation'], ['errors', '@($owner.errors)'],
    ['returned', '$false'], ['resourcesReleased', '$false'],
  ];
  fields.forEach(([name, value], index) => { if (index) need(';'); need(`${name} = ${value}`); });
  need('} }'); recordingCatch('custody-record');
  need('while ($true) { try { [Threading.Thread]::Sleep([Threading.Timeout]::Infinite) }');
  recordingCatch('custody-wait'); need('}');
  if (at !== body.length) refuse();
}

export function assertPowerShellRecorderReleaseRetention(source) {
  const ts = lex(source), caller = region(ts, 'Invoke-RetainedNativeTool');
  const expected = lex('if ($releaseFailed -or $owner.recordingFailed) { Retain-ActiveOriginalOwner }');
  let depth = 0, matches = 0;
  for (let at = caller.open + 1; at < caller.end - 1; at++) {
    if (depth === 0 && expected.every((value, offset) => ts[at + offset] === value)) matches++;
    if (ts[at] === '{') depth++;
    if (ts[at] === '}') depth--;
  }
  if (matches !== 1) refuse();
}

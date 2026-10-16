// F25 supplementary PowerShell SOURCE grammar. No native/PowerShell execution.
const refuse = () => { throw new Error('F25 original active retention source is unresolved.'); };
function lex(source) {
  const out = [];
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
      if (!closed) refuse(); out.push(source.slice(start, at)); continue;
    }
    const word = /^(?:\$[A-Za-z_][A-Za-z_0-9:]*|[A-Za-z_][A-Za-z_0-9-]*|\d+)/u.exec(source.slice(at));
    if (word) { out.push(word[0]); at += word[0].length; continue; }
    out.push(ch); at++;
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
  let next = rootEnd;
  for (const name of ['Add-OriginalToolError', 'Write-OriginalToolRecord', 'Observe-OriginalCopy']) {
    const helper = region(ts, name);
    if (helper.start !== next || helper.end > retained.start) refuse();
    next = helper.end;
  }
  if (next !== retained.start) refuse();
  const body = retained.body; let at = 0;
  const need = text => { for (const expected of lex(text)) if (body[at++] !== expected) refuse(); };
  const recordingCatch = phase => {
    need(`catch { try { Add-OriginalToolError '${phase}' $_.Exception } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true } }`);
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

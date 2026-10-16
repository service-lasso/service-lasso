# #1562 F25 source-witness circuit-break incident and AST proposal

Status: SCOPED BLOCKED for the custom F25 witness. Parent selected real
PowerShell Language.Parser AST as the replacement model on 2026-10-16;
implementation is NOT started. Different review of this intent precedes code.
SPEC-002 AC-4DI.4/R3/C3/G1 and the selected F25 retention requirements remain.
This incident does not pause the independent fixture/helper/opaque-denial work.

## Stable signature and retained iterations

Stable failure: the supplementary F25 handwritten source witness accepts a
PowerShell program whose actual control/command/assignment semantics no longer
satisfy original rooted-owner/nonreturning/original-Exception retention.

1. b9fc001a: insert `return;` immediately before the actual
   `$script:NativeToolOwners.Add($key, $owner)`. Root/barrier token fragments
   remain, but active owner rooting is unreachable. DIFFERENT review found it;
   173b88f8 added a selected caller-prefix grammar and actual adversary.
2. 173b88f8: put a physical newline or a line comment/newline after
   `Add-OriginalToolError 'custody-wait'` and before `$_.Exception`. Erased
   whitespace leaves identical tokens while the recorder no longer receives
   its original Exception. DIFFERENT review found it; a71ab726 retained source
   spans for all three recorder command regions and added actual adversaries.
3. a71ab726: put a physical newline between `$owner.recordingFailure = $_`
   and `.Exception; $owner.recordingFailed = $true` inside the inner catch.
   need() still sees identical tokens, but assignment and a new command replace
   the original member access and may escape the inner catch. DIFFERENT review
   confirmed this third equivalent false positive. No further lexer fix is
   authorized; a71 custom helper is frozen and remains SOURCE_NO_GO.

These are evidenceful static adversaries, not executed PowerShell observations.
Preserve all original source/review/native failures and the three adversaries.
No test pass, runtime failure injection or native process custody is inferred.

## Selected replacement and governing API evidence

Use the actual Microsoft PowerShell parser, not a handwritten lexer, token
normalization, byte hash, original-body snapshot, substring occurrence or
execution of the target compiler script.

Microsoft documents Parser.ParseFile as returning ScriptBlockAst plus original
Token[] and ParseError[]; Parser.ParseInput is the corresponding in-memory
source route. CommandAst exposes CommandElements, InvocationOperator,
Redirections and Extent. AssignmentStatementAst exposes actual Left, Operator
and Right. Those real trees preserve statement/expression boundaries that the
custom witness erased. No command invocation or SafeGetValue evaluation is
needed or permitted to inspect the target AST.

Primary references:
- https://learn.microsoft.com/en-us/dotnet/api/system.management.automation.language.parser.parsefile?view=powershellsdk-7.6.0
- https://learn.microsoft.com/en-us/dotnet/api/system.management.automation.language.parser.parseinput?view=powershellsdk-7.6.0
- https://learn.microsoft.com/en-us/dotnet/api/system.management.automation.language.commandast?view=powershellsdk-7.6.0
- https://learn.microsoft.com/en-us/dotnet/api/system.management.automation.language.assignmentstatementast?view=powershellsdk-7.6.0

## Bounded source implementation to review separately

Replace the custom helper with a fixed, repository-owned PowerShell AST witness
script and a Node child-process adapter. Actual target script bytes and each
actual-source mutation enter only Parser.ParseInput with its original filename
for extent association. Reject every parse error before matching. Never dot
source, invoke, compile or import the target compiler script. Do not call
ScriptBlock.Create/Invoke, Invoke-Expression, AST SafeGetValue or arbitrary
commands obtained from target AST nodes.

Match actual AST node types and ordered complete statement lists. Reject
unknown node kinds, additional statements, pipelines, invocation operators,
redirections and dynamic/splat/member forms outside the fixed supported roles.
Require one actual Invoke-RetainedNativeTool function and its one directly
nested Retain-ActiveOriginalOwner function. Validate the complete selected
reachable caller prefix through the original direct NativeToolOwners.Add;
retain the original duplicate-owner refusal and owner field initialization.
Nested function definitions cannot count as executed prefix effects. No return,
exit, break, continue, trap, altered branch or unexamined statement may hide
before original rooting. Consume the entire retention function's real body.

For each of the three actual recorder calls require one CommandAst, exactly
its literal command name, its exact literal phase and the actual member
expression `$_.Exception` as the third command element. For each inner
recorder catch require exactly the original recordingFailure assignment whose
Right is the original member expression `$_.Exception`, followed by the
primitive recordingFailed=true assignment. A new `.Exception` command or an
assignment of the ErrorRecord itself must fail. Reject extra statements,
operators, catches, filters, traps and escaping paths. Bind copy observation
and custody publication to their original enclosing try/catches. The selected
while(true) body has only its guarded infinite Thread.Sleep call and the
required shielding catch; preserve the same nonreturning invocation. Require
actual OR of releaseFailed and owner.recordingFailed in the direct post-release
retention condition; AND or either omitted alternative fails.

AST source conformance remains a supplementary structural claim. It does not
prove native interruption/allocator failure, handle safety, actual original
process lifetime, final qualification, publication or GA.

## Meaningful AST adversaries

Retain every existing actual-source mutation, plus all three incident cases.
For each recorder phase test newline and comment boundaries between command,
phase and Exception. For every inner catch test newline/comment splitting
between `$_` and `.Exception`, replacement with ErrorRecord/copy/other member,
missing primitive flag, and added command/throw/return. Verify extra AST
statements cannot disappear through normalization. Also retain unrooted and
unreachable-copy cases, before-root return, finite/false-loop/escaping/unshielded
barriers and AND/omitted OR conditions. Genuine inert comments/whitespace and
any explicitly supported parser-preserved continuation must pass only when
actual AST shape/ownership roles remain identical. Unknown continuation forms
are refused, never repaired. Mutations are parsed as source, never executed.

## Actual tool observation and admission implications

Read-only inspection found an existing physical official tool:
`C:/Program Files/PowerShell/7/pwsh.exe`, 301368 bytes, ProductVersion
7.6.6 SHA078a44214be21d0b816adb9fe8a5f1f63a85236a, SHA256
BFB46AF89433268872DDB43D1CA7A3F433452EE91ED356A9786940F90118E285.
Authenticode currently Valid, Microsoft Corporation signer.
System.Management.Automation.dll is 19658592 bytes, SHA256
ED8D39663E05435AAB59F1C7FB0AD20292E22B0CB12CF47AAD4B62B31E4D4126,
with the same version and valid Microsoft signer. Its containing path chain
was physically inspected as non-reparse. pwsh.runtimeconfig.json declares
.NET10.0.12 self-contained frameworks. These are observed file/signature facts,
not a live held/loaded process, independent reproducible-build proof or ROOT.
Get-Command pwsh resolves a DIFFERENT bundled runtime path; do not silently
use PATH or claim it is this inspected tool.

A prospective child command is the exact inspected physical pwsh executable
with `-NoLogo -NoProfile -NonInteractive -File <new fixed witness script>`;
raw source input travels through the owned stdin channel, never executable
argv. Node positives/negatives must await real child closure and check the
closed protocol; migrate existing synchronous witness assertions honestly to
awaited assertions. Never use doesNotThrow to certify an async promise.

The new witness script/protocol, Node bridge, parser tool/runtime, raw target
bytes, every actual mutant and new child/stdin/stdout/stderr/exit ownership
must enter the DIFFERENT final source review and NEW complete actual-input
ROOT admission. Native child holder/loaded runtime occurrence is currently
UNAVAILABLE; nothing has been launched. The old e37 admission path is missing
and cannot be reused. Missing/inauthentic parser or tool fails closed; no
installation, global setting, timeout, permission, token or safety bypass is
authorized. Windows/Linux require separately observed official tool inputs;
Windows file observations cannot qualify a Linux parser. Current native
fixture rows still require their actual held/native/dist prerequisites.

## Disposition and next action

Keep a71 unchanged except this incident/intent record. A different reviewer
must approve the entire AST model and child/input boundary before dependent
source changes. Then implement the bounded witness and original adversaries,
freeze/push, obtain another DIFFERENT entire source review, and prepare a NEW
complete input/tool/command proposal. Parent alone dispositions genuine ROOT
admission. The existing Node-only scratch proposal is superseded for F25;
source helper and token-fixture checks can be separately admitted only with an
honest adjusted exact command. No source or native execution has occurred.

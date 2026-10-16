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

## Normative revision 1: complete AST and child contract

This section resolves the independent intent review's REVISIONS_REQUIRED and
supersedes any less specific framing/interval description above. It is a
proposal requiring a DIFFERENT intent review before implementation.

### Complete scopes and protected bodies

Require the original outer ScriptBlockAst: its CmdletBinding attribute has no
arguments; its three parameters are Update:switch, InitializeOnly:switch and
InitializedEnvironmentPath:string, without defaults or added attributes. It
has only its original unnamed EndBlock: no DynamicParam, Begin, Process, Clean,
explicit named End block or traps. The same prohibition applies to every
selected function body; inspect all named-block and trap properties, not only
EndBlock. Unknown SDK properties/forms are unsupported, never silently ignored.
Reject filters/workflows, duplicates and relocated selected definitions.

Require exactly these signatures in their original lexical owning scope:

- Invoke-RetainedNativeTool: file:string; arguments:string[]; environment
  untyped; label:string; nativeArguments:string with exactly literal null as
  its default. No other parameter defaults, attributes or parameter/body forms.
- Add-OriginalToolError: phase:string; original untyped; no defaults/attributes.
- Write-OriginalToolRecord: suffix:string; record untyped; no defaults/attributes.
- Observe-OriginalCopy: name:string; no defaults/attributes.
- Retain-ActiveOriginalOwner: no parameters/defaults/attributes.

Function-definition parameter syntax versus body ParamBlock must match the
actual original declaration, with no second ParamBlock or latent initializer.
Literal null/true/false and unqualified variables must have their actual AST
scope/name, not an alias or an evaluated expression. Reject wildcard, splatted,
scriptblock/default-command and substituted parameter forms.

The complete Invoke-RetainedNativeTool statement list is a closed ordered role
recipe from function entry to its final original outcome check. Every statement
and nested branch is consumed; no unexamined interval may hide an escape or
rebind the owner, key, start, script registry or helper symbol. Its roles are:
(1) original ProcessStartInfo construction and selected properties/environment;
(2) original argument-list/native-arguments branch; (3) key, duplicate-owner
refusal, exact owner-map/copy-map initialization, direct script-registry Add;
(4) the three original helper definitions in order, then retention definition;
(5) the original outer acquisition/start/attachment/stdin/two-copy/exit/available
exit/settlement try/catch, including all original catch recorder shielding and
unknown-start/unfinished-copy retention branches; (6) releaseFailed=false,
source-release loop, raw flush/dispose loop and process dispose; (7) immediate
post-release OR retention condition; (8) completed projection, shielded result
record, recorder-failure retention, original registry Remove and original final
primary-error/outcome check. Do not accept a matching condition relocated after
registry removal, a duplicate helper, owner rebinding, added return/exit/throw,
or a conditional definition/registry operation. The only allowed throw/return
roles are the actual original nested-helper/duplicate-owner/final-error roles.

The three helper bodies are protected source obligations, not unchecked names:
Add-OriginalToolError stores the original last error, sets the first Exception
primary once, appends its phase/original record under a shielding catch, and
retains the exact recorder Exception plus primitive failure flag. Write-
OriginalToolRecord uses the original UTF8/JSON-depth12/held CreateNew stream
write and finally-dispose roles. Observe-OriginalCopy keeps original task/source
identity, actual completion/terminal state and original failure, fixed state
branches, shielded recording and original fault projection. Match every actual
statement/branch/member/argument in each protected body using its selected
semantic role and operand identities; none may be skipped by a token substring
or whole-body byte/hash/snapshot comparison. Unknown effects fail closed.

The retention body consumes its complete copy-observation try/catch, original
custody-record try/catch and final true WhileStatementAst with guarded infinite
static Thread.Sleep invocation. Each of the three original recorder CommandAst
nodes has no invocation operator/redirection and exactly three elements: the
literal Add-OriginalToolError command, its literal selected phase and a nonstatic,
non-null-conditional MemberExpressionAst for the original unqualified `_`
variable and literal Exception member. Reject PSItem/global/other scoped aliases,
computed/expandable members, invocation members, conversions and extra operands.
Each inner catch contains exactly AssignmentStatementAst(recordingFailure,
Equals, original member-expression Right) followed by the original true-flag
assignment. Permit only actual one-element PipelineAst/CommandExpressionAst
wrappers where the parser requires them; no arbitrary parenthesized, pipeline,
operator or scriptblock wrappers. Check variable scope/name, literal member,
static and null-conditional properties at every relevant member chain.

### Exact source framing, outcomes and owned child closure

The prospective physical Windows command is:
C:/Program Files/PowerShell/7/pwsh.exe -NoLogo -NoProfile -NonInteractive -File
D:/projects/service-lasso/_worktrees/service-lasso/1562-client-release-core-oct16/tests/helpers/core1562-powershell-retention-ast.ps1

That fixed script is NOT written yet. shell=false, windowsHide=true; cwd is the
exact owned worktree. No PATH lookup, -Command, ExecutionPolicy bypass, target
script invocation or fallback parser is allowed. A reviewed explicit child ENV
contains only admitted SystemRoot/WINDIR/ComSpec, fresh private TMP/TEMP,
System32-only PATH and empty PSModulePath; no inherited NODE_OPTIONS, DOTNET/COR
profilers, PS/PATH injection or secret ENV. Disable module auto-loading in the
fixed witness. Exact values, physical tool/runtime/script bytes and channels
must appear in NEW ROOT before invocation; they are not granted by this prose.
Linux requires its own genuinely observed official physical tool and inputs.

Input is one strict UTF8 JSON object followed by exactly one LF and natural
stdin EOF. Exact ordered keys: schema, sourceFile, sourceByteLength,
sourceSha256, sourceBase64. schema is core1562.f25.ast-input.v1; sourceFile is
exactly scripts/verify-windows-managed-launcher-bootstrap.ps1. Source content is
canonical base64 of original bytes; sourceByteLength is its actual integer
length and sourceSha256 is its lowercase SHA256. Enforce canonical base64 by
round-trip equality, not a whitespace-tolerant decoder alone. The frame parser
uses the genuine .NET System.Text.Json API with comments/trailing commas denied;
enumerate and reject duplicate, unknown, missing, reordered, mistyped and null
properties. Reject trailing/concatenated JSON, CRLF/extra terminal bytes and
partial frames. Decode source bytes with strict UTF8 (throw on invalid input),
retain BOM/newlines and supply that exact string plus fixed sourceFile to the
real ParseInput overload. Never normalize, trim, replace malformed bytes,
repair unpaired UTF16, interpolate source into code or evaluate AST. Node must
use fatal UTF8 decoding with BOM preservation for original bytes and reject
unpaired UTF16 before encoding a mutant. Digests bind transport identity only;
they NEVER decide semantic conformance or source GO.

Output is one strict UTF8 JSON object plus one LF and natural stdout EOF, with
exact ordered keys schema,status,sourceSha256,reason. schema is
core1562.f25.ast-result.v1. Only these complete outcomes are valid:
- conformant / reason=none / exit0;
- rejected / reason=parse_error or shape_mismatch / exit2.
The digest must equal the actual candidate's original input digest. All other
status/reason/exit combinations, malformed/duplicate/extra/trailing/partial
output, signal termination, missing/incorrect digest and any stderr byte are
infrastructure failure, never an expected source rejection. Invalid input or
unexpected internal failure must not masquerade as rejected: child exits
nonzero outside0/2 with no conformant/rejected result. Raw diagnostics, if any,
remain private; do not relay target contents/paths to public output.

The Node adapter owns actual stdin delivery and end, observes EPIPE/write/end
failures, stdout and stderr data/end/error, child spawn/error/exit and genuine
close. Success/rejection settlement requires all input delivery and all stream
completion facts plus real child close and the matching expected exit; exit
alone, a parsed partial response or a timer is insufficient. Spawn failure,
EPIPE, stream error, signal, absent EOF, partial output and nonzero unexpected
exit fail closed. Any existing command bound must remain unchanged; a new
explicit harness bound needs review/admission and cannot be widened by retry.
No automatic retry/fallback or forced-success cleanup. Tests must await the
actual promise. Only this adapter may mint an original expected-source-denial
identity after a valid closed exit2 result. Negative AST tests must require that
specific authenticated denial; generic infrastructure rejection cannot pass
an adversary. Closed protocol unit models are labelled surrogate transport
checks, never genuine parser/native execution proof.

### Required meaningful adversary coverage

In addition to every retained actual-source adversary, reject actual mutations
adding function defaults/parameter attributes, Begin/Process/DynamicParam/Clean
or traps, alternate parameter/body definitions, post-root escape, owner/key/
registry rebinding, duplicate/relocated helper and moved post-release condition.
Reject nonstatic/null-conditional/computed or differently scoped Exception
references and malformed assignment wrappers. Test all original command and
inner-assignment newline/comment splits, including the exact third incident.
Genuine continuation/comment positives require the actual admitted parser AST
to retain the same complete selected role/operand shape; unknown forms deny.

Independently test malformed/duplicate/trailing input and output frames, source
length/hash/filename mismatch, invalid UTF8/base64, partial stdout/stderr, extra
stderr, exit-before-close, EPIPE, spawn/stream/signal errors and unexpected exit.
Those transport cases cannot count as successful AST adversaries. Preserve the
original primary failure while collecting actual closure outcomes. No parser
or child has been invoked in preparing this revision.

### Tool qualification limit remains explicit

Installed signed tool metadata source078a44214be21d0b816adb9fe8a5f1f63a85236a
DIFFERS from official v7.6.6 annotated tagfe2f984794c6e67ba4d61722ce4b09256b0ec363
which targets f260eb9c31ec72c5282f98e5ea24d9be4f8d7536 (provider unsigned).
The physical executable/SMA signatures and hashes are observed, but no source
correspondence, reproducible distribution build, held tool or loaded runtime
occurrence is established. Actual observation JSON is retained in the owned
.tmp proposal custody. This remains an unqualified input for parent disposition;
no installation, substitute tool, source-mapping inference or self-issued ROOT.

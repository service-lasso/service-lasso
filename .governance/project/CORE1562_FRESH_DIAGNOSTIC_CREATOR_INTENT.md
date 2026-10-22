# #1562 fresh diagnostic directory birth and guardian handoff — proposed intent

Status: REVISED PRE-CODE PROPOSAL3, awaiting DIFFERENT bounded intent review against
this WHOLE contract and actual fixture-root-custody.js/privacy/custody callers.
Exact prior source6eda8e8b0ac0b5139c731413c696355d81f5dd4a has ENTIRE62 SOURCE_GO,
not execution admission. All proposed native/tool/build/tests remain NOT_RUN.

## Requirement and bounded behavior

SPEC-002 AC-4DI.4/AC-4BJ.9c require prior original owner equality before privacy
mutation, private original failure retention and truthful native observations.
Exact natural6eda Startup38846022412/Win116796624113 still fails diagnostic
privacy with owner_original, complete six-event transport; compiler and repaired
surrogate pass. Actual owner SID/cause remains unknown. Diagnostic mkdtemp then
immediate privacy call is custody.js271–273. No file is created between them.

Select ONLY fresh Windows diagnostic-directory allocation in boundary.initialize.
Linux keeps existing mkdtemp behavior. Original fixture/evidence/file creators,
owner equality, ancestor allowlist, compiler assertion and all acceptance gates
remain unchanged. A successful birth is NOT proof subsequent original fixture
privacy or all Windows gates pass. No owner reset, adoption, privilege/ACL host
change, fallback, retry or inferred native ROOT. No public product action.

Implement a real source-owned creation role in the long-lived directory guardian
under the existing ordinary trusted-host boundary: no hostile external actor of
equivalent/higher privilege is admitted. Own writers and lifetimes remain checked.
Do not substitute tests/native-fixture/root-creator.h: that F7 receiving ABI has
no factory implementation and grants no authority here.

## Genuine inputs and fixed launch

New internal createPrivateDiagnosticDirectory(parent,prefix) lives alongside
holdFixtureRoot; it accepts only boundary's resolved original-root parent and
validated basename prefix, never an exe/script/token/handle/SD supplied by caller.
Node validates parent canonical absolute directory through realpath/lstat and
prefix ASCII basename, generates ONE 128-bit random lowercase-hex suffix with
crypto.randomBytes and one fresh nonce. A collision fails; no candidate loop.
Result path is parent plus one validated leaf, no separator/dot/colon/NUL/ADS.

Use fixed actual WindowsPowerShell executable under canonical C:\Windows:
C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe, argv exactly
-NoProfile -NonInteractive -EncodedCommand <fixed guardian UTF16LE source>.
No shell, windowsHide true, cwd canonical verified parent, stdio three pipes.
Reject alternate SystemRoot; bind physical executable source/input tuple in the
future actual-input proposal. ENV is explicitly copied from owned process once
and recorded in private input proposal, with only the fixed internal creation
mode/parent/leaf/nonce/callerPID fields added; ENV data grants no owner authority.
Do not label this complete clean ENV or loaded-runtime admission. Existing hold
mode remains fixed and is not a new public selector. Neither arbitrary caller
ENV nor exported test seam can choose script/executable or mint native custody.

Guardian validates exact fields before Add-Type/native acquisition, rejects
missing/extra/internal mode mismatch and verifies actual current PID/parent PID
against owned spawned child/caller occurrence. Process observations from existing
inspectProcess remain required; PID receipt alone is insufficient.

## Actual principal, parent and native ABI

Guardian acquires WindowsIdentity.GetCurrent() User SID as actual effective
creation principal, retains identity/token lifetime until closure, rejects null
user and unexpected impersonation context. Obtain actual parent process handle
PROCESS_QUERY_LIMITED_INFORMATION and TOKEN_QUERY, read TokenUser and compare
with child's actual process/effective user; do not manufacture SID from ENV or
accept raw SID fields as authority. Parent process token is not proof of a remote
caller's thread token; selected test caller is ordinary nonimpersonating Node.
Unknown/unsupported impersonation context denies, never widens owner policy.
No OpenProcessToken adjustment, DuplicateToken, impersonation, Se* enablement,
WRITE_OWNER or backup intent. Keep native parent/process/token errors private.

Open canonical ancestor chain to parent, verify each directory/non-reparse and
unchanged named/held identity with existing ancestor-owner allowlist. READ_CONTROL
must be added for handle security reads; retain parent handle (no DELETE share),
actual volume/file identity and native descriptor. Owner checks use handle-bound
GetSecurityInfo rather than a path-only Get-Acl as creation authority. Existing
hold-mode behavior is not silently broadened. Verify chain again before birth.

C# P/Invoke user-mode ntdll NtCreateFile (int NTSTATUS), out SafeFileHandle,
OBJECT_ATTRIBUTES by ref, IO_STATUS_BLOCK by out; explicit sequential structs:
UNICODE_STRING ushort Length/MaximumLength + IntPtr Buffer; OBJECT_ATTRIBUTES
uint Length + IntPtr RootDirectory/ObjectName + uint Attributes + IntPtr
SecurityDescriptor/SecurityQualityOfService; IO_STATUS_BLOCK IntPtr Status +
UIntPtr Information. Marshal.SizeOf gives architecture-correct padded size;
Unicode length is checked UTF16 byte count <=ushort range, retained unmanaged
buffers have explicit one-owner free in finally. SafeHandle parent is protected
with DangerousAddRef/Release around raw RootDirectory use; no numeric handle
crosses the process protocol. Reject unsupported architecture/ABI size.

Initial RawSecurityDescriptor uses actual selected owner SID and protected DACL
with exactly own-user and SYSTEM full access, directory/container inheritance:
O:<actual-user>D:P(A;OICI;FA;;;<actual-user>)(A;OICI;FA;;;SY).
Retain descriptor bytes/pin through NtCreateFile completion. This applies only
at fresh creation; existing objects are never changed or adopted.

Native call: DesiredAccess READ_CONTROL|FILE_READ_ATTRIBUTES|SYNCHRONIZE
(0x00120080); ShareAccess READ|WRITE (3), no DELETE share;
CreateDisposition FILE_CREATE (2), FileAttributes DIRECTORY (0x10),
CreateOptions FILE_DIRECTORY_FILE|FILE_SYNCHRONOUS_IO_NONALERT (0x21),
AllocationSize/EaBuffer null, EaLength0, OBJECT_ATTRIBUTES case-insensitive0x40,
SecurityQualityOfService null. No OPEN_IF/overwrite/delete-on-close/backup flags.
Check exact successful synchronous NTSTATUS0, noninvalid actual returned handle,
IO_STATUS_BLOCK.Status0 and Information FILE_CREATED2; pending/other statuses or
FILE_OPENED/unknown info deny and retain original facts. A failure/collision is
not Win32 GetLastError: retain actual NTSTATUS+IO status at occurrence and its
native exception privately, no inferred error183 mapping or blind retry.

Retain SAME created handle in guardian held list, read actual owner/DACL/type/
non-reparse/volume-file identity and compare relative named entry under retained
parent; reject missing/extra inherited ACE or changed identity. Verify all
ancestor identities again. Descriptor readback is independent of desired bytes.
Keep actual security/principal/parent/created-handle originals until handoff.

## Closed private protocol and overlapping custody

Creation protocol is separate fixed grammar inside guardian, not current loose
ready JSON. Exact ASCII lines LF only, nonce lowercase32, fixed monotonically
increasing sequence, no trim/unknown/extra/duplicate/trailing/partial acceptance:
child GDC1|nonce|1|created-held LF only after full birth/readback;
parent GDC1|nonce|1|verify LF -> child GDC1|nonce|2|verified LF;
parent GDC1|nonce|2|handoff LF -> child GDC1|nonce|3|handoff-held LF;
parent GDC1|nonce|3|capture LF -> child GDC1|nonce|4|capture-held LF;
parent GDC1|nonce|4|close LF -> child GDC1|nonce|5|closed LF after native closes.
No SID/path/PID/handle/exception in success wire. Local owned child identity and
actual private native state, not these bytes, supply correspondence. One pending
request, no unsolicited frame; completion waits write callback/finish, stdout+
stderr EOF, real close0/no signal and exact expected final frame. Nonempty stderr
is failure retained privately. Spawn/stdin/EPIPE/stream/signal/partial/nonzero/
unknown frame fails closed. No public denial minting or fake native proof seam.

Creation object returned internally owns private guardian closure and created
path; it is not a JSON authority packet. At created-held the creator remains
alive holding parent and original root. Boundary sets diagnosticRoot to that
same path and runs UNCHANGED protectOriginalFixture; independently acquire a NEW
holdFixtureRoot(diagnosticRoot,diagnosticRoot), then verify it. During all those
calls creator still holds original; new hold must be alive and verified. Reverify
creator, send handoff, receive handoff-held while BOTH native holds overlap.
Keep creator alive after acknowledged handoff until all diagnostic borrowers
and independent holders settle, then require original closure/EOF/exit result.
No create-close-before-acquire interval. Keep the new
diagnostic custody private on boundary through diagnostic writes/receipt retention
and release it only after original root guardian settlement and private evidence
writes. Boundary.release must settle both holders once, preserving each failure;
remove cannot delete a still-held object. No writer-exclusion/removal grant.

Failure before completed handoff: never return successful allocation; retain
created directory/name and actual private failure bundle, settle owned child
through the borrower-aware protocol below; do not delete unknown
state. Postcreation failure must retain directory path privately even though
initialize rejects, so later private diagnostic/cleanup does not lose originals.
Close may not erase primary failure. New creation/diagnostic roles MUST NOT
inherit the existing guardian5s close/SIGTERM/SIGKILL routine while any borrower
is active. No new timer, retry, kill or deadline authority is selected. Original
root role keeps its existing policy, which cannot settle the other roles.

Keep exact first and later opaque JS errors in private WeakMap with occurrence
flag/order, without code/message getters/stringification/cause/log projection.
C# native statuses/errors and PS ErrorRecords are retained by guardian until
explicit settlement; private failure transport must preserve these original
records within that occurrence, not pretend JSON copies are original objects.
If child exits, retain raw private stdout/stderr and closure as evidence, with
unavailable original-object custody reported truthfully. Public diagnostics use
existing initialization stage/closed failed operation only; no raw identity.

## Coverage and input obligations

Meaningful real provider cases: fresh birth/readback/overlap-handoff; genuine
preexisting directory rejects and unchanged bytes/owner; parent-name replacement,
reparse, owner/descriptor mismatch; original handle alive until independent hold;
created directory retained on readback/handoff/close failure; primary+independent
original retention. Ordinary fake-child tests are explicitly protocol surrogates:
all frame chunking/order/nonce/EOF/extra/stderr/spawn/EPIPE/stream/signal/nonzero
and opaque null/undefined/getter originals; they cannot prove native ownership.
Existing true foreign-owner denial must still fail. Original compiler regression,
all Windows/Linux matrix, packaged cleanup/full suite remain required unchanged.

New native source/guardian argv and all raw mutations/fixtures require full source
review and NEW actual-input ROOT admission including physical WindowsPowerShell,
C# compiler/.NET/native DLL ABI/runtime/ENV/loaded holders/generated dist/package
inputs and independent provider occurrences. Current proposals are incomplete;
PS7 AST correspondence is unrelated to this fixture tool. No local target run,
installation/tool change, native probe or retry is authorized by this document.
Protected DEV publication/GA remain parent/release-owner decisions. Packaged EBUSY
is separate unknown-owner cleanup gate and receives no waiver from this repair.

Primary API source:
https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile
https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights

## Revision2: role-specific receipts and independently settled writers

Fixed internal receipt roles: original-root keeps guardian-stdout.bin,
guardian-stderr.bin,guardian-custody.json; diagnostic-root uses diagnostic-
guardian-stdout.bin,diagnostic-guardian-stderr.bin,diagnostic-guardian-custody.json;
birth uses birth-guardian-stdout.bin,birth-guardian-stderr.bin,birth-guardian-
custody.json. All files wx, one role-owned write attempt; no caller-selected
prefix, overwrite, delete, append, retry or shared filenames. Separate private
owner/settled/pending state per role; one failure cannot skip another settlement.

closeFixture's actual release-before-retainErrors order changes explicitly:
1. Existing process settle/ENV restore/state/privacy remain; retain exact first
   and later originals immediately with an occurrence flag and ordered stage.
2. Independently release original-root holder and retain its receipts while
   creator+diagnostic holds remain. Disposable original-root removal releases
   only that holder, never all diagnostic borrowers through evidence.release.
3. Verify diagnostic holder and creator; invoke existing report ONCE while the
   creator/writer and diagnostic holder are still genuinely live. Projection
   explicitly declares diagnosticCustody:pending, as specified below. Retain
   any SAME report failure at diagnostic stage, then persist useful private
   failure capture for ALL currently known originals INCLUDING report failure.
   Then release diagnostic holder independently,
   retaining its role receipts while creator's original directory hold remains.
4. Capture diagnostic-holder failures while creator still owns original. Write
   ONE separate wx fixture-private-late-errors.json for genuinely safe supported
   late captures, preserving the earlier fixture-private-errors.json unchanged.
   Both writes require creator actual verify/name/owner checks, no path fallback.
5. With zero active borrowers, settle creator last. Its native close failure or
   missing EOF/ack remains original private failure; final persistence is
   explicitly unavailable once no genuine writer/holder can write. Never claim
   an earlier receipt contains that later error. No postclose write/reopen.
6. Compute final closed flags AFTER final creator settlement; do not report
   again. Throw existing AggregateError with actual ordered originals and final
   closed projection when any operation/settlement/persistence failed. A final
   successful return requires genuine completed settlement, not the earlier
   callback. The report-failure original was captured in step3 while live.
   Existing AggregateError.errors identity is private caller/test custody, not
   operator JSON/log projection. A closed receipt is not durable original data.

Boundary exposes separate internal settleOriginal/settleDiagnostic/settleBirth;
public release is idempotent complete independent settlement for finally callers,
not the method used for step2 alone. Partial initialization retains actual path,
created owner and partial holders privately even when no allocation result is
returned. No successful guard escapes without its owner being reachable from
boundary. Failed writes are retained originals and cannot suppress later closes.

## Revision2: preserve useful private cause evidence without getter formatting

Remove privateError's generic name/message/stack/cause/errors reads and arbitrary
String(error), JSON.stringify(original), toJSON, inspect or stack formatting.
Retain originals FIRST in private boundary WeakMap. No getter/capture failure may
replace the original. Explicit occurrence preserves null/undefined/falsy throws.
Useful persisted data is a safe CAPTURE, never serialized original-object/native
authority. Existing protected PRIVATE-content assertions remain mandatory for
supported genuine captures; ordinal/stage-only receipts cannot satisfy them.

Selected safe capture is deliberately narrow and field-specific:
- Source-owned constructed errors store their known primitive diagnostic data in
  a private WeakMap AT construction, before handing the Error to another caller.
  Original native status/operation values are retained at their actual callsite;
  no later code/message guess or error.code getter supplies them.
- For existing external genuine native Error values, use Node util.types
  isNativeError plus isProxy exclusion before specific own-property descriptor
  access; never enumerate descriptors/ownKeys or inspect stack/name/prototype.
  Only own DATA message:string, cause:known-supported-original, and errors:actual
  nonProxy Array of supported originals are candidates. No accessor invocation,
  no inherited field, no .map/toJSON iteration from supplied objects. Array
  length/index DATA descriptors only; unknown/accessor/interceptor/failure marks
  capture unavailable. isNativeError is eligibility, not persisted authority.
- Do NOT touch Error.stack even through getOwnPropertyDescriptor: pinned Node
  v22.23.2 V8 js-objects.cc1694–1821 shows descriptor resolution may invoke
  Object::GetProperty for native accessors and interceptors. Lazy stack can run
  custom formatting. No generic descriptor no-JS claim is made. Implementation
  must verify selected exact field/native-brand semantics against pinned source
  before asserting that eligible message/cause/errors inspection is nonexecuting;
  if not established, external error capture is unavailable and tests/contracts
  requiring useful durable causes stay FAILED, not rewritten as metadata PASS.
  https://raw.githubusercontent.com/nodejs/node/v22.23.2/deps/v8/src/objects/js-objects.cc
- Bound safe snapshot to64 error nodes, depth8, each string<=16384 UTF16 units,
  total UTF8<=65536 bytes. Preserve cycle references by source-owned ordinal;
  no truncation called complete. Any unsupported field/overflow/copy/write
  failure records unavailable capture; original+owner remain retained privately.
  Pure primitive strings/null/undefined/boolean/finite numbers can be tagged
  exactly without coercion; unsupported symbols/functions/objects remain opaque.

Do not weaken existing private-file tests562/644 to ordinal receipts. Add actual
supported Error cause/aggregate PRIVATE-content cases plus hostile Proxy, native
Error message/cause/errors accessors, custom Error.prepareStackTrace, cycles,
null/undefined, overflow, write and late-close failures. Test supported capture
content AND original identity/order; opaque unsupported capture must produce
private_diagnostic failed/unavailable despite original identity remaining held.
Private original identity can be compared by identity-only predicate, not a
public raw error/denial/authority mint. No durable availability claim survives
process exit merely because a WeakMap once held the object.

## Revision2: protected real replacement test adaptation

The existing diagnostic replacement test400 renames before privacy; birth handle
denyDELETE sharing makes that actual rename reject earlier. Explicit prospective
GOV05 amendment, requiring this intent review: keep Linux replacement row;
Windows splits into two real native obligations instead of pretending redirect.
A. At same before-privacy hook actually attempt rename while creator owns root;
   require native denial and unchanged named/held root identity. Rethrow SAME
   rename original. Diagnostic privacy stage fails before protector; privacy
   observation stays not_attempted (never synthetic redirect), no reset/removal.
   Outside bytes/mode/ACL unchanged and private capture reflects real outcome.
B. Separately create a genuine junction to outside BEFORE calling unchanged
   protectOriginalFixture on that path, outside creator's retained namespace.
   Require actual native redirect rejection plus outside bytes/mode/ACL unchanged.
No skip, fake child/code, releasing guardian to permit attack or merely checking
source strings. Existing original-root junction initializer and true ROOT
foreign-owner prior-policy cases remain mandatory; no fixture owner changes.

## Revision2: bounded protocol and active borrower state machine

GDC1 keeps five child frames/four commands, nonce and exact sequence, one pending
request. Strict ASCII line<=96 bytes including LF; each direction<=480 total;
reject CR/NUL/nonASCII/blank/extra/duplicate/trailing/partial frames. Chunked byte
decoder never trims. stdout raw capture<=480bytes, stderr<=16384bytes. Overflow
retains bounded original prefix+actual bytecount/overflow fact, stops success
parsing, marks capture unavailable; no kill/retry/drop called complete. Pending
request/ack is unique actual owned invocation, no receipt flag as native proof.

Creator admits only selected privacy and independent hold acquisition borrowers,
tracked by actual invocation start/settlement, not a supplied PID/handle/JSON.
Failure rejects NEW borrowers but retains existing original until active ones
actually settle. Handoff requires privacy success, live verified diagnostic hold,
creator verify acknowledgement. Creator stays alive after handoff while original
root/diagnostic operations and private writes execute. Lost ack cannot authorize
close or successful handoff. Privacy failure waits same privacy child close/EOF;
partial new-hold failure settles that same partial owner while creator remains.
No new timer, grace period, forced signaling or retry is introduced.

Parent stdin EOF/death makes guardian reject new work and dispose its owned
handles; mark custody lost, not retained after exit. Existing independently held
borrower remains its actual owner; no valid handoff means failed allocation.
Node sees early child close/signal/EOF: deny pending success, retain exact evidence,
settle actual active borrowers independently, never delete directory. A borrower
that never settles leaves closure unresolved under external original admitted
supervision; it does not authorize inherited SIGTERM/SIGKILL on new owners.
Late native/JS originals and missing persistence stay failed/unavailable, never
substituted by closed receipts or an absent external F7 factory.

## Revision3: one explicit report/capture/settlement timeline and protected ledger

Stable review signature: private-capture/settlement contradiction occurred at5c4
andc080 (two evidenceful iterations). This is a material whole-timeline repair;
a third equivalent contradiction triggers GOV13 scoped model reassessment.
Other accepted revision2 obligations remain, not a reviewer/history reset.

Single callback timing is now fixed between original-root settlement and FIRST
private capture, while actual creator AND diagnostic holder are verified/live.
Add source-owned diagnosticCustody field to hard-crash summary only:
- pending: new native creator/final diagnostic settlement remains active;
- settled: no new creator exists and original legacy settlement has completed;
- unavailable: actual prior custody already lost/unknown.
No final completed/success claim is made by pending. Existing stop/finalization/
absence/fixture/evidence fields describe already-observed PROCESS/fixture facts;
clear stage means no observed failure YET, not final custody success. The final
thrown fixtureStages reflects later failures; the earlier summary intentionally
remains pre-final, with no mutation, second callback or synthetic late event.
No report consumer may treat pending as terminal source/cleanup qualification.

Actual source-consumer audit: startup-hard-crash-matrix.js238 console emits the
summary, no exact-key decoder; hard-crash-fixture-custody.test.js stores it and
asserts process absence/fixture/privacy/stage facts; removal-rows.js stores it
and asserts physical original removal. Those facts retain their meaning.
fixture-history-observation.js has its OWN schema/callback and imports only the
privacy catalogue from this helper; do not confuse its complete flag with this
new source-owned summary field. Whole-review must verify all report callsites
and add pending-not-final assertions to actual new creator lifecycle tests.
Existing single-report count remains; no passing callback serves as final ack.

Required timeline ledger (each row retains exact first/later originals before
attempting inspection/capture; capture is separate and truthful):
T0 initialize/adapter snapshot/stop/finalize/inspect/restore/state/privacy failures
   -> original roster, process/fixture stage flags; all holders tracked.
T1 original-root settle/receipt failure -> held_release original, creator+diag
   live; sibling settlement continues. Actual disposable removal releases only
   original role, never creator/diag.
T2 report invocation -> ONE callback with pending; genuine PRIVATE-STAGE-diagnostic
   throw joins diagnostic roster; supported message must enter ordinary private
   cause file atT3. Callback success/failure does not close any holder.
T3 first retainErrors -> fixture-private-errors.json includes all supported
   genuine T0/T1/T2 causes. Write/capture failure is private_diagnostic, exact
   original retained; no metadata receipt substituted for unavailable content.
T4 diagnostic settle/receipt failure -> held_release original; creator still
   owns directory. Capture supported T3/T4 late causes ONCE into fixed separate
   fixture-private-late-errors.json while creator actual verify/capture ack holds.
T5 final creator settle -> original actual close/EOF/status failures retained
   privately, persistence UNAVAILABLE if no live writer remains. No retroactive
   claim these errors appeared in T3/T4, no postclose write. Both primary error
   and independent final failure survive in final AggregateError roster.
T6 final failure/return decision -> actual final projection on thrown error,
   no second report. A creator remaining unresolved cannot produce success.

One fixed T3 write and one fixed T4 write, wx, no overwrite/retry. If the ordinary
T3 capture succeeded but T4 write fails, T3 remains useful partial evidence; final
private_diagnostic fails and unavailable late evidence is explicit. If T3 fails,
T4 cannot be counted as a successful replacement of required original private
file. Final in-memory original custody is not durable content. No physical
holder/process cleanup implied by mere projection or serialization metadata.

Cross-check against actual protected tests (none weakened):
- custody.test.js527–568 loops snapshot/inspection/preservation/removal/diagnostic/
  enrollment_observation/custody/fixture_initialization/private_diagnostic. All
  genuine PRIVATE-STAGE-<stage> messages remain in required private file except
  existing explicitly rejected private_diagnostic write. In particular T2 report
  failure is BEFORE T3, so PRIVATE-STAGE-diagnostic is genuinely persisted.
- custody.test.js635–645 original Windows fingerprints/PRIVATE-ORIGINAL-FAILURE
  remain unchanged and privately useful, with same original AggregateError entry.
- custody.test.js149–174 mocks independent release failure and retainErrors:
  no native creator means compatibility settlement occurs T1; captured failure
  retains identity; new pending field cannot manufacture mock native custody.
- test evidence wrapper539 must FORWARD actual boundary's separate settleOriginal,
  settleDiagnostic,settleBirth/retention lifecycle methods (not call release-all
  atT1). This is interface plumbing, with exact stage/error/file assertions kept.
  Other actual wrapper/mocks must be enumerated before implementation freeze.
- finalization/reset/removal/restore failures retain their original ordering and
  no-reset-after-rejection rules; final creator failure cannot make them vanish.
- add genuine supported report failure + diagnostic close failure + final creator
  late failure in ONE occurrence; assert T3 report content, T4 supported close
  content, final late-original identity/unavailable persistence, ONE callback and
  no write after last actual close. Surrogates alone cannot prove native holds.

This ordering change is explicitly selected prospectively for intent review;
it preserves useful private-cause evidence and changes summary timing semantics
only by declaring pending actual diagnostic custody. No native execution, test
weakening, output waiver or final-success claim is granted by this proposal.

# #1562 fresh diagnostic directory birth and guardian handoff — proposed intent

Status: PRE-CODE PROPOSAL, awaiting DIFFERENT bounded intent review against
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
parent GDC1|nonce|3|close LF -> child GDC1|nonce|4|closed LF after native closes.
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
Then close creator and require original closure/EOF/exit result, leaving the new
diagnostic hold active. No create-close-before-acquire interval. Keep the new
diagnostic custody private on boundary through diagnostic writes/receipt retention
and release it only after original root guardian settlement and private evidence
writes. Boundary.release must settle both holders once, preserving each failure;
remove cannot delete a still-held object. No writer-exclusion/removal grant.

Failure before completed handoff: never return successful allocation; retain
created directory/name and actual private failure bundle, settle owned child
through existing admitted guardian supervision policy; do not delete unknown
state. Postcreation failure must retain directory path privately even though
initialize rejects, so later private diagnostic/cleanup does not lose originals.
Close may not erase primary failure. Existing guardian5s supervision is not
extended/reduced or retried; any reuse must preserve exact owned child identity
and record forced/unresolved closure as failed custody, never successful handoff.
Do not install a new timeout/kill policy under this intent.

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

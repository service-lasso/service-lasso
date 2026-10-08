# Complete original endpoint outputs — source proposal, no decision

Issue #1687 / SPEC-010 F7-01/F7-02/F7-03/F7-07/F7-08/F7-09. Entire U1 is
INCOMPLETE. This proposal preserves the current approved v1 payload/schema and
the separate amendment04 hold. No native call, compiler, parser or fixture was
executed. Actual SDK/libc/kernel/loaded-image/allocator/actor/ROOT catalogs,
reservations and original caller/source admission remain ABSENT.

## Current whole owning graph and exact loss

`error-producer-queue.c::writer` owns the existing original outbound endpoint.
It takes one immutable role/lifetime/sequence frame from the normal/emergency
rings into its caller-owned write buffer, calls
`error-producer-endpoint.c::f7_error_endpoint_write`, and copies the resulting
compact fact into status and append-only caller-owned native history.
`SLF7EFC1` has a 48-byte header and 32-byte operation/argument/result/error
entries. The queue reserves the declared frame count times the maximum existing
record extent before construction. This is logical storage, not physical charge.
The history remains original caller-held memory; no existing call transfers its
full raw native outputs into independently persistent O custody. Calling an
encoder or seeing that buffer does not repair this missing production callsite.

Linux `original` currently allocates automatic `stat`, reference `stat`,
`ucred`, `socklen_t`, socket type and `pollfd` objects. The compact history loses
their complete original output bytes, lengths, input buffers and field-knownness.
Windows compact records retain scalar results and packed WriteFile counts but
do not provide a typed original input/output inventory or complete knownness.
Construction similarly retains compact pthread/Windows statuses while original
attribute/synchronization/thread objects and full arguments are not a complete
original SDK observation graph. Successful native return is not complete capture.

## Exact existing endpoint operations, without a new catalogue selection

| Existing operation | Original input and output that must be retained |
|---|---|
| Linux 1,22 fstat | exact held fd input; separately typed original `struct stat` buffer before and after; exact int return and contemporaneous errno on failure; initialized versus API-defined output distinction |
| Linux 2 fcntl F_GETFD | exact fd and command; exact int return; failure errno; no inferred missing flags |
| Linux 3 getsockopt SO_TYPE | exact fd/level/option; original int buffer before/after; original socklen_t input/output; exact int return and failure errno |
| Linux 4 getsockopt SO_PEERCRED | exact fd/level/option; full original ucred buffer before/after; original socklen_t input/output; int return/errno; no inferred creator/source admission |
| Linux 5 poll | original held pidfd, complete pollfd input/output, nfds and zero timeout; exact int return/errno; raw revents distinct from liveness conclusion |
| Linux 6 send | original held fd, exact original frame extent/bytes and flags; exact ssize_t return/errno; known transferred prefix only on successful return |
| Windows 12 CompareObjectHandles | both exact held original HANDLE inputs, exact BOOL result, contemporaneous DWORD error/knownness |
| Windows 7 GetFileType | exact held HANDLE, raw DWORD result, original GetLastError status when queried; FILE_TYPE_UNKNOWN does not itself distinguish valid unknown type from failure |
| Windows 8 WaitForSingleObject | exact held process HANDLE and zero timeout; raw DWORD result and failure error; no process/source inference from a wait result |
| Windows 9 GetProcessId | exact held process HANDLE; DWORD result/error and definedness |
| Windows 10 GetNamedPipeServerProcessId | exact held pipe HANDLE; original ULONG buffer before/after; BOOL return/error; failed output stays raw and unknown |
| Windows 11 WriteFile | exact held HANDLE, original frame offset/extent/bytes, DWORD request, original DWORD written before/after, NULL OVERLAPPED, BOOL result/error; failed output never becomes delivered prefix |

Construction operations 13..21 must additionally retain complete exact original
InitializeCriticalSectionEx/condition/CreateThread and pthread mutex/condition/
attribute/stack/guard/create/destroy input/result/output objects in source-owned
slots. The existing operation numbers alone do not define their ABI or authority.
Full raw GetLastError/errno query provenance and knownness must be selected;
synthetic zero on successful calls is a compact projection, not an original error
query. Native handles/pointers remain private, never public fields or authority.

## Proposed closed storage and layout choice requiring whole review

Keep the existing `F7_GRAPH_NATIVE` payload kind and `SLF7GRF1` graph semantics:
its `original_native` bytes already permit an unmodified original native record.
Do not reinterpret `SLF7EFC1`, `SLF7WIT1`, member kinds, manifest_v1 or any existing
reader as a richer schema. A complete typed SDK record requires an explicit
distinct private record discriminator and source-bound layout; none is selected
or implemented by this document. Do not use amendment04 type11/kind23/manifest2
without its separate whole decision.

The candidate original caller owns a finite array of typed call slots and raw
input/output arenas before the first effect. Each slot binds operation, ordinal,
original SDK/loaded-image/kernel/libc and wrapper source, exact input/output type
layout/alignment, raw original argument values, raw buffer extents, actual return,
actual error-query outcome and API-defined known-field masks. Complete raw bytes
and initialized byte states are distinct from API-known fields after failure.
Use actual source-selected typed objects or ABI-aligned caller buffers as the
native output targets; capture originals in place. Do not reconstruct `stat` or
ucred from identity projections, dereference unknown ownership, infer output
extent from a failed API, or retain only a digest. Copying padding can retain its
initialized raw state but cannot mark padding or failed output API-defined.

The exact selected SDK/compiler declarations and native type extents determine
storage; their actual input catalogue is ABSENT. No arbitrary fixed byte cap,
universal struct size, new resource, or fake original observation is supplied.
Every per-call slot, raw-input copy, raw-output target/copy, field mask, frame
slice commitment and history envelope is checked cumulatively against the
original held physical reservation before native effects. The existing finite
call and frame counts remain; unknown native/source branches reject before the
query and retain prior originals. Caller-owned capacity is not allocation proof.

## Persistence and nonrecursive original custody dependency

Ordinary endpoint SDK observations can be serialized from their retained typed
slots without rerunning the native query. Full raw bytes may fit a v1 native
graph only after checked exact sizing; overflow retains the original whole
slots/known prefix and marks capture incomplete. Existing fragmentation accepts
known partial serializer snapshots, not arbitrary complete SDK records; do not
silently reuse it or invent a generic larger envelope.

Transmitting the writer's own write-history through that same endpoint creates
another original write observation. A terminal status or in-memory array cannot
claim this recursion is closed, and original producer death can lose unpersisted
history. A complete selected path must bind genuine original ownership through
independent O custody and its final retained native facts, existing original
members/held capabilities, finite terminal slots and a nonrecursive terminal
proof. No extra persistent member, actor, pipe, signed-looking receipt, ROOT
issuer or Boolean bypass is introduced here. The actual authentic production
handoff and terminal custody path are unresolved; amendment04's proposed member
bootstrap/release proof is not permission to implement this separate endpoint
extension. This is a material whole callgraph/storage/layout decision.

## Integration and regression obligations

The original native writer must receive the source-bound slot/arena/reservation
bindings from its existing owning creator before it starts. Endpoint writes use
those exact buffers and retain every attempted call before later APIs overwrite
its state. Node/native producers preserve their original graph and queue bytes;
the full output/history decoder only interprets the selected catalogue and never
issues source/actor authority. O manifest/index/journal/package and SAME recovery
must enumerate and independently read back the actual retained original record
members under the selected closed v1 or separately reviewed new contract.

All seven formal and two recovered rows require owning positive and negative
regression source with real fixture-owned original handles/SDK inputs: success,
each failed call, short/partial writes, malformed original return/output geometry,
unknown field state, reservation/slot exhaustion before another call, native
producer death, O readback/custody failure and SAME retained recovery. Existing
alias regressions cover only storage rejection; they are not these full rows.
No input failure, injected identity, fixture removal, original deadline or D1
same-isolate/all-W-exit-before-delete NO-GO is weakened. Independent eligible v1
source continues while this exact material decision awaits architecture review.

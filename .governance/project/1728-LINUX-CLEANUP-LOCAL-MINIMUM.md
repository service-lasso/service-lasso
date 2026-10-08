# #1728 / #1724 cleanup repair: LOCAL_MINIMUM

2026-10-08, Development; current repair chat remains the owner. Work unit is
BLOCKED / LOCAL_MINIMUM under gov-02 Execution circuit breakers and
gov-13 REV-017/019/022. This records a failed delivery path, not a fix.

The user selected `allocation_reserved` as the first repair, then authorized
implementation. Live readback confirms PR #1729 is still OPEN/DRAFT at
83e4d9855035a34bb2ce88d47d6c991e2dfae0a7, targeting develop; the retained
creator checkout is clean at that head. It contains only the opaque creator
header, entry header and original Node source patch, with no creator or entry
body. Existing U1 observer.h still lacks the proposed f7_observer_begin.

The preserved full Linux receipt remains 1954 tests / 1856 pass / 11 fail /
87 skip. Its allocation_reserved row reports recovery=resume, settled stop
and finalization, retained original/copy, removal=failed and reset=not_attempted.
The Linux tests/fixture-root-custody.js remove method in the #1724 checkout
still throws unconditionally at line227. Held descriptors and pathname checks
do not prove exclusion of same-uid writers. No recovery defect is established
by this receipt. No newer execution result qualifies the changed source.

The existing path accumulated contract/ADR/header changes without improving
verified behavior. Different receiving-contract and canonical-source reviews
resolved design findings, but did not deliver executable capture, removal or
reset. This meets the circuit breaker's growing-diff/no-verified-improvement
condition; another unconnected component or unavailable-only stub would not
change the failure signature. Further implementation mutations in this unit
stop here. The narrower row still requires the same protected custody proof;
selecting it does not waive SPEC-010 F7-01..F7-09 or create resource admission.

Current missing connected prerequisites are the original creator/entry and
independent admission-owner source graph, compatible U1 receiving/error
adapter, actual source/native/layout/allocator catalogs and original finite
reservations. Separate execution prerequisites remain genuine issuer/role/
key/receiver/resource identities and NEW complete exact-input ROOT admission.
They are explicitly absent in the active spec and owner dependency report.
Neither a pointer/Boolean nor this author can manufacture their authority.

Resume requires a materially changed recovery path: deliver those connected
source/admission prerequisites, or obtain an explicitly reviewed smaller
architecture and acceptance update that is actually executable. A repeated
request, new agent, another plan or another header is not a resume condition.
Do not claim this incident artifact as implementation progress.

Preserve the #1724/#1728 issue branches and open PRs, other #1640/#1687 owners,
original protected test bodies, Error/Map/ENV identity, private evidence and
retained D-state container. No compiler/import/build/test/native action,
cleanup, merge, resource provisioning or release was performed in this audit.
The primary shared checkout was not modified. All eleven failures remain
unresolved. Existing issue #1728 is the bounded follow-up; #1724 owns the
complete eleven-row acceptance.

# #1687 original member-adoption storage proposal — decision pending

SOURCE PRE-CODE ONLY. This describes the missing constructor input and caller
integration for the same unfinished U1. It is not an implemented interface,
ROOT issuer, admission receipt, physical reservation, or architecture GO.
Parent requires a NEW different whole architecture review before implementing
the materially changed owning constructor. ROOT producer repair03 remains a
separate proposed owning boundary. Existing production signatures are unchanged.

## Observed current gap

At source head f82e3d83, `capture-spool.c` calls `f7_identity_read` inside
`f7_member_adopt` after clearing the member. That query occurs before caller
readback/history/protection storage can be bound. Its Windows path allocates an
original SD through `GetSecurityInfo`, hashes selected DACL/control bytes, and
calls `LocalFree` without retaining the full original SD or its free result.
Several failure branches also free it. `f7_identity_read` collapses the original
query outcome into a private logical return. Linux currently retains selected
stat fields in a digest; that is not complete ACL/xattr/ancestor/mount proof.

Actual initial member adoption caller is ABSENT in this owned source. The
proposed external ROOT initializer must resolve ownership exactly once, before
any identity/protection observation. A later setter, readback reservation, digest
or signed-looking private record cannot repair the earlier effect.

## Exact proposed typed input boundary

The original ROOT source owner must provide a closed, noncopyable native
reservation before calling the proposed constructor below. This is proposed C
ABI shape only; no new production header or positive caller is added here.

```c
struct f7_original_member_storage;       /* defined by the reviewed native ABI */
struct f7_original_member_observation;   /* retained original outputs/state */
int f7_member_adopt_original(
    struct f7_member *fresh_member,
    f7_handle original_exclusive_empty_file,
    const struct f7_original_member_storage *original_storage,
    struct f7_original_member_observation *original_observation);
int f7_identity_read_original(
    f7_handle original_held_object, int original_directory_decision,
    const struct f7_original_member_storage *original_storage,
    struct f7_original_member_observation *original_observation,
    struct f7_identity *identity);
```

Required storage fields, with no default allocation or numeric allowance:

The following closes the proposed data structs for the architecture author.
It remains pre-code: SDK-dependent sizes/alignment and authentic reservation
issuer are ABSENT, and this is not a substitute for their source integration.
The pointed-to held reservation is the original ROOT-owned resource boundary;
no constructor for it, receipt-to-capability conversion or boolean callback is
provided by U1. Every byte view remains original custody data, not authority.

```c
struct f7_original_bytes { const uint8_t *bytes; size_t length; };
struct f7_original_held_charge_reservation; /* actual owning issuer still ABSENT */
struct f7_original_allocator_envelope {
    struct f7_original_bytes query_site, loaded_native_sources, call_graph;
    struct f7_original_bytes creator_sd_domain, allocator_classes;
    struct f7_original_bytes rounding_rules, runtime_kernel_obligations;
    const struct f7_original_held_charge_reservation *original_reservation;
    uint64_t returned_bound, transient_bound, internal_bound;
    uint64_t runtime_bound, kernel_bound, call_bound, outstanding_bound;
    uint32_t known_bounds; /* one explicit known bit per bound; zero may be real */
};
enum f7_original_result_abi {
    F7_ORIGINAL_RESULT_UNKNOWN=0,
    F7_ORIGINAL_RESULT_WIN_BOOL=1, F7_ORIGINAL_RESULT_WIN_DWORD=2,
    F7_ORIGINAL_RESULT_WIN_HLOCAL=3,
    F7_ORIGINAL_RESULT_POSIX_INT=4, F7_ORIGINAL_RESULT_POSIX_SSIZE=5
};
struct f7_original_native_call {
    uint64_t ordinal; uint32_t original_catalog_operation;
    enum f7_original_result_abi result_abi;
    size_t raw_input_offset, raw_input_length;
    size_t raw_output_offset, raw_output_length;
    size_t known_field_mask_offset, known_field_mask_length;
    int returned, native_error_known;
#ifdef _WIN32
    union { BOOL boolean; DWORD dword; HLOCAL local; } result;
    DWORD native_error;
#else
    union { int integer; ssize_t count; } result;
    int native_error;
#endif
};
enum f7_original_allocation_state {
    F7_ORIGINAL_ALLOCATION_UNKNOWN=0, F7_ORIGINAL_ALLOCATION_OWNED=1,
    F7_ORIGINAL_ALLOCATION_RELEASED=2, F7_ORIGINAL_ALLOCATION_RELEASE_FAILED=3,
    F7_ORIGINAL_ALLOCATION_NOT_RETURNED=4
};
struct f7_original_allocation_observation {
    size_t original_query_record, original_release_record;
    size_t original_extent_record;
    enum f7_original_allocation_state state;
    uint64_t actual_charge; int actual_charge_known;
    size_t allocation_extent; int allocation_extent_known;
    size_t logical_bytes, copied_prefix; int logical_bytes_known;
    uint64_t protection_copy_offset, protection_copy_length;
    size_t release_readback_fact_begin, release_readback_fact_end;
    int release_readback_complete, release_transition_attempted;
#ifdef _WIN32
    PSECURITY_DESCRIPTOR original_sd;
    HLOCAL original_release_input, original_release_result;
#else
    void *original_returned_allocation; /* only selected API-owned allocation */
#endif
};
struct f7_original_member_storage {
    struct f7_original_native_call *calls; size_t call_capacity;
    uint8_t *raw_inputs; size_t raw_input_capacity;
    uint8_t *raw_outputs; size_t raw_output_capacity;
    uint8_t *known_field_masks; size_t known_field_mask_capacity;
    uint8_t *protection; size_t protection_capacity;
    uint8_t *native_names; size_t native_name_capacity;
    uint8_t *ancestor_records; size_t ancestor_capacity;
    uint8_t *acl_xattr_records; size_t acl_xattr_capacity;
    uint8_t *readback; size_t readback_capacity;
    struct f7_original_allocation_observation *allocations;
    size_t allocation_capacity;
    struct f7_member *original_protection_copy_member;
    f7_handle original_protection_copy_read;
    struct f7_original_bytes original_held_release_binding;
    struct f7_original_bytes original_protection_mutator_domain;
    const struct f7_original_allocator_envelope *original_allocator;
    uint64_t original_absolute_deadline;
};
enum f7_original_member_phase {
    F7_ORIGINAL_MEMBER_NOT_STARTED=0, F7_ORIGINAL_MEMBER_OBSERVING=1,
    F7_ORIGINAL_MEMBER_ADOPTED_OBSERVATION_COMPLETE_RELEASE_PENDING=2,
    F7_ORIGINAL_MEMBER_PROTECTION_PERSISTING=3,
    F7_ORIGINAL_MEMBER_RELEASE_READBACK_COMPLETE_PENDING=4,
    F7_ORIGINAL_MEMBER_RELEASE_FAILED_RETAINED=5,
    F7_ORIGINAL_MEMBER_RELEASE_COMPLETE=6,
    F7_ORIGINAL_MEMBER_INCOMPLETE_RETAINED=7
};
struct f7_original_member_observation {
    f7_handle original_object;
    const struct f7_original_member_storage *original_storage;
    size_t call_count, allocation_count;
    size_t raw_input_used, raw_output_used, known_field_mask_used;
    size_t protection_used, native_name_used, ancestor_used, acl_xattr_used;
    enum f7_original_member_phase phase;
    int started, observation_complete, incomplete, pending_original_ownership;
    int release_transition_attempted, release_complete;
    size_t original_protection_persisted, original_protection_readback;
    int protection_persistence_complete, protection_readback_complete;
};
```

Selected actual SDK headers supply the native types above; the proposal never
narrows `ssize_t`, BOOL, DWORD or HLOCAL into one generic status field. Raw query
inputs/outputs preserve exact ABI structures and their known-field masks in
separate caller-owned buffers. Their variable records require a closed encoding
selected from the actual native source before implementation. Source records
with padding or an unreturned field cannot claim all bytes were written by the
OS. Catalog operation ordinals identify original source calls, not actors or
grants. Bounds, ownership state and a reservation pointer cannot authenticate
themselves. Original ROOT source must prove and bind them before the query.

- Original fixed native-call record array, its entry capacity and consumed
  prefix; separately reserved raw returned-structure storage and byte capacity.
- Original protection-byte buffer/capacity, native-name/ancestor/xattr record
  buffers where selected, and original readback buffer/capacity.
- Original retained allocation/returned-ownership record array and capacity,
  with each actual allocation and failed release retained as distinct records.
- Original per-query raw-output buffers for writer, independent RO companion,
  journal, recovery and capability observations. Concurrent queries never share
  writable storage or overwrite an earlier record.
- Original source/ABI/allocator/row derivation references supplied by authentic
  ROOT custody, including actual fixed state, ring, copy, queue, thread stack,
  guard, runtime/kernel allocator and rounding charges. References are data
  bindings; this library cannot authenticate them or manufacture a catalog.
- Original finite query count, storage/physical charge bounds and deadline
  belonging to the already selected row. Zero, missing or unproved input rejects
  before the first native query, original member clearing or allocation.

`f7_original_member_observation` must retain the original handle and query order;
fresh/started/pending/complete/incomplete state; all raw native inputs and outputs;
which output bytes/fields are known; result and native error separately; actual
pointer ownership; copied prefix length; charged/unknown allocation size; and
original failed release outcome. No observation flag establishes admission.
No reset/retry may erase a consumed record, allocation pointer or failed prefix.

## Windows exact SDK ABI and returned ownership

The selected build must bind the actual Windows SDK declarations for `HANDLE`,
`FILE_ID_INFO`, `FILE_STANDARD_INFO`, `FILE_ATTRIBUTE_TAG_INFO`, `PSID`, `PACL`,
`PSECURITY_DESCRIPTOR`, `SECURITY_DESCRIPTOR_CONTROL`, `DWORD`, `BOOL`, `HLOCAL`
and their returned buffers. These are SDK ABI types, not wire-sized substitutes.
Exact header/compiler/loaded native source and ABI alignment catalogs are
ABSENT. A pointer number serialized into a private record is never a held object.

The closed observation sequence must retain individually:

1. Each `GetFileInformationByHandleEx` query class, exact buffer/size, returned
   BOOL, immediate failure error, original returned structure and known prefix.
2. `GetSecurityInfo` exact original held handle, object kind and requested flags;
   returned DWORD independently of optional last-error state; original owner,
   DACL and SD pointer outputs, including their initial and post-call states.
3. The original SD allocation ownership as soon as the call returns, before
   inspecting descriptor fields, hashing, copying, error formatting or release.
   Failure does not justify discarding a returned pointer whose ownership is
   unknown. The actual allocation source must settle that ambiguity.
4. Descriptor validation/control/length/SID observations with exact BOOL/DWORD
   outputs and original failure records. Original full SD bytes, owner and DACL
   slices must remain bound to the retained allocation and known lengths; the
   existing digest cannot replace those bytes or native observations.
5. `LocalFree` only at the reviewed ownership transition, with its exact input
   `HLOCAL`, returned `HLOCAL`, known error status and original allocation
   retained on failure/unknown result. Null-success, failure-return and no-call
   are distinct. No free result supplies D1, member/spool deletion or W reset.

The exact proposed allocation transition is: original native return -> retain
the returned pointer/result without interpretation -> validate original ownership
and allocation extent from the selected allocator source -> descriptor calls and
checked slices wholly inside that original extent -> full logical raw SD copy ->
O's own original protection-copy member persistence and ALL independently held
RO readback against those same original bytes -> one sole source-owned LocalFree
transition. Allocation extent, logical SD size, copied prefix and physical charge
are separate fields. Unknown extent/ownership stops before descriptor dereference
or release; failed/unknown native return does not authorize either. A failing
length/descriptor/copy/persistence/readback/free keeps the original pointer and
all prior raw results. No-call/success/failure release remain distinct forever.

The external amendment04 author's proposed nonrecursive phase can be represented
by these data structs, pending the NEW whole architecture decision. Constructor
may return ADOPTED_OBSERVATION_COMPLETE_RELEASE_PENDING: complete actual typed
observation/raw-copy into original precharged ROOT buffers, with successful SD
still original-owned. That phase does not require live O, an already adopted
protection sink, persistence/readback or LocalFree. The incoming protection-copy
member and RO companion are original reserved objects, possibly themselves
awaiting adoption/readiness; they are not new resources or an activation path.

Original ROOT adopts all initial members/RO companions under that phase, then
the sole O begin/readiness owner starts. O persists the finite original SD batch
into the EXISTING protection-copy member. A separate terminal release-proof reads
that fixed original byte range via the already held original RO companion and
checks exact bytes/hash plus original held identity/protection/mutator custody.
It must not call member_adopt/GetSecurityInfo or another security query: that
would create a new SD allocation needed to prove release of the previous one.
Only that original proof permits the sole LocalFree transition. No-call,
failed/unknown read or failed/unknown release retains SD and original facts.

Ordinary finalization and readback identity/protection queries remain distinct
original observations; their returned SDs enter finite later protection-copy
batches. They do not overwrite the initial batch or recursively issue release
proof. All terminal native reads/errors and still-owned allocations are included
in original finite reservations and all-nine-row charge derivation. The held
release-binding bytes are original custody data, not a self-issued authority.
Actual constructor/allocator/sink/held-mutator catalogs remain ABSENT, and no
phase is implemented or observed here. There is no second O initializer, hidden
bootstrap spool, fresh W workaround, new source grant or unobserved SD free.

Amendment04 also proposes a material dedicated terminal path for the EXISTING
`managed_witness_v2` protection-copy member. Its last SD observation occurs while
appendable and joins the final finite batch. After that observation, its own
terminal finalization/readback cannot use legacy `f7_member_finish` or
`f7_member_readback`, which query GetSecurityInfo. Proposed signatures for the
whole architecture decision are:

```c
int f7_member_finish_protection_original(
    struct f7_member *original_protection_copy_member,
    const struct f7_original_member_storage *original_storage,
    struct f7_original_member_observation *terminal_observation);
int f7_member_readback_protection_original(
    struct f7_member *original_protection_copy_member,
    f7_handle original_protection_copy_read,
    const struct f7_original_member_storage *original_storage,
    struct f7_original_member_observation *terminal_observation);
```

They require a genuine original immutable protection-mutator-domain and original
held writer/RO binding. Missing that proof refuses. They retain native flush,
size, FileInfo (Linux original fstat/statx) and bounded byte/hash read results in
the precharged caller slots, without a new security query or rerun. This is not
a generic boolean bypass of identity/protection. Ordinary other-member queries
continue to retain their own SDs and finite batches. Actual immutable-domain
creator/source/grant/kernel proofs remain ABSENT, and no terminal path is coded.

The exact member/frame/role/validator/manifest compatibility is also a required
whole-decision input. Existing U1 native witness bytes are `SLF7WIT1` with strict
160-byte metadata, 32-byte hash and closed optional event payloads. Original raw
native error records separately use F7_ERROR_GRAPH/F7_GRAPH_NATIVE. Amendment04's
managed_witness_v2/type11 cannot silently substitute for either, omit original O
witnesses, reinterpret bytes or manufacture a new ROOT/W role. The architecture
author must bind its exact existing member and closed catalogue encoding to the
current original-producer, native witness and canonical manifest call graph.

All call records and output buffers must be available before step 1. The
constructor cannot clear the original member or a supplied observation to make
geometry validation pass. Bounds include pointer/length overflow, field/slice
containment, object/output/state/history/protection/readback overlap, concurrent
owner storage, native alignment and record capacity before every native call.
Record exhaustion retains the original prefix and stops before another call.

**Unresolved physical allocation contradiction:** `GetSecurityInfo` allocates
its returned SD; it does not accept the proposed protection-buffer capacity.
Pre-reserving a copy buffer therefore does not bound the original API allocation
or native heap overhead/rounding. Positive source integration needs the original
creator's finite SD construction and exact selected native allocator obligation,
including actual returned allocation size and internal copies. Those are ABSENT.
An unknown allocation cannot be retrospectively declared charged. Selecting a
caller-buffer API instead would materially change the original query/caller
contract and requires whole review; this proposal does not select or implement
that alternative or erase historical GetSecurityInfo failures.

## Linux exact ABI and protection coverage

The original selected Linux libc/kernel/filesystem/ACL/xattr source must ground
`struct stat`, `fcntl` results/errors, raw stat output and field availability.
The current uid/mode/gid/link-count digest is insufficient for complete original
ACL/xattr/held-ancestor/mount coverage. No ACL library, unsupported-filesystem
blanket, absent-ACL assumption or new native endpoint is selected here.

The reviewed owner must supply the exact original held-object query APIs,
caller buffers, actual result/errno records and physical allocation obligations
for every required protection/ancestor observation. Dynamic name/value sizes,
ACL entries, query retries and mount facts need source-grounded finite bounds
before the first query. Unknown suffixes remain unavailable. Allocation or query
failure preserves actual raw structures and returned ownership; it does not
reclassify protection as sufficient or extend the finite row deadline.

## Production caller map required by the same constructor change

| Current source boundary | Required integration |
| --- | --- |
| `capture-spool.c` member adoption | Authentic original ROOT initializer supplies storage before first identity effect; exactly one O activation owner; current actual caller ABSENT. |
| `capture-spool.c` member finish | Separate retained query observation for writer identity, original append/flush/size facts and final hash. |
| `capture-spool.c` member readback, both identity queries | Independently reserved RO-query observations before and after ALL original readback; no overwrite of writer or earlier RO facts. |
| `capture-spool.c` read capability | Retain actual duplicate/query results and returned handle ownership, including failed-close outcomes; no caller path or new admission. |
| `attempt-journal.c` reserve/parse/validate | Fresh retained identity-query storage for each original writer/RO journal check, disjoint from journal entries/parsed prefix. |
| `transport-package.c` empty-native checks | Distinct original writer/RO identity outputs and ownership facts, not a shared temporary identity. |
| `recovery.c` before/after persistent-object readback | Per-object original held RO query storage and retained negative prefix; authentic SAME issuer remains separate and ABSENT. |
| `observer.c` prepare/finalize and six persistence workers | Entire original member storage graph is reserved before preparation; no later constructor or concurrent history alias. |
| `tests/fixture-privacy-custody.js` original managed helper | Original native/PowerShell failures and returned ownership remain in the actual child; extraction/bridge/caller is not supplied by this proposal. |

The legacy `f7_identity_read` wrapper must not remain a production escape from
the required observation/storage input. Every query above needs an explicit
owner and failure retention. A wrapper selecting hidden/default storage cannot
qualify the changed interface. The external ROOT author must map all exclusive
creations and RO companions to these constructor/query calls, without adding a
second O initialization path or a positive private capsule.

## All nine original row charges and rounding

Formal row names below are read directly from
`src/runtime/startup/transaction.ts`. Recovered rows are the two original extra
cases in `tests/startup-hard-crash-matrix.test.js`; they preserve actual same-W
Error identity and protected reset requirements. The future shared rows file
mentioned in ONE D8 is ABSENT in this owning base and is not fabricated here.

| Original row | Actual storage/physical allocator/rounding catalog |
| --- | --- |
| formal preflight_reconciliation | ABSENT |
| formal allocation_reserved | ABSENT |
| formal configuration_materialized | ABSENT |
| formal process_spawned | ABSENT |
| formal ownership_persisted | ABSENT |
| formal owned_readiness_proven | ABSENT |
| formal generation_committed | ABSENT |
| recovered process_spawned | ABSENT |
| recovered generation_committed | ABSENT |

For each row separately, enumerate actual member count and every repeated
writer/RO/query observation, native call count, raw/native/SD/ACL/xattr bytes,
retained original allocation, possible failed release, stack/guard, allocator
metadata and kernel object charge. Count simultaneous copies and outstanding
failed prefixes, not merely the serialized digest or nominal buffer size.

Checked rounding for a source-proved granule g and requested n is
`n / g + (n % g != 0)` units followed by checked multiplication by g; g=0,
overflow or unknown native allocation class rejects. Page, allocation-granule,
heap/allocator size-class, alignment, stack commitment/reservation and guard
rounding are separate original facts. Do not use one as another or infer an OS
allocation size from a returned descriptor's logical byte length. Physical
charges must bind the actual selected allocator/call site, returned ownership
and independent original resource reservation. Their catalogs and values are
ABSENT for all nine rows, so no numeric allowance or universal bound is claimed.

Checked whole-attempt and cumulative nine-row sums also retain independent raw
stdout/stderr/errors/control, normal/emergency witnesses, provenance/ENV/source
inputs, all manifest/index/signature/ciphertext/journal members, native queues,
readback and recovery copies. Existing `budget-reservation.c` arithmetic is
partial and cannot admit this new coverage. Original 5s/15s/120s/720s product
waits and private transfer deadlines remain exact; no rerun or extension follows.

## Review and continuation state

Required before constructor implementation: parent audit, NEW different whole
architecture decision, exact native ABI/caller/storage/charge integration and
governed pre-code artifacts. Actual source owner/catalog/actors/keys/grants and
resource reservations remain ABSENT. Independent existing U1 source work may
continue; this proposal neither stops nor completes the selected unit. Complete
connected source/regressions and a NEW different ENTIRE final source review,
followed by NEW complete execution ROOT, remain mandatory before execution.

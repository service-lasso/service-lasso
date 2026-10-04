# Single D8 source, actor and limits inventory — #1647

Canonical owner map for SPEC-010 F7-09, ADR-002 and native #1640 D8. This is the ONE planned inventory; historical `tests/native/fixture-isolation/` paths in ADR-002 are aliases for `tests/native-fixture/` below, not a second implementation. Existing #1640 checkout remains untouched and its source owner retains custody. This source map does not repair D1-D7 or authorize native implementation of their rejected architecture.

Status: complete canonical contract independently reviewed and landed through #1651 at develop d65aa4c7. Every new native/source component below was **ABSENT / UNIMPLEMENTED** at historical base ae912db700a7f879efb8665203d115ee3c59fc93; this table retains the original complete ownership plan. Current U1 actual partial source progress is recorded below and is not complete U1. Existing adaptation targets are present source requiring future owned changes; no present target establishes capability. Actors are architectural roles, not invented accounts or people. Outputs/compiler/SDK/TLS/zlib/crypto/Node-API libraries and actual loaded inputs remain ABSENT/unadmitted, never inferred from source.

## Current owned U1 source progress — incomplete

Complete implementation #1687 (parents #1562/#1326) is separate from bounded
canonical #1647 completed through #1651. SAME sole writer retains
`feature/1647-f7-u1-native-capture` / draft #1686 under conductor receiving
exception, no rename/reuse/owner change. This writer owns actual native
framing/state/budget, held spool/witness, Linux and Windows drain, canonical
index/segment encoder and exact index decoder, reserve-before-crypto journal,
crypto/signing, finite projection, partial native regression and provenance/
row-derivation source. Internal `protocol.c`, `observer.h`,
`canonical-index-reader.c`, `attempt-journal.c/.h` and
`protocol-native-regression.c` implement the existing U1 boundary; they grant
no new actor or public authority. Complete actual limitations/missing callers
are retained in [U1 source checkpoint](../../tests/native-fixture/U1-SOURCE-CHECKPOINT.md).
Current added source includes `async-spool.c/.h`, `observer-finalize.c`,
`read-capability.c`, `segment-record.c/.h`, `plaintext-manifest.c/.h`
and `transport-package.c/.h`:
independent preallocated persistence queues, emergency witness member, retained
native drain settlement, complete held-member readback and connected once-only
segment/manifest/index/signature packaging. These are source progress without execution.
Additional independent source now includes `manifest-reader.c/.h`, `recovery.c/.h`,
explicit final journal freeze, and `CMakeLists.txt`/platform build contracts.
Recovery validation proves integrity of original expected held objects only;
it does not issue or authenticate successor authority. Build/source decoder
success would not establish original ROOT or native witness trust.
Complete pre-READY ownership/control settlement, authenticated pre-O entry/creation,
complete manifests/records/errors/caller integration/SAME recovery and full
production-path regression coverage remain missing. Actual nine-row inputs,
actors/resources/keys/grants/spool/binaries/loaded inputs remain ABSENT. No
component-only source GO or U1 completion follows. Existing #1640/#1643 writers
and their checkouts remain untouched; U2/U3/U4/U5 statuses are unchanged.
The previously missing concrete U1 original ROOT receipt/held-endpoint caller
boundary is now specified as a SOURCE PROPOSAL in
[admission contract](../../tests/native-fixture/admission-contract.md), before
positive entry code. The original ROOT creator/call site and actual provisioned
catalog remain ABSENT; there is no self-issuing receipt/path/default capsule.
This proposal must be reconciled with the original producer/source owner before
positive constructor implementation and cannot confer source GO or activation.

## Source ownership map

| Planned path / existing target | Sole implementation unit | Actor and boundary | Current fact |
| --- | --- | --- | --- |
| tests/native-fixture/protocol.h; protocol.md; custody-schema.md | U1 shared native custody | Closed versions/enums/direction/state/correlation/sequence/ordinal/raw-name encoding; no caller pathname authority | ABSENT |
| tests/native-fixture/observer-linux.c; observer-windows.cpp; capture-spool.c/.h; witness.c/.h | U1 complete O capture | O precedes all S/addon/compiler/privacy/provision/guardian/Core actions; independent concurrent drain, original native EOF, held persistent raw/error/witness bytes | ABSENT |
| tests/native-fixture/transport-crypto.c/.h; canonical-index.c/.h; recovery-linux.c; recovery-windows.cpp | U1 complete O capture and durable successor | O encryption/signature once, ALL independent persisted readback; recovery custodian issues SAME read-only objects to separately admitted T successor | ABSENT |
| tests/native-fixture/public-projection.c/.h | U1 complete O capture | Source finite public status only; arbitrary text/private names/native IDs never emitted | ABSENT |
| tests/native-fixture/row-budget-catalog.md; budget-reservation.c/.h | U1 + U4 actual row derivation | Checked row/input/stream/cumulative durable/emergency/control/queue/time reservations; overflow retains prefix/unavailable | ABSENT; numeric activation budgets ABSENT |
| tests/native-fixture/git-reader.c/.h; git-protocol.c/.h; pack-reader.c/.h; delta-reader.c/.h; http-tls.c/.h | U2 complete G/P transport | G read-only exact upload-pack v0; native persistent protocol/pack/body custody, distinct read broker; no checkout/source/config execution | ABSENT |
| tests/native-fixture/bootstrap-sender.c/.h; seed-objects.c/.h; repository-controls.md | U2 complete G/P transport | P exact original seed/pack and receive-pack empty-repo push; separate creation/control grant, write token, signed full bootstrap admission/revocation | ABSENT; example seed originals external only; exact push pack ABSENT |
| tests/native-fixture/uploader.c/.h; receiver.c/.h; receipt.c/.h | U3 full T/C custody | T read-only SAME ciphertext capabilities plus exact API write instruction; C distinct off-host decryption, OWN persistent ALL-byte readback and receipt | ABSENT |
| tests/native-fixture/broker-protocol.c/.h; broker-roles.md | U2/U3 broker separation (one writer per successive unit) | Separate P administration/push, T write, G/C read, optional receipt-write endpoints; held authenticated native role, no ENV/argv/ambient tokens | ABSENT |
| tests/native-fixture/launcher-linux.c; supervisor-linux.c; launcher-windows.cpp; supervisor-windows.cpp; client-addon.c | U4 separate native adapter architecture | S privileged bounded launch/settle/held filesystem actor; W original owner; M finite mediator; K persistent-copy reader; R unrelated owned process | ABSENT; D1-D7 NO-GO prevents implementation of rejected combined lifecycle |
| tests/native-fixture/apparmor-profile; build-provenance.md; build-linux.md; build-windows.md; loaded-inputs.md | U1/U2/U3 own component provenance; U4 isolation profile | Selected exact source/tool/SDK/native dependencies and actual loaded-input admissibility; AppArmor same-W genuine inspection and cross-role exclusion | ABSENT; no compiler or profile activation here |
| tests/startup-hard-crash-matrix-rows.js; tests/fixture-isolation-launcher.js; tests/fixture-isolation-client.js | U4 full row/adapter integration | Shared seven formal plus two recovered inputs, genuine same-W Error identity; source-owned admitted native launcher/client only | ABSENT |
| tests/fixture-root-custody.js; tests/fixture-privacy-custody.js; tests/hard-crash-fixture-custody.js; tests/startup-hard-crash-matrix.test.js | U4 adaptation targets | Existing protected ordinary owner/helper/guardian/history/copy/partial/reset/ENV behavior remains; native-only authenticated held original W capsules, separate M diagnostics | PRESENT targets; new adapter ABSENT |
| tests/native-fixture/admission-contract.md; acceptance-catalog.md; tests/f7-private-custody.test.js; tests/f7-native-custody.test.js | U1/U2/U3 source regressions and final U5 admission/acceptance owner | Complete source/tool/raw/physical/ENV/actor/endpoint/witness inventory and original negative/positive direct native acceptance; no simulation as native PASS | ABSENT |

Units name coherent ownership packages, not currently assigned humans/host accounts. Conductor assigns a fresh sole author to each new issue/check-out and a DIFFERENT whole reviewer after freeze; sequential dependencies share schema/broker files only via landed source, never concurrent writers. Build provenance names above are documentation, not existing executable builds. Complete raw/physical absence readback is frozen in #1647 external evidence.

## Actor/resources register

| Actor/resource | Required authority | Actual identity / activation fact |
| --- | --- | --- |
| O | Independently admitted external native ROOT observer, held private persistent spool/channels; admitted signer | ABSENT principal/binary/loaded inputs/ENV/keys/admission |
| Recovery custodian | Separate admitted ROOT object/journal/native-identity verifier and exact successor read-capability issuer | ABSENT principal/source/admission |
| S/W/M/K/R | ADR-002 distinct privileged supervisor/original W owner/read-only M/K/ordinary R with held native lifetimes and no cross-role capabilities | ABSENT actual UID/SID/token/cgroup/Job/host proof; D1-D7 remain NO-GO |
| P provisioner | Separately authorized repository creation/controls, exact seed push, own scoped broker/native lifetime and revocation | ABSENT creation authority/resource/grant/token/pack/native admission |
| G | Exact native read-only smart-HTTP reader; independently admitted separate instances for P/T/C/parent/reviewer | ABSENT implementation/read grants/TLS trust/input reservations |
| T | Native uploader only exact authenticated read-only ciphertext objects and scoped Contents-write credential | ABSENT implementation/identity/grant/broker/native admission |
| C Receiver v1 | Independent off-host native persistent custodian; recipient decryption + receipt signer; distinct read token and optional receipt writer | ABSENT actual host/admin/endpoint/keys/access/persistence/admission |
| Proposed private repository | service-lasso/protected-failure-evidence; private controls/no Actions/hooks/template; auto_init=false; exact bootstrap plus registered evidence/receipt refs | ABSENT numeric repository ID/current resource/applied controls; existing unrelated repositories not adopted |
| Parent/different verifier | Approved private access to ALL original O records/admission, C persistence and provider ciphertext; own G native instance | ABSENT execution/private access admission; architecture reviewer is not receiver authority |
| Retention | No automatic expiration/ref overwrite/history rewrite/key destruction/spool cleanup; owners mutable; separate explicit retention disposition and continued accessible copy | Selected policy; actual host/disk/key-access capacity ABSENT |

## Limit scopes and admission

Transport plaintext segment <=8MiB, control/error frame <=64KiB, <=4096 encrypted transport objects INCLUDING distinguished encrypted manifest. Index/signature are two additional outer blobs; tree/commit two objects: <=4100 distinct reachable objects (equal blobs may deduplicate). Seed exactly3 reachable objects. F7 uses <=53-bit exact integer canonical JSON fields and checked u64 length framing; reject overflow before allocation. Native names are raw Linux bytes/Windows UTF-16 units encoded as bytes; opaque object keys never normalize into pathname authority.

Each G invocation binds exact expected unique OIDs and checked sum S of ALL expected blob/tree/commit bodies. Channel1 pack ceiling=2*S+16MiB; total inflated instruction/result work ceiling=65*S+16MiB; depth<=64; each reconstructed result<=its admitted expected size; exact distinctOID object count; separate HTTP headers/control/progress capture<=16MiB. No thin/external bases, unreachable extra objects or legal-encoding fallback after quota rejection. Reserve private disk/memory/queue/terminal-record capacity and finite transfer deadline BEFORE activation; these maxima do not prove input sufficiency.

Actual nine-row input and byte budgets are ABSENT. U1 drafts complete calculation method and rejects missing reservations; U4 binds actual generated assets/helper catalogs/errors to each formal/recovered row before positive fixture work. Original generic native1640 limits (4096 entries/launches/frames, depth64, encoded component255, keys8192, raw256MiB/errors16MiB) are historical prospective ceilings, not validated row allowances. No silent inheritance into F7. Each admitted row needs independent raw stdout, stderr, private errors, control, inventory/manifest, ciphertext, receiver persistence, copies, G captures, emergency terminal records and cumulative multi-row accounting; native queue high-water/finite deadline belong to the same input. An unknown dynamic error suffix becomes explicitly unavailable, never silently complete. Product 5s/15s/120s/720s waits/retries remain exact; private transfer deadline neither extends them nor grants a rerun.

## Selected coherent source implementation sequence

1. **U1 next: complete external native O capture/once-encrypted persistent custody and authenticated recovery source package.** One fresh Core issue/sole source writer owns shared schemas/state tables, Linux and Windows native observer/spool/witness/crypto/signature/projection/recovery source, component tool/loaded-input provenance and row-budget derivation contract, with source-authored real-path/native failure regressions. O must be independently launchable before all downstream initialization and must persist/readback originals + SAME ciphertext/index/signature after death; delivery of an interface skeleton, Node/JS simulation, callback-only observer or unsupported capability declaration does not satisfy U1. All existing raw primary/secondary errors, original EOF and canonical signing/serialization/cycle/native name semantics are implemented together. This is a concrete source package selected from the full plan; no new blueprint loop is required for its already approved F7 boundary. Any actual boundary change still needs GOV14.
2. U2 owns the complete G/P original Git reader/seed/bootstrap/broker transport package and source regressions, including exact seed pack creation, standard protocol and quotas, private native persistence and signed bootstrap admission. No provision/provider experiment. It consumes landed U1 shared contracts; it does not fake absent O or C proof.
3. U3 owns native T/C full sender/independent receiver/receipt, separated brokers, SAME-object retry/death/successor/conflict/normalization source integration and negative regressions, using landed U1/U2. Real host/resources/keys remain absent until separately authorized activation.
4. U4 is a separately owned whole native adapter correction only after conductor selects a COMPLETE D1 revocation/reset architecture and complete D2-D7 interfaces, reviews them and completes governed pre-code artifacts. It reconciles actual caller/helper/guardian/K/R and shared nine-row input budgets with this ONE inventory. No fresh-W empty Map, parking, serialized replacement state or altered protected reset proof. F7 U1-U3 source preparation can progress independently; positive fixture lifecycle cannot.
5. U5 freezes complete cumulative implementations, obtains DIFFERENT entire source review and NEW complete exact ROOT admission with actual resource/actor/key/broker/tool/loaded native/ALL literal ENV/row-reservation inputs. Compilation/import/test/native launch/provisioning is deferred until the applicable exact admission and explicit resource authority. Native direct acceptance proves original O capture, SAME bytes/recovery, ALL G originals, C OWN persistent readback and parent/different verification, then separately all unchanged positive fixture/native/programme gates.

U1 next source authorship starts only after this canonical whole contract is independently reviewed and landed. U1 does not require D1 to be relabeled GO, and grants no lifecycle launch/delete/reset capability. Conductor must explicitly own/delegate the real source package on a new current-develop issue branch. Subsequent authoring cannot claim whole pre-code completion from missing schemas/budgets or a fabricated skeleton. Source-authored tests remain UNEXECUTED until entire source GO and NEW exact ROOT. No product/native execution occurred in #1647.

## Required direct acceptance catalog (unexecuted)

All original F1-F7 and nine rows remain mandatory. F7 adds pre-O admission failure rejection; initialization/privacy/provision/guardian/serialization primary+secondary/cyclic failures; genuine child exit-before-drain/EOF missing/writer leak; queue/disk/collector death; role/replay/sequence/capability failure; ONCE ciphertext/index/signature persistence, O/T death and SAME authenticated successor; randomized re-encryption conflict; exact branchless seed push, unknown outcome reconciliation, extra refs/workflows, bootstrap drift/deletion, role grants/redirect/ID mismatches; original protocol/pack truncation/trailer/delta source/result/opcode/external-base/cycle/quota failures; wrong tree ordering/binary OID/commit LF/date/extra-header/REST-only readback rejection; C wrong-key/decrypt/disk/access/ALL persisted readback including after O/S death; omitted/forged native witness and receipt replay. Private failures remain retained; a receipt means failed_attempt_preserved and never runtime PASS, D1 approval, cleanup or release. G native own persisted capture and C own plaintext persistence are separate requirements.

The retained-object integrity validator now has Linux and Windows native worker
source with explicit stack reservations and nonblocking result polling. Actual
thread exit must precede release; failed wait/join/handle-close leaves the job
and all original input capabilities/buffers retained. These jobs do not create
ROOT authority, authenticated successors, or universal I/O settlement bounds.
Linux private witnesses preserve actual fstat/fcntl/poll failures and poll retry
statuses. POLLNVAL is recorded as its actual two-byte poll flag, without an
invented read failure or errno. All new paths remain UNEXECUTED.

Transport ciphertext and domain-separated signature construction now consume
explicit source-owned workspaces; hidden malloc/free is removed from these
paths. Missing capacity and overlapping plaintext/key/signature buffers fail
closed, and recovery supplies its own retained signature workspace. Source
regressions cover closed domains, insufficient capacity and overlap rejection;
they remain UNEXECUTED. These memory inputs still need full actual native row
reservation/provenance and authenticated ROOT owning-entry integration.

Private witness reader source now checks the complete closed fixed record,
original invocation/attempt/lifetime/pipe bindings, exact merged sequence and
per-stream ordinal, reserved bytes, event-inline rules, exact length and SHA256
against inline facts or an independently read original raw slice. Rejection
preserves reader position; replay/gaps and altered raw bytes cannot advance it.
This structural/byte validator does not prove an OS call or admit custody.
Source regressions are present and UNEXECUTED; production original-witness
semantics, authenticated expectations and complete native fixture coverage
remain incomplete and cannot be replaced by these structural vectors.

Linux original private-channel source now performs nonblocking native recvmsg
on a held AF_UNIX SOCK_SEQPACKET socket with already enabled SO_PASSCRED. It
retains actual query/receive facts, original body/control bytes, kernel peer
credentials and per-message credentials; truncation, absent/duplicate/mismatched
credentials and unexpected ancillary data fail closed. Unknown received handles
remain private retained custody, never adopted or silently cleaned up here.
Aligned nonoverlapping bounded buffers must be reserved before original producer
initialization. This module issues no roles and cannot establish child birth or
lifetime from a PID; original admitted ROOT peer binding/callsite is still absent.
The existing FIFO observer path has not been relabeled as credential-authenticated;
its owning integration and full original native regression source remain pending.

Linux original child wait facts now retain the entire native siginfo byte record
immediately after waitid, including pending, unusual-kind and failure cases.
Earlier returned pid/status/kind are preserved before disposition checks rather
than discarded. Private child witnesses carry a closed 72-byte header plus the
exact native record; native record length is explicit and bounded by 256 bytes.
The witness reader enforces the complete child length, and both persistence
queues require the full 528-byte worst-case framed/queued record reservation.
Native ABI/header provenance and actual row reservations remain unadmitted;
these original facts never prove pipe EOF or authenticated child/ROOT admission.

Private child fact decoding now enforces the exact header/native-byte length,
closed disposition, original observed/not-observed consistency and native-call
bitmap. An input rejection cannot fabricate a native call/error/exit record.
Child exit/pending witness events must match their decoded private facts and
native status before the witness reader advances. Original raw ABI bytes are
retained unchanged; this decoder cannot authenticate a process or infer EOF.
Adversarial source regression cases cover truncated native records, inconsistent
observation, invented native calls and byte preservation, all UNEXECUTED.

Linux deadline clock failure now retains the actual clock_gettime result,
original timespec bytes and immediately captured errno in a private inline
witness before the drain marks the attempt incomplete. Invalid/overflowed time
values retain their original bytes with status zero, without a fabricated errno.
No clock failure is turned into EOF, termination, cleanup or a universal bound.

#1687 U1 original-error producer continuation: implement native Node-API source
that reads original-W Error/cause/AggregateError objects in their actual isolate,
checks injected identity before field access, retains original primary/secondary
handles and produces the private native graph/channel bytes using explicit
prepared workspace and queue inputs. Original ROOT creator/callsite, actual W
adapter and all Node headers/import libraries/runtime source admission remain
ABSENT. A separate native producer/regression source does not authorize U4
lifecycle or create a positive capsule. Exact proposed ingress/owner/endpoint/
queue/readiness/recovery boundaries belong in producer-contract.md for distinct
architecture review; all product/native execution remains prohibited.

Native original-W error producer source now uses actual Node-API handles and
pre-reserved arenas to retain primary/injected identity before field access,
exact UTF16 field state/code units, cause/custom-object cycles, original own
properties, ordered/repeated AggregateError entries and ordered secondaries.
Native number/BigInt encodings preserve exact scalar values; +0/-0 are not
collapsed. Cached original field/element observations avoid a second getter
read. Serialization exceptions are retained as actual objects and restored
pending, preserving the actual primary. Native C++ regressions operate on real
Node-API Errors/AggregateError/objects/getter exceptions; they remain UNEXECUTED
and require the original fixture/entry owner. No Node host/addon import occurred.
Original ROOT issuer and W adapter, native producer-channel owning integration,
full row/resource/provenance and native transport regressions remain incomplete.
Node headers/import libraries/runtime are ABSENT/UNADMITTED; CMake requires an
exact separate header input before any compiler invocation. Private schema
changes are described in original-error-schema.md, with no new public fields.

Native original-error transport now has explicit caller-owned normal/emergency
rings, write/history/state buffers and stack/guard reservations. A single actual
Linux/Windows native writer merges immutable frames by original global sequence;
VM/control submission never blocks on transport. Known delivered prefixes and
all failed queued/in-flight originals remain retained. Original sender native
query/write/peer/object facts have bounded append-only private history; missing
history capacity stops before another write. Construction errors retain their
ordered original native statuses and partially initialized objects. Windows
compares the held original kernel-object reference without additional object
access rights; exact Kernelbase/SDK inputs remain UNADMITTED. Linux verifies
original socket identity/connected credentials and held peer liveness against
independently admitted ROOT expectations. These observations do not issue roles.
The actual Node-API encoder now feeds the native queue, with a closed emergency
serialization-failure record preserving primary and pending exception status.
O error-channel source continues validating later original frames after a known
serialization fallback while retaining attempt incompleteness. Malformed data
still rejects. Original ROOT actor/source/peer/entry proof, W adapter integration,
full resource/row/provenance and entire native regression source remain pending.

Unexecuted producer native regression source now accepts only the original fixture owner's already-prepared queue, original serialized graph, independent original bindings, and bytes actually read from its held native endpoint. It compares the complete received frame and original payload, checks rejected types cannot change accepted submission counts, and checks exact retained queued/in-flight bytes after an actual native failure. No surrogate receiver, fixture creation, actor grant, runtime acceptance or whole-unit completion is supplied. Original full row/owner/callsite integration remains pending.

Persistence source now requires original caller-owned state/ring/write/drain buffers and explicit native writer stack/guard sizes for all four raw and ordinary/emergency witness writers. The owning capture preparation path supplies those exact memory descriptors; hidden malloc/calloc and default native writer stacks were removed from asynchronous persistence. Partial construction retains the original native state; actual-exit join failures retain native status and source-owned storage is never freed. These are explicit source requests, not proof of actual kernel/allocator charge, admitted row caps or authentic ROOT source ownership. Windows drain-owner allocation/default stacks and full cross-buffer geometry/source-budget accounting remain unfinished.

Windows drain preparation now consumes exact original caller-owned drain-owner storage and explicit stack reservations for each created original stream. Heap allocation/default drain stacks were removed; original create/resume/wait/close failures are retained in owner state before subsequent native operations. Actual-exit settlement leaves original storage and native facts owner-held. This remains SOURCE ONLY: original admitted memory catalogs and exact rounded kernel charges are absent, cross-owner buffer disjointness/full native error histories and running-before-READY ingress still require complete integration.

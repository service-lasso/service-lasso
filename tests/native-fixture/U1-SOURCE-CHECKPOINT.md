# U1 native F7 source checkpoint — incomplete

Development source preparation, #1647 / parent #1562 / SPEC-010 F7-01..F7-03,
F7-07..F7-09. Base develop d65aa4c7cfce1923e63e469e7912e942b9f745c7.
This checkpoint is actual partial native source, **not COMPLETE U1**, SOURCE GO,
an observer binary, a native result or any admission/activation/acceptance claim.

Implemented source bytes: closed binary error framing and sequence checks;
monotonic state transitions with retained failure; checked independent stream,
queue, witness, emergency and durable segment arithmetic; captured-prefix
accounting; held native file identity/write/flush/complete independent readback;
private native read/EOF/error witness framing; Linux poll/read concurrent drain
that distinguishes HUP from actual zero-byte native EOF; libsodium sealed-box
encryption and domain-separated Ed25519 index signing/readback operations;
finite public strings with no arbitrary payload parameter.

These components have no authorized entry path yet. Missing complete U1 work:

- Linux/Windows exclusive held spool creation and independently authenticated
  O admission before EVERY downstream initialization; Windows concurrent drain.
- Full owner/protection/ancestor/pipe/child birth/image/parent and writer-copy
  catalog proof, per-read native object identity and child exit/wait witnesses.
- Reserved asynchronous spool/witness writes independent of native drain. The
  present Linux loop performs synchronous writes and can stall at disk writes;
  its deadline does not prove a bound on a blocked write. No universal bound.
- Complete native canonical index/segment/manifest encoders/closed decoders;
  persisted once-only attempt journal, recovery custodian and authenticated
  SAME read-only successor handoff. Crypto `started` is process-local only and
  is insufficient for once-after-death custody; no recovery claim follows.
- Linux held same-object read-only open capability creation. Duplicating a
  write-open fd is deliberately refused; the source-owned creation layer must
  retain separate admitted read-only descriptors before named authority ends.
- Windows independent pointer/concurrency discipline, full exclusive DACL
  allowlist verification, Linux ACL/xattr and host-filesystem admission. Current
  mode/owner and protected-DACL observations are partial protection facts.
- Exact original errors, cyclic graph/cause/AggregateError ordering, injected
  original identity and raw PowerShell records; preinstalled independent error
  channel and all actual existing caller integration.
- Complete nine-row actual derivation/reservation binding, provenance/build
  contracts, native production-path positive/negative regression sources.

Current budget arithmetic is a partial calculation and does not reserve actual
disk/memory or justify actual row sufficiency. Existing native functions are
uncompiled/unexecuted. Actual actors/resources/keys/grants/spool/outputs/row
inputs/reservations remain ABSENT. No invented profile/actor/resource exists.

U2 G/P, U3 T/C, U4 D1 same-isolate reset, U5 execution, all original F1-F7 and
formal/recovered nine rows remain separate. D1 whole revocation/reset NO-GO,
all-W exit before original delete and protected same-W reset conflict remain.
No compiler, parser/import, Node, build/test, native launch, ACL/lifecycle,
resource activation, settings/key/grant/provider mutation, CI rerun, cleanup,
publication or release occurred. Only data/Git source operations were used.

Next action: sole source owner completes the missing production paths and
regressions in this checkout. Freeze complete cumulative U1, then obtain a
DIFFERENT entire source review and NEW complete exact ROOT before execution.
Retain this checkpoint and every prior original failure; never count this PR
as the complete package selected by the canonical inventory.

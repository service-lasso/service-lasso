# Stdio shutdown repair and remaining native decision (#1712)

## Delivered and directly exercised

The executable entrypoint observes stdin EOF before startup and invokes the
original awaited RuntimeApp stop once. Stop rejection retains failed process
status. The adapter still delegates process lifetime to its caller. The original
MCP regression and actual executable ordinary/early EOF tests pass: five tests,
zero failures on Windows with isolated host registries. The initial shared-host
registry size failure remains retained; no shared registry was reset.

The tested source `2a5c4b13ac95de8dff3851be22109cc7cc2ee4bd` has entrypoint blob
`579b1a918665efc7ae31d55860de00afbfb40550` and new regression blob
`83a8404964e577a6c983581a0b1d50d4948d1f1b`. Later source retirement restores
these exact product/test bytes; commit identity alone is not release qualification.

## Original failure and diagnostic movement

Windows fresh-consumer verification at `9cdf8d8b` and EOF-only `2a5c4b13`
passes MCP acceptance, then fails owned-temp cleanup: EBUSY/rmdir, eight actual
attempts. Both direct failures and the original natural jobs are retained.
Read-only private process snapshots identify invocation-associated managed
launcher processes and their actual fixture children after consumer exit.

An external diagnostic preload copies the consumer runner with private phase
snapshots; it does not change tracked source or count as package qualification.
The HTTP-stop snapshot contains no surviving launcher. A later stdio phase
leaves a launcher after consumer exit. The complete leaf/lock handle cause is
still unobserved; process existence alone is not a held-lock witness. The final
post-stdio diagnostic leaf was not captured before normal cleanup removed it.

The pinned SDK ends input, waits 2000ms, then uses its original process
termination behavior. Node documents unconditional target termination for its
Windows signal emulation. The proposed JavaScript SIGTERM interception was
therefore retired before execution; it is not a Windows cleanup fix. See
[Node signal semantics](https://nodejs.org/api/process.html#signal-events).

## Native ownership decision required before implementation

GOV-14-ARCH-004/005 requires review before changing a native trust/ownership
boundary. The following is a proposal, not selected architecture or SOURCE GO.
Reconcile it with #1576 ownership/finalization and the separately owned #1681
native acquisition/lifetime contribution. Do not copy or mutate their heads.

Proposed boundary: the managed launcher retains an authenticated native handle
to the actual owning Core invocation before target creation/resume. If that
owner exits abruptly, the existing owned Job must contain its own target and
descendants before approved file handles retire. Never derive owner authority
from an arbitrary PID, command text, a caller-supplied parent field, a stale
registry row or a substituted process. The whole bootstrap/managed/target chain,
native birth/image/source binding, original enrollment/finalization and native
asset provenance must be reviewed together before selecting the protocol.

Alternatives: parent-held Job containment requires a different authenticated
handle transfer/inheritance contract; changing the verifier to avoid autostart
would avoid the exercised lifetime rather than prove its closure; extending the
SDK wait would relax an existing boundary. None is selected by this report.

Selection must specify the actual owner-handle acquisition/custody, startup
owner-death races, native wait/status precedence, Job/target/stream completion,
all original error and file-release outcomes, public/private projections, and
immutable source/binary/provenance binding. No persistence migration or existing
registry rewrite is proposed. Rollback retains the original failed candidate
and scoped EOF behavior without retroactively qualifying either.

Required direct proof: active managed service survives normal operation; normal
EOF closes Core and all owned resources; unchanged SDK closure and abrupt owner
death contain exactly the same owned native tree; owner/PID replacement fails
closed; unrelated processes survive; incomplete native status retains original
custody; final Windows packaged cleanup succeeds with original eight attempts.
Fresh entire review and complete actual-input admission remain separate gates.

## Crash-custody gate remains separate

ADR-002/FI-1..FI-7 requires real Linux/Windows actor separation and continuous
writer exclusion before approved-object deletion. Current root custody refuses
removal unconditionally when exclusion is absent. #1640/#1641 implementation
is incomplete, and the approved off-host F7 custodian/destination/access remain
absent. The user has been asked for that missing authority. No local directory,
mock actor, generic kill or skip supplies it. Native fixture/release/GA gates
remain unqualified. Existing private evidence, original fixture survivors and
other-owner worktrees are retained.

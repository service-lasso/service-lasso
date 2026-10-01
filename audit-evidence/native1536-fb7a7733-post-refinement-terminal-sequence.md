# Post-refinement terminal finalizer sequence

Date: 2026-10-02
Branch: `fix/1535-same-held-command-query`
Committed HEAD baseline: `fb7a773341336221b5d69ade385435eda2caa12e`
Committed tree baseline: `d8a769b2afbcb1c8c2ec75681fa2988b853a753a`

## Changed causal boundary

The managed finalizer now waits for both the log and lifecycle finalizers to
settle before it publishes failure. This prevents a log-finalizer rejection
from allowing a waiter to observe failure before the lifecycle finalizer has
recorded the terminal Windows custody marker. A later explicit service stop
then performs its existing fresh bounded inspection and managed-child-exit
proof, completes the existing single lifecycle/on-exit action, and releases
only the matching retained in-memory managed record and finalizer entry.

No timeout, retry, native-query, identity, containment, admission, or
automatic-stop policy changed.

## Native pins and build

`npm run build` passed after the refinement. The source and built native
launcher SHA-256 values matched:

- `windows-managed-launcher-native.exe`:
  `2AA66997BDB44677350456B1D598EB30787389C6A9878000D7F55E9F9F1414FC`
- `windows-process-inspector.exe`:
  `B76F7EC901E614BEE5EB0D3163CE8996F76D0D3B69200BCBA7CFE3F2D28DF132`

`npm run typecheck` passed.

## Direct and public terminal proof

Each invocation used a new owned temporary root and three distinct paths:
the fixture workspace, instance registry, and host-port registry. The prior
attempt chains remained untouched.

1. `Windows managed terminal monitor keeps root-exit finalization in the same native inspection episode`
   passed in 6.297 seconds with `node --test --test-force-exit --test-concurrency=1`.
   Its assertions retain the terminal automatic episode without a new native
   query, then require the explicit fresh episode to leave no managed record
   and a durable ownership record with `lifecycleState: stopped` and `pid: null`.
2. `Windows public HTTP stop consumes a terminal root-exit finalizer only after its fresh inspection episode`
   passed in 7.445 seconds with the same runner settings. The public stop
   returns `200` with `running: false`; the test then verifies no managed
   record and durable stopped ownership before API shutdown.

Both runs exited `0`. These are direct deterministic Windows proofs of the
same-handle terminal custody and true managed-child exit sequence. They do
not replace the still-pending clean owned complete suite or exact-head CI.

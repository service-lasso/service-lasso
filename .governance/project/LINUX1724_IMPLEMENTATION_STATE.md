# Linux #1724 source preparation

Owner: current repair chat; branch fix/1724-linux-native-fixture-removal, draft PR1725 into develop. ADR-003 selects the whole architecture after DIFFERENT ENTIRE GO at171473fd. Existing owner branches and all failed/private evidence remain untouched. Every commit is immediately pushed.

## Authored components

- src/runtime/execution/managed-child.ts and all supervisor consumers now use the narrow actual child surface rather than requiring every ChildProcess/spawn overload. Ordinary default remains genuine Node spawn; probe, error listener, exit-versus-stdio, streams, teardown and deadlines are unchanged. No cast pretending a native child is ChildProcess.
- The reviewed PR1721 extraction is imported as source only: all test/workflow file blobs match f0e5d924 exactly, with its subsequent documentation correction. Nine fresh crash/recovered row entrypoints keep original callback/action/assertion bodies and complete discovery. PR1721 remains open; no merge is inferred.
- tests/native-fixture/terminal-policy-linux.c/.h implement bounded exact classic-BPF construction and actual SECCOMP_FILTER_FLAG_TSYNC dispatch. Native architecture/x32 checks, finite held role catalogs, credential-only control syscall flags, event-loop bindings, restricted fcntl, private anonymous mappings, selected futex operations, own-TGID/TID signals and default denial are implemented. Original references/acquisition/restart history must already be independently excluded by the supervisor; policy build/install alone cannot establish them. Build ceilings are construction limits, not numeric positive fit evidence.

## Remaining coherent implementation

Genuine inception launcher/roles, complete syscall/clone/FD/effect ledger, actual owner-close/drain and return checkpoints, independent parked census and per-thread filter inspection, trusted credential-only source issuer/client, registered child/helper ingress, real held inventory/copy/remove/readback/fault operations, independent K/O custody and natural exit/EOF remain to be authored/integrated. Canonical U1-U3 sources/resources are not delivered by these components. The four positive custody cases still need single-case extraction with unchanged bodies.

No authored source has been imported, parsed, compiled, installed or tested. Complete cumulative final source/protected-test review and NEW complete actual-input ROOT admission precede every executable/native action. All eleven failures remain unresolved; last natural full Linux result is1954tests/1856pass/11fail/87skip. No release/merge/resource activation claim.

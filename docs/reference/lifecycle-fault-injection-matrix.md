# Lifecycle Fault-Injection Matrix

Issue: `service-lasso/service-lasso#881`  
Spec binding: `AC-4BN` in `.governance/specs/SPEC-002-core-standalone-runtime.md`

This matrix defines the deterministic fault-injection coverage required before the runtime lifecycle tranche can be closed. Fault hooks are test-only fixtures or harness controls. They must not be reachable from production runtime APIs, CLI commands, manifests, service environment, or packaged release builds.

## Invariants

| ID | Invariant |
| --- | --- |
| INV-1 | no unrelated or unverified process is terminated |
| INV-2 | no two committed endpoints overlap |
| INV-3 | one workspace has at most one authoritative active generation |
| INV-4 | durable state either describes reality or reports an explicit blocked/recovery state |
| INV-5 | rerunning the same command converges |
| INV-6 | temporary files, locks, reservations, and runtime resources do not remain indefinitely |
| INV-7 | final diagnosis is stable and machine-readable |

## Scenario Matrix

| ID | Scenario | Lifecycle phase | Platform expectation | Automation mapping | Required invariants | Status |
| --- | --- | --- | --- | --- | --- | --- |
| FI-001 | crash before every atomic state write | install/config/start/stop/restart | Linux CI direct; Windows and macOS contract coverage acceptable until native CI is available | planned `tests/lifecycle-fault-injection.test.js` atomic write interruption fixtures | INV-1, INV-3, INV-4, INV-5, INV-6, INV-7 | planned |
| FI-002 | crash after every atomic state write | install/config/start/stop/restart | Linux CI direct; Windows and macOS contract coverage acceptable until native CI is available | planned `tests/lifecycle-fault-injection.test.js` post-write interruption fixtures | INV-1, INV-3, INV-4, INV-5, INV-6, INV-7 | planned |
| FI-003 | crash after reservation, materialisation, spawn, ownership persistence, and readiness | startup transaction | Linux CI direct; Windows process identity coverage in Windows CI | planned transaction harness plus existing `tests/process-ownership.test.js` readiness ownership proof | INV-1, INV-2, INV-3, INV-4, INV-5, INV-6, INV-7 | partial |
| FI-004 | truncated registry or journal | startup/resume | Cross-platform contract test | existing `tests/process-ownership.test.js` corrupt registry recovery plus planned journal fixture | INV-1, INV-3, INV-4, INV-5, INV-7 | partial |
| FI-005 | corrupt registry or journal | startup/resume | Cross-platform contract test | existing `tests/process-ownership.test.js` corrupt registry recovery plus planned journal fixture | INV-1, INV-3, INV-4, INV-5, INV-7 | partial |
| FI-006 | unsupported-version registry or journal | startup/resume/migration | Cross-platform contract test | existing `tests/health-state.test.js` unsupported future lifecycle state plus planned registry/journal version fixture | INV-1, INV-3, INV-4, INV-5, INV-7 | partial |
| FI-007 | stale PID | resume/stop/restart | Cross-platform direct where process identity is inspectable | existing `tests/process-ownership.test.js` exited owner and not-running identity proof | INV-1, INV-3, INV-4, INV-5, INV-7 | partial |
| FI-008 | live PID owned by this workspace | startup/stop | Cross-platform direct | existing `tests/process-ownership.test.js` owned process identity and confirmed stop proof | INV-1, INV-3, INV-4, INV-5, INV-6, INV-7 | partial |
| FI-009 | reused PID or unverifiable PID | startup/rehydrate/stop | Linux CI direct for reused process; Windows adapter contract for identity evidence | existing `tests/process-ownership.test.js` reused PID and Windows evidence tests | INV-1, INV-3, INV-4, INV-5, INV-7 | partial |
| FI-010 | stale lifecycle or allocation lock | startup/resume | Cross-platform contract test | existing `tests/process-ownership.test.js` abandoned lifecycle lock recovery plus planned allocation-lock fixture | INV-1, INV-2, INV-3, INV-4, INV-5, INV-6, INV-7 | partial |
| FI-011 | concurrently contested lifecycle or allocation lock | startup/concurrent start | Linux CI direct; Windows contract coverage until process CI is available | planned concurrent workspace harness | INV-1, INV-2, INV-3, INV-4, INV-5, INV-6, INV-7 | planned |
| FI-012 | preferred-port collision | config/start | Cross-platform direct | `tests/endpoint-allocation.test.js` plans the API and services together, retains the free API preference, and materialises the renegotiated service selector | INV-2, INV-4, INV-5, INV-6, INV-7 | implemented |
| FI-013 | fixed conflict and bind race after reservation | config/start | Cross-platform direct | `tests/endpoint-allocation.test.js` proves fixed preflight failure before start and bounded post-reservation API `EADDRINUSE` replanning through an explicitly gated test hook | INV-2, INV-4, INV-5, INV-6, INV-7 | implemented |
| FI-014 | wildcard versus loopback overlap | config/start | Cross-platform direct | planned endpoint allocator overlap fixture | INV-2, INV-4, INV-5, INV-6, INV-7 | planned |
| FI-015 | two workspaces and two generations starting concurrently | startup/concurrent start | Linux CI direct; Windows contract coverage until process CI is available | existing `npm run verify:multi-instance-ports` plus planned generation concurrency fixture | INV-1, INV-2, INV-3, INV-4, INV-5, INV-6, INV-7 | partial |
| FI-016 | service with child and grandchild processes | stop/restart | Windows CI direct for job/process-tree identity; Linux CI direct for process group cleanup | planned process-tree fixture | INV-1, INV-3, INV-4, INV-5, INV-6, INV-7 | planned |
| FI-017 | failure midway through dependent rematerialisation or restart | endpoint renegotiation | Cross-platform contract test | planned dependency cutover rollback fixture | INV-1, INV-2, INV-3, INV-4, INV-5, INV-6, INV-7 | planned |
| FI-018 | stop/restart when runtime API is unavailable | CLI/offline recovery | Cross-platform direct | planned offline lifecycle command fixture | INV-1, INV-3, INV-4, INV-5, INV-6, INV-7 | planned |
| FI-019 | canonical checkout versus worktree wrong-lane verification | demo/release gate | Cross-platform contract test | planned canonical demo verifier wrong-lane fixture | INV-1, INV-2, INV-3, INV-4, INV-5, INV-7 | planned |

## Closure Rule

`#881` can close only when each row is either direct automated proof in normal CI, Windows CI, or a documented platform-unavailable contract test with explicit confidence limits. Planned and partial rows are allowed during early slices, but final closure requires every row to map to a stable automated gate with bounded timeout and cleanup evidence.

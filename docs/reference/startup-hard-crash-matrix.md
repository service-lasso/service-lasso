# Startup Hard-Crash Matrix

Issue: `service-lasso/service-lasso#877`
Spec binding: `AC-4BJ.1` through `AC-4BJ.9` in `.governance/specs/SPEC-002-core-standalone-runtime.md`

The matrix launches startup in a subprocess and terminates that process immediately from a test-only hook after the selected durable phase has been journaled. The hook is available only when `SERVICE_LASSO_ENABLE_TEST_HOOKS=1`; it is not reachable from production APIs, CLI arguments, manifests, service environment, or packaged release behavior.

## Durable Subphase Inventory

The seven formal phases are the externally stable recovery contract. Their implementation contains narrower durable subphases:

- preflight: initial journal persistence and generation creation;
- allocation: host reservation claim and journaled allocation compensation;
- configuration: endpoint/config materialization plus bounded materialization or artifact evidence;
- process spawn: runtime ownership recording and API bind;
- ownership persistence: service-start intent/ownership, baseline actions, scheduler intent/start, and runtime-instance registration;
- owned readiness: runtime/service identity and allocation agreement;
- generation commit: generation publication, private-sidecar commit cleanup, and terminal transaction settlement.

Materialization, artifact, setup-output, CLI-baseline, and committed-cleanup crash windows have focused tests. This matrix adds the missing true cross-process exit at every formal phase and validates the aggregate recovery boundary on both supported CI platforms.

## Phase Matrix

| Phase | Hard-exit point | Expected recovery | Direct assertions |
| --- | --- | --- | --- |
| `preflight_reconciliation` | initial journal is durable, before generation mutation | roll back the journal and start a fresh generation with recovery provenance | no old allocation or owner; unrelated process survives |
| `allocation_reserved` | allocation claim and compensation are durable | resume the same transaction, generation, and allocation | the preserved reservation and generation agree after recovery |
| `configuration_materialized` | endpoint/config materialization is journaled | resume the same transaction, generation, and allocation | materialization revision and allocation agree |
| `process_spawned` | API bind and close compensation are durable | resume the same transaction, generation, and allocation after the dead API owner is verified | no stale live runtime owner is trusted |
| `ownership_persisted` | runtime ownership compensation is durable | resume the same transaction, generation, and allocation | replacement runtime ownership is verified |
| `owned_readiness_proven` | runtime instance and fixture-service ownership are durable | resume the same transaction only when the service remains independently identity-verified; otherwise roll back the interrupted generation and start a recovery-linked generation | a verified surviving service PID is adopted; a service that exited with its runtime is reconciled without touching unrelated processes |
| `generation_committed` | generation commit is durable, before cleanup/terminal settlement | perform commit-only cleanup, never transaction rollback, then start a fresh runtime generation | committed service owner is safely rebound or preserved; old generation is superseded, not failed |

Every row also proves:

- one authoritative active generation and one current reserved allocation after recovery;
- workspace and host runtime-instance records agree with runtime process ownership;
- the unrelated sentinel process remains alive;
- journal and subprocess output omit the injected secret marker;
- startup journal temporary files and private materialization sidecar residue are absent;
- exact test-owned runtime/service/sentinel processes and temporary roots are removed.

## Hosted Gate

### Failure before the requested checkpoint

Under `AC-4BJ.9a` (#1397), an unexpected fixture failure sends only its last
completed formal phase and the closed lifecycle-failure projection over test
IPC. The exit-code assertion includes that metadata, never collected raw stdout,
stderr, exception messages or stack traces. Missing IPC evidence remains `null`
and does not turn an exit mismatch into a pass. A last completed phase is a
boundary observation, not proof of which next operation failed.

The fixture still intentionally exits 86 at the requested checkpoint; unexpected
startup failure exits 1. Diagnostic delivery is bounded to 500 ms on the failure
path and does not extend any product startup or process-control deadline. A
test-only injected failure exercises the actual child IPC path and checks that
its private sentinel and owned filesystem path are absent from the diagnostic.

Run `node --test tests/startup-crash-diagnostics.test.js` after building the
runtime. A passing diagnostic test or later crash-matrix rerun does not explain
the original intermittent Windows failure; retain the original failed run.

`.github/workflows/startup-hard-crash-matrix.yml` runs one phase per job on `ubuntu-latest` and `windows-latest`. Each job has a bounded timeout and sets `SERVICE_LASSO_HARD_CRASH_PHASE` so failures identify one exact recovery boundary without rerunning unrelated runtime suites.

## Terminal fixture custody (#1326)

The crash runner saves its authoritative verified service members in a private
fixture-local sidecar before the intentional exit. The parent retains that union
and a test-gated append-only history acquired before recovered enrollment/adoption through
stop/finalization. These snapshots are private custody input, not absence proof.
Fresh bounded inspection must classify every retained member not-running before
successful removal. A missing/read-failed snapshot or registry, live member,
unknown owner, failed stop/finalization or directly spawned child close retains
fixture/journal evidence and all errors alongside the primary action failure.
Every failed action retains its fixture even if processes settle. Environment
restoration always runs; reset follows successful removal only. Closed output
contains recovery, stop, finalization, absence, actual original/copy state and reset/environment categories.
No fingerprints, paths, commands, child output or exception text enter that record.

The new same-adapter filesystem regressions support this contract; the protected
real subprocess matrix remains required. This source-only preparation has not
executed build, syntax validation, tests, native helpers or Core imports locally.
Fresh complete-input ROOT admission, entire independent source review and direct
Windows qualification for owned_readiness_proven and generation_committed remain
pending. The original two EBUSY jobs remain failed and unattributed.

2026-10-02 source-only completion of the four-finding preparation: the gated
ownership reader returns actual current/legacy/missing/corrupt classification.
The existing enrollment hook observes managed records before activation and
adopted records before refresh; its optional closed failure callback preserves
observation failures without changing runtime enrollment/compensation. Each
active fixture history appends identity-verified discoveries and never removes
an earlier lifetime when production snapshots/exclusions change. A legacy
reader activated after enrollment seeds the present snapshot and retains future
discovery; only observers armed before startup establish startup-lifetime custody.

Original removal follows an independently private, ownership/reparse-checked
complete copy with stable per-file identities, structure, sizes and SHA-256.
Preservation rejects source changes; post-restoration readback revalidates the
copy inventory, bytes and permissions. Original state is retained/partial/removed
or unresolved; copy state is none/retained/unresolved. Reset and environment
outcomes are reported separately. Successful evidence copies are also retained
privately outside the removal root. This is verified point-in-time custody,
not an immutable-to-owner seal. No private paths or process identities enter
closed diagnostics.

Prepared regressions cover the real missing/corrupt persistence reader, actual
partial file destruction followed by controlled removal failure (not an EBUSY
reproduction), reset/environment failure and copy tampering; native supervisor
managed/adopted discovery of a real later descendant, later tree omission and
record finalization; and actual recovered enrollment/adoption with startup
failure before return. All source/syntax/build/test/native execution remains
UNEXECUTED pending fresh entire candidate review and complete-input ROOT
admission. The protected formal matrix and original bounds/assertions remain
required, and original Windows failures remain failed/unattributed.

2026-10-02 final9a2 entire-review successor source preparation (#1326 / PR1596)

All five final9a2 findings are mapped to SPEC-002 AC-4BH.2/AC-4BJ.9c. Native inspection is provisional: fixture histories append only after caller root/held-child acceptance and retained lifetime validation, filtering cumulative exclusions while retaining previously accepted fingerprints. Supporting native lifecycle regressions prepare exclusion followed by unfiltered discovery, rejected fresh-control fingerprint, exited-root rejection and actual held-child exit before enrollment. Real later-descendant omission/finalization assertions remain.

Original private root ACL is established and verified before crash startup and original sidecar writes, and verified again on retained failure. The removal callback no longer supplies an arbitrary recursive rm. A fixture-only held-root helper binds original named/held root and ancestors to preservation and removal. Windows opens owned/no-reparse native directory handles without delete sharing, retains them through independent copy verification, and deletes through the held handles. POSIX traversal uses held directory file descriptors and rejects changed named root/ancestors. Complete structure/size/hash inventory and fresh original/copy verification remain. Actual replacement/redirection and native guardian reparse-failure regressions are source preparation, not executed proof.

The Windows guardian is new complete review/admission input: tests/fixture-root-custody.js contains the full PowerShell and inline C# source. Its PowerShell executable, Add-Type/compiler/bootstrap children and artifacts, kernel32/ntdll APIs, inherited environment, Core inspectProcess and native identity-helper dependencies, caller/parent/native-child fingerprints, binary stdout/stderr, EOF and positive natural close all require exact-head complete-input custody/admission and subsequent proof. Source prepares an exact ChildProcess handle, native parent witness, native child identity inspection, bounded settlement/forced-close failure and private raw closure receipts. No guardian, compiler, native ACL or lifecycle execution occurred here; no descendant/compiler custody or loaded-memory assurance is inferred from source or the top-level receipt.

Direct adoption children now have bounded close custody and exact-child fallback before enrollment failure as well as after enrollment. Cleanup errors aggregate, and hook/environment restoration is unconditional; failed roots/process evidence remain. Closed public stage maps identify action/startup/injection/observer/snapshot/control/absence/preservation/removal/copy/privacy/reset/environment/guardian/diagnostic failures. Full errors and guardian binary streams are retained in independently private diagnostic evidence outside the removal root. Recovered regressions preserve original pre-injection errors and expose only their closed stage map.

All seven formal phase rows on Windows/Linux and original recovery, generation, allocation, identity, absence, privacy, residue and unrelated-process assertions remain required. Bounds, retries, concurrency, signaling and production permissions are unchanged. Original EBUSY jobs and historical91e/current9a2 failures remain failed/unattributed; all seven current9a2 Windows rows failed and the new proof windows were not established. Controlled partial deletion is supporting filesystem coverage, not EBUSY reproduction. This source-only candidate requires a fresh entire independent source review and NEW complete-input exact-head ROOT admission before execution. It is not SOURCE GO, runtime acceptance, qualification, merge, release or programme completion.

## Complete6ae seven-finding successor

This current source disposition supersedes the historical deletion claims above:
without validated namespace/content writer exclusion, POSIX and Windows removal
reject before any destructive operation. Original and verified independent copy
remain; reset is not attempted. Required positive removal/reset/full-matrix gates
are **UNMET**. No existing positive assertion or formal/recovered row is waived.

The fixture-only actual registry reader rejects every malformed/dropped current
row and stale-backup substitution, including a mixed valid/invalid registry.
Record-local history filters conflicting lifetimes per member, preserving earlier
A and newly accepted B across subsequent omission and finalization. Production
signaling and deadlines are unchanged. The formal direct-child caller now uses
the shared fixed direct_child boundary; its exact TERM/KILL/close bounds remain.

Privacy protection changes only prior-owned, nonredirected physical objects:
POSIX held-directory fchmod; Windows handle owner/no-reparse proof before each
held-object DACL change and exact readback, without owner reset, SACL or privilege
enablement. The Windows native privacy source and controlled foreign-owner
laboratory fixture are new complete ROOT admission inputs, not live proof.

Public initialization reports six fixed safe substages. Accessible full private
failure capture independent of rejected diagnostic privacy remains blocked on
the concrete [private custody protocol and owner transfer decision](hard-crash-private-evidence-protocol.md).
Current run37007665958 has no artifacts; all seven Windows rows fail before
crash_spawn and no underlying private native cause is available or inferred.
No workflow upload/provider permission change is prepared or authorized here.

New regressions intervene after the final deletion check, substitute/add/edit
descendants, exercise actual malformed registry bytes, drive mixed-lifetime real
supervisor refresh/omission/finalization, reject redirected/foreign-owned public
privacy targets with outside permission readback, and classify actual formal
direct-child signal-delivery failure. They are unexecuted source preparation.
Existing positive removal assertions stay intact and will fail under retention;
unknown-owner native proof requires the explicitly admitted laboratory fixture,
never an absent-input pass or skip. Fresh entire source review and NEW complete
input exact-head ROOT admission precede all execution.

## 2026-10-08: ordinary disposable Linux fixtures (#1734)

SPEC-012 records the owner's correction: cleanup of a trusted, private test
fixture is ordinary test teardown. It is not Service Lasso recovery behavior and
does not require the separate hostile-writer security-custody implementation.
Creator-issued in-memory tokens bind fresh temp roots to their original directory
identities. The boundary verifies the independent evidence copy, inventory,
identity and privacy, settles held test handles, and removes only that root.
The default strong-custody boundary and adversarial refusal tests remain intact.

The seven original crash phases retain their recovery, generation, ownership,
absence, residue and unrelated-process assertions. The successful terminal
cleanup and post-removal reset, environment and copy-tamper cases retain their
original outcome assertions. Their eleven saved failures shared an unavailable
fixture-removal operation; they were not eleven demonstrated service bugs.

Native Ubuntu scoped verification: 74 tests, 70 passed, four platform skips,
zero failures, including all eleven formerly blocked rows and recovered
compensation. A root-owned disposable input also exercises the unchanged
foreign-owner rejection. Original failed evidence remains retained. Windows
custody execution still fails during existing privacy/guardian setup and is not
qualified by this Linux result. Full-suite verification is tracked separately.

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

`.github/workflows/startup-hard-crash-matrix.yml` runs one phase per job on `ubuntu-latest` and `windows-latest`. Each job has a bounded timeout and sets `SERVICE_LASSO_HARD_CRASH_PHASE` so failures identify one exact recovery boundary without rerunning unrelated runtime suites.

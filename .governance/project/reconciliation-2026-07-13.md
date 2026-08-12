# Main/Develop Reconciliation Inventory — 2026-07-13

Issue: `#850`

Spec: `SPEC-003`, `BR-001` through `BR-007`

Recovery branch: `fix/ISS-850-main-develop-reconciliation`, created from `develop` at `33ee966`

## Divergence

- Merge base: `39a3044e286c79be5e86ddf663066ec3a743abb0`.
- `main` contained 33 commits absent from `develop`.
- `develop` contained 448 commits absent from `main`.
- A direct `main -> develop` pull request was non-mergeable and was not used as the implementation branch.
- Recovery imports the divergent history only into the issue-scoped branch, resolves it against current `develop`, and targets `develop` through review.

## Commit Classification

Valid product behavior reconciled:

| Commit | Classification |
| --- | --- |
| `24d24c6` | Node sample runtime/log validation |
| `a3e20cd`, `53fc9c6`, `7b3e7fd`, `46b63d6`, `d171ef5`, `7efeea3` | Canonical demo status, lifecycle, recovery, gate, and default-service behavior |
| `b3fd905`, `c1f7dec` | Service config document API and portable revision history |
| `c04f527` | Runtime stdout/stderr log reader surfaces; reconciled with the newer develop log-source implementation |
| `bed00cd`, `d4e3eb2`, `016599f`, `69afe09`, `83da949` | Service Admin API/state proof, idempotent and isolated demo smoke, and LAN binding |
| `1f42d2e` | Scheduled service-action manifest validation |
| `8a60d8c` | Managed scheduled-workflow registry |
| `183ee6b`, `8963dc4` | Service action run API and scheduled-run metadata validation (`#784`) |
| `b546877` | Generic action payload policy, runtime injection, and safe history (`#799`) |
| `1fb5748` | Broker generated-secret startup plan (`#706`) |
| `03ec650`, `9a4bbc3` | Service Admin canonical release/API refresh; final reconciled pin is `2026.7.9-97b4660` |
| `6f354cd` | Durable operator audit events |

History-only or duplicate commits retained for ancestry but not treated as independent product changes:

| Commit | Classification |
| --- | --- |
| `92235c2` | Earlier reviewed `develop -> main` promotion merge; no separate recovery delta |
| `9beac65`, `e16ecd0`, `825800f`, `408cb55`, `350115a`, `92eeb79` | Pull-request merge commits for product commits listed above |
| `0015d9a` | Incorrect `main` merge into a working branch; retained as evidence, never used as a development baseline |
| `1362ce4` | Merge/closure commit duplicating the `1fb5748` Broker implementation |

## File Classification

The 39 files changed on the divergent line were handled as follows:

- Documentation/contracts preserved and aligned with implementation: `README.md`, `docs/reference/service-action-inputs.md`, `docs/reference/service-json-reference.md`, `schemas/service-action-inputs.schema.json`, `src/contracts/api.ts`, `src/contracts/service.ts`.
- Demo and mandatory Service Admin behavior reconciled: `package.json`, `scripts/demo-gate.mjs`, `scripts/demo-instance-lib.mjs`, `scripts/demo-recycle.mjs`, `scripts/demo-start.mjs`, `scripts/demo-status.mjs`, `scripts/demo-verify-canonical.mjs`, `scripts/demo-watchdog.mjs`, `services/@serviceadmin/service.json`.
- Core implementation reconciled: `services/node-sample-service/runtime/server.mjs`, `src/runtime/actions/runs.ts`, `src/runtime/app.ts`, `src/runtime/audit/store.ts`, `src/runtime/broker/launch-resolution.ts`, `src/runtime/discovery/validateManifest.ts`, `src/runtime/execution/supervisor.ts`, `src/runtime/lifecycle/actions.ts`, `src/runtime/operator/logs.ts`, `src/runtime/operator/variables.ts`, `src/runtime/workflows/registry.ts`, `src/server/index.ts`, `src/server/routes/workflows.ts`.
- `src/server/routes/service-config.ts` was superseded by the richer `develop` service-config editor. Its portable per-service history and legacy fallback behavior were ported into `src/runtime/operator/service-config-editor.ts`; the duplicate route file was removed.
- Verification reconciled: `tests/api-spine.test.js`, `tests/audit.test.js`, `tests/broker-consumption-fixtures.test.js`, `tests/demo-instance.test.js`, `tests/node-sample-service-runtime.test.js`, `tests/operator-data.test.js`, `tests/scheduled-actions-discovery.test.js`, `tests/service-action-runs.test.js`, `tests/test-helpers.js`, `tests/workflow-registry.test.js`.

## Conflict Decisions

- Current `develop` architecture wins by default; main-only behavior is then ported explicitly.
- Action payload docs/schema use the implemented `actions.<id>.payload` contract, not the older unimplemented design reference.
- Config history is stored under the service root so it survives copying, while legacy workspace revisions remain readable.
- Log routes preserve the newer develop source/cursor/search model and accept the Service Admin compatibility lookup from `reader-service` to canonical `@reader-service`.
- Broker generated-secret planning exposes policy metadata and source references only; raw source values are never included.
- Canonical demo bootstrap includes Broker and Service Admin. Bounded smoke skips the broad bootstrap because it explicitly exercises its own service lifecycle set.

## Tracking Disposition

- `#784` and `#799`: `in_review` until this recovery is merged into `develop` and CI passes; code existing on `main` was not completion.
- `#737`: `blocked` on `#850`; its separate branch must be updated from recovered `develop` and revalidated before completion.
- `#706`, `#843`, `#848`, and audit work from `#849`: recovered here, but their branch-policy defect is not considered resolved until the recovery lands on `develop`.
- No issue is moved to done merely because its implementation existed on `main`.

## Verification Evidence

- `npm run build` passed.
- `npm test` passed: 445 tests, 0 failures, 0 skipped.
- Canonical bounded demo smoke passed with Broker, Service Admin, Core providers, Echo Service, and the Node sample present.
- Package staging, temporary package consumption, release artifact verification, and release-version override tests passed with an isolated npm cache.
- Telemetry regression proved that metadata previews no longer execute arbitrary manifest health URLs; all 17 telemetry tests passed after switching to persisted/passive health evidence.
- JavaScript syntax checks passed for all `scripts/*.mjs` files and the Node sample runtime.
- `git diff --check` passed.

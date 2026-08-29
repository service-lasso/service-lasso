# Secrets capability and release-readiness ledger

The canonical record is
[`secrets-capability-ledger.json`](./secrets-capability-ledger.json). It tracks
Secrets capability across Service Lasso Core, Secrets Broker, and Service
Admin without treating a route, UI model, closed issue, or source test as live
product proof.

The JSON file is authoritative when this explanation and the structured data
differ. It was initially observed at `2026-08-25T04:14:10Z`; every evidence
record carries its own observation timestamp and direct URL.

## How to read maturity

| Maturity | Meaning |
| --- | --- |
| `planned` | A governed target or product decision exists, but no usable implementation is proven. |
| `read-only` | A live read path exists, while mutation or the complete end-to-end operation is not proven. |
| `dry-run` | Validation or planning exists without committing the durable operation. |
| `executable` | An operation has an implementation path, but required real-process evidence is incomplete. |
| `validated` | Row-specific real-process evidence proves the required cross-repository path and platforms. |

Cross-repository capability uses the least-proven required segment. For
example, passing Core tests cannot make an Admin-to-Core-to-Broker operation
`validated` when one required platform gate fails.

## Release-wave snapshot

| Wave | Ledger truth at the observation | Key residual |
| --- | --- | --- |
| Release 1 — local-store product | Mixed `planned`, `read-only`, `dry-run`, and `executable`; no row is promoted merely because foundation work closed. | Generated credentials are blocked in Core issue [#806](https://github.com/service-lasso/service-lasso/issues/806); linked rotation owner action is in Core [PR #1132](https://github.com/service-lasso/service-lasso/pull/1132); Admin apply issue [#459](https://github.com/service-lasso/lasso-serviceadmin/issues/459) remains open. |
| Release 2 — provider lifecycle | Provider management is executable and external read is read-only, not product-validated. | Admin [PR #569](https://github.com/service-lasso/lasso-serviceadmin/pull/569) fails the Windows real-browser gate after rotation when provider status returns HTTP 503. |
| Release 3 — mutation and campaigns | Executable paths exist, but provider-specific partial failure, retry, restart, and recovery proof is incomplete. | Broker issue [#162](https://github.com/service-lasso/lasso-secretsbroker/issues/162) remains in review. |
| Release 4 — automation | CLI and Sync are partial; Core MCP is release-gated for permission-scoped reads and guarded service lifecycle actions, while Broker MCP and scheduled rotation remain planned. | Preserve operation-specific identity, approval, idempotency, Audit, retry, and installed-artifact evidence; do not extend the Core proof to the separate Broker MCP scope. |
| Enterprise | Provider tracks are executable but unvalidated; MFA, HSM, and FIPS remain planned. | No compliance or hardware-support claim is permitted without an accepted scope and exact evidence boundary. |

The current Core baseline used for source evidence is
`ba709db2f00df5d48cdf92b4ebcd46fbdcd6eced`. The active owner-action change is
`7fc2313f8d7b8086728088ee7edac0a627eb99d1`. The active Admin qualification is
`2da98da1934a1167b509217982d8a58cba154102`; its Windows check is the direct
failure evidence linked in the JSON ledger.

## Update rules

1. Keep every programme family from Core issue
   [#871](https://github.com/service-lasso/service-lasso/issues/871) and every
   product request or decision from Admin issue
   [#97](https://github.com/service-lasso/lasso-serviceadmin/issues/97) present.
2. Update the owning repository and issue, endpoint/schema, backend, security
   and audit boundary, Admin surface, automated validation, release wave,
   blocker, next action, and exact evidence together.
3. Use an immutable commit or check URL when it proves source or execution.
   Record the observation timestamp rather than presenting a historical result
   as current.
4. Use `validated` only for row-specific real-process proof covering every
   repository and platform required by that row.
5. Keep unsupported, deferred, or deliberately excluded capability as an
   explicit `planned` row with its reason; do not delete it from the ledger.
6. Run `npm run docs:check-secrets-ledger` before review. This check proves
   structure and programme coverage, not product maturity.

## What this ledger does not claim

Baseline release pins mean those services are included in the runnable product
set. They do not mean that every listed Secrets operation, provider, Admin
surface, platform, recovery path, or enterprise control has been validated.
The separate [Secrets Broker live-readiness record](./secrets-broker-live-readiness.md)
defines release-candidate gates; the structured ledger controls current
capability maturity.

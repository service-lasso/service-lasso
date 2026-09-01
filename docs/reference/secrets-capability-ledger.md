# Secrets capability and release-readiness ledger

The canonical record is
[`secrets-capability-ledger.json`](./secrets-capability-ledger.json). It tracks
Secrets capability across Service Lasso Core, Secrets Broker, and Service
Admin without treating a route, UI model, closed issue, or source test as live
product proof.

The JSON file is authoritative when this explanation and the structured data
differ. The Release 1 decision was refreshed at `2026-09-01T13:00:46Z`; every
evidence record carries its own observation timestamp and direct URL.

## How to read maturity

| Maturity | Meaning |
| --- | --- |
| `planned` | A governed target or product decision exists, but no usable implementation is proven. |
| `read-only` | A live read path exists, while mutation or the complete end-to-end operation is not proven. |
| `dry-run` | Validation or planning exists without committing the durable operation. |
| `executable` | An operation has an implementation path, but required real-process evidence is incomplete. |
| `validated` | Row-specific real-process evidence proves the required cross-repository path and platforms. |
| `excluded` | A recorded product decision makes the capability unavailable and forbids a Release 1 claim. |

Cross-repository capability uses the least-proven required segment. For
example, passing Core tests cannot make an Admin-to-Core-to-Broker operation
`validated` when one required platform gate fails.

## Release-wave snapshot

| Wave | Ledger truth at the observation | Key residual |
| --- | --- | --- |
| Release 1 — local-store product | Thirteen rows are `validated` against exact released artifacts; PGP bootstrap is the single `excluded` row and remains unavailable. | Internal product and supply-chain evidence is green. GA promotion remains blocked only on the named independent security review required by `SPEC-007` `AC-7H`. |
| Release 2 — provider lifecycle | Provider management is executable and external read is read-only, not product-validated. | Admin [PR #569](https://github.com/service-lasso/lasso-serviceadmin/pull/569) fails the Windows real-browser gate after rotation when provider status returns HTTP 503. |
| Release 3 — mutation and campaigns | Executable paths exist, but provider-specific partial failure, retry, restart, and recovery proof is incomplete. | Broker issue [#162](https://github.com/service-lasso/lasso-secretsbroker/issues/162) remains in review. |
| Release 4 — automation | CLI and Sync are partial; Core MCP is release-gated for permission-scoped reads and guarded service lifecycle actions, while Broker MCP and scheduled rotation remain planned. | Preserve operation-specific identity, approval, idempotency, Audit, retry, and installed-artifact evidence; do not extend the Core proof to the separate Broker MCP scope. |
| Enterprise | Provider tracks are executable but unvalidated; MFA, HSM, and FIPS remain planned. | No compliance or hardware-support claim is permitted without an accepted scope and exact evidence boundary. |

The exact Release 1 evidence set is Core release `2026.9.1-1f4ec40` at
`1f4ec40f13fe3867b24ca901c42fe31c69e01e8d`, Admin release
`2026.8.31-f015b44` at `f015b4445b0526546a309301270186a697588166`, and
Broker release `2026.8.31-f340883` at
`f340883056ec3cf74b535fb46490b39382e8c823`. Published-package qualification
[run 33509489660](https://github.com/service-lasso/service-lasso/actions/runs/33509489660)
passed Windows, Linux, macOS, and aggregate verification with exactly three
nonempty, unexpired metadata-only artifacts. The exact Admin release also has
its own green three-platform real-browser
[run 33437554122](https://github.com/service-lasso/lasso-serviceadmin/actions/runs/33437554122),
and the exact Broker release has green native source/binary vulnerability gates
in [run 33376912641](https://github.com/service-lasso/lasso-secretsbroker/actions/runs/33376912641).

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
5. Keep unsupported or deferred capability as an explicit `planned` row. Use
   `excluded` only for an unavailable Release 1 surface with a recorded product
   decision and explicit non-claim; never delete it from the ledger.
6. Run `npm run docs:check-secrets-ledger` before review. This check proves
   structure and programme coverage, not product maturity.

## What this ledger does not claim

Baseline release pins mean those services are included in the runnable product
set. They do not mean that every listed Secrets operation, provider, Admin
surface, platform, recovery path, or enterprise control has been validated.
The separate [Secrets Broker live-readiness record](./secrets-broker-live-readiness.md)
defines release-candidate gates; the structured ledger controls current
capability maturity.

The Release 1 ledger does not certify the independent security review. See the
[Release 1 security review packet](./release-1-security-review-packet.md) and
[GA decision](./release-1-ga-decision.md). Promotion remains blocked until a
named independent reviewer signs the exact packet revision and all findings are
dispositioned.

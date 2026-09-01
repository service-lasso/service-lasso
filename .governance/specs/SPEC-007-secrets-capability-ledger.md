# SPEC-007: Secrets Capability and Release-Readiness Ledger

## Intent

Create one evidence-bound source of truth for Secrets Broker capability across
Core, Secrets Broker, and Service Admin. The ledger prevents prototype UI,
allowlisted routes, source tests, and closed issues from being presented as
validated live product behavior.

## Scope

Included:

- every capability family and release wave named by Core issue `#871`;
- every Secrets/Admin request and product-decision item named by Service Admin
  issue `#97`;
- exact owning repository/issue, endpoint or schema, backend coverage, maturity,
  security/audit boundary, Admin surface, evidence, blocker, and next action;
- a structural CI check for required fields and valid maturity/release values;
- README and live-readiness links back to the canonical ledger.

Explicitly out of scope:

- changing runtime, Broker, or Admin product behavior;
- promoting a capability because its issue is closed or its source tests pass;
- resolving release pins, provider credentials, live-process failures, or
  downstream UI defects from inside this documentation slice;
- deleting deferred or deliberately excluded capability;
- claiming Vault/OpenBao enterprise parity, HSM custody, FIPS compliance, MFA,
  or protection from unknown future vulnerabilities.

## Requirements and Acceptance Criteria

### `AC-7A` — Canonical structured ledger

`docs/reference/secrets-capability-ledger.json` is the canonical structured
record. Every row has a stable id, family, capability/operation, owner and issue,
endpoint/schema, provider/backend coverage, maturity, security/permission/audit
requirements, Admin surface, evidence, release wave, blocker, and next action.

### `AC-7B` — Honest maturity

Maturity is exactly one of `planned`, `read-only`, `dry-run`, `executable`, or
`validated`. A route or UI model alone is not executable. `validated` requires
row-specific real-process evidence. Cross-repository rows use the maturity of
the least-proven required segment.

### `AC-7C` — Complete programme coverage

The ledger covers Releases 1-4 from `#871`, deferred enterprise capability, and
all items from Service Admin `#97`, including navigation/table decisions,
routes/topology, inventory actions, policy, bootstrap alternatives, events,
lockouts, filtering, MCP, Sync, automated rotation, telemetry, Audit, HSM, FIPS,
and MFA.

### `AC-7D` — Review automation

`npm run docs:check-secrets-ledger` fails on a missing required field, duplicate
id, unsupported maturity/release value, invalid evidence timestamp, missing
evidence URL, or an unrepresented programme capability id. The Docs Site pull
request workflow runs the check before building documentation.

### `AC-7E` — Current evidence and residual truth

The initial observation records exact issue/PR/check URLs and does not hide
active residuals. In particular, Core `#806` remains blocked by preserved local
recovery state; `#887` owner action remains in review; Admin `#459` remains
open; and Admin PR `#569` has a failing Windows real-browser gate after the
rotation flow, so that cross-repository path is not validated.

### `AC-7F` — Release 1.0 scope, repository authority, and explicit exclusions

Release 1.0 is the production-grade local encrypted-store product. Its required
rows cover secure age/recovery bootstrap and custody, generated credentials,
inventory/search/controlled reveal/rotate-without-reveal, versioned local
lifecycle, linked rotation/activation/rollback/retirement/restart persistence,
backup/integrity/restore/master-key rotation/recovery, durable redacted
audit/events/lockouts/filtering, service-secret-provider topology,
Routes/Traefik, and completed Admin navigation/page/table decisions.

PGP bootstrap is explicitly excluded and unavailable; the approved age and
recovery model remains the only Release 1 bootstrap claim. Fleet and Sessions
are hidden or retired for Release 1 and ZITADEL owns session behavior. Policy
Simulation is removed in favor of actual service-manifest secret-access
assignments. Any required capability without released-artifact GA evidence is
disabled, hidden, or labelled preview and cannot be marked `validated`.

External-provider mutation, bulk campaigns, full Secrets Sync apply, scheduled
rotation, Broker mutation MCP, HSM custody, FIPS compliance, and MFA are
excluded from Release 1 and remain explicit later-wave/non-claim rows.

The Core GitHub repository is the 1.0 authority boundary for working-release
publication. `CODEOWNERS` names the required reviewers for every path, including
workflow, governance, security, and owner files. `SECURITY.md` is the public
vulnerability reporting path. GitHub Actions workflows pin third-party actions
to commit SHAs. `npm audit --omit=dev` reports zero production vulnerabilities.
`develop` is protected with required status checks, required reviews, no
force-push, and administrator enforcement. Publishing is restricted to the
protected `release` GitHub Environment. Default Actions permissions are
read-only, and pull requests from forks cannot write repository contents or
secrets. Sibling Admin owns its matching repository authority separately.

### `AC-7G` — Zero-known-vulnerability and supply-chain release gate

Release 1.0 requires zero known unremediated vulnerabilities of any severity in
the exact shipped production graphs at release time. Core must pass
`npm audit --omit=dev`; Admin must pass `pnpm audit --prod`; Broker source and
packaged binaries must pass current `govulncheck`. Critical/high build findings
also block release. Alerts may be dismissed only when exact-version evidence
proves they are stale or inapplicable.

Every shipped platform archive requires a release-bound SBOM, verified digest,
checksum-before-extraction behavior, provenance/attestation, signed checksum or
provenance metadata, asset inventory readback, and independent repeatable build
instructions. Publication is explicitly dispatched through an approval-gated
release environment and never occurs from an ordinary integration push.

## Tests and Evidence

- `npm run docs:check-secrets-ledger`.
- `npm run docs:build`.
- `git diff --check`.
- `node --test --test-concurrency=1 tests/release-authority.test.js`.
- `npm run audit:production`.
- `node scripts/verify-core-release-authority.mjs` against the live GitHub API.
- Live issue, PR, Project, branch, and worktree evidence observed on
  `2026-08-25` and linked from the ledger.
- Repository security settings, open-alert counts, exact production audits,
  release environments, workflow pinning, and branch protection read back on
  `2026-08-31` under issue `#1164`.
- Core local candidate proof on `2026-09-01`: production audit found zero
  vulnerabilities; the critical/high tooling gate passed; the full tooling
  audit initially retained 18 moderate dev-only Docusaurus-chain findings; a
  narrow `sockjs` override to patched `uuid` 11.1.1 then cleared the complete
  audit while retaining its reviewed CommonJS surface. The 25-capability
  ledger, typecheck, and diff integrity passed. The latest serial aggregate
  passed every product row except one
  runner-invalid Windows `npm.cmd` crash (`0xC0000409`, no output), whose exact
  staged-package consumer row then passed 10/10 in fresh processes. Hosted
  exact-head and retained-artifact qualification remains blocking evidence.
- Rebased Core proof on `2026-09-01`: the 1,002-test serial aggregate reported
  996 pass, four expected platform skips, and two start actions returning 409
  under sustained host load; both exact rows passed together 2/2 in fresh
  processes. Rebase-interaction fixes passed 13/13 plus dependency diagnostics,
  the oversized-v1 generation migration/current-state rejection proof passed,
  production audit remained at zero, and hosted exact-head evidence remains the
  merge authority.

## Documentation Impact

- Add `docs/reference/secrets-capability-ledger.json`.
- Add `docs/reference/secrets-capability-ledger.md`.
- Link the ledger from root README, docs README, and the live-readiness record.

## Verification

Review the structured ledger and documentation links against the live issues
and pull requests. The check proves structure and programme coverage; it does
not upgrade maturity. Reviewers must reject a `validated` row unless its
evidence is a row-specific real-process result.

## Change Notes

- 2026-08-25: Issue `#872` was deliberately promoted from Backlog when the
  Secrets release-governance tranche was explicitly selected. No competing
  assignee, branch, worktree, or pull request existed at intake.
- 2026-08-31: Core `#1164` adds `AC-7F` for 1.0 repository and release
  authority: CODEOWNERS, SECURITY.md, SHA-pinned Actions, production audit,
  protected `develop`, and the protected `release` publication environment.
- 2026-08-27: Core `#1152` is the `SPEC-002` `AC-4BZ.1` published-package
  evidence gate for the working-release claim linked to `#1151` and `#871`.
  Its workflow and retained metadata cannot upgrade any ledger maturity row:
  that requires a dispatched exact-publication run with terminal Windows,
  Ubuntu, and macOS results plus artifact API readback and row-specific live
  product evidence.
- 2026-08-31: `AC-7F` and `AC-7G` freeze the Release 1 local-store scope,
  explicit exclusions/non-claims, zero-known-production-vulnerability rule,
  protected publication authority, and exact shipped-artifact supply-chain
  evidence required by release-security issue `#1164`.

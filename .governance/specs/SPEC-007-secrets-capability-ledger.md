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
- deleting deferred or deliberately excluded capability.

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

### `AC-7F` — Core 1.0 repository and release authority

The Core GitHub repository is the 1.0 authority boundary for working-release
publication. `CODEOWNERS` names the required reviewers for every path, including
`.github/` and `CODEOWNERS` itself. `SECURITY.md` is the public vulnerability
reporting path. GitHub Actions workflows pin third-party actions to commit SHAs.
`npm audit --omit=dev` reports zero production vulnerabilities. `develop` is
protected with required status checks, required reviews, no force-push, and
administrator enforcement. Publishing is restricted to the protected `release`
GitHub Environment. Default Actions permissions are read-only, and pull requests
from forks cannot write repository contents or secrets. Sibling Admin `#578`
owns the matching Admin-repo authority and is not closed by this Core slice.

## Tests and Evidence

- `npm run docs:check-secrets-ledger`.
- `npm run docs:build`.
- `git diff --check`.
- `node --test --test-concurrency=1 tests/release-authority.test.js`.
- `npm run audit:production`.
- `node scripts/verify-core-release-authority.mjs` against the live GitHub API.
- Live issue, PR, Project, branch, and worktree evidence observed on
  `2026-08-25` and linked from the ledger.

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

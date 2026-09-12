# Release 1 GA decision

Decision: **GA blocked — independent security approval outstanding**
Prepared: `2026-09-11`
Tracking issue: [#1151](https://github.com/service-lasso/service-lasso/issues/1151)
Prior packet issue: [#1208](https://github.com/service-lasso/service-lasso/issues/1208)

The 2026-09-08 independent AC-7H reject of Core/npm `2026.9.1-1f4ec40` /
`1f4ec40f13fe3867b24ca901c42fe31c69e01e8d` remains in force for that identity.
Packet PR [#1210](https://github.com/service-lasso/service-lasso/pull/1210) /
`c341552` stays the rejected packet. Historical published-package failures
`33500138538`, `33503750329`, and `33506286697` stay failures.

This decision is internal evidence assembly for the replacement set
`2026.9.11-462f837`. It is not AC-7H sign-off. PR `#1232` bound stale
`2026.9.8-b0c3a1b` and must not be reused as this packet.

> **Related:** [Delivery-owner evidence readback](./release-1-independent-security-review-report.md)
> remains historical for the rejected identity. This file is delivery-owner
> evidence collection, not AC-7H independent approval.

## Internal gate decision

The replacement Release 1 candidate has passed the internal product, packaging,
supply-chain, vulnerability, recovery, and evidence gates:

- immutable Core `2026.9.11-462f837` at
  `462f837b25224e98103296b4597807b5beea00c5` (GitHub release ID `387143354`),
  Admin `2026.8.31-f015b44`, and Broker `2026.8.31-f340883` publications;
- exact npm `@service-lasso/service-lasso@2026.9.11-462f837` at `latest`,
  `gitHead` matching Core SHA, integrity
  `sha512-whjIemqmLt/NQH03QZVMMjAtXWfx+aL1Ee3aRzeSiQgbZcvKhrpRDVqzqjj57H2A4FPXw9PzTC7PB6940OQjYg==`,
  shasum `a35afafe16e6e022329fe8cbbfa491e6efd0ed0f`;
- GitHub Release Artifact
  [34614413642](https://github.com/service-lasso/service-lasso/actions/runs/34614413642)
  success. npm workflow
  [34614418000](https://github.com/service-lasso/service-lasso/actions/runs/34614418000)
  attempt 1 remains **failure** at consumer verify (registry E404 window); the
  package later became independently visible and is not treated as converting
  that failed run into a pass;
- Windows, Linux, macOS, and aggregate published-package qualification green in
  [run 34625492347](https://github.com/service-lasso/service-lasso/actions/runs/34625492347)
  attempt 1, with exactly three nonempty, unexpired retained records
  (`10275075407`, `10274393550`, `10274044042`, expire `2026-12-10`),
  `mutationRetry: false`, `brokerRestart: 1`, `providerMigrationApply: 1`, and
  all eleven negative proofs `success`;
- hosted Release Qualification
  [34469524380](https://github.com/service-lasso/service-lasso/actions/runs/34469524380)
  green at the exact Core SHA;
- live `npm audit --omit=dev --audit-level=low` and `npm audit --audit-level=high`
  were zero on isolated `origin/develop` `462f837` before publication;
- thirteen Release 1 ledger rows `validated` and PGP bootstrap explicitly
  `excluded` and unavailable;
- active rulesets and the protected `release` environment remain the publication
  authority.

## Blocking gate

`SPEC-007` `AC-7H` requires a **new** named independent security reviewer to
review the [security packet](./release-1-security-review-packet.md), record
findings and residual risks against its exact commit and component identities,
and issue an explicit approval. The delivery owner has not self-certified that
external gate. The prior reject does not cover these bytes. Approval of
`2026.9.1-1f4ec40` or of packet `#1232` / `b0c3a1b` does not authorize this set.

Therefore:

- do not promote `develop` to `main`;
- do not publish or label a GA release;
- do not close the parent Release 1/working-release issue as complete;
- keep the canonical released-artifact demo available for reviewer use;
- after approval, re-read exact branch heads, security settings, open alerts,
  release/npm identities, retained artifacts, issue state, and Project state
  before promotion. The approval must name the exact head of the final-readback
  packet revision.

An external-review waiver may record risk acceptance but cannot turn a missing
technical artifact, failed check, open vulnerability, or mismatched identity
into a pass.

# Release 1 GA decision

Decision: **GA blocked — independent security approval outstanding**  
Prepared: `2026-09-08`
Tracking issue: [#1151](https://github.com/service-lasso/service-lasso/issues/1151)
Prior packet issue: [#1208](https://github.com/service-lasso/service-lasso/issues/1208)

The 2026-09-08 independent AC-7H reject of Core/npm `2026.9.1-1f4ec40` /
`1f4ec40f13fe3867b24ca901c42fe31c69e01e8d` remains in force for that identity.
This decision is internal evidence assembly for the replacement set. It is not
AC-7H sign-off.

## Internal gate decision

The replacement Release 1 candidate has passed the internal product, packaging,
supply-chain, vulnerability, recovery, and evidence gates:

- immutable Core `2026.9.8-b0c3a1b` at
  `b0c3a1bef977c26d956d3d827025fe8c39c17799`, Admin `2026.8.31-f015b44`, and
  Broker `2026.8.31-f340883` publications;
- exact npm `@service-lasso/service-lasso@2026.9.8-b0c3a1b` at `latest`,
  `gitHead` matching Core SHA, integrity
  `sha512-+Ji5n6DStatgqDAZrcGqiIEssbiEA5urnpHzyW019oT9RK07oZVR5/VfOqTrqr5Vnc+TZIiYZRUzSC0zAwbyLw==`;
- Windows, Linux, macOS, and aggregate published-package qualification green in
  [run 34256052728](https://github.com/service-lasso/service-lasso/actions/runs/34256052728)
  attempt 1, with exactly three nonempty, unexpired retained records,
  `mutationRetry: false`, and all negative proofs `success`;
- thirteen Release 1 ledger rows `validated` and PGP bootstrap explicitly
  `excluded` and unavailable;
- zero production `npm audit --omit=dev` findings on the exact Core graph;
  Admin `pnpm audit --prod` zero at the reused release SHA; Broker
  `govulncheck` zero reachable/imported at the reused release SHA;
- hosted Release Qualification
  [34250860854](https://github.com/service-lasso/service-lasso/actions/runs/34250860854)
  green at the exact Core SHA;
- active rulesets and the protected `release` environment remain the publication
  authority. Historical published-package failures `33500138538`, `33503750329`,
  and `33506286697` stay failures.

## Blocking gate

`SPEC-007` `AC-7H` requires a named independent security reviewer to review the
[security packet](./release-1-security-review-packet.md), record findings and
residual risks against its exact commit and component identities, and issue an
explicit approval. The delivery owner has not self-certified that external
gate. The prior reject does not cover these unpublished-at-reject bytes.

Therefore:

- do not promote `develop` to `main`;
- do not publish or label a GA release;
- do not close the parent Release 1/working-release issue as complete;
- keep the canonical released-artifact demo available for reviewer use;
- after approval, re-read exact branch heads, security settings, open alerts,
  release/npm identities, retained artifacts, issue state, and Project state
  before promotion. The approval must name the exact head of the final-readback
  packet revision; approval of an earlier packet or of `2026.9.1-1f4ec40` does
  not authorize this set.

An external-review waiver may record risk acceptance but cannot turn a missing
technical artifact, failed check, open vulnerability, or mismatched identity
into a pass.

# Release 1 GA decision

Decision: **GA blocked — independent security approval outstanding**  
Prepared: `2026-09-02`
Tracking issue: [#1208](https://github.com/service-lasso/service-lasso/issues/1208)

> **Related:** [Delivery-owner evidence readback](./release-1-independent-security-review-report.md) records technical verification performed 2026-09-03. This is delivery-owner evidence collection, not AC-7H sign-off. GA remains blocked.

## Internal gate decision

The exact Release 1 candidate has passed the internal product, packaging,
supply-chain, vulnerability, recovery, and evidence gates:

- immutable Core `2026.9.1-1f4ec40`, Admin `2026.8.31-f015b44`, and Broker
  `2026.8.31-f340883` publications;
- exact npm `@service-lasso/service-lasso@2026.9.1-1f4ec40` at `latest`;
- Windows, Linux, macOS, and aggregate published-package qualification green in
  [run 33509489660](https://github.com/service-lasso/service-lasso/actions/runs/33509489660),
  with exactly three nonempty, unexpired retained records;
- thirteen Release 1 ledger rows `validated` and PGP bootstrap explicitly
  `excluded` and unavailable;
- zero known reachable/imported production vulnerabilities in the exact shipped
  graphs, zero live repository alerts, exact archive SBOM/checksum/provenance
  coverage, CodeQL, native Broker binary scans, focused fuzzing, and no-leak
  browser/runtime evidence;
- a healthy canonical released-artifact Windows runtime using the exact Core,
  Admin, and Broker bytes with first-run bootstrap, one-time credential
  acknowledgement, local-root authentication, Broker health, and restart
  continuity. This direct demo is intentionally narrower than the three-OS
  destructive lifecycle matrix and does not replace it;
- active rulesets and branch protection on Core, Admin, and Broker require one
  approval, CODEOWNERS, last-push approval, strict terminal-green checks,
  conversation resolution, and linear history, with force-push/deletion
  disabled. Release-authority issues Core `#1164`, Admin `#578`, Admin dependency
  `#549`, Admin reconciliation `#550`, Broker checksum `#162`, Core launcher
  `#1205`, and published-package qualification `#1152` are closed with Project
  status `Done` after direct evidence readback.

## Blocking gate

`SPEC-007` `AC-7H` requires a named independent security reviewer to review the
[security packet](./release-1-security-review-packet.md), record findings and
residual risks against its exact commit and component identities, and issue an
explicit approval. The delivery owner has not self-certified that external
gate.

Therefore:

- do not promote `develop` to `main`;
- do not publish or label a GA release;
- do not close the parent Release 1/working-release issue as complete;
- keep the canonical released-artifact demo available for reviewer use;
- after approval, re-read exact branch heads, security settings, open alerts,
  release/npm identities, retained artifacts, issue state, and Project state
  before promotion. The approval must name the exact head of the final-readback
  packet revision; approval of an earlier packet does not authorize an
  unreviewed delta.

An external-review waiver may record risk acceptance but cannot turn a missing
technical artifact, failed check, open vulnerability, or mismatched identity
into a pass.

# Branch Protection Checklist

Apply this checklist to both long-lived branches. `develop` is the repository default and development integration branch; `main` is promotion/release only.

- [ ] Protect the default branch (`develop`).
- [ ] Protect the promotion/release branch (`main`).
- [ ] Require pull requests before merge.
- [ ] Require at least one approving review.
- [ ] Dismiss stale approvals when new commits are pushed.
- [ ] Require conversation resolution before merge.
- [ ] Restrict force pushes and deletions.
- [ ] Require status checks when CI exists.
- [ ] Restrict direct pushes to both `develop` and `main`.
- [ ] Require normal feature/fix/docs/chore pull requests to target `develop`.
- [ ] Reject normal work branches whose history is not based on `develop`.
- [ ] Allow only PR `#1584` from the canonical repository's exact `codex/1577-release-reconciliation-develop` head into `develop` as the temporary `SPEC-003` reconciliation exception; remove its applicability after that PR merges.
- [ ] Require process-custody remediation pull requests to retain the issue-bound failure evidence and terminal exact-head qualification before merge.
- [ ] Allow `main` pull requests only for explicit `develop` promotions or authorised urgent hotfixes.
- [ ] Require every urgent hotfix merged to `main` to be reconciled immediately into `develop`.
- [ ] Reconcile the live branch-protection settings into the next bootstrap/adoption status artifact.
- [ ] Preserve only PR #1586 / develop / codex/850-native-custody-platform-followup / service-lasso/service-lasso as SPEC-003 grandfathering of the already-owned head; all direction/current-develop ancestry checks remain required and new normal branches remain typed.

- [ ] Issue #1597 / SPEC-003 BR-008: PR #1586 requires fresh ENTIRE cumulative source review and NEW complete-input ROOT admission before source execution; native/runtime/hosted/product/compiler/operator gates remain separate. This checklist records requirements only and changes no provider control.

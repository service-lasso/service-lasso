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
- [ ] Allow `main` pull requests only for explicit `develop` promotions or authorised urgent hotfixes.
- [ ] Require every urgent hotfix merged to `main` to be reconciled immediately into `develop`.
- [ ] Reconcile the live branch-protection settings into the next bootstrap/adoption status artifact.

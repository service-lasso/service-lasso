# Bootstrap Adoption TODO

This file tracks bootstrap/adoption/remediation work required before product implementation.

## Commit Policy
- Current bootstrap update run policy: `allowed`

## Dirty Start Resolution
- Starting repo state was dirty because bootstrap feedback artifacts were already present but uncommitted.
- Resolution used for this update run: normalize those artifacts into the current bootstrap-update output rather than discard or ignore them.

## Open Items
- Confirm whether the default long-lived branch model should remain `main` plus short-lived work branches, or adopt a permanent `develop` branch before implementation begins.
  Remediation: `gh repo edit service-lasso/service-lasso --default-branch main` remains valid today; if a `develop` branch is later adopted, create it with `git switch -c develop && git push -u origin develop` and update branch-protection settings accordingly.
- Branch-protection verification for `main` is currently blocked on the hosted GitHub feature set for this private repository.
  Remediation: either upgrade the repository/account tier or make the repository public so `gh api repos/service-lasso/service-lasso/branches/main/protection` stops returning `403`, then apply and verify the checklist in `.github/branch-protection-checklist.md`.
- Decide whether bootstrap status and feedback artifacts should be committed after review or left pending review.
  Remediation: if approved, stage and commit the bootstrap artifact files together so the repo’s governance state stays durable.

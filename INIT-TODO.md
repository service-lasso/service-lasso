# Bootstrap Adoption TODO

This file tracks bootstrap/adoption/remediation work required before product implementation.

## Commit Policy
- Current bootstrap update run policy: `allowed`

## Dirty Start Resolution
- Starting repo state was dirty because bootstrap feedback artifacts were already present but uncommitted.
- Resolution used for this update run: normalize those artifacts into the current bootstrap-update output rather than discard or ignore them.

## Open Items
- Long-lived branch model is `develop` for governed implementation and `main` for promoted releases. Feature/fix branches merge back through PR, are archived with the `archive/` prefix after merge, and the workspace returns to clean `develop` before the next issue.
- Keep branch-protection and GitHub workflow settings aligned with the strict workflow artifacts in `.github/` whenever repository visibility or plan settings change.
- Product/bootstrap adoption work is complete; use `.governance/project/BACKLOG.md` and the active service repos for any newly discovered follow-up work instead of treating this file as a live implementation queue.

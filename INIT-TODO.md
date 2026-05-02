# Bootstrap Adoption TODO

This file tracks bootstrap/adoption/remediation work required before product implementation.

## Commit Policy
- Current bootstrap update run policy: `allowed`

## Dirty Start Resolution
- Starting repo state was dirty because bootstrap feedback artifacts were already present but uncommitted.
- Resolution used for this update run: normalize those artifacts into the current bootstrap-update output rather than discard or ignore them.

## Open Items
- Long-lived branch model is now `develop` for governed implementation and `main` for promoted releases. Feature/fix branches must merge back through PR, be archived with an `archived/` prefix, and the workspace must return to clean `develop` before the next issue.
- Keep branch-protection and GitHub workflow settings aligned with the strict workflow artifacts in `.github/` whenever repository visibility or plan settings change.
- Remaining missed service work is tracked in the governed backlog as `ISS-362` through `ISS-367`, with `ISS-341` and `ISS-352` retained for Keycloak/Zitadel and TypeDB one-shot job follow-ups.

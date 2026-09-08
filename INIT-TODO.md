# Bootstrap Adoption TODO

This file tracks bootstrap/adoption/remediation work required before product implementation.

## Commit Policy
- Current bootstrap update run policy: `allowed`

## Dirty Start Resolution
- Starting repo state was dirty because bootstrap feedback artifacts were already present but uncommitted.
- Resolution used for this update run: normalize those artifacts into the current bootstrap-update output rather than discard or ignore them.

## Open Items
- Long-lived branch model is `develop` for governed implementation and `main` for promoted releases. Feature/fix branches merge back through PR, are archived with the `archive/` prefix after merge, and the workspace returns to clean `develop` before the next issue.
- Keep issue `#1164` security settings, active ruleset, branch protection,
  CODEOWNERS, immutable Action pins, CodeQL/dependency review, Dependabot, and
  approval-gated release environment aligned and verified by API readback.
- Keep Release 1 promotion blocked until issue `#1151` contains a named
  independent security approval for the replacement packet and immutable
  identities Core/npm `2026.9.8-b0c3a1b` /
  `b0c3a1bef977c26d956d3d827025fe8c39c17799`, Admin `2026.8.31-f015b44`, and
  Broker `2026.8.31-f340883`. The 2026-09-08 reject of `2026.9.1-1f4ec40` is
  not that approval. Internal evidence assembly is not external sign-off.
- Product/bootstrap adoption work is complete; use `.governance/project/BACKLOG.md` and the active service repos for any newly discovered follow-up work instead of treating this file as a live implementation queue.

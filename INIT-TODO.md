# Bootstrap Adoption TODO

This file tracks bootstrap/adoption/remediation work required before product implementation.

## Commit Policy
- Current bootstrap update run policy: `allowed`

## Dirty Start Resolution
- Starting repo state was dirty because bootstrap feedback artifacts were already present but uncommitted.
- Resolution used for this update run: normalize those artifacts into the current bootstrap-update output rather than discard or ignore them.

## Open Items
- #1463 defines a release-asset-only staged transfer prerequisite in
  `docs/api/staged-service-transfer.md`. It uses a new reviewed
  staged-registration adapter over #1462 / PR #1464 (`a83133cc`), rather than
  asserting the old `confirm:true` API already has stage fields. It derives
  canonical release checksums and exact asset IDs server-side, so client digests
  are not trusted. `release-archive-profile-v1` keeps the full release surface:
  ZIP plus a closed gzip TAR grammar for Linux/macOS assets, including bounded
  GNU-longname and POSIX-PAX path records. Current TAR admission remains
  unimplemented and blocked on fresh independent review, GNU/Linux and
  BSD/macOS real-producer fixtures/receipts, byte-level parser evidence, and
  the checksum-bound released CLI/TUI/Core journey on all three OSs. This is a
  qualification gate, not a denial of Linux/macOS releases. Implementation
  must not create a generic upload route.
  Locally authored template/source admission remains open in #1513 (`SPEC-002` /
  `SPEC-006 AC-6E`; CLI #1/#8), outside #1463.
- Long-lived branch model is `develop` for governed implementation and `main` for promoted releases. Feature/fix branches merge back through PR, are archived with the `archive/` prefix after merge, and the workspace returns to clean `develop` before the next issue.
- Keep issue `#1164` security settings, active ruleset, branch protection,
  CODEOWNERS, immutable Action pins, CodeQL/dependency review, Dependabot, and
  approval-gated release environment aligned and verified by API readback.
- Lane AN recorded AC-7H approve-with-accepted-residuals for Core/npm
  `2026.9.11-462f837`. Operator-published Latest is `2026.9.13-1bffd1b` /
  `1bffd1bca177de213e3a0bd3efb54125dc5cf107` (also on `main`). That later SHA
  is a post-review delta, not a second AN signature. The reject of
  `2026.9.1-1f4ec40` remains in force for that older identity. `#1151` stays
  open until independent review of the later bytes or an explicit operator
  close with that residual.
- Product/bootstrap adoption work is complete; use `.governance/project/BACKLOG.md` and the active service repos for any newly discovered follow-up work instead of treating this file as a live implementation queue.

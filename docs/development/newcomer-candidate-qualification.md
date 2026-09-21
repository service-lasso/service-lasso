---
title: Newcomer candidate qualification
---

# Newcomer candidate qualification

This is an evidence matrix for Core issue #1323. It is not a release approval
or a substitute for independent GA review.

## Historical Linux candidate

| Component | Identity |
| --- | --- |
| Core | `a0ef7280a58219ff8228cf46d81fe3a99f534eab` |
| Service Admin | `2026.8.31-f015b44` pinned artifact |
| Secrets Broker | `2026.8.31-f340883` pinned artifact |

## Direct-platform matrix

| Platform | Environment | Result | Evidence and limits |
| --- | --- | --- | --- |
| Linux | Two fresh owned folders, non-root Ubuntu 26.04 WSL2 x86_64 | Verified, direct at `8a4c3e0b6d044066540382685ce725a99b605db3` | [Full paired report and inspected ZIP](https://github.com/service-lasso/service-lasso/issues/1385#issuecomment-5764104066). Both complete browser journeys, 40 ops routes and four ops captures per lane, app failure/recovery/persistence, simultaneous ownership and cleanup isolation passed. All 22 screenshots inspected; [downloaded attachment hash matched](https://github.com/service-lasso/service-lasso/issues/1385#issuecomment-5764112226). Earlier failed `f219a06` attempts remain Invalidated. |
| Windows | Two fresh isolated folders, Windows 11 Pro 10.0.26200 x86_64 | Verified, historical at `f219a06a729549adb408435c6804512fe2ac88e8`; corrected-candidate requalification outstanding | [Full paired report and inspected ZIP](https://github.com/service-lasso/service-lasso/issues/1328#issuecomment-5763240645). Both browser suites, 40 ops routes and four ops captures per lane, app/package/recovery/persistence, simultaneous ownership and cleanup isolation passed. All 22 screenshots inspected; [attachment readback hash matched](https://github.com/service-lasso/service-lasso/issues/1328#issuecomment-5763249508). This does not prove the later `8a4c3e0` candidate. |
| macOS | No direct run available | Deferred, non-blocking | #1330 contains the same portable command, full journey requirements, two-folder isolation checks, report fields, and ZIP-upload procedure. No macOS pass is claimed. |

## Remaining decision boundary

The later Windows pair at `8a4c3e0` is **Invalidated**, not merely awaiting
execution. Lane A failed during Archive installation on EPERM replacing its
startup recovery sidecar; lane B completed all seven browser scenario groups
but aborted before concurrent cleanup-isolation proof. Both runtime cleanup
receipts settled successfully. [Inspected failure ZIP and exact report](https://github.com/service-lasso/service-lasso/issues/1328#issuecomment-5764916307)
and [downloaded attachment verification](https://github.com/service-lasso/service-lasso/issues/1328#issuecomment-5764919900)
retain the outcome. All 11 available screenshots and nested ZIP entries were
inspected. ZIP SHA-256:
`e62b9ab126cbb32b1638ef9d2f1ed59da8c3500ccc8cdc72bb2ab3555b9e6e1c`.
The historical passing Windows row above does not override this failure.

The Linux process-enumeration repair #1393 merged into `develop` at
`02de549572ad5e1ab47fbf227eb108ac9e3dcc66` after 43 exact-head checks passed.
Windows sidecar repair #1395 incorporates that repair at `b3887c8`; neither
older platform proof qualifies this changed candidate. Its full paired proof,
required CI, integration and post-merge gates must be reconciled before a
readiness conclusion. Windows process-inspection investigation #1326 also
remains open; passing unrelated checks does not establish its root cause.

The user explicitly accepts a new owned folder as a new-machine equivalent for
Service Lasso and requires simultaneous independent folder instances. macOS proof
and independent newcomer review are deferred confidence follow-ups, not readiness
blockers. This supersedes the earlier external-machine and mandatory-three-platform
acceptance policy; it is not an independent review or release-promotion approval.

Windows proof uses locked Playwright 1.56.1, Chromium 141.0.7390.37 and Node
22.23.2. ZIP SHA-256 is
`4fb48b4aca10d8b02fc24b6e22f5cd83f2835704e6810194ac22694a50ac4b95`.
It explicitly substitutes a locally staged current Core package into the unpacked
example; it does not claim the pinned public dependency changed. Installed
Admin/Broker identities remain the pinned versions above, with exact archive
hashes in the receipts. Echo/PostgreSQL local digests are distinguished from
upstream-verified checksums. PR #1379 merged into `develop` as
`39e1292548a30d063521438c485a8765ef853dd1`; integration and hosted CI remain
separate evidence from the direct browser run.

The new Linux pair ran from 2026-09-21T16:35:22.779Z to 16:37:10.487Z with
Node 22.22.1, Playwright 1.56.1 and Chromium 141.0.7390.37. It used
`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64`, which is a browser-build
compatibility override, not an official Ubuntu 26.04 support claim. ZIP SHA-256:
`7b65322ad7201eb5920e805f49802bae8e60eb8c6d843856b5f6d37ed757742e`.
Each child receipt retains its single-run limitation; the outer pair receipt
proves concurrent ownership and stopping A without disturbing B. Both runtime
cleanups settled and both app cleanups passed. The locally staged current Core
substitution is explicit in both receipts. This is agent-operated direct evidence,
not independent review or proof of a newly published package.

Historical `fresh-linux-a0ef728` proved isolated first run, healthy canonical
recycle/verification and owned cleanup with seven shutdown entries. It is retained
as historical runtime evidence, not relabelled as full browser proof. Matching
Windows proof and post-merge technical gates are still required before reconciling
the final candidate. The Linux repair (PR #1388) merged as
`f6a6ff56c76ba15534876d9241afae913e5a5543`; its tree is identical to tested
`8a4c3e0`, but the receipt's source identity is not rewritten. Its Release
Qualification, MCP and CodeQL post-merge gates passed; this does not qualify
the subsequent repaired candidate. No GA approval is
recorded here.

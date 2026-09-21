---
title: Newcomer candidate qualification
---

# Newcomer candidate qualification

This is an evidence matrix for Core issue #1323. It is not a release approval
or a substitute for independent GA review.

## Recorded Linux candidate

| Component | Identity |
| --- | --- |
| Core | `a0ef7280a58219ff8228cf46d81fe3a99f534eab` |
| Service Admin | `2026.8.31-f015b44` pinned artifact |
| Secrets Broker | `2026.8.31-f340883` pinned artifact |

## Direct-platform matrix

| Platform | Environment | Result | Evidence and limits |
| --- | --- | --- | --- |
| Linux | Fresh non-root Ubuntu 26.04 checkout | Verified, direct | Isolated first run completed; canonical recycle reported `healthy` and canonical verification passed. The owned cleanup converged with seven shutdown entries. Evidence ID: `fresh-linux-a0ef728`. This is a source-candidate proof, not published-package or cross-platform proof. |
| Windows | Two fresh isolated folders, Windows 11 Pro 10.0.26200 x86_64 | Verified, direct at `f219a06a729549adb408435c6804512fe2ac88e8` | [Full paired report and inspected ZIP](https://github.com/service-lasso/service-lasso/issues/1328#issuecomment-5763240645). Both browser suites, 40 ops routes and four ops captures per lane, app/package/recovery/persistence, simultaneous ownership and cleanup isolation passed. All 22 screenshots inspected; [attachment readback hash matched](https://github.com/service-lasso/service-lasso/issues/1328#issuecomment-5763249508). |
| macOS | No direct run available | Deferred, non-blocking | #1330 contains the same portable command, full journey requirements, two-folder isolation checks, report fields, and ZIP-upload procedure. No macOS pass is claimed. |

## Remaining decision boundary

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
upstream-verified checksums. PR #1379 integration/current-head CI is a separate
gate from this direct evidence.

The Linux runtime/recycle receipt above does
not by itself prove the newly requested full Playwright screenshot journey. Do not
transfer that result to a newer source candidate or another OS. No GA approval is
recorded here.

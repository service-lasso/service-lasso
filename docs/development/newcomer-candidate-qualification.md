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
| Windows | Fresh isolated folders on the existing host, accepted by the user | Invalidated / in progress | #1328 and #1376 own full Playwright journey and concurrent-instance proof. Runs have exposed runner defects and installation failures; no complete passing journey or public ZIP exists yet. Individual receipts bind their exact source commits. |
| macOS | No direct run available | Deferred, non-blocking | #1330 contains the same portable command, full journey requirements, two-folder isolation checks, report fields, and ZIP-upload procedure. No macOS pass is claimed. |

## Remaining decision boundary

The user explicitly accepts a new owned folder as a new-machine equivalent for
Service Lasso and requires simultaneous independent folder instances. macOS proof
and independent newcomer review are deferred confidence follow-ups, not readiness
blockers. This supersedes the earlier external-machine and mandatory-three-platform
acceptance policy; it is not an independent review or release-promotion approval.

Windows full journey, lifecycle/recovery, concurrent-folder isolation, and inspected
uploaded evidence remain incomplete. The Linux runtime/recycle receipt above does
not by itself prove the newly requested full Playwright screenshot journey. Do not
transfer that result to a newer source candidate or another OS. No GA approval is
recorded here.

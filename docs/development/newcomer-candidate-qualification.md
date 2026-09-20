---
title: Newcomer candidate qualification
---

# Newcomer candidate qualification

This is an evidence matrix for Core issue #1323. It is not a release approval
or a substitute for independent GA review.

## Candidate

| Component | Identity |
| --- | --- |
| Core | `a0ef7280a58219ff8228cf46d81fe3a99f534eab` |
| Service Admin | `2026.8.31-f015b44` pinned artifact |
| Secrets Broker | `2026.8.31-f340883` pinned artifact |

## Direct-platform matrix

| Platform | Environment | Result | Evidence and limits |
| --- | --- | --- | --- |
| Linux | Fresh non-root Ubuntu 26.04 checkout | Verified, direct | Isolated first run completed; canonical recycle reported `healthy` and canonical verification passed. The owned cleanup converged with seven shutdown entries. Evidence ID: `fresh-linux-a0ef728`. This is a source-candidate proof, not published-package or cross-platform proof. |
| Windows | No clean external lane available | Blocked | Existing development-host observations are not clean-machine evidence. Do not substitute CI or the Linux result. |
| macOS | No clean external lane available | Blocked | No direct macOS journey has been run for this candidate. Do not substitute CI or the Linux result. |

## Remaining decision boundary

The matrix cannot support GA while Windows and macOS remain blocked. A named
independent reviewer must assess the exact candidate and all evidence once the
three-platform matrix is complete; this document records no reviewer decision.

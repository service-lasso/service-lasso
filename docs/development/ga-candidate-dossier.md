---
title: GA candidate dossier
---

# GA candidate dossier

Prepared for Core #1321. This dossier is a decision input, not a GA approval.

## Current acceptance decision

The user has accepted fresh owned folders on one host as newcomer environments
and requires concurrent folder instances to work. macOS direct proof (#1330) and
independent newcomer review are deferred confidence follow-ups, not blockers to
the current readiness conclusion. This does not waive release-promotion controls
or supply an independent GA approval. Windows full journey, simultaneous-folder
proof and inspected ZIP upload/readback are Verified at
`f219a06a729549adb408435c6804512fe2ac88e8` (#1328/#1376). Linux full paired
Playwright proof, concurrent ownership, cleanup isolation and inspected ZIP
upload/readback are now Verified at
`8a4c3e0b6d044066540382685ce725a99b605db3` (#1385/#1387). Matching Windows
requalification at this corrected candidate failed: the `8a4c3e0` pair is
Invalidated on a Windows startup-sidecar EPERM. The [inspected failure ZIP](https://github.com/service-lasso/service-lasso/issues/1328#issuecomment-5764916307)
has a [verified downloaded checksum](https://github.com/service-lasso/service-lasso/issues/1328#issuecomment-5764919900).
Lane B browser success and settled owned cleanup do not prove simultaneous
operation or cleanup isolation. PR #1388 merged
into `develop` as `f6a6ff56c76ba15534876d9241afae913e5a5543` with a tree
identical to tested `8a4c3e0`; its Release Qualification, MCP and CodeQL
post-merge gates passed. Subsequent Linux enumeration repair #1393 is merged
at `02de549`, and Windows sidecar repair #1395 incorporates it at `b3887c8`.
Exact integrated-candidate qualification remains outstanding; #1326 Windows
process-inspection investigation remains open. These are technical gaps,
distinct from deferred macOS and independent-review follow-ups.
Historical evidence is not silently upgraded. PR #1379 merged as
`39e1292548a30d063521438c485a8765ef853dd1`; hosted technical gates are separate
from direct newcomer proof.

The candidate and reviewer-routing details below are a historical evidence packet;
they do not describe current branch heads. See the newcomer matrix for current
classifications. Each new receipt must identify its exact tested source.

## Historical candidate identity

| Component | Exact identity | Status |
| --- | --- | --- |
| Core integration base | `a0ef7280a58219ff8228cf46d81fe3a99f534eab` | Historical Linux candidate, not current `develop` |
| Service Admin | `2026.8.31-f015b44` | Last published artifact; source integration at `82e549b2060f441d3ff4bffe0c72b7e411b66e87` is separately evidenced, not published |
| Secrets Broker | `2026.8.31-f340883` | Pinned artifact |
| Dashboard policy | Core #1349 merged as `076e89fd8f7565c385aa459512d77232a598ef30` | Historical policy delivery; later live-repaint capture repair and Windows evidence are bound to `f219a06` |
| Newcomer matrix | Core #1323 | Current per-platform classifications are in the newcomer matrix; this historical packet does not upgrade another candidate |

## Evidence classification

| Evidence line | Classification | Record |
| --- | --- | --- |
| Core Release Qualification at candidate base | Verified, surrogate-only | Current-`develop` Release Qualification `35483512309` passed; it does not prove customer journeys |
| Dashboard policy enforcement tests | Verified | #1349 focused suite and terminal hosted checks passed before merge |
| Dashboard rendered 1512x982 clean-owned capture | Verified, source-integration only | #1322: exact candidate completed 40/40 route audit; inspected redacted capture receipt is review-only with no docs write |
| Windows newcomer journey | Verified, direct at `f219a06` | [Paired proof and inspected ZIP](https://github.com/service-lasso/service-lasso/issues/1328#issuecomment-5763240645); both complete browser suites, simultaneous ownership, cleanup isolation and owned cleanup passed. [Downloaded attachment checksum matched](https://github.com/service-lasso/service-lasso/issues/1328#issuecomment-5763249508). This is not evidence for a later candidate. |
| Linux newcomer journey | Verified, direct at `8a4c3e0` | [Full paired proof and inspected ZIP](https://github.com/service-lasso/service-lasso/issues/1385#issuecomment-5764104066); both complete browser journeys, 40 ops routes per lane, simultaneous ownership, cleanup isolation and owned cleanup passed. [Downloaded attachment checksum matched](https://github.com/service-lasso/service-lasso/issues/1385#issuecomment-5764112226). Ubuntu 26.04 WSL2 used an explicitly disclosed Playwright Ubuntu 24.04 browser-build override. Not independent, published-package, Windows or macOS proof. Historical `a0ef728` remains runtime-only evidence. |
| macOS newcomer journey | Deferred, non-blocking | macOS follow-up #1330; no direct pass claimed |
| Independent newcomer review | Deferred, non-blocking | No independent review has occurred; the user has deferred it |
| GA approval | Not recorded | No approval is inferred or self-signed |

## Deferred independent decision boundary

If the deferred independent GA review is undertaken, the reviewer must be
independent of the implementation and delivery work. They
must record **approved**, **not approved**, or **blocked** against the exact
explicitly selected candidate, explain the rationale, and require re-review if any candidate
or evidence line changes. On this record, no GA approval is supportable.

### Reviewer-routing status

On 2026-09-19, `.github/CODEOWNERS` assigned every relevant Core path to
`@wildone`, who also authored the delivery PRs and this dossier. That ownership
entry therefore cannot supply the required independent decision. No individual
independent reviewer has been nominated, requested, or accepted the review for
#1321. For that deferred review, a release owner must nominate an external reviewer or organization that
can state its independence, review the exact candidate and evidence records,
and record its name, date, decision, and residual findings. The delivery owner
must not fill that role or infer its decision.

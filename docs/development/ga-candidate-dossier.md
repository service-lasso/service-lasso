---
title: GA candidate dossier
---

# GA candidate dossier

Prepared for Core #1321. This dossier is a decision input, not a GA approval. Apply [canonical release authority](../../.governance/rules/gov-09-release-authority.mdc) to any new candidate. Its historical reviewer-routing notes below record the former decision context and do not impose an independent-approval gate on a new candidate.

## Current matched candidate: d0f68e3

Windows and Linux full paired newcomer proofs are Verified at exact Core source
`d0f68e3fc47b0bebc22a0cb55bf63c672b589637`. PR #1396 merged into `develop`
as `72148b5009cca15db11aa1bffb0f1a261e655af3`; the complete file tree was
verified identical. Receipt source identities are not rewritten.

| Platform | Published evidence | ZIP SHA-256 |
| --- | --- | --- |
| Windows | [Report and ZIP](https://github.com/service-lasso/service-lasso/issues/1328#issuecomment-5765661612), [download verification](https://github.com/service-lasso/service-lasso/issues/1328#issuecomment-5765666160) | `3e5389f65dd89227d39d435e6383e9d07b6566608a6cb291a40f5dd24b2d364e` |
| Linux | [Report and ZIP](https://github.com/service-lasso/service-lasso/issues/1385#issuecomment-5765710325), [download verification](https://github.com/service-lasso/service-lasso/issues/1385#issuecomment-5765713645) | `cd580f5c3843db79e2717987cd3a08bd05eac92488a0ed737645ff5f679e3614` |
| macOS | Deferred non-blocking follow-up #1330 | No direct proof claimed |

Each platform ran both full browser journeys, all seven scenario groups, 40 ops
routes and four ops captures per lane, app dependency failure/recovery and data
persistence. The coordinator observed simultaneous distinct ownership and proved
that stopping A did not disturb B before B cleanup. Both runtime cleanups settled
and both app cleanups passed. All 22 screenshots per platform and all public
JSON/nested archive entries were inspected; downloaded ZIP hashes matched.
Child receipts retain their single-run concurrency limitation; the Verified pair
receipt supplies that evidence.

Windows: Windows 11 Pro 10.0.26200 x86_64, Node 22.23.2,
2026-09-21T18:29:18.051Z–18:32:58.237Z. Linux: non-root Ubuntu 26.04 WSL2
x86_64, Node 22.22.1, 18:37:59.961Z–18:39:53.893Z on the same UTC date.
Both used locked Playwright 1.56.1 and Chromium 141.0.7390.37. Linux explicitly
used `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64`; this does not claim
official Playwright support for Ubuntu 26.04.

Both journeys explicitly substitute locally staged current-candidate Core for
the example's pinned dependency. Admin `2026.8.31-f015b44` and Broker
`2026.8.31-f340883` remain pinned published artifacts; exact hashes are in the
receipts. Echo/Postgres digests are not claimed upstream-verified. Screenshots
retain stopped-service warnings; this is not an all-services-healthy claim.
Dashboard text and local paths are deliberately redacted. Raw logs, credentials,
runtime state and private diagnostics remain outside the uploaded bundles.

This is same-operator direct evidence, not independent review or a newly
published Core package. Earlier `8a4c3e0` sidecar and `b3887c8` deadline
failures remain retained. #1326 remains open because diagnostics alone do not
resolve the intermittent deadline failure. #1382's macOS CI failure remains
a separate investigation, not the deferred direct macOS newcomer proof.
Exact-head product pre-merge checks passed. Integrated-source Release Qualification
[run 35639858582, attempt 2](https://github.com/service-lasso/service-lasso/actions/runs/35639858582)
passed at `72148b5`; the Linux Broker receipt was downloaded and inspected.
Attempt 1's artifact-finalization HTTP 403 remains tracked in #1390; recovery
does not establish its root cause. Sidecar hardening #1394 is complete, including
the integrated Windows paired proof. Evidence PR #1389 merged as `ff3f2b8`, and
the reconciled product head `77f1cf9` passed Release Qualification
[run 35645391278](https://github.com/service-lasso/service-lasso/actions/runs/35645391278);
the #1397 hard-crash fixture diagnostics landed via #1398. That recovers the
check, not the unknown cause of the first failure. This revision completes the
final dossier reconciliation. No GA approval, deployment or promotion is
recorded.

## Historical record below

The following sections retain earlier candidate checkpoints and their then-open
gaps. They do not supersede the current matched-candidate record above.


## Historical acceptance checkpoint

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

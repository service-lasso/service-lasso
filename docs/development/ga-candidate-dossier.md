---
title: GA candidate dossier
---

# GA candidate dossier

Prepared for Core #1321. This dossier is a decision input, not a GA approval.

## Candidate identity

| Component | Exact identity | Status |
| --- | --- | --- |
| Core integration base | `2fc28ad4a9e8b47bbd0e615afb2179bb2f61baa8` | Current documented candidate base |
| Service Admin | `2026.8.31-f015b44` | Pinned artifact |
| Secrets Broker | `2026.8.31-f340883` | Pinned artifact |
| Dashboard policy | Core PR #1324, `0fb4014ac56145b9e9766ecff38e4aca42f9c226` | Not merged; candidate is not eligible for Dashboard publication |
| Newcomer matrix | Core PR #1327, `ed6834053914db4b6184259693b1020ba125ddd3` | Not merged; evidence contract only |

## Evidence classification

| Evidence line | Classification | Record |
| --- | --- | --- |
| Core Release Qualification at candidate base | Verified, surrogate-only | Run `35341823256` passed; does not prove user journeys |
| Dashboard policy enforcement tests | Verified, partial | PR #1324 focused suite passed; no direct rendered safe Dashboard proof |
| Dashboard rendered 1512x982 clean-owned capture | Blocked | #1322; current-head CI regressions #1325 and #1326 keep its PR red |
| Windows newcomer journey | Blocked | Clean environment owner #1328 |
| Linux newcomer journey | Blocked | Isolated environment owner #1329 |
| macOS newcomer journey | Blocked | macOS environment owner #1330 |
| Independent reviewer acceptance and GA decision | Blocked | No named independent reviewer has accepted #1321 |

## Reviewer decision boundary

The reviewer must be independent of the implementation and delivery work. They
must record **approved**, **not approved**, or **blocked** against the exact
candidate above, explain the rationale, and require re-review if any candidate
or evidence line changes. On this record, no GA approval is supportable.

### Reviewer-routing status

On 2026-09-19, `.github/CODEOWNERS` assigned every relevant Core path to
`@wildone`, who also authored the delivery PRs and this dossier. That ownership
entry therefore cannot supply the required independent decision. No individual
independent reviewer has been nominated, requested, or accepted the review for
#1321. A release owner must nominate an external reviewer or organization that
can state its independence, review the exact candidate and evidence records,
and record its name, date, decision, and residual findings. The delivery owner
must not fill that role or infer its decision.

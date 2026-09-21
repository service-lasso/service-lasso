---
title: GA candidate dossier
---

# GA candidate dossier

Prepared for Core #1321. This dossier is a decision input, not a GA approval.

## Candidate identity

| Component | Exact identity | Status |
| --- | --- | --- |
| Core integration base | `a0ef7280a58219ff8228cf46d81fe3a99f534eab` | Current `develop` candidate |
| Service Admin | `2026.8.31-f015b44` | Last published artifact; source integration at `82e549b2060f441d3ff4bffe0c72b7e411b66e87` is separately evidenced, not published |
| Secrets Broker | `2026.8.31-f340883` | Pinned artifact |
| Dashboard policy | Core #1349 merged as `076e89fd8f7565c385aa459512d77232a598ef30` | Included in the current candidate; its rendered evidence remains source-integration only |
| Newcomer matrix | Core #1323 | Linux direct proof is complete at this candidate; Windows and macOS remain blocked, with no surrogate substituted |

## Evidence classification

| Evidence line | Classification | Record |
| --- | --- | --- |
| Core Release Qualification at candidate base | Verified, surrogate-only | Current-`develop` Release Qualification `35483512309` passed; it does not prove customer journeys |
| Dashboard policy enforcement tests | Verified | #1349 focused suite and terminal hosted checks passed before merge |
| Dashboard rendered 1512x982 clean-owned capture | Verified, source-integration only | #1322: exact candidate completed 40/40 route audit; inspected redacted capture receipt is review-only with no docs write |
| Windows newcomer journey | Blocked | Existing development host is not a clean environment; #1328 owns an authorized clean lane |
| Linux newcomer journey | Verified, direct | Fresh non-root Ubuntu 26.04 proof at `a0ef7280a58219ff8228cf46d81fe3a99f534eab` completed first run and canonical verification with healthy classification; owned cleanup settled. The metadata-only matrix is in `docs/development/newcomer-candidate-qualification.md`. This does not substitute for Windows or macOS. |
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

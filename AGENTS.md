# VibeGov Activation

This repository uses VibeGov with `.governance/` as the governance source of truth.

## Canonical Bootstrap Sources
- `https://vibegov.io/agent.txt`
- `https://vibegov.io/bootstrap.json`
- `https://vibegov.io/docs/bootstrap/`

## Required Read Order
Read before making governed changes or bootstrap claims:
1. `.governance/rules/gov-01-instructions.mdc`
2. `.governance/rules/gov-02-workflow.mdc`
3. `.governance/rules/gov-03-communication.mdc`
4. `.governance/rules/gov-04-quality.mdc`
5. `.governance/rules/gov-05-testing.mdc`
6. `.governance/rules/gov-06-issues.mdc`
7. `.governance/rules/gov-07-tasks.mdc`
8. `.governance/rules/gov-08-exploratory-review.mdc`
9. `.governance/rules/gov-09-agent-continuity-bootstrap.mdc`
10. `.governance/rules/gov-10-agent-state-closure-git-hygiene.mdc`
11. `.governance/rules/gov-11-agent-legibility-in-repo-truth.mdc`
12. `.governance/rules/gov-12-drift-control-garbage-collection.mdc`
13. `.governance/rules/gov-13-review-loops-completion-discipline.mdc`
14. `.governance/rules/gov-14-architect-conductor-boundaries.mdc`
15. `.governance/rules/gov-09-release-authority.mdc` (Service Lasso release-authority overlay)

## Repo Defaults
- Source of truth: `.governance/`
- Provider-native mirror targets: none detected during latest bootstrap update
- Operating modes: `Development` and `Exploration`
- Release verification stays inside `Development`; agents may report `Technically Ready for GA` for an exact qualified candidate. Only the release owner declares GA and explicitly authorizes promotion, publication, or deployment.
- Default bootstrap commit policy: `allowed` unless a run artifact states otherwise
- Continuity operating guidance: `.governance/project/CONTINUITY.md`
- For newly delegated repository work, use `GPT-6.1 Sol` at low reasoning effort unless the user explicitly selects another model or effort. This applies to fresh reviewers and new workers; it does not revise historical handovers or interrupt an already-owned bounded work unit.

## Non-Negotiable Branch Boundary
- Development agents use `develop` and their issue-scoped branch only.
- Create every new normal-work branch from current `develop` with one of `feature/<issue>-<slug>`, `fix/<issue>-<slug>`, `docs/<issue>-<slug>`, or `chore/<issue>-<slug>`. Do not create new normal-work branches with the `codex/` prefix.
- Existing issue branches and pull-request heads remain under their current owner until their governed landing path completes; do not rename, reuse, or clean them up during unrelated work.
- Development agents must not inspect, fetch, compare, orient from, plan from, branch from, merge from, or target `main`.
- `main` access belongs only to an explicitly authorised release-promotion, urgent-hotfix, or branch-reconciliation role. That exception does not turn `main` into development input.
- If normal development instructions, automation, or backlog context point at `main`, stop and correct the workflow before touching product code.

## Pre-Code Gate
Before product-code implementation:
- keep `.governance/project/PROJECT_INTENT.md` current
- work from an active spec in `.governance/specs/`
- keep backlog items mapped to spec sections
- keep `INIT-TODO.md` current for bootstrap/adoption/remediation work
- maintain strict Git workflow artifacts in `.github/`
- stop and update governance artifacts before expanding scope

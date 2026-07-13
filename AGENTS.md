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

## Repo Defaults
- Source of truth: `.governance/`
- Provider-native mirror targets: none detected during latest bootstrap update
- Operating modes: `Development` and `Exploration`
- Release verification stays inside `Development`
- Default bootstrap commit policy: `allowed` unless a run artifact states otherwise

## Non-Negotiable Branch Boundary
- Development agents use `develop` and their issue-scoped branch only.
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

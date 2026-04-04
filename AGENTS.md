# VibeGov Activation

This repository uses VibeGov with `.governance/` as the governance source of truth.

## Required Read Order
Read before making governed changes:
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
- Provider-native mirror targets: none detected at bootstrap time
- Operating modes: `Development` and `Exploration`
- Release verification stays inside `Development`

## Pre-Code Gate
Before product-code implementation:
- keep `.governance/project/PROJECT_INTENT.md` current
- work from an active spec in `.governance/specs/`
- keep backlog items mapped to spec sections
- stop and update governance artifacts before expanding scope

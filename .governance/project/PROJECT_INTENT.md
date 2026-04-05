# Project Intent

Use this file to capture the project-specific intent that governance cannot provide.

## Purpose
This repository exists to establish a governed starting point for Service Lasso while stakeholder-validated product intent is still incomplete.

## Context
This repository started from an almost empty baseline with only a placeholder README and no validated product brief. The current intent is therefore provisional: establish durable governance, Git workflow, and tracking artifacts before any product implementation begins. GitHub is the current system of record for repository workflow, issue tracking, and project-board setup during bootstrap.

## Constraints
- Governance artifacts must be established before product code.
- This repo is private and should preserve clear auditability for decisions and changes.
- Product scope is currently too vague to lock into a feature-first implementation spec.
- Bootstrap update mode must preserve valid existing artifacts and repair stale or missing ones.
- No provider-native rules directory was present at bootstrap, so `.governance/` remains the only active rules location for now.

## Risks
- The product problem could be guessed incorrectly from the repository name, causing bootstrap artifacts to smuggle in unvalidated scope.
- GitHub workflow/bootstrap artifacts could drift from the live repository state if they are not reconciled after automation steps.
- Branch-protection or project-board expectations could appear satisfied locally while remaining incomplete remotely.
- Verification could become shallow if implementation starts before bootstrap blockers and provisional assumptions are made explicit.

## Assumptions
- Stakeholder-validated product intent will be captured in a follow-on feature spec before product code is written.
- GitHub-backed issue tracking and project boards are acceptable workflow tools for bootstrap and adoption work.
- Repo-local bootstrap artifacts should stay durable even when GitHub automation is available.
- Existing governance rules copied into `.governance/rules/` remain valid unless superseded by live canonical sources.

## Key Behaviors
- Bootstrap runs should classify starting repo state, commit policy, and GitHub capability before claiming progress.
- Governance, Git workflow, and GitHub board artifacts should remain traceable and reviewable from the start.
- Product behavior should not be invented when intent is still too vague; bootstrap should use a governance/setup spec instead.
- New work should be introduced through specs, backlog items, and durable status artifacts rather than undocumented chat decisions.

## Verification Expectations
Before product code, verification should focus on artifact completeness and live-state reconciliation: active governance rules, provisional-but-honest project intent, a valid `SPEC-001`, a backlog mapped to that spec, strict Git workflow artifacts, GitHub preflight reporting, timestamped bootstrap status/feedback artifacts, and final confirmation that the local docs match the live git/GitHub state.

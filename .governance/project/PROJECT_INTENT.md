# Project Intent

Use this file to capture the project-specific intent that governance cannot provide.

## Purpose
Service Lasso exists to pull scattered service knowledge into one governed place so teams can understand what services exist, who owns them, and what operational context is required to work on them safely.

## Context
This repository is starting from an almost empty baseline, so the current project intent is based on the repository name, the initial README, and the decision to bootstrap with VibeGov before implementation. The likely primary users are platform teams, service owners, and operators who need a dependable inventory of services and their ownership details. Likely surrounding systems include GitHub, internal documentation, observability tools, and deployment/runtime platforms that may become future integration sources.

## Constraints
- Governance artifacts must be established before product code.
- This repo is private and should preserve clear auditability for decisions and changes.
- Product scope is still early and must remain easy to change until validated.
- Initial delivery should prefer a small, coherent service-inventory slice over broad platform ambitions.
- No provider-native rules directory was present at bootstrap, so `.governance/` remains the only active rules location for now.

## Risks
- The product problem could be interpreted too broadly, leading to premature architecture or over-scoped implementation.
- Service metadata may come from multiple systems with conflicting definitions of ownership or lifecycle.
- Teams may expect automation or integrations before the canonical service record is defined.
- Verification could become shallow if behavior is implemented before the core workflows and evidence expectations are agreed.

## Assumptions
- "Service Lasso" implies a system for collecting and organizing service-level metadata rather than a general task tracker.
- The first implementation slice should establish a canonical service record and a basic review workflow before external integrations.
- GitHub-backed issue and task tracking is acceptable later, but a repo-local backlog is sufficient for bootstrap.
- Additional product detail will be captured by follow-on specs before implementation expands.

## Key Behaviors
- The system should maintain a clear, reviewable definition of what a service record contains.
- Ownership and operational context should be explicit enough to support safe handoff and incident response.
- Planned workflows should emphasize discoverability, reviewability, and governance traceability from the start.
- New behavior should be introduced through specs and backlog items, not undocumented chat decisions.

## Verification Expectations
Before product code, verification should focus on artifact completeness: active governance rules, project intent, a feature spec, and a backlog mapped to the spec. Once implementation begins, each scoped change should include acceptance criteria, verification evidence, and traceability updates tied back to the active spec and backlog items.

---
title: Service Lasso Docs
slug: /
---

# Service Lasso Docs

This repo is the canonical home for general Service Lasso documentation.

The `docs/` folder is both the GitHub-readable documentation source and the Docusaurus site root.

Run the local docs build from the repo root:

```powershell
npm run docs:build
```

Run the local docs development server:

```powershell
npm run docs:start
```

Serve the last production build locally:

```powershell
npm run docs:serve
```

## Docs pipeline

The `Docs Site` workflow in `.github/workflows/docs-site.yml` runs `npm ci` and `npm run docs:build` for docs-related pull requests and pushes to `develop`.

Pushes to `main` build the same Docusaurus site and deploy `docs/build` to GitHub Pages. This repository is configured to use the GitHub Actions Pages source at `https://service-lasso.github.io/service-lasso/`.

Core runtime status: the runtime, package, release-backed baseline services, update/recovery surfaces, and reference-app integration paths are implemented enough for current consumer use. The current docs focus is making the service-authoring and operator paths explicit enough for new contributors and agents.

Current preferred runtime-root model:
- `servicesRoot` = where services live
- `workspaceRoot` = where Service Lasso stores runtime-managed working data

## Canonical general docs

- `docs/INTRODUCTION.md` - comprehensive introduction to Service Lasso, its donor origin, repo split, and current core-runtime direction
- `docs/development/new-lasso-service-guide.md` - agent-ready guide for creating a new release-backed `service-lasso/lasso-*` service repo
- `docs/reference/service-json-reference.md` - general `service.json` contract reference
- `docs/reference/SERVICE-JSON-COMPLETE-UNION-SCHEMA.md` - generalized schema/reference shape
- `docs/reference/SERVICE-CONFIG-TYPES.md` - taxonomy of common service config patterns
- `docs/reference/shared-runtime/SERVICE-MANAGER-BEHAVIOR.md` - shared runtime behavior notes
- `docs/windows-containment-tiers.md` - Windows containment guidance
- `docs/development/core-runtime-layout.md` - first tracked core runtime source layout for `SPEC-002` / `TASK-006`
- `docs/development/core-runtime-dev-plan.md` - recommended full core repo structure, API shape, and implementation order
- `docs/development/core-runtime-demo-instance-plan.md` - phased plan for turning the current bounded core runtime into a reviewable demo instance
- `docs/development/core-runtime-migration-plan.md` - donor service-manager migration status, gap map, and recommended next migration order
- `docs/development/core-runtime-comprehensive-review.md` - consolidated review of docs, donor/spec/code coverage, assumptions, and test evidence
- `docs/development/core-runtime-donor-coverage-audit.md` - donor/spec/code coverage audit with current test evidence and remaining runtime gaps
- `docs/development/core-runtime-working-application-plan.md` - staged next-steps plan for turning the bounded core slice into a genuinely working application
- `docs/development/core-runtime-autonomous-task-list.md` - comprehensive ordered execution list for finishing donor migration slices, consumer validation, and post-core rollout
- `docs/development/core-runtime-package-architecture.md` - bounded core package-boundary plan and the current sibling-repo template rollout for reference apps
- `docs/development/reference-app-and-service-distribution-remediation-plan.md` - corrective plan for reference-app naming, canonical `service.json` release/install metadata, and bundled versus download/install behavior
- `docs/development/planned-services-review.md` - current planned-service inventory review and reference-app baseline gaps
- `docs/development/java-runtime-service-plan.md` - bounded `@java` provider decision, donor `_java` analysis, and deferred release-backed JRE repo plan
- `docs/development/service-recovery-doctor-upgrade-hooks-plan.md` - recovery, doctor/preflight, restart-policy, and upgrade-hook contract plan
- `docs/development/reference-app-service-distribution-task-list.md` - governed execution order for the four active distribution-remediation workstreams
- `docs/development/core-runtime-release-artifact.md` - exact definition of the current bounded downloadable runtime artifact and what files it ships
- `docs/development/core-runtime-publishable-package.md` - exact definition of the current bounded self-contained publishable `@service-lasso/service-lasso` package payload and how it is verified/published
- `docs/development/consumer-project-readiness-task-list.md` - remaining task list for using Service Lasso from other projects
- `docs/development/reference-app-poc-matrix.md` - shared minimum POC contract for the sibling starter repos around host output, Echo Service, and Service Admin
- `docs/development/serviceadmin-integration-validation.md` - bounded integration validation checklist and current findings for `lasso-@serviceadmin` against the runtime/API
- `docs/development/core-runtime-state-model-audit.md` - agreed vs provisional audit of the current `.state/` model and its implementation gaps
- `docs/development/core-runtime-logging-model.md` - canonical logging and archival model using `workspaceRoot/logs/runs/<runId>` for traceability
- `docs/development/core-runtime-storage-model.md` - preferred split between `servicesRoot` and `workspaceRoot` for multi-config and multi-instance operation

## Source-of-truth rule for `service.json`

When discussing or changing the general `service.json` contract:
- use the core `service-lasso` docs as the source of truth
- update the canonical docs here first
- only then mirror or point from individual service repos as needed

Current canonical files for that work are:
- `docs/reference/service-json-reference.md`
- `docs/reference/SERVICE-JSON-COMPLETE-UNION-SCHEMA.md`
- `docs/reference/SERVICE-CONFIG-TYPES.md`
- `docs/reference/shared-runtime/SERVICE-MANAGER-BEHAVIOR.md`

## Repo boundary rule

Keep these docs here when they describe:
- general manifest schema
- shared runtime behavior
- provider/dependency semantics
- reusable service taxonomy
- cross-service/platform contract rules
- the split between `servicesRoot` and `workspaceRoot`

Keep docs in individual service repos when they describe:
- service-specific UI or runtime behavior
- service-specific migration notes
- service-specific route/page specs
- service-specific packaging quirks unless they generalize back into the core contract

## Service authoring entrypoint

Use [Create a New Lasso Service](development/new-lasso-service-guide.md) when creating or reviewing a new service repo.

That guide is the canonical handoff for:
- service ID and repo naming
- `@` prefix rules for core-owned services
- required release artifacts and artifact naming
- `service.json` artifact metadata
- service repo verification
- updating core, service-template, and reference-app inventories
- PR, merge, and branch archive hygiene

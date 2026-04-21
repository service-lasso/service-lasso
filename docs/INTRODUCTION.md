# Service Lasso Introduction

This document is the high-level introduction to what Service Lasso is, where it came from, what donor code it is based on, how that donor was analysed, and what the current `service-lasso` repo is actually trying to become.

It is meant to answer the questions:
- what are we building?
- where did it come from?
- what is donor/reference versus product code?
- what are the repo boundaries?
- what has already happened in the analysis and migration work?

## Short version

Service Lasso is a runtime and contract system for managing local services through a canonical per-service manifest (`service.json`), a runtime/service-manager core, and an API/control plane that can later be consumed by operator UI and other tooling.

The current `service-lasso` repository is the **core runtime and contract repo**.
It is not the admin UI repo, and it is not the service template repo.

## What Service Lasso is trying to be

At a high level, Service Lasso is intended to provide:
- service discovery from a managed services tree
- a canonical `service.json` contract per service
- lifecycle orchestration such as install, config, start, stop, restart, update, rollback, and uninstall
- provider/runtime delegation (for example `@node`, `@python`, and similar utility/runtime services)
- health, dependency, environment, port, state, and log handling
- a runtime/API layer that other tools and UIs can consume

The important architectural point is this:

**the runtime/service-manager core is the center of gravity**.

The UI is not the core. The UI should sit on top of the runtime/API.

## The current three-repo model

The Service Lasso work is intentionally split into three main repos:

### 1. `service-lasso`
Core runtime + canonical shared docs/contracts.

This repo should own:
- runtime/service-manager behavior
- shared manifest/runtime contract docs
- API/control-plane behavior
- migration of the donor runtime into a cleaner architecture

### 2. `service-template`
Canonical template for individual services.

This repo should own:
- example service structure
- example service manifest shape
- example verify/package/test structure
- the standard pattern for one service repo

### 3. `lasso-@serviceadmin`
Operator/admin UI.

This repo should own:
- the browser-facing operator UI
- pages and interactions for services/runtime/dependencies/logs/etc.
- UI consumption of the runtime/API

Important scope clarification:
- donor inline HTML/admin UI behavior is **not** the migration target for the core runtime
- only the main runtime/service-manager code is in scope for the donor-core migration

Post-core validation note:
- once the core runtime is execution-capable and Echo Service proves the runtime path, `lasso-@serviceadmin` should be used as the first real consumer repo for integration validation
- that validation should prove the admin UI can consume the current API/runtime behavior cleanly before broader reference app/template rollout

## Reference app templates after core

Once the core runtime is built and stable, Service Lasso should also provide reference app packages that showcase integration and give other teams a template starting point.

These reference apps are not the core runtime.
They are example consumers of the core runtime/API that prove the integration story and make adoption easier.

Planned reference app/template packages include:
- `@service-lasso/service-lasso-app-web`
- `@service-lasso/service-lasso-packager-node`
- `@service-lasso/service-lasso-app-tauri`
- `@service-lasso/service-lasso-bundled`

These should all consume the same canonical runtime model based on:
- `servicesRoot`
- `workspaceRoot`
## Runtime root model

The preferred runtime root model is now:
- `servicesRoot` = where the services live
- `workspaceRoot` = where Service Lasso stores runtime-managed working data

This is important because it lets Service Lasso:
- point at different service trees
- keep runtime-managed artifacts outside the service source tree
- run different configs/instances cleanly

At a high level:
- service-owned files stay under `servicesRoot`
- runtime-owned working data such as logs and run archives live under `workspaceRoot`

## Where Service Lasso came from

Service Lasso did not start from a blank sheet.
It started from analysis of an existing donor service-manager/runtime implementation.

## Original donor source repo

Primary donor source repo:
- `C:\projects\typerefinery-ai\typerefinery-develop`

The donor focus was the standalone service-manager/runtime logic and its managed `services/` tree.

## Donor reference copy used inside this repo

The local donor/reference material for this repo lives under:
- `ref\typerefinery-service-manager-donor\`

This folder is **reference input**, not product code.
It exists so the migration and reconciliation work can be done against a local frozen donor snapshot without pretending that copied donor files are already the new Service Lasso runtime.

## Main donor files that mattered

The most important donor runtime files were:
- `ref\typerefinery-service-manager-donor\runtime\ServiceManager.ts`
- `ref\typerefinery-service-manager-donor\runtime\Service.ts`
- `ref\typerefinery-service-manager-donor\runtime\Services.ts`
- `ref\typerefinery-service-manager-donor\runtime\Logger.ts`
- donor `services\*\service.json` files

Those donor files showed the real existing behavior for:
- service discovery
- manifest-driven runtime setup
- provider/runtime relationships
- dependency handling
- process supervision
- global environment propagation
- health checks
- logging and log archival
- runtime startup and standalone manager behavior

## Why donor analysis was necessary

The donor code had useful real behavior, but it was also heavily mixed.

The donor implementation mixed together concerns like:
- runtime orchestration
- service setup/install behavior
- process supervision
- health checks
- environment propagation
- logging
- ports and URLs
- standalone server/bootstrap behavior
- inline HTML/admin UI behavior

Because of that, the work here has **not** been "copy the donor and rename it".

Instead, the work has been:
1. inspect what the donor actually does
2. reconcile that with the decisions clarified in chat
3. separate donor evidence from speculative planning
4. migrate the important runtime behavior into a cleaner architecture

## Where the donor analysis is documented

The key analysis and reconciliation docs in the repo include:

### Canonical donor/runtime reconciliation
- `ref\typerefinery-service-manager-donor\QUESTION-LIST-AND-CODE-VALIDATION.md`

This is the main reconciled transcript + code-validation doc.
It records the canonical runtime-boundary questions and what was actually settled.

### Donor behavior review
- `ref\typerefinery-service-manager-donor\SERVICE-MANAGER-BEHAVIOR.md`

This explains what the donor manager/runtime actually does.

### Donor/project index
- `ref\typerefinery-service-manager-donor\DOCS-AND-PROJECT-INDEX.md`

This acts as the working index across donor docs, project split, and progress tracking.

### Refactor/migration thinking
- `ref\typerefinery-service-manager-donor\TS-FILE-REFACTOR-PLAN.md`

This documents how the donor TypeScript runtime was understood and how its responsibilities should be split more cleanly.

## Important donor-derived decisions that shaped Service Lasso

From transcript + donor analysis, several important directions were clarified.

### 1. `service.json` remains the canonical per-service manifest
One service, one repo, one canonical manifest.

### 2. Utility/runtime services stay in the same system
Services like `@node`, `@python`, `@archive`, and `@localcert` still belong to the same registry/runtime model, but with clearer service-role semantics.

### 3. `install` and `config` are distinct
These should not be collapsed into one vague setup blob.

### 4. Port negotiation belongs to the core runtime
Services declare needs; core owns resolution.

### 5. Shared runtime environment should be explicit and Service Lasso-controlled
The donor `globalenv` idea was meaningful, but it should be modelled explicitly and safely.

### 6. UI is not the core
The future admin/operator UI should consume the runtime/API rather than reusing donor inline HTML pages.

## What the current `service-lasso` repo contains today

Today this repo contains:
- governance/spec/backlog material
- donor/reference analysis under `ref/`
- canonical docs under `docs/`
- the first tracked core runtime source under `src/`
- direct tests under `tests/`
- tracked sample manifests under `services/`

## What the current source code already covers

The first bounded core slices added so far include:
- manifest discovery and validation
- service registry and dependency graph basics
- bounded lifecycle actions
- bounded health handling
- first `.state` persistence helpers
- operator data surfaces
- bounded provider planning
- bounded per-service runtime log archival and retention
- first API server layer

This is meaningful progress, but it is **not full donor runtime parity yet**.

## What has not been migrated yet

Major donor runtime behavior still remains to be migrated more fully, including:
- deeper process execution and supervision parity
- full setup/install mechanics such as archive extraction and setup commands
- fuller shared env/globalenv handling beyond the current bounded slice
- broader health/readiness flow beyond the current bounded slice
- fuller run-level `workspaceRoot` logging archival/retention implementation
- process/runtime metrics and broader manager/runtime parity

Important current boundary:
- the sibling `lasso-echoservice` harness can already simulate HTTP and TCP health targets for testing and demo hardening
- `service-lasso` runtime itself now implements bounded manifest health evaluation for `process`, `http`, `tcp`, `file`, and `variable`
- broader donor-health migration work still remains for readiness-loop behavior on top of those bounded checks

Again, that is why the repo should be read as:

**bounded core migration in progress, not finished runtime parity**

## What is product code versus reference code

This distinction matters a lot.

### Product code
Product code is the tracked code under areas like:
- `src/`
- `tests/`
- `services/`
- canonical docs in `docs/`

### Reference code
Reference/donor material is under:
- `ref\typerefinery-service-manager-donor\`

That donor area is there to inform decisions and migration work.
It should not be mistaken for already-migrated product code.

## What this repo is not

This repo is **not**:
- the final operator UI
- a copy of the donor app
- a place to preserve donor inline HTML/admin pages
- a monolithic everything-repo for every Service Lasso concern

It is specifically the **core runtime and contract repo**.

## Current companion docs to read next

After this introduction, the most useful next docs are:

### For current core source/layout
- `docs/development/core-runtime-layout.md`

### For the longer-term target structure
- `docs/development/core-runtime-dev-plan.md`

### For donor migration status
- `docs/development/core-runtime-migration-plan.md`

### For the demo-instance direction
- `docs/development/core-runtime-demo-instance-plan.md`

### For logging model
- `docs/development/core-runtime-logging-model.md`

### For storage split
- `docs/development/core-runtime-storage-model.md`

### For state-model clarification
- `docs/development/core-runtime-state-model-audit.md`

## Bottom line

Service Lasso is a runtime/service-manager system built around a canonical `service.json` model and a core runtime/API.

This repo, `service-lasso`, is the place where that **core runtime and contract layer** is being built.

It came from careful analysis of donor service-manager code in:
- `C:\projects\typerefinery-ai\typerefinery-develop`

with the local donor/reference copy kept under:
- `ref\typerefinery-service-manager-donor\`

The key ongoing work is to migrate the important donor runtime behavior into a cleaner architecture without dragging along the donor’s mixed UI/runtime shape.

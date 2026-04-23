# Core runtime migration plan

This document tracks migration of the donor service-manager/runtime code into the current `service-lasso` core runtime.

It is meant to answer a simple question clearly:

**what has already been migrated, what is only partially migrated, and what still remains from the donor runtime?**

Primary donor/runtime inputs for this plan:
- `ref/typerefinery-service-manager-donor/runtime/ServiceManager.ts`
- `ref/typerefinery-service-manager-donor/runtime/Service.ts`
- runtime-relevant parts of `ref/typerefinery-service-manager-donor/runtime/Services.ts`
- `ref/typerefinery-service-manager-donor/QUESTION-LIST-AND-CODE-VALIDATION.md`
- `ref/typerefinery-service-manager-donor/SERVICE-MANAGER-BEHAVIOR.md`

Related current-runtime docs:
- `docs/development/core-runtime-layout.md`
- `docs/development/core-runtime-dev-plan.md`
- `docs/development/core-runtime-demo-instance-plan.md`

## Purpose

The goal is **not** donor-copy parity for its own sake.

Scope rule for this document:
- **in scope:** donor runtime/service-manager core behavior
- **out of scope:** donor HTML pages, admin UI rendering, and browser-facing UI behavior

The goal is to:
- preserve the important runtime behaviors from the donor manager
- split those behaviors into a cleaner Service Lasso architecture
- keep visible track of what has actually landed versus what is still donor-only

Current preferred storage split:
- `servicesRoot` = service-owned trees and manifests
- `workspaceRoot` = Service Lasso runtime-managed working data

## Current overall migration status

Current status is best described as:

**partial migration of the runtime architecture, not full migration of donor runtime behavior**.

The current core repo has already migrated the first bounded foundations:
- manifest discovery and validation
- registry and dependency graph basics
- separate lifecycle action vocabulary
- bounded health/state model
- operator data surfaces
- bounded provider planning
- first API layer

But it has **not** yet migrated most of the heavy donor runtime behavior around execution, setup, environment propagation, orchestration, and process supervision.

## Migration status by area

## 1. Manifest discovery and runtime contract

### Migrated
- canonical `service.json` discovery from `services/`
- manifest loading + validation
- tracked sample manifests in the repo
- basic service identity fields and first provider/dependency fields

### Partially migrated
- only the currently-needed contract fields are supported cleanly in the new runtime
- the broader donor manifest/runtime surface is not yet carried over fully

### Not yet migrated
- full donor manifest parity
- richer action override behavior
- broader runtime/execution field handling such as donor-style command parsing and platform-specific execution nuances

## 2. Registry and dependency model

### Migrated
- in-memory service registry
- dependency graph basics
- explicit service dependency lookup
- service detail/runtime/dependencies API surfaces

### Partially migrated
- provider dependency handling exists only in the first bounded planning form
- dependency semantics are represented, but not yet enforced at donor-runtime depth

### Not yet migrated
- donor-style dependency wait/readiness orchestration
- broader dependency gating during actual startup
- richer sorting/start-order semantics tied to full runtime behavior

## 3. Lifecycle vocabulary and service state transitions

### Migrated
- explicit bounded actions for:
  - `install`
  - `config`
  - `start`
  - `stop`
  - `restart`
- clear ordered action tests
- API endpoints for those actions

### Partially migrated
- lifecycle is currently state-model first, not execution-model first
- the action names are there, but the heavy donor mechanics behind them are not

### Not yet migrated
- `uninstall`
- `update`
- `rollback`
- donor-style utility/setup completion semantics
- actual execution-backed lifecycle transitions

## 4. Health model

### Migrated
- `process` health
- `http` health
- runtime/service health responses

### Partially migrated
- health results are currently bounded and intentionally simple
- they prove the shape, not donor-depth parity

### Not yet migrated
- `tcp` health
- `file` health
- `variable` health
- donor-style readiness waiting loops and richer start/health transition behavior

## 5. State persistence

### Migrated
- structured `.state` path model
- read/write helpers
- test proof that lifecycle actions write state files

### Partially migrated
- the persistence model exists, but startup rehydration and deeper operational use are still thin

### Not yet migrated
- full runtime rehydration from persisted state
- richer structured state areas beyond the current bounded slice
- donor-style PID/runtime/process evidence folded into the persistent model

## 6. Provider/runtime execution model

### Migrated
- explicit provider boundary
- bounded provider planning for:
  - direct execution
  - `@node`
  - `@python`
- provider metadata in API responses

### Partially migrated
- provider handling is currently a planning/resolution layer, not full runtime execution

### Not yet migrated
- real provider-backed spawning/execution
- broader provider catalog parity such as donor utility/runtime services beyond the current bounded set
- runtime-provider CLI variants and richer execservice behavior

## 7. Process supervision and execution

### Migrated
- almost none of the donor process supervision layer itself

### Partially migrated
- lifecycle and provider planning give the shape needed for later execution work

### Not yet migrated
- actual child-process spawning
- stop/kill/restart process control
- exit handling / ignore-exit-error behavior
- PID tracking
- process-tree tracking
- memory/process metrics
- stdout/stderr runtime piping behavior

This is one of the largest unmigrated areas.

## 8. Setup and install mechanics

### Migrated
- the conceptual split between `install` and `config`
- bounded lifecycle state for those actions

### Partially migrated
- the action names and state transitions are there, but not the donor execution mechanics

### Not yet migrated
- archive extraction
- setup command execution
- config materialization behavior
- donor-style install/setup entanglement refactored into the cleaner future model

This is another major unmigrated area.

## 9. Port management and URL/runtime exposure

### Migrated
- basic surfaced network/operator data from manifests
- dependency-facing and operator-facing endpoint visibility in API outputs

### Partially migrated
- the shape of network exposure exists, but not the actual runtime-owned negotiation model

### Not yet migrated
- port reservation
- port negotiation
- collision handling
- stable runtime assignment policy
- donor-style serviceport/secondary/console/debug orchestration

## 10. Shared environment model

### Migrated
- basic per-service manifest env representation

### Partially migrated
- the architecture already leaves room for an explicit env layer later

### Not yet migrated
- donor-style merged `globalenv`
- export/import propagation across services
- precedence and visibility rules in running orchestration
- pushback of merged globals into managed services

## 11. Runtime orchestration and manager behavior

### Migrated
- basic runtime startup around the current API server
- bounded load of the service model per request

### Partially migrated
- the new repo has a cleaner architectural split, but the real runtime-manager behavior is still thin

### Not yet migrated
- manager-level `reload`
- `startAll`
- `stopAll`
- autostart behavior
- donor-style startup ordering at runtime depth
- dependency wait/readiness loops
- callback/event-driven runtime coordination model

## 12. Runtime server/bootstrap behavior

### Migrated
- first JSON API server for the core runtime
- first bounded runtime startup path

### Partially migrated
- only the runtime-relevant bootstrap/server responsibilities from donor `Services.ts` have started to be split out

### Not yet migrated
- fuller standalone runtime server/bootstrap parity where it affects main runtime behavior
- signal-handling completeness around managed runtime behavior
- cleaner runtime bootstrap/orchestration boundaries that replace the donor monolith

Note:
- donor HTML/admin page behavior is intentionally out of scope for this migration plan

## 13. Logging behavior

Logging should ultimately target `workspaceRoot`, not ad hoc guessed paths under individual service roots unless a specific per-service ownership rule requires it.

### Migrated
- basic operator log data surfaces in API output

### Partially migrated
- logs are currently represented as operator data, not managed runtime log streams

### Not yet migrated
- donor-style log files and rolling runtime stdout/stderr behavior
- log archival behavior
- old-log cleanup behavior
- full runtime log plumbing

## What this means in practice

The current repo should be understood as:
- **successful migration of the first clean architectural slices**, and
- **not yet a full transplant of donor service-manager behavior**.

That is actually a healthy place to be, because the donor runtime was heavily mixed and needed splitting, but it does mean we should not overclaim runtime parity yet.

## Recommended migration order from here

If the goal is to continue migration in the most useful order, the next sequence should be:

1. **Execution-backed demo path**
   - make one demo service truly runnable through the current runtime shape
   - prove install/config/start/stop against something real

2. **Setup/install mechanics**
   - bring over archive/setup/config materialization behavior in a cleaner split

3. **Process supervision layer**
   - spawn, stop, PID/process tracking, exit handling

4. **Port negotiation layer**
   - move from surfaced manifest fields to real runtime-owned port assignment

5. **Shared env/globalenv layer**
   - explicit controlled export/import model across services

6. **Broader health and readiness model**
   - `tcp`, `file`, `variable`, readiness waits

7. **Runtime-manager orchestration**
   - reload, startAll, stopAll, autostart, dependency waits

8. **Broader provider parity**
   - additional provider/runtime classes once the execution layer is real

## Priority summary

### Highest-value next migration work
- setup/install mechanics
- process supervision
- real execution-backed lifecycle behavior
- port negotiation

### Medium-priority follow-on work
- `globalenv`
- broader health types
- orchestration/reload/autostart

### Lower-priority or intentionally reshaped work
- none listed here, because donor UI/HTML behavior is out of scope for this migration plan

## Success bar for calling the donor service-manager "mostly migrated"

We can reasonably call the donor service-manager mostly migrated when the core repo has:
- real execution-backed lifecycle behavior
- setup/install mechanics beyond state-only transitions
- real process supervision
- runtime-owned port handling
- explicit shared env/globalenv behavior
- broader health and readiness checks
- manager-level orchestration (`reload`, `startAll`, `stopAll`)

Until then, the honest label remains:

**bounded core migration complete, donor runtime parity not yet complete**.

# Core runtime comprehensive review

This document consolidates the findings and analysis produced so far across:
- comprehensive repo documentation review
- donor runtime to current spec/code coverage analysis
- current automated verification evidence

It is intended to be the single place to answer:

**what is implemented, what is not, where the docs are accurate, where they drift, and what the current test evidence actually proves**

## Review basis

The analysis in this document was based on:
- current tracked code under `src/`
- current automated tests under `tests/`
- current docs under `docs/`
- current governance/spec files under `.governance/`
- donor/reference runtime code under `ref/typerefinery-service-manager-donor/runtime/`

## Review assumptions

These assumptions were used consistently throughout the review:

- current code is the source of truth for implemented behavior
- `docs/INTRODUCTION.md` plus the active spec define intended direction
- donor material under `ref/` is valid reference evidence, but not product code
- `README.md`, `docs/`, and the active governance/spec files all count as project documentation and source-of-truth material

## Verification evidence

Automated verification was run during the review:

- command: `npm test`
- result: `67 passed, 0 failed`

What that test run directly proves:
- API startup
- manifest discovery
- manifest validation failure handling
- registry/dependency graph basics
- lifecycle ordering and guardrails
- state writes
- bounded `process`, `http`, `tcp`, `file`, and `variable` health behavior
- bounded readiness wait-loop behavior
- runtime summary behavior
- operator logs/variables/network surfaces
- provider resolution and provider-backed response payloads
- bounded install/config materialization
- bounded `globalenv` propagation
- bounded port negotiation
- bounded orchestration for `startAll`, `stopAll`, `reload`, and `autostart`
- bounded per-service runtime-log archival and retention
- bounded process/runtime metrics

What that test run does **not** prove:
- full donor-depth process supervision parity
- archive/setup mechanics
- broader donor parity

## Executive summary

The current `service-lasso` repo is no longer bootstrap-only. It has a real bounded core runtime slice with direct test coverage.

That bounded slice is real and meaningful:
- standalone runtime entrypoint
- manifest discovery and validation
- service registry and dependency graph basics
- bounded lifecycle actions
- bounded health handling
- per-service `.state` writes
- operator data surfaces
- provider planning/resolution
- first API server layer

But the project is **not** at donor runtime parity.

The largest remaining gaps are:
- real process spawning and supervision
- setup/install execution mechanics
- broader health/provider/runtime parity beyond the current bounded slice
- broader manager/runtime parity beyond the current bounded orchestration slice
- fuller run-level `workspaceRoot` logging/archival implementation
- donor-depth process-tree/runtime telemetry

Separately, the documentation set has important drift issues:
- canonical manifest docs are broader than the runtime really supports
- some core planning/spec docs still describe a pre-implementation phase
- `workspaceRoot` direction is presented too much like current reality
- the package-architecture plan presents future package/CLI targets too much like current repo shape
- several reference docs point to missing companion docs
- the demo-instance plan can overclaim credibility without real execution proof

## Comprehensive findings

## 1. Canonical `service.json` docs overstate the implemented contract

Severity:
- High

Summary:
- the repo’s canonical `service.json` docs define a contract far larger than the runtime actually accepts today

Why this matters:
- contributors following the canonical docs can author manifests the current runtime cannot parse
- that creates source-of-truth confusion in the area the repo says is canonical

Key evidence:
- `docs/README.md` names the reference set as source of truth for the general manifest contract
- `docs/reference/service-json-reference.md` presents `actions` and `execconfig` as current canonical direction
- the implemented manifest type and validator only support a much smaller top-level schema

Relevant files:
- `docs/README.md`
- `docs/reference/service-json-reference.md`
- `docs/reference/SERVICE-JSON-COMPLETE-UNION-SCHEMA.md`
- `src/contracts/service.ts`
- `src/runtime/discovery/validateManifest.ts`

Current reality:
- current runtime accepts a bounded manifest shape with top-level fields such as:
  - `id`
  - `name`
  - `description`
  - `version`
  - `enabled`
  - `depend_on`
  - `healthcheck`
  - `env`
  - `urls`
  - `execservice`
  - `executable`
  - `args`

Not currently accepted by the runtime as documented in canonical reference docs:
- `actions`
- `execconfig`
- `logoutput`
- `servicetype`
- `servicelocation`
- `globalenv`
- `commandline`
- `setuparchive`
- many broader donor-derived fields

Judgment:
- the current canonical manifest docs are ahead of the implementation and should be described as future/reference direction, not current supported contract

## 2. Several governing/current-state docs are stale about the project phase

Severity:
- High

Summary:
- several core planning/spec docs still read like the repo has not yet implemented the bounded runtime slice

Why this matters:
- it weakens governance traceability
- it makes it harder to tell what is already done versus what is still planned
- it creates confusion when a contributor tries to pick the next real task

Key evidence:
- the active spec still says the repo has no tracked runtime implementation yet
- the development plan still frames `src/server/index.ts` and the first API routes as future work
- the top-level README layout summary is also stale

Relevant files:
- `.governance/specs/SPEC-002-core-standalone-runtime.md`
- `docs/development/core-runtime-dev-plan.md`
- `README.md`
- `src/server/index.ts`

Judgment:
- the implementation is ahead of the spec/dev-plan wording
- these docs need a current-state refresh so they describe the bounded slice honestly

## 3. `workspaceRoot` direction is not clearly separated from current implementation

Severity:
- Medium

Summary:
- the newer storage/logging docs present `workspaceRoot` as the current preferred runtime-root model, but the current runtime has not adopted that model yet

Why this matters:
- the future direction itself is reasonable
- the problem is that the docs do not consistently separate:
  - current implemented model
  - target model

Key evidence:
- `docs/INTRODUCTION.md` says the preferred runtime root model is now `servicesRoot` plus `workspaceRoot`
- `docs/README.md` repeats that as the current preferred model
- actual runtime root types still expose `dataRoot` and `stateRoot`
- runtime logs now use a bounded service-local runtime path in current code and tests rather than the broader `workspaceRoot` run layout described in the design docs

Relevant files:
- `docs/INTRODUCTION.md`
- `docs/README.md`
- `docs/development/core-runtime-storage-model.md`
- `docs/development/core-runtime-logging-model.md`
- `src/contracts/service-root.ts`
- `src/runtime/layout.ts`
- `src/runtime/operator/logs.ts`
- `tests/operator-data.test.js`

Judgment:
- this should be documented explicitly as target architecture rather than current implemented runtime behavior

## 4. The package-architecture plan overstates future package shape as near-current reality

Severity:
- Medium

Summary:
- the package-architecture doc is directionally useful, but it presents target package/CLI entrypoints and package API examples without clearly marking them as not yet implemented

Why this matters:
- it can mislead contributors about what package boundaries, entrypoints, and CLI surfaces already exist
- it also introduces a package API shape that does not line up cleanly with the currently documented `servicesRoot` and `workspaceRoot` direction

Key evidence:
- the doc refers to built/runtime entrypoints such as `node dist/runtime/server.js`
- it defines a package bin at `./dist/cli.js`
- it gives a `createRuntime({ root, servicesPath, port })` example and a monorepo `packages/*` split
- none of those paths or entrypoints exist in the current repo
- the current package still runs through `dist/index.js`

Relevant files:
- `docs/development/core-runtime-package-architecture.md`
- `package.json`
- `src/index.ts`
- `docs/INTRODUCTION.md`
- `docs/development/core-runtime-storage-model.md`
- `.governance/project/BACKLOG.md`

Judgment:
- this doc should be framed explicitly as target architecture and should state how it relates to the current `servicesRoot`/`workspaceRoot` direction before it is treated as planning source of truth

## 5. The reference set has broken or missing companion-doc links

Severity:
- Medium

Summary:
- several reference docs point to companion docs/files that are not present in this repository

Why this matters:
- it makes the reference section harder to trust
- it breaks the reading trail in the area the repo calls canonical documentation

Examples:
- `docs/reference/service-json-reference.md` points to missing broader template docs
- `docs/reference/shared-runtime/SERVICE-MANAGER-BEHAVIOR.md` lists related docs that do not exist in this checkout
- `docs/reference/SERVICE-JSON-COMPLETE-UNION-SCHEMA.md` claims value-catalog companions that are not present

Relevant files:
- `docs/reference/service-json-reference.md`
- `docs/reference/shared-runtime/SERVICE-MANAGER-BEHAVIOR.md`
- `docs/reference/SERVICE-JSON-COMPLETE-UNION-SCHEMA.md`

Judgment:
- these links should either be removed, rewritten, or replaced with existing local docs

## 6. The demo-instance plan still needs a clearer execution-backed success bar

Severity:
- Medium

Summary:
- the demo-instance plan still needs to distinguish bounded execution-backed proof from broader donor-parity claims

Why this matters:
- the runtime now has a bounded real execution path, so the demo should explicitly use that stronger proof
- without a clearer bar, contributors can still confuse “bounded working demo” with “broader donor-runtime parity”

Key evidence:
- the demo success bar only requires lifecycle/state/health proof
- the runtime now includes a bounded execution supervisor and persisted runtime metadata
- broader donor runtime gaps still remain outside the demo slice

Relevant files:
- `docs/development/core-runtime-demo-instance-plan.md`
- `docs/development/core-runtime-migration-plan.md`
- `src/runtime/lifecycle/actions.ts`
- `src/runtime/health/evaluateHealth.ts`

Judgment:
- the demo plan should explicitly distinguish:
  - bounded state-model demo
  - execution-backed demo

## 7. Current code covers the bounded first runtime slice, not the full donor runtime

Severity:
- High

Summary:
- current code and tests do cover the bounded first runtime slice
- current code does not cover the full donor runtime behavior

Why this matters:
- this is the main reality check for planning and claims of progress

Judgment:
- bounded first-slice coverage: mostly yes
- full donor runtime coverage: no

## Donor to spec to code analysis

## What is covered in the current bounded slice

These donor/runtime concerns are meaningfully represented in the current code and tests:

- standalone runtime entrypoint and bounded API server
- manifest discovery from `services/*/service.json`
- manifest parsing/validation for the current bounded schema
- in-memory service registry and dependency graph basics
- bounded lifecycle actions for `install`, `config`, `start`, `stop`, and `restart`
- one bounded real execution/supervision path for directly executable services
- bounded provider-backed execution through `@node`
- bounded health handling for `process`, `http`, `tcp`, `file`, and `variable`
- bounded readiness wait loops
- bounded manifest-driven `globalenv`
- bounded runtime-owned port negotiation
- bounded install/config materialization
- structured per-service `.state` writes
- bounded manager-level orchestration for `startAll`, `stopAll`, `reload`, and `autostart`
- operator data surfaces for logs, variables, and network
- bounded process/runtime metrics
- provider relationship resolution/planning for direct, `@node`, and `@python`
- direct automated verification for the implemented slice

## What is partially covered

These donor/runtime concerns are represented directionally, but not at donor depth:

- dependency behavior
  - current code models dependencies, exposes them via API, and performs bounded dependency-aware startup ordering with readiness waits
  - donor code still goes broader with deeper recursive orchestration and manager parity

- lifecycle behavior
  - current code now proves bounded execution-backed lifecycle work for direct and one provider-backed path
  - donor code still goes broader with deeper supervision and action breadth

- health model
  - current code supports `process`, `http`, bounded `tcp`, bounded `file`, and bounded `variable`
  - donor code still extends that into readiness waiting loops
  - the sibling `lasso-echoservice` harness provides direct integration proof for the bounded `tcp`, `file`, and `variable` slices

- provider/runtime behavior
  - current code resolves provider relationships and executes through one bounded provider-managed path
  - donor code still goes broader with fuller provider/runtime parity

- logging
  - current code now captures bounded managed stdout/stderr into runtime-owned per-service log files, archives prior per-service runs on the next managed start, retains a bounded recent archive set, and exposes recent output plus archive metadata through the API
  - donor code still goes broader with run-level logging, archival, and retention behavior

- state model
  - current code writes the first structured `.state/` slice
  - donor code includes PID/runtime/process evidence and startup recovery concerns not yet implemented here

- process/runtime telemetry
  - current code exposes bounded launch, termination, duration, and log-count metrics
  - donor code still goes broader with process-tree stats, memory telemetry, and richer runtime evidence

## What is not covered yet

These major donor/runtime behaviors are not implemented in the current code:

- full donor-depth stop/kill/restart control over managed processes
- exit handling and `ignoreexiterror`
- PID file management as a real runtime concern
- donor-depth process-tree tracking and runtime telemetry
- archive extraction via `setuparchive`
- command-driven setup/install pipeline
- donor-depth runtime-owned port reservation/reassignment beyond the bounded negotiated slice
- broader shared `globalenv` export/import parity beyond the bounded merged-env slice
- broader health behavior beyond bounded `process`, `http`, `tcp`, `file`, and `variable`
- dependency readiness loops and start-chain orchestration
- fuller run-level `workspaceRoot` logging, archival, and retention implementation

## Major donor behavior areas

## 1. Discovery and manifest loading

Donor behavior:
- `ServiceManager` scans for `*/service.json`
- parses configs
- builds service objects

Current status:
- covered in the bounded slice

## 2. Standalone runtime entrypoint

Donor behavior:
- `Services.ts` starts the standalone manager process
- sets up runtime logging
- optionally triggers `startAll`
- exposes a server/UI surface

Current status:
- partially covered

Current implementation covers:
- standalone runtime entrypoint
- bounded API server startup
- bounded `startAll`, `stopAll`, `reload`, and `autostart`

Current implementation does not yet cover:
- donor manager orchestration depth
- donor admin/UI surface

## 3. Registry and dependency graph

Donor behavior:
- discovery becomes a managed runtime registry
- dependency relationships influence startup
- `execservice` also acts as a dependency edge

Current status:
- partially covered

## 4. Lifecycle actions

Donor behavior:
- lifecycle is execution-backed
- install/setup/start/stop/restart interact with real runtime state

Current status:
- partially covered

Current implementation covers:
- bounded lifecycle state transitions
- sequencing guardrails
- bounded execution-backed lifecycle behavior for direct and one provider-backed path
- bounded install/config materialization

Current implementation does not yet cover:
- broader actions such as uninstall/update/rollback/reset

## 5. Health behavior

Donor behavior:
- `http`
- `tcp`
- `file`
- `variable`
- readiness participation in startup

Current status:
- partially covered

Current implementation covers:
- `process`
- `http`
- bounded `tcp`
- bounded `file`
- bounded `variable`
- bounded readiness wait loops

Related current harness capability:
- the released `lasso-echoservice` binary already exposes TCP health simulation endpoints and controls
- released Echo Service artifacts also provide a real file target through the harness state file
- released Echo Service artifacts also provide a manifest-backed variable source through harness env
- `service-lasso` can use that harness today as an integration target and now evaluates bounded manifest `healthcheck.type = tcp`, `healthcheck.type = file`, and `healthcheck.type = variable`
- broader donor health parity still remains open beyond that bounded slice

## 6. Setup and install mechanics

Donor behavior:
- archive extraction
- setup-state markers
- setup command execution
- provider-aware setup behavior

Current status:
- partially covered

Current implementation covers:
- bounded install/config file materialization on disk
- persisted install/config artifact metadata for rerunnable config generation

Current implementation does not yet cover:
- archive extraction
- command-driven setup/install execution depth
- provider-aware setup parity beyond the bounded file-materialization slice

## 7. Process supervision

Donor behavior:
- process spawn
- PID tracking
- stop/kill behavior
- process completion handling
- process-tree stats

Current status:
- partially covered

Current implementation covers:
- one bounded child-process supervision path
- bounded provider-backed execution through one provider path
- deterministic termination evidence and runtime-owned log capture

Current implementation does not yet cover:
- process-tree statistics
- fuller donor runtime supervision depth

## 8. Port negotiation

Donor behavior:
- service ports are reserved and resolved at runtime
- collisions are handled
- replacement ports can be assigned

Current status:
- partially covered

Current implementation covers:
- bounded manifest-driven port declarations
- deterministic runtime-owned port negotiation during config/start
- bounded collision handling and resolved network/operator surfaces

Current implementation does not yet cover:
- donor-depth replacement/reassignment semantics beyond the bounded negotiated slice

## 9. Shared environment model

Donor behavior:
- services can emit `globalenv`
- manager merges global env
- merged env is pushed back into services

Current status:
- partially covered

Current implementation covers:
- bounded manifest-driven `globalenv` emission
- deterministic merged shared env exposure through the API
- shared env injection into managed service execution and variable-health resolution

Current implementation does not yet cover:
- broader cross-service export/import behavior beyond the current bounded merged-env slice

## 10. Logging and archival

Donor behavior:
- manager and service log files
- per-run logging directories
- log archival
- old-log cleanup

Current status:
- partially covered

Current implementation covers:
- bounded managed stdout/stderr capture into runtime-owned per-service log files
- bounded per-service runtime-log archival on the next managed start
- bounded per-service archive retention pruning with API-visible archive metadata

Current docs define a preferred future model:
- `docs/development/core-runtime-logging-model.md`

Current implementation does not yet realize the broader run-level `workspaceRoot` model described there.

## SPEC-002 coverage judgment

`SPEC-002` is a bounded first-runtime spec, not a donor-parity spec.

Against that bounded intent, the current code is mostly aligned with the core scope:
- tracked source tree exists
- a runnable runtime entrypoint exists
- manifest discovery/parsing exists
- direct automated verification exists
- docs broadly distinguish implemented behavior from donor/reference-only behavior

However, `SPEC-002` itself is stale in wording.

Examples:
- it still says the repo had no tracked runtime implementation yet
- it still reads like pre-implementation planning rather than post-slice reality

So:
- the implementation is ahead of the spec wording
- the spec should be refreshed

## Documentation health summary

## Healthy and directionally useful docs

These docs are still broadly useful and aligned directionally:
- `docs/INTRODUCTION.md`
- `docs/development/core-runtime-layout.md`
- `docs/development/core-runtime-migration-plan.md`
- `docs/development/core-runtime-state-model-audit.md`
- `docs/development/core-runtime-storage-model.md`
- `docs/development/core-runtime-logging-model.md`

## Docs needing the highest-priority cleanup

Highest priority:
- `.governance/specs/SPEC-002-core-standalone-runtime.md`
- `docs/development/core-runtime-dev-plan.md`
- `docs/development/core-runtime-package-architecture.md`
- `README.md`
- `docs/reference/service-json-reference.md`
- `docs/reference/SERVICE-JSON-COMPLETE-UNION-SCHEMA.md`
- `docs/README.md`
- `docs/development/core-runtime-demo-instance-plan.md`

## Current trustworthy project label

The most accurate current project label is:

**bounded core runtime slice implemented, donor parity not yet complete**

That label is supported by:
- current code
- current tests
- current migration analysis

## Recommended next actions

## Documentation actions

1. Refresh `SPEC-002` so it reflects the implemented bounded slice honestly.
2. Refresh `core-runtime-dev-plan.md` so completed steps are no longer framed as future work.
3. Refresh the top-level `README.md` current-layout section.
4. Reclassify the larger `service.json` reference docs as future/reference direction unless and until the runtime supports that broader contract.
5. Fix or remove broken companion-doc links in `docs/reference`.
6. Clarify `workspaceRoot` as target architecture unless and until the runtime adopts it.
7. Rework `core-runtime-package-architecture.md` so it clearly distinguishes current repo shape from target package architecture and aligns with the current runtime-root direction.
8. Tighten the demo-instance success bar so it cannot overclaim execution credibility.

## Runtime/product actions

1. Choose the next bounded major migration unit explicitly.
2. Prefer one of these as the next execution item:
   - demo-instance hardening
   - deeper supervision parity
   - `lasso-@serviceadmin` integration validation
   - package-boundary/reference-app follow-through

## Final judgment

The current answer to "where are we really up to?" is:

- the repo has a real bounded implementation
- the tests give direct proof for that bounded slice
- the donor runtime remains much broader than current code
- several docs still blur current reality and future direction

So the key discipline going forward should be:

- keep claims of current behavior tied to current code and tests
- keep donor-derived and future-direction material clearly labeled as future or provisional

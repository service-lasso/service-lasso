# Core runtime donor/spec/code coverage audit

This document records the findings from a focused coverage audit across:
- donor runtime code under `ref/typerefinery-service-manager-donor/runtime/`
- the active bounded product spec in `.governance/specs/SPEC-002-core-standalone-runtime.md`
- the current tracked implementation under `src/`
- the current automated test suite under `tests/`

It exists to answer a practical question clearly:

**how much of the donor runtime is actually covered by the current spec and code, and what still remains outside the current bounded slice?**

## Evidence used

Primary donor inputs reviewed:
- `ref/typerefinery-service-manager-donor/runtime/ServiceManager.ts`
- `ref/typerefinery-service-manager-donor/runtime/Service.ts`
- `ref/typerefinery-service-manager-donor/runtime/Services.ts`

Primary current-repo inputs reviewed:
- `.governance/specs/SPEC-002-core-standalone-runtime.md`
- `src/`
- `tests/`
- relevant runtime/design docs under `docs/development/`

Verification run used for this audit:
- `npm test`
- result: `67 passed, 0 failed`

## Bottom line

The current `service-lasso` codebase **does cover the bounded first runtime slice** that `SPEC-002` was intended to establish.

It does **not** cover the full donor runtime behavior.

The donor runtime is substantially broader in the following areas:
- real process spawning and supervision
- setup/archive extraction mechanics
- runtime-owned port negotiation
- shared `globalenv` propagation
- broader health/readiness models
- broader manager/runtime parity beyond the current bounded orchestration slice
- richer logging, archival, and runtime metrics

So the honest project label remains:

**bounded core runtime slice implemented; donor parity not yet complete**

## Coverage summary

### Covered in the current bounded slice

These donor/runtime concerns are meaningfully represented in the current code and tests:

- standalone runtime entrypoint and bounded API server
- manifest discovery from `services/*/service.json`
- manifest parsing/validation for the current bounded schema
- in-memory service registry and dependency graph basics
- bounded lifecycle actions for `install`, `config`, `start`, `stop`, and `restart`
- one bounded real execution/supervision path for directly executable services
- bounded health handling for `process`, `http`, `tcp`, `file`, and `variable`
- structured per-service `.state/` writes
- bounded manager-level orchestration for `startAll`, `stopAll`, `reload`, and `autostart`
- operator data surfaces for logs, variables, and network
- provider relationship resolution/planning for direct, `@node`, and `@python`
- direct automated verification for the implemented slice

### Partially covered

These donor/runtime concerns are represented directionally, but not at donor depth:

- dependency behavior
  - current code models dependencies and exposes them via API
  - donor code also performs dependency startup/wait orchestration
- lifecycle behavior
  - current code proves lifecycle state transitions
  - donor code performs execution-backed lifecycle work
- health model
  - current code supports `process`, `http`, bounded `tcp`, bounded `file`, and bounded `variable`
  - donor code also supports readiness waiting loops
- provider/runtime behavior
  - current code resolves provider relationships and command previews
  - donor code actually executes through provider/runtime services
- logging
  - current code captures bounded managed stdout/stderr into runtime-owned per-service log files, archives prior per-service runs on the next managed start, retains a bounded recent archive set, and exposes recent output plus archive metadata through the API
  - donor code still goes broader with run-level logging, archival, and retention behavior
- process/runtime metrics
  - current code now persists bounded launch, termination, and duration counters and exposes those plus live log-count metrics through API/operator surfaces
  - donor code still goes broader with process-tree stats, memory metrics, and fuller runtime telemetry
- state model
  - current code writes the first structured `.state/` slice
  - donor code includes PID/runtime/process evidence and startup recovery concerns not yet implemented here

### Not covered yet

These major donor/runtime behaviors are not implemented in the current code:

- full donor-depth stop/kill/restart control over managed processes
- exit handling and `ignoreexiterror` behavior
- PID file management as a real runtime contract
- donor-depth process-tree tracking and memory/process metrics
- archive extraction via `setuparchive`
- command-driven setup/install pipeline
- runtime-owned port reservation, collision handling, and reassignment
- `globalenv` export/import propagation across services
- broader health behavior beyond bounded `process`, `http`, `tcp`, `file`, and `variable`
- dependency readiness loops and start-chain orchestration
- fuller run-level `workspaceRoot` logging, archival, and retention implementation

## Donor-to-current mapping

## 1. Discovery and manifest loading

### Donor behavior
- `ServiceManager` scans for `*/service.json`
- parses configs
- builds service objects from those configs

### Current status
- covered in the current bounded slice

Current implementation covers:
- discovery from a configured services root
- manifest validation
- loading discovered services into registry/graph models

## 2. Standalone runtime entrypoint

### Donor behavior
- `Services.ts` starts the standalone service-manager process
- sets up runtime logging
- optionally triggers `startAll`
- exposes a server/UI surface

### Current status
- partially covered

Current implementation covers:
- standalone runtime entrypoint
- bounded API server startup
- bounded `startAll`, `stopAll`, `reload`, and `autostart` orchestration

Current implementation does not yet cover:
- donor-style standalone manager orchestration
- signal-driven managed shutdown behavior for running child services
- donor admin/UI surface

## 3. Registry and dependency graph

### Donor behavior
- service discovery becomes a managed runtime registry
- dependency relationships influence startup flow
- `execservice` also acts as a dependency edge

### Current status
- partially covered

Current implementation covers:
- service registry
- dependency graph modeling
- API exposure of dependencies/dependents
- dependency-aware startup ordering
- bounded readiness-aware dependency startup

Current implementation does not yet cover:
- recursive start-chain handling

## 4. Lifecycle actions

### Donor behavior
- lifecycle is execution-backed
- install/setup/start/stop/restart interact with real process/runtime state

### Current status
- partially covered

Current implementation covers:
- bounded lifecycle state transitions
- explicit action ordering
- action error handling for invalid sequencing
- one bounded real execution/supervision path for directly executable services
- bounded provider-backed execution through `@node`
- bounded install/config materialization with persisted artifact metadata

Current implementation does not yet cover:
- uninstall/update/rollback/reset semantics
- donor-style setup/install completion semantics

## 5. Health behavior

### Donor behavior
- health checks support multiple types
- health participates in startup readiness

### Current status
- partially covered

Current implementation covers:
- default `process` health
- bounded `http` health checks
- bounded `tcp` health checks
- bounded `file` health checks
- bounded `variable` health checks
- bounded readiness wait loops tied to actual startup

Related current test-harness note:
- the sibling `lasso-echoservice` repo already exposes TCP health simulation endpoints and controls for integration testing
- that harness capability is now paired with bounded `service-lasso` runtime support for manifest `healthcheck.type = tcp`
- released Echo Service artifacts now also provide direct proof for bounded `service-lasso` runtime support for manifest `healthcheck.type = file`
- released Echo Service artifacts now also provide direct proof for bounded `service-lasso` runtime support for manifest `healthcheck.type = variable`
- broader donor health parity still remains open beyond that bounded slice

## 6. Setup and install mechanics

### Donor behavior
- archive extraction
- setup-state markers
- setup command execution
- provider/runtime-aware setup behavior

### Current status
- partially covered

Current implementation covers:
- the conceptual split between `install` and `config`
- bounded install/config file materialization on disk
- persisted install/config artifact metadata for rerunnable config generation

Current implementation does not yet cover:
- archive extraction
- command-driven setup/install execution depth
- provider-aware setup parity beyond the bounded file-materialization slice

## 7. Process supervision

### Donor behavior
- process spawn
- PID tracking
- stop/kill behavior
- process completion handling
- process-tree statistics

### Current status
- partially covered

Current implementation covers:
- one bounded child-process supervision path
- PID/runtime metadata persistence
- stop handling and exit observation for directly executable services
- bounded provider-backed execution through one provider path
- deterministic lifecycle termination evidence and runtime-owned log capture

Current implementation does not yet cover:
- process-tree statistics
- fuller donor runtime supervision depth

## 8. Port negotiation

### Donor behavior
- service ports are reserved and resolved at runtime
- collisions are handled
- replacement ports can be assigned

### Current status
- partially covered

Current implementation covers:
- bounded manifest-driven port declarations
- deterministic runtime-owned port negotiation during config/start
- bounded collision handling and resolved network/operator surfaces

Current implementation does not yet cover:
- donor-depth replacement/reassignment semantics beyond the bounded negotiated slice

## 9. Shared environment model

### Donor behavior
- services can emit `globalenv`
- manager merges shared env
- merged env is pushed back into services

### Current status
- partially covered

Current implementation covers:
- bounded manifest-driven `globalenv` emission
- deterministic merged shared env exposure through the API
- shared env injection into managed service execution and variable-health resolution

Current implementation does not yet cover:
- broader cross-service export/import behavior beyond the current bounded merged-env slice

## 10. Logging and archival

### Donor behavior
- manager and service log files
- per-run logging directories
- log archival
- old-log cleanup

### Current status
- partially covered

Current code covers:
- bounded managed stdout/stderr capture for supervised processes
- bounded API log surfaces backed by captured process output
- persisted runtime log-path state for managed services
- bounded per-service runtime-log archival on the next managed start
- bounded per-service archive retention pruning with API-visible archive metadata
- bounded persisted launch/termination/duration metrics plus live log-count metrics through dedicated metrics routes and service detail output

Current docs define a preferred future model:
- `docs/development/core-runtime-logging-model.md`

Current implementation does not yet realize the broader run-level `workspaceRoot` archival model described there.

## SPEC-002 coverage judgment

`SPEC-002` is a bounded first-runtime spec, not a donor-parity spec.

Against that bounded intent, the current code is **mostly aligned** with the core scope:
- tracked source tree exists
- a runnable runtime entrypoint exists
- manifest discovery/parsing exists
- direct automated verification exists
- docs distinguish implemented behavior from donor/reference-only behavior in broad terms

However, the spec document itself is now stale in wording.

Examples:
- it still says the repo had no tracked runtime implementation yet
- it still reads like pre-implementation planning rather than post-slice reality

So the implementation is ahead of the spec wording.

## Test evidence

Current automated verification status for the bounded core slice:

- command run: `npm test`
- result: `67 passed, 0 failed`

The passing suite directly verifies:
- API startup
- service discovery
- manifest validation failure handling
- registry/dependency graph basics
- lifecycle ordering and guardrails
- state writes
- `process`, `http`, `tcp`, `file`, and `variable` health behavior
- readiness wait-loop behavior
- runtime summary behavior
- operator logs/variables/network surfaces
- provider resolution and provider-backed response payloads
- bounded install/config materialization
- bounded `globalenv` propagation
- bounded port negotiation
- bounded orchestration for `startAll`, `stopAll`, `reload`, and `autostart`
- bounded per-service runtime-log archival and retention
- bounded process/runtime metrics

This is strong evidence for the currently implemented slice.

It is **not** evidence for the unmigrated donor behaviors listed above.

## Findings

1. The current codebase is no longer bootstrap-only and does satisfy the main bounded intent of the first standalone runtime slice.
2. The donor runtime remains substantially broader than the current implementation.
3. The largest missing donor areas are setup depth, supervision depth, donor-depth process-tree/runtime telemetry, and broader manager/runtime parity.
4. The migration docs are directionally correct about those missing areas.
5. `SPEC-002` should be refreshed so its wording reflects the implemented slice rather than the pre-implementation state.
6. The passing test suite gives strong direct proof for the bounded slice, but should not be used to imply donor parity.

## Recommended next actions

1. Update `SPEC-002` so it describes the implemented bounded slice honestly.
2. Keep using `docs/development/core-runtime-migration-plan.md` as the main donor-gap tracker.
3. Choose the next major migration unit explicitly rather than mixing several donor gaps at once.
4. Prefer one of these as the next bounded execution item:
   - demo-instance hardening
   - deeper supervision parity
   - `lasso-@serviceadmin` integration validation
   - package-boundary/reference-app follow-through

## Final judgment

The current answer to "is the donor behavior covered by our spec and code?" is:

- **bounded first-slice spec coverage:** mostly yes
- **full donor runtime coverage:** no
- **current automated proof for implemented slice:** yes
- **current automated proof for donor parity:** no

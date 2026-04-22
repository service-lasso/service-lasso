# Core runtime working-application plan

This document turns the current review and audit findings into a practical plan for getting `service-lasso` from the current bounded core slice to a genuinely working application.

It is based on:
- `docs/development/core-runtime-comprehensive-review.md`
- `docs/development/core-runtime-donor-coverage-audit.md`
- `.governance/project/BACKLOG.md`

## Current starting point

What is already true:
- the repo has a real bounded runtime slice
- `npm test` passes for that bounded slice
- discovery, validation, registry, execution-backed lifecycle behavior, bounded health, operator surfaces, and API startup all exist
- the repo now exposes explicit `demo:start`, `demo:smoke`, and `demo:reset` commands for the bounded review/demo flow

What is not true yet:
- the docs still blur current behavior and future direction in several places
- the first real consumer repo still needs to be validated against the current runtime/API

The honest current label remains:

**bounded working core runtime implemented with explicit demo proof; broader consumer/runtime parity still not complete**

## Goal

Reach a state where Service Lasso can be honestly described as:

**a working local service runtime that can discover services, load explicit roots/config, launch at least one real managed service path, persist and rehydrate runtime state, expose stable API behavior, and support a credible demo flow**

## Delivery strategy

The best path is not donor-parity-all-at-once.

The best path is:
1. stabilize contracts and runtime boot behavior
2. add one real execution-backed supervision slice
3. prove a credible demo instance end to end
4. validate the first real consumer repo against that core runtime
5. then expand into broader donor parity and reference app templates

## Phase 1: Stabilize the current bounded slice

Objective:
- make the current runtime slice trustworthy and easier to build on

Why first:
- this reduces churn before real execution lands
- it keeps future work grounded on a stable API and startup model

Recommended steps:
1. Normalize API error/status handling and shared error DTO.
2. Implement explicit runtime config loading and validation for:
   - `servicesRoot`
   - `workspaceRoot`
3. Implement startup rehydration from persisted runtime/lifecycle state.

Primary backlog alignment:
- `TASK-012`
- `TASK-013`
- `TASK-014`

Exit criteria:
- invalid requests return deterministic typed API errors
- runtime no longer depends on hardcoded roots
- runtime restart restores known service/runtime state consistently

## Phase 2: Land the first real execution-backed runtime slice

Objective:
- move from state-only lifecycle behavior to real managed execution

Why this is the critical milestone:
- this is the single biggest gap between current code and a working application
- it also removes the biggest source of demo ambiguity

Recommended scope:
- implement one bounded process-supervision path first
- prefer one provider/runtime path only for the first slice
- keep the first execution path intentionally narrow and testable

The first execution slice should include:
- real child-process launch
- PID/runtime tracking
- stop/kill handling
- exit detection
- persisted runtime-state updates tied to real execution
- health behavior connected to actual running state

Primary backlog alignment:
- `TASK-015`

Exit criteria:
- at least one manifest-backed service can be started and stopped for real
- runtime state reflects actual process status rather than only action flags
- tests directly prove execution-backed lifecycle behavior

## Phase 3: Make the demo path honest and repeatable

Objective:
- turn the bounded runtime plus first execution slice into a credible working demo application

Why now:
- once real execution exists, the demo can become a meaningful proof point instead of a state-model walkthrough

Recommended steps:
1. Tighten `core-runtime-demo-instance-plan.md` so it clearly distinguishes:
   - bounded state-model demo
   - execution-backed demo
2. Run the demo-instance hardening checklist against real managed execution.
3. Add regression verification around the demo flow.

Primary backlog alignment:
- `TASK-016`

Exit criteria:
- a demo service can be discovered, configured, started, health-checked, and stopped with real process evidence
- demo verification is repeatable and documented
- the demo plan can no longer be satisfied by state flips alone

## Phase 4: Clean up docs and source-of-truth drift

Objective:
- make the repo safe to navigate and trustworthy for contributors

Why this should happen in parallel with Phases 1 to 3:
- current doc drift is already causing planning confusion
- runtime work will be harder to maintain if the docs keep overstating or lagging reality

Highest-priority docs work:
1. Refresh `SPEC-002` to describe the implemented bounded slice honestly.
2. Refresh `core-runtime-dev-plan.md` so completed work is no longer framed as future work.
3. Refresh the top-level `README.md` current-layout and status wording.
4. Reclassify the larger `service.json` reference docs as future/reference direction unless and until runtime support exists.
5. Fix or remove broken companion-doc links in `docs/reference`.
6. Clarify `workspaceRoot` as target direction until runtime adoption is complete.
7. Keep package-architecture docs aligned with the canonical:
   - `servicesRoot`
   - `workspaceRoot`

Exit criteria:
- docs clearly separate:
  - implemented behavior
  - target architecture
  - donor/reference evidence

## Phase 5: Expand from working application to broader runtime capability

Objective:
- close the highest-value donor/runtime gaps after the first working application milestone is real

Recommended next migration order after Phase 3:
1. setup/install mechanics
2. runtime-owned port negotiation
3. broader health model (`tcp`, `file`, `variable`, readiness loops)
4. shared `globalenv` propagation
5. fuller runtime logging and archival
6. process/runtime metrics and deeper supervision parity

Why this order:
- setup/install and ports are core to real service operation
- broader health becomes more valuable once real execution exists
- deeper observability should come after the first supervised process path and bounded orchestration are stable

Current harness note:
- the sibling `lasso-echoservice` repo already provides HTTP and TCP health simulation targets for testing
- that gives us a strong migration harness, and Service Lasso runtime now has bounded `tcp`, `file`, and `variable` manifest-health support proven against that harness
- broader donor health parity still requires readiness-loop behavior on top of those bounded checks

## Phase 5A: Validate the first real consumer repo

Objective:
- prove that the core runtime works for an actual consumer, not only for harness fixtures

Why this comes after Echo Service proof:
- `lasso-echoservice` is the best controllable runtime harness for migration and supervision testing
- `lasso-@serviceadmin` is the best first proof that a real UI consumer can use the runtime/API as intended

Recommended steps:
1. keep using released `lasso-echoservice` artifacts as the runtime-backed service under test
2. connect `lasso-@serviceadmin` to the current Service Lasso API/runtime
3. verify core admin surfaces end to end:
   - health
   - services list/detail
   - lifecycle actions
   - dependency/runtime summaries
   - logs, variables, and network/operator surfaces where supported
4. record any API contract gaps discovered through that UI integration before broader template rollout

Exit criteria:
- `lasso-@serviceadmin` can run against the current core runtime without special-case hacks
- the Echo Service release remains the primary integration target behind that UI validation
- any missing API or contract behavior is turned into tracked migration work before calling the core integration-ready

## Phase 6: Create post-core reference app templates

Objective:
- prove integration patterns and give other teams a ready starting point

These should be created once the core runtime is working and stable, not before.
They should live outside the core repo as sibling repos under `C:\projects\service-lasso` and as matching GitHub template repos.

Required post-core reference app/template packages:
- `@service-lasso/service-lasso-app-web`
- `@service-lasso/service-lasso-app-node`
- `@service-lasso/service-lasso-app-electron`
- `@service-lasso/service-lasso-app-tauri`
- packaging-target repos when they are justified by a real delivery need:
  - `@service-lasso/service-lasso-app-packager-pkg`
  - `@service-lasso/service-lasso-app-packager-sea`
  - `@service-lasso/service-lasso-app-packager-nexe`

These should act as:
- integration showcases
- starter templates for downstream teams
- proof that the runtime can be consumed cleanly in different host/distribution styles

All reference apps should consume the same canonical runtime-root model:
- `servicesRoot`
- `workspaceRoot`

They should remain outside core and never redefine the core runtime contract.

## Recommended immediate order

If we are choosing the next best steps right now, the recommended order is:

1. validate `lasso-@serviceadmin` against the current bounded runtime/API
2. refresh the highest-drift docs alongside that consumer validation work
3. establish package boundaries for core + reference apps

## What "working application" means in this repo

For this repo, "working application" should mean all of the following are true:
- runtime boots from explicit validated config
- runtime discovers real services from `servicesRoot`
- runtime stores managed working data under `workspaceRoot`
- runtime can launch and stop at least one real managed service path
- runtime persists and rehydrates enough state to survive restart meaningfully
- runtime exposes stable API responses and error contracts
- runtime can support a credible demo flow with execution evidence
- repo provides an explicit resettable demo quickstart and scripted smoke proof

It does **not** need to mean full donor parity yet.

## Final recommendation

The single best strategic move is:

**finish the transition from state-only lifecycle modeling to one real execution-backed runtime slice**

But the best tactical order is:

**stabilize API/config/rehydration first, then land execution, then prove it through a hardened demo**

That path gives Service Lasso the fastest route to becoming a genuinely working application without overclaiming parity too early.

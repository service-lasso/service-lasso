# Core runtime autonomous task list

This document is the working execution list for finishing the `service-lasso` core runtime and closing the remaining donor capability gaps in a controlled order.

It is based on:
- `.governance/project/BACKLOG.md`
- `.governance/specs/SPEC-002-core-standalone-runtime.md`
- `docs/development/core-runtime-working-application-plan.md`
- `docs/development/core-runtime-donor-coverage-audit.md`
- `docs/development/core-runtime-comprehensive-review.md`

It is meant to answer:

**what is left, in what order should it be done, and what should be proven before moving to the next major slice**

## Current completion baseline

Already done:
- core runtime entrypoint and API spine
- manifest discovery and validation
- registry and dependency graph basics
- deterministic API error handling
- runtime config loading for `servicesRoot` and `workspaceRoot`
- startup rehydration from persisted `.state`
- first bounded real execution/supervision path
- bounded health support for:
  - `process`
  - `http`
  - `tcp`
  - `file`
- Echo Service harness repo and released-artifact proof through the runtime

Current honest label:

**bounded working core runtime exists; donor parity is not complete yet**

## Execution rules for this list

- complete one bounded vertical slice at a time
- every slice must map to a governed backlog item before code starts
- every completed slice must end with:
  - automated proof
  - docs/spec/backlog updates
  - released Echo Service artifact proof when relevant
- do not claim donor parity for an area until the capability is implemented, tested, and documented

## Active execution order

### Wave 1: Finish bounded health parity

1. bounded `file` health support
   status: done
   proof:
   - manifest parsing accepts `healthcheck.type = file`
   - runtime reports healthy when the file exists
   - runtime reports unhealthy without throwing when the file is absent
   - released Echo Service artifact can be checked against a real file target

2. bounded `variable` health support
   status: next
   proof:
   - manifest parsing accepts `healthcheck.type = variable`
   - runtime can evaluate a bounded variable source deterministically
   - tests prove healthy and unhealthy cases

3. readiness and wait-loop behavior
   status: queued
   proof:
   - start flow can wait for configured health readiness within bounded timeout/retry rules
   - tests prove success, timeout, and failure behavior

### Wave 2: Shared environment and runtime negotiation

4. `globalenv` propagation model
   status: queued
   proof:
   - runtime can read emitted shared env data
   - runtime can surface merged shared env to dependent services or operator API
   - Echo Service and at least one dependent fixture prove the flow

5. runtime-owned port negotiation
   status: queued
   proof:
   - runtime can reserve or resolve service ports
   - collisions are detected deterministically
   - resolved port data is visible through runtime/operator surfaces

### Wave 3: Setup and lifecycle depth

6. bounded setup/install mechanics
   status: queued
   proof:
   - setup/install is more than state recording
   - at least one real setup path executes and records outcome

7. provider-backed execution parity
   status: queued
   proof:
   - at least one provider-backed service is actually executed through its provider path
   - provider-backed state and health are visible through the API

8. lifecycle depth hardening
   status: queued
   proof:
   - restart behavior is deterministic
   - intentional stop, crash exit, and restart evidence remain consistent in persisted state

### Wave 4: Orchestration parity

9. dependency-aware startup ordering
   status: queued
   proof:
   - runtime can start services in dependency order
   - readiness-aware dependency startup is covered by tests

10. manager-level orchestration
    status: queued
    scope:
    - `startAll`
    - `stopAll`
    - `reload`
    - `autostart`
    proof:
    - orchestration behavior is deterministic and test-covered

### Wave 5: Runtime observability parity

11. stdout/stderr capture and runtime log ownership
    status: queued
    proof:
    - managed process output is captured
    - runtime log locations are stable and documented

12. archival and retention model
    status: queued
    proof:
    - run/log retention rules exist and are enforced

13. process/runtime metrics
    status: queued
    proof:
    - runtime exposes bounded process evidence beyond pid/running state

### Wave 6: Demo and consumer validation

14. demo-instance hardening
    status: queued
    proof:
    - demo path proves real execution-backed behavior
    - demo cannot be satisfied by state flips alone

15. `lasso-@serviceadmin` integration validation
    status: queued
    proof:
    - admin UI consumes the current runtime/API without special-case hacks
    - released Echo Service artifact is used as the backing service target

### Wave 7: Package and template rollout

16. core package boundary scaffolding
    status: queued
    proof:
    - package split exists and remains aligned with the runtime-root model

17. reference app/template rollout
    status: queued
    scope:
    - `@service-lasso/service-lasso-app-web`
    - `@service-lasso/service-lasso-packager-node`
    - `@service-lasso/service-lasso-app-tauri`
    - `@service-lasso/service-lasso-bundled`
    proof:
    - each stays outside core
    - each consumes the canonical runtime/API cleanly

### Wave 8: Documentation truth pass

18. canonical manifest/reference cleanup
    status: queued
    proof:
    - canonical docs no longer overstate unsupported contract fields

19. stale planning/spec cleanup
    status: queued
    proof:
    - README, spec, plan, and migration docs agree with current implementation

20. final donor parity review
    status: queued
    proof:
    - every donor capability is marked:
      - done
      - partial
      - intentionally dropped
    - remaining gaps are explicit and justified

## Immediate next item

The next implementation slice from this list is:

**bounded `variable` health support**

That is the next smallest clean donor-parity step after bounded `file`, and it keeps the health migration moving with strong Echo Service-backed verification.

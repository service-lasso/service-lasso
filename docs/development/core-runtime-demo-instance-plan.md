# Core runtime demo-instance plan

This document defines the practical plan for turning the current bounded `service-lasso` core runtime into a reviewable demo instance.

It is intentionally narrower than the full product/runtime roadmap. The goal is not "finish Service Lasso" in one jump. The goal is to produce a demoable, testable instance that proves the core runtime shape end to end.

## Purpose

The demo instance should let us prove, in one local runnable slice, that `service-lasso` can:
- start a real core API process
- load a real managed service tree from `services/`
- expose service/runtime/operator endpoints from that tree
- run bounded lifecycle actions against demo services
- write/read structured `.state` data
- show provider execution behavior for the demo services
- give the UI/harness a stable target to exercise

## Current starting point

The repo already has the first bounded core slices in place:
- API server entrypoint
- manifest discovery and validation
- registry and dependency graph
- bounded lifecycle actions
- bounded process/http health evaluation
- `.state` file writing/reading helpers
- operator data surfaces (logs, variables, network)
- provider execution planning (direct, node, python)
- direct tests covering those slices

What it does **not** yet provide is a full reviewable demo instance with a clear startup model, stable validation flow, and real end-to-end demo semantics.

## Demo-instance success bar

The demo instance is good enough when all of the following are true:

1. A reviewer can start the core runtime with one documented command.
2. The runtime comes up against a known demo `services/` root.
3. The main demo endpoints return stable, expected data.
4. At least one demo service can be taken through install -> config -> start -> health -> stop in a repeatable way.
5. Structured `.state` files can be inspected before and after lifecycle actions.
6. The demo can be re-run cleanly without hand-editing the repo.
7. There is one documented smoke test flow for humans and one scripted validation flow for automation.

## Scope boundary for the demo

### In scope
- local development-mode runtime startup
- demo service root and fixture/demo services
- stable documented demo commands
- bounded lifecycle demonstration
- state persistence + inspection proof
- runtime/dependencies/operator endpoint proof
- one repeatable smoke-test flow
- one repeatable scripted validation flow

### Out of scope for this demo slice
- full production packaging/distribution
- full process supervision parity with donor runtime
- complete provider catalog
- remote multi-instance deployment model
- full UI/operator product completion
- all future runtime hardening work

## Recommended demo-instance shape

### Runtime mode
Use the current Node/TypeScript runtime in development mode as the first demo target.

### Service root
Use a dedicated demo-oriented managed service tree shape.

Preferred first step:
- keep the current tracked `services/` tree as the canonical demo root for now
- tighten it so it behaves like an intentional demo fixture set rather than just test input

### Demo services
The first demo set should stay small and explicit:
- `@node`
- `@python`
- one simple runnable sample service such as `echo-service`
- optionally one HTTP-health demo service if it materially improves the review flow

The demo services should be designed for clarity, not realism overload.

## Phased plan

## Phase 1, stabilize the current demo entry

Goal:
make the current runtime easy to start and inspect as a demo target.

Required outcomes:
- document the exact startup command
- document the default demo URL/port
- document the main review endpoints
- confirm the runtime loads the intended demo `services/` root by default
- add a short reviewer smoke-test checklist

Suggested deliverables:
- README/demo section or dedicated quickstart section
- one demo smoke-test doc
- one tiny helper script if startup is still awkward

Exit evidence:
- a fresh reviewer can start the runtime and hit `/api/health`, `/api/services`, `/api/runtime`, and `/api/dependencies`

## Phase 2, harden the demo service set

Goal:
make the demo services feel intentional and reviewable.

Required outcomes:
- each demo service has a clearly valid `service.json`
- provider relationships are explicit and understandable
- operator surfaces return useful demo data
- health behavior is predictable

Suggested deliverables:
- tidy current manifests for demo clarity
- add missing metadata that helps runtime/operator inspection
- ensure one service clearly demonstrates provider-backed execution

Exit evidence:
- service detail, variables, network, logs, and provider fields are all meaningful in the demo API output

## Phase 3, add a real demo lifecycle flow

Goal:
make the demo prove actual state transitions, not just static discovery.

Required outcomes:
- one demo service has a documented lifecycle walkthrough
- lifecycle actions update both API-visible state and `.state` files
- health output reflects the lifecycle state in a reviewable way

Suggested deliverables:
- one demo walkthrough covering install/config/start/health/stop
- one script or command block that runs the flow end to end
- one doc section showing where state files are written

Exit evidence:
- the lifecycle walkthrough works from a clean starting state and produces the expected files/responses

## Phase 4, add demo reset and rerun support

Goal:
make the demo repeatable without manual cleanup pain.

Required outcomes:
- documented reset/cleanup path
- no mystery leftover state between runs
- reviewers can rerun the demo cleanly

Suggested deliverables:
- reset script or documented cleanup command
- demo-state location docs
- scripted smoke flow that can be rerun repeatedly

Exit evidence:
- demo can be run, reset, and run again with the same expected outputs

## Phase 5, add automation-grade demo validation

Goal:
turn the demo into a reliable proof target for CI/harness/UI work.

Required outcomes:
- one scripted validation flow exercises the demo instance
- the scripted flow checks key API responses and lifecycle outcomes
- the flow is suitable for future CI integration

Suggested deliverables:
- script under `scripts/`
- integration test or smoke-test wrapper
- clear pass/fail output

Exit evidence:
- one command validates the demo instance behavior without manual inspection

## Highest-priority gaps to close first

These are the most valuable next moves if the goal is a credible demo instance:

1. **Documented startup path**
   - the runtime already starts, but the demo path should be explicit and reviewer-friendly

2. **Intentional demo service set**
   - the current `services/` tree should read like a demo fixture set, not just test scaffolding

3. **Lifecycle walkthrough**
   - reviewers should be able to see a single clean service go through a bounded action sequence

4. **Demo reset path**
   - reruns should not depend on manual state cleanup guesswork

5. **Scripted smoke validation**
   - the demo should become a reliable proof target for future UI/harness integration

## Recommended implementation order

1. Document startup + review endpoints
2. Tighten the demo service manifests
3. Write the lifecycle walkthrough
4. Add demo reset/cleanup support
5. Add scripted smoke validation
6. Only then expand toward more realistic execution behavior

## Concrete reviewer flow we should target

The first good demo review should look like this:

1. Run one command to start `service-lasso`
2. Open or fetch:
   - `/api/health`
   - `/api/services`
   - `/api/runtime`
   - `/api/dependencies`
3. Inspect one service detail endpoint
4. Trigger:
   - `install`
   - `config`
   - `start`
5. Recheck:
   - service detail
   - service health
   - runtime summary
   - `.state` files
6. Trigger `stop`
7. Recheck runtime + state
8. Reset the demo cleanly

If that flow is smooth, the demo instance is already useful.

## Relationship to later runtime hardening

This demo plan does **not** replace the broader runtime roadmap.

After the demo instance is working, the next likely hardening tracks are still:
- better API error/status semantics
- runtime model loading/validation strategy
- state rehydration on startup
- stronger dependency/provider validation
- broader real execution behavior

Those are important, but they should not block the first good demo instance unless they are directly needed to make the demo credible.

## Recommended next execution item

The next best step is:

**Create the first explicit demo quickstart + smoke-test path for the current runtime.**

That gives the project an immediately reviewable target and makes later hardening easier to validate.

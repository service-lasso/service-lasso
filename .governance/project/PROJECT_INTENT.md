# Project Intent

Use this file to capture the project-specific intent that governance cannot provide.

## Purpose
Service Lasso is the core runtime and contract repository for running local packaged services under one governed manager. Its job is to define and implement the shared service model, discover service manifests, orchestrate install/config/start/stop/health behavior, and provide the reusable runtime surface that service repos and the Service Admin UI depend on.

## Context
Bootstrap/governance setup is now in place and should remain durable, but this repository is no longer only a bootstrap shell. The next phase is product implementation of the core standalone runtime.

The broader three-repo shape is already established:
- `service-lasso` = core runtime + canonical shared contract/docs
- `service-template` = the template for individual services
- `lasso-@serviceadmin` = the operator UI

This repo is therefore the place where the real core behavior must live:
- standalone runtime/server entrypoint
- manifest discovery and parsing
- service lifecycle orchestration
- dependency/env/health semantics
- packaging/release mechanics for the core runtime itself

## Constraints
- Governance/spec/backlog traceability must remain in place while product code starts.
- This repo is private and should preserve clear auditability for decisions and changes.
- The donor material under `ref/` is reference input, not the product itself.
- The first implementation slice should stay bounded: get to a real runnable core before broadening scope.
- Branch-protection verification is still partially degraded on the current GitHub hosting tier and must remain documented honestly.
- `.governance/` remains the canonical governance source of truth for this repo.

## Risks
- The donor runtime is useful but overloaded; transplanting it blindly would import too much accidental architecture.
- Staying in analysis/doc mode too long would create false progress without a running core.
- Starting too broadly could mix manifest redesign, runtime implementation, provider integration, and release plumbing into one hard-to-verify change.
- Missing Windows payload/runtime assumptions from the donor snapshot could block a naive parity-first implementation.

## Assumptions
- The first trustworthy product milestone is a standalone core runtime slice that actually runs locally.
- The first core slice should prove manifest discovery/orchestration behavior before attempting full donor parity.
- GitHub-backed issues/project board remain the system of record for governed execution tracking.
- Bootstrap artifacts remain part of repo history, but active delivery should now bind to product specs rather than bootstrap-only specs.

## Key Behaviors
- The core runtime should discover canonical `service.json` manifests and treat them as operational contract files, not passive metadata.
- The core runtime should expose a standalone execution surface independent of Electron-specific donor assumptions.
- Service lifecycle work should converge on explicit actions such as install, config, start, stop, and health/status reporting.
- Dependency, env, and health semantics should remain explicit and reviewable through docs/specs as implementation hardens.
- Product implementation should proceed through bounded specs/issues rather than broad donor dumps or undocumented chat intent.

## Verification Expectations
Core product work should be verified with direct runnable evidence, not only documentation updates.

For the first runtime slice, expected proof should include:
- tracked source artifacts for the standalone core runtime
- direct local execution evidence that the runtime starts successfully
- direct proof that manifest discovery/parsing works against defined fixture/sample services
- documented residual gaps/blockers for anything not yet implemented
- backlog/spec traceability updated to distinguish shipped runtime behavior from still-reference-only donor behavior

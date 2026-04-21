# Project Intent

Use this file to capture the project-specific intent that governance cannot provide.

## Purpose
Service Lasso is the core runtime and contract repository for running local packaged services under one governed manager. Its job is to define and implement the shared service model, discover service manifests, orchestrate install/config/start/stop/health behavior, and provide the reusable runtime surface that service repos and the Service Admin UI depend on.

## Context
Bootstrap/governance setup is now in place and remains durable. The first core runtime implementation batch is landed (`#2` to `#8`), and this repository is now in the hardening phase for startup configuration, persistence rehydration, stronger API semantics, and real execution supervision.

The broader multi-repo shape is already established:
- `service-lasso` = core runtime + canonical shared contract/docs
- `service-template` = the template for individual services
- `lasso-@serviceadmin` = the operator UI
- sibling starter repos = quick-start host templates for web, packager-node, tauri, and bundled delivery

This repo is therefore the place where the real core behavior must live and continue hardening:
- standalone runtime/server entrypoint
- manifest discovery and parsing
- service lifecycle orchestration
- dependency/env/health semantics
- runtime config loading for `servicesRoot` and `workspaceRoot`
- state persistence and startup rehydration
- packaging/release mechanics for the core runtime itself
- publishable package mechanics so sibling starter repos can consume the core runtime cleanly

## Constraints
- Governance/spec/backlog traceability must remain in place while product code starts.
- This repo is private and should preserve clear auditability for decisions and changes.
- The donor material under `ref/` is reference input, not the product itself.
- Hardening should stay bounded and staged: stabilize contracts/config/state before widening provider/runtime complexity.
- Branch-protection verification is still partially degraded on the current GitHub hosting tier and must remain documented honestly.
- `.governance/` remains the canonical governance source of truth for this repo.

## Risks
- The donor runtime is useful but overloaded; transplanting it blindly would import too much accidental architecture.
- Staying in analysis/doc mode too long would create false progress without a running core.
- Starting too broadly could mix manifest redesign, runtime implementation, provider integration, and release plumbing into one hard-to-verify change.
- Missing Windows payload/runtime assumptions from the donor snapshot could block a naive parity-first implementation.

## Assumptions
- The first trustworthy milestone, a runnable standalone core slice, is now achieved.
- The current highest-value work is finishing honest distribution boundaries: publishable core package flow, executable starter-repo targets, and final documentation truth passes on top of the already-landed bounded runtime.
- GitHub-backed issues/project board remain the system of record for governed execution tracking.
- Bootstrap artifacts remain part of repo history, but active delivery is now product-spec driven.

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

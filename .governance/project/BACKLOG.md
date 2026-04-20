# Backlog

This backlog tracks active product delivery for the `service-lasso` core runtime.

## Current Active Spec
- `SPEC-002-core-standalone-runtime.md`

## Issue Register
| ID | Status | Title | Spec References | Notes |
| --- | --- | --- | --- | --- |
| `ISS-001` | `done` | Normalize provisional project intent and the first governed spec | `SPEC-001`, `AC-1` | Bootstrap intent/spec normalization completed and preserved as historical traceability. |
| `ISS-002` | `done` | Install strict Git workflow bootstrap artifacts | `SPEC-001`, `AC-2` | Required bootstrap workflow artifacts were installed during bootstrap. |
| `ISS-003` | `done` | Record GitHub preflight outcomes and normalize the canonical board | `SPEC-001`, `AC-3` | Canonical board/preflight state was recorded during bootstrap. |
| `ISS-004` | `done` | Record timestamped bootstrap status, feedback, and any blockers | `SPEC-001`, `AC-4` | Bootstrap status/feedback/blocker artifacts were checkpointed into repo history. |
| `ISS-005` | `done` | Keep bootstrap traceability aligned as the repo adopts product intent later | `SPEC-001`, `AC-5` | Bootstrap handoff is preserved for ongoing product delivery. |
| `ISS-006` | `done` | Establish the tracked core runtime source tree | `SPEC-002`, `AC-1` | Landed via scaffold + tracked source structure. |
| `ISS-007` | `done` | Build the first standalone runtime entrypoint | `SPEC-002`, `AC-2` | Landed with bounded runtime entrypoint and API startup. |
| `ISS-008` | `done` | Implement canonical manifest discovery and parsing | `SPEC-002`, `AC-3` | Landed with discovery/load/validate path against tracked service manifests. |
| `ISS-009` | `done` | Add runnable fixture-based verification for the core runtime slice | `SPEC-002`, `AC-4` | Landed with direct route/runtime tests and local verification evidence. |
| `ISS-010` | `done` | Add minimum viable build and release plumbing for the core repo | `SPEC-002`, `AC-5` | Landed with build/typecheck/test/dev package plumbing. |
| `ISS-011` | `done` | Reconcile canonical docs with implemented core runtime behavior | `SPEC-002`, `AC-6` | Landed through core runtime layout + migration/state/logging/storage doc updates. |
| `ISS-012` | `done` | Harden API error semantics and response contracts | `SPEC-002` | Landed with deterministic typed API error bodies plus explicit 400/404/409/500 behavior. |
| `ISS-013` | `done` | Add runtime startup config loading for `servicesRoot` and `workspaceRoot` | `SPEC-002` | Landed with validated startup config resolution, explicit `workspaceRoot`, and invalid-root rejection. |
| `ISS-014` | `done` | Rehydrate runtime and lifecycle state on startup | `SPEC-002` | Landed with startup rehydration from persisted `.state` records into runtime/detail summaries. |
| `ISS-015` | `done` | Add real process execution and supervision slice | `SPEC-002`, `AC-4B` | Landed with the first bounded execution supervisor, persisted runtime metadata, and released Echo Service artifact proof through the core runtime. |
| `ISS-016` | `todo` | Demo-instance hardening and regression verification | `SPEC-002` | Validate demo-readiness loop from startup through multi-service runtime operations. |
| `ISS-017` | `todo` | Establish package boundaries for core + reference apps | `SPEC-002` | Define and scaffold `packages/core`, `packages/app-electron`, and `packages/app-node` with explicit core/no-UI-framework boundary. |
| `ISS-018` | `done` | Turn `echo-service` into a runnable Go harness fixture | `SPEC-002`, `AC-4A` | Landed with a Go-based sample service exposing UI and API actions plus log/state/SQLite persistence surfaces. |
| `ISS-019` | `done` | Broaden bounded runtime health support with donor-aligned manifest types | `SPEC-002`, `AC-4C` | Landed the first broader health slice with bounded `tcp` manifest-health support plus automated and released-harness verification. |
| `ISS-020` | `done` | Add bounded `file` manifest-health support | `SPEC-002`, `AC-4C` | Landed bounded file-based readiness checks with automated tests and released Echo Service file proof. |

## Task Queue
| ID | Status | Linked Issue | Title | Spec References | Exit Evidence |
| --- | --- | --- | --- | --- | --- |
| `TASK-001` | `done` | `ISS-001` | Mark project intent as provisional and normalize `SPEC-001` to bootstrap setup | `SPEC-001`, `AC-1` | Bootstrap spec no longer invented unvalidated product scope |
| `TASK-002` | `done` | `ISS-002` | Create `INIT-TODO.md` and strict Git workflow artifacts | `SPEC-001`, `AC-2` | Required workflow files exist |
| `TASK-003` | `done` | `ISS-003` | Run GitHub preflight and adopt one canonical board target | `SPEC-001`, `AC-3` | Canonical board/preflight state recorded |
| `TASK-004` | `done` | `ISS-004` | Write timestamped status and feedback artifacts for the current bootstrap update | `SPEC-001`, `AC-4` | Timestamped bootstrap artifacts exist and were committed |
| `TASK-005` | `done` | `ISS-005` | Keep traceability current as future feature specs replace bootstrap setup | `SPEC-001`, `AC-5` | Bootstrap transition artifacts preserved |
| `TASK-006` | `done` | `ISS-006` | Create the tracked runtime/app source layout for the core repo | `SPEC-002`, `AC-1` | Runtime source tree, package/build config, and scaffold docs exist in tracked repo files |
| `TASK-007` | `done` | `ISS-007` | Add the first standalone runtime entrypoint and dev run path | `SPEC-002`, `AC-2` | Runtime starts successfully in local development mode |
| `TASK-008` | `done` | `ISS-008` | Implement manifest discovery/parsing against a defined service root | `SPEC-002`, `AC-3` | Runtime reports discovered manifest-backed services correctly |
| `TASK-009` | `done` | `ISS-009` | Add fixture/sample services and direct runtime smoke verification | `SPEC-002`, `AC-4` | Direct runnable proof exists for discovery/parsing behavior |
| `TASK-010` | `done` | `ISS-010` | Add minimum viable build/validation/release workflows for core runtime | `SPEC-002`, `AC-5` | Build/validation/release plumbing exists and runs |
| `TASK-011` | `done` | `ISS-011` | Update canonical docs to reflect implemented runtime behavior | `SPEC-002`, `AC-6` | Docs clearly separate implemented behavior from donor/reference notes |
| `TASK-012` | `done` | `ISS-012` | Normalize API error/status handling and shared error DTO | `SPEC-002` | Invalid lifecycle/action flows now return deterministic typed 400/409 API errors with shared error payload shape |
| `TASK-013` | `done` | `ISS-013` | Implement runtime config loading + validation (`servicesRoot`, `workspaceRoot`) | `SPEC-002` | Runtime boots from explicit validated roots, surfaces `workspaceRoot`, and rejects missing `servicesRoot` |
| `TASK-014` | `done` | `ISS-014` | Implement startup rehydration from persisted runtime/lifecycle state | `SPEC-002` | Startup restores persisted lifecycle state and runtime summaries/detail endpoints reflect the rehydrated state |
| `TASK-015` | `done` | `ISS-015` | Add first bounded execution supervisor for one provider path | `SPEC-002`, `AC-4B` | Real process launch/stop supervision works with persisted runtime state updates and released Echo Service artifacts can be run through the core runtime |
| `TASK-016` | `todo` | `ISS-016` | Run demo-instance hardening checklist and regression suite | `SPEC-002` | Demo-instance plan checkpoints are met with repeatable validation evidence |
| `TASK-017` | `todo` | `ISS-017` | Scaffold package split (`core`, `app-electron`, `app-node`) and baseline build wiring | `SPEC-002` | Monorepo package map exists with core exports/CLI target and reference app placeholders consuming core |
| `TASK-018` | `done` | `ISS-018` | Implement the `echo-service` Go harness fixture with UI, API, and persistence behaviors | `SPEC-002`, `AC-4A` | `echo-service` now builds and runs as a Go harness with action endpoints, browser UI, logs, state snapshots, and SQLite writes |
| `TASK-019` | `done` | `ISS-019` | Implement bounded `tcp` manifest-health support with direct tests | `SPEC-002`, `AC-4C` | Runtime accepts `healthcheck.type = tcp`, reports healthy/unhealthy results deterministically, and has direct verification coverage including released Echo Service TCP-port proof |
| `TASK-020` | `done` | `ISS-020` | Implement bounded `file` manifest-health support with direct tests | `SPEC-002`, `AC-4C` | Runtime accepts `healthcheck.type = file`, reports healthy/unhealthy results deterministically, and has direct verification coverage including released Echo Service file proof |

## Next Recommended Item
The next best item is the next bounded donor-health slice after `TASK-020`: add `variable` manifest-health support with deterministic evaluation and direct Echo Service-backed verification.

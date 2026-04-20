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
| `ISS-012` | `todo` | Harden API error semantics and response contracts | `SPEC-002` | Normalize 4xx/5xx behavior and error payload shape across routes/actions. |
| `ISS-013` | `todo` | Add runtime startup config loading for `servicesRoot` and `workspaceRoot` | `SPEC-002` | Move from hardcoded defaults to explicit runtime-loaded config with validation. |
| `ISS-014` | `todo` | Rehydrate runtime and lifecycle state on startup | `SPEC-002` | Ensure persisted state survives restart and is reflected in runtime/detail endpoints. |
| `ISS-015` | `todo` | Add real process execution and supervision slice | `SPEC-002` | Replace provider planning-only behavior with first bounded execution supervision path. |
| `ISS-016` | `todo` | Demo-instance hardening and regression verification | `SPEC-002` | Validate demo-readiness loop from startup through multi-service runtime operations. |

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
| `TASK-012` | `todo` | `ISS-012` | Normalize API error/status handling and shared error DTO | `SPEC-002` | Failing and invalid flows return deterministic typed errors |
| `TASK-013` | `todo` | `ISS-013` | Implement runtime config loading + validation (`servicesRoot`, `workspaceRoot`) | `SPEC-002` | Runtime boots from explicit config and rejects invalid root settings |
| `TASK-014` | `todo` | `ISS-014` | Implement startup rehydration from persisted runtime/lifecycle state | `SPEC-002` | Restart restores prior known service state consistently |
| `TASK-015` | `todo` | `ISS-015` | Add first bounded execution supervisor for one provider path | `SPEC-002` | Real process launch/stop supervision works with persisted runtime state updates |
| `TASK-016` | `todo` | `ISS-016` | Run demo-instance hardening checklist and regression suite | `SPEC-002` | Demo-instance plan checkpoints are met with repeatable validation evidence |

## Next Recommended Item
`TASK-012` is the next best item: lock API error semantics before layering startup config and rehydration, so follow-on behavior lands on a stable contract surface.

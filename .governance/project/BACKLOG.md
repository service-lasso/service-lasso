# Backlog

This backlog now tracks the transition from bootstrap into core product delivery for Service Lasso.

## Current Active Spec
- `SPEC-002-core-standalone-runtime.md`

## Issue Register
| ID | Status | Title | Spec References | Notes |
| --- | --- | --- | --- | --- |
| `ISS-001` | `done` | Normalize provisional project intent and the first governed spec | `SPEC-001`, `AC-1` | Bootstrap intent/spec normalization completed and preserved as historical traceability. |
| `ISS-002` | `done` | Install strict Git workflow bootstrap artifacts | `SPEC-001`, `AC-2` | Required bootstrap workflow artifacts were installed during bootstrap. |
| `ISS-003` | `done` | Record GitHub preflight outcomes and normalize the canonical board | `SPEC-001`, `AC-3` | Canonical board/preflight state was recorded during bootstrap; branch-protection verification remains a separately documented limitation. |
| `ISS-004` | `done` | Record timestamped bootstrap status, feedback, and any blockers | `SPEC-001`, `AC-4` | Bootstrap status/feedback/blocker artifacts were checkpointed into repo history. |
| `ISS-005` | `done` | Keep bootstrap traceability aligned as the repo adopts product intent later | `SPEC-001`, `AC-5` | Bootstrap handoff is now preserved so the repo can move into product work without rewriting history. |
| `ISS-006` | `done` | Establish the tracked core runtime source tree | `SPEC-002`, `AC-1` | Tracked package/build config, `src/` layout, and scaffold docs now exist in the repo. |
| `ISS-007` | `todo` | Build the first standalone runtime entrypoint | `SPEC-002`, `AC-2` | Create the first runnable core entrypoint for local development mode. |
| `ISS-008` | `todo` | Implement canonical manifest discovery and parsing | `SPEC-002`, `AC-3` | Prove the runtime can load `service.json` manifests from a defined service root. |
| `ISS-009` | `todo` | Add runnable fixture-based verification for the core runtime slice | `SPEC-002`, `AC-4` | Verification must use direct runnable proof, not doc-only surrogate evidence. |
| `ISS-010` | `todo` | Add minimum viable build and release plumbing for the core repo | `SPEC-002`, `AC-5` | The core repo needs real build/validation/release mechanics once source exists. |
| `ISS-011` | `todo` | Reconcile canonical docs with implemented core runtime behavior | `SPEC-002`, `AC-6` | Distinguish implemented behavior from donor/reference-only guidance. |

## Task Queue
| ID | Status | Linked Issue | Title | Spec References | Exit Evidence |
| --- | --- | --- | --- | --- | --- |
| `TASK-001` | `done` | `ISS-001` | Mark project intent as provisional and normalize `SPEC-001` to bootstrap setup | `SPEC-001`, `AC-1` | Bootstrap spec no longer invented unvalidated product scope |
| `TASK-002` | `done` | `ISS-002` | Create `INIT-TODO.md` and strict Git workflow artifacts | `SPEC-001`, `AC-2` | Required workflow files exist |
| `TASK-003` | `done` | `ISS-003` | Run GitHub preflight and adopt one canonical board target | `SPEC-001`, `AC-3` | Canonical board/preflight state recorded |
| `TASK-004` | `done` | `ISS-004` | Write timestamped status and feedback artifacts for the current bootstrap update | `SPEC-001`, `AC-4` | Timestamped bootstrap artifacts exist and were committed |
| `TASK-005` | `done` | `ISS-005` | Keep traceability current as future feature specs replace bootstrap setup | `SPEC-001`, `AC-5` | Bootstrap transition artifacts preserved |
| `TASK-006` | `done` | `ISS-006` | Create the tracked runtime/app source layout for the core repo | `SPEC-002`, `AC-1` | Runtime source tree, package/build config, and scaffold docs exist in tracked repo files |
| `TASK-007` | `todo` | `ISS-007` | Add the first standalone runtime entrypoint and dev run path | `SPEC-002`, `AC-2` | Runtime starts successfully in local development mode |
| `TASK-008` | `todo` | `ISS-008` | Implement manifest discovery/parsing against a defined service root | `SPEC-002`, `AC-3` | Runtime reports discovered manifest-backed services correctly |
| `TASK-009` | `todo` | `ISS-009` | Add fixture/sample services and direct runtime smoke verification | `SPEC-002`, `AC-4` | Direct runnable proof exists for discovery/parsing behavior |
| `TASK-010` | `todo` | `ISS-010` | Add minimum viable build/validation/release workflows for core runtime | `SPEC-002`, `AC-5` | Build/validation/release plumbing exists and runs |
| `TASK-011` | `todo` | `ISS-011` | Update canonical docs to reflect implemented runtime behavior | `SPEC-002`, `AC-6` | Docs clearly separate implemented behavior from donor/reference notes |

## Next Recommended Item
`TASK-007` is the next best item. The source layout now exists, so the next bounded step is to replace the scaffold report with the first real standalone runtime entrypoint behavior.
# Backlog

This backlog is the pre-implementation execution queue for Service Lasso. Every item below maps to `SPEC-001-bootstrap-governance-setup.md`.

## Issue Register
| ID | Status | Title | Spec References | Notes |
| --- | --- | --- | --- | --- |
| `ISS-001` | `todo` | Normalize provisional project intent and the first governed spec | `Intent`, `Scope`, `AC-1` | Replace inferred product scope with a bootstrap/setup spec until stakeholder intent is validated. |
| `ISS-002` | `todo` | Install strict Git workflow bootstrap artifacts | `Scope`, `AC-2` | Add the required repo-local workflow files and the documented default issue-pickup flow. |
| `ISS-003` | `todo` | Record GitHub preflight outcomes and normalize the canonical board | `Scope`, `AC-3`, `Verification` | Capture live GitHub capability and ensure a single canonical board target exists and is linked. |
| `ISS-004` | `todo` | Record timestamped bootstrap status, feedback, and any blockers | `AC-4`, `Tests and Evidence`, `Documentation Impact` | Keep durable local run artifacts that reconcile historical observations with the final live state. |
| `ISS-005` | `todo` | Keep bootstrap traceability aligned as the repo adopts product intent later | `AC-5`, `Change Notes` | Preserve a clean handoff from bootstrap setup to future feature specs without rewriting history. |

## Task Queue
| ID | Status | Linked Issue | Title | Spec References | Exit Evidence |
| --- | --- | --- | --- | --- | --- |
| `TASK-001` | `todo` | `ISS-001` | Mark project intent as provisional and normalize `SPEC-001` to bootstrap setup | `AC-1` | `PROJECT_INTENT.md` and `SPEC-001` no longer invent unvalidated product scope |
| `TASK-002` | `todo` | `ISS-002` | Create `INIT-TODO.md` and strict Git workflow artifacts | `AC-2` | Required files exist with a documented issue-pickup flow and branch/PR expectations |
| `TASK-003` | `todo` | `ISS-003` | Run GitHub preflight and adopt one canonical board target | `AC-3`, `Verification` | Live board target exists, required fields are present, repo link status is recorded |
| `TASK-004` | `todo` | `ISS-004` | Write timestamped status and feedback artifacts for the current bootstrap update | `AC-4`, `Tests and Evidence` | Run artifacts under `bootstrap-runs/` distinguish starting evidence from final state |
| `TASK-005` | `todo` | `ISS-005` | Keep traceability current as future feature specs replace bootstrap setup | `AC-5`, `Change Notes` | Backlog rows and status pointers refer to the active bootstrap artifacts |

## Next Recommended Item
`TASK-002` is the best next item after this bootstrap update. It carries the remaining operational workflow from governance setup into day-to-day repo use without starting product implementation.

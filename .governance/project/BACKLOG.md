# Backlog

This backlog is the pre-implementation execution queue for Service Lasso. Every item below maps to `SPEC-001-service-inventory-foundation.md`.

## Issue Register
| ID | Status | Title | Spec References | Notes |
| --- | --- | --- | --- | --- |
| `ISS-001` | `todo` | Define the canonical service-record contract | `Intent`, `Scope`, `AC-1` | Establish the minimum fields and glossary for a service record before product code begins. |
| `ISS-002` | `todo` | Define the primary service review workflow | `Intent`, `AC-2`, `Verification` | Capture how a user finds a service and what information must be present to complete a review. |
| `ISS-003` | `todo` | Define manual-entry versus sync boundaries | `Scope`, `AC-3`, `Change Notes` | Prevent integration assumptions from leaking into the first implementation slice. |
| `ISS-004` | `todo` | Define implementation proof requirements for the first slice | `AC-4`, `Tests and Evidence`, `Documentation Impact` | Turn governance expectations into concrete verification and documentation work for later execution. |
| `ISS-005` | `todo` | Maintain traceable task decomposition for SPEC-001 | `AC-5` | Keep the execution queue aligned to the current spec as details become clearer. |

## Task Queue
| ID | Status | Linked Issue | Title | Spec References | Exit Evidence |
| --- | --- | --- | --- | --- | --- |
| `TASK-001` | `todo` | `ISS-001` | Draft the minimum service-record fields and field definitions | `AC-1` | Updated spec language or follow-on spec with named fields and rationale |
| `TASK-002` | `todo` | `ISS-002` | Document the primary reviewer goal and service-review flow | `AC-2`, `Verification` | Scenario narrative covering locate -> inspect -> confirm ownership/context |
| `TASK-003` | `todo` | `ISS-003` | Record non-goals and future sync assumptions | `Scope`, `AC-3`, `Change Notes` | Explicit boundary notes preventing sync work from entering the first slice |
| `TASK-004` | `todo` | `ISS-004` | Define implementation-time verification expectations | `AC-4`, `Tests and Evidence` | Named checks/tests/evidence required once product code starts |
| `TASK-005` | `todo` | `ISS-005` | Keep issue/task mappings current as SPEC-001 evolves | `AC-5` | Backlog rows reference the active spec sections and acceptance criteria |

## Next Recommended Item
`TASK-001` is the best next item. It tightens the product contract with the least implementation risk and gives the rest of the backlog a stable foundation.

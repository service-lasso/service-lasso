# Bootstrap Blockers and Manual Remediation

## `blocked-with-tracked-issue`: default table view is non-conforming

The required default table view must expose columns in this order: `Title`, `Assignees`, `Status`, `Project Priority`, `Order`, `Priority`, `Repository`. Readback shows `View 1` is a table with `Title`, `Status`, `Labels`, `Repository`, `Project Priority`, `Priority`, `Order`. It omits `Assignees`, exposes `Labels`, and has the wrong order. This run did not mutate the project.

**Next action:** a Project administrator should set the listed visible-column order and record before/after API readback on [#1588](https://github.com/service-lasso/service-lasso/issues/1588). If automation is later authorized, use the supported API that can read back the view configuration before closing this gap.

## `blocked-with-tracked-issue`: Priority options are unconfigured

Project #1 exposes `Priority` as a `SINGLE_SELECT` field, but its options list is empty instead of `Urgent`, `High`, `Medium`, `Low`.

**Next action:** configure those four values only through the reviewed #1588 provider-control change, then capture final API readback.

## `blocked-with-tracked-issue`: existing Project Priority `P5` option

Project #1 has required `P0`–`P4` and an additional `P5` option. Existing items and assignments were preserved. The current canonical contract does not establish whether the extra option is acceptable for this project, and this run had no authority to replace options or normalize board data.

**Next action:** the Project administrator should decide whether `P5` remains an explicitly documented local extension or should be retired through a reviewed migration that first accounts for every affected item. Record that decision on #1588.

## Degraded verification: branch-protection checklist

The `develop` protection endpoint was readable, but current live values include zero required approvals and no CODEOWNERS/last-push approval requirement. This differs from the repository checklist. The update did not change provider controls.

**Next action:** an authorized repository administrator should reconcile the live policy with `.github/branch-protection-checklist.md`, record the selected policy and any hosting limitation, then preserve API readback as evidence on #1588.

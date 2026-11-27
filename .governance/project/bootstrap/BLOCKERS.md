# Bootstrap blockers

Full bootstrap: **blocked-with-tracked-issue**, [#1588](https://github.com/service-lasso/service-lasso/issues/1588). Owner: authorized project/repository administrator under a separately reviewed provider migration. #1988 is repository-only and grants no board/settings authority.

Exact next actions under #1588:
- Preserve existing items, assignments, fields and board identity. Record before/after readbacks and an explicit migration/authority decision before changes.
- Set default View 1 visible columns/order to Title, Assignees, Status, Project Priority, Order, Priority, Repository; hide Labels and retain other fields as appropriate. If API view configuration is unsupported, an authorized board administrator must perform this in the project UI and attach a verifiable readback.
- Configure existing Priority single-select options to Urgent, High, Medium, Low (currently empty); retain existing field identity and reconcile affected assignments explicitly.
- Decide whether existing P5 is an approved extension or requires item-by-item migration before retirement. No deletion is authorized here.
- Reconcile develop ruleset 21891323 with the repository checklist: approving review, stale dismissal, CODEOWNERS/last-push policy where intended, required CI checks and direct-push enforcement. Preserve the effective classic protection conversation-resolution requirement (enabled; the ruleset alone reports false). Live readback currently has zero required approvals and no required-status-check rule. Do not infer unavailable enforcement from a successful administrative read.
- Verify applicable open-issue attachment completeness and repeat final board/link/rules readback. Authentication and viewerCanUpdate already work; no credential refresh is currently required.

These blockers prevent a full bootstrap pass, not the bounded reviewed repository reporting repair. No release, deployment or product execution authority is conferred.

Historical snapshot for this run: [blockers](history/2026-11-27T08-53-53Z/blockers.md).

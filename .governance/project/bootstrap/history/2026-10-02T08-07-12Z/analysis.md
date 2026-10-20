# Bootstrap repair analysis

## Canonical sources and provenance

The original 07:53 bundle preserved agent.txt, bootstrap.json and supporting Bootstrap source snapshots. It was partial: it did not retain provider receipts or complete independent per-run interpretations. Those original limitations remain historical facts. This new repair bundle supplies fresh actual-time provider receipts and fourteen raw canonical rule downloads with URL/read-time/raw SHA-256/installed SHA-256/normalization mapping in [RULE-PROVENANCE.json](sources/RULE-PROVENANCE.json). Every raw and installed digest is identical; no normalization or content edits were applied. Public upstream URLs use its published documentation source branch; no target-repository promotion branch was accessed.

The canonical machine-readable sources enumerate nine rules, Bootstrap page requires thirteen, and the published GOV-01 index includes fourteen. We retain the complete indexed fourteen-rule set and report the upstream discrepancy. Service Lasso's separate gov-09-release-authority.mdc overlay has no diff against develop and loads after canonical GOV-14.

## Preflight classification

| Capability/contract | Classification | Evidence and interpretation |
| --- | --- | --- |
| git and gh availability | configured | git 2.52.0.vfs.0.4; gh 2.87.2; both commands completed during repair |
| initialized repository and inherited clean state | configured | existing issue-scoped worktree, verified clean HEAD 939e2cb; bounded recovery exception in status |
| GitHub authentication/repository read/admin permissions | configured | authenticated API succeeded; repository-preflight.json contains default develop and admin/maintain/pull/push/triage true; no credential material retained |
| Project read/update permission | configured | project-1.json readable; viewerCanUpdate true; no write probe |
| canonical project repository relation | configured | Project #1 service-lasso Delivery links service-lasso/service-lasso; existing target retained |
| Status, Project Priority P0-P4, Size, Order | configured | exact field types/options in project-1.json: six required Status, five required Size, Order NUMBER; P5 additional local option is nonblocking |
| Priority options | blocked-with-tracked-issue | SINGLE_SELECT options empty; #1588 |
| default table view | blocked-with-tracked-issue | View 1 TABLE_LAYOUT visible ordered names Title, Status, Labels, Repository, Project Priority, Priority, Order; #1588 |
| develop protection policy | blocked-with-tracked-issue | protection/effective-rule/ruleset receipts show five gaps; detailed interpretation in blockers; #1588 |
| repository initialization/new board/duplicate cleanup | not-applicable | existing initialized repository and adopted existing Project #1; no creation or cleanup performed |
| promotion-branch protection readback | not-applicable | outside authorized development scope; not inspected, not proven |

[Readback index](readback/INDEX.json) identifies every bounded receipt, source and actual UTC read interval with SHA-256. [project-query.graphql](readback/project-query.graphql) records the exact safe field selection. Captures are raw gh stdout for the selected API fields with one terminal newline, not private authentication dumps. Project fields, view fields and repository connections each return fewer than their first:100 bound; no truncation is indicated by their counts. These observations prove readable configuration and permissions, not completed provider normalization or writes.

No product execution was needed for documentation-only custody/evidence remediation. Static structure, internal references, diff whitespace, scope and source hashes provide direct evidence for this slice. Natural CI is separate and must be refreshed on the final pushed head before landing.

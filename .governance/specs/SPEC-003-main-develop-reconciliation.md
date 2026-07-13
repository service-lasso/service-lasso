# SPEC-003: Main/Develop Reconciliation and Branch-Policy Recovery

## Intent
Restore `develop` as the complete and sole development source of truth after normal product work was incorrectly merged to `main`, without losing valid implementation, weakening verification, or treating `main` as a development baseline.

## Scope
Included:

- inventory every commit and changed file present on `main` but absent from `develop`;
- reconcile valid Broker, Service Admin integration, Core runtime, demo, documentation, and test changes onto an issue-scoped branch created from `develop`;
- resolve conflicts in favour of current `develop` architecture while preserving valid later behavior from `main`;
- repair contradictory repository workflow documentation and branch-protection expectations;
- validate the reconciled result before a pull request targets `develop`;
- correct affected issue/backlog states after the implementation is actually present and verified on `develop`.

Out of scope:

- merging ordinary development directly from `main` into `develop`;
- promoting `develop` to `main` as part of this recovery;
- force-pushing or rewriting either protected branch;
- declaring partially implemented backlog items complete solely because code existed on `main`.

## Requirements and Acceptance Criteria

- `BR-001` — `develop` remains the development source of truth. Recovery work starts from `develop`, uses an issue-scoped branch, and targets `develop` through pull request.
- `BR-002` — Every `main`-only commit and changed file is inventoried and classified as valid product work, promotion-only history, duplicate/superseded work, or conflict requiring an explicit resolution.
- `BR-003` — All valid `main`-only behavior is reconciled onto the recovery branch without replacing newer `develop` behavior or losing mandatory Broker, Service Admin integration, or Core functionality.
- `BR-004` — Build, unit/integration tests, and the canonical demo/baseline verification pass on the reconciled branch, with any environment-only limitation recorded explicitly.
- `BR-005` — Repository instructions and protection guidance unambiguously reject normal feature/fix/docs/chore work based on or targeting `main`; development agents must not inspect, fetch, compare, orient from, plan from, branch from, merge from, or target `main`. Only an explicitly authorised release-promotion, urgent-hotfix, or branch-reconciliation role may access `main`, and any hotfix is immediately reconciled back.
- `BR-006` — Issue and backlog states reflect reality: implemented-on-`main` work remains blocked/in review until it is present and verified on `develop`; partial work is not represented as complete.
- `BR-007` — Recovery uses no force push, branch rewrite, direct protected-branch commit, or unreviewed promotion.

## Tests and Evidence

- `git log`, merge-base, and tree-diff inventory for `develop...main`.
- Clean TypeScript build.
- Full automated test suite.
- Targeted tests for Broker generated-secret planning, Service Admin canonical demo/API behavior, action/workflow APIs, config history, audit persistence, runtime log streams, and smoke isolation.
- Canonical demo/baseline smoke where supported by the execution environment.
- Pull-request diff and status checks against `develop`.

## Documentation Impact

- Correct `.governance/project/GIT_WORKFLOW.md`.
- Correct `.github/branch-protection-checklist.md`.
- Update `.governance/project/PROJECT_INTENT.md` and `.governance/project/BACKLOG.md` with the recovery constraint and traceability.
- Record final reconciliation evidence and affected issue dispositions in the recovery pull request and issue `#850`.

## Verification
Reviewers must be able to trace each `main`-only product change to its reconciled file/test evidence and confirm that the resulting pull request is based on and targets `develop`. Passing tests alone do not authorise promotion to `main`.

## Change Notes

- 2026-07-13: Recovery initiated after normal development PRs were found merged into `main` while `develop` continued independently. Direct `main -> develop` merging was rejected as the working model; reconciliation is performed on `fix/ISS-850-main-develop-reconciliation`, created from `develop`.
- 2026-07-13: Reconciliation completed locally with 445 passing tests. During validation, telemetry was found actively probing arbitrary manifest health URLs; it now uses persisted/passive health evidence, and the external-URL sentinel regression passes without an outbound request.

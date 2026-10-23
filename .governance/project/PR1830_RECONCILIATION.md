# PR #1830 promotion ancestry reconciliation

Issue #1831; Development mode; SPEC-003 BR-001/BR-002/BR-003/BR-007 and
SPEC-008 R5/R6. The owner's request to review and fix #1830 authorizes this
bounded branch-reconciliation role. It does not authorize publication,
deployment, a GA declaration, or bypassing release qualification.

## Inputs and resolution

- Development source: `108ef9007de8137a393cacbf0c35bdf3ffa7b67c`.
- Promotion destination: `5ede9f1e931c4da4bf2e7afe0a574148f846b130`.
- Destination-only commits: squash promotions #1577
  (`c32048c5e75ae63e4e4c74a1ec3cc95c625f1b40`) and #1802
  (`5ede9f1e931c4da4bf2e7afe0a574148f846b130`).

The two promotion commits lack shared ancestry with their corresponding
development commits. Git's three-way merge therefore reports 21 conflicts,
although the current branch trees differ in only 61 paths. Review of those
tree differences found older promotion content superseded by current develop:

- Governance/spec/traceability/backlog additions preserve source-only status,
  unresolved native investigations and original acceptance gates.
- Grammar helpers retain committed-arrow failure handling, C# conditional-type
  disambiguation and correct absent PowerShell AST collection counts.
- TUI packaging/qualification retains paired native-owner inventory, extraction
  readbacks and cleanup failure reporting, with its associated regressions.
- Runtime and regression source retain immediate owned Windows launcher-tree
  shutdown on stdio EOF.
- Package/lock bytes retain newer development dependencies and security fixes,
  including DOMPurify 3.4.17 and ip-address 10.7.4.
- Docs retain the custom-domain root configuration and corresponding consumer
  paths, plus the Nextcloud lesson/deep dive and navigation.
- Release Qualification retains the additional source-grammar jobs.

No destination-only behavior requires restoring older file bytes. An explicit
`ours` strategy merge records the destination ancestry while preserving every
existing develop file byte. This record is the sole file added by the repair.
The initial repair branch originated from develop and targeted develop in
PR #1832. GitHub rejected its ancestry-preserving merge because both classic
develop protection and ruleset 21891323 require linear history. Neither
protection was modified. Squash/rebase would discard the second-parent
relationship needed to resolve #1830.

The owner then explicitly selected a replacement conflict-free release-branch
PR while preserving develop protection. `release/reconcile-develop-1831`
continues the prepared reconciliation, includes both pinned branch heads as
ancestors, and targets main under the existing release-reconciliation branch
policy. The replacement supersedes #1830 and #1832. Develop remains unchanged.
Creating the replacement does not authorize its promotion merge, publication,
deployment or a GA declaration. Exact-head release qualification remains
required before an independently authorized promotion.

## Conflict inventory

All paths retain their complete current develop version:

1. `.github/source-admission-traceability.md`
2. `.governance/project/BACKLOG.md`
3. `.governance/project/PROJECT_INTENT.md`
4. `.governance/project/RELEASE_TRACEABILITY.md`
5. `.governance/specs/SPEC-002-core-standalone-runtime.md`
6. `.governance/specs/SPEC-012-owned-test-fixtures.md`
7. `INIT-TODO.md`
8. `docs/getting-started/README.md`
9. `docs/sidebars.js`
10. `package-lock.json`
11. `package.json`
12. `scripts/operator-tool-packaging-lib.mjs`
13. `scripts/qualify-docs-consumers.mjs`
14. `scripts/verify-operator-tui-conpty-scoped.mjs`
15. `scripts/verify-operator-tui-pty-scoped.mjs`
16. `src/index.ts`
17. `tests/helpers/core1562-powershell-retention-ast.ps1`
18. `tests/helpers/core1681-selected-javascript.mjs`
19. `tests/helpers/core1681-selected-syntax.mjs`
20. `tests/operator-tool-packaging.test.js`
21. `tests/stdio-runtime-shutdown.test.js`

## Verification and limits

Before adding this record, the staged tree equals the original develop tree
exactly. After adding it, the only diff against that input must be this file.
Git diff hygiene, merge parents and ancestry are checked before push; provider
mergeability is read back on the replacement PR. These are direct ancestry/file-byte
proofs, not executable behavior or native qualification.

No local dependency install, product import, parser, compiler, build, test or
native helper is required or executed for this byte-preserving repair. Natural
push/PR CI remains separate evidence. BR-004 runtime qualification and the
required `qualify-release` gate remain independently required on the exact
candidate; prior-head results cannot qualify a new head. The 895-file historical
three-dot PR diff is not claimed as a fresh whole-product/security review.

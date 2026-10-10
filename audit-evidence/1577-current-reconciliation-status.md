# PR #1577 reconciliation: current generated-artifact status

## Scope and source checkpoint

This status record supports `SPEC-003` `BR-001` through `BR-007` for the
corrective `develop` pull request.  It records a bounded generated-artifact
inspection after the raw conflict decisions; it is not a release qualification,
promotion decision, or a replacement for the historical planning receipts.

The complete `BR-002` base-side commit inventory is recorded in
[`1577-main-only-commit-ledger.md`](1577-main-only-commit-ledger.md), with
every path resolution retained in the companion 259-path JSON ledger.

The inspected source checkpoint was
`79b34f217364e5faf29108c28f55e517b29ae367` with tree
`730addafca9a76619a7a18fbbe9bca237233c13d`.  Its external initial receipt
recorded a clean tree and 910 tracked paths, then rechecked every recorded
SHA-256 value with no mismatch.  The original receipt and its runtime-isolation
addendum remain historical custody records for that checkpoint; they are not
rewritten to claim a later candidate.

Any final qualification must bind a new immutable checkout to the exact commit
created after this status record.  This document deliberately does not name
that future commit, preventing a self-referential current-HEAD claim.

## Generated documentation and audit artifacts

`npm ci --ignore-scripts` accepted the tracked lockfile without a tracked
`package.json` or `package-lock.json` change.  The lockfile is version 3; its
root dependency declarations match the manifest's six dependencies and eleven
development dependencies by key and value.  That is lockfile coherence
evidence, not a regenerated lockfile claim.

`npm run docs:build` generated the static site successfully from the isolated
generation clone.  Docusaurus emitted repeated warnings while its hardened
image-size parser deliberately declined to inspect
`docs/static/img/newcomer/echo-detail.png`; the terminal output still reports
successful static-file generation.  The generated site and raw command output
are external support artifacts, not release or runtime acceptance evidence.

No repository-local generator references `repository-docs-audit.json` or
`reader-guide-classification.json`.  Their recorded provenance is the
exact-source multi-repository review series ending in commit
`0d8986974158d8777bc5d30af30f761364d23761` (`#1417`), which refreshed
accessible source-tree identities and bounded migration decisions.  Replacing
those historical ledgers from this checkout would invent a current
multi-repository audit, so both inventories are retained unchanged.

## Diff hygiene and outstanding qualification

The future `7582076..79b34f` diff contains trailing whitespace in retained raw
failure evidence and JSON records.  Those bytes are historical evidence and
must remain exact.  The six non-evidence lines are limited to
`scripts/verify-mcp-packaged-bootstrap.mjs` and
`tests/windows-confirmed-exit.test.js`; their line-ending-only cleanup is
separate from the preserved evidence bytes and changes no JavaScript behavior.

Hosted exact-head workflows are pending separately.  `BR-004` still requires a
new exact-head build, full suite, and supported canonical baseline evidence;
this generated-artifact record does not waive any of them.  PR #1577 remains
unmerged and no `main` promotion, GA, publication, or deployment is authorized
by this status.

The first exact-head typecheck exposed an unresolved reconciliation typo in
the Windows tree-control snapshot: verified-member comparison must use the
fresh `currentTree.members` map already built from the inspected tree.  The
repair must preserve fail-closed identity comparison and is paired with the
existing Windows tree-control snapshot regression before a new candidate is
qualified.

The subsequent exact-head qualification started from a fresh detached
`ba19f1bdea1ef7026c45c8964bdfcb66b87b1740` checkout after independent source
review. Its dependency acquisition, clean build, and typecheck passed, but its
full isolated suite recorded two corrective findings before the run reached a
terminal receipt: the concurrent durable HTTP replay fixture closed its owned
server and removed its workspace without awaiting its two accepted operations
or stopping its fixture-owned services; and the packaged launcher assertion
required a one-line invocation even though the retained launcher integrity,
deadline, launch-state, second integrity check, and managed-spawn ordering is
present across whitespace. The corrective candidate must await only those
fixture-owned operations, close those fixture-owned services before cleanup,
and make the assertion whitespace-tolerant while retaining the full ordered
control invariant. This is not a BR-004 pass, baseline result, promotion, or
release claim; the raw failure-bearing receipt remains authoritative until a
new exact-head qualification completes.

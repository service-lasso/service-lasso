# PR #1577 immutable base-side commit ledger

This completes the `SPEC-003` `BR-002` commit inventory.  The raw range is
merge base `c3a454a8c5f00615c4f92aee8e49339f01e94d97` (exclusive) through
base `7582076d351cb03a12d89aec771566d5c1eaf5c4` (inclusive): exactly twelve
commits.  The companion
[`1577-main-only-classification.json`](1577-main-only-classification.json)
is the 259-path resolution ledger.  A commit classification applies to its
raw diff-tree path set; path-level resolution remains authoritative where a
commit includes several concerns.

| Immutable commit | Subject | Paths and relationship to current reconciliation | Classification and current mapping |
| --- | --- | --- | --- |
| `4fd7937e75bc2527a9f88eb2ed9c2c5356ac6c74` | release: publish latest runtime and quick-start documentation (#1276) | 79 paths: governance intent/backlog/spec, reader docs, Docusaurus UI/assets, PostgreSQL example, package manifest, help exporter, and demo test. | duplicate/superseded: the current `develop` reader and governance set is retained by the 259-path ledger; inventories are retained as historical exact-source audits. |
| `456d1631cbe13351648e254639eeecf4c329ef0e` | docs: reconcile migration and newcomer acceptance ownership (#1284) | 3 paths: backlog, documentation migration, newcomer verification. | duplicate/superseded: current backlog and migration ownership are retained; `docs/development/newcomer-verification.md` remains governed by its current qualification boundary. |
| `f89fb09d41b83653cbcb66ed823e6f57fe251500` | fix: harden release acquisition and Windows tree snapshots (#1279) | 4 paths: process identity, release acquisition, and their two tests. | conflict: current `src/runtime/process/identity.ts` is the retained head implementation (`c089a881`) with `tests/process-ownership.test.js`; acquisition behavior is retained only where present in current source and must be covered by exact-head tests. |
| `36b6a2622f6ead22d63aa9e4c5649dbdb35518e4` | docs: classify remaining reader guide sources (#1286) | 4 paths: backlog, migration guide, reader classification, repository audit. | duplicate/superseded: current exact-source audit series owns these ledgers; no local regeneration substitutes for that multi-repository record. |
| `860639d8c34a08563043dc96df9bbb73b554e832` | docs: migrate reader workflows into core (#1288) | 6 paths: backlog, component/migration guides, workflow guide, reference and authoring guide. | duplicate/superseded: current component/docs navigation is retained by the path ledger. |
| `88fb2efb2447fa60b015f4d75816dd4fbf04d110` | fix: harden operator capture proof setup (#1290) | 5 paths: newcomer/capture docs, canonical/worktree scripts, demo-instance test. | duplicate/superseded: current capture contract and later demo scripts/tests supersede this intermediate setup. |
| `26754eae96a9ac472609139c2d22b36b323f8886` | fix: reuse hardened Windows DPAPI helper (#1293) | 3 paths: private JSON, startup materialization, private JSON test. | duplicate/superseded: later current security/materialization behavior is retained; exact-head test evidence remains required. |
| `35f3b3aa49688814cc50a91dddc43622b9a26609` | docs: record post-1290 capture blocker (#1291) | 1 path: operator capture manifest. | duplicate/superseded: current capture manifest retains later status without erasing historical failure evidence. |
| `0fce0f267b34d2282b11e6f5b77878a4909fd000` | fix: allow linear release reconciliation branches | 1 path: branch-policy workflow. | promotion-only: current `develop` branch policy is retained; this base-side release-flow adjustment is not used as development input. |
| `c5e1c22c4c594c23a314548a5f1a36ec5b245df9` | chore: reconcile develop documentation for release (#1316) | 34 paths: governance/docs/navigation, package pair, capture/demo/release scripts, startup/server/CLI/runtime code, and paired tests. | duplicate/superseded: current source owns the later server/runtime and documentation variants; package lock coherence is separately verified, never copied wholesale. |
| `41ea909d0470a9d4660d70da851cfd37b3ba1386` | docs: publish approved Service Admin tour assets (#1320) | 9 paths: tour guides/images, capture script, and capture test. | duplicate/superseded: current guides/assets and capture contract are retained by the path ledger. |
| `7582076d351cb03a12d89aec771566d5c1eaf5c4` | release: promote develop 9b43f17 to main for Release 1 GA (#1406) | 93 paths: release/workflow/governance/docs, PostgreSQL/demo/newcomer tooling, runtime lifecycle/process/security, and paired tests. | promotion-only plus conflicts: the promotion itself is never imported; the four semantic runtime paths and paired tests are resolved to current head behavior in `1577-raw-conflict-resolution.md`, while all remaining paths follow the 259-path ledger. |

The classifications preserve the valid behavior that was independently present
on current `develop`, while retaining promotion records and historical failure
evidence as history.  They do not claim that base-side commits were merged,
that the release was requalified, or that `main` may be promoted.

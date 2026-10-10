# PR #1577 raw conflict-resolution record

## Inputs and method

This record resolves the PR's conflict set from raw Git objects, rather than
the branch labels or the earlier classification prose.  The immutable inputs
are merge base `c3a454a8c5f00615c4f92aee8e49339f01e94d97`, PR base
`7582076d351cb03a12d89aec771566d5c1eaf5c4`, and PR head
`a5a5f07ceddbdef890477549381a8752eb023715`.  Every conflict was compared
against the merge base.  The current candidate is `be7250fb`; its server
parser correction is an additional source change.

The raw object check establishes that `a5` contains the more complete current
runtime and test behavior: supervisor `b3c5ab6`, actions `7d909270`, identity
`c089a881`, server `3a50929`, lifecycle-action tests `6485ee10`, lifecycle
diagnostic tests `53cb64a9`, and process-ownership tests `386ac767`.  The
opposite side (`758`) contains the older corresponding blobs.  Any account
which calls these sides the other way is not a reliable basis for resolution.

## Per-conflict decisions

| Area | Path | Resolution and behavior mapping |
| --- | --- | --- |
| Runtime | `src/runtime/execution/supervisor.ts` | Retain head `b3c5ab6`: it carries log/variable integration, serialized workspace finalization, native acknowledgement containment, held-handle identity, and launcher payload boundaries.  The base-side implementation is superseded.  Covered by `tests/process-ownership.test.js` and lifecycle diagnostics. |
| Runtime | `src/runtime/lifecycle/actions.ts` | Retain head `7d909270`: it carries serialized start/readiness and restart trace handling.  Covered by `tests/lifecycle-actions.test.js`. |
| Runtime | `src/runtime/process/identity.ts` | Retain head `c089a881`: it carries bounded Windows inspection, partial-copy receipts, chronology/ancestry checks, and progress metadata.  Covered by `tests/process-ownership.test.js`. |
| Runtime | `src/server/index.ts` | Retain head `3a50929` durable MCP, reconciliation-context, audit, and staged-transfer routes, plus the `be7250fb` closing-brace and duplicate-member-parser repair.  Transfer route tests exercise the resulting request grammar. |
| Tests | `tests/lifecycle-actions.test.js` | Retain head `6485ee10`, paired with lifecycle serialization/readiness/restart traces. |
| Tests | `tests/lifecycle-failure-diagnostics.test.js` | Retain head `53cb64a9`, paired with closed diagnostic projection and failure boundary handling. |
| Tests | `tests/process-ownership.test.js` | Retain head `386ac767`, paired with process inspection, containment and finalization behavior. |
| Diagnostics | `scripts/lifecycle-failure-diagnostics.mjs` | Retain head `7fd81860`: project only closed restart, payload-boundary and Windows-tree metadata; do not retain raw error data. |
| CI | `.github/workflows/lifecycle-process-tree.yml` | Retain head `f092379f`: current Windows provenance/process-tree control. |
| CI | `.github/workflows/release-qualification.yml` | Retain head `6d7d73e5`: exact-head custody and qualification control. |
| Governance | `.governance/project/BACKLOG.md` | Retain head `bafa76cb`: current issue state and traceability. |
| Governance | `.governance/project/PROJECT_INTENT.md` | Retain head `52bbce18`: current safety and release boundaries. |
| Governance | `.governance/specs/SPEC-002-core-standalone-runtime.md` | Retain head `00c96489`: current runtime acceptance requirements. |
| Docs | `docs/README.md` | Retain head `2b75d281`: current reader entrypoint. |
| Docs | `docs/components/README.md` | Retain head `eaeaebd4`: current component inventory. |
| Docs | `docs/components/app-owned-service-workflows.md` | Retain head `bea6260d`: current workflow guidance. |
| Docs | `docs/components/documentation-migration.md` | Retain head `be2c88bb`: current migration status. |
| Docs | `docs/components/reader-guide-classification.json` | Retain head `94e5516b`: inventory paired with the current guide set. |
| Docs | `docs/components/repository-docs-audit.json` | Retain head `f1013fab`: audit paired with the current inventory. |
| Docs | `docs/development/ga-candidate-dossier.md` | Retain head `72e597e1`: current candidate evidence, without a new GA claim. |
| Docs | `docs/development/newcomer-candidate-qualification.md` | Retain head `7b3addaa`: current qualification evidence. |
| Docs | `docs/documentation-map.md` | Retain head `e9adea6c`: current navigation map. |
| Docs | `docs/getting-started/README.md` | Retain head `0284872a`: current getting-started map. |
| Docs | `docs/operator-ui/capture-manifest.md` | Retain head `784c6dd8`: current capture contract. |
| Docs | `docs/reference/README.md` | Retain head `18ecab8b`: current reference index. |
| Docs | `docs/reference/release-1-ga-decision.md` | Retain head `19bf9033`: historical decision record; no reinterpretation as fresh qualification. |
| Docs | `docs/releases/README.md` | Retain head `c5503bdb`: current release index. |
| Docs | `docs/security/README.md` | Retain head `412979e9`: current security guide index. |
| Docs config | `docs/sidebars.js` | Retain head `6db9539d`: routes every retained current document. |
| Packages | `package.json` + `package-lock.json` | Keep head lock `f13cc5c1`; the candidate manifest `a94b3fab` removes duplicate manifest entries while preserving the locked dependency graph.  A lockfile regeneration is not claimed by this source record. |

## Residual status

This is source reconciliation evidence only.  It neither qualifies a release
candidate nor authorizes a merge of PR #1577 into `main`.  Any dependency,
documentation-inventory, or qualification generation must use a fresh,
separately receipted input tree after this source record is committed.

# Bootstrap Adoption TODO

This file tracks bootstrap/adoption/remediation work required before product implementation.

## Commit Policy

- Current bootstrap update run policy: `allowed`

## Dirty Start Resolution

- Starting repo state was dirty because bootstrap feedback artifacts were already present but uncommitted.
- Resolution used for this update run: normalize those artifacts into the current bootstrap-update output rather than discard or ignore them.

## Open Items
- `#1587` VibeGov bootstrap update is in review. Current reporting now lives in `.governance/project/bootstrap/` and its current linked repair history bundle (original `history/2026-10-02T07-53-15Z/` remains partial history). Do not extend the legacy `BOOTSTRAP_*.md` or `bootstrap-runs/` layout for new runs.
- GitHub Project `service-lasso Delivery` (#1) was read-only audited. API readback shows its default `View 1` table has `Title`, `Status`, `Labels`, `Repository`, `Project Priority`, `Priority`, `Order`, so it does not meet the required visible columns/order. Issue `#1588` tracks provider-side remediation; the user did not authorize provider-setting mutation in this run.
- Project Priority currently includes an additional `P5` option alongside required `P0`–`P4`. Preserve existing board options and assignments. A project administrator must decide whether to retire or retain it, then document the decision; do not destructively replace field options during a bootstrap update.
- `ISS-1463-implementation`: retain remote-develop implementation traceability, local direct proof, independent whole review, and separate owner-catalog/TAR T1-T5 blockers.

  On 2026-10-02, the prior native-acceptance attempt stopped at a TypeScript
  parser failure before the focused transfer suite could start. Its retained
  preliminary result and raw preflight are failure evidence only. The current
  #1566 repair begins from the current `develop` ancestry on
  `fix/1566-transfer-native-acceptance`, restores a compilable source tree,
  and must run a new externally observed native acceptance after a fresh,
  exclusive source checkout. It does not alter the owner-catalog or TAR T1--T5
  blockers below.

  The corrective durable-attachment slice writes the exact claimed byte object,
  metadata, manifest, and composite publication receipt privately, synchronises
  file and supported directory boundaries before publication/outcome sealing,
  and revalidates completed replay without a fetch or second import. Focused
  local crash evidence does not close the owner-catalog, TAR T1--T5, exact-head
  CI, independent-review, release, or GA gates.

  Core #1566 additionally makes the co-resident registration operation / staged
  journal authority use that same checked-in, provenance-attested Windows
  directory-flush boundary after its atomic replacement. A helper, launch,
  identity, flush, close, or provenance failure remains unavailable before
  acknowledgement and retains recovery state; this is not a power-loss claim
  or a waiver for retained EPERM / STOP_FAILED investigations.

- #1463 defines a release-asset-only staged transfer prerequisite in
  `docs/api/staged-service-transfer.md`. It uses a new reviewed
   staged-registration adapter over #1462 / PR #1464 (`a83133cc`), rather than
  asserting the old `confirm:true` API already has stage fields. It derives
   a non-draft published release/tag/full-SHA tuple, canonical release checksums,
   exact asset IDs, release API byte sizes, trusted workspace identity, and a
   single claimed Core-held byte object server-side, so client lengths, digests,
   workspaces, and archive sources are not trusted. The direct-child importer
   must consume that exact byte object once and cannot redownload or substitute
   it; registration remains separate from later install/acquire materialisation.
   It requires only explicit per-OS policy assets (no `default` or generic
   fallback), exact actor/header precedence, fixed actor/workspace quota
   ceilings, and durable retention of uncertain recovery capacity. Canonical
   `service.json` must be a separately identified same-release service-producer
   asset/member, not an ordinary archive scan or Core runtime inventory entry.
   #1524 now proposes a fixed `service-lasso-release-policy.json` v1 asset and
   a dedicated `service.json` release asset in
   `docs/reference/service-producer-release-policy.md`; independent review and
   the service-producer owner's per-repository catalog pin remain mandatory
   before #1463 can resolve or admit a stage. `release-archive-profile-v1` keeps
   the full release surface:
  ZIP plus a closed gzip TAR grammar for Linux/macOS assets, including bounded
   GNU-longname and POSIX-PAX path records, with PAX `size` required to equal
   the raw following header in both directions. Current TAR admission remains
  unimplemented and blocked on fresh independent review, GNU/Linux and
  BSD/macOS real-producer fixtures/receipts, byte-level parser evidence, and
  the checksum-bound released CLI/TUI/Core journey on all three OSs. This is a
  qualification gate, not a denial of Linux/macOS releases. Implementation
  must not create a generic upload route.
  Locally authored template/source admission remains open in #1513 (`SPEC-002` /
  `SPEC-006 AC-6E`; CLI #1/#8), outside #1463.

- `#1513` is a product-spec prerequisite for remote client-local template-project admission, not bootstrap completion. Before Core implementation, the owning `service-template` repository must release the immutable machine-readable template contract, allowed-difference policy, provenance schema, fixtures, and verifier mapped in `docs/reference/source-safe-template-admission.md`; service-template `#17` tracks that prerequisite so Core does not invent template ownership policy.
- Long-lived branch model is `develop` for governed implementation and `main` for promoted releases. Normal feature/fix/docs/chore branches merge through PR and are normally deleted after landing; `archive/` is only for stale, unmerged, or intentionally retained history. The workspace returns to clean `develop` before the next issue.
- Keep issue `#1164` security settings, active ruleset, branch protection,
  CODEOWNERS, immutable Action pins, CodeQL/dependency review, Dependabot, and
  approval-gated release environment aligned and verified by API readback.
- Lane AN recorded AC-7H approve-with-accepted-residuals for Core/npm
  `2026.9.11-462f837`. Operator-published Latest is `2026.9.13-1bffd1b` /
  `1bffd1bca177de213e3a0bd3efb54125dc5cf107` (also on `main`). That later SHA
  is a post-review delta, not a second AN signature. The reject of
  `2026.9.1-1f4ec40` remains in force for that older identity. `#1151` stays
  open until independent review of the later bytes or an explicit operator
  close with that residual.
- Historical product/bootstrap adoption milestones are recorded in `.governance/project/BACKLOG.md`. Current bootstrap status is authoritative in `.governance/project/bootstrap/STATUS.md`; do not claim full bootstrap configuration while #1588 provider-side remediation remains open.
# Active development remediation

- [ ] `#1505` (`SPEC-002` `AC-4BZ.3`): add and independently review the exact-`develop`, nonpublishing Core development-candidate workflow required for CLI #6 packaged-Core acceptance. Keep `Release Artifact` and `Publish Package` unchanged; hosted execution remains a post-review gate.
- Active governed remediation: `#1552` is bound to `SPEC-002 AC-4BH` and the current backlog. Its scoped pre-root branch exclusion must retain the existing `develop`-derived branch/PR workflow, exact-head qualification, and all ownership, deadline, containment, native-provenance, and unrelated-process safety controls.
- Active governed remediation: `#1539` remains bound to `SPEC-002 AC-4BY.2`. Repair the owned Windows consumer launch only through the pinned Node/`pnpm.cjs` argv path and deterministic bounded fixture custody. Every pre-browser stage fixture must provision the real pinned `pnpm@11.25.0` bootstrap and its `10.34.5` self-update; the controlled action-binding failure must bind a real selected Windows `.cmd` or `.exe` PATH command to a different real reported action bin under a literal spaced action root, without Node shell interpolation or missing-environment substitution. A caller-establishment failure before Core acquisition or browser execution must retain only a closed run/attempt/platform/stage artifact paired with its exact closed initial receipt, while both aggregates preserve it, read exactly one positive-integer terminal failed job with the requested run and attempt through their existing authority, and retain the failed job as primary; stale, duplicate, invalid, missing, or unobserved provider identity fails closed. All three unique workspace, instance-registry, and host-port-registry paths must be created and emitted into the runner environment before dependencies; GitHub's job-level `env` cannot read `runner.temp`. No Core, receipt, exit, or correlation identity may be invented. Preserve PR #1540 failures `36799800406`/`110171350993` and `36799800318`/`110171350530`, plus zero-job workflow failures `36916405039`/`36916406332` at `2a4c7404533e4b661d3a3a38caec776536271051`; use an exact lockfile-declared package fixture rather than ambient `node_modules`, and retain all original receipt/aggregate rejection rules. Fresh terminal exact-head three-OS hosted qualification remains required.
- #1465 is mapped in the active backlog and `SPEC-006`; its bounded HTTP lifecycle-operation adapter remains subject to exact-head CI and packaged client reconciliation before closure.
- #1553 remains active under `SPEC-006 AC-6F`: durable reconciliation authority may be freshly created only when its bounded protocol records and exact named backup, migration, and writer-temp custody artifacts are absent. Residue is a fail-closed condition; no workspace-wide scan, sidecar adoption, cleanup, or replacement authority is permitted. Direct HTTP test fixtures must await their owned initialization settlement before deleting a workspace and retain state when startup is unknown or failed. Actual initialization rejection must propagate without an unhandled rejection or false ready state. MCP authorization Audit test hooks receive a closed redacted projection while the production appender retains the workspace context required to persist the event.
# #1582 Core/CLI job transaction successor

- [ ] Bind Core durable job authority and CLI #32 transport to `SPEC-009`.
- [ ] Preserve the PR #32 native CI failure and repair all target executable
  naming without retrying or weakening the primary gate.
- [ ] Before any dependency install, build, test, or Core import, retain the
  required isolated external runtime custody record and obtain parent readback.
- [ ] PR #1586 / ISS-850 / BR-008 C1/C2/C3 source repair: stable directory replacement identity, strict public-v2 two-key consumers, exact existing-head grandfathering. Fresh full source review and external ROOT admission precede any execution; no provider protection/check bypass or generic codex namespace admission.

## Issue #1597 entire PR #1586 source repair

SPEC-003 BR-008 implementation child of delivery epic #1562. Sole successor custody is explicitly accepted on the retained clean d33f78e PR head; the existing branch and develop target are preserved under the bounded GOV-10 recovery exception. Closed historical #850 remains closed.

All eight review groups are one coherent acceptance unit: separate Admin checkout custody and exact tracked Core inventory; literal workflow candidate/platform; raw Git blob/tree/commit/index replay; exact tool/native/runner/caller/metadata bindings; literal run and root/registry roles; held versus named file identity and verified-byte parsing; complete owned bootstrap helper/raw/script/actual-child closure; isolated host-native production fixtures and coherently resealed adversaries. Existing observation architecture, private/public boundary, three-OS/compiler/product/native/operator gates and protected assertions remain required.

Source authoring and static metadata/hash inspection only. No source import, Node/npm/compiler/syntax/test/native ACL/lifecycle execution before a fresh independent ENTIRE SOURCE GO and NEW complete-input ROOT admission. Freeze/push the complete bundle for independent review; no execution or acceptance claim follows from authoring. Earlier failures and direct-versus-surrogate limits remain preserved.
- [ ] Issue #1597 / PR #1586: source bundle authored for all eight groups; entire independent review and NEW ROOT admission pending. No native/runtime/compiler/product/operator acceptance inferred. Separate full exact Admin tracked-byte custody precedes dependencies after initial Core custody, and before-checkout Git byte policy binds raw tracked source.

## Issue #1597 final entire-review F1-F3 repair acceptance

Development source-only continuation from clean retained 4f44312; entire current review remains SOURCE NO-GO. BR-008 requires: F1 privately stage/fsync projection bytes, complete actual owned validator natural terminal exit/EOF/raw equality and exclusive private seal/write/fsync before atomic exclusive public eligibility; terminal/seal/write/fsync/crash failures leave no acceptable public projection. F2 preserve all seven actual Darwin adversaries, fresh validator terminal state, complete journal/receipt/bootstrap reseal, intended cache-error predicates and valid native counterpart. F3 requested library must resolve to the same physically held bytes and non-reparse parent closure at actual native observation, including helper/bootstrap executable/library paths; coherent Windows substitutions and real persistent/changed parent cases remain required. Darwin proof stays bounded cache-header evidence.

Separately inherited from develop: receipt-custody timeout fixture has a permanent interval while consumer waits natural exit. Replace only that fixture with an independently owned finite natural exit and prove original 25ms timeout classification plus natural code/signal/stream closure. No consumer deadline, signal, permissions or protected acceptance scope changes. All prior eight repairs, public-v2 privacy/shape and complete three-OS/compiler/native/operator/product gates remain required. Sources/fixtures remain UNEXECUTED; fresh independent ENTIRE cumulative review and NEW complete-input ROOT admission precede execution. Preserve failures/private roots; no main, nested agents, rerun, controls, cleanup, merge or publication.
## Issue #1597 published normal-path contract repair (d7 successor)

Development source-only continuation from exact clean d7d9056b, under retained PR #1586 ownership. BR-008 requires the workflow Admin harness pin to equal the existing canonical 90caf8cf0f8e3c599a1a5022936813ac8bf0983b used by preparation and recorder. This aligns an existing source contract and does not claim that revision is natively qualified; released Admin f015b444 remains separate and unchanged.

Normal preparation must validate and retain the exact public-v2/private-v3 projection before downloads or mutation. Normal recording must require that prepared binding to match the current independently validated projection; aggregate must require retained binding equality to the separately uploaded projection, including candidate head/tree, platform/run, private receipt/journal hashes and the exact two-key validator attestation. Obsolete fabricated v1/CLOSED/nativeFileCount19 evidence is forbidden. All current product/job/receipt/privacy/inventory and three-OS gates remain unchanged.

Protected fixture change is explicitly requirement-bound: replace the stale literal pin assertion with equality to its canonical owner, repair the retained-evidence positive fixture to actual public v2, and add actual normal preparation/recorder/aggregate caller coverage with wrong pin and missing/stale/expanded/wrong candidate/run/hash negatives. Offline acquisition/API fixture observations are contract proof only, not real release/native/product acceptance. Source fixtures remain UNEXECUTED until a different fresh ENTIRE SOURCE GO and NEW complete-input ROOT admission. Preserve all previous 8+3 repairs and finite timeout fixture. Parent owns tracking; no provider settings, dispatch, rerun, merge, publication or cleanup.
F2 actual inventory disposition: the published workflow retains intermediate qualification-state.json under its existing private custody root, outside the public upload directory. It is not deleted, and the aggregate still requires exactly initial-projection.json, terminal platform evidence and trusted-unlock receipt. A fourth uploaded state file remains a rejected inventory expansion. This corrects the normal caller path; it grants no additional private-data publication or cleanup authority.
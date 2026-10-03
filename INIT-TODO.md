# Bootstrap Adoption TODO


## Current GA applicability (2026-10-04, #1613)

- [ ] PR #1614 documentation acceptance repair (SPEC-007 AC-7F): validate explicit current platform authority and preserved requirements; retain historical three-platform contracts; repair the external canonical-source site link; freeze/push for different entire review and NEW ROOT admission. No local execution, dependency upgrades, qualification producer/aggregate changes or gate weakening in this unit.

The owner's current GA delivery scope is Windows and Linux under [current GA platform scope](.governance/project/CURRENT_GA_PLATFORM_SCOPE.md). Older three-platform/macOS obligations below retain their historical/default meaning; macOS is Deferred / Not applicable for this GA, never PASS. All Windows/Linux product, native, operator, template, immutable-publication and same-byte evidence remains required. Existing executable three-platform gates are unchanged and require coherent separately reviewed propagation before two-platform readiness can be claimed. No current exact qualified candidate or deployment is established by this scope decision.

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

- [ ] `#1592`: reconcile the formatting-sensitive MCP source assertion under
  `SPEC-002 AC-4BH/AC-4BJ` and `SPEC-003 BR-008`; retain original failed attempts,
  current native controls and UNEXECUTED runtime classification. Require fresh
  external exact-input custody, ROOT actual-read admission, whole independent
  review and exact-head natural qualification before acceptance.

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

- #1326 fixture-custody remediation: spec/intent/backlog recorded before code. Static preparation only; build/tests/native execution require fresh complete-input ROOT admission. Preserve all unresolved fixture evidence.

2026-10-02 entire-source review repair (#1326 / PR #1596): actual registry persistence classification must accompany the document at the fixture boundary; missing/corrupt/read-failed evidence is unresolved, never a synthesized empty authority. The existing gated enrollment-hook registration may observe a record-local append-only fingerprint history before managed enrollment or adopted refresh; every authoritative discovery/refresh augments that private history, including after startup failure and record deletion. This fixture-only reader never changes production membership or signaling decisions and creates no global custody store. Before recursive removal, copy and verify the complete closed fixture privately outside its removal root; retain that independent copy on partial removal, reset, environment restoration, or diagnostic failure, and report actual original/copy state separately. Regression preparation must use real persistence readers, supervisor enrollment/refresh/finalization, and filesystem partial removal. No execution occurs before exact-head complete-input ROOT admission. The existing open issue branch is deliberately retained for PR review/landing; it is neither a new branch parent nor abandoned work.

#1326 source bundle now prepares all four repairs and real-path regressions; observer activation/error containment, append-only histories and separately reported verified-copy/original/reset/environment outcomes are specified in SPEC-002 and docs/reference/startup-hard-crash-matrix.md. Implementation remains unexecuted; independent entire source review and new complete-input ROOT admission precede any runtime proof. Backlog remains in_progress pending those gates.

2026-10-02 final9a2 entire-review successor (#1326 / PR1596, AC-4BH.2/AC-4BJ.9c): source-only repair covers ALL FIVE findings. Fixture history admits only identities accepted after root/held-child, accumulated exclusion and prior-fingerprint checks; previously accepted lifetimes remain. Original named/held root and ancestor identity must bind the destructive boundary and reject replacement/redirection while preserving a complete independent copy. Directly spawned adoption children require bounded closure even before enrollment; hook/environment restoration is unconditional and errors aggregate. Establish and verify original Windows private ACL/no-reparse ownership before fingerprints are written, including retained failures. Every failure stage has closed safe diagnostics and private raw-error retention; recovered tests must identify pre-injection failures without exposing private details. All seven formal Windows/Linux phases and actual production regressions, deadlines, retries, identity, privacy and absence assertions remain required. Current seven Windows failures and all historical attempts remain failed/unattributed. Whole source review plus NEW complete-input exact-head ROOT admission is required before any execution; no source GO, runtime qualification or closure claimed.

### Complete6ae review successor: seven custody boundaries (#1326 / PR1596)
This bounded source-only successor addresses F1-F7 together under AC-4BH.2 and AC-4BJ.9c. Unsupported destructive guarantees are fail-closed failures, never successful cleanup or changed production authority.
1. POSIX name-based unlink/rmdir cannot condition deletion on the approved inode. No validated exclusion of every same-owner namespace/content writer is available: do not perform deletion; retain the original and independently verified copy, and do not reset. A last-validation intervention regression must preserve replacement and original bytes.
2. Windows root/ancestor handles do not bind later descendant opens to preserved identities/bytes or exclude additions/writes. Do not acquire a fresh deletion inventory or delete descendants/root without validated exclusion: fail closed retaining original/copy. Prepare after-inventory substitution/addition/content regressions. Holding share3 is not writer exclusion.
3. Only the gated fixture reader strictly validates every raw current ownership row before normalization, rejecting dropped rows, malformed PID/fingerprint, inconsistent active/null identity and mixed valid/invalid rows. Production normalization/empty semantics remain unchanged.
4. A conflicting prior PID lifetime must reject only that new lifetime, retaining all separately accepted nonconflicting members. Earlier accepted lifetimes survive omission and finalization. No signaling/deadline changes. Prepare actual supervisor mixed-conflict/new-member then omission/finalization coverage.
5. No chmod or ACL mutation may precede prior owner/no-redirection proof or target a switchable name. This successor chooses verification-only privacy: acquire owned nonredirected original/ancestor custody before privacy validation; never reset an unknown owner or repair unprotected ACLs by name. A root requiring protection fails closed before sensitive writes. Privately provisioned Windows roots remain a separate ROOT prerequisite, not an implicit permission change. Public initializer/protector regressions retain outside bytes and permission state.
6. The formal caller uses direct_child, matching the closed schema, with caller-level injected close-failure coverage and no private public fields.
7. Public initialization diagnostics use fixed safe substage categories. Full failed initialization evidence requires an independently pre-established private sink and accessible owner-approved private transfer independent of the rejected diagnostic privacy prerequisite. Prepare the concrete protocol/owner proposal in docs/reference/hard-crash-private-evidence-protocol.md; no public raw artifact upload, invented key/destination, ACL widening, or successful-run substitution. Until owner authority and exact-head ROOT admission supply that sink/transfer, accessible private cause is unavailable and F7 runtime acceptance remains blocked.
All seven formal/recovered matrix assertions, actual native keeper identity, ENV restoration, privacy/copies and production controls remain protected. The existing removal/reset expectations remain failed gates under fail-closed retention; they are not silently rewritten to passes. Source preparation is neither SOURCE GO nor runtime acceptance. Fresh entire source review and NEW complete-input ROOT admission must precede any source execution, import, syntax/compiler check, dependency installation, test, native ACL or lifecycle action. Original/historical failures remain failed and unattributed.
Seven-finding successor refinement: F5's earlier verification-only fallback is superseded by the supported held POSIX fchmod and handle-bound Windows GetSecurityInfo/SetSecurityInfo preparation in SPEC-002 and tests/fixture-privacy-custody.js. Reject prior unknown owner, redirection, unsupported/shared-link objects before mutation; never reset owner, grant privileges or mutate SACL. Existing formal/native assertions remain intact. F1/F2 fail-closed retention still leaves positive deletion/reset/full-matrix UNMET. F7 independent private sink/accessible transfer is NOT implemented/accepted; docs/reference/hard-crash-private-evidence-protocol.md records the exact owner/protocol dependency. New Windows helper and ROOT-provisioned foreign-owner laboratory fixture/ENV require complete new admission. Entire seven-bundle source remains unexecuted, in_progress awaiting independent review and dependencies; no source/runtime/cause/goal completion.

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

## Issue #1597 current ccd hosted fixture reconciliation

Development source-only successor accepts sole custody of clean ccd33536 / PR #1586 under the existing bounded recovery exception. SPEC-003 BR-008 binds all three newly observed fixture groups as one review unit: explicit fetched immutable Core and separate Admin HEAD/tree/clean setup with isolated fixture Git authority; actual host-native private producer/projector public-v2 handoff for both prebrowser callers and aggregate contracts; valid nonnull wrong index blob plus independently established coherently resealed adversaries. No production validator, privacy, native positive/counterpart, deadline, assertion, platform matrix, permission or concurrency weakening is allowed. Aggregate metadata copies for non-host platforms are explicitly surrogate public-contract inputs, never native observations. All prior eight and three repairs, finite timeout and normal publication retention remain required.

Hosted ccd failures are retained historical evidence; exact native causes remain unobserved. Source authoring is UNEXECUTED until a different fresh ENTIRE cumulative SOURCE GO and NEW complete-input ROOT admission. Parent owns #1600 other fixture contracts and #1562 tracking; existing #1591/#1593/#1595/#1599 owners are unchanged. No release, merge, publication, settings, rerun, cleanup or main access is authorized by this source unit.

## Issue #1597 canonical workflow fixture establishment (97ad F1)

Development source-only continuation accepts sole custody of clean 97adfede0f378152c9308fcf85e6599e521df76d on retained PR #1586. SPEC-003 BR-008 requires BOTH packaged and published workflow fixture roots to use realpath immediately after mkdtemp, before deriving cwd, workspace, environment, private/public/runtime or registry literals. Preserve ordinary host-native positives and add complete real workflow/Core/separate-Admin positives established through an actual aliased temporary parent on each host. Deliberate alias/reparse rejection remains separately required; production cwd/root/image-parent checks and all31 independently established adversaries remain unchanged.

All prior 8+3 repairs, finite timeout, normal publication and current three groups remain mandatory. This is authored source, not native acceptance or historical failure attribution. A DIFFERENT fresh ENTIRE cumulative review and NEW complete-input ROOT admission precede any execution; current natural97ad evidence remains separately auditable. No syntax/import/test/helper/compiler/npm/native/ACL/lifecycle execution, main access, controls, rerun, cleanup, merge or publication is authorized. Parent retains tracking and full delivery ownership.
Current natural97ad full-suite job110888516754 fails ALL FOUR workflow fixture bodies at required rev-parse FETCH_HEAD^{commit} (128 unknown revision), before native custody. Static caller inspection establishes no reliable cause. BR-008 additionally requires closed actual fetch status/signal/error/output observations, physical Git-directory identity before/after fetch, and actual FETCH_HEAD regular-file/content readback before existing commit/tree/HEAD/clean checks. Missing/changed observations remain failures; do not synthesize FETCH_HEAD, remove the required assertion or attribute the failure to inherited Git ENV. This owning-unit source/native gate remains unresolved pending newly admitted execution.
## Issue #1597 shallow-source exact-candidate fixture acquisition (8189 successor)

Development source-only successor accepts sole custody of clean 818970618502aaad73c2d1f69de401eff2bf3ee3 on retained PR #1586. SPEC-003 BR-008 requires genuine exact-OID acquisition from a naturally shallow source: permit Git to update its own shallow boundary, while retaining isolated fixture Git authority, physical owned Git-directory identity before/after fetch, actual regular non-symlink FETCH_HEAD bytes with requested OID-tab membership, FETCH_HEAD commit, requested tree, detached HEAD/tree and clean inventory. Do not manufacture FETCH_HEAD, replace it with object availability, weaken native/custody checks or infer complete history.

Current terminal8189 full qualification reports1562 tests/1476 pass/17 fail/69 skip. All six own packaged/published ordinary/alias/negative workflow fixtures fail BEFORE native producer/assertions: fetch status0/signal null/error null, shallow-root update refusal, empty actual FETCH_HEAD. This differs from historical97ad unknown-revision128; no retrospective causal attribution. Git's documented --update-shallow semantics (https://git-scm.com/docs/git-fetch.html) supply the scoped acquisition repair, not execution proof.

Acceptance adds independent real two-commit Git source -> depth1 acquisition, actual ordinary and aliased-parent strict checkout positives, valid wrong-tree and wrong-head/failed-source negatives reaching actual fetch/tree boundaries. Both complete workflow ordinary/alias native Core/separate-Admin positives and workflow negatives use an explicitly exact shallow source before unchanged native assertions. All31 independent adversaries, native mandatory vectors, private/public authority and earlier8+3/finite-timeout/normal-publication repairs remain required. The other11 full-suite failures stay with their separate owners (#1591/#1593/#1595/#1596/#1599/#1601 and parent routing); no source is copied from those lanes.

No source execution/import/parser/compiler/test/helper/npm/install/native ACL/lifecycle is authorized locally. Authored regressions are UNEXECUTED. Different fresh ENTIRE cumulative SOURCE GO and NEW complete-input ROOT admission precede any local execution; full three-OS/compiler/native/operator/product/natural-CI/publication/same-byte gates remain unmet. Parent owns tracking; no main access, nested agents, deadline/concurrency/skip/permission weakening, rerun/dispatch/cancel/settings, merge/publication or cleanup.

- [ ] #1598 / SPEC-006 AC-6G.qualification-observation: review frozen source and copied complete harness, obtain new ROOT admission, then independently qualify unchanged300ms/100ms observations. No execution authorized in source preparation.
- [ ] #1598 ENTIRE d166 F1/F2: retain failed pre-disposal TCP observations/errors, dispose fixture handles only, author bounded process negatives; admit separate literal diagnostics command in ROOT v2/preflight/status/readback and obtain NEW ENTIRE review/freeze/admission before any execution.

- #1590 diagnostic contract remediation is source-only and UNEXECUTED pending fresh complete external exact-source custody and ROOT admission. SPEC-002 AC-4BH.3 maps the common fourteen-key projection and strict native receipt to paired protected proof; independent review, terminal exact-head relevant CI and native evidence remain required.

- #1594 adopts SPEC-006 AC-6G closed owned-temp cleanup diagnostics before implementation. Preserve eight calls, existing retry codes/delays, deadlines, ownership/permissions, complete CLI/TUI inclusion and failure exit. Fresh cumulative review and complete first-input ROOT admission remain required before local product execution; historical #1593 cause stays UNOBSERVED and three-OS/full-operator gates stay pending.

## Issue #1600 qualification fixture and input reconciliation

Development, source preparation only. Parent #1562 remains active. The complete
nineteen-failure contract map is [QUALIFICATION_FIXTURE_INPUTS_1600.md](.governance/project/QUALIFICATION_FIXTURE_INPUTS_1600.md).
No imports, syntax checks, compiler, helpers, tests, installation, ACL or lifecycle
execution is admitted until a different fresh reviewer grants entire cumulative
SOURCE GO and a NEW complete-input ROOT admission. Existing PR owners retain
#1591/#1593/#1595/#1596/#1599 and #1586; normal source starts from current develop.

- [ ] #1602 SPEC-007 AC-7F/AC-7G and AC-4CG complete immutable tool contract adoption. Source authoring only; no execution before separate entire review/new ROOT admission, no invented pins, no full native/ZIP acceptance claim.
- [ ] #1603 adopt separate safe native-boundary observation grammar before source implementation; preserve exact private unavailability, guards/control/schema and historical failures. Fresh entire independent review and NEW complete-input ROOT before execution.
- [ ] #1602 adopt both entire-review F1/F2 contracts together: empty source-owned protected authority until pins-only real publication admission, coherent retained-forgery denials, actual lightweight/annotated tag proof and malformed/absent/cycle/depth/wrong-source negatives. Source only, no qualification claim.

- [ ] #1606: adopt typed private exact identity and finite observation-v2 before source; preserve public-v2/MCP and every native/owner guard. Source and regressions remain unexecuted until ENTIRE review and NEW ROOT.

- [ ] #1608 adopt closed command-validation-observation.v1 spec first; preserve original validation/error/shortcircuit/private-v3/public-v2 and all incoming717 contracts. Author positive/every reason/privacy/unavailable/capture-failure tests without execution; obtain DIFFERENT ENTIRE review and NEW ROOT.
- [ ] #1610 adopt finite helper capture closure observation; authored tests UNEXECUTED, preserve guard order/privacy/errors; different ENTIRE review and NEW ROOT before execution.
- [ ] #1621 adopt finite fixture observation v1 before source; prepare complete U2/U3 native/compiler/outer refusal and protected assertion regressions. UNEXECUTED until different ENTIRE review and NEW ROOT; no guessed cause, U1 removal or private authority.

## Documentation publication remediation completed

- #1612 / PR #1615: explicit owner-authorized develop documentation publication is verified at `7d6f1ce6c244543c65b0efac2218c6f8dc456bc0`, Docs Site run `37140638976`. Live source receipt, current contributor instructions, three pages and CSS/JS assets read back successfully. Tooling advisories are locally patched with upstream provenance and 14 direct regressions; audit gates remain unchanged. Native runtime-qualification failures are retained separately in the issue; this receipt makes no runtime release or GA claim.

- [ ] #1622 / SPEC-002 AC-4BH.4: prepare attempt-coherent JS diagnostics using compatible stale optional omission. Preserve native helper bytes and public schemas; require fresh entire source review and NEW complete-input ROOT before parser/import/build/test/native execution. Actual Windows case66/native partial-copy proof remains unexecuted.

## #1619 two-OS durable contract remediation
- [ ] Land independently reviewed [ADR-001](.governance/decisions/ADR-001-two-os-release-evidence.md) and active [SPEC-008 R1-R7](.governance/specs/SPEC-008-two-os-release-evidence.md), with exact source-owned policy custody, closed evidence migrations, inventories and workflow mappings.
- [ ] #1613: implement coherent reader-first Core/CLI/TUI/template propagation in separately owned branches after satellite spec mapping, entire final-source review and NEW complete-input admission.
- [ ] CLI #30: resolve separately UNMET Windows ZIP through reviewed producer/consumer delivery and direct Windows proof; Core ZIP/CLI TAR are not substitutes.
- [ ] #1562: resolve retained Windows/Linux runtime/native/cleanup/input/private custody gaps, then actual immutable publication/public byte readback, separate approved catalog pins, same-byte Core/npm and terminal published qualification. Empty catalogs and original failures stay retained; Darwin deferred never PASS.

- [ ] #1633/#37: entire coordinated durable contract review and develop landing, integrating separately owned PR1631/CLI36 after their landing; then whole CA01..CA08/TC01..TC12 source authors, different entire source review and NEW complete-input native admission. Missing original immutable tuple/catalog/provider/key/native capabilities remain fail-closed; no doc claim completes delivery.

- [ ] #1628: review/land the explicit CLI inner-ZIP origin correction; retain actual Core #1534 staged-service Windows ZIP and outer release ZIP proof, plus CLI native TAR safety/Core/operator proof.
- [ ] #1562: resolve retained Windows/Linux runtime/native/cleanup/input/private custody gaps, then actual immutable publication/public byte readback, separate approved catalog pins, same-byte Core/npm and terminal published qualification. Empty catalogs and original failures stay retained; Darwin deferred never PASS.
- [ ] #1632 prepare coherent source+regression contract for AC-4BJ.9c v2/startup v1 and AC-4BH.2 native exclusions; execution deferred to different entire review and new complete-input ROOT.
## #1628 reviewed release-contract errata — source amendment awaiting entire review

SPEC-008 R2/R4/R5/R6/R7/appendix and T1–T5, ADR-001, and the fixed source-owned Template consumer register govern these explicit corrections: TUI3 exactly two archive-only checksums/four public proofs (historical v2 six/four); twelve TC compatibility surfaces across two actual CLI/Core roles with CA01–CA08 complete source-admission aliases; CLI protected2/portable2 native TAR, 6/7/8, with misplaced CLI inner-ZIP blocker retired and Core #1534 staged-service/outer-release Windows ZIP retained. Canonical policy a038 commit/blob/raw SHA remains unchanged. Missing current catalogs/proof implementations/provider controls/tuple and Windows/Linux native acceptance stay unresolved; source register selects prospective paths only. Independent complete CLI/Core admission architecture must reconcile canonical owner inventory with current Core SLTP path eligibility before CA success; this errata does not amend that API. Darwin deferred, never PASS.

Core #1628 plus CLI #35/TUI #29/Template #23 form one cumulative documentation-only bundle. Held TUI #28/Template #22 producer implementation waits for fresh distinct ENTIRE cumulative amendment review and governed develop landing. Later producer units need fresh entire source review and NEW complete-input admission before execution. Existing failures/private evidence and owned Core #1626 remain preserved. No product/parser/compiler/test/npm/native/ACL execution, provider controls or gate weakening, publication/qualification/GA claim accompanies these documents.


## #1629 fixture boundary adoption

- [ ] Land independently reviewed ADR-002 and SPEC-002 FI-1..FI-7 before complete native adapter source authoring; keep implemented fail-closed retention pending admitted native proof.
- [ ] Prepare complete source-owned launcher/supervisor/mediator/keeper, provenance/IPC/held-proof grammar, positive/partial/persistent-copy and concurrent native denial/fault sources under the separately assigned adapter unit; no execution before distinct entire review and NEW ROOT.
- [ ] #1326 F7: actual owner-approved off-host private custodian/destination/access remains absent; local persistence/sealed FD cannot discharge it. Preserve all failures and production criteria.

F1 cumulative correction selects ADR-002's trusted privileged supervisor and distinct W original-owner, M mediator, K keeper and R ordinary-runner principals. Original W ownership is preserved; live M/K have only authenticated finite held-object read channels, no named original mutation/reopen/owner-rights/attach/duplication authority. Existing current-actor helper guards require source-owned loader/client adaptation to authenticated actual prior W owner/object capsules, with separate M diagnostic and supervisor copy/control ownership; no caller/ENV override, whitelist, chown or DACL widening. Actor/object/owner/receipt negatives and live mutation denials supplement every original positive/copy/removal/reset/partial/ENV/history/native guard. Guardian settlement and exact W process/EOF closure remain continuous; prospective capabilities remain UNKNOWN/fail-closed. Fresh different ENTIRE cumulative review and develop landing precede native authorship. F7 actual off-host custodian remains absent.

- [ ] #1622 F1: independently review cumulative one-time guarded message/reason acquisition and authored retryable native-getter/unreadable-message regressions; NEW ROOT before execution. Original failures remain retained.

#1622 / AC-4BH.4 lifecycle entrypoint mapping: The existing Lifecycle process tree pull-request workflow selects tests/windows-tree-attempt-correlation.test.js on both ubuntu-latest and windows-latest alongside every existing protected lifecycle test, with unchanged concurrency, native provenance steps and deadline. These eight producing-loop regressions are source-authored and unexecuted locally; natural exact-head CI supplies separate observed results. Different fresh ENTIRE cumulative review and NEW complete-input ROOT remain required before manual execution.

- [ ] #1639 AC-4BY.2 observer diagnostic remediation: private original error/channels plus finite owned-event phases; source review/NEW admission before execution. Strict Git workflow and PR template remain applicable. Unknown/native acceptance stays unqualified.

## Observer diagnostic custody correction (#1639; AC-4BY.2; R1-R3)
Development source-only continuation accepts the clean af2f658 observer diagnostics unit under the existing issue-branch recovery exception. Integrate current develop normally, preserving all newer governance and the entire nine-path unit. Separate the original child-error result from the genuine child close witness: preserve the same original Error privately immediately, and permit private channel hash/readback only after close. Install eventual readback custody before polling so invalid terminal, exception and timeout returns retain the continuation without fake closure, a synthetic deadline or termination.

Scan the full fixed eight-phase/three-event candidate set. Absent future leaves do not imply failure; any existing malformed, foreign, duplicate-key, mismatched, oversized or unreadable leaf makes the public phase projection unavailable rather than hiding an earlier failure behind later bookkeeping. Bound bytes actually read through a held regular-file handle to 2049 bytes and reject beyond 2048; metadata alone is insufficient. This does not establish writer exclusion, pipe EOF, descendants, native ACL, sealing or immutable bytes.

Prospective regressions cover error-before-close, delayed close after early results/throws, actual invalid cwd, mixed damaged/valid candidates and actual read bounds. They remain UNEXECUTED until a DIFFERENT fresh ENTIRE final SOURCE GO and NEW complete-input ROOT admission. Original validators, bootstrap, activation, positive 5000ms/native receipt criteria and exact Error identity remain mandatory. Original03d219 cause remains UNKNOWN. No merge of PR, workflow action, release, publication, deployment or cleanup is authorized.

The existing detached timeout/unref contract is preserved: installed eventual readback is conditional on consumer-host lifetime. A naturally exited host cannot guarantee readback of an observer which outlives it. Missing channel-close evidence remains unavailable, while raw private channels and the detached observer's unresolved/eventual provider records retain their original custody. Do not extend CLI lifetime or claim durable independent channel-readback ownership.
## Current integration authority (2026-10-04)

Core PR1631 and CLI PR36 are landed dependencies, integrated through current develop Core33e19ea24aaaff62e5dbfbb8d57001576fb2fb16 and CLIcf95d4577b5d9e4bb37c02807e738b512dec8be9. The landed four-repository errata/register takes precedence over historical CLI inner-ZIP blocker wording: CLI protected/portable authoring uses native TAR; Core #1534 staged-service and outer-release Windows ZIP remains required. Original TUI five actions and same published tool bytes in Core/npm remain required. Historical pending/review text above records earlier checkpoints, not current ownership or a reopened dependency.

Complete inventory means every file in the independently admitted owner tuple, with its exact path, mode, bytes or explicitly typed difference, policy self-member and generated provenance. Template PR25 owns the new prospective source tuple (reviewed source d3f9c86fc55f3bb4a31f0d127c2b3d5bad291885; 83 inventory members plus policy =84 source files) and its publication/source binding; generated provenance is derived separately. This contract grants it no admission and never makes84 a permanent inventory count. Historical 73+policy+provenance=75 tables and their size/quota arithmetic are informational bindings to the old frozen tuple only, never a 75-file cap or a grant for a newer tuple. All normative full75/all75/expected75 references above mean the complete inventory of the separately admitted tuple; no current or future file may be truncated to fit that historical example. Current owner quotas must be independently validated and all retained-copy/frame/parser/native limits met before enablement; an incompatible newer tuple fails closed pending an explicit reviewed limit amendment, never silently drops members or inherits old hashes/quotas. Native v3 HMAC/one-use session, full held readback, TC01..TC12/CA01..CA08, upload/stage/preflight/confirm/commit/poll and journal/key/fixed-ID exact-payload durable Audit no-loss outbox remain complete and unchanged. Missing immutable publication, catalog/provider/native capabilities and direct Windows/Linux released journey remain unmet.

This integration is source-only documentation. Different fresh ENTIRE final-source review is required for both complete integrated contracts before governed landing. Product source authorship, imports/parsers/build/npm/tests/native execution, new API decisions, publication and deployment are outside this integration unit.

#1632 natural Windows case144 harness correction: the initial-tree emergency fixture must provide the required closed custody failure recorder, assert its bounded flag after native containment and teardown/ENV restoration, and retain the fixture on observation failure. Supervisor guard and all protected native/history/control criteria remain unchanged. Source-only; different ENTIRE cumulative review and NEW complete-input ROOT precede manual execution. Changed head inherits no native PASS from ab033.

#1632 PR1635 managed fresh-inspection F1 correction (06f successor): AC-4BH.2 requires stopManagedProcess to preserve the requested newWindowsInspectionEpisode through managed termination, including ordinary live unfiltered records and empty retained membership. Acquire the actual shared Windows snapshot before control under the original caller deadline/signal; retain immutable lifetime conflict rejection, approved exclusions, monotonic verified restriction, private accepted history, shared termination/retry and original native actions. Protected request-context/operator cases153/154 remain unchanged; add direct ordinary requested-path coverage. Preserve case144 repair, eight native modes and seven unresolved history156..162 failures without invented cause. SOURCE ONLY and UNEXECUTED until a DIFFERENT fresh ENTIRE cumulative SOURCE GO and NEW complete-input ROOT; no imports/parser/compiler/build/tests/native/dispatch/merge.

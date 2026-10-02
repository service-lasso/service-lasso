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

- `BR-008` — Reconciliation qualification custody must create its private initial receipt before dependency installation, build, generation, or product imports. Every claimed source/tool result in that receipt must be bound to an owned, live native-process observation (PID, birth identity, resolved image and complete parent chain), private raw stdout/stderr closure, exact command order, and the current HEAD/tree/tracked-byte Git provenance. The public projection may publish only closed hashes and immutable identifiers; unresolved observation, alias/image mismatch, non-zero or signalled exit, missing EOF, duplicate JSON keys, raw-output tampering, or source/tree/result mismatch must fail closed.

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
- When BR-004 evidence uses an external platform aggregate, retain and fully validate the complete private custody record locally; upload only an explicit digest-bound public projection. The aggregate may report its own projection checks, but never claims validation of private receipt bytes unavailable to that environment.

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
- 2026-10-02: Exact-head repair qualification requires one coherent private-custody producer/validator/fixture/platform contract and a separate public digest projection. Synthetic v1 custody records and public uploads of raw custody data are invalid inputs and cannot satisfy BR-004.
- 2026-10-02: The authorised reconciliation PR `#1584` alone may use the
  canonical-repository head `codex/1577-release-reconciliation-develop` into
  `develop`; the branch-policy gate binds all four tuple members (PR number,
  base, head, and head repository). This temporary exception preserves the
  reviewed reconciliation ancestry and expires on that merge.
- 2026-10-02: BR-004 private custody evolves to v3: its exclusive, fsynced
  producer records every tracked candidate file and the native provenance subset,
  realpath/lstat parent chains, current registry absence, and ordered command
  closure bound to the candidate head/tree. The private validator recomputes
  those observations locally before an explicit digest-only public projection is
  written. Platform aggregates consume only that projection and must describe
  their validation as projection validation, never verification of unavailable
  private bytes.
- 2026-10-02: Windows private-root proof records an exact SID/DACL contract,
  rather than an `icacls` text hash. A newly owned protected custody root allows
  FullControl only to its creating current-user SID, LocalSystem, and built-in
  Administrators. Existing source, tool, and shared-parent paths remain
  inspection-only boundaries and are never ACL-hardened by initialization.

- 2026-10-02 PR #1586 BR-008 repair: exact allowed Windows writer principals are deduplicated for ordinary/SYSTEM/Administrators creators. Both held Darwin helper witnesses must bind the complete cache object; validation reopens the physical OS-owned non-writable cache and compares only its bounded 104-byte header UUID/digest. Platform adversaries remain unexecuted pending fresh external ROOT admission. Parent replacement checks detect change and do not claim atomic directory anchoring.
- 2026-10-02 PR #1586 cumulative C1/C2/C3 source repair: directory replacement uses stable dev/ino object identity with physical/reparse and owner/mode/ACL rechecks; legitimate child creation may change directory size/mtime. File held/named comparisons retain size/mtime stability. Public v2 localValidatorAttestation remains exactly {schema, validated}; every aggregate/recorder and paired fixture must reject expanded or malformed attestations. Private v3 retains native birth/lifetime proof.
- Preserve the already-owned PR #1586 head under AGENTS: the only additional typed-prefix grandfathering tuple is PR 1586, base develop, head codex/850-native-custody-platform-followup, head repository service-lasso/service-lasso. It expires when that PR lands; other PRs/forks/heads/targets receive no namespace or actor exemption. PR #1584's existing bounded exception and all direction/ancestry protections remain intact. All new normal branches require typed issue prefixes.

## Issue #1597 entire PR #1586 source repair

SPEC-003 BR-008 implementation child of delivery epic #1562. Sole successor custody is explicitly accepted on the retained clean d33f78e PR head; the existing branch and develop target are preserved under the bounded GOV-10 recovery exception. Closed historical #850 remains closed.

All eight review groups are one coherent acceptance unit: separate Admin checkout custody and exact tracked Core inventory; literal workflow candidate/platform; raw Git blob/tree/commit/index replay; exact tool/native/runner/caller/metadata bindings; literal run and root/registry roles; held versus named file identity and verified-byte parsing; complete owned bootstrap helper/raw/script/actual-child closure; isolated host-native production fixtures and coherently resealed adversaries. Existing observation architecture, private/public boundary, three-OS/compiler/product/native/operator gates and protected assertions remain required.

Source authoring and static metadata/hash inspection only. No source import, Node/npm/compiler/syntax/test/native ACL/lifecycle execution before a fresh independent ENTIRE SOURCE GO and NEW complete-input ROOT admission. Freeze/push the complete bundle for independent review; no execution or acceptance claim follows from authoring. Earlier failures and direct-versus-surrogate limits remain preserved.
Issue #1597 source disposition: Windows bootstrap uses one owned persistent held PowerShell process with an immutable source-derived script and a finite three-purpose JSON request grammar. Every exact request byte sequence and result line is retained in FIFO order, bound to native birth/image/SID/parent/helper observations and natural terminal exit/EOF/private raw hashes. The initial terminal private bootstrap seal binds the initial receipt and Git/tool journal; the validator writes its own private terminal seal. These remain private; public-v2 shape and aggregate meaning remain unchanged. No new bootstrap trust exception or loaded-memory/complete-cache claim is introduced. Malformed requests, operation/result mismatch, missing coverage, early/crash/nonzero/EOF failure and raw/script/helper substitution are fail-closed source cases; direct native execution is unexecuted.

Protected first-custody fixture correction under #1597 keeps both full workflows and all three actual OS matrix hosts. It replaces the contradictory installed working checkout and simulated Linux/Darwin identities with an isolated exact-candidate checkout and the host's native identity. Windows now exercises real custody, with separate missing/cross-platform/foreign-input negatives. Existing protected public, native SID/Darwin, branch and product acceptance scope is retained. Coherently resealed adversaries reach inner Git/tool/config/registry/helper predicates; the held reader includes a deterministic actual open-time swap. These authored fixtures are not proof of acceptance until independently reviewed and ROOT-admitted.
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

## Issue #1600 fixture/input acceptance clarification

Preserve existing acceptance criteria and production checks. The complete source-only
fixture scope, original failures, dependency owners and subsequent evidence gates
are bound in [issue 1600 contract map](../project/QUALIFICATION_FIXTURE_INPUTS_1600.md).
This clarification authorizes faithful input/assertion reconciliation, no protected
skip, deadline or permission widening, native-custody substitute, or release claim.

BR-008 #1603 binds the separate safe failure observation in SPEC-006 AC-6G.native-boundary-observation. Preserve private-v3/public-v2 shapes, every image-parent refusal/recheck and identity-precision guard. No private sink is invented; source-only review/admission gates remain required.

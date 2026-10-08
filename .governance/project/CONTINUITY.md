# Continuity Operating Guide

## Purpose

This repository keeps concise, factual continuity in versioned artifacts so work can resume safely without depending on chat history.

## Layers and Paths

| Layer | Purpose | Repository path or operating surface |
| --- | --- | --- |
| Session/thread | Current bounded work, decisions, and open loops | Active task handoff plus the governing issue and pull request |
| Recent/daily | Short-lived progress and run evidence | `.governance/project/bootstrap/history/<timestamp>/` for bootstrap; issue/PR evidence for delivery work |
| Project | Durable constraints, specifications, workflows, and backlog | `AGENTS.md`, `.governance/project/`, `.governance/specs/`, `.governance/rules/` |
| Durable global/operator | Cross-project operator facts that are safe and authorized to retain | Operator-managed continuity surface; do not copy secrets, credentials, raw logs, paths, or private payloads into the repository |

## Checkpoint Triggers

Checkpoint after new instructions or corrections, a material decision, a blocker or open loop, a change of phase or execution mode, prolonged multi-step work, or likely compaction/handoff risk. Each checkpoint states the governing issue/spec, exact checkout and branch, evidence obtained, unresolved risk, and one next action.

## Session Diaries

Recurring work records a concise diary in the governing issue, pull request, or a scoped history artifact. Diary entries retain decisions, constraints, follow-ups, and thread-specific operating norms. They are not transcript archives and must remain secret-safe.

## Promotion Flow

Promote information only when it becomes durable: session facts move into a historical run bundle or issue; reusable project constraints move into a spec, project document, rule, or workflow artifact; cross-project operator knowledge moves only to the authorized operator surface. Update links when a durable fact moves so entry points remain discoverable.

## Default Pickup and Closure

Use the default issue-pickup flow in `.governance/project/GIT_WORKFLOW.md`. Before starting a new slice, assess inherited state on `develop`; use a new typed issue branch from `develop`; classify all kept changes at the end of the slice; and leave an evidence-backed pull request into `develop`. Normal development work never uses `main` as input.

## 2026-10-02 PR #1586 source-repair checkpoint

Development continuation of the existing exclusively owned PR head
`codex/850-native-custody-platform-followup` is an explicit GOV-10 recovery
exception. The existing branch is preserved until its governed landing path
completes. Current develop `3a8d0c9c1510c7e5832dae1eca7bd38eacf02444` was
merged normally and immediately pushed as `5a082198e5816fc589e94fe2a3ae905e411eea77`;
this actual merge base supersedes the provider's older cached `7399683` base.

The bounded BR-008 repair deduplicates the native Windows allowed writer SID
set consistently and reads the owner directly as a SecurityIdentifier. Darwin
requires exact complete cache-object binding to both held native helper outputs,
then verifies a physical root-owned non-writable cache through held identity,
non-reparse parent snapshots and a bounded 104-byte header read. The digest is
only the header digest, not a complete cache/library-file claim. Parent
replacement checks detect observed changes; they do not promise atomic anchoring.

Added source adversaries are UNEXECUTED: unique SID models for ordinary,
SYSTEM and Administrators identities, duplicate/foreign/broad/inherited/right
drift, actual current-Windows ACL mutation, junction/symlink leaf and ancestor
boundaries, and Darwin coherently resealed journal/receipt mutations including
both raw witnesses plus header UUID/digest substitution. Token models are
surrogate policy evidence only; no SYSTEM/Admin native token is claimed.
Native platform scenarios, races, unreadability and OS owner variation remain
unqualified until external ROOT-admitted target execution supplies direct proof.

No product imports, syntax checks, dependencies, builds, tests, native helpers or
compiler actions were executed during authoring. Static diff/structure review
and `git diff --check` are source checks only. The original pre-admission SID
translation failure remains invalid-input custody support. Rejected de27
metadata/old receipts must not be reused. PR #1586 remains review/qualification
NO-GO until fresh complete cumulative review and an external first-input ROOT
collector read/admission. #1590 lifecycle CI repair is separate and unchanged.
Primary-checkout retained state, other workers, provider controls, CI reruns,
release/promotion/publication/deployment and protected branches were untouched.

Next owner: parent conducts fresh full cumulative source review, reads a new
complete external first-input custody bundle, then admits or rejects execution.
All modified paths in this worktree are intended governed source/test/doc changes;
the retained PR branch/worktree is the explicit bounded review/qualification path.

## PR #1586 cumulative C1/C2/C3 source bundle

The fresh sole author continued the same clean existing head at 28bf708 without
branch creation or ownership transfer to unrelated workers. C1 now separates
stable dev/ino directory object identity from file size/mtime stability; parent
snapshots retain owner/mode, physical/reparse checks and private root ACL proof.
C2 shares one strict public-v2 validator across both aggregates and the published
recorder; all accept exactly {schema, validated}, with native proof private in v3.
C3 documents/adopts only the exact PR1586/develop/full-head/same-head-repository
tuple, preserving PR1584's bound exception and direction/current-develop ancestry.
New sources cover own mkdir/write preservation, actual retained parent replacement,
canonical/expanded/malformed public fixtures/recorder, and real branch-direction
script negative tuple cases. All execution remains UNEXECUTED, including syntax,
imports, dependencies, tests, build, native helpers and compiler actions. Only
manual source/Git checks were used. Fresh entire cumulative review and external
ROOT exact-source admission are next; no previous receipt qualifies these bytes.
Keep original branch-policy run36987350575/job110775283569 and Lifecycle Ubuntu
run36987323512/job110775201090 as failures. #1590 remains separately owned.

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

## Issue #1597 shallow-source exact-candidate fixture acquisition (8189 successor)

Development source-only successor accepts sole custody of clean 818970618502aaad73c2d1f69de401eff2bf3ee3 on retained PR #1586. SPEC-003 BR-008 requires genuine exact-OID acquisition from a naturally shallow source: permit Git to update its own shallow boundary, while retaining isolated fixture Git authority, physical owned Git-directory identity before/after fetch, actual regular non-symlink FETCH_HEAD bytes with requested OID-tab membership, FETCH_HEAD commit, requested tree, detached HEAD/tree and clean inventory. Do not manufacture FETCH_HEAD, replace it with object availability, weaken native/custody checks or infer complete history.

Current terminal8189 full qualification reports1562 tests/1476 pass/17 fail/69 skip. All six own packaged/published ordinary/alias/negative workflow fixtures fail BEFORE native producer/assertions: fetch status0/signal null/error null, shallow-root update refusal, empty actual FETCH_HEAD. This differs from historical97ad unknown-revision128; no retrospective causal attribution. Git's documented --update-shallow semantics (https://git-scm.com/docs/git-fetch.html) supply the scoped acquisition repair, not execution proof.

Acceptance adds independent real two-commit Git source -> depth1 acquisition, actual ordinary and aliased-parent strict checkout positives, valid wrong-tree and wrong-head/failed-source negatives reaching actual fetch/tree boundaries. Both complete workflow ordinary/alias native Core/separate-Admin positives and workflow negatives use an explicitly exact shallow source before unchanged native assertions. All31 independent adversaries, native mandatory vectors, private/public authority and earlier8+3/finite-timeout/normal-publication repairs remain required. The other11 full-suite failures stay with their separate owners (#1591/#1593/#1595/#1596/#1599/#1601 and parent routing); no source is copied from those lanes.

No source execution/import/parser/compiler/test/helper/npm/install/native ACL/lifecycle is authorized locally. Authored regressions are UNEXECUTED. Different fresh ENTIRE cumulative SOURCE GO and NEW complete-input ROOT admission precede any local execution; full three-OS/compiler/native/operator/product/natural-CI/publication/same-byte gates remain unmet. Parent owns tracking; no main access, nested agents, deadline/concurrency/skip/permission weakening, rerun/dispatch/cancel/settings, merge/publication or cleanup.
### #1718 / PR #1722 ENTIRE browser outcome and custody repair (2026-10-06)

Development SOURCE ONLY, sole successor author on retained fix/1718-docs-consumer-qualification at clean4777b0c6dd69cf17f6042cbb51d916a17a0f77bf/treeb8cd0278dc6bff170cf33e40fe773350d351e146, named developbasecae79b5e92d7ded41dda1f1c600ee9b53b7aaebc. Bounded GOV-10 recovery preserves the same issue1718/PR1722 and open owner checkout. SPEC-007 AC-7F/AC-7G.docs-consumers binds all F1/F2/F3 as one coherent source unit before implementation.

F1: terminal valid-page result requires final actual observation drainage and page-error/request-failure/status/compiler-digest checks after DOM/screenshot capture and context settlement; invalid-Mermaid deliberate parse errors must be separately and precisely classified. F2: preserve the original primary assertion/operation failure, record every capture/cleanup error independently, and independently attempt context/browser/server settlement even when another close rejects. Scenario PASS is provisional until whole cleanup succeeds; capture or cleanup error fails the unit.

F3: authentic natural4777 run37422382726/artifact11393293439 failed browser digest after ordinary0/pooled0, actual workers1+2 and routes185/188. Native math x2+1 and ELK geometry were observed before failure; legacy/invalid are NOT_REACHED. Same JS URL assets/js/5e95c892.e0dfbb7d.js has two200 responses: expected7505cc6e60c36f7104e6f16cf7dc01f086c99a4edaccb36b77ff72cedd7641ea and empty e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855. Existing evidence lacks method/cache/transport cause: UNKNOWN. Add faithful private request/method/resource/header/original identity/body-length/cache transport observations and independent server request identity/read-byte hash/error observations before the unchanged digest failure. No empty-response exclusion, manufactured GET body, status200 authority, inferred cache cause or server-only browser identity. Protocol-specific acceptance requires actual new evidence and parent scope selection.

Preserve entire31581-member original source ROOT965a6577f26dfb6b7fa7327ebcbde7b29107c839d7544f846a617c93a56db823, ENTIRE SOURCE_NO_GO review ROOT5c14343cd1a2d057d9b4a91496c7c08e8101eafd44421ff859fdf2feca7c2bc0 and all original90/bbe/efe/4777 failures, malformed failed original roots and distinct raw-byte addendum9. CLI wrapper remains100755/same blob. Public docs/config/package/lock/release/private policies/deadlines/retries/concurrency/permissions remain unchanged. No local target import/parser/helper/browser/build/test/compiler/native/ENV/ACL execution before NEW complete-input ROOT, DIFFERENT entire SOURCE_GO and parent admission. Natural push CI is separate allowed evidence; no rerun/dispatch/cancel/settings/main/cleanup/merge/release. Author unit stays ACTIVE pending authentic cause disposition and fresh whole review; no acceptance claim.
### #1718 / PR #1722 faithful static response length after authentic05b8 diagnostics

Development SOURCE ONLY, same retained author unit at05b8d38303300ab3e21eb1472ab4bb3671d1ce86/tree1eed3857b30e40a2b6065f0aa41e5d1981d17469. DIFFERENT ENTIRE checkpoint review SOURCE_GO ROOT348d2379b55e542043dcccf8b64e8474908a79f875b74e68406be290e25f3cde binds instrumentation source only; no target admission or runtime qualification.

Authentic natural run37423603262/job112138198700/artifact11394280438 fails unchanged digest for assets/js/5e95c892.e25c9fe0.js: script GETrequest5 gives actual359/expected5bb760cc646b52218516d66f939a4d59eb0a2a306192517bb9c75b6c7c12fbf8; distinct OTHER GETrequest14 Sec-Purpose:prefetch gives observed0/emptye3b0 while responseBodySize371. Both original serverrequests5/14 saved359 correct, finished and writableFinished/status200/no errors; both original response headers are Transfer-Encoding:chunked and omit Content-Length. CDP disk/serviceworker/prefetch-cache flags are false. Underlying browser backend empty-body mechanism remains UNKNOWN. Native math/ELK are partial observations; legacy/invalid NOT_REACHED and whole consumer remains FAILED.

Parent selects exact Content-Length:bytes.length for the private200 static response's actual immutable readBuffer, preserving Content-Type/request-ID and all diagnostics; retain and assert declared/written length and read/saved/written digest agreement. Official Playwright1.63.0 Chromium createResponseBodyCallback source589..630 returns backend body immediately when expectedLength is absent. When expectedLength is positive and backend body empty, the stock method checks safeGET/static-or-Sec-Purpose-prefetch before its original Network.loadNetworkResource disableCache:false reader. Accurate server wire metadata permits that stock handling; this is source reasoning, not a claim that a new natural run will pass. No custom refetch, manufactured body, response filtering/skips, empty-hash exemption, cache/serviceworker/browser-policy change or server-only browser authority. All response/compiler hashes remain unchanged.

Preserve immutable36249 checkpoint, complete4777 terminal ROOT3f50e836ab8faa16639874f68ff69984bcd672f808b491572adbc324a6bdabbc/MF4544, full different05b8 review5 and actual05b8 receipt/browser/server/CDP/saved-body originals in the next cumulative actual-byte packet. Existing F1/F2 outcomes, original31581/review5/90/bbe/efe failed roots/addendum9, wrapper100755/sameblob and protected policies remain required. Commit/push immediately samePR1722; new natural CI and DIFFERENT entire final source review remain separate. No local target execution or changed deadlines/permissions. Author unit ACTIVE pending actual result and parent disposition.
### #1718 / PR #1722 actual extracted CSS compiler graph correction

Development SOURCE ONLY same ACTIVE author atfe1d62fe7138161c65e95ba91e55db114b10b209/tree7d927c8d379b76899f4cdf2db6e18fb533b6072b. Parent adopts entire SOURCE_NO_GO review ROOT27d4c8b2a753a91b7ee44c72aba6860ef3337a92a3bbb70b831b1c5b6849e453: actual selected katex.css normal modules have files[], so protected legacy selected-CSS assertion genuinely fails. Preserve authentic fe1d math/computed red2px/KaTeX_Math and actual compiler/browser stylesheet SHA agreement as supporting observations, never selected-source provenance or whole qualification. Invalid Mermaid NOT_REACHED.

SPEC-007 AC-7F/AC-7G.docs-consumers selects faithful compiler observation: retain normal physical source hashes and record original selected resource -> actual mini-css-extract-plugin CssDependency -> real CssModule -> actual chunk -> original rendered stylesheet asset/hash. Official mini-css-extract-plugin2.10.2 published archive integrity matches unchanged lock; bind its exact installed package/files and actual exported getCssDependency/getCssModule class identities for the compiler webpack instance. CssModule.nameForCondition supplies the original resource; moduleGraph.getModule(dependency), chunkGraph source-type membership and actual mini plugin renderManifest entries supply edges. Resolve the actual entry filename/pathOptions with webpack5.109.2 getPathWithInfo, the same compiler API used at actual emission, and require original chunk.files membership plus existing emitted asset bytes. No guessed output name, assigning all CSS, empty-files fallback or style-only proof. Original CSS source hashes, selected CSS/browser/font/hash assertions remain unchanged; extraction observations add truthful graph provenance only.

All prior F1/F2/wire repairs, original36249/49179 frozen packets, original fe1d NO_GO and natural failures, entire05b8/4777 terminal evidence, malformed original roots/raw addendum9 and thirteen native/product failures remain retained. Package/lock/publicdocs/browserpolicy/cache/refetch/deadlines/retries/concurrency/permissions unchanged. Every intentional commit immediately pushed SAME PR1722. No local target execution before NEW complete-input ROOT/DIFFERENT whole SOURCE_GO/parent admission; fresh whole review and natural new-head actual result remain required separately. Author ACTIVE; no acceptance/merge/release/publication/promotion/deployment claim.
The same CSS graph observer must retain actual original compilation.chunkAsset emission and final asset identity across stock webpack RealContentHashPlugin optimization. Official webpack5.109.2 renameAsset updates the actual chunk.files and final asset contenthash metadata without updating the original mini render-manifest template inputs. Bind original render entry -> actual chunkAsset emission -> final same-chunk asset whose real final contenthash resolves that original template through getPathWithInfo/TemplatedPathPlugin, retaining both original/final names and hashes. No compiler method wrapping, output rename/mutation, synthetic chunk or guessed/all-CSS association is permitted.
Before completing the CSS compiler-source proposal, bind ENTIRE genuine official webpack5.109.2 published archive inventory (including Compilation/ModuleGraph/ChunkGraph/RealContentHashPlugin/TemplatedPathPlugin and package/main/helper sources) to unchanged lock integrity/URL/version and actual installed file hashes before either build. This closes version-only compiler provenance; saved tag-source API reads are separately retained and do not replace npm installed-byte equality. No lock/package/resolver/library changes or local target execution.
2026-10-08 #1732 / SPEC-011 ESM-7..10: default Broker RAM WebDAV implemented in isolated feature/1732-default-ram-webdav; companion Broker feature/196-ram-webdav-secrets. Ubuntu actual production Broker/peer-bound IPC/managed-child reads, env compatibility, fresh restart and revocation passed; full scoped Core run 91 tests:87 pass/4 platform skips. Windows isolated source run86:80 pass/6 platform skips; all5 Broker identity regressions pass. Native Windows UNC read passed with existing WebClient, no mapping/config mutation. Docusaurus SSG succeeds with existing image-parser warnings. Broker full Go suite and vet pass; race detector unavailable because cgo is disabled. No release/deployment claim. Owner explicitly authorizes develop merge, then review the ten saved Linux cleanup failures separately from service recovery; retain original evidence and no claim of new crash-suite passes yet.

#1732 qualification correction: Broker final full-suite repeat had event-retention and local migration failures in unchanged source; each then passed three focused repetitions. Earlier full-suite pass and new RAM/native/contract checks stand, but latest full-suite green is not claimed. Owner-authorized source merge remains distinct from release qualification.

2026-10-08 #1734 / SPEC-012 OTF-1..5: owner explicitly selects ordinary teardown
for creator-owned private test fixtures. All seven hard-crash phases and four
positive cleanup cases keep their original assertions; default hostile-writer
custody refusal and adversaries remain unchanged. Native Ubuntu scoped run74:
70 pass,4 platform skips,0 fail, with actual root-owned foreign-owner input.
Original saved failed runs retained. Windows existing guardian/privacy setup
fails and is not qualified. Full native suite remains pending. No product code,
release, deployment or native F7 implementation claim.

#1734 scoped completion: all eleven original Linux cleanup failures pass in both
scoped verification and the configured full run at5a01bcfd/tree2dc501e4. Full run
1966:1870 pass,87 skips,9 failures; retain actual failed receipt/exit1. Eight
missing-tool failures subsequently pass with private PowerShell/lsof/python
inputs. The remaining actor-scoped HTTP replay failure reproduces on unchanged
parentdevelop bef6babc (12:11 pass,1 fail) and is tracked separately in #1736.
Seven natural Ubuntu crash-phase CI jobs pass. New Windows teardown unit checks
2 pass/1 POSIX skip; existing Windows privacy initialization remains unqualified.
Targeted GOV-13 self-review confirms original observable assertions and default
strong adversaries retained. Native F7 writer exclusion is not implemented or
required for the owner's ordinary-fixture recovery scope. No release/deployment.
Resuming at current develop3baf9667 in fresh fix/1736-linux-suite-replay. Owner
requests all nine remaining failures fixed. Eight are missing actual host tools;
private PowerShell/lsof/python inputs already prove those assertions. Diagnostic
HTTP execution returns confirmation_plan_mismatch (409, expected202) because
buildStartArtifactBindings includes every service's installed/configured
executable revision. Correct service_start scope only; preserve runtime-wide and
restart plans, stable dependency context, actor/replay/tamper checks. SPEC-013
LQ-1..4 and SPEC-006 AC-6E/AC-6F record acceptance before product implementation.
Original full-run receipt and baseline failure retained. No release/deployment.

#1736 verified for develop landing / PR1737: SPEC-013 LQ-1..4 and SPEC-006
AC-6E/AC-6F. Full native Ubuntu2bddf203/tree9e8f9d39:1966 tests,1879 pass,87
existing platform skips,0 fail; natural exit0,closed receipt and original failures
retained. Actual private PowerShell/lsof/python + native foreign-owner/Broker inputs
supplied. Original nine cases all pass with unchanged assertions. Ubuntu scoped
25 pass/1 platform skip; Windows scoped26/26 pass. Product correction scopes
service-start executable revisions to actual mutation targets; runtime-wide,
restart,dependency context,actor/replay/tamper guards unchanged. Full tracked
source unchanged; remote Python cache is generated/disposable retained audit state.
Windows whole custody/docs tooling CI/release remain separate and unqualified.
Final verification-document update changes no runtime code; no rerun needed for
unchanged executable behavior. Dedicated worktree clean after committed docs;
primary inherited deletions/audit state and other owner branches preserved.

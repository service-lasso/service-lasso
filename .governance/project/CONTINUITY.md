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

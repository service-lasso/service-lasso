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

---
sidebar_position: 2
title: Bootstrap
description: Use the canonical VibeGov bootstrap contract to install or normalize governance, specs, workflow rules, and reporting before product-code implementation.
---

# Bootstrap

VibeGov is a repo-local governance framework for AI-assisted software delivery.

This is its **canonical bootstrap contract**.

## TLDR

Use this page when you need to install, normalize, or audit the full VibeGov bootstrap contract.

Minimum takeaway:
- Bootstrap has one canonical contract, used through explicit `init`, `update`, or `review` modes.
- The repo must have governance rules, project intent, specs, backlog linkage, workflow artifacts, continuity guidance, and durable reporting before product-code implementation.
- This TLDR is orientation only; it is not a substitute for the canonical contract below.

Next action:
- If you want the shortest install path, use [Quick Start](/docs/quickstart).
- If you need the full contract, follow the [canonical bootstrap prompt](#canonical-bootstrap-prompt).
- If you are repairing an existing repo, read [Bootstrap Update](/docs/bootstrap-update).

Status: **Canonical contract**. Treat this page, [`agent.txt`](/agent.txt), and [`bootstrap.json`](/bootstrap.json) as authoritative bootstrap sources. Supporting docs can explain or extend usage, but they do not weaken this contract.

Shorthand refs used in docs and chat:
- `BI` = bootstrap init
- `BU` = bootstrap update
- `BF` = bootstrap feedback

Use the same contract in one of three explicit modes:
- `init`
- `update`
- `review`

Mode differences are behavioral only:
- `init` creates missing bootstrap state
- `update` repairs/normalizes existing bootstrap state
- `review` audits against the same contract without claiming missing work was completed

## Bootstrap support docs

Use the canonical contract here, then branch into the support docs when those topics first matter:
- [GitHub Project Bootstrap](/docs/github-project-bootstrap) for GitHub preflight, canonical board selection, repo linkage, and final GitHub-state reconciliation
- [INIT-TODO.md](/docs/init-todo) for durable prerequisite/remediation capture during bootstrap and adoption/update work
- [Bootstrap Update](/docs/bootstrap-update) for repair/normalization runs against an already bootstrapped repo
- [Bootstrap Review](/docs/bootstrap-review) for audit-only runs against the same contract

## Canonical bootstrap prompt

```text
Run VibeGov bootstrap in mode: <init|update|review>.
Read and follow:
- https://vibegov.io/agent.txt
- https://vibegov.io/bootstrap.json
- https://vibegov.io/docs/bootstrap/

Use the same canonical bootstrap contract for all modes.
Do not fork or weaken the pass gate by mode.

Before writing any product code (or before claiming bootstrap review is complete):
1. Create/normalize `.governance/rules/`, `.governance/project/`, and `.governance/specs/` as needed for the selected mode.
2. Ensure the active VibeGov rule set (`GOV-01` through `GOV-13`) is installed in `.governance/rules/`.
3. Detect existing provider-native rules directories and mirror `.governance/rules/*.mdc` only when they already exist.
4. Create or normalize `.governance/project/PROJECT_INTENT.md`.
5. Create `SPEC-001` as either:
   - `.governance/specs/SPEC-001-<feature>.md`, or
   - a bootstrap/governance-setup spec when product intent is still too vague.
6. Create or normalize a backlog mapped to the spec sections.
7. Install or verify strict Git workflow artifacts before implementation:
   - `AGENTS.md` (create this early so future agents have a repo-local entrypoint)
   - `INIT-TODO.md` (create/update this early during bootstrap/adoption/remediation work)
   - `.github/pull_request_template.md`
   - `.github/branch-protection-checklist.md`
   - documented default issue-pickup flow
8. Install or verify continuity bootstrap artifacts before implementation:
   - documented continuity layers (session/thread, recent/daily, project, and durable global/operator continuity when that scope exists)
   - repo-local continuity paths or equivalent scaffolding
   - checkpoint trigger guidance for instructions, decisions, blockers, phase changes, and compaction risk
   - session-diary guidance for recurring threads/contexts
   - promotion guidance between continuity layers
9. Before broader bootstrap mutation, classify git/repo preflight state:
   - is `git` available
   - is the current folder already an initialized git repo
   - if not initialized but `git` is available, run `git init` first as a repo-preservation pre-step
   - record pre-init local state before continuing (at minimum: folder context plus notable existing files/bootstrap-relevant artifacts)
   - remote setup is **not** required for this pre-step
10. Classify starting repo state before edits or review conclusions:
   - current branch
   - clean/dirty working tree
   - untracked files
   - uncommitted changes
11. Run with explicit commit policy: `required`, `allowed`, or `forbidden`.
12. If repo is dirty, do exactly one: resolve first, stop blocked, or continue in explicit review mode.
13. If GitHub-hosted, run preflight before board mutation:
   - `git` available
   - `gh` available
   - GitHub auth
   - repo access
   - project read access
   - project write access
   - branch-protection/admin capability when relevant
   - if any required capability is missing, record it in `INIT-TODO.md` with the exact remediation command or next action before proceeding
   - if branch-protection verification is unavailable only because of a known hosted-feature/private-repo limitation, record it as degraded verification with exact evidence and next action rather than pretending the repo normalization failed
14. If GitHub automation is available, create/adopt/normalize one canonical board target:
   - if multiple matching boards exist, choose one canonical target explicitly and report why it was chosen
   - for a new board, prefer copying a configured canonical template so views and custom fields are reproduced together
   - normalize `Status`: `Backlog`, `Ready`, `In progress`, `In review`, `Done`, `Blocked`
   - normalize `Project Priority`: `P0`, `P1`, `P2`, `P3`, `P4`
   - normalize `Order`: number
   - normalize `Priority`: `Urgent`, `High`, `Medium`, `Low`
   - normalize `Size`: `XS`, `S`, `M`, `L`, `XL`
   - create or normalize the default table view with visible columns in this exact order: `Title`, `Assignees`, `Status`, `Project Priority`, `Order`, `Priority`, `Repository`
   - permit additional fields such as `Size` to remain hidden in the default table view
   - if the available capability can create fields but cannot configure view visibility/order, record the exact manual remediation as `blocked-with-tracked-issue`; do not report the view as configured
   - document backlog automation ordering as `Project Priority` group then `Order` inside the group
   - link the repo
   - import/attach existing issues
   - if no issues exist, report board as intentionally empty
   - clean accidental duplicate empty boards and report cleanup
15. If GitHub automation is unavailable, report exact missing capability and leave a tracked blocker artifact.
16. Write durable local bootstrap reporting artifacts using a two-surface layout:
   - current reporting surface: `.governance/project/bootstrap/`
     - `STATUS.md`
     - `ANALYSIS.md`
     - `FEEDBACK.md`
     - optional `BLOCKERS.md`
   - historical run bundles: `.governance/project/bootstrap/history/<timestamp>/`
     - `status.md`
     - `analysis.md`
     - `feedback.md`
     - optional `blockers.md`
   - current files should act as the latest current reporting surface
   - history folders should preserve the per-run bundle as historical evidence
17. Reconcile generated docs against final live git/GitHub state before claiming completion.
18. Distinguish final current state from historical evidence gathered earlier in the run.
19. If migrating a repo from the older flat layout (`BOOTSTRAP_*.md` and `bootstrap-runs/<timestamp>-*.md`), normalize it into the current-surface plus historical-run-bundle structure instead of extending the legacy shape.

Support docs for this contract:
- use [GitHub Project Bootstrap](/docs/github-project-bootstrap) when the repo is GitHub-hosted and board/project setup is in scope
- use [INIT-TODO.md](/docs/init-todo) when prerequisites, blockers, or exact remediation steps need durable capture
- use [Bootstrap Update](/docs/bootstrap-update) for remediation/normalization runs
- use [Bootstrap Review](/docs/bootstrap-review) for audit-only runs against the same contract

Mode-specific behavior:
- `init`: create the missing bootstrap state required by the contract
- `update`: preserve valid existing artifacts and repair stale/missing/contradictory ones, including missing operational bootstrap artifacts, until the same contract is satisfied; if that cannot be done, leave explicit status/blocker artifacts plus a settled end-state classification (`committed/pushed`, `pending-review`, or `blocked`)
- `review`: audit the repo against the same contract, write findings and blockers, and do not claim missing work was completed

Then stop before product-code implementation.
```

## Pass Gate #1

Continue only if all are true:

- `.governance/rules/` exists with `GOV-01` through `GOV-13`
- `.governance/project/PROJECT_INTENT.md` exists
- `.governance/specs/` has `SPEC-001` (feature spec or bootstrap-setup spec for vague repos)
- backlog maps to spec scope
- `AGENTS.md` exists and points to canonical governance sources
- `INIT-TODO.md` exists for bootstrap/adoption/remediation work and records any missing prerequisite with exact remediation when relevant
- strict Git workflow artifacts exist
- continuity structure and continuity operating guidance exist
- git/repo preflight state is reported, including repo-initialization action when bootstrap had to initialize git first
- starting repo state and commit-policy mode are reported
- for GitHub repos, preflight results are reported with explicit state (`configured`, `blocked-with-tracked-issue`, `not-applicable`), and known hosted-feature verification limits are distinguished from core bootstrap failure
- for GitHub repos with automation, canonical board target is adopted/created/normalized, repo-link status is reported, multiple-match selection is explained when relevant, the required default table view is normalized, and backlog ordering is documented through `Project Priority` plus `Order`
- current bootstrap reporting artifacts exist under `.governance/project/bootstrap/`
- historical bootstrap run bundles are written under `.governance/project/bootstrap/history/<timestamp>/`
- if update cannot complete all gaps or only reaches degraded verification, blocker reporting makes the incomplete state explicit with exact next actions
- final docs are reconciled with final live git/GitHub state
- no product code was written

If any fail:
- `init` and `update` are incomplete
- `review` must report the exact gaps and blockers without pretending the repo is bootstrapped

## Reporting structure

Bootstrap reporting should separate current state from history.

### Current reporting surface

Use `.governance/project/bootstrap/` for the current bootstrap reporting surface:
- `STATUS.md`
- `ANALYSIS.md`
- `FEEDBACK.md`
- optional `BLOCKERS.md`

These files should describe or point to the current settled bootstrap picture, not act as a pile of historical reruns.

### Historical run bundles

Use `.governance/project/bootstrap/history/<timestamp>/` for historical bootstrap run evidence.

Each run bundle should group the run’s artifacts together:
- `status.md`
- `analysis.md`
- `feedback.md`
- optional `blockers.md`

One folder per run is preferred because it makes each bootstrap/reporting pass legible as a single reporting bundle.

### Migration guidance

If a repo still uses the older flat layout:
- `.governance/project/BOOTSTRAP_STATUS.md`
- `.governance/project/BOOTSTRAP_ANALYSIS.md`
- `.governance/project/BOOTSTRAP_FEEDBACK.md`
- `.governance/project/BOOTSTRAP_BLOCKERS.md`
- `.governance/project/bootstrap-runs/<timestamp>-*.md`

normalize it toward:
- `.governance/project/bootstrap/STATUS.md`
- `.governance/project/bootstrap/ANALYSIS.md`
- `.governance/project/bootstrap/FEEDBACK.md`
- `.governance/project/bootstrap/BLOCKERS.md`
- `.governance/project/bootstrap/history/<timestamp>/...`

During transition, older flat artifacts may remain as legacy history, but new bootstrap work should use the structured reporting layout.

## Related docs

- [Quick Start](/docs/quickstart)
- [Bootstrap Update](/docs/bootstrap-update)
- [Bootstrap Review](/docs/bootstrap-review)
- [GitHub Project Bootstrap](/docs/github-project-bootstrap)
- [INIT-TODO.md](/docs/init-todo)
- [Bootstrap Feedback Prompt](/docs/bootstrap-feedback-prompt)
- [FAQ: When do I use Bootstrap Init?](/docs/faq/when-do-i-use-bootstrap-init)
- [FAQ: When do I use Bootstrap Update?](/docs/faq/when-do-i-use-bootstrap-update)

# Git Workflow

## Default Issue-Pickup Flow
1. Choose the next item from the canonical GitHub project board or, if it is intentionally empty, from `.governance/project/BACKLOG.md`.
2. Confirm the item maps to an active spec section before starting work.
3. Update local `develop`, then create a new issue-scoped branch from `develop` using an approved typed prefix (`feature/`, `fix/`, `docs/`, or `chore/`).
4. Implement only the scoped change allowed by the active spec and update traceability as you go.
5. Open a pull request into `develop` using `.github/pull_request_template.md` and attach verification evidence before requesting review.
6. Move the tracked item to its review state only through the provider workflow available to the assigned operator; if the board capability is unavailable or out of scope, retain the exact pending action in the issue or bootstrap blocker artifact.
7. After merge, verify the landed result, close the issue only with evidence, and return the normal development checkout to `develop`.

## Branch Model
- Development source of truth and repository default branch: `develop`.
- Promotion/release branch: `main`.
- Normal feature, fix, docs, and chore branches must start from current `develop` and merge only into `develop` through pull request.
- New normal branches use `feature/<issue>-<slug>`, `fix/<issue>-<slug>`, `docs/<issue>-<slug>`, or `chore/<issue>-<slug>`. `codex/` is not a permitted prefix for new normal-work branches.
- Existing issue branches and open pull-request heads remain under their owner until their governed landing path completes; unrelated work must not rename, reuse, reset, or remove them.
- A working branch is an isolated governed work unit. Never branch normal work from `main`, another working branch, or a stale local branch.
- `main` accepts only an explicit reviewed promotion from `develop`, or an authorised urgent hotfix created from `main` and immediately reconciled back into `develop`.
- Agents must not use `main` to orient, plan, or baseline normal development work. Release inspection is allowed only when the task is explicitly a promotion, release, hotfix, or branch-reconciliation task.
- Direct commits and pushes to `develop` and `main` are forbidden. Force pushes and history rewrites are forbidden.

## Pull Request Direction

| Change type | Branch source | Pull request target |
| --- | --- | --- |
| Feature/fix/docs/chore | `develop` | `develop` |
| Release promotion | `develop` | `main` |
| Authorised urgent hotfix | `main` | `main`, followed immediately by reconciliation into `develop` |
| Branch-drift recovery | `develop` | `develop`, with the divergent history used only as reconciliation input |

Any pull request that violates this table must be stopped and corrected before implementation or review continues.

The authorised `SPEC-003` recovery pull request `#1584` is the sole temporary
exception to the normal typed-prefix rule: its canonical-repository head must
be exactly `codex/1577-release-reconciliation-develop` and its base must be
`develop`. The exception exists only to preserve the already-reviewed
reconciliation ancestry. It expires when that pull request merges and may not
be reused by a reopened or replacement pull request.

## Commit Policy
- Bootstrap update runs should state `required`, `allowed`, or `forbidden` explicitly in their status artifact.
- This repository's current bootstrap update run uses `allowed`.

## Continuity and Handoff
- The continuity layers, checkpoint triggers, session-diary guidance, and promotion flow are defined in `.governance/project/CONTINUITY.md`.
- A handoff records checkout, branch, commit, changed artifacts, direct versus surrogate evidence, unresolved risks, and one next action. It does not grant release, promotion, publication, deployment, or GA authority.

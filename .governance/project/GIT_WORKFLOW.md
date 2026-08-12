# Git Workflow

## Default Issue-Pickup Flow
1. Choose the next item from the canonical GitHub project board or, if it is intentionally empty, from `.governance/project/BACKLOG.md`.
2. Confirm the item maps to an active spec section before starting work.
3. Update local `develop`, then create a new issue-scoped branch from `develop` using an approved typed prefix (`feature/`, `fix/`, `docs/`, or `chore/`).
4. Implement only the scoped change allowed by the active spec and update traceability as you go.
5. Open a pull request into `develop` using `.github/pull_request_template.md` and attach verification evidence before requesting review.

## Branch Model
- Development source of truth and repository default branch: `develop`.
- Promotion/release branch: `main`.
- Normal feature, fix, docs, and chore branches must start from current `develop` and merge only into `develop` through pull request.
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

## Commit Policy
- Bootstrap update runs should state `required`, `allowed`, or `forbidden` explicitly in their status artifact.
- This repository's current bootstrap update run uses `allowed`.

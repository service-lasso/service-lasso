# Git Workflow

## Default Issue-Pickup Flow
1. Choose the next item from the canonical GitHub project board or, if it is intentionally empty, from `.governance/project/BACKLOG.md`.
2. Confirm the item maps to an active spec section before starting work.
3. Create a short-lived branch from `main` unless a later status artifact records an approved long-lived branch model.
4. Implement only the scoped change allowed by the active spec and update traceability as you go.
5. Open a pull request using `.github/pull_request_template.md` and attach verification evidence before requesting review.

## Branch Model
- Current default branch: `main`
- Current bootstrap position: no permanent `develop` branch is required yet, but that decision remains open in `INIT-TODO.md`
- Short-lived work branches are the default until a later bootstrap/adoption run records a different approved model

## Commit Policy
- Bootstrap update runs should state `required`, `allowed`, or `forbidden` explicitly in their status artifact.
- This repository's current bootstrap update run uses `allowed`.

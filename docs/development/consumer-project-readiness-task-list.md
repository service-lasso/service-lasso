# Consumer Project Readiness Task List

This is the working checklist for making `service-lasso` safe to use from other projects.

It is linked to `ISS-057` / GitHub issue `#58` and must stay aligned with `docs/development/release-readiness-validation.md`.

## Current Decision

Service Lasso is not fully consumer-ready until the tasks below are classified with evidence.

The core runtime, public service acquisition paths, release-backed Echo health proof, and reference-app release artifacts are working.

External fresh-clone usage remains blocked until GitHub Packages auth/package access is verified, because the app templates install `@service-lasso/service-lasso` from `npm.pkg.github.com`.

## Task List

| ID | Status | Linked issue | Outcome needed | Evidence required |
| --- | --- | --- | --- | --- |
| `CONSUMER-001` | `blocked` | `#69` | Other projects can install `@service-lasso/service-lasso` from GitHub Packages using the documented auth path. | Clean temp consumer install from `npm.pkg.github.com`, `service-lasso --version`, and `service-lasso help`. |
| `CONSUMER-002` | `done` | `#71` | Public release-backed Echo Service proves HTTP and TCP health mode transitions through Service Lasso runtime health. | 2026-04-24: `npm run verify:echo-health` exercised the public `2026.4.20-a417abd` Echo release archive with runtime-observed HTTP 200 -> 500 -> 200 health and TCP reachable -> unreachable -> reachable health. |
| `CONSUMER-003` | `blocked` | `#58`, `#69` | Reference apps are validated as cloneable templates. | 2026-04-24: prepared local repo tests passed sequentially for `app-node`, `app-web`, `app-electron`, `app-tauri`, and `app-packager-pkg`; fresh clone of `service-lasso-app-node` reached `npm ci` but failed with GitHub Packages `E401`, so true external clone/install remains blocked by `#69`. |
| `CONSUMER-004` | `done` | `#58` | Reference app release outputs are validated as usable artifacts. | 2026-04-24: sequential `npm run release:verify` passed for all five reference repos, verifying source, runtime/bootstrap-download, and preloaded/no-download artifacts where shipped. |
| `CONSUMER-005` | `done` | `#58` | Service Admin is reachable from reference app hosts, not only from its own repo. | 2026-04-24: reference-app host tests and release verification passed with mounted Service Admin payload checks for all five repos. |
| `CONSUMER-006` | `todo` | `#58` | `develop` is promoted to `main` only after readiness evidence is current. | Promotion PR, green release/package workflows, timestamped GitHub release, and package publish evidence. |
| `CONSUMER-007` | `todo` | `#58` | A fresh external project can use the released package and public service manifests. | Clean project smoke with documented package auth, `services/echo-service/service.json`, install/start/stop, and runtime API checks. |

## GitHub Packages Constraint

GitHub Packages for npm requires authentication for installs, including public packages. That means a normal project must provide an auth token before `npm install @service-lasso/service-lasso` can work from `npm.pkg.github.com`.

Current local validation is blocked because:

- unauthenticated npm returns `E401`.
- the current `gh auth token` returns `E403 permission_denied`.

Required external action:

- provide a classic PAT with `read:packages`, or
- grant the consuming GitHub Actions repository package access and use `GITHUB_TOKEN` with `packages: read`.

## Reference App Validation Note

Prepared local validation passed when run sequentially:

- `service-lasso-app-node`: `npm test` passed 4 tests; `npm run release:verify` passed.
- `service-lasso-app-web`: `npm test` passed 6 tests; `npm run release:verify` passed.
- `service-lasso-app-electron`: `npm test` passed 6 tests; `npm run release:verify` passed.
- `service-lasso-app-tauri`: `npm test` passed 6 tests; `npm run release:verify` passed.
- `service-lasso-app-packager-pkg`: `npm test` passed 4 tests; `npm run release:verify` passed.

Parallel multi-repo validation currently races on the shared core package staging directory and is tracked as `#75`. Until that is fixed, run reference-app release validation sequentially.

## Stop Rule

Do not close `ISS-057` until:

- every row above is verified, blocked with exact external action, invalidated with a follow-up issue, or explicitly deferred.
- `docs/development/release-readiness-validation.md` has matching evidence.
- the repo is back on clean `develop` after each work slice.

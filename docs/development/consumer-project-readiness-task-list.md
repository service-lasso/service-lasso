# Consumer Project Readiness Task List

This is the working checklist for making `service-lasso` safe to use from other projects.

It is linked to `ISS-057` / GitHub issue `#58` and must stay aligned with `docs/development/release-readiness-validation.md`.

## Current Decision

Service Lasso is not fully consumer-ready until the tasks below are classified with evidence.

The core runtime and public service acquisition paths are working, but external projects still need a verified package-install path, release-backed HTTP/TCP health proof, reference-app template validation, and a final promoted release.

## Task List

| ID | Status | Linked issue | Outcome needed | Evidence required |
| --- | --- | --- | --- | --- |
| `CONSUMER-001` | `blocked` | `#69` | Other projects can install `@service-lasso/service-lasso` from GitHub Packages using the documented auth path. | Clean temp consumer install from `npm.pkg.github.com`, `service-lasso --version`, and `service-lasso help`. |
| `CONSUMER-002` | `todo` | `#71` | Public release-backed Echo Service proves HTTP and TCP health mode transitions through Service Lasso runtime health. | Runtime-managed Echo Service HTTP and TCP health scenarios using public release assets. |
| `CONSUMER-003` | `todo` | `#58` | Reference apps are validated as cloneable templates. | Fresh clone/install/test/release-verify for `app-node`, `app-web`, `app-electron`, `app-tauri`, and `app-packager-pkg`. |
| `CONSUMER-004` | `todo` | `#58` | Reference app release outputs are validated as usable artifacts. | Source/bootstrap-download/preloaded artifacts exercised where each repo ships them. |
| `CONSUMER-005` | `todo` | `#58` | Service Admin is reachable from reference app hosts, not only from its own repo. | App-host URL check for host shell plus `/admin/` route against a live runtime. |
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

## Stop Rule

Do not close `ISS-057` until:

- every row above is verified, blocked with exact external action, invalidated with a follow-up issue, or explicitly deferred.
- `docs/development/release-readiness-validation.md` has matching evidence.
- the repo is back on clean `develop` after each work slice.

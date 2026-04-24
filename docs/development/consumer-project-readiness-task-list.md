# Consumer Project Readiness Task List

This is the working checklist for making `service-lasso` safe to use from other projects.

It is linked to `ISS-057` / GitHub issue `#58` and must stay aligned with `docs/development/release-readiness-validation.md`.

## Current Decision

Service Lasso is not fully consumer-ready until the tasks below are classified with evidence.

The core runtime, public service acquisition paths, release-backed Echo health proof, reference-app release artifacts, and GitHub Packages authenticated workflow path are working.

The consumer default has moved to public npmjs in code/docs/workflows so fresh projects can install `@service-lasso/service-lasso` without GitHub Packages auth after publish.

External fresh-clone local usage can now use the public npmjs package path without GitHub Packages auth.

## Task List

| ID | Status | Linked issue | Outcome needed | Evidence required |
| --- | --- | --- | --- | --- |
| `CONSUMER-001` | `done` | `#69` | Other projects can install `@service-lasso/service-lasso` from GitHub Packages using the documented auth path. | 2026-04-24: PR workflow run `24872832811` (`Verify Package Consumer`) succeeded with `GITHUB_TOKEN` + `packages: read`, installed `@service-lasso/service-lasso` from `npm.pkg.github.com`, and ran `service-lasso --version` plus `service-lasso help`. |
| `CONSUMER-002` | `done` | `#71` | Public release-backed Echo Service proves HTTP and TCP health mode transitions through Service Lasso runtime health. | 2026-04-24: `npm run verify:echo-health` exercised the public `2026.4.20-a417abd` Echo release archive with runtime-observed HTTP 200 -> 500 -> 200 health and TCP reachable -> unreachable -> reachable health. |
| `CONSUMER-003` | `done` | `#58` | Reference apps are validated as cloneable templates. | 2026-04-24: fresh clones from GitHub passed `npm ci` and `npm test` against public npmjs for `service-lasso-app-node` (`075651d`), `service-lasso-app-web` (`e44d905`), `service-lasso-app-electron` (`f736984`), `service-lasso-app-tauri` (`e420c6d`), and `service-lasso-app-packager-pkg` (`7e7da44`). Lockfiles resolve `@service-lasso/service-lasso@2026.4.24-a663bb0` from `registry.npmjs.org` without GitHub Packages auth. |
| `CONSUMER-004` | `done` | `#58` | Reference app release outputs are validated as usable artifacts. | 2026-04-24: sequential `npm run release:verify` passed for all five reference repos, verifying source, runtime/bootstrap-download, and preloaded/no-download artifacts where shipped. |
| `CONSUMER-005` | `done` | `#58` | Service Admin is reachable from reference app hosts, not only from its own repo. | 2026-04-24: reference-app host tests and release verification passed with mounted Service Admin payload checks for all five repos. |
| `CONSUMER-006` | `todo` | `#58` | `develop` is promoted to `main` only after readiness evidence is current. | Promotion PR, green release/package workflows, timestamped GitHub release, and package publish evidence. |
| `CONSUMER-007` | `todo` | `#58` | A fresh external project can use the released package and public service manifests. | Clean project smoke with documented package auth, `services/echo-service/service.json`, install/start/stop, and runtime API checks. |
| `CONSUMER-008` | `done` | `#80` | Other projects can install `@service-lasso/service-lasso` from public npm without GitHub Packages auth. | 2026-04-24: Publish workflow run `24876054960` published and verified `@service-lasso/service-lasso@2026.4.24-a663bb0`; local unauthenticated `npm view`, clean temp `npm install`, and `npm run verify:package-consumer` passed against npmjs. |

## Public npmjs Path

Public npmjs is the default consumer path. Normal projects should be able to use:

```bash
npm install @service-lasso/service-lasso
```

Current verified version:

- `@service-lasso/service-lasso@2026.4.24-a663bb0`

## GitHub Packages Legacy Constraint

GitHub Packages for npm requires authentication for installs, including public packages. That means a normal project must provide an auth token before `npm install @service-lasso/service-lasso` can work from `npm.pkg.github.com`.

Current verified non-local path:

- 2026-04-24: workflow run `24872832811` (`https://github.com/service-lasso/service-lasso/actions/runs/24872832811`) succeeded with `GITHUB_TOKEN` and `packages: read`, proving the documented GitHub Actions install path can install the package and run the CLI from `npm.pkg.github.com`.

Required external action for legacy GitHub Packages only:

- provide a classic PAT with `read:packages`, or
- grant the consuming GitHub Actions repository package access and use `GITHUB_TOKEN` with `packages: read`.

## Reference App Validation Note

Prepared local validation passed when run sequentially:

- `service-lasso-app-node`: `npm test` passed 4 tests; `npm run release:verify` passed.
- `service-lasso-app-web`: `npm test` passed 6 tests; `npm run release:verify` passed.
- `service-lasso-app-electron`: `npm test` passed 6 tests; `npm run release:verify` passed.
- `service-lasso-app-tauri`: `npm test` passed 6 tests; `npm run release:verify` passed.
- `service-lasso-app-packager-pkg`: `npm test` passed 4 tests; `npm run release:verify` passed.

Fresh-clone public npmjs validation passed from `C:\projects\service-lasso\.tmp\reference-npmjs-fresh-clone-20260424`:

- `service-lasso-app-node` at `075651d`: `npm ci` and `npm test` passed.
- `service-lasso-app-web` at `e44d905`: `npm ci` and `npm test` passed.
- `service-lasso-app-electron` at `f736984`: `npm ci` and `npm test` passed.
- `service-lasso-app-tauri` at `e420c6d`: `npm ci` and `npm test` passed.
- `service-lasso-app-packager-pkg` at `7e7da44`: `npm ci` and `npm test` passed.

Parallel multi-repo validation previously raced on the shared core package staging directory. Issue `#75` fixed that by staging each reference repo's local core package into an isolated output root and copying the `.tgz` into the app artifact before install; parallel `npm test` now passes across all five reference repos.

## Stop Rule

Do not close `ISS-057` until:

- every row above is verified, blocked with exact external action, invalidated with a follow-up issue, or explicitly deferred.
- `docs/development/release-readiness-validation.md` has matching evidence.
- the repo is back on clean `develop` after each work slice.

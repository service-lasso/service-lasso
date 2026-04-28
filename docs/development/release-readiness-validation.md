# Release Readiness Validation

This document is the execution checklist for `ISS-057` / GitHub issue `#58`.

It exists because a complete governed backlog is not the same as consumer-ready software. Release readiness must be proven from clean consumer contexts, with direct evidence for install, artifacts, service acquisition, reference apps, and failure behavior.

## Status

- Mode: Development, release verification checkpoint
- Current state: release-readiness evidence is complete and ready for `develop` -> `main` promotion. Final promotion evidence is recorded on GitHub issue `#58` after the main-branch release/package workflows pass.
- Governing spec: `SPEC-002`, `AC-4X`
- GitHub issue: `#58`

## Completion Rule

`ISS-057` can close only when every scenario below is classified:

- `Verified`: directly exercised and matches intent
- `Invalidated`: exercised and failed; a focused follow-up issue exists
- `Blocked`: could not be exercised; blocker evidence and next action are recorded
- `Deferred`: explicitly out of this pass; follow-up issue exists

Do not treat green repo tests as release readiness by themselves.

## Core Runtime And Package

| Scenario | Required proof | Status | Evidence |
| --- | --- | --- | --- |
| Fresh clone of `service-lasso` installs dependencies | `npm install` from clean checkout succeeds | Verified | 2026-04-24: fresh clone at `a4674fb`; `npm ci` passed in `C:\projects\service-lasso\.tmp\iss-057-core-validation-20260424`. |
| Core regression suite passes | `npm test` passes | Verified | 2026-04-24: fresh clone `npm test` passed with 84 tests. |
| Release artifact stages cleanly | release staging/verification command succeeds | Verified | 2026-04-24: fresh clone `npm run release:verify` passed for `service-lasso-0.1.0`; versioned override also passed for `service-lasso-2026.4.24-a4674fb`. |
| Version follows project pattern | produced version is `yyyy.m.d-<shortsha>` | Verified | 2026-04-24: `SERVICE_LASSO_RELEASE_VERSION=2026.4.24-a4674fb` produced `service-lasso-2026.4.24-a4674fb.tar.gz` and `service-lasso-package-2026.4.24-a4674fb`. |
| GitHub release artifact has expected shape | artifact includes built runtime, package payload, docs, metadata | Verified | 2026-04-24: downloaded `2026.4.23-6641d6a` release asset from GitHub and verified `release-artifact.json`, `dist/index.js`, `packages/core/index.js`, `packages/core/cli.js`, `package.json`, `package-lock.json`, and `node_modules`; manifest version and `bounded-runtime-download` kind matched. |
| Downloaded release artifact boots with explicit roots | extracted release artifact starts outside the source repo using explicit runtime roots | Verified | 2026-04-24: issue `#63` fixed runtime env-root resolution and release verification now boots the staged artifact from the artifact directory with explicit `SERVICE_LASSO_SERVICES_ROOT` / `SERVICE_LASSO_WORKSPACE_ROOT`; `SERVICE_LASSO_RELEASE_VERSION=2026.4.24-envroot2 npm run release:verify` passed. The older published `2026.4.23-6641d6a` artifact remains historical invalidation evidence until the next `main` release. |
| Public npm install works | clean consumer installs `@service-lasso/service-lasso` from `registry.npmjs.org` without GitHub Packages auth | Verified | 2026-04-24: publish workflow run `24876054960` published `@service-lasso/service-lasso@2026.4.24-a663bb0` and verified the registry-installed CLI. Local unauthenticated `npm view`, clean temp `npm install`, and `npm run verify:package-consumer` also passed against `registry.npmjs.org`. |
| GitHub Packages install works | clean consumer installs `@service-lasso/service-lasso` from `npm.pkg.github.com` | Verified | 2026-04-24: PR workflow run `24872832811` (`Verify Package Consumer`) used `GITHUB_TOKEN` with `packages: read`, installed `@service-lasso/service-lasso` from `npm.pkg.github.com`, and ran `service-lasso --version` plus `service-lasso help` successfully. |
| Installed CLI starts | consumer can run `service-lasso --help` and start runtime | Verified | 2026-04-24: clean consumer installed staged `.tgz`; `npx service-lasso help` worked; package API boot worked through `startApiServer`. |
| Packaged CLI reports release version | consumer can run `service-lasso --version` and see the installed package version | Verified | 2026-04-24: issue `#60` fixed the packaged version resolver; `SERVICE_LASSO_RELEASE_VERSION=2026.4.24-fixver2 npm run package:verify` passed and `node artifacts/npm/service-lasso-package-2026.4.24-fixver2/cli.js --version` returned `2026.4.24-fixver2`. |
| CLI install works without start | consumer can run `service-lasso install <serviceId>` | Verified | 2026-04-24: `npm test` covers `service-lasso install <serviceId>` against manifest-owned artifact metadata, and package verification exercises the installed CLI from a temporary consumer package. |
| Runtime lists services | consumer runtime reports configured services through API | Verified | 2026-04-24: installed package API probe returned 4 services, including `echo-service`. |
| Runtime starts and stops Echo Service | start/stop works from installed package context | Verified | 2026-04-24: installed package API probe ran `install`, `config`, `start`, and `stop` for `echo-service`; final detail showed `echoRunning: false`. |
| Fresh external project smoke works | clean consumer project installs package, uses public manifests, and drives lifecycle through CLI/API | Verified | 2026-04-24: clean temp project installed `@service-lasso/service-lasso@2026.4.24-a663bb0` from npmjs, downloaded public Echo Service and Service Admin manifests from `service-lasso-app-node`, verified CLI version, ran `service-lasso install echo-service --json`, started the package API, listed both services, configured/started/stopped Echo Service, and fetched Echo UI from `http://127.0.0.1:4010/`. |

## Service Acquisition

| Scenario | Required proof | Status | Evidence |
| --- | --- | --- | --- |
| `services/<serviceId>/service.json` is sufficient | no sidecar release-source metadata is required | Verified | 2026-04-24: acquisition tests construct only `services/downloaded-service/service.json` with first-class `artifact` metadata; reference app `service-lasso-app-node/services/echo-service/service.json` also carries the release metadata directly. No `release-source.json` sidecar is needed. |
| Echo Service downloads from manifest artifact metadata | archive resolves from GitHub release metadata in `service.json` | Verified | 2026-04-24: after `service-lasso/lasso-echoservice` was made public, real acquisition using `service-lasso-app-node/services/echo-service/service.json` installed `echo-service-win32.zip` from release `2026.4.20-a417abd` into runtime-owned `.state/artifacts` and extracted it into `.state/extracted/current`. |
| Installed state is recorded separately from source manifest | install metadata persists in runtime-owned state | Verified | 2026-04-24: `tests/install-acquire.test.js` asserts archive/extract metadata is persisted in runtime-owned `.state/install.json`, while the source manifest remains the input contract. |
| Repeat install avoids unnecessary redownload | second install reuses existing archive/payload where valid | Verified | 2026-04-24: `tests/install-acquire.test.js` verifies an already-acquired archive under `.state/artifacts/<release>` is reused and the fake release server receives zero download requests. |
| Bad archive URL fails clearly | deterministic error is reported and persisted as appropriate | Verified | 2026-04-24: added regression coverage for a resolved artifact download returning `404`; the install API returns a deterministic failure message and does not persist install state. |
| Missing release artifact fails clearly | deterministic error is reported and follow-up is tracked if behavior is weak | Verified | 2026-04-24: added regression coverage for release metadata missing the requested asset; the install API returns a deterministic failure message and does not persist install state. |

## Service Admin And Echo Service

| Scenario | Required proof | Status | Evidence |
| --- | --- | --- | --- |
| Service Admin is available where reference apps require it | app can open or link to admin UI | Verified | 2026-04-24: reference-app host tests and release verification passed mounted Service Admin payload checks for all five canonical app repos; the reference-app matrix also marks Service Admin reachability verified. |
| Service Admin consumes runtime services | admin service list/detail surfaces load from runtime API | Verified | 2026-04-24: `service-lasso/lasso-serviceadmin` is public; local `npm test` passed 27 tests including runtime dashboard adapter coverage, and `npm run build` passed. |
| Echo Service UI is reachable | harness UI opens from runtime-managed service | Verified | 2026-04-24: runtime-managed Echo Service installed/configured/started from the public release-backed manifest and `GET http://127.0.0.1:4010/` returned `200` with Echo Service UI content. |
| Echo Service stdout/stderr actions are captured | Service Lasso logs show emitted stdout/stderr lines | Verified | 2026-04-24: runtime-managed Echo Service `/action/write-stdout` and `/action/write-stderr` returned `200`, and `/api/services/echo-service/logs` contained the emitted validation lines. |
| Echo Service health modes are observable | HTTP/TCP health mode changes affect runtime-observed health | Verified | 2026-04-24: `npm run verify:echo-health` created temporary release-backed Echo manifests from the public `2026.4.20-a417abd` archive and proved runtime-observed HTTP health changes from `200` to `500` and back, plus TCP listener reachability from connected to refused and back. |
| Echo Service crash/error/abort paths are observable | runtime records failure state and remains manageable | Verified | 2026-04-24: `/action/error` returned `500` while runtime still reported the service running and stoppable; `/action/abort` caused runtime state to report `running=false`, `lastTermination=crashed`, `exitCode=2`, and `crashCount=1`. |

## Reference Apps

Validate each repo:

- `service-lasso-app-node`
- `service-lasso-app-web`
- `service-lasso-app-electron`
- `service-lasso-app-tauri`
- `service-lasso-app-packager-pkg`

| Scenario | Required proof | Status | Evidence |
| --- | --- | --- | --- |
| Fresh clone works | clean checkout can install dependencies | Verified | 2026-04-24: fresh clones from GitHub passed `npm ci` and `npm test` against public npmjs for `service-lasso-app-node` (`075651d`), `service-lasso-app-web` (`e44d905`), `service-lasso-app-electron` (`f736984`), `service-lasso-app-tauri` (`e420c6d`), and `service-lasso-app-packager-pkg` (`7e7da44`). |
| Repo tests pass | repo-local test command succeeds | Verified | 2026-04-24: sequential and parallel `npm test` passed for all five reference repos: `app-node` 4 tests, `app-web` 6, `app-electron` 6, `app-tauri` 6, and `app-packager-pkg` 4. Shared staging contention was fixed under `#75`. |
| Release verification passes | repo-local release verification command succeeds | Verified | 2026-04-24: sequential `npm run release:verify` passed for all five reference repos. |
| Source/template mode works | user can run from source/template checkout | Verified | 2026-04-24: same fresh-clone validation proved source/template install and tests from public npmjs without GitHub Packages auth; each lockfile resolves `@service-lasso/service-lasso@2026.4.24-a663bb0` from `registry.npmjs.org`. |
| Bootstrap-download artifact works | app can acquire service payloads from manifest release metadata | Verified | 2026-04-24: each reference repo `npm run release:verify` exercised runtime/bootstrap-download artifacts and verified Echo Service archive acquisition from manifest-owned metadata. |
| Bundled/no-download artifact works offline | app starts with included service payloads and performs no first-run download | Verified | 2026-04-25: each reference repo `npm run release:verify` exercised bundled artifacts and verified zero first-run service archive downloads. |
| Host-owned output is visible | app shows its own UI/output, not only Service Admin | Verified | 2026-04-24: reference-app host tests passed for shell/status routes across all five repos. |
| Service listing widget works | app lists services through Service Lasso API | Verified | 2026-04-24: `app-web`, `app-electron`, and `app-tauri` tests passed their host-owned `/api/runtime-services` proxy/widget coverage; `app-node` and `app-packager-pkg` host-status coverage passed for their bounded host shape. |
| Service Admin is reachable | app can access Service Admin UI | Verified | 2026-04-24: host tests and release verification passed mounted Service Admin payload checks for all five reference repos. |
| Echo Service can be installed/started/stopped | app exercises Service Lasso lifecycle against Echo Service | Verified | 2026-04-25: `npm run verify:reference-app-lifecycle` fresh-cloned all five canonical reference apps, installed dependencies, mounted a deterministic Service Admin dist, verified host/admin/runtime readiness, verified runtime service lists include `echo-service` and Service Admin, then installed/configured/started/stopped Echo Service through each app-owned runtime with deterministic process cleanup. `#216` later corrected the Service Admin service ID to `@serviceadmin`. |

## Failure Scenarios

| Scenario | Required proof | Status | Evidence |
| --- | --- | --- | --- |
| Missing GitHub package access | install failure is understandable and documented | Verified | 2026-04-24: the local verifier now classifies missing auth as `E401` and the current `gh auth token` as `E403 insufficient_scope`, with explicit guidance to use a classic PAT with `read:packages` locally or `GITHUB_TOKEN` plus `packages: read` in Actions. |
| Missing npm publish token | protected-branch package workflow fails before publish with actionable guidance | Verified | 2026-04-24: earlier publish workflow attempts failed clearly for missing/invalid npm publishing credentials, then run `24876054960` succeeded after `NPM_TOKEN` was replaced with a CI-publishable token. |
| Missing service release artifact | acquisition failure is deterministic | Verified | 2026-04-24: `tests/install-acquire.test.js` covers a release metadata payload that lacks the requested asset and confirms install state is not persisted. |
| Bad archive URL | acquisition failure is deterministic | Verified | 2026-04-24: `tests/install-acquire.test.js` covers a resolved archive URL returning `404` and confirms install state is not persisted. |
| Port conflict | runtime reports conflict or negotiates according to manifest rules | Verified | 2026-04-24: clean external consumer smoke installed `@service-lasso/service-lasso@2026.4.24-a663bb0`, configured two services with the same preferred `service` port `43100`, and runtime negotiation kept alpha at `43100` while assigning beta `43101` with matching network endpoint output. |
| Offline bundled startup | bundled artifact starts without network access | Verified | 2026-04-24: clean external consumer smoke seeded the Echo archive under `.state/artifacts/2026.4.20-a417abd/`, changed the manifest asset URL to dead `http://127.0.0.1:9/should-not-be-downloaded.zip`, and `install` still succeeded by reusing the already-acquired archive path. |
| Repeated install/start/stop | repeated lifecycle stays stable | Verified | 2026-04-24: clean external consumer smoke installed/configured the public Echo Service release and completed two consecutive start/stop cycles through the installed package API. |
| Service crash/error/abort | runtime exposes failure state and logs | Verified | 2026-04-24: clean external consumer smoke started the public Echo Service release, confirmed `/action/error` returned `500` while runtime remained manageable, then `/action/abort` produced `running=false`, `lastTermination=crashed`, `exitCode=2`, and `crashCount=1`. |
| Packaged CLI version mismatch | installed CLI reports the staged package version | Verified | Issue `#60` fixed the mismatch; package verification now asserts the temporary installed CLI reports the staged package version and the runtime health version matches the package version. |
| Parallel reference-app validation | multi-repo validation can run without shared staging races | Verified | 2026-04-24: issue `#75` fixed the shared staging race by adding isolated core package output support and having each reference repo copy the staged `.tgz` into its own app artifact before install; parallel `npm test` now passes across all five reference repos. |

## Execution Order

1. Validate core package and release artifact behavior.
2. Validate service acquisition using Echo Service.
3. Validate Service Admin integration against the runtime API.
4. Validate reference apps one repo at a time.
5. Validate failure scenarios.
6. Create follow-up issues for every non-verified scenario.
7. Close `ISS-057` only when the final classification is honest.

## Evidence Log

Record exact commands, dates, commit SHAs, release versions, artifact names, and outcomes here or in linked issue comments during execution.

- 2026-04-24: fresh clone validation at `a4674fb` in `C:\projects\service-lasso\.tmp\iss-057-core-validation-20260424`.
- 2026-04-24: `npm ci`, `npm test`, `npm run release:verify`, and `npm run package:verify` passed in the fresh clone.
- 2026-04-24: versioned artifact validation with `SERVICE_LASSO_RELEASE_VERSION=2026.4.24-a4674fb` produced and verified `service-lasso-2026.4.24-a4674fb.tar.gz` plus `service-lasso-package-2026.4.24-a4674fb`.
- 2026-04-24: clean CLI consumer installed `service-lasso-service-lasso-2026.4.24-a4674fb.tgz`; `npx service-lasso help` worked, but `npx service-lasso --version` returned `0.1.0`, tracked as issue `#60`.
- 2026-04-24: clean API consumer installed the staged package, booted the runtime at `http://127.0.0.1:18192`, listed 4 services, and ran `echo-service` through `install`, `config`, `start`, and `stop`.
- 2026-04-24: issue `#60` fixed package version reporting by resolving version from the shipped package metadata; `npm test` passed with 84 tests, `SERVICE_LASSO_RELEASE_VERSION=2026.4.24-fixver2 npm run package:verify` passed, and the staged package CLI returned `2026.4.24-fixver2`.
- 2026-04-24: GitHub release `2026.4.23-6641d6a` exists and was published from target `6641d6ae133f682d5e70b6929ff42e57f61210be`; its `.tar.gz` asset has the expected bounded runtime download shape.
- 2026-04-24: downloaded/extracted `2026.4.23-6641d6a` artifact boot failed with explicit `SERVICE_LASSO_SERVICES_ROOT` / `SERVICE_LASSO_WORKSPACE_ROOT`, because the entrypoint tried to use missing artifact-local `services/`; tracked as issue `#63`.
- 2026-04-24: issue `#63` fixed release artifact boot by allowing env-provided runtime roots through `startRuntimeApp`; `npm test` passed with 85 tests and `SERVICE_LASSO_RELEASE_VERSION=2026.4.24-envroot2 npm run release:verify` proved the staged artifact boots from its own directory while using explicit source/service and temporary workspace roots.
- 2026-04-24: GitHub Packages install validation is blocked by available credentials: unauthenticated npm returns `E401`, and the current `gh auth token` returns `E403 permission_denied: read_package`.
- 2026-04-24: Service acquisition mechanics were expanded with deterministic regression coverage for manifest-owned install, installed state persistence, already-acquired archive reuse, missing release assets, and bad archive URLs; targeted `node --test --test-concurrency=1 tests/install-acquire.test.js` passed with 5 tests.
- 2026-04-24: real Echo Service acquisition from `service-lasso-app-node/services/echo-service/service.json` invalidated the current private-release path: `gh release view 2026.4.20-a417abd --repo service-lasso/lasso-echoservice` shows the assets exist, but unauthenticated fetch of `echo-service-win32.zip` returns `404`; tracked as issue `#66`.
- 2026-04-24: after the service-acquisition validation update, `npm test` passed with 87 tests, `SERVICE_LASSO_RELEASE_VERSION=2026.4.24-acquire1 npm run package:verify` passed, and `SERVICE_LASSO_RELEASE_VERSION=2026.4.24-acquire1 npm run release:verify` passed.
- 2026-04-24: `service-lasso/lasso-echoservice` was made public; unauthenticated real Echo Service acquisition from `service-lasso-app-node/services/echo-service/service.json` now installs `echo-service-win32.zip` from `2026.4.20-a417abd`, persists runtime-owned archive/extract state, leaves the source manifest state-free, and reuses the archive on a second install.
- 2026-04-24: public repository visibility was confirmed for `service-lasso/service-lasso`, `service-lasso/lasso-echoservice`, `service-lasso/lasso-serviceadmin`, `service-lasso/service-lasso-app-node`, `service-lasso/service-lasso-app-web`, `service-lasso/service-lasso-app-electron`, `service-lasso/service-lasso-app-tauri`, `service-lasso/service-lasso-app-packager-pkg`, and `service-lasso/service-template`.
- 2026-04-24: local GitHub Packages validation still requires explicit auth: unauthenticated npm returns `E401`, and `npm run verify:package-consumer` with the current `gh auth token` returns explicit `E403 insufficient_scope` guidance because that token does not include `read:packages`.
- 2026-04-24: PR workflow run `24872832811` (`https://github.com/service-lasso/service-lasso/actions/runs/24872832811`) proved the documented GitHub Actions auth path by installing `@service-lasso/service-lasso` from `npm.pkg.github.com` and running `service-lasso --version` plus `service-lasso help` successfully.
- 2026-04-24: issue `#80` moved the default consumer package path from GitHub Packages to public npmjs under `@service-lasso/service-lasso`; publish workflow run `24876054960` published and verified `@service-lasso/service-lasso@2026.4.24-a663bb0`.
- 2026-04-24: local unauthenticated npmjs proof passed for `@service-lasso/service-lasso@2026.4.24-a663bb0`: `npm view`, clean temporary `npm install`, and `npm run verify:package-consumer` all succeeded against `https://registry.npmjs.org`.
- 2026-04-24: consumer-readiness task list created in `docs/development/consumer-project-readiness-task-list.md`; GitHub Packages consumer docs now state that npm installs require authentication even for public packages, with local PAT and GitHub Actions examples.
- 2026-04-24: Echo Service harness validation passed in its own repo with `go test ./...` and `pwsh -NoLogo -NoProfile -File .\scripts\verify.ps1`.
- 2026-04-24: runtime-managed Echo Service validation from the public release-backed app-node manifest proved install/config/start/stop, UI reachability, stdout/stderr log capture, process health, error response manageability, and abort/crash state recording.
- 2026-04-24: `service-lasso/lasso-serviceadmin` validation passed with `npm test` (27 tests) and `npm run build`; runtime dashboard adapter coverage is present in the admin repo tests.
- 2026-04-24: Echo Service HTTP/TCP health-mode validation through runtime is invalidated for the current release-backed reference manifest because it uses `process` health; tracked as issue `#71`.
- 2026-04-24: issue `#71` is resolved by `npm run verify:echo-health`, which installs and starts the public Echo Service release archive from `service.json` artifact metadata, validates runtime-observed HTTP health `200 -> 500 -> 200`, and validates TCP health `connected -> ECONNREFUSED -> connected`. TCP proof is listener reachability/unreachability because the current runtime TCP health contract checks connection success rather than response payload.
- 2026-04-24: prepared local reference-app validation passed sequentially: `npm test` passed in `service-lasso-app-node` (4 tests), `service-lasso-app-web` (6), `service-lasso-app-electron` (6), `service-lasso-app-tauri` (6), and `service-lasso-app-packager-pkg` (4).
- 2026-04-25: sequential `npm run release:verify` passed in all five reference repos, verifying source, runtime/bootstrap-download, and bundled/no-download artifacts plus mounted Service Admin payloads. `service-lasso-app-packager-pkg` verified Windows runtime/bundled wrapper artifacts.
- 2026-04-24: fresh clone of `service-lasso-app-node` succeeded, but `npm ci` failed locally with GitHub Packages `E401`; auth/path proof is covered by issue `#69`, and issue `#80` changes the next fresh-clone proof target to public npmjs without GitHub Packages auth.
- 2026-04-24: parallel `npm test` across all five reference repos invalidated the current multi-repo validation harness because shared core package staging produced `EBUSY` / `ENOTEMPTY` / missing `.tgz` failures on Windows; tracked as issue `#75`. Sequential validation remains the current reliable path.
- 2026-04-24: issue `#75` fixed the parallel reference-app validation race. Core targeted `node --test --test-concurrency=1 tests/package-staging-lock.test.js` passed, and parallel `npm test` passed across `service-lasso-app-node`, `service-lasso-app-web`, `service-lasso-app-electron`, `service-lasso-app-tauri`, and `service-lasso-app-packager-pkg`.
- 2026-04-24: all five canonical reference apps were migrated to the public npmjs package path and merged through PRs: `service-lasso-app-node#5`, `service-lasso-app-web#16`, `service-lasso-app-electron#5`, `service-lasso-app-tauri#15`, and `service-lasso-app-packager-pkg#7`. Fresh clones from GitHub in `C:\projects\service-lasso\.tmp\reference-npmjs-fresh-clone-20260424` passed `npm ci` and `npm test` for app refs `075651d`, `e44d905`, `f736984`, `e420c6d`, and `7e7da44`, with lockfiles resolving `@service-lasso/service-lasso@2026.4.24-a663bb0` from `registry.npmjs.org`.
- 2026-04-24: clean external consumer project smoke passed in `C:\projects\service-lasso\.tmp\consumer-007-external-project-20260424`: installed `@service-lasso/service-lasso@2026.4.24-a663bb0` from npmjs, downloaded public Echo Service and Service Admin manifests from `service-lasso-app-node`, verified `npx service-lasso --version`, ran `npx service-lasso install echo-service --json`, started the package API, listed both services, configured/started/stopped Echo Service, and fetched the Echo UI from `http://127.0.0.1:4010/`.
- 2026-04-24: clean external failure/lifecycle smoke passed in `C:\projects\service-lasso\.tmp\iss-057-failure-lifecycle-smoke-20260424`: installed `@service-lasso/service-lasso@2026.4.24-a663bb0` from npmjs; verified port collision negotiation `43100 -> 43101`; verified repeated Echo install/config/start/stop; verified bundled/no-download install with dead asset URL `http://127.0.0.1:9/should-not-be-downloaded.zip`; and verified Echo error/abort state with `500`, `lastTermination=crashed`, `exitCode=2`, and `crashCount=1`.
- 2026-04-25: issue `#89` added `npm run verify:reference-app-lifecycle`; the command passed locally after fresh-cloning `service-lasso-app-node`, `service-lasso-app-web`, `service-lasso-app-electron`, `service-lasso-app-tauri`, and `service-lasso-app-packager-pkg`, proving host shell, Service Admin route, runtime service list, Echo Service install/config/start/stop, and app/runtime process cleanup for all five source-host shapes. On Windows the script leaves temp clone roots for OS cleanup after process/port cleanup is proven to avoid transient `EBUSY` false failures from `node_modules` handles.
- 2026-04-25: issue `#93` added bounded Java provider support with `services/@java/service.json`, `execservice: "@java"` provider resolution, lifecycle/provider runtime evidence, and `docs/development/java-runtime-service-plan.md` for the deferred release-backed JRE distribution decision. `npm test` passed with 101 tests.
- 2026-04-25: final `#58` promotion evidence is expected from the `develop` -> `main` promotion after this readiness closure lands. Main-branch workflows must pass `release-artifact` and `publish-package`; exact workflow run URLs, release version, and npm package version are recorded in issue `#58` before closure.

# Release Readiness Validation

This document is the execution checklist for `ISS-057` / GitHub issue `#58`.

It exists because a complete governed backlog is not the same as consumer-ready software. Release readiness must be proven from clean consumer contexts, with direct evidence for install, artifacts, service acquisition, reference apps, and failure behavior.

## Status

- Mode: Development, release verification checkpoint
- Current state: checklist established; execution pending
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
| GitHub Packages install works | clean consumer installs `@service-lasso/service-lasso` from `npm.pkg.github.com` | Blocked | 2026-04-24: after repos were made public, `npm view @service-lasso/service-lasso --registry=https://npm.pkg.github.com versions --json` still returns `E401` without npm auth and `E403 permission_denied` with the current `gh auth token`; tracked as issue `#69`. |
| Installed CLI starts | consumer can run `service-lasso --help` and start runtime | Verified | 2026-04-24: clean consumer installed staged `.tgz`; `npx service-lasso help` worked; package API boot worked through `startApiServer`. |
| Packaged CLI reports release version | consumer can run `service-lasso --version` and see the installed package version | Verified | 2026-04-24: issue `#60` fixed the packaged version resolver; `SERVICE_LASSO_RELEASE_VERSION=2026.4.24-fixver2 npm run package:verify` passed and `node artifacts/npm/service-lasso-package-2026.4.24-fixver2/cli.js --version` returned `2026.4.24-fixver2`. |
| CLI install works without start | consumer can run `service-lasso install <serviceId>` | Verified | 2026-04-24: `npm test` covers `service-lasso install <serviceId>` against manifest-owned artifact metadata, and package verification exercises the installed CLI from a temporary consumer package. |
| Runtime lists services | consumer runtime reports configured services through API | Verified | 2026-04-24: installed package API probe returned 4 services, including `echo-service`. |
| Runtime starts and stops Echo Service | start/stop works from installed package context | Verified | 2026-04-24: installed package API probe ran `install`, `config`, `start`, and `stop` for `echo-service`; final detail showed `echoRunning: false`. |

## Service Acquisition

| Scenario | Required proof | Status | Evidence |
| --- | --- | --- | --- |
| `services/<serviceId>/service.json` is sufficient | no sidecar release-source metadata is required | Verified | 2026-04-24: acquisition tests construct only `services/downloaded-service/service.json` with first-class `artifact` metadata; reference app `service-lasso-app-node/services/echo-service/service.json` also carries the release metadata directly. No `release-source.json` sidecar is needed. |
| Echo Service downloads from manifest artifact metadata | archive resolves from GitHub release metadata in `service.json` | Verified | 2026-04-24: after `service-lasso/lasso-echoservice` was made public, real acquisition using `service-lasso-app-node/services/echo-service/service.json` installed `echo-service-win32.zip` from release `2026.4.20-a417abd` into runtime-owned `.state/artifacts` and extracted it into `.state/extracted/current`. |
| Installed state is recorded separately from source manifest | install metadata persists in runtime-owned state | Verified | 2026-04-24: `tests/install-acquire.test.js` asserts archive/extract metadata is persisted in runtime-owned `.state/install.json`, while the source manifest remains the input contract. |
| Repeat install avoids unnecessary redownload | second install reuses existing archive/payload where valid | Verified | 2026-04-24: `tests/install-acquire.test.js` verifies a preloaded archive under `.state/artifacts/<release>` is reused and the fake release server receives zero download requests. |
| Bad archive URL fails clearly | deterministic error is reported and persisted as appropriate | Verified | 2026-04-24: added regression coverage for a resolved artifact download returning `404`; the install API returns a deterministic failure message and does not persist install state. |
| Missing release artifact fails clearly | deterministic error is reported and follow-up is tracked if behavior is weak | Verified | 2026-04-24: added regression coverage for release metadata missing the requested asset; the install API returns a deterministic failure message and does not persist install state. |

## Service Admin And Echo Service

| Scenario | Required proof | Status | Evidence |
| --- | --- | --- | --- |
| Service Admin is available where reference apps require it | app can open or link to admin UI | Pending | |
| Service Admin consumes runtime services | admin service list/detail surfaces load from runtime API | Pending | |
| Echo Service UI is reachable | harness UI opens from runtime-managed service | Pending | |
| Echo Service stdout/stderr actions are captured | Service Lasso logs show emitted stdout/stderr lines | Pending | |
| Echo Service health modes are observable | HTTP/TCP health mode changes affect runtime-observed health | Pending | |
| Echo Service crash/error/abort paths are observable | runtime records failure state and remains manageable | Pending | |

## Reference Apps

Validate each repo:

- `service-lasso-app-node`
- `service-lasso-app-web`
- `service-lasso-app-electron`
- `service-lasso-app-tauri`
- `service-lasso-app-packager-pkg`

| Scenario | Required proof | Status | Evidence |
| --- | --- | --- | --- |
| Fresh clone works | clean checkout can install dependencies | Pending | |
| Repo tests pass | repo-local test command succeeds | Pending | |
| Release verification passes | repo-local release verification command succeeds | Pending | |
| Source/template mode works | user can run from source/template checkout | Pending | |
| Bootstrap-download artifact works | app can acquire service payloads from manifest release metadata | Pending | |
| Preloaded/no-download artifact works offline | app starts with included service payloads and performs no first-run download | Pending | |
| Host-owned output is visible | app shows its own UI/output, not only Service Admin | Pending | |
| Service listing widget works | app lists services through Service Lasso API | Pending | |
| Service Admin is reachable | app can access Service Admin UI | Pending | |
| Echo Service can be installed/started/stopped | app exercises Service Lasso lifecycle against Echo Service | Pending | |

## Failure Scenarios

| Scenario | Required proof | Status | Evidence |
| --- | --- | --- | --- |
| Missing GitHub package access | install failure is understandable and documented | Blocked | 2026-04-24: GitHub Packages validation remains blocked by available credentials: unauthenticated npm returns `E401`, and the current `gh auth token` returns `E403 permission_denied`; tracked as issue `#69`. |
| Missing service release artifact | acquisition failure is deterministic | Verified | 2026-04-24: `tests/install-acquire.test.js` covers a release metadata payload that lacks the requested asset and confirms install state is not persisted. |
| Bad archive URL | acquisition failure is deterministic | Verified | 2026-04-24: `tests/install-acquire.test.js` covers a resolved archive URL returning `404` and confirms install state is not persisted. |
| Port conflict | runtime reports conflict or negotiates according to manifest rules | Pending | |
| Offline preloaded startup | preloaded artifact starts without network access | Pending | |
| Repeated install/start/stop | repeated lifecycle stays stable | Pending | |
| Service crash/error/abort | runtime exposes failure state and logs | Pending | |
| Packaged CLI version mismatch | installed CLI reports the staged package version | Verified | Issue `#60` fixed the mismatch; package verification now asserts the temporary installed CLI reports the staged package version and the runtime health version matches the package version. |

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
- 2026-04-24: Service acquisition mechanics were expanded with deterministic regression coverage for manifest-owned install, installed state persistence, preloaded archive reuse, missing release assets, and bad archive URLs; targeted `node --test --test-concurrency=1 tests/install-acquire.test.js` passed with 5 tests.
- 2026-04-24: real Echo Service acquisition from `service-lasso-app-node/services/echo-service/service.json` invalidated the current private-release path: `gh release view 2026.4.20-a417abd --repo service-lasso/lasso-echoservice` shows the assets exist, but unauthenticated fetch of `echo-service-win32.zip` returns `404`; tracked as issue `#66`.
- 2026-04-24: after the service-acquisition validation update, `npm test` passed with 87 tests, `SERVICE_LASSO_RELEASE_VERSION=2026.4.24-acquire1 npm run package:verify` passed, and `SERVICE_LASSO_RELEASE_VERSION=2026.4.24-acquire1 npm run release:verify` passed.
- 2026-04-24: `service-lasso/lasso-echoservice` was made public; unauthenticated real Echo Service acquisition from `service-lasso-app-node/services/echo-service/service.json` now installs `echo-service-win32.zip` from `2026.4.20-a417abd`, persists runtime-owned archive/extract state, leaves the source manifest state-free, and reuses the archive on a second install.
- 2026-04-24: public repository visibility was confirmed for `service-lasso/service-lasso`, `service-lasso/lasso-echoservice`, `service-lasso/lasso-serviceadmin`, `service-lasso/service-lasso-app-node`, `service-lasso/service-lasso-app-web`, `service-lasso/service-lasso-app-electron`, `service-lasso/service-lasso-app-tauri`, `service-lasso/service-lasso-app-packager-pkg`, and `service-lasso/service-template`.
- 2026-04-24: GitHub Packages access remains blocked after public repo visibility: unauthenticated `npm view @service-lasso/service-lasso --registry=https://npm.pkg.github.com versions --json` returns `E401`, and the current `gh auth token` in a temporary `.npmrc` returns `E403 permission_denied`; tracked as issue `#69`.

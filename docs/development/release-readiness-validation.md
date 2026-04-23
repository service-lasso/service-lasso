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
| Downloaded release artifact boots with explicit roots | extracted release artifact starts outside the source repo using explicit runtime roots | Invalidated | 2026-04-24: extracted `2026.4.23-6641d6a` artifact failed to boot with explicit env roots and tried to use a missing artifact-local `services/`; follow-up issue `#63`. |
| GitHub Packages install works | clean consumer installs `@service-lasso/service-lasso` from `npm.pkg.github.com` | Blocked | 2026-04-24: `npm view @service-lasso/service-lasso --registry=https://npm.pkg.github.com versions --json` returns `E401` without npm auth and `E403 permission_denied: read_package` with the current `gh auth token`; requires a token/account with GitHub Packages read scope/access. |
| Installed CLI starts | consumer can run `service-lasso --help` and start runtime | Verified | 2026-04-24: clean consumer installed staged `.tgz`; `npx service-lasso help` worked; package API boot worked through `startApiServer`. |
| Packaged CLI reports release version | consumer can run `service-lasso --version` and see the installed package version | Verified | 2026-04-24: issue `#60` fixed the packaged version resolver; `SERVICE_LASSO_RELEASE_VERSION=2026.4.24-fixver2 npm run package:verify` passed and `node artifacts/npm/service-lasso-package-2026.4.24-fixver2/cli.js --version` returned `2026.4.24-fixver2`. |
| CLI install works without start | consumer can run `service-lasso install <serviceId>` | Pending | |
| Runtime lists services | consumer runtime reports configured services through API | Verified | 2026-04-24: installed package API probe returned 4 services, including `echo-service`. |
| Runtime starts and stops Echo Service | start/stop works from installed package context | Verified | 2026-04-24: installed package API probe ran `install`, `config`, `start`, and `stop` for `echo-service`; final detail showed `echoRunning: false`. |

## Service Acquisition

| Scenario | Required proof | Status | Evidence |
| --- | --- | --- | --- |
| `services/<serviceId>/service.json` is sufficient | no sidecar release-source metadata is required | Pending | |
| Echo Service downloads from manifest artifact metadata | archive resolves from GitHub release metadata in `service.json` | Pending | |
| Installed state is recorded separately from source manifest | install metadata persists in runtime-owned state | Pending | |
| Repeat install avoids unnecessary redownload | second install reuses existing archive/payload where valid | Pending | |
| Bad archive URL fails clearly | deterministic error is reported and persisted as appropriate | Pending | |
| Missing release artifact fails clearly | deterministic error is reported and follow-up is tracked if behavior is weak | Pending | |

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
| Missing GitHub package access | install failure is understandable and documented | Pending | |
| Missing service release artifact | acquisition failure is deterministic | Pending | |
| Bad archive URL | acquisition failure is deterministic | Pending | |
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
- 2026-04-24: GitHub Packages install validation is blocked by available credentials: unauthenticated npm returns `E401`, and the current `gh auth token` returns `E403 permission_denied: read_package`.

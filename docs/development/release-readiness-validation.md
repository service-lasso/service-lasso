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
| Fresh clone of `service-lasso` installs dependencies | `npm install` from clean checkout succeeds | Pending | |
| Core regression suite passes | `npm test` passes | Pending | |
| Release artifact stages cleanly | release staging/verification command succeeds | Pending | |
| Version follows project pattern | produced version is `yyyy.m.d-<shortsha>` | Pending | |
| GitHub release artifact has expected shape | artifact includes built runtime, package payload, docs, metadata | Pending | |
| GitHub Packages install works | clean consumer installs `@service-lasso/service-lasso` from `npm.pkg.github.com` | Pending | |
| Installed CLI starts | consumer can run `service-lasso --help` and start runtime | Pending | |
| CLI install works without start | consumer can run `service-lasso install <serviceId>` | Pending | |
| Runtime lists services | consumer runtime reports configured services through API | Pending | |
| Runtime starts and stops Echo Service | start/stop works from installed package context | Pending | |

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

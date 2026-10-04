---
title: Documented example verification
---

# Documented example verification

Independent execution review on **4 October 2026**, on Windows with Node 22,
in owned workspaces and isolated instance/port registries. This records actual
example outcomes; it is not Linux/macOS, release or GA qualification.

## Managed Todo learning path

The corrected [beginner](../getting-started/beginner-todo-app.md),
[PostgreSQL](../getting-started/intermediate-make-todo-app-durable.md) and
[Go API](../getting-started/advanced-add-go-todo-api-service.md) examples were
executed against real Service Lasso, not by manually starting the app binaries.

| Check | Observed result |
| --- | --- |
| Add Todo to the default running inventory | Discovered in the canonical demo and actual Admin UI |
| Install/configure/start through Lasso | Released Node provider and Todo HTTP health passed |
| Todo browser create/refresh | Passed; same saved ID and title retained |
| Admin Stop/confirmation/Start | Listener became unavailable, then restarted with the same todo |
| Add PostgreSQL | Pinned release acquired; real SQL create/list passed |
| Move beginner data to SQL | Original JSON todo ID retained; later SQL todo survived restart |
| Add Go API | Managed dependency chain, actual browser proxy path and API log confirmed |
| Stop API and recover | Todo returned 503, then recovered through managed service actions |
| Restart application service chain | All prior todo IDs retained |

The reviewer caught and reran fixes for the running inventory path, required
manifest description and direct executable path. The earlier external-host
architecture and comment-only Go sketch did not satisfy these lessons.

## Wider example inventory

| Article/example | Observed result and remaining boundary |
| --- | --- |
| PostgreSQL source smoke example | SQL/HTTP, stop/restart and setting 120 passed with isolated registries |
| Packaged PostgreSQL recipient | Pack, unpack, install, setup and real SQL/HTTP passed |
| Reference host sources: Node, web, Electron, Tauri, pkg, SEA, nexe | Dependency install passed; source startup needs an absent sibling Admin build. [#1660](https://github.com/service-lasso/service-lasso/issues/1660) |
| pkg/SEA/nexe Windows wrappers | Builds and host/API/Admin HTTP passed; Echo failed to launch its missing fixture command. [#1661](https://github.com/service-lasso/service-lasso/issues/1661) |
| Harness starter, latest reviewed develop | Package/contract validation passed; Windows direct execution failed. The article's historical source pin is a separate boundary. [#1662](https://github.com/service-lasso/service-lasso/issues/1662) |
| Wire-consumers import | Old illustrative Dagu tag returned 404; current Dagu manifest also fails validation. [#1664](https://github.com/service-lasso/service-lasso/issues/1664). The article now uses a pinned PostgreSQL manifest whose dry-run and real import passed |
| Canonical demo first-run and Todo Admin | Fresh onboarding, credential acknowledgement, sign-in and Todo service actions passed |
| Canonical demo recycle/shutdown | Recycle bootstrap fails at Broker startup; stop can report already stopped while owned listeners remain. Unqualified; [#1665](https://github.com/service-lasso/service-lasso/issues/1665) |
| Existing shared-host instance registry | Literal startup exceeded the registry size limit; inherited metadata preserved. Isolated registries allowed tests. [#1663](https://github.com/service-lasso/service-lasso/issues/1663) |
| ZITADEL SSO Hub | Blocked on operator CA trust, secret provisioning and a registered consumer; no end-to-end SSO claim |
| Native shells, other operating systems and external release authoring | No native/platform/release acceptance; source/packaging checks do not establish it |

Schema fragments, service plans and release checklists are authoring material,
not complete standalone examples. Commands containing repository/issue placeholders
need real targets; this review did not create or publish external repositories.
Runtime API/CLI operations were exercised for the examples above, not every
mutation in the reference manual.

Original failures and exact source/artifact identities remain in the private
review receipt. Only review-owned processes were cleaned up; inherited state,
unrelated services and host trust were preserved. These findings remain open
where linked, rather than being replaced by an all-examples-pass claim.

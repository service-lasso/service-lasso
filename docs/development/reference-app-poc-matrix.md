# Reference app POC matrix

This document captures the first meaningful POC contract for the canonical sibling app-host repos:

- `service-lasso-app-web`
- `service-lasso-app-node`
- `service-lasso-app-electron`
- `service-lasso-app-tauri`

If packaging-target repos are added later, such as `service-lasso-app-packager-pkg`, `service-lasso-app-packager-sea`, and `service-lasso-app-packager-nexe`, they should inherit the same host/runtime contract from the canonical app-host repo they package.

Each starter should remain:
- clonable
- executable
- honest about current scope

Each starter's first real POC must use:
- published `@service-lasso/service-lasso`
- `lasso-echoservice`
- `lasso-@serviceadmin`

## Shared minimum contract

Every starter POC must prove all of these:
- the repo can be cloned and started with one documented local command
- the host app shows **its own host-owned output** instead of only dropping the user straight into Service Admin
- the host app can surface or link to `lasso-@serviceadmin`
- Service Admin talks to a real local `service-lasso` runtime
- the runtime manages Echo Service as the first real service target
- the operator can reach Echo Service list/detail/log/lifecycle behavior through Service Admin

## Required runtime assumptions

Every starter POC should use:
- explicit `servicesRoot`
- explicit `workspaceRoot`
- published `@service-lasso/service-lasso` rather than repo-local relative coupling where practical

## Repo-specific minimal POCs

### `service-lasso-app-web`

Minimal POC should:
- start a web host
- show a host-owned landing or shell view first
- embed or proxy Service Admin from that host
- point Service Admin at the local runtime API
- manage Echo Service through the embedded/proxied admin UI

### `service-lasso-app-node`

Minimal POC should:
- run one Node host command
- print host-owned startup/status output
- start the local runtime
- serve or proxy Service Admin
- manage Echo Service through the exposed admin UI

Current artifact-mode proof:
- `*-source.tar.gz` = starter-template source artifact
- `*-runtime.tar.gz` = runnable bootstrap-download artifact
- `*-preloaded.tar.gz` = runnable preloaded/no-download artifact

### `service-lasso-app-electron`

Minimal POC should:
- launch a desktop shell
- show a host-owned Electron shell/window first
- start or supervise the local runtime
- render or surface Service Admin from the Electron app
- manage Echo Service through the Electron-hosted admin UI

### `service-lasso-app-tauri`

Minimal POC should:
- launch a desktop shell
- show a host-owned shell view/window framing
- start or supervise the local runtime
- render Service Admin in the app window
- manage Echo Service through the desktop-hosted admin UI

## What does not count as enough

These do not satisfy the POC by themselves:
- a placeholder console log only
- a repo that only builds but does not run
- a host that shows Service Admin but has no host-owned output or framing
- a host that uses stubs instead of a real runtime/API
- a host that omits Echo Service

## Honest current boundary

At the moment, some starter repos still use template-era scaffolding, and the migration plan is actively removing the old non-canonical repo names from the lineup.

This matrix defines the next implementation target for them.

# Core runtime storage model

This document defines the preferred storage split for the `service-lasso` core runtime.

The key model is:
- `servicesRoot` = where services live
- `workspaceRoot` = where Service Lasso stores runtime-managed working data

This split is important because it allows Service Lasso to:
- point at different service trees
- keep runtime-managed artifacts outside the service source tree
- support different configs/instances cleanly
- avoid mixing service-owned content with runtime-owned working data

## Purpose

This document answers:
- what lives under `servicesRoot`
- what lives under `workspaceRoot`
- what should remain per-service
- how logs/state/config/runtime artifacts should be split

## Core concepts

## `servicesRoot`
This is the managed services tree.

Example:

```text
C:\service-lasso\services
```

Service Lasso should discover services from here.
Each service folder should contain its canonical manifest and service-owned files.

## `workspaceRoot`
This is the Service Lasso runtime workspace.

Example:

```text
C:\service-lasso\workspace
```

This is where Service Lasso should keep runtime-managed working data.
This root should be configurable separately from `servicesRoot`.

## Why this split matters

Without this split, it becomes harder to:
- run the same runtime against different service trees
- keep runtime artifacts out of service source folders
- support multiple instances/configurations cleanly
- reason about what is service-owned versus runtime-owned

## What should live under `servicesRoot`

`servicesRoot` should contain things that belong to the services themselves.

Typical contents:
- service folders
- `service.json`
- service-owned payload/runtime files
- service-owned content/assets
- service-local config templates or inputs
- service-local `.state/` if per-service state remains the chosen model

Example shape:

```text
<servicesRoot>/
  @node/
    service.json
  @python/
    service.json
  echo-service/
    service.json
    runtime/
    content/
    config/
    .state/
```

Important note:
- the exact service-internal folders such as `runtime/`, `content/`, and `config/` are not all fully implemented yet in core
- this document is about the preferred storage split, not a claim that every folder is already live

## What should live under `workspaceRoot`

`workspaceRoot` should contain things Service Lasso manages for itself while running.

Typical contents:
- logs
- archived runs
- runtime temp/working files
- runtime-level metadata
- runtime-level caches if needed later

Recommended shape:

```text
<workspaceRoot>/
  logs/
    runs/
    archive/
  tmp/
  metadata/
```

This root is for runtime-managed working data, not for canonical service source content.

## Logging split

Logging should live under `workspaceRoot`, not scattered ad hoc under service folders.

Canonical logging shape:

```text
<workspaceRoot>/logs/
  runs/
    <runId>/
      manager/
      services/
  archive/
    <runId>.zip
```

That keeps logs as runtime-managed evidence rather than service-owned source content.

## State split

Current preferred direction still allows per-service structured state under `.state/`.

That means the likely split is:
- per-service operational state under:
  - `<serviceRoot>/.state/`
- runtime-wide logs and run archives under:
  - `<workspaceRoot>/logs/`

This is a deliberate split:
- **state** stays close to the service
- **logs and run history** stay in the runtime workspace

## Config/runtime/content split

These areas should be treated carefully.

### `runtime/`
If a service has a runtime payload or runtime executable area, that belongs with the service under its own root.
It is service-owned.

### `config/`
If a service has config templates, default config assets, or generated config owned by the service model, that should generally remain service-scoped.
The exact generated-output policy is still being clarified.

### `content/`
If a service has content or installed payload content, that remains service-scoped.

### `workspaceRoot`
`workspaceRoot` is not meant to become a junk drawer for every service directory.
It is for runtime-managed working data that belongs to the Service Lasso runtime itself.

## Example combined model

```text
C:\service-lasso\
  services\
    echo-service\
      service.json
      runtime\
      config\
      content\
      .state\
  workspace\
    logs\
      runs\
        2026-04-20_10-27-13\
          manager\
          services\
      archive\
        2026-04-20_09-40-00.zip
    tmp\
    metadata\
```

## Parameter model

The runtime should be configurable with both roots.

Conceptually:

```text
service-lasso --services <servicesRoot> --workspace <workspaceRoot>
```

Or equivalent config fields such as:
- `servicesRoot`
- `workspaceRoot`

This is the right direction for multi-config and multi-instance operation.

## What this does not settle yet

This storage model does **not** by itself fully settle:
- the final exact `.state/` file layout
- the exact generated config-output policy
- the final runtime payload folder contract inside each service
- all tmp/cache/metadata subfolders under `workspaceRoot`

It only settles the high-level split between:
- service-owned trees
- runtime-owned workspace data

## Bottom line

Preferred Service Lasso storage model:
- `servicesRoot` for service-owned trees and manifests
- `workspaceRoot` for Service Lasso runtime-managed working data
- per-service `.state/` remains service-local unless explicitly redesigned later
- logs and run archives belong under `workspaceRoot`

That gives a clean base for multiple service trees, multiple runtime configs, and cleaner separation of concerns.
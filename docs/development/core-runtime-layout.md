# Core runtime layout

This document describes the first tracked source layout and the current bounded runtime/API slices added for the Service Lasso core runtime through issues `#2` to `#8`.

## Intent

The goal of this slice is to turn `service-lasso` into a real product repository with tracked source, without prematurely implementing the later runtime behavior slices.

This layout is intentionally minimal.

## Current layout

```text
src/
  contracts/
    api.ts
    service-root.ts
    service.ts
  fixtures/
    README.md
  runtime/
    app.ts
    layout.ts
    discovery/
      discoverServices.ts
      loadManifest.ts
      validateManifest.ts
    health/
      checkHttp.ts
      checkProcess.ts
      evaluateHealth.ts
      types.ts
    lifecycle/
      actions.ts
      store.ts
      types.ts
    manager/
      DependencyGraph.ts
      ServiceRegistry.ts
    operator/
      logs.ts
      network.ts
      variables.ts
    providers/
      direct.ts
      node.ts
      python.ts
      resolveProvider.ts
      types.ts
    state/
      paths.ts
      readState.ts
      writeState.ts
  server/
    index.ts
    routes/
      dependencies.ts
      health.ts
      logs.ts
      network.ts
      runtime.ts
      service-health.ts
      services.ts
      variables.ts
  index.ts
tests/
  api-spine.test.js
  manifest-discovery.test.js
  health-state.test.js
  lifecycle-actions.test.js
  operator-data.test.js
  provider-execution.test.js
  registry-runtime-state.test.js
```

## What each area means

- `src/index.ts`
  - the current core process entrypoint
  - starts the bounded development-mode API server for the first core API story
- `src/runtime/`
  - runtime-facing implementation boundary for the core standalone manager
  - `layout.ts` defines the initial runtime boundary and default root locations
  - `app.ts` now assembles runtime startup around the first bounded API server
  - `discovery/` contains the first canonical `service.json` loading/validation/discovery path
  - `manager/` contains the first in-memory registry and dependency graph model
  - `lifecycle/` contains the first bounded in-memory install/config/start/stop/restart flow
  - `health/` contains the first bounded `process` and `http` health evaluation path
  - `state/` contains the first structured `.state` file-path and read/write helpers
  - `operator/` contains the first operator-data builders for logs, variables, and network surfaces
  - `providers/` contains the first explicit provider resolution/planning layer for direct, node, and python execution modes
- `src/server/`
  - first real API boundary for the core repo
  - route modules now cover health, services, runtime, dependencies, and the first operator data surfaces
- `src/contracts/`
  - shared runtime/API contract types for the core repo
  - now includes both service-root/runtime-boundary and first API response shapes
- `services/`
  - tracked sample service roots containing canonical `service.json` files for current discovery-backed development mode
- `src/fixtures/`
  - still reserved for additional fixture/sample inputs when needed beyond the tracked `services/` roots
- `tests/`
  - direct route-level, discovery/parsing, runtime-state, lifecycle, state/health, operator-surface, and provider-resolution proof for the current core slices

## What this slice does not do yet

This layout does **not** yet implement:
- full real process execution per provider
- broader provider catalog beyond the first bounded direct/node/python layer
- release workflow automation beyond local package/build/test plumbing

Those belong to later `SPEC-002` tasks:
- `TASK-007`
- `TASK-008`
- `TASK-009`
- `TASK-010`

## Local commands

```bash
npm install
npm run typecheck
npm run build
npm run test
npm run dev
```

## Why Node/TypeScript first

The donor standalone runtime is TypeScript-based, so the first core layout stays close to that implementation shape while keeping the transplant bounded and reviewable.
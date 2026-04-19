# Core runtime layout

This document describes the first tracked source layout, bounded API spine, and first manifest discovery boundary added for the Service Lasso core runtime during `TASK-006`, issue `#2`, and issue `#3`.

## Intent

The goal of this slice is to turn `service-lasso` into a real product repository with tracked source, without prematurely implementing the later runtime behavior slices.

This layout is intentionally minimal.

## Current layout

```text
src/
  contracts/
    api.ts
    service-root.ts
  fixtures/
    README.md
    services.ts
  runtime/
    app.ts
    layout.ts
    discovery/
      discoverServices.ts
      loadManifest.ts
      validateManifest.ts
    manager/
      DependencyGraph.ts
      ServiceRegistry.ts
  server/
    index.ts
    routes/
      dependencies.ts
      health.ts
      runtime.ts
      services.ts
  index.ts
tests/
  api-spine.test.js
  manifest-discovery.test.js
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
- `src/server/`
  - first real API boundary for the core repo
  - `routes/health.ts` and `routes/services.ts` provide the first bounded route set
- `src/contracts/`
  - shared runtime/API contract types for the core repo
  - now includes both service-root/runtime-boundary and first API response shapes
- `services/`
  - tracked sample service roots containing canonical `service.json` files for current discovery-backed development mode
- `src/fixtures/`
  - still reserved for additional fixture/sample inputs when needed beyond the tracked `services/` roots
- `tests/`
  - direct route-level, discovery/parsing, and runtime-state proof for the current core slices

## What this slice does not do yet

This layout does **not** yet implement:
- lifecycle orchestration
- provider/runtime execution
- persistent managed `.state/` behavior
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
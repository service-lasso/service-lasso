# Core runtime layout

This document describes the first tracked source layout added for the Service Lasso core runtime during `TASK-006`.

## Intent

The goal of this slice is to turn `service-lasso` into a real product repository with tracked source, without prematurely implementing the later runtime behavior slices.

This layout is intentionally minimal.

## Current layout

```text
src/
  contracts/
    service-root.ts
  fixtures/
    README.md
  runtime/
    app.ts
    layout.ts
  index.ts
```

## What each area means

- `src/index.ts`
  - the thin repo entrypoint for the standalone core runtime slice
  - currently prints a scaffold report instead of running real service orchestration
- `src/runtime/`
  - runtime-facing implementation boundary for the core standalone manager
  - `layout.ts` defines the initial runtime boundary and default root locations
  - `app.ts` assembles the current scaffold report and points forward to later tasks
- `src/contracts/`
  - shared runtime contract types for the core repo
  - starts with the service-root/runtime-boundary contract because that is the minimum stable concept needed for the first source layout
- `src/fixtures/`
  - reserved for fixture/sample services and direct runtime smoke-proof inputs
  - intentionally not populated yet in `TASK-006`

## What this slice does not do yet

This layout does **not** yet implement:
- runtime startup behavior beyond the scaffold report
- canonical `service.json` discovery/parsing
- lifecycle orchestration
- provider/runtime execution
- build/release automation beyond local package/build plumbing

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
npm run dev
```

## Why Node/TypeScript first

The donor standalone runtime is TypeScript-based, so the first core layout stays close to that implementation shape while keeping the transplant bounded and reviewable.
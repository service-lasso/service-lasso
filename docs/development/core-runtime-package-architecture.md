# Core runtime package architecture

This document captures the intended package boundaries for the next Service Lasso architecture step.

## Current bounded scaffold state

The repo now has a bounded private `packages/core` wrapper package.

What exists now:
- a bounded `packages/core` wrapper package using the canonical target name `@service-lasso/service-lasso`
- a self-contained staged publish payload for `@service-lasso/service-lasso`
- sibling reference-app starter repos under `C:\projects\service-lasso`

Current correction note:
- the sibling repo lineup is under active remediation
- the long-term canonical repo set is defined below under app host types and packaging targets
- older repo names such as `service-lasso-packager-node` are migration-era names, not the final naming model
- `bundled` is an artifact-mode label, not a canonical app-host repo name

What this scaffold does:
- makes the core package boundary explicit in tracked repo structure
- keeps the current runtime source in `src/` for now
- lets the core wrapper package target the current built runtime and CLI without pretending the full source move is already done
- keeps the reference-app starters out of the core repo where they belong

What it does not claim yet:
- a finished public npmjs.com rollout
- migrated runtime source under `packages/core/src`
- fully implemented starter apps in each sibling template repo

## Core product boundary

The core runtime should be a publishable Node library + CLI.

Suggested package name:
- `@service-lasso/service-lasso`

### Core should contain

- `Service`
- `ServiceManager`
- `InstanceManager`
- `ManifestLoader`
- `PortRegistry`
- `HealthChecker`
- `ProcessSupervisor`
- `Logger`
- shared path helpers
- API server bootstrap
- CLI bootstrap

### Core should not contain

- Electron runtime code
- Tauri runtime code
- UI framework lock-in
- desktop app-window lifecycle logic
- desktop installer packaging config

## Release targets

### 1) Core npm package

Published via npm (`npm publish`) as the canonical reusable runtime package.

Current bounded reality:
- the repo stages a self-contained publish payload and publishes it through GitHub Packages
- the in-repo `packages/core` wrapper remains the source-boundary scaffold, not the published payload itself

### 2) Built Node runtime

Runnable directly from build output:

```bash
node dist/index.js
```

### 3) CLI

Runnable via package bin:

```bash
npx service-lasso
# or global install
```

### 4) Reference app repos (separate from core)

Once the core runtime is built and stable, additional reference app packages should be created to showcase integration patterns.

These reference apps are required because they should act as:
- working examples of how to consume the core runtime
- template starting points that teams can clone or adapt for their own apps
- proof that the runtime integrates cleanly across multiple host/distribution styles

These starters remain outside core as sibling repos.
They consume the canonical runtime package and should use the same runtime-root model:
- `servicesRoot`
- `workspaceRoot`

They should also own the exact tracked service inventory they intend to manage under repo-local `services/`.

Current baseline inventory rule for the starter repos:
- `services/echo-service/service.json`
- `services/service-admin/service.json`
- `services/@node/service.json`
- `services/@traefik/service.json`

If a starter repo includes `service-admin`, it should also include the manifests needed to satisfy Service Admin's declared service dependencies rather than relying on hidden sibling-repo state.

They should never redefine the core contract or replace the core runtime boundary.

Before broad reference-template rollout, the existing sibling consumer repo `lasso-@serviceadmin` should be used as the first post-core integration check against the real runtime/API, ideally backed by released `lasso-echoservice` artifacts.

The first meaningful implementation target for every starter repo is:
- remain clonable and executable
- show host-owned output
- surface `lasso-@serviceadmin`
- manage `lasso-echoservice` through a real local runtime using published `@service-lasso/service-lasso`

#### A) Web reference app template

Suggested package:
- `@service-lasso/service-lasso-app-web`

Purpose:
- demonstrate browser-facing or web-hosted integration around the core runtime/API
- provide a template repo/package that others can start their own web integration from
- showcase how a UI-facing app should consume the runtime rather than replace it

Dependency direction:
- `@service-lasso/service-lasso-app-web` -> `@service-lasso/service-lasso`
- never the reverse

#### B) Node app reference template

Suggested package:
- `@service-lasso/service-lasso-app-node`

Purpose:
- demonstrate a plain Node host for Service Lasso
- provide a template for teams who want a non-Electron, non-Tauri app starting point
- stay close to real runtime behavior without mixing in packaging-target naming

Dependency direction:
- `@service-lasso/service-lasso-app-node` -> `@service-lasso/service-lasso`
- never the reverse

#### C) Tauri desktop alternative template

Suggested package:
- `@service-lasso/service-lasso-app-tauri`

Purpose:
- provide an explicit desktop alternative to Electron
- demonstrate how the runtime can be embedded behind a Tauri shell
- act as a template for teams that want a desktop app starting point without Electron

Dependency direction:
- `@service-lasso/service-lasso-app-tauri` -> `@service-lasso/service-lasso`
- never the reverse

#### D) Electron desktop reference template

Suggested package:
- `@service-lasso/service-lasso-app-electron`

Purpose:
- provide the Electron desktop host shape explicitly
- keep desktop host identity separate from packaging/distribution mode
- avoid using vague distribution labels as the primary repo identity

Dependency direction:
- `@service-lasso/service-lasso-app-electron` -> `@service-lasso/service-lasso`
- never the reverse

Recommended rollout order:
1. core npm module
2. `@service-lasso/service-lasso-app-web`
3. `@service-lasso/service-lasso-app-node`
4. `@service-lasso/service-lasso-app-electron`
5. `@service-lasso/service-lasso-app-tauri`
6. optional packaging-target repos only when there is a real implementation reason:
   - `@service-lasso/service-lasso-app-packager-pkg`
   - `@service-lasso/service-lasso-app-packager-sea`
   - `@service-lasso/service-lasso-app-packager-nexe`

## Current core package map

Current bounded split:

1. `packages/core`

This keeps runtime as the source of truth while avoiding in-repo reference-app drift.

## Build approach for core

Use a minimal Node-oriented build:
- `tsup` (or equivalent esbuild-based build)
- Node target (Node 20+)
- type declarations emitted
- `src/` -> `dist/`

Keep build/release boring and predictable.

## Core package shape target

```json
{
  "name": "@service-lasso/service-lasso",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "service-lasso": "./dist/cli.js"
  },
  "exports": {
    ".": "./dist/index.js",
    "./cli": "./dist/cli.js",
    "./runtime": "./dist/runtime/index.js"
  }
}
```

## Runtime/UI strategy

### Phase 1
Core can include a minimal built-in admin surface for basic status/control if needed.

### Phase 2
A richer UI can evolve as a separate package, e.g. `@service-lasso/service-lasso-ui`.

This preserves a self-contained runtime without coupling core to one UI framework.

## Naming direction

- Core: `@service-lasso/service-lasso`
- Web reference: `@service-lasso/service-lasso-app-web`
- Node reference: `@service-lasso/service-lasso-app-node`
- Electron reference: `@service-lasso/service-lasso-app-electron`
- Tauri reference: `@service-lasso/service-lasso-app-tauri`
- Optional packaging-target references:
  - `@service-lasso/service-lasso-app-packager-pkg`
  - `@service-lasso/service-lasso-app-packager-sea`
  - `@service-lasso/service-lasso-app-packager-nexe`

Optional later:
- `@service-lasso/service-lasso-ui`
- `@service-lasso/service-lasso-manifests`
- `@service-lasso/service-lasso-examples`

## Target behavior (core)

Programmatic:

```ts
import { createRuntime } from "@service-lasso/service-lasso";

const runtime = await createRuntime({
  servicesRoot: "./services",
  workspaceRoot: "./workspace",
  port: 19001,
});

await runtime.start();
```

CLI:

```bash
service-lasso dev
service-lasso start
service-lasso ui --port 19001
service-lasso instance start demo
```

Built runtime:

```bash
node dist/index.js
```

## Post-core implementation move

After the core runtime package is stable, either keep the bounded wrapper approach or move cleaned runtime code toward `packages/core/src`.

Reference apps should continue to be maintained as sibling starter-template repos, not in-repo packages:
- `C:\projects\service-lasso\service-lasso-app-web`
- `C:\projects\service-lasso\service-lasso-app-node`
- `C:\projects\service-lasso\service-lasso-app-electron`
- `C:\projects\service-lasso\service-lasso-app-tauri`

Packaging-target repos are optional later additions rather than part of the baseline canonical lineup:
- `C:\projects\service-lasso\service-lasso-app-packager-pkg`
- `C:\projects\service-lasso\service-lasso-app-packager-sea`
- `C:\projects\service-lasso\service-lasso-app-packager-nexe`

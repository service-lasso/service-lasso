# Core runtime development plan

This document captures the recommended full structure and implementation order for the `service-lasso` core repo based on the current project decisions, active specs, and related repo split.

## Purpose

`service-lasso` is the core runtime and contract repository.

Its job is to provide:
- the standalone runtime/server
- the canonical shared contracts
- service discovery and orchestration
- the API surface that serves operations and data to the UI and other clients

It is **not** the main UI repo. The main UI repo is `lasso-@serviceadmin`.

## Runtime root configuration

Preferred runtime configuration model:
- `servicesRoot` = where services live
- `workspaceRoot` = where Service Lasso stores runtime-managed working data

This split should be treated as the preferred direction for multi-config and multi-instance operation.

Use it to keep:
- service-owned trees under `servicesRoot`
- runtime-managed logs, archives, temp/work artifacts, and similar working data under `workspaceRoot`

## Repository role in the three-repo model

- `service-lasso`
  - core runtime + canonical shared contract/docs
- `service-template`
  - the canonical template for individual services
- `lasso-@serviceadmin`
  - the operator UI

## Recommended full repo structure

```text
service-lasso/
  .github/
  .governance/
  docs/
    development/
    reference/
    reference/shared-runtime/
  src/
    index.ts                         # process entry
    app/
      bootstrap.ts                   # config/env/bootstrap wiring
    server/
      index.ts                       # HTTP server entry
      routes/
        health.ts
        services.ts
        runtime.ts
        logs.ts
        network.ts
        variables.ts
        dependencies.ts
      dto/
      middleware/
    runtime/
      manager/
        ServiceManager.ts
        ServiceRegistry.ts
        DependencyGraph.ts
      lifecycle/
        install.ts
        config.ts
        start.ts
        stop.ts
        restart.ts
        update.ts
        rollback.ts
        uninstall.ts
        reset.ts
      discovery/
        discoverServices.ts
        loadManifest.ts
        validateManifest.ts
      health/
        checkProcess.ts
        checkHttp.ts
        checkTcp.ts
        checkFile.ts
        checkVariable.ts
      env/
        globalEnv.ts
        resolveEnv.ts
      ports/
        reservePorts.ts
      state/
        readState.ts
        writeState.ts
      logs/
        logStream.ts
        logArchive.ts
      providers/
        direct/
        node/
        python/
        java/
        archive/
        localcert/
    contracts/
      service.ts
      actions.ts
      state.ts
      api.ts
      health.ts
    fixtures/
      services/
        echo-service/
          service.json
    shared/
      paths.ts
      errors.ts
      types.ts
      constants.ts
  tests/
    unit/
    integration/
    fixtures/
  scripts/
  package.json
  tsconfig.json
```

## Top-level structure intent

### `src/server/`

This is the API service layer.

It should become the main source for:
- service list/detail
- runtime state
- install/config/start/stop/restart/update/rollback actions
- logs
- health
- dependency data
- variables/env/network/operator data

### `src/runtime/`

This is the core engine.

It owns:
- service discovery
- manifest loading/validation
- dependency orchestration
- lifecycle execution
- health checks
- env resolution
- state persistence
- port negotiation
- logging integration
- provider/runtime execution

### `src/contracts/`

This is the canonical contract layer for the core repo.

It should define:
- service manifest shapes
- action/result shapes
- runtime state shapes
- API DTOs/interfaces
- healthcheck contract types

### `src/fixtures/`

This is for fixture/sample services used as direct proof inputs.

This should be the first place used for:
- manifest discovery tests
- runtime smoke verification
- API integration checks

## API shape recommendation

```text
GET    /api/health
GET    /api/runtime
POST   /api/runtime/reload

GET    /api/services
GET    /api/services/:id
POST   /api/services/:id/install
POST   /api/services/:id/config
POST   /api/services/:id/start
POST   /api/services/:id/stop
POST   /api/services/:id/restart
POST   /api/services/:id/update
POST   /api/services/:id/rollback
POST   /api/services/:id/uninstall
POST   /api/services/:id/reset

GET    /api/services/:id/logs
GET    /api/services/:id/health
GET    /api/services/:id/state

GET    /api/dependencies
GET    /api/network
GET    /api/variables
```

## Managed service folder shape

Recommended managed-service shape under `servicesRoot`:

```text
services/
  @node/
    service.json
  @python/
    service.json
  @traefik/
    service.json
  some-app/
    service.json
    runtime/
    config/
    public/
    logs/
    .state/
      service.json
      install.json
      config.json
      runtime.json
      backups/
```

## Confirmed architectural decisions already reflected here

### 1. Utility services stay in the same system

Utility/setup services such as `@archive` or `@localcert` should remain in the same registry/system, but with clearer utility/setup semantics instead of pretending they are identical to normal app services.

### 2. `globalenv` remains shared inside the Service Lasso sandbox

Environment resolution should stay explicit and Service Lasso-controlled, while allowing shared managed environment behavior across services.

### 3. Port negotiation is core-owned

Services declare needs, but Service Lasso core owns port negotiation/resolution.

### 4. `install` and `config` remain distinct actions

- `install`
  - acquires/unpacks/prepares payloads on disk
- `config`
  - generates/materializes effective runtime config

First-time setup may chain install -> config, but later config reruns must remain possible without reinstalling.

### 5. State should live under `.state/`

Preferred managed state direction:

```text
.state/
  service.json
  install.json
  config.json
  runtime.json
  backups/
```

This keeps operational state structured instead of flattening everything into one blob.

Important note:
- the exact concrete `.state/` file layout currently in code is still provisional
- use `docs/development/core-runtime-state-model-audit.md` for the agreed-vs-provisional clarification

## Recommended implementation order

### Phase 1. Establish the real API backbone

- create `src/server/index.ts`
- wire `GET /api/health`
- wire `GET /api/services`
- serve fixture-backed data first

### Phase 2. Add manifest discovery/parsing

- implement `src/runtime/discovery/`
- discover canonical `service.json` files from a defined service root
- parse and validate them against the core contract

### Phase 3. Add registry and dependency graph

- implement `ServiceRegistry`
- implement `DependencyGraph`
- expose dependency/dependent data to the API

### Phase 4. Add core lifecycle actions

- install
- config
- start
- stop
- restart

Keep this bounded before widening into every future action.

### Phase 5. Add first health models

Start with:
- process
- http

Then widen to:
- tcp
- file
- variable

### Phase 6. Add managed state persistence

- write/read `.state/` records
- keep runtime/install/config/service state distinct
- preserve backups under `.state/backups/`

### Phase 7. Add operator data surfaces

- logs
- network
- variables
- dependencies
- runtime status summaries

### Phase 8. Add provider-specific execution layers

Add explicit runner/provider modules only after the core API + discovery + lifecycle spine is stable.

## Immediate next bounded slice recommendation

The next best implementation slice is:

1. create `src/server/index.ts`
2. implement `GET /api/health`
3. implement `GET /api/services`
4. serve those from fixture/sample manifests first

This gives the project a real core API service without prematurely overbuilding the whole runtime.

## Non-goals for the next slice

Do **not** try to do all of this at once.

Still out of scope for the immediate next slice:
- complete lifecycle/provider matrix
- complete lifecycle/provider matrix
- full operator surface parity with `lasso-@serviceadmin`
- broad manifest redesign beyond what the next runnable slice needs

## Relationship to current active spec

This plan expands on:
- `.governance/specs/SPEC-002-core-standalone-runtime.md`

It should be used as the practical development structure/shape guide while implementation proceeds through bounded issues/tasks.

# service-lasso

Service Lasso is the core runtime and contract repository for the Service Lasso project.

Preferred runtime configuration model:
- `servicesRoot` = where services live
- `workspaceRoot` = where Service Lasso stores runtime-managed working data

Start with:
- `docs/INTRODUCTION.md`
- `docs/development/core-runtime-storage-model.md`
- `docs/development/core-runtime-logging-model.md`
- `docs/development/core-runtime-publishable-package.md`

This repository started as a bootstrap and donor-analysis workspace around a reference snapshot taken from:

- donor repo: `C:\projects\typerefinery-ai\typerefinery-develop`
- donor focus: the standalone service-manager runtime and its managed `services/` tree

That bootstrap phase is now preserved in repo history, but the repo has moved into the first real product implementation phase under:

- `.governance/specs/SPEC-002-core-standalone-runtime.md`

## Current State

At the moment this repo contains:

- governance and backlog/spec traceability under `.governance/`
- canonical shared contract/runtime docs under `docs/`
- the first tracked core runtime source layout and API spine under `src/`
- a bounded `packages/core` wrapper package for the future core package boundary plus a self-contained staged publish payload for `@service-lasso/service-lasso`
- direct route tests under `tests/`
- an ignored donor reference snapshot under `ref/typerefinery-service-manager-donor/`

The donor reference material is intentionally **not tracked in git** and remains reference input, not product code.

## First tracked core runtime layout

The first bounded product slice establishes the repo as a real codebase without claiming full runtime behavior yet.

Current tracked source layout:

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
  server/
    index.ts
    routes/
      health.ts
      services.ts
  index.ts
tests/
  api-spine.test.js
```

What this slice means:

- `src/index.ts` starts the current bounded development-mode API process
- `src/server/` holds the first real API boundary for the core repo
- `src/runtime/` now includes the first manifest discovery/parsing boundary under `src/runtime/discovery/`, the first in-memory registry/dependency model under `src/runtime/manager/`, the first bounded lifecycle action path under `src/runtime/lifecycle/`, the first bounded health evaluation under `src/runtime/health/`, the first structured `.state` persistence layer under `src/runtime/state/`, the first operator-data builders under `src/runtime/operator/`, and the first explicit provider execution boundary under `src/runtime/providers/`
- `src/contracts/` holds shared API/runtime contract types
- tracked sample manifests now live under `services/*/service.json`
- `tests/api-spine.test.js`, `tests/manifest-discovery.test.js`, `tests/registry-runtime-state.test.js`, `tests/lifecycle-actions.test.js`, `tests/health-state.test.js`, `tests/operator-data.test.js`, and `tests/provider-execution.test.js` provide direct proof for the API spine, discovery/parsing behavior, runtime state read APIs, lifecycle action path, health/state persistence, operator data surfaces, and provider execution planning

This slice now establishes the first real API spine, the first canonical manifest discovery/parsing path, the first in-memory runtime state model, the first bounded lifecycle actions, the first health + `.state` persistence layer, the first operator data surfaces, the first provider execution boundary, and a runnable tracked harness fixture under `services/echo-service/` for later execution/demo hardening. Full real process execution and broader provider catalog expansion are still future work.

Current manifest/install note:
- the core runtime now accepts a bounded first-class `artifact` block inside `service.json`
- `install` can acquire/download and unpack manifest-owned archive payloads without forcing `start`
- direct execution can fall back to the installed artifact command when the manifest relies on installed runtime payload instead of a checked-in executable

Current package-boundary note:

- the runtime source still lives in `src/`
- `packages/core` remains the bounded in-repo wrapper package targeting the current built runtime + CLI
- the publishable package is staged separately as a self-contained payload for `@service-lasso/service-lasso`
- the starter/template apps live outside this repo as sibling repos under `C:\projects\service-lasso`

Reference app inventory rule:

- every repo that uses Service Lasso should own its own tracked `services/` folder
- that folder should contain the service manifests for the exact services that repo intends to manage
- if a repo includes `services/service-admin/service.json`, it should also include the manifests needed to satisfy Service Admin's service dependencies
- the current baseline stack for the reference repos is:
  - `services/echo-service/service.json`
  - `services/service-admin/service.json`
  - `services/@node/service.json`
  - `services/@traefik/service.json`
- runtime env such as `VITE_SERVICE_LASSO_API_BASE_URL` still belongs in app/runtime config, not as separate service manifests

Note on repo split:
- the canonical Echo Service implementation now lives in the sibling repo `C:\projects\service-lasso\lasso-echoservice`
- `service-lasso/services/echo-service/` remains a thin local fixture manifest so the core repo stays self-contained for discovery/runtime tests
- the sibling Echo Service repo now includes harness-only HTTP and TCP health simulation endpoints for runtime testing, and `service-lasso` itself now evaluates bounded manifest health types `process`, `http`, `tcp`, `file`, and `variable`

For the detailed layout note, see:

- `docs/development/core-runtime-layout.md`

## Local development commands

```bash
npm install
npm run typecheck
npm run build
npm run test
npm run verify:baseline-start
npm run verify:reference-app-lifecycle
npm start
npm run dev
```

`npm start` is the clean-clone friendly runtime command: it builds the TypeScript output first, then starts the bounded core API runtime from `dist/index.js`. `npm run dev` follows the same build-and-run path for local development.
`npm run verify:baseline-start` builds the CLI and runs the deterministic bounded baseline-start smoke with generated `@node`, `echo-service`, and `service-admin` fixtures plus the release-backed `@traefik` artifact.
`npm run verify:reference-app-lifecycle` fresh-clones the canonical reference apps, starts each app-owned runtime with a deterministic Service Admin dist, and proves Echo Service install/config/start/stop plus process cleanup through that app host.

## CLI commands

The bounded core package/runtime now exposes a supported CLI surface in addition to the API server boot path.

Start the bounded API runtime:

```bash
service-lasso
```

Bootstrap the documented baseline inventory and leave the API running:

```bash
service-lasso start --services-root ./services --workspace-root ./workspace
```

`service-lasso start` is the clean-clone baseline command name for `#98`. It installs, configures, and starts the baseline services in dependency order, then starts the core API for Service Admin and app consumers. The current baseline is `@traefik`, `@node`, `echo-service`, and `service-admin`; `@traefik`, `echo-service`, and `service-admin` use release-backed service artifacts, while `@node` is a local/no-download runtime provider.

The command-level smoke for this path is:

```bash
npm run verify:baseline-start
```

That smoke keeps local fixtures for the non-Traefik harness services so it can stay deterministic in CI, and it now downloads and starts the canonical `service-lasso/lasso-traefik` release artifact for `@traefik`.

Acquire/install a service from manifest-owned `artifact` metadata without starting it:

```bash
service-lasso install echo-service --services-root ./services --workspace-root ./workspace
```

Machine-readable install output is also supported:

```bash
service-lasso install echo-service --services-root ./services --workspace-root ./workspace --json
```

## Release artifact commands

The repo now exposes a bounded downloadable runtime artifact flow.

```bash
npm run release:artifact
npm run release:verify
```

What these do:

- `npm run release:artifact` builds and stages `artifacts/service-lasso-<version>/` plus `artifacts/service-lasso-<version>.tar.gz`
- `npm run release:verify` stages the bounded artifact, verifies the documented shipped files, imports the staged `packages/core` wrapper, and boots the staged runtime entrypoint against explicit runtime roots

Current runtime dependency note:
- the staged runtime artifact now includes production `node_modules/` because the bounded acquire/install flow depends on archive-handling libraries at runtime

Protected-branch release note:

- local commands default to the repo `package.json` version for staging and verification
- the protected-branch release workflows on `main` compute the shipped version as `yyyy.m.d-<shortsha>` and create the GitHub release automatically from that push

Current shipped files are documented in:

- `docs/development/core-runtime-release-artifact.md`

## Publishable package commands

The repo now also exposes a bounded self-contained publishable package flow for `@service-lasso/service-lasso`.

```bash
npm run package:stage
npm run package:verify
```

What these do:

- `npm run package:stage` builds and stages `artifacts/npm/service-lasso-package-<version>/` plus a packed `.tgz` inside that folder
- `npm run package:verify` stages the package, runs `npm pack`, installs it into a temporary consumer, and boots the runtime against explicit runtime roots
- `npm run verify:package-consumer` verifies an install directly from `registry.npmjs.org`, then runs `service-lasso --version` and `service-lasso help` from the installed package

Protected-branch publish note:

- local commands default to the repo `package.json` version for staging and verification
- the protected-branch publish workflow on `main` computes the published package version as `yyyy.m.d-<shortsha>` and publishes that version to the public npm registry automatically from the push when `NPM_TOKEN` is configured

Current publish-package details are documented in:

- `docs/development/core-runtime-publishable-package.md`

Public npm package note:

- the core package page is `https://www.npmjs.com/package/@service-lasso/service-lasso`
- public npm consumers install from `https://registry.npmjs.org`
- local consumers do not need a scoped `.npmrc` or GitHub package token for the public npm path
- the GitHub Packages package remains historical/internal evidence and still requires auth if explicitly used

Local install example:

```bash
npm install @service-lasso/service-lasso
```

Optional GitHub Packages `.npmrc` example for legacy/internal consumers:

```ini
@service-lasso:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

GitHub Actions consumer example for public npm:

```yaml
permissions:
  contents: read

steps:
  - uses: actions/setup-node@v5
    with:
      node-version: 22
      registry-url: https://registry.npmjs.org
  - run: npm ci
```

Direct package-consumer proof:

- `.github/workflows/verify-package-consumer.yml` runs the registry install verifier on demand against npmjs by default
- `.github/workflows/publish-package.yml` re-installs the just-published npmjs version after publish and runs the same verifier

## Demo instance commands

The repo now includes an explicit bounded demo flow that uses the tracked `services/` tree as `servicesRoot` and `workspace/demo-instance/` as the default `workspaceRoot`.

```bash
npm run demo:start
npm run demo:smoke
npm run demo:reset
```

What these do:

- `npm run demo:start` builds and starts the runtime against the demo roots so a reviewer can inspect `/api/health`, `/api/services`, `/api/runtime`, and `/api/dependencies`
- `npm run demo:smoke` runs the end-to-end scripted demo proof for the direct `echo-service` path plus the provider-backed `node-sample-service` path
- `npm run demo:reset` removes demo workspace/state/artifact output so the demo can be rerun cleanly without manual cleanup

The scripted smoke flow is also covered by `tests/demo-instance.test.js`.

## Donor Reference Snapshot

## Donor Reference Snapshot

Local donor reference folder:

- `ref/typerefinery-service-manager-donor/`

Git ignore rules were added so this can be used as working reference material without polluting repo history.

### Copied donor areas

#### 1. `electron/app/main`
Copied from donor into:

- `ref/typerefinery-service-manager-donor/electron/app/main/`

Current files:

- `i18n.ts`
- `index.ts`
- `Logger.ts`
- `Resources.ts`
- `Service.ts`
- `ServiceManager.ts`
- `Services.ts`
- `TypedEventEmitter.ts`
- `Utils.ts`
- `vite.config.ts`

Most relevant service-manager files:

- `Service.ts` — core per-service runtime/execution logic
- `ServiceManager.ts` — service discovery, dependency ordering, port reservation, lifecycle control
- `Services.ts` — standalone service-manager web UI/API runner
- `Logger.ts` — logging wrapper used by the runtime
- `Utils.ts` — process/port helper functions
- `Resources.ts` — path/data helpers used by the standalone runner

This donor material has since been cleaned into a runnable standalone-only shape under:

- `ref/typerefinery-service-manager-donor/runtime/`

The original donor Electron app folder was removed from the ref snapshot once the standalone runtime was promoted into `runtime/`.

#### 2. `services/`
Copied from donor into:

- `ref/typerefinery-service-manager-donor/services/`

Copied service directories:

- `_archive`
- `_java`
- `_keycloak`
- `_localcert`
- `_node`
- `_python`
- `_traefik`
- `bpmn-client`
- `bpmn-server`
- `cms`
- `fastapi`
- `filebeat`
- `files`
- `jupyterlab`
- `messageservice-client`
- `mongo`
- `nginx`
- `openobserve`
- `postgredb`
- `postgredb-admin`
- `totaljs-flow`
- `totaljs-messageservice`
- `typedb`
- `typedb-init`
- `typedb-sample`
- `wsecho`

The donor runtime discovers services via:

- `services/*/service.json`

So the service folders and configs are part of the runtime contract, not just content.

#### 3. Donor root config/build files
Copied into:

- `ref/typerefinery-service-manager-donor/`

Current files:

- `package.json`
- `package-lock.json`
- `.waiton.json`
- `tsconfig.json`
- `tsconfig.vite-config.json`
- `tsconfig.vitest.json`
- `scripts/build.mjs`

These were copied to preserve the donor execution shape and dependency declarations for analysis.

## How the Donor App Used the Service Manager

The donor `electron/app/main/index.ts` shows that the service manager was originally embedded as an **application-side runtime orchestrator**, not just a background helper.

### App embedding pattern in donor `index.ts`

The donor app did the following:

1. **Constructed a `ServiceManager` during app startup**
   - passed in `logsDir`
   - passed in `LOCAL_SERVICES_PATH`
   - passed in `LOCAL_SERVICES_USERDATA_PATH`
   - passed event callbacks for:
     - `sendServiceStatus`
     - `sendServiceLog`
     - `sendServiceList`
     - `sendGlobalEnv`

2. **Used app config/env to locate the services tree**
   - `LOCAL_SERVICES_PATH` came from env/package config
   - `LOCAL_SERVICES_USERDATA_PATH` came from app data storage

3. **Started services after the UI window finished loading**
   - on `mainWindow.webContents.on("did-finish-load")`
   - it checked whether this was first run
   - then called `serviceManager.startAll(isFirstRun)`

4. **Stopped services when the app closed**
   - on window close / app exit it called `serviceManager.stopAll()`
   - if services were still running, the app blocked exit until shutdown completed

5. **Used IPC to expose service operations to the renderer/UI**
   The app exposed methods like:
   - `getServices()`
   - `restartService(serviceId)`
   - `startService(serviceId)`
   - `stopService(serviceId)`
   - `startAll()`
   - `stopAll()`
   - `getGlobalEnv()`

6. **Pushed service events back into the app UI**
   The app forwarded runtime updates into the renderer with window events like:
   - `sendServiceStatus`
   - `sendGlobalEnv`

### What that means architecturally

In donor form, the service manager acted as:

- a runtime registry/discovery layer over `services/*/service.json`
- a dependency-aware process supervisor
- a port/environment resolver
- an app-integrated backend whose state was surfaced into the desktop UI through IPC/window events

So the original app usage model was:

- **desktop app boots**
- **desktop app constructs service manager**
- **service manager discovers and supervises local services**
- **desktop UI controls and observes services through IPC**

### Why this matters for Service Lasso

This is useful as a reference pattern, but we do **not** want to keep the Electron-specific shape.

The reusable part is the runtime role:

- discover services
- resolve dependencies and ports
- expose service status
- start/stop/restart services
- surface global environment

The non-reusable donor parts are:

- `electron` window lifecycle
- renderer IPC bindings
- `update-electron-app`
- preload/window event plumbing
- app-data helpers that assume Electron

So for Service Lasso, the equivalent should become a **node-only standalone runtime/server** instead of an Electron-embedded app backend.

## Windows Containment Tiers (proposed)

For Windows, Service Lasso should not treat one process babysitter as a universal containment boundary. The practical model is a tiered runtime contract.

| Tier | Mode | What Service Lasso does | What containment it can realistically claim |
| --- | --- | --- | --- |
| 0 | Direct | Launch service process directly with no babysitter | Lowest containment, suitable only for trusted/simple cases |
| 1 | Simple babysitter | Launch one app under `tini-win` | Strong for ordinary descendants in the same Job Object |
| 2 | Managed broker | Route child work through Service Lasso-controlled launch/broker policy | Stronger observability and control for software we own or adapt |
| 3 | Isolated runtime | Run the service inside a stronger sandbox/container/VM boundary | Strongest practical containment on Windows |

### Recommended meaning of each tier

#### Tier 1 - `tini-win` backed simple service
Use this for the normal `SimpleService` abstraction on Windows.

Good fit:
- one main process
- normal child-tree behavior
- graceful stop command available or force-kill acceptable
- app does not intentionally rely on external brokers for core work

What it gives:
- launch one child
- wait and classify exit status
- graceful stop + timeout + forced cleanup
- normal descendant cleanup via Job Objects

Known limits:
- external broker paths can escape
- Task Scheduler / WMI style launches can escape
- breakaway can escape if explicitly allowed
- not equivalent to Linux PID1/subreaper semantics

#### Tier 2 - Service Lasso managed broker mode
Use this when Service Lasso can own the launch path.

The idea:
- child creation is mediated by Service Lasso policy
- service code requests work through an approved launcher/broker
- launches are logged, attributed, and policy-checked
- suspicious or unapproved launch paths are visible as violations

This is the best path for getting closer to cross-platform behavioral consistency without pretending Windows process semantics are identical to Linux.

#### Tier 3 - Strong isolation mode
Use this when stronger containment is required than a babysitter can provide.

Examples:
- Windows containers
- Hyper-V / lightweight VM isolation
- other OS-enforced restricted runtime boundaries

This is the practical answer when you need something closer to universal containment.

### What Service Lasso should say explicitly

Service Lasso can reasonably claim:
- cross-platform simple-service management contract
- platform-native runners underneath (`tini` on Linux, `tini-win` on Windows)
- tiered containment posture on Windows

Service Lasso should not claim:
- that `tini-win` alone guarantees universal containment on Windows
- that Windows semantics are identical to Linux `tini`
- that all descendant work can always be killed regardless of launch path

### Suggested backend contract

A shared `SimpleServiceRunner` abstraction can still be cross-platform, but it should expose capability/guarantee differences clearly.

Suggested fields:
- `runnerKind` (`tini`, `tini-win`, direct, isolated`)
- `supportsGracefulStop`
- `supportsTreeKill`
- `supportsBreakawayControl`
- `escapeRiskClass`
- `isolationTier`
- `notes`

That gives Service Lasso one service API while preserving honest platform-specific behavior.

## Standalone Service Manager Entry Point

The donor repo already supports running the service manager as a standalone process.

Relevant donor package scripts:

- `services` → `cross-env SERVICES_AUTOSTART=true tsx electron/app/main/Services.ts`
- `servicesdebug` → `cross-env SERVICES_AUTOSTART=false tsx electron/app/main/Services.ts`
- `servicesprod` → `cross-env SERVICES_AUTOSTART=true NODE_ENV=production tsx electron/app/main/Services.ts`

That means the donor standalone entrypoint is:

- `electron/app/main/Services.ts`

### Standalone behavior

`Services.ts`:

- creates a `ServiceManager`
- points it at the repo `services/` directory
- runs a local Express UI/API
- serves the service UI on port `3001`
- optionally auto-starts managed services when `SERVICES_AUTOSTART=true`

Important routes:

- `http://localhost:3001/services`
- `http://localhost:3001/services/status`

This is the current best candidate for the **first runnable transplant target** in Service Lasso.

## Donor Service Dependency Shape

The donor runtime includes utility/runtime services plus application services.

Examples:

- `fastapi` → depends on `python`
- `bpmn-server` → depends on `node,mongo`
- `totaljs-flow` → depends on `node,totaljs-messageservice`
- `cms` → depends on `totaljs-flow,totaljs-messageservice,mongo,nginx`
- `typedb-init` → depends on `typedb`
- `typedb-sample` → depends on `python,typedb,typedb-init`
- `keycloak` → depends on `postgredb` and runs via `java`

This confirms that the donor `services/` tree is a coordinated service runtime, not a loose collection of examples.

## Important Findings / Constraints

### 1. This repo is not runnable yet
Current `service-lasso` root does **not** yet have its own real runtime/app files in place.
It currently acts as:

- governance/bootstrap repo
- donor-analysis workspace
- transplant planning area

### 2. Some donor Windows payloads are missing
The donor configs reference some packaged runtime artifacts that are **not present** at the expected donor paths.

Confirmed examples:

Present:
- `services/_archive/win32/7za.exe`
- `services/nginx/win32/nginx.exe`

Missing:
- `services/_node/node-v18.6.0-win-x64.zip`
- `services/_python/python-3.11.5-embed-amd64.zip`
- `services/postgredb/win32.zip`

Implication:

- copying donor source/configs alone is **not enough** to guarantee the full donor stack will run on Windows “as-is”
- some packaged runtime assets will need to be sourced, replaced, or redesigned during transplant

### 3. Best first execution target
The cleanest first target is probably:

- transplant the standalone service-manager path first
- get a `Services.ts`-style runner working in Service Lasso
- then decide how much of the donor managed-service stack should survive intact

## Running the Donor Snapshot from `ref/`

The donor snapshot can now be run directly from:

- `ref/typerefinery-service-manager-donor/`

### One-time install inside `ref/`

From that folder:

```powershell
npm ci --ignore-scripts
node node_modules\electron\install.js
```

Why both steps:

- `npm ci --ignore-scripts` installs the donor dependency tree locally in `ref/` without dragging in extra app-builder hooks during initial setup
- `node node_modules\electron\install.js` completes the Electron package install required by the standalone runtime

### Standalone runner commands

From `ref/typerefinery-service-manager-donor/`:

```powershell
.\start.debug.ps1
```

or:

```powershell
.\start.ps1
```

The ref wrapper scripts now launch the standalone runtime **directly with Node + local `tsx`** from `runtime/Services.ts`.

Current wrapper shape:

- root themselves to `$PSScriptRoot`
- create `logs\_archive` before launch
- set `SERVICES_AUTOSTART=true|false`
- run:
  - `node .\node_modules\tsx\dist\cli.mjs .\runtime\Services.ts`

This keeps the launch path node-only for the standalone runtime.

> Temporary compatibility note: this `logs\_archive` directory creation is currently a **workaround**, not a proper fix. The donor runtime assumes the archive folder already exists and crashes if it does not. Service Lasso should fix this later in the runtime itself so log archival is safe when the archive folder is missing on first run.

### Smoke-test result

Confirmed working in `ref/`:

- `npm run servicesdebug` starts successfully from the copied donor snapshot
- the standalone runner reports: `Server running on port 3001`

Observed behavior:

- `http://localhost:3001/services/status` responds
- in debug mode it reports `not ready` because managed services like `localcert` are not started yet, which is expected with `SERVICES_AUTOSTART=false`

### Electron removal work completed in the standalone path

For the copied standalone path, the following Electron-related coupling was removed from the runtime path we are actually using:

- `Logger.ts`
  - removed the `update-electron-app` logger type dependency
  - replaced it with a local minimal logger interface
- `Resources.ts`
  - removed the Electron `app` import
  - replaced path resolution with plain `process.cwd()`-based node behavior for ref-mode standalone use

This means the current standalone service-manager path no longer needs Electron just to resolve paths or construct the logger.

Further cleanup completed after that first pass:

- promoted the runnable files into `ref/typerefinery-service-manager-donor/runtime/`
- repointed package scripts `services`, `servicesdebug`, and `servicesprod` to `runtime/Services.ts`
- removed the copied donor Electron app folder from the ref snapshot
- removed the copied Electron-oriented PowerShell wrappers from the ref snapshot

### Current limitations

Even though the standalone manager now runs from `ref/`, full donor service parity is still not guaranteed because several donor runtime payloads are missing, including examples like:

- `services/_node/node-v18.6.0-win-x64.zip`
- `services/_python/python-3.11.5-embed-amd64.zip`
- `services/postgredb/win32.zip`

So the current win is:

- the **service-manager runtime itself runs inside `ref/`**
- but not every packaged donor-managed service can necessarily be started successfully yet

## Current Local Ignore Setup

This repo now ignores donor reference material via `.gitignore`.

Current intent:

- keep donor material available locally for analysis
- avoid checking donor snapshots into repo history
- move only deliberate, cleaned, project-owned code into tracked Service Lasso source later

## Recommended Next Steps

1. Create a **tracked donor manifest** describing which donor pieces are reference-only vs intended for transplant.
2. Extract the **minimal standalone runtime slice** needed to run the service manager in Service Lasso.
3. Reconcile the ref scratchpad docs against the canonical question set in:
   - `ref/typerefinery-service-manager-donor/QUESTION-LIST-AND-CODE-VALIDATION.md`
4. Resolve missing Windows payloads for any services we actually intend to run.
5. Introduce tracked Service Lasso source files rather than continuing to work only from `ref/`.

## Manifest cleanup direction

A new schema-normalization direction has been settled:

- Service Lasso should move away from one giant donor-style `execconfig` block
- the manifest should be cleaned up into clearer structured sections instead
- likely section areas include runtime, install, network, env, health, and dependencies

This does **not** change the one-manifest direction:

- keep one canonical `service.json`
- but organize it more cleanly internally

## Actions interpretation

`actions` should be treated as:

- service-specific custom commands that override Service Lasso default behavior for a named service action

It should **not** be treated as:

- an arbitrary free-form custom action registry
- generic metadata
- a second separate architecture model

Meaning:

- Service Lasso has default behavior for supported service actions
- the manifest `actions` block exists so the service creator can map their service-specific command for a named action when that service needs to override the default
- if no override is defined, Service Lasso uses its default behavior
- example: a service can define `stop` to use a graceful service-native shutdown command instead of default process termination
- do **not** expand the overrideable action list spec pre-emptively; keep it minimal and only extend it when a concrete service demonstrates a real need

## `service.state` direction

Current preferred direction for `service.state` is:

- move away from a single flat `service.state` blob toward a managed `.state/` folder
- avoid a separate pointer/current file unless a concrete need appears
- avoid a separate legacy `service.pid` file unless a concrete need appears
- runtime/process info such as PID can live inside the structured JSON state record itself
- backups should live under `.state/backups/`
- logs can remain logs; they do not need to become full state snapshots by default

Current lifecycle-write rule:

- when a service starts, its state JSON is created
- when the service stops, that same state JSON is updated with the last action/result
- other lifecycle events should generally write logs for now rather than creating additional timestamped state files by default

This keeps managed operational state simpler while preserving a clear last-known service record.

## Documentation/progress index

A tracked documentation/progress index now exists at:

- `ref/typerefinery-service-manager-donor/DOCS-AND-PROJECT-INDEX.md`

Use it to:
- see what donor-analysis docs and runtime/code evidence we currently have
- track OpenSpec-style documentation progress
- keep priority focus on:
  - core
  - ui
  - service template

A ref-only OpenSpec draft set also now exists under:

- `ref/typerefinery-service-manager-donor/openspec-drafts/`

These drafts follow the repo governance spec-template shape but remain in `ref/` until the analysis/design phase is stable enough to promote them.

## Canonical reconciled donor/runtime-boundary questions

The main donor/runtime-boundary questions from chat history have now been consolidated in:

- `ref/typerefinery-service-manager-donor/QUESTION-LIST-AND-CODE-VALIDATION.md`

That doc should be treated as the canonical reconciliation point for:

- utility services vs normal running services
- `globalenv` as controlled shared service env
- core-owned port negotiation
- service-declared / core-orchestrated install behavior

Use it together with:

- `ref/typerefinery-service-manager-donor/ARCHITECTURE-DECISIONS.md`
- `ref/typerefinery-service-manager-donor/SERVICE-MANAGER-BEHAVIOR.md`

before trusting older speculative planning docs in `ref/`.

## Install vs Config Sequencing Rule

Service Lasso should treat `install` and `config` as **distinct actions**.

### `install`

`install` should mean:

- acquire or download required payloads
- extract or unpack them
- run setup commands needed to place the service on disk
- materialize or rewrite the Lasso-managed effective config/output it owns
- converge the service to the current expected installed state

Mental model:

- **install = materialize the service into its current expected installed/configured state**

Important clarification:

- install may rewrite managed/effective config output
- install does **not** necessarily revert all content back to pristine package defaults
- install should not be read as "wipe everything and reset all files"
- it is closer to reconcile/materialize current desired installed state than to destructive reset

### `config`

`config` should mean:

- generate or update the effective runtime config
- merge service config, app overrides, and runtime-resolved values
- materialize the final config into the runtime area

Mental model:

- **config = materialize the effective config this service should run with**

Current discussion note:

- if install already rewrites the Lasso-managed effective config as part of converging the service into the expected installed state, then a separate first-class `config` action may only be needed later for lighter-weight regeneration/update scenarios
- do not assume separate `config` must remain first-class unless a concrete use case requires it

### Relationship between them

Conceptually:

1. `install`
2. `config`
3. `start`

On a first-time setup, `install` may automatically chain into `config` if config must exist before the service can be started or considered usable.

That does **not** mean the two actions are the same.

Important donor finding:

- the current donor `setup` flow is doing work that is partly install/bootstrap and partly config/preparation
- so donor `setup` should be read as evidence of an entangled current implementation, not as proof that future Service Lasso should expose `setup` as the canonical first-class action name
- this is exactly why the cleaner future split is `install` -> `config` -> `start`

They stay separate because later we may need to:

- rerun `config` without reinstalling
- regenerate config after app override changes
- refresh config after port or routing changes
- rebuild derived runtime config for reverse proxies or shared ingress

### Example: Traefik-style service

First-time flow:

1. install Traefik payload
2. run config to build routing/runtime config
3. start or reload the service

Later change flow:

- no reinstall required
- rerun config only
- then restart or reload if needed

This separation should be part of the Service Lasso action model.

## Summary

What we have right now:

- a donor snapshot of the TypeRefinery standalone service-manager implementation
- a donor snapshot of the full managed `services/` tree
- donor root config/build files needed for analysis
- confirmation that `electron/app/main/Services.ts` is the donor standalone start path
- confirmation that some donor runtime archives/binaries are missing, so full donor parity is not yet possible by copy alone

That gives us a solid reference base for the next step: turning selected donor runtime pieces into actual tracked Service Lasso source.

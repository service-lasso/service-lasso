# Service Config Types

This document groups the general `service.json` config/service patterns currently represented across the Service Lasso example set and donor-derived reference set.

## 1. Runtime / execution type

### Direct binary application
A bundled executable runs directly.

Examples:
- nginx
- mongo
- traefik
- openobserve

### Runtime-linked application
An app runs via another runtime/service using `execservice`.

Examples:
- Node app
- Java app
- Python app

### Node application
Uses a Node runtime or Node executable.

### Java application
Uses a Java runtime via `execservice: "@java"`.

Current core status:
- `@java` exists as a bounded local/no-download provider manifest.
- release-backed JRE redistribution is deferred until the project chooses a vendor, license, platform, and update strategy.

### Python application
Uses a Python runtime via `execservice: "@python"`.

### CLI or secondary-runtime application
Uses another service's CLI/runtime variant.

Example shape:
- `execservice` with `cli: true`

## 2. Service role type

### Portable runtime or base service
Provides runtime/tooling to other services rather than acting as an end-user app.

Examples:
- `@node`
- `@java`
- `@python`
- `@archive`

Current core provider services use:

```json
"role": "provider"
```

That means Service Lasso should install/configure the provider manifest and expose its dependency/env contract, but baseline start should not falsely mark it as a long-running daemon. A provider with no explicit healthcheck is considered healthy once installed/configured.

### Operator or UI application
Human-facing admin UI or dashboard service.

Examples:
- `@serviceadmin`

### Infrastructure or edge service
Provides routing, certificates, databases, storage, or observability.

Examples:
- traefik
- localcert
- mongo
- postgredb
- openobserve

### One-shot or init job
Bootstrap/import/setup script rather than a long-running service.

Examples:
- `typedb-init`
- sample-data loaders

### Long-running daemon or service
Normal background service with persistent runtime lifecycle.

## 3. Health model type

### Process health check
Healthy if the process exists.

### HTTP health check
Healthy via HTTP URL and expected status.

### TCP health check
Healthy via open socket/port.

### Variable health check
Healthy via expected variable/output state.

### No explicit health check
No runtime health contract is declared.

## 4. Environment contract type

### Service-local env consumer
Consumes/imports service-local variables via `env` only.

### Global env exporter
Exports shared variables via `globalenv`.

### Import and export service
Both consumes `env` and emits `globalenv`.

### No-env service
No meaningful environment contract is declared.

## 5. Dependency graph type

### Dependency-linked service
Declares dependencies via `depend_on`.

### Standalone service
Declares no dependencies.

## 6. Executable declaration type

### String executable service
`executable` is a single simple name or path.

### OS-specific executable service
`executable` varies by platform.

### Commandline-driven service
Startup behavior is mainly defined by `commandline`.

### Args-driven service
Startup behavior is mainly defined by structured args rather than a full commandline string.

## 7. Lifecycle / action type

### Action-rich managed service
Declares a fuller lifecycle such as `install`, `config`, `start`, `stop`, and sometimes `restart`.

### Minimal-action service
Declares only part of the lifecycle.

### Template or minimal sample service
Smallest proof-of-contract service shape.

### Config-generating service
Has a meaningful `config` phase that materializes runtime config.

### Installable or package-acquisition service
Has a meaningful `install` phase.

### Restart-capable service
Declares an explicit `restart` action.

## 8. Recovery / doctor / hook contract type

### Monitored service
Declares `monitoring` policy so future runtime monitor work can decide whether a service is eligible for periodic health checks.

Current core status:
- the manifest contract accepts bounded `monitoring` fields
- no automatic monitor loop is enabled by this contract alone

### Auto-restart-capable service
Declares `restartPolicy` with explicit crash/unhealthy restart intent, maximum attempts, and backoff.

Current core status:
- the manifest contract accepts bounded `restartPolicy` fields
- the opt-in runtime monitor can restart crashed services when monitoring and restart policy allow it

### Doctor/preflight service
Declares `doctor` steps that can be used before restart or upgrade flows.

Current core status:
- the manifest contract accepts bounded doctor step definitions with timeout and failure policy
- restart executes configured doctor steps and blocks or warns according to failure policy

### Hooked lifecycle service
Declares `hooks` such as `preRestart`, `postRestart`, `preUpgrade`, `postUpgrade`, `rollback`, and `onFailure`.

Current core status:
- the manifest contract accepts bounded hook definitions
- update install executes `preUpgrade` and `postUpgrade` hooks, records bounded hook results in update state, and invokes `rollback` plus `onFailure` hooks for failed upgrade simulations
- monitor, doctor, restart, and hook execution evidence is persisted in `.state/recovery.json` with bounded retention

## 9. Update policy type

### Pinned release service
Declares `artifact.source.tag` and no active `updates` policy. Service Lasso treats this as pinned by default.

Current core status:
- the manifest contract preserves existing pinned manifests without requiring an `updates` block
- read-only update discovery reports these services as `pinned`

### Notify-only tracked service
Declares `updates.mode: "notify"` and `updates.track: "latest"` or a named release channel/tag.

Current core status:
- read-only discovery can resolve the tracked GitHub release, compare it with installed artifact state, and report `latest`, `update_available`, `unavailable`, or `check_failed`
- no archive download or install happens during discovery

### Download-only or install-capable service
Declares `updates.mode: "download"` or `updates.mode: "install"`.

Current core status:
- the manifest contract validates these modes
- install mode must also declare `installWindow` and `runningService`
- CLI/API and the opt-in scheduler can download candidates and install them through the shared update action
- install-mode scheduler work enforces `installWindow` and `runningService` safety before download/extract
- Service Admin surfaces update states and bounded check/download/install actions through the runtime update API

## 10. Recommended doc framing

For docs, these patterns are best treated as orthogonal dimensions rather than mutually exclusive service classes.

A single service can be:
- a runtime-linked Node application
- with HTTP health check
- that imports local env
- exports global env
- depends on other services
- exposes install/config/start/stop actions
- and opts into notify/download/install update policy

That means the cleanest later documentation structure is:
1. execution/runtime type
2. service role
3. health model
4. env contract
5. dependency model
6. executable/command model
7. lifecycle/action model
8. recovery/doctor/hook model
9. update policy model

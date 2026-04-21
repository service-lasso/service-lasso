# Core runtime logging model

This document defines the recommended logging and archival model for the `service-lasso` core runtime.

Current implementation note:
- the runtime currently ships a bounded per-service log model under `servicesRoot/<service>/logs/`
- prior per-service runtime logs are archived on the next managed start with bounded retention
- the broader `workspaceRoot/logs/runs/<runId>/` model described below remains the target architecture, not the current full implementation

It intentionally uses:
- `servicesRoot` for the managed services tree
- `workspaceRoot` for Service Lasso runtime-managed working data
- `workspaceRoot/logs/runs/<runId>/` as the canonical live log layout

## Purpose

The logging model should let us:
- trace exactly what happened during a specific runtime run
- keep manager/runtime logs separate from per-service logs
- preserve raw stdout/stderr without confusing logs with state
- archive old runs cleanly on restart
- support later operator tooling without coupling logging to UI behavior

## Current direction

Max clarified the preferred runtime-root model as:
- `servicesRoot` = where services live
- `workspaceRoot` = where Service Lasso stores working/runtime-managed data

For logging, the canonical source of truth should be:

```text
<workspaceRoot>/logs/runs/<runId>/
```

Where `<runId>` is one runtime manager session/run.

Example:

```text
C:\some\workspace\logs\runs\2026-04-20_10-27-13\
```

## Why `runs/<runId>` is the right unit

Benefits:
- one runtime startup gets one trace boundary
- manager logs and all service logs stay bundled together
- cross-service incidents remain debuggable as one run
- archival can preserve whole-run history cleanly
- retention can operate on whole runs rather than loose files

This is better for traceability than scattering archives per service.

## Scope split

### `servicesRoot`
This is where the services are located.

It should hold things like:
- service folders
- `service.json`
- service-owned content/runtime payloads
- service-local `.state/` if that remains the chosen state pattern

### `workspaceRoot`
This is where Service Lasso keeps runtime-managed working data.

For logging, it should hold:
- live run logs
- archived run zips
- runtime-level metadata related to logging/archival if needed

## Canonical folder structure

```text
<workspaceRoot>/
  logs/
    runs/
      <runId>/
        manager/
          runtime.log
          runtime-error.log
          events.jsonl
          metadata.json
        services/
          <serviceId>/
            stdout.log
            stderr.log
            events.jsonl
            metadata.json
    archive/
      <runId>.zip
```

## What each file is for

## Manager/runtime files

### `manager/runtime.log`
Human-readable runtime-manager log stream.
Use for normal orchestration messages.

### `manager/runtime-error.log`
Human-readable runtime-manager error stream.
Use for manager/runtime failures and serious warnings.

### `manager/events.jsonl`
Structured machine-readable manager/runtime events.
Each line should be one JSON object.

Examples:
- runtime started
- runtime stopping
- service loaded
- service validation failed
- archival started/completed
- retention cleanup performed

### `manager/metadata.json`
Small summary for the run.

Recommended fields:
- `runId`
- `startedAt`
- `endedAt`
- `runtimeVersion`
- `servicesRoot`
- `workspaceRoot`
- `status`

## Per-service files

### `services/<serviceId>/stdout.log`
Raw captured stdout from the service process.

### `services/<serviceId>/stderr.log`
Raw captured stderr from the service process.

### `services/<serviceId>/events.jsonl`
Structured machine-readable lifecycle/runtime events for that service.

Examples:
- install started/completed/failed
- config started/completed/failed
- process spawned
- health check passed/failed
- process exited
- stop completed

### `services/<serviceId>/metadata.json`
Small summary for that service within the run.

Recommended fields:
- `serviceId`
- `runId`
- `serviceRoot`
- `provider`
- `startedAt`
- `endedAt`
- `lastStatus`
- `lastExitCode`
- `pid` or `pids` when available

## Raw streams vs structured events

This separation should stay explicit.

### Raw streams
Keep process output in:
- `stdout.log`
- `stderr.log`

### Structured events
Keep lifecycle/runtime/history records in:
- `events.jsonl`

That gives us both:
- faithful raw output
- machine-readable operational history

## Rotation policy

Current preferred direction:
- **do not add log rotation for now**

Reason:
- simple run archival on restart is enough for the current phase
- it keeps the implementation smaller and easier to reason about
- `runs/<runId>` already provides natural boundaries between sessions

If a later long-running session proves too large, rotation can be added later.
But it should not be part of the first logging implementation by default.

## Archival model

Archival should happen at the **whole-run level**.

### Archive source
- `<workspaceRoot>/logs/runs/<runId>/`

### Archive target
- `<workspaceRoot>/logs/archive/<runId>.zip`

### Why whole-run archival is correct
Because `runs/<runId>` is the traceability unit.
One runtime run can include:
- manager events
- service A logs
- service B logs
- dependency interactions
- startup and shutdown timeline

All of that should stay bundled together in one archive.

### Why not archive per service
Per-service archives would fragment evidence and make cross-service debugging harder.

## When archival should happen

Current preferred rule:
- **archive the previous completed run on restart**

This gives a simple first model:
1. runtime starts and creates a new `runs/<runId>/`
2. if a previous run folder exists and is complete, archive it into `archive/<runId>.zip`
3. keep the current active run unarchived while it is active

## Retention

Retention should apply to archived whole-run zip files.

Reasonable first default:
- keep archived runs for `30 days`

That can be changed later, but the important point is that retention operates on archived run bundles, not per-service fragments.

## `current/` alias

Do not make `current/` canonical.

If a convenience alias is ever added later, it should only be a pointer or convenience path.
The source of truth should remain:

```text
<workspaceRoot>/logs/runs/<runId>/
```

## Relationship to state

Logs are not state.

Logging should live under:
- `<workspaceRoot>/logs/...`

State should remain separately modelled.
If per-service `.state/` remains the preferred state location, that should stay distinct from logging.

## Relationship to donor behavior

Useful donor ideas worth keeping:
- one log root per runtime run
- manager logs separate from service logs
- raw stdout/stderr capture to files
- archive old runs
- retention cleanup

Things to improve over donor behavior:
- use explicit `runs/<runId>` naming
- use `workspaceRoot` rather than ad hoc root naming
- keep structured events separate from raw streams
- keep logging independent from UI concerns
- archive whole runs explicitly on restart
- skip unnecessary rotation for now

## Suggested implementation phases

## Phase 1, canonical workspace-backed live layout
- add configurable `workspaceRoot`
- write live logs under `workspaceRoot/logs/runs/<runId>/`
- separate manager and service log folders
- capture raw stdout/stderr

## Phase 2, structured event streams
- add `events.jsonl` for manager and services
- emit runtime/lifecycle/health events there

## Phase 3, archival on restart
- archive the previous run folder into `workspaceRoot/logs/archive/<runId>.zip`
- keep current run live and unarchived

## Phase 4, retention
- delete old run archives after the retention period

## Bottom line

The canonical Service Lasso logging model should be:
- `servicesRoot` for services
- `workspaceRoot` for runtime-managed working data
- live logs under `workspaceRoot/logs/runs/<runId>/`
- archived whole-run zips under `workspaceRoot/logs/archive/`
- no rotation for now
- whole-run archival on restart

That gives us traceability, simpler implementation, and clean cross-service evidence preservation.

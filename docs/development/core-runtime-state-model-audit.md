# Core runtime state-model audit

This document audits the current `service-lasso` state model against the earlier agreed direction.

It exists to stop us blurring together:
- what was actually agreed, and
- what was only implemented provisionally in the first bounded core slice

## Source basis

### Agreed direction
From prior clarified direction:
- managed operational state should live under a `.state/` folder
- likely state areas were:
  - `service`
  - `install`
  - `content`
  - `config`
  - `runtime`
- backups should live under `.state/backups/`
- logs should remain logs by default, not be treated as state snapshots
- avoid a separate pointer/current file unless needed
- avoid a separate `service.pid` unless needed, because PID/runtime info can live in structured state JSON
- current lifecycle-write rule was: when a service starts, its state JSON is created; when it stops, that same state JSON is updated with the last action/result; other lifecycle events should generally write logs for now rather than creating additional timestamped state files by default

### Current implementation audited
- `src/runtime/state/paths.ts`
- `src/runtime/state/writeState.ts`
- `src/runtime/state/readState.ts`

## Audit result

Current preferred storage split around this audit:
- per-service state remains the likely direction under each service root
- runtime-managed logs and run archives should live under `workspaceRoot`

So this audit is specifically about the per-service `.state/` model, not about runtime-wide logging storage

## What is actually agreed

These points are grounded in prior direction:

### 1. `.state/` folder model is agreed
This part is real and aligned.

### 2. Structured state areas are agreed directionally
The idea of splitting state into separate concerns rather than one flat blob is agreed.

### 3. `service`, `install`, `content`, `config`, and `runtime` were directionally named areas
These were discussed as likely areas.
That means the direction is real, but the exact final concrete file layout was not fully locked.

### 4. `.state/backups/` is agreed directionally
A backup/history area under `.state/backups/` is part of the agreed direction.

### 5. Logs are not state
This is agreed and important.
Log files should remain logs by default.

### 6. Avoid separate pointer/current and PID files unless needed
This is agreed direction.

### 7. Runtime/process/PID information may live in structured state JSON
This is agreed direction.

## What is only provisional in the current implementation

These parts are **not** canonically settled just because they exist in code.

### 1. Exact filenames are provisional
Current code hardcodes:
- `.state/service.json`
- `.state/install.json`
- `.state/config.json`
- `.state/runtime.json`

These exact files were a provisional implementation choice.
They should not be treated as fully settled contract just because they currently exist in code.

### 2. `content` is missing
Earlier direction included a likely `content` state area.
Current implementation does not include it.
So the current code is incomplete even relative to the earlier directional model.

### 3. Current write behavior is more aggressive than the earlier write rule
Current code writes multiple files on lifecycle actions.
The earlier direction was narrower: the service state should be created/updated around start/stop, while other lifecycle events should generally favor logs rather than defaulting to more state-file churn.

So the present implementation should be read as provisional behavior, not settled lifecycle-state policy.

### 4. Backups directory exists only as a placeholder
Current code creates `.state/backups/`, but does not actually write tracked backup/history content there yet.
So this is scaffolding, not completed behavior.

### 5. Current file contents are thin placeholders
Current code currently stores only a very small subset of information:
- `service.json`
  - id, name, description, enabled, version
- `install.json`
  - installed, lastAction
- `config.json`
  - configured, lastAction
- `runtime.json`
  - running, lastAction, actionHistory

That is a bounded first slice, not a full agreed state model.

## What is actually live right now

### Physically written now
The current code really writes:
- `.state/service.json`
- `.state/install.json`
- `.state/config.json`
- `.state/runtime.json`

### Physically created but not meaningfully used yet
- `.state/backups/`

### Not currently implemented despite earlier direction
- a concrete `content` state area
- explicit backup history records
- real runtime/PID/process evidence in structured state
- startup rehydration using this model as a true runtime source of truth
- a settled rule for when state writes should happen beyond the current placeholder lifecycle flow

## Mismatch summary

The current code and the earlier agreed direction diverge in these important ways:

1. **directional areas became concrete filenames too early**
2. **`content` was dropped from the current implementation**
3. **backup/history is only stubbed**
4. **current write policy is not clearly aligned with the earlier lifecycle-write rule**
5. **thin placeholder JSON was easy to mistake for a settled state contract**

## Safe wording going forward

Until the model is properly locked, we should describe it like this:

- the agreed direction is a structured `.state/` folder model
- the exact current files under `.state/` are provisional first-slice implementation choices
- the current implementation should not be treated as the final state contract

## Recommended next cleanup

To stop future confusion, the next useful step should be one of these:

1. **lock the state contract properly**
   - decide the exact `.state/` structure and write semantics

2. **rename/document the current implementation explicitly as provisional**
   - so nobody treats the current filenames as settled design by accident

## Bottom line

The agreed thing is:
- **structured state under `.state/`**

The not-yet-fully-agreed thing is:
- **the exact concrete file layout and write policy currently in code**

So the current state implementation is best described as:

**directionally aligned, but still provisional and incomplete.**

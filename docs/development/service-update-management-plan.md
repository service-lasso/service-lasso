# Service Update Management Plan

This document captures the governed plan for GitHub issue `#120` and the implemented update-management slices.

## Goal

Service Lasso needs a safe way to tell operators when a managed service has a newer release available, download candidates when policy allows, and eventually install those candidates during approved windows.

The first implemented slices are intentionally bounded:

- `#121` adds an explicit `updates` policy block to `service.json`
- `#122` adds read-only discovery for `github-release` artifact sources
- `#123` adds durable per-service update state under `.state/updates.json`
- `#124` adds operator CLI commands for listing, checking, downloading, and installing update candidates
- `#125` adds runtime API endpoints for status, check, download, and install actions
- `#126` adds an opt-in runtime scheduler for policy-driven notify, download, and install actions
- `#127` adds maintenance-window and running-service safety for update installs
- `#128` surfaces update notifications and bounded update actions in Service Admin

## Manifest Shape

Pinned services do not need an `updates` block. A manifest with `artifact.source.tag` and no active update policy remains pinned.

Example notify-only policy:

```json
{
  "artifact": {
    "kind": "archive",
    "source": {
      "type": "github-release",
      "repo": "service-lasso/lasso-echoservice",
      "tag": "2026.4.20-a417abd"
    },
    "platforms": {
      "win32": {
        "assetName": "echo-service-win32.zip",
        "archiveType": "zip"
      }
    }
  },
  "updates": {
    "enabled": true,
    "mode": "notify",
    "track": "latest",
    "checkIntervalSeconds": 3600
  }
}
```

Example future install policy:

```json
{
  "updates": {
    "enabled": true,
    "mode": "install",
    "track": "latest",
    "checkIntervalSeconds": 3600,
    "installWindow": {
      "days": ["mon", "wed", "fri"],
      "start": "02:00",
      "end": "04:00",
      "timezone": "Australia/Sydney"
    },
    "runningService": "restart"
  }
}
```

## Supported Modes

- `disabled`: do not check for moving releases
- `notify`: check and report availability only
- `download`: download candidates without installing
- `install`: install candidates when policy, maintenance window, and running-service safety allow

Active modes require:

- manifest-owned `artifact` metadata
- `updates.track` set to `latest` or a named release channel/tag
- no `track: "pinned"` for active checks

Install mode additionally requires:

- `installWindow`
- `runningService`

## Discovery Behavior

`checkServiceUpdate` is read-only. It does not download archives, modify `.state`, stop services, or install candidates.

Current status classifications:

- `pinned`: service has no active moving update policy
- `latest`: installed/current tag matches the tracked release
- `update_available`: tracked release differs from the installed/current tag
- `unavailable`: release metadata exists but cannot satisfy the configured platform asset
- `check_failed`: release metadata lookup failed and was returned as structured status

The first source implementation is bounded to `artifact.source.type = "github-release"`.

## Persisted Update State

Service Lasso persists update state separately from active install state:

```text
services/<service-id>/.state/updates.json
```

This file records:

- `lastCheck`: checked time, status, reason, source repo, track, installed tag, manifest tag, and latest tag
- `available`: latest release/candidate metadata from discovery
- `downloadedCandidate`: candidate archive/extract metadata once later download work stores a candidate
- `installDeferred`: operator-facing reason and next eligible time when install must wait
- `failed`: structured failure reason and timestamp

Important boundary:

- `.state/install.json` remains the active installed artifact state
- `.state/updates.json` may describe a newer candidate that has not been installed
- corrupt or missing update state returns an empty installed/no-update view instead of blocking normal lifecycle operations

## CLI Surface

Supported commands:

```bash
service-lasso updates list [--json]
service-lasso updates check [serviceId] [--json]
service-lasso updates download <serviceId> [--json]
service-lasso updates install <serviceId> [--force] [--json]
```

Current behavior:

- `list` reads persisted update state only
- `check` performs read-only release discovery and persists the result
- `download` downloads the candidate archive into `.state/update-candidates/` and records `downloadedCandidate`
- `install` installs a downloaded or resolvable candidate when `updates.mode` is `install`
- `install --force` allows an explicit operator override when policy is not install mode
- human output distinguishes latest, update available, downloaded candidate, deferred install, and failed checks
- JSON output includes machine-readable status, version/source fields, and recommended action for checks

## Runtime API Surface

Supported endpoints:

```text
GET  /api/updates
GET  /api/services/:id/updates
POST /api/updates/check
POST /api/services/:id/update/download
POST /api/services/:id/update/install
```

Current behavior:

- `GET /api/updates` returns persisted update state for all discovered services
- `GET /api/services/:id/updates` returns persisted update state for one service
- `POST /api/updates/check` accepts an optional `{ "serviceId": "<id>" }` body and persists check results
- `POST /api/services/:id/update/download` downloads a candidate without mutating active install metadata
- `POST /api/services/:id/update/install` accepts optional `{ "force": true }`
- invalid request bodies and missing services use the existing API error body shape

## Scheduler Surface

The runtime exposes an opt-in update scheduler through `createRuntimeUpdateScheduler(...)`. The API server can start it with `updateScheduler: true`; it remains disabled unless the host opts in.

Current behavior:

- disabled or pinned update policies are skipped without calling release sources
- `notify` mode checks the release source, persists `.state/updates.json`, and logs update-available or failure messages
- `download` mode downloads the candidate into `.state/update-candidates/` and records `downloadedCandidate`
- `install` mode installs a resolvable candidate through the same install action used by CLI/API update commands
- install-mode scheduler work reports `install_deferred` when a maintenance window or running-service policy blocks installation
- `checkIntervalSeconds` throttles repeated work unless a caller uses `runOnce({ force: true })`
- duplicate in-flight work for the same service is suppressed
- API server start/stop wiring starts and stops the scheduler cleanly when explicitly enabled

## Install Safety

Install-mode updates must pass two safety gates unless the operator uses an explicit force path such as `service-lasso updates install <serviceId> --force`.

Maintenance window behavior:

- `updates.installWindow.start` and `updates.installWindow.end` are evaluated as local time in `updates.installWindow.timezone` when provided
- `updates.installWindow.days` restricts eligible days when provided
- windows that cross midnight are supported
- start and end with the same time means the full allowed day is eligible
- outside-window installs are deferred before candidate download or extraction
- deferred installs persist `installDeferred.reason` and best-effort `nextEligibleAt` in `.state/updates.json`

Running-service behavior:

- `skip` and `require-stopped` defer when the service is currently running
- `stop-start` and `restart` stop the running service, install the candidate, and start it again
- explicit force bypasses the automated running-service safety gate

Current boundary:

- End-to-end update lifecycle proof remains under `#129`

## Service Admin Surface

Service Admin consumes the same bounded update API/state as app hosts and the CLI.

Current behavior:

- dashboard cards show a global update notification banner when persisted state reports available, downloaded, deferred, or failed update work
- service cards, the services table, and service detail show per-service update badges and descriptions
- supported states are `installed`, `available`, `downloadedCandidate`, `installDeferred`, and `failed`
- service detail exposes allowed check, download, and install buttons that call `POST /api/updates/check`, `POST /api/services/:id/update/download`, and `POST /api/services/:id/update/install`
- Service Admin keeps update action wiring bounded to the runtime API and does not shell out to the CLI

Evidence:

- `service-lasso/lasso-serviceadmin#12` merged the UI slice
- `npm test`, `npm run build`, and `npm run lint` passed locally in the Service Admin repo before merge

## Follow-On Issues

- `#129`: end-to-end update verification

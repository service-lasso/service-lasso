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
- no scheduler, maintenance-window engine, or Service Admin notification is enabled by these slices alone

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
- `download`: future mode for downloading candidates without installing
- `install`: future mode for installing during an approved window

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

Deferred behavior:

- scheduled checking remains under `#126`
- maintenance-window/running-service safety remains under `#127`
- Service Admin notifications remain under `#128`

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

## Follow-On Issues

- `#126`: policy-driven scheduler
- `#127`: install windows and running-service safety
- `#128`: Service Admin notifications
- `#129`: end-to-end update verification

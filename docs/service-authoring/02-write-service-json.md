---
id: 02-write-service-json
title: 2. Write service.json
---

# 2. Write `service.json`

`service.json` is the only manifest Service Lasso should need to acquire, configure, start, monitor, and update a service.

## Minimum Manifest Contract

Every release-backed service manifest should define:

- `id`
- `name`
- `description`
- `version`
- `enabled`
- `artifact.kind: "archive"`
- `artifact.source.type: "github-release"`
- `artifact.source.repo`
- `artifact.source.tag`
- `artifact.platforms.<platform>.assetName`
- `artifact.platforms.<platform>.archiveType`
- `artifact.platforms.<platform>.command` when the archive exposes an executable

Use [service.json Reference](../reference/service-json-reference.md) for field-level detail.

## Add Runtime Behavior

Managed services usually also need:

- `ports` for named service ports
- `urls` for operator-facing links
- `healthcheck` for process, HTTP, TCP, file, or variable readiness
- `env` for service-local runtime values
- `globalenv` for values other services can consume
- `depend_on` for startup ordering
- `install.files` or `config.files` when Service Lasso must write config files

Provider services usually need:

- `role: "provider"`
- `globalenv` entries that expose installed tool paths
- a cheap probe/version command where useful
- no long-running daemon healthcheck unless the provider truly starts a process

## Pin the Release

The manifest must point to a real release asset:

```json
{
  "artifact": {
    "kind": "archive",
    "source": {
      "type": "github-release",
      "repo": "service-lasso/lasso-example",
      "tag": "2026.4.29-abc1234"
    }
  }
}
```

The release tag uses `yyyy.m.d-<shortsha>`. Artifact names should include the exact upstream service, runtime, framework, or tool version.

## Exit Criteria

Move to step 3 only when:

- `service.json` can identify the exact GitHub release asset to download
- commands, env, dependencies, ports, and health checks match the planned service shape
- the manifest can be copied into `services/<service-id>/service.json` without needing a second hidden metadata file

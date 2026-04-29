---
id: 04-wire-consumers
title: 4. Wire Consumers
---

# 4. Wire Consumers

After a service has a release-backed manifest, consuming projects opt in by committing that manifest under their `services/` folder.

## Consumer Layout

Use this layout:

```text
consumer-app/
  services/
    <service-id>/
      service.json
```

Examples:

```text
services/@node/service.json
services/@serviceadmin/service.json
services/echo-service/service.json
```

The folder name must match the manifest `id`.

## What the Manifest Must Contain

The consuming app should not need a separate `release-source.json` or hidden metadata file. The service manifest must already contain enough information for Service Lasso to acquire the service archive from GitHub releases.

For bundled release outputs, the packaging step runs Service Lasso package/acquire first and includes the downloaded service archives in the release artifact. At runtime, the bundled output should not need to download those services again.

## Baseline and Reference Apps

Core baseline services live in this repo's `services/` folder. Reference apps should include the services they demonstrate, commonly including `echo-service` and `@serviceadmin`.

## Exit Criteria

Move to step 5 only when:

- each consumer has `services/<service-id>/service.json`
- manifests point at real service repo releases
- dependency services are included in the consumer when needed
- bundled outputs are configured to include acquired archives when the artifact is meant to run without downloads

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

The consuming app should only need the service manifest. That `service.json` must already contain enough information for Service Lasso to acquire the service archive from GitHub releases.

For bundled release outputs, the packaging step runs Service Lasso package/acquire first and includes the downloaded service archives in the release artifact. At runtime, the bundled output should not need to download those services again.

## Import a Released Manifest

Use the CLI import flow when the add-on repo publishes `service.json` as a release asset:

```powershell
node dist/cli.js services import service-lasso/lasso-dagu --tag 2026.5.22-example --services-root ./services --dry-run --json
node dist/cli.js services import service-lasso/lasso-dagu --tag 2026.5.22-example --services-root ./services
```

The command downloads and validates only the released manifest, writes it to `services/<service-id>/service.json`, and leaves service enablement, setup, secrets, install, and start decisions to the consuming app/operator. Existing manifests are protected by default; use `--force` only when replacing a manifest intentionally.

## Baseline and Reference Apps

Core baseline services live in this repo's `services/` folder. Reference apps should include the services they demonstrate, commonly including `echo-service` and `@serviceadmin`.

## Exit Criteria

Move to step 5 only when:

- each consumer has `services/<service-id>/service.json`
- manifests point at real service repo releases
- dependency services are included in the consumer when needed
- bundled outputs are configured to include acquired archives when the artifact is meant to run without downloads

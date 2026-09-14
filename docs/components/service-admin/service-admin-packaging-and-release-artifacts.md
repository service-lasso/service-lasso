---
title: Service Admin Packaging and Release Artifacts
description: How Service Admin is packaged, installed, started, and checked as the @serviceadmin managed service.
status: metadata-only
tags: ["packaging", "release", "service-admin", "managed-service"]
---

# Service Admin Packaging and Release Artifacts

Service Admin is the Service Lasso operator UI, and it is also a managed service
package with the stable service id `@serviceadmin`. Treat it like any other
Service Lasso service when you inspect its manifest, install path, lifecycle
actions, runtime logs, and health evidence.

Use this guide when you need to explain how Service Admin is delivered or when
Service Admin itself fails to install, start, update, or verify.

## What the release contains

Release packaging separates the deployable UI/runtime payload from the service
manifest so operators can inspect identity and lifecycle metadata without
unpacking an app archive.

| Artifact | Purpose | Operator check |
| --- | --- | --- |
| Platform archive | Deployable Service Admin UI and runtime content for a target platform, such as Windows, Linux, or macOS. | The archive matches the host platform and expands into the expected service install path. |
| `service.json` | Canonical Service Lasso manifest for `@serviceadmin`. | The manifest id is `@serviceadmin`, actions are present, and runtime execution points at the packaged runtime content. |
| Checksums | Integrity evidence for release assets when the release publishes them. | Downloaded archives and manifest assets match the published checksum file before install or update. |

The archive is the runnable payload. The manifest is the service contract that
Service Lasso discovers and presents in Service Admin. Keep those roles separate
when you compare releases, support bundles, and installed-service metadata.

For repository-level packaging details, start with [`docs/packaging.md`](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/packaging.md)
and the Packaging and release section in [`README.md`](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/README.md). Use the
main Service Lasso runtime repo when you need runtime installer behavior,
services-root layout, release-backed service package discovery, or lifecycle API
details.

## How Service Lasso manages Service Admin

Service Lasso installs, configures, starts, stops, and verifies `@serviceadmin`
through the same service-management flow used for other packages.

1. Runtime discovery finds the `@serviceadmin` `service.json` in the configured
   services root or release-backed package location.
2. Install or update places the platform payload in the service install path and
   keeps generated config, logs, data, and work material in their runtime-owned
   paths.
3. The config action materializes effective runtime configuration from
   non-sensitive settings and secret references.
4. The start action runs the packaged Service Admin runtime content.
5. The stop action shuts down the Service Admin runtime.
6. Health and runtime verification prove the UI process and configured endpoint
   are usable.

Because Service Admin is itself a managed service, a Service Admin outage does
not mean Service Lasso service state is lost. Use runtime logs, the services
root, and release artifacts as the source of truth when the UI cannot load.

## Manifest versus deployable content

Do not confuse these two pieces of evidence:

| Evidence | Answers | Does not answer |
| --- | --- | --- |
| `service.json` | What Service Lasso should call the service, which actions exist, which provider runs it, which port it uses, and how basic health is checked. | Whether the UI archive was downloaded, extracted, or started successfully on this machine. |
| Platform archive | Which files are available to run the Service Admin UI on a target platform. | Whether Service Lasso discovered the intended manifest or generated local config correctly. |

When an operator reports an update problem, check both sides. A correct archive
with a stale manifest can show the wrong identity or action contract. A correct
manifest with a missing or mismatched archive can discover `@serviceadmin` but
fail at install, start, or health verification.

## Relationship to release-backed service packages

Service Admin packaging should stay aligned with Service Lasso's release-backed
package model:

- the service id remains `@serviceadmin`
- release assets are versioned and can be checked before install
- the manifest describes the service contract consumed by the runtime
- install and config actions prepare local machine state without exposing raw
  credentials
- start, stop, logs, and health evidence flow through the same runtime boundary
  as other managed services

Keep Help Center guidance operator-focused. Link to packaging references instead
of copying every script detail into this article. Use the runtime repo for
changes to how Service Lasso downloads, verifies, installs, or upgrades
release-backed packages.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Service Admin does not appear as an installed service | Confirm the services root contains the intended `@serviceadmin` folder and `service.json`, then reload runtime discovery. |
| Install or update completes but the UI does not start | Check that the platform archive was extracted into the install path expected by the manifest, then inspect Runtime and Logs for `@serviceadmin`. |
| The UI starts on the wrong port | Compare `service.json` `execconfig.serviceport`, generated runtime config, and any proxy route metadata. |
| The manifest looks correct but files are missing | Re-run the install/update path after verifying release checksums and target platform. |
| The UI loads but same-origin API calls fail | Check the Service Admin runtime proxy and the Service Lasso runtime health endpoint before changing UI code. |
| Update evidence is unclear | Record release version, manifest path, install path, checksum result, operation id, log path, and health result. Do not paste raw secrets or local credential values. |

For broader operator triage, use [Service Install and Setup Config](service-install-and-setup-config.md),
[Runtime and Logs Operator Runbook](runtime-and-logs-operator-runbook.md), and
[Health Checks](health-checks.md).

---

[Component guides](../README.md) · Imported from [lasso-serviceadmin](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/help/service-admin-packaging-and-release-artifacts.md). The [migration inventory](../documentation-migration.md) records ownership and remaining work.

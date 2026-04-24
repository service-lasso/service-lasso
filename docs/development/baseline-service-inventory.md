# Baseline Service Inventory

Date: 2026-04-24

Linked issue: `#97`

OpenSpec binding: `SPEC-002`, `AC-4U`, `AC-4Y`, `AC-4Z`

## Purpose

The clean-clone baseline start path expects the core `services/` root to describe the services that Service Lasso should acquire, configure, and start.

Expected baseline IDs:

- `@traefik`
- `@node`
- `echo-service`
- `service-admin`

## Current Core Classification

| Service | Current classification | Download behavior |
| --- | --- | --- |
| `@node` | Local/no-download runtime provider. Uses the Node executable that is already running Service Lasso. | No download. |
| `@traefik` | Deferred baseline edge/router placeholder. The manifest exists so dependency/inventory scans are honest, but it is disabled until a canonical release-backed Traefik service repo/artifact exists. | No download yet. |
| `echo-service` | Release-backed managed harness plus checked-in core fixture. The manifest has release artifact metadata for install/acquire while preserving the local fixture path used by core runtime tests. | Downloads from `service-lasso/lasso-echoservice@2026.4.20-a417abd` during install. |
| `service-admin` | Release-backed operator UI service. | Downloads from `service-lasso/lasso-serviceadmin@2026.4.18-170a1af` during install. |

## Remaining Gap

This does not complete the full clean-clone start use case yet.

Remaining issues:

- `#98`: add the command that installs/configures/starts the baseline services in one flow.
- `#99`: add deterministic clean-clone smoke coverage for that flow.
- A future Traefik service issue is still needed if `@traefik` must become a real release-backed service instead of a disabled placeholder.

## Verification Target

For this inventory slice:

- manifest discovery must find all four baseline IDs
- release-backed manifests must include `artifact` metadata
- local/no-download services must be explicitly classified
- `service-lasso install echo-service` and `service-lasso install service-admin` must acquire their configured release artifacts

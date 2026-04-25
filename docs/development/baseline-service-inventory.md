# Baseline Service Inventory

Date: 2026-04-24

Linked issues: `#97`, `#102`

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
| `@traefik` | Release-backed baseline edge/router service. | Downloads from `service-lasso/lasso-traefik@2026.4.25-5301df9` during install. |
| `echo-service` | Release-backed managed harness plus checked-in core fixture. The manifest has release artifact metadata for install/acquire while preserving the local fixture path used by core runtime tests. | Downloads from `service-lasso/lasso-echoservice@2026.4.20-a417abd` during install. |
| `service-admin` | Release-backed operator UI service. | Downloads from `service-lasso/lasso-serviceadmin@2026.4.18-170a1af` during install. |

## Remaining Gap

This does not complete the full clean-clone start use case yet.

Remaining issues:

- `#91`: align the canonical reference-app/service-template inventories with the baseline decision.
- `#89`: add deterministic live reference-app lifecycle smoke.
- `#58`: finish end-to-end release readiness and fresh consumer validation.

## Verification Target

For this inventory slice:

- manifest discovery must find all four baseline IDs
- release-backed manifests must include `artifact` metadata
- local/no-download services must be explicitly classified
- `service-lasso install @traefik`, `service-lasso install echo-service`, and `service-lasso install service-admin` must acquire their configured release artifacts

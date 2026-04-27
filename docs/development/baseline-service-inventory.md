# Baseline Service Inventory

Date: 2026-04-25

Latest update: 2026-04-27

Linked issues: `#89`, `#91`, `#97`, `#102`, `#158`, `#159`, `#171`, `#172`, `#185`, `#187`

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
| `@node` | Release-backed runtime provider with `role: "provider"`. Baseline start installs/configures it, skips managed daemon start, and reports provider health once installed/configured. | Downloads from `service-lasso/lasso-node@2026.4.27-13573bd` during install. |
| `@traefik` | Release-backed baseline edge/router service with HTTP `/ping` readiness plus local `env` and shared `globalenv` outputs for Traefik ports and URLs. | Downloads from `service-lasso/lasso-traefik@2026.4.27-40bc7cb` during install. |
| `echo-service` | Release-backed managed harness plus checked-in core fixture. The manifest has release artifact metadata for install/acquire while preserving the local fixture path used by core runtime tests. | Downloads from `service-lasso/lasso-echoservice@2026.4.20-a417abd` during install. |
| `service-admin` | Release-backed operator UI service. | Downloads from `service-lasso/lasso-serviceadmin@2026.4.18-170a1af` during install. |

## Remaining Gap

The scoped baseline inventory is aligned across core, service-template, and canonical reference apps. Live reference-app lifecycle proof is covered by `npm run verify:reference-app-lifecycle`.

Issue `#159` closed the provider-state ambiguity for the core baseline: `@node` is not expected to stay `running=true`; its expected state is installed/configured, start skipped, provider health true. Issue `#172` moves `@node` from local/no-download to a pinned release-backed provider while preserving that non-daemon lifecycle behavior.

Remaining issues:

- `#58`: finish end-to-end release readiness and fresh consumer validation.

## Verification Target

For this inventory slice:

- manifest discovery must find all four baseline IDs
- release-backed manifests must include `artifact` metadata
- provider services must be explicitly classified with `role: "provider"` when they are runtime providers rather than managed daemons
- `service-lasso install @node`, `service-lasso install @traefik`, `service-lasso install echo-service`, and `service-lasso install service-admin` must acquire their configured release artifacts
- `npm run verify:reference-app-lifecycle` must fresh-clone the canonical reference apps and prove host/admin/runtime readiness plus Echo Service install/config/start/stop through each app-owned runtime

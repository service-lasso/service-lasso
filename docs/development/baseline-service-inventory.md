# Baseline Service Inventory

Date: 2026-04-25

Latest update: 2026-04-28

Linked issues: `#89`, `#91`, `#97`, `#102`, `#158`, `#159`, `#171`, `#172`, `#185`, `#187`, `#189`, `#191`, `#193`, `#195`, `#198`, `#201`

OpenSpec binding: `SPEC-002`, `AC-4U`, `AC-4Y`, `AC-4Z`

## Purpose

The clean-clone baseline start path expects the core `services/` root to describe the services that Service Lasso should acquire, configure, and start.

Expected baseline IDs:

- `@traefik`
- `localcert`
- `nginx`
- `@node`
- `echo-service`
- `service-admin`

## Current Core Classification

| Service | Current classification | Download behavior |
| --- | --- | --- |
| `@node` | Release-backed runtime provider with `role: "provider"`. Baseline start installs/configures it, skips managed daemon start, and reports provider health once installed/configured. | Downloads from `service-lasso/lasso-node@2026.4.27-13573bd` during install. |
| `localcert` | Core provider-role local certificate utility service required by Traefik. Baseline start installs/configures it and skips daemon launch until fuller certificate materialization is implemented. | No download yet; local/no-download core utility manifest. |
| `nginx` | Release-backed NGINX Open Source managed service required by Traefik. Baseline start installs/configures it, starts it before Traefik, and verifies HTTP `/health`. | Downloads from `service-lasso/lasso-nginx@2026.4.27-712c75f` during install. |
| `@traefik` | Release-backed baseline edge/router service with `depend_on: ["localcert", "nginx"]`, donor-style `commandline`, HTTP `/ping` readiness plus local `env`, shared `globalenv`, and donor-compatible `portmapping` outputs for the full Traefik service-port map. | Downloads from `service-lasso/lasso-traefik@2026.4.27-bbc7f15` during install. |
| `echo-service` | Release-backed managed harness plus checked-in core fixture. The manifest has release artifact metadata for install/acquire while preserving the local fixture path used by core runtime tests. | Downloads from `service-lasso/lasso-echoservice@2026.4.20-a417abd` during install. |
| `service-admin` | Core release-backed operator/admin UI service. | Downloads from `service-lasso/lasso-serviceadmin@2026.4.18-170a1af` during install. |

## Remaining Gap

The scoped baseline inventory is aligned across core, service-template, and canonical reference apps. Live reference-app lifecycle proof is covered by `npm run verify:reference-app-lifecycle`.

Issue `#159` closed the provider-state ambiguity for the core baseline: `@node` is not expected to stay `running=true`; its expected state is installed/configured, start skipped, provider health true. Issue `#172` moves `@node` from local/no-download to a pinned release-backed provider while preserving that non-daemon lifecycle behavior. Issue `#195` adds the missing `localcert` and `nginx` baseline dependency manifests so Traefik can declare the donor-aligned dependency graph without breaking startup. Issue `#198` promotes `nginx` from a marker into the release-backed `service-lasso/lasso-nginx@2026.4.27-712c75f` managed service. Issue `#201` makes the core-service classification explicit for `localcert` and `service-admin` without changing their stable service IDs.

Remaining issues:

- `#58`: finish end-to-end release readiness and fresh consumer validation.

## Verification Target

For this inventory slice:

- manifest discovery must find all six baseline IDs
- release-backed manifests must include `artifact` metadata
- provider services must be explicitly classified with `role: "provider"` when they are runtime providers rather than managed daemons
- `service-lasso start` must install/configure `localcert`, install/configure/start `nginx`, and then start `@traefik`
- `service-lasso install @node`, `service-lasso install @traefik`, `service-lasso install echo-service`, and `service-lasso install service-admin` must acquire their configured release artifacts
- `npm run verify:reference-app-lifecycle` must fresh-clone the canonical reference apps and prove host/admin/runtime readiness plus Echo Service install/config/start/stop through each app-owned runtime

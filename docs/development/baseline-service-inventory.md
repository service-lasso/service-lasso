# Baseline Service Inventory

Date: 2026-04-25

Latest update: 2026-04-28

Linked issues: `#89`, `#91`, `#97`, `#102`, `#158`, `#159`, `#171`, `#172`, `#185`, `#187`, `#189`, `#191`, `#193`, `#195`, `#198`, `#201`, `#204`, `#207`, `#210`

OpenSpec binding: `SPEC-002`, `AC-4U`, `AC-4Y`, `AC-4Z`

## Purpose

The clean-clone baseline start path expects the core `services/` root to describe the services that Service Lasso should acquire, configure, and start.

Expected baseline IDs:

- `@traefik`
- `@localcert`
- `@nginx`
- `@node`
- `echo-service`
- `@serviceadmin`

## Current Core Classification

| Service | Current classification | Download behavior |
| --- | --- | --- |
| `@node` | Release-backed runtime provider with `role: "provider"`. Baseline start installs/configures it, skips managed daemon start, and reports provider health once installed/configured. | Downloads from [`service-lasso/lasso-node`](https://github.com/service-lasso/lasso-node) release `2026.4.27-eca215a` during install. |
| `@localcert` | Release-backed core provider-role local certificate utility service required by Traefik. Baseline start installs/configures it, exports certificate globals, and skips daemon launch. | Downloads from [`service-lasso/lasso-localcert`](https://github.com/service-lasso/lasso-localcert) release `2026.4.27-591ed28` during install. |
| `@nginx` | Release-backed NGINX Open Source managed service required by Traefik. Baseline start installs/configures it, starts it before Traefik, and verifies HTTP `/health`. | Downloads from [`service-lasso/lasso-nginx`](https://github.com/service-lasso/lasso-nginx) release `2026.4.27-712c75f` during install. |
| `@traefik` | Release-backed baseline edge/router service with `depend_on: ["@localcert", "@nginx"]`, platform-specific `commandline`, HTTP `/ping` readiness plus local `env`, shared `globalenv`, and `portmapping` outputs for the full Traefik service-port map. | Downloads from [`service-lasso/lasso-traefik`](https://github.com/service-lasso/lasso-traefik) release `2026.4.27-bbc7f15` during install. |
| `echo-service` | Release-backed managed harness plus checked-in core fixture. The manifest has release artifact metadata for install/acquire while preserving the local fixture path used by core runtime tests. | Downloads from [`service-lasso/lasso-echoservice`](https://github.com/service-lasso/lasso-echoservice) release `2026.4.20-a417abd` during install. |
| `@serviceadmin` | Core release-backed operator/admin UI service. | Downloads from [`service-lasso/lasso-serviceadmin`](https://github.com/service-lasso/lasso-serviceadmin) release `2026.4.18-170a1af` during install. |

## Remaining Gap

The scoped baseline inventory is aligned across core, service-template, and canonical reference apps. Live reference-app lifecycle proof is covered by `npm run verify:reference-app-lifecycle`.

The baseline inventory is release-backed and uses the core-owned `@` prefix convention for runtime providers and core infrastructure services. Provider-role services install/configure and expose their env contract without pretending to be long-running daemons. Managed services such as `@nginx`, `@traefik`, `echo-service`, and `@serviceadmin` can be acquired and started by the runtime.

Remaining issues:

- `#58`: finish end-to-end release readiness and fresh consumer validation.

Optional service repo now available:

- `#207`: [`service-lasso/lasso-zitadel`](https://github.com/service-lasso/lasso-zitadel) publishes release-backed ZITADEL `v4.14.0` archives for consumers that explicitly add `services/zitadel/service.json`; it is not part of this baseline because it requires app-owned PostgreSQL and `ZITADEL_MASTERKEY` configuration.
- `#210`: [`service-lasso/lasso-dagu`](https://github.com/service-lasso/lasso-dagu) publishes release-backed Dagu `v2.6.1` archives for consumers that explicitly add `services/dagu/service.json`; it is not part of this baseline because workflow orchestration is app-specific.

## Verification Target

For this inventory slice:

- manifest discovery must find all six baseline IDs
- release-backed manifests must include `artifact` metadata
- provider services must be explicitly classified with `role: "provider"` when they are runtime providers rather than managed daemons
- `service-lasso start` must install/configure `@localcert`, install/configure/start `@nginx`, and then start `@traefik`
- `service-lasso install @localcert`, `service-lasso install @node`, `service-lasso install @traefik`, `service-lasso install echo-service`, and `service-lasso install @serviceadmin` must acquire their configured release artifacts
- `npm run verify:reference-app-lifecycle` must fresh-clone the canonical reference apps and prove host/admin/runtime readiness plus Echo Service install/config/start/stop through each app-owned runtime

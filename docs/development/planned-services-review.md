# Planned Services Review

This review records the service inventory currently implied by the core docs, donor material, `service-template`, and canonical reference app repos.

Date: 2026-04-27

Linked issues: `#89`, `#91`, `#93`, `#97`, `#102`, `#169`, `#170`, `#171`

## Summary

The current planned baseline service inventory is aligned across the scoped core/template/reference repos, and the live reference-app lifecycle smoke now proves the baseline can be exercised through each app-owned runtime. Java has moved from donor/reference-only material into a bounded local/no-download core provider, while release-backed JRE redistribution remains an explicit future decision.

Docs and `service-template` identify this baseline for app/reference repos:

- `services/echo-service/service.json`
- `services/service-admin/service.json`
- `services/@node/service.json`
- `services/@traefik/service.json`

The prior inventory gap is now closed for the scoped reference repos: `service-template`, `service-lasso-app-node`, `service-lasso-app-web`, `service-lasso-app-electron`, `service-lasso-app-tauri`, and `service-lasso-app-packager-pkg` carry `echo-service`, `service-admin`, `@node`, and release-backed `@traefik`.

The live source-host proof is also closed: `npm run verify:reference-app-lifecycle` fresh-clones all five canonical app repos and verifies host shell, mounted Service Admin route, app-owned runtime service discovery, Echo Service install/config/start/stop, and process cleanup.

Python and Java remain optional provider services rather than starter baseline dependencies today. Release-backed provider repos now exist for both, but the checked-in core manifests remain local/no-download until the deliberate integration issue `#172` updates and verifies them.

## Service Status

| Service | Role | Current status | Gap |
| --- | --- | --- | --- |
| `echo-service` | Real managed harness/service for install, lifecycle, logs, state, SQLite, HTTP/TCP health, and UI validation. | Implemented and released in `service-lasso/lasso-echoservice`; used by core and all reference apps. | No baseline gap. |
| `service-admin` | Operator/admin UI entry for app hosts. | Implemented in `service-lasso/lasso-serviceadmin`; release-backed manifest exists in core `services/service-admin/service.json`; all reference apps include `services/service-admin/service.json`; live app-host smoke verifies the mounted admin route. | No current baseline gap. |
| `@node` | Runtime/provider utility service for Node-backed services and Service Admin dependency modeling. | Implemented as a bounded local/no-download provider path in core; manifest exists in core, service-template, and all scoped reference-app `services/@node/service.json` inventories. | No current baseline gap; explicitly classified as local/no-download until a separate runtime-distribution requirement exists. |
| `@python` | Runtime/provider utility service for Python-backed services. | Core manifest exists in `services/@python/service.json` as a local/no-download provider. Release-backed repo `service-lasso/lasso-python` exists with Windows-only official Python.org embeddable archives for `3.11.5` and `3.14.4`. | Not part of the current starter baseline. Core/reference manifest integration remains tracked by `#172`; Linux/macOS Python archives remain deferred pending an approved portable distribution source. |
| `@java` | Runtime/provider utility service for Java/JVM-backed services. | Core manifest exists in `services/@java/service.json` as a bounded local/no-download provider; provider resolution supports `execservice: "@java"`; release-backed repo `service-lasso/lasso-java` exists with Eclipse Temurin JRE archives for Java `17.0.18+8` and `21.0.10+7`. | Not part of the current starter baseline. Core/reference manifest integration remains tracked by `#172`; Java-dependent services such as Keycloak should wait for that integration. |
| `@traefik` | Edge/router utility service for local routing and Service Admin dependency modeling. | Release-backed core manifest exists in `services/@traefik/service.json` and points at `service-lasso/lasso-traefik@2026.4.27-354433e`; manifest exists in service-template and all scoped reference-app inventories; docs list it in starter baseline. | No current baseline gap. |
| `@archive` | Future utility/archive provider based on donor/reference docs. | Discussed in service-template reference material only. | Future/deferred; not current baseline. |
| `@localcert` | Future local certificate/bootstrap utility based on donor/reference docs. | Discussed in service-template reference material only. | Future/deferred; not current baseline. |

## Repo Inventory Snapshot

Core repo currently has:

- `services/echo-service/service.json`
- `services/@node/service.json`
- `services/@java/service.json`
- `services/@python/service.json`
- `services/node-sample-service/service.json`
- `services/service-admin/service.json`
- `services/@traefik/service.json`

Core repo does not currently have:

- `services/@archive/service.json`
- `services/@localcert/service.json`

`service-template` currently has:

- root `service.json`
- `services/echo-service/service.json`
- `services/service-admin/service.json`
- `services/@node/service.json`
- `services/@traefik/service.json`

Each canonical reference app currently has:

- `services/echo-service/service.json`
- `services/service-admin/service.json`
- `services/@node/service.json`
- `services/@traefik/service.json`

Affected reference apps:

- `service-lasso-app-node`
- `service-lasso-app-web`
- `service-lasso-app-electron`
- `service-lasso-app-tauri`
- `service-lasso-app-packager-pkg`

## Recommendation

Issue `#91` is complete for the scoped starter/template repos. The baseline inventory is now aligned and validated across the current repo set.

Issue `#93` now has a bounded core implementation and explicit future release-backed JRE plan:

- donor `_java` service metadata and runtime expectations are recorded in `docs/development/java-runtime-service-plan.md`
- canonical `@java` service identity is `services/@java/service.json`
- `@java` is local/no-download today, not part of the starter baseline
- a dedicated `service-lasso/lasso-java` repo now exists and has release `2026.4.27-b313cb0`
- provider tests prove the runtime can route and manage a service through `execservice: "@java"`
- dependent services such as Keycloak should be migrated only after the verified `@java` release is integrated into core/reference manifests

Issue `#169` now has a release-backed Python provider repo:

- repo `service-lasso/lasso-python`
- release `2026.4.27-63f915c`
- first release supports Windows official Python.org embeddable archives only
- checked-in core manifest integration remains `#172`

## Completion Plan

Core completion should proceed in this order:

1. Close `#58` release-readiness after promotion evidence is current.
2. Integrate verified release-backed `@node`, `@python`, and `@java` manifests through `#172` where they belong in core/reference inventories.
3. Only after the runtime services are proven, plan dependent app/service migrations such as Keycloak so they consume released runtime services instead of inheriting donor assumptions.

## Remaining Planned Services

Future/deferred donor-aligned utility services:

- `@archive`
- `@localcert`
- Linux/macOS `@python` portable runtime distribution beyond the current Windows-only release-backed provider repo

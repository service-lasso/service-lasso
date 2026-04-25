# Planned Services Review

This review records the service inventory currently implied by the core docs, donor material, `service-template`, and canonical reference app repos.

Date: 2026-04-25

Linked issues: `#89`, `#91`, `#93`, `#97`, `#102`

## Summary

The current planned baseline service inventory is aligned across the scoped core/template/reference repos, and the live reference-app lifecycle smoke now proves the baseline can be exercised through each app-owned runtime. The remaining donor-aligned core runtime service inventory gap is Java.

Docs and `service-template` identify this baseline for app/reference repos:

- `services/echo-service/service.json`
- `services/service-admin/service.json`
- `services/@node/service.json`
- `services/@traefik/service.json`

The prior inventory gap is now closed for the scoped reference repos: `service-template`, `service-lasso-app-node`, `service-lasso-app-web`, `service-lasso-app-electron`, `service-lasso-app-tauri`, and `service-lasso-app-packager-pkg` carry `echo-service`, `service-admin`, `@node`, and release-backed `@traefik`.

The live source-host proof is also closed: `npm run verify:reference-app-lifecycle` fresh-clones all five canonical app repos and verifies host shell, mounted Service Admin route, app-owned runtime service discovery, Echo Service install/config/start/stop, and process cleanup.

Java is a separate core-completion gap rather than a starter baseline dependency today. Donor/reference material includes `_java`, docs describe Java-backed apps through `execservice: java`, and donor notes identify Keycloak as a Java-backed service, but core currently has no `@java` manifest, service repo, release artifact, or runtime proof.

## Service Status

| Service | Role | Current status | Gap |
| --- | --- | --- | --- |
| `echo-service` | Real managed harness/service for install, lifecycle, logs, state, SQLite, HTTP/TCP health, and UI validation. | Implemented and released in `service-lasso/lasso-echoservice`; used by core and all reference apps. | No baseline gap. |
| `service-admin` | Operator/admin UI entry for app hosts. | Implemented in `service-lasso/lasso-serviceadmin`; release-backed manifest exists in core `services/service-admin/service.json`; all reference apps include `services/service-admin/service.json`; live app-host smoke verifies the mounted admin route. | No current baseline gap. |
| `@node` | Runtime/provider utility service for Node-backed services and Service Admin dependency modeling. | Implemented as a bounded local/no-download provider path in core; manifest exists in core, service-template, and all scoped reference-app `services/@node/service.json` inventories. | No current baseline gap; explicitly classified as local/no-download until a separate runtime-distribution requirement exists. |
| `@python` | Runtime/provider utility service for Python-backed services. | Manifest exists in core `services/@python/service.json`; docs mention provider planning. | Not part of the current starter baseline, but should be explicitly classified as optional/future for app inventories. |
| `@java` | Runtime/provider utility service for Java/JVM-backed services. | Donor source exists at `ref/typerefinery-service-manager-donor/services/_java`; docs mention Java apps through `execservice: java`; donor Keycloak notes depend on Java. | No core `services/@java/service.json`, no dedicated service repo, no release pipeline/artifact, no install/acquire proof, and no Java-backed runtime/provider proof. Tracked by issue `#93`. |
| `@traefik` | Edge/router utility service for local routing and Service Admin dependency modeling. | Release-backed core manifest exists in `services/@traefik/service.json` and points at `service-lasso/lasso-traefik@2026.4.25-5301df9`; manifest exists in service-template and all scoped reference-app inventories; docs list it in starter baseline. | No current baseline gap. |
| `@archive` | Future utility/archive provider based on donor/reference docs. | Discussed in service-template reference material only. | Future/deferred; not current baseline. |
| `@localcert` | Future local certificate/bootstrap utility based on donor/reference docs. | Discussed in service-template reference material only. | Future/deferred; not current baseline. |

## Repo Inventory Snapshot

Core repo currently has:

- `services/echo-service/service.json`
- `services/@node/service.json`
- `services/@python/service.json`
- `services/node-sample-service/service.json`
- `services/service-admin/service.json`
- `services/@traefik/service.json`

Core repo does not currently have:

- `services/@java/service.json`
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

Resolve issue `#93` before claiming donor-aligned core runtime service planning is complete. Java should be handled as a core runtime/provider service migration:

- analyze donor `_java` service metadata and runtime expectations
- define the canonical `@java` `service.json` contract or document an explicit deferral decision
- create a dedicated Java runtime service repo if the established service-repo model remains correct
- add release artifacts and pipeline behavior using `yyyy.m.d-<shortsha>`
- prove Service Lasso can acquire/install the Java runtime service without starting it
- prove at least one bounded Java-backed execution/provider scenario before migrating Java-dependent services such as Keycloak

## Completion Plan

Core completion should proceed in this order:

1. Finish core runtime service inventory tracking under `#93`: promote Java from donor/reference-only material into an explicit `@java` manifest/repo/release/runtime-proof plan, or record a deliberate deferral.
2. Close `#58` release-readiness after the Java decision/proof and promotion evidence are current.
3. Decide the next donor-aligned runtime utility wave after baseline closure: `@python` provider depth, `@archive`, and `@localcert`.
4. Only after the runtime services are proven, plan dependent app/service migrations such as Keycloak so they consume released runtime services instead of inheriting donor assumptions.

## Remaining Planned Services

Current donor-aligned runtime service gap:

- `@java`

Future/deferred donor-aligned utility services:

- `@archive`
- `@localcert`
- `@python` beyond the current bounded manifest/provider planning

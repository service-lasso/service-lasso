# Planned Services Review

This review records the service inventory currently implied by the core docs, donor material, `service-template`, and canonical reference app repos.

Date: 2026-04-24

Linked issues: `#91`, `#93`, `#97`, `#102`

## Summary

The current planned baseline service inventory is not fully aligned across repos, and the donor-aligned core runtime service inventory is not fully tracked yet.

Docs and `service-template` identify this baseline for app/reference repos:

- `services/echo-service/service.json`
- `services/service-admin/service.json`
- `services/@node/service.json`
- `services/@traefik/service.json`

Current canonical reference app repos only include:

- `services/echo-service/service.json`
- `services/service-admin/service.json`

This is a real gap because `service-template/services/service-admin/service.json` declares `depend_on: ["@node", "@traefik"]`, while the app repos that include `service-admin` do not carry those dependency manifests.

Java is a separate core-completion gap rather than a starter baseline dependency today. Donor/reference material includes `_java`, docs describe Java-backed apps through `execservice: java`, and donor notes identify Keycloak as a Java-backed service, but core currently has no `@java` manifest, service repo, release artifact, or runtime proof.

## Service Status

| Service | Role | Current status | Gap |
| --- | --- | --- | --- |
| `echo-service` | Real managed harness/service for install, lifecycle, logs, state, SQLite, HTTP/TCP health, and UI validation. | Implemented and released in `service-lasso/lasso-echoservice`; used by core and all reference apps. | No baseline gap. |
| `service-admin` | Operator/admin UI entry for app hosts. | Implemented in `service-lasso/lasso-serviceadmin`; release-backed manifest exists in core `services/service-admin/service.json`; all reference apps include `services/service-admin/service.json`. | Needs fresh canonical repo/pipeline validation before final release-readiness closure; full clean-clone orchestration remains under `#98` / `#99`. |
| `@node` | Runtime/provider utility service for Node-backed services and Service Admin dependency modeling. | Implemented as a bounded local/no-download provider path in core; manifest exists in core `services/@node/service.json` and `service-template/services/@node/service.json`. | Missing from all canonical reference app `services/` inventories; explicitly classified as local/no-download until a separate runtime-distribution requirement exists. |
| `@python` | Runtime/provider utility service for Python-backed services. | Manifest exists in core `services/@python/service.json`; docs mention provider planning. | Not part of the current starter baseline, but should be explicitly classified as optional/future for app inventories. |
| `@java` | Runtime/provider utility service for Java/JVM-backed services. | Donor source exists at `ref/typerefinery-service-manager-donor/services/_java`; docs mention Java apps through `execservice: java`; donor Keycloak notes depend on Java. | No core `services/@java/service.json`, no dedicated service repo, no release pipeline/artifact, no install/acquire proof, and no Java-backed runtime/provider proof. Tracked by issue `#93`. |
| `@traefik` | Edge/router utility service for local routing and Service Admin dependency modeling. | Release-backed core manifest exists in `services/@traefik/service.json` and points at `service-lasso/lasso-traefik@2026.4.25-5301df9`; manifest exists in `service-template/services/@traefik/service.json`; docs list it in starter baseline. | Core release-backed proof exists; `#91` still needs to align the reference-app and service-template inventories with the now-real baseline service. |
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

Affected reference apps:

- `service-lasso-app-node`
- `service-lasso-app-web`
- `service-lasso-app-electron`
- `service-lasso-app-tauri`
- `service-lasso-app-packager-pkg`

## Recommendation

Resolve issue `#91` before claiming the planned service inventory is complete.

Preferred direction:

- add `services/@node/service.json` and `services/@traefik/service.json` to each canonical reference app if they remain the documented Service Admin baseline dependencies
- add validation that the reference app service inventory includes the documented baseline
- run `npm test` and `npm run release:verify` in each changed reference app
- update core docs and `service-template` docs with evidence

If `@traefik` is not actually required for the near-term app hosts, then update docs and `service-template` to classify `@traefik` as future/deferred rather than a baseline dependency.

Resolve issue `#93` before claiming donor-aligned core runtime service planning is complete. Java should be handled as a core runtime/provider service migration:

- analyze donor `_java` service metadata and runtime expectations
- define the canonical `@java` `service.json` contract or document an explicit deferral decision
- create a dedicated Java runtime service repo if the established service-repo model remains correct
- add release artifacts and pipeline behavior using `yyyy.m.d-<shortsha>`
- prove Service Lasso can acquire/install the Java runtime service without starting it
- prove at least one bounded Java-backed execution/provider scenario before migrating Java-dependent services such as Keycloak

## Completion Plan

Core completion should proceed in this order:

1. Close remaining release-readiness evidence gaps for the already implemented core package and current service repos: deterministic live reference-app lifecycle smoke, promotion evidence, and fresh `lasso-serviceadmin` validation.
2. Resolve baseline app inventory alignment under `#91`: add `@node` and the release-backed `@traefik` manifest to canonical app repos/templates where Service Admin expects them.
3. Finish core runtime service inventory tracking under `#93`: promote Java from donor/reference-only material into an explicit `@java` manifest/repo/release/runtime-proof plan, or record a deliberate deferral.
4. Decide the next donor-aligned runtime utility wave after baseline closure: `@python` provider depth, `@archive`, and `@localcert`.
5. Only after the runtime services are proven, plan dependent app/service migrations such as Keycloak so they consume released runtime services instead of inheriting donor assumptions.

## Remaining Planned Services

Current baseline to finish:

- `@node`
- `@traefik`

Current donor-aligned runtime service gap:

- `@java`

Future/deferred donor-aligned utility services:

- `@archive`
- `@localcert`
- `@python` beyond the current bounded manifest/provider planning

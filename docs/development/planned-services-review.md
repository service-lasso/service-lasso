# Planned Services Review

This review records the service inventory currently implied by the core docs, `service-template`, and canonical reference app repos.

Date: 2026-04-24

Linked issue: `#91`

## Summary

The current planned baseline service inventory is not fully aligned across repos.

Docs and `service-template` identify this baseline for app/reference repos:

- `services/echo-service/service.json`
- `services/service-admin/service.json`
- `services/@node/service.json`
- `services/@traefik/service.json`

Current canonical reference app repos only include:

- `services/echo-service/service.json`
- `services/service-admin/service.json`

This is a real gap because `service-template/services/service-admin/service.json` declares `depend_on: ["@node", "@traefik"]`, while the app repos that include `service-admin` do not carry those dependency manifests.

## Service Status

| Service | Role | Current status | Gap |
| --- | --- | --- | --- |
| `echo-service` | Real managed harness/service for install, lifecycle, logs, state, SQLite, HTTP/TCP health, and UI validation. | Implemented and released in `service-lasso/lasso-echoservice`; used by core and all reference apps. | No baseline gap. |
| `service-admin` | Operator/admin UI entry for app hosts. | Implemented in `service-lasso/lasso-serviceadmin`; all reference apps include `services/service-admin/service.json`. | Dependency inventory is incomplete if `@node` / `@traefik` remain declared dependencies. |
| `@node` | Runtime/provider utility service for Node-backed services and Service Admin dependency modeling. | Implemented as a bounded provider path in core; manifest exists in core `services/@node/service.json` and `service-template/services/@node/service.json`. | Missing from all canonical reference app `services/` inventories. |
| `@python` | Runtime/provider utility service for Python-backed services. | Manifest exists in core `services/@python/service.json`; docs mention provider planning. | Not part of the current starter baseline, but should be explicitly classified as optional/future for app inventories. |
| `@traefik` | Edge/router utility service for local routing and Service Admin dependency modeling. | Manifest exists in `service-template/services/@traefik/service.json`; docs list it in starter baseline. | Missing from core `services/` and all canonical reference app `services/` inventories; no dedicated implementation/release proof exists yet. |
| `@archive` | Future utility/archive provider based on donor/reference docs. | Discussed in service-template reference material only. | Future/deferred; not current baseline. |
| `@localcert` | Future local certificate/bootstrap utility based on donor/reference docs. | Discussed in service-template reference material only. | Future/deferred; not current baseline. |

## Repo Inventory Snapshot

Core repo currently has:

- `services/echo-service/service.json`
- `services/@node/service.json`
- `services/@python/service.json`
- `services/node-sample-service/service.json`

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

## Remaining Planned Services

Current baseline to finish:

- `@node`
- `@traefik`

Future/deferred donor-aligned utility services:

- `@archive`
- `@localcert`
- `@python` beyond the current bounded manifest/provider planning


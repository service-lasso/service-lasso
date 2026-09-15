---
title: Add OpenObserve or SOARCA to an app
---

# Add OpenObserve or SOARCA to an app

OpenObserve and SOARCA are optional app-owned services. They do not belong in
the Core baseline because the consuming app owns their data, credentials,
integrations, and operating policy. Start with [the services-folder
contract](../ecosystem/README.md#services-folder-contract), then commit the
exact released manifest your app needs under `services/<service-id>/`.

## Add OpenObserve

Use OpenObserve when your app owns local telemetry data, development
credentials, and retention policy.

1. Add the released `openobserve` manifest to your app-owned inventory.
2. Supply the app-owned configuration and credentials; do not put them in Core
   documentation or a shared baseline manifest.
3. Start the service through your app's Service Lasso lifecycle.
4. Use the manifest's resolved `ui` endpoint for the operator UI and its
   `health` endpoint for readiness. OpenObserve also declares local `service`
   and `grpc` endpoints for consumers that need them.

The package and its verifier remain owned by
[`lasso-openobserve`](https://github.com/service-lasso/lasso-openobserve).

## Add SOARCA

Use SOARCA when your app owns CACAO playbooks, execution integrations,
authentication, reporting, and retention policy.

1. Add the released `soarca` manifest to your app-owned inventory.
2. Keep it disabled until the app supplies the configuration it needs.
3. Start it through your app's lifecycle and use `GET /status/ping` as its
   readiness surface.
4. Pair CACAO Roaster with SOARCA by consuming the `SOARCA_URL` value exported
   by the service. The Swagger UI is available at `/swagger/index.html` after
   the service is running.

The package and its release artifacts remain owned by
[`lasso-soarca`](https://github.com/service-lasso/lasso-soarca).

## Boundaries and provenance

This is Core reader guidance, not a copy of component contracts. Package,
manifest, validation, release, and implementation details remain in their
source repositories. It was reviewed against these authorized `develop`
sources on 15 September 2026:

| Source | Revision | Blob |
| --- | --- | --- |
| `lasso-openobserve/README.md` | `f90899445db9bbfdc15d983a8f62320e709e0721` | `d87322d0471f9e2a70abe957edee43b97426b4f1` |
| `lasso-openobserve/docs/service.md` | `f90899445db9bbfdc15d983a8f62320e709e0721` | `2e70936f1fda86f72d6f6d66b91463fd2da82fd1` |
| `lasso-soarca/README.md` | `579498fa08e28cc7c5e742b6d9b6a1110ceae7a4` | `9d7726a94467767e4b38ed4a09ceefe21fe37ca2` |
| `lasso-soarca/docs/service.md` | `579498fa08e28cc7c5e742b6d9b6a1110ceae7a4` | `f3109cf88e2795138d836f75d200303f9a81f89d` |

Component redirects remain tracked in [Core #1287](https://github.com/service-lasso/service-lasso/issues/1287). Their absence means this migration is not yet complete across the component repositories.

---
title: Services and companion projects
---

# Services and companion projects

[Documentation home](../README.md) · [Quick start](../quick-start.md)

Find a service, choose an app template, or understand which repository owns what.

Relevant repos:

| Repo | Provides |
| --- | --- |
| [`service-lasso/service-lasso`](https://github.com/service-lasso/service-lasso) | this core runtime, CLI/API package, `service.json` contract docs, and baseline service manifests |
| [`service-lasso/lasso-serviceadmin`](https://github.com/service-lasso/lasso-serviceadmin) | Service Admin browser UI served as the `@serviceadmin` managed service |
| [`service-lasso/service-template`](https://github.com/service-lasso/service-template) | template for creating a new release-backed `lasso-*` service repo |
| [`service-lasso/service-lasso-app-node`](https://github.com/service-lasso/service-lasso-app-node) | Node host reference app template |
| [`service-lasso/service-lasso-app-web`](https://github.com/service-lasso/service-lasso-app-web) | web host reference app template |
| [`service-lasso/service-lasso-app-electron`](https://github.com/service-lasso/service-lasso-app-electron) | Electron host reference app template |
| [`service-lasso/service-lasso-app-tauri`](https://github.com/service-lasso/service-lasso-app-tauri) | Tauri host reference app template |
| [`service-lasso/service-lasso-app-packager-pkg`](https://github.com/service-lasso/service-lasso-app-packager-pkg), [`service-lasso/service-lasso-app-packager-sea`](https://github.com/service-lasso/service-lasso-app-packager-sea), [`service-lasso/service-lasso-app-packager-nexe`](https://github.com/service-lasso/service-lasso-app-packager-nexe) | Node packaging reference templates for packaged app outputs |
| [`service-lasso/lasso-echoservice`](https://github.com/service-lasso/lasso-echoservice) | Echo Service harness used to test lifecycle, UI/API, logs, state, SQLite, and failure behavior |
| [`service-lasso/lasso-node`](https://github.com/service-lasso/lasso-node), [`service-lasso/lasso-python`](https://github.com/service-lasso/lasso-python), [`service-lasso/lasso-java`](https://github.com/service-lasso/lasso-java), [`service-lasso/lasso-archive`](https://github.com/service-lasso/lasso-archive), [`service-lasso/lasso-secretsbroker`](https://github.com/service-lasso/lasso-secretsbroker) | release-backed runtime, utility provider, and secrets broker services |
| [`service-lasso/lasso-localcert`](https://github.com/service-lasso/lasso-localcert), [`service-lasso/lasso-nginx`](https://github.com/service-lasso/lasso-nginx), [`service-lasso/lasso-traefik`](https://github.com/service-lasso/lasso-traefik) | release-backed baseline infrastructure services |
| [`service-lasso/lasso-postgres`](https://github.com/service-lasso/lasso-postgres), [`service-lasso/lasso-pgadmin4`](https://github.com/service-lasso/lasso-pgadmin4), [`service-lasso/lasso-openobserve`](https://github.com/service-lasso/lasso-openobserve), [`service-lasso/lasso-filebeat`](https://github.com/service-lasso/lasso-filebeat), [`service-lasso/lasso-soarca`](https://github.com/service-lasso/lasso-soarca), [`service-lasso/lasso-cacao-roaster`](https://github.com/service-lasso/lasso-cacao-roaster), [`service-lasso/lasso-mongo`](https://github.com/service-lasso/lasso-mongo), [`service-lasso/lasso-typedb`](https://github.com/service-lasso/lasso-typedb), [`service-lasso/lasso-files`](https://github.com/service-lasso/lasso-files), [`service-lasso/lasso-fastapi`](https://github.com/service-lasso/lasso-fastapi), [`service-lasso/lasso-jupyterlab`](https://github.com/service-lasso/lasso-jupyterlab), [`service-lasso/lasso-totaljs-messageservice`](https://github.com/service-lasso/lasso-totaljs-messageservice), [`service-lasso/lasso-totaljs-flow`](https://github.com/service-lasso/lasso-totaljs-flow), [`service-lasso/lasso-websight-cms`](https://github.com/service-lasso/lasso-websight-cms), [`service-lasso/lasso-bpmn-server`](https://github.com/service-lasso/lasso-bpmn-server), [`service-lasso/lasso-zitadel`](https://github.com/service-lasso/lasso-zitadel), [`service-lasso/lasso-keycloak`](https://github.com/service-lasso/lasso-keycloak), [`service-lasso/lasso-dagu`](https://github.com/service-lasso/lasso-dagu) | app-owned add-on service repos that consumers can add to their own `services/` folder |

Secrets capability and cross-repository proof are tracked in the canonical
[Secrets capability ledger](../reference/secrets-capability-ledger.md).
Including Core, Secrets Broker, or Service Admin in the baseline does not by
itself mean that every operation, provider, platform, or Admin surface is
validated.

## Baseline Services

The checked-in baseline proves that a clean clone can acquire and run real service artifacts.

| Service | Role | Source |
| --- | --- | --- |
| `@archive` | optional release-backed 7-Zip archive utility provider | acquired from [`service-lasso/lasso-archive`](https://github.com/service-lasso/lasso-archive) release `2026.5.2-a223a48`; installed/configured as a provider and skipped for daemon launch |
| `@java` | release-backed Java runtime provider | acquired from [`service-lasso/lasso-java`](https://github.com/service-lasso/lasso-java) release `2026.8.12-d5765f1`; installed/configured but not launched as a daemon |
| `@localcert` | release-backed core local certificate utility for Traefik | acquired from [`service-lasso/lasso-localcert`](https://github.com/service-lasso/lasso-localcert) release `2026.5.2-24e7d2f`; exports `CERT_FILE`, `CERT_KEY`, `CERT_PFX`, and `CAROOT_CERT`; no daemon launch |
| `@nginx` | release-backed NGINX Open Source service for Traefik routing dependencies | acquired from [`service-lasso/lasso-nginx`](https://github.com/service-lasso/lasso-nginx) release `2026.8.12-f587add`; started as a managed daemon with HTTP `/health` |
| `@traefik` | local edge/router service depending on `@localcert` and `@nginx` | acquired from [`service-lasso/lasso-traefik`](https://github.com/service-lasso/lasso-traefik) release `2026.7.26-f13b89c` |
| `@node` | release-backed Node runtime provider | acquired from [`service-lasso/lasso-node`](https://github.com/service-lasso/lasso-node) release `2026.8.12-1500d36`; installed/configured but not launched as a daemon |
| `@python` | release-backed Python runtime provider | acquired from [`service-lasso/lasso-python`](https://github.com/service-lasso/lasso-python) release `2026.4.27-63f915c` on supported hosts; the current pinned release is Windows-only, so other platforms report an explicit unsupported-platform skip instead of a broken install; installed/configured but not launched as a daemon when supported |
| `@secretsbroker` | release-backed local-first secrets broker for service identities, policy, audit, and secret resolution | acquired from [`service-lasso/lasso-secretsbroker`](https://github.com/service-lasso/lasso-secretsbroker) immutable release `2026.8.31-f340883`; started as a managed daemon with process health and store-derived readiness |
| `echo-service` | test harness service with UI/API/log/state behavior | acquired from [`service-lasso/lasso-echoservice`](https://github.com/service-lasso/lasso-echoservice) release `2026.5.3-6d3dc19` |
| `@serviceadmin` | core browser UI for the Service Lasso runtime | acquired from [`service-lasso/lasso-serviceadmin`](https://github.com/service-lasso/lasso-serviceadmin) immutable release `2026.8.31-f015b44` |

Additional manifests such as `node-sample-service` exist for provider-backed fixture coverage, but the canonical baseline and demo instance install the production baseline service set. `@archive` and supported `@python` artifacts are part of that baseline so archive-capable and Python-backed services can rely on prepared providers instead of fixture-only installs.

App-owned add-on service repos such as [`service-lasso/lasso-postgres`](https://github.com/service-lasso/lasso-postgres), [`service-lasso/lasso-pgadmin4`](https://github.com/service-lasso/lasso-pgadmin4), [`service-lasso/lasso-openobserve`](https://github.com/service-lasso/lasso-openobserve), [`service-lasso/lasso-filebeat`](https://github.com/service-lasso/lasso-filebeat), [`service-lasso/lasso-soarca`](https://github.com/service-lasso/lasso-soarca), [`service-lasso/lasso-cacao-roaster`](https://github.com/service-lasso/lasso-cacao-roaster), [`service-lasso/lasso-mongo`](https://github.com/service-lasso/lasso-mongo), [`service-lasso/lasso-typedb`](https://github.com/service-lasso/lasso-typedb), [`service-lasso/lasso-files`](https://github.com/service-lasso/lasso-files), [`service-lasso/lasso-fastapi`](https://github.com/service-lasso/lasso-fastapi), [`service-lasso/lasso-jupyterlab`](https://github.com/service-lasso/lasso-jupyterlab), [`service-lasso/lasso-totaljs-messageservice`](https://github.com/service-lasso/lasso-totaljs-messageservice), [`service-lasso/lasso-totaljs-flow`](https://github.com/service-lasso/lasso-totaljs-flow), [`service-lasso/lasso-websight-cms`](https://github.com/service-lasso/lasso-websight-cms), [`service-lasso/lasso-bpmn-server`](https://github.com/service-lasso/lasso-bpmn-server), [`service-lasso/lasso-zitadel`](https://github.com/service-lasso/lasso-zitadel), [`service-lasso/lasso-keycloak`](https://github.com/service-lasso/lasso-keycloak), and [`service-lasso/lasso-dagu`](https://github.com/service-lasso/lasso-dagu) can be added by committing their released `service.json` into your app's `services/` folder. PostgreSQL, pgAdmin4, OpenObserve, Filebeat, MongoDB, and TypeDB are app-owned because database names, telemetry/log retention, schema/data retention, credentials, and admin access belong to the consuming app. SOARCA and CACAO Roaster are app-owned because playbooks, orchestration integrations, authoring workflows, auth, reporting, and execution policy belong to the consuming app. Files is app-owned because stored file content and compatibility needs belong to the consuming app. FastAPI, JupyterLab, BPMN Server, Websight CMS, and the Total.js services are app-owned because API routes, notebooks, CMS content/repository data, model/process definitions, message integrations, and Flow project state are application-specific. ZITADEL and Keycloak are not in the core baseline because identity data, database retention, admin credentials, and production-grade secret policy belong to the consuming app. Dagu is app-owned because workflow orchestration and workflow files are app-specific.

## Services Folder Contract

Service Lasso reads services from a services root. Each service lives in its own folder and is described by one manifest:

```text
services/
  echo-service/
    service.json
```

`service.json` is the source of truth for:

- service identity and dependency order
- runtime command or provider delegation
- ports, URLs, environment, and health checks
- install/config materialization
- release artifact download metadata
- update and recovery policy

Apps that use Service Lasso should commit their own `services/` folder with the exact service manifests they need. Service Lasso does not infer service inventory from sibling repos.

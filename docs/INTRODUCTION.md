---
title: Introduction
---

# Introduction

Service Lasso is a small runtime for acquiring, configuring, starting, stopping, monitoring, and updating local services from declarative `service.json` manifests.

The core idea is simple: an app commits a `services/` folder, each service folder contains a `service.json`, and Service Lasso uses those manifests to install release artifacts, prepare runtime config, launch managed services, expose state through API/CLI surfaces, and report what is healthy or needs attention.

## What this repo owns

The [`service-lasso/service-lasso`](https://github.com/service-lasso/service-lasso) repo owns:

- the Service Lasso CLI and runtime API
- the canonical `service.json` contract documentation
- baseline core service manifests under `services/`
- release artifact and npm package build definitions
- Docusaurus docs for runtime, operator, and service-authoring behavior
- validation scripts for clean-clone and reference-app scenarios

It does not own every service implementation. Each release-backed service should live in its own [`service-lasso/lasso-*`](https://github.com/service-lasso?q=lasso-&type=repositories) repo and publish its own GitHub release artifacts.

## Related repos

Current related repos:

| Repo | Provides |
| --- | --- |
| [`service-lasso/lasso-echoservice`](https://github.com/service-lasso/lasso-echoservice) | controllable harness service used for lifecycle, logs, health, state, SQLite, and runtime validation |
| [`service-lasso/lasso-serviceadmin`](https://github.com/service-lasso/lasso-serviceadmin) | operator/admin UI service served as `@serviceadmin` |
| [`service-lasso/lasso-node`](https://github.com/service-lasso/lasso-node) | release-backed Node runtime provider |
| [`service-lasso/lasso-python`](https://github.com/service-lasso/lasso-python) | release-backed Python runtime provider |
| [`service-lasso/lasso-java`](https://github.com/service-lasso/lasso-java) | release-backed Java runtime provider |
| [`service-lasso/lasso-archive`](https://github.com/service-lasso/lasso-archive) | optional release-backed 7-Zip archive utility provider for services that need external archive tooling |
| [`service-lasso/lasso-localcert`](https://github.com/service-lasso/lasso-localcert) | release-backed local certificate provider |
| [`service-lasso/lasso-nginx`](https://github.com/service-lasso/lasso-nginx) | release-backed NGINX service used by the baseline Traefik setup |
| [`service-lasso/lasso-traefik`](https://github.com/service-lasso/lasso-traefik) | release-backed Traefik edge/router service |
| [`service-lasso/lasso-postgres`](https://github.com/service-lasso/lasso-postgres) | app-owned PostgreSQL service repo for local relational database dependencies |
| [`service-lasso/lasso-pgadmin4`](https://github.com/service-lasso/lasso-pgadmin4) | app-owned pgAdmin4 browser UI for PostgreSQL admin workflows |
| [`service-lasso/lasso-openobserve`](https://github.com/service-lasso/lasso-openobserve) | app-owned OpenObserve observability service for local logs, metrics, and traces |
| [`service-lasso/lasso-filebeat`](https://github.com/service-lasso/lasso-filebeat) | app-owned Filebeat log shipper service for forwarding app logs into OpenObserve-compatible destinations |
| [`service-lasso/lasso-soarca`](https://github.com/service-lasso/lasso-soarca) | app-owned SOARCA CACAO orchestration API service for playbook execution |
| [`service-lasso/lasso-cacao-roaster`](https://github.com/service-lasso/lasso-cacao-roaster) | app-owned CACAO Roaster web UI for CACAO playbook authoring and SOARCA pairing |
| [`service-lasso/lasso-mongo`](https://github.com/service-lasso/lasso-mongo) | app-owned MongoDB service repo for local document database dependencies |
| [`service-lasso/lasso-typedb`](https://github.com/service-lasso/lasso-typedb) | app-owned TypeDB daemon repo that runs through `@java` and exports TypeDB connection globals |
| [`service-lasso/lasso-files`](https://github.com/service-lasso/lasso-files) | app-owned file-manager service repo with React UI and filesystem-backed API |
| [`service-lasso/lasso-fastapi`](https://github.com/service-lasso/lasso-fastapi) | app-owned TypeRefinery FastAPI service repo for Python API surfaces |
| [`service-lasso/lasso-jupyterlab`](https://github.com/service-lasso/lasso-jupyterlab) | app-owned JupyterLab service repo for local notebooks and notebook API surfaces |
| [`service-lasso/lasso-totaljs-messageservice`](https://github.com/service-lasso/lasso-totaljs-messageservice) | app-owned Total.js messaging service repo that exports message-service global env values |
| [`service-lasso/lasso-totaljs-flow`](https://github.com/service-lasso/lasso-totaljs-flow) | app-owned Total.js Flow service repo that depends on `totaljs-messageservice` |
| [`service-lasso/lasso-websight-cms`](https://github.com/service-lasso/lasso-websight-cms) | app-owned Websight CMS service repo that depends on `@java`, `mongo`, `nginx`, `totaljs-flow`, and `totaljs-messageservice` |
| [`service-lasso/lasso-bpmn-server`](https://github.com/service-lasso/lasso-bpmn-server) | app-owned BPMN modeling and execution service repo that depends on `mongo` |
| [`service-lasso/lasso-zitadel`](https://github.com/service-lasso/lasso-zitadel) | app-owned ZITADEL service repo for identity setups |
| [`service-lasso/lasso-keycloak`](https://github.com/service-lasso/lasso-keycloak) | app-owned Keycloak service repo for PostgreSQL-backed identity setups |
| [`service-lasso/lasso-dagu`](https://github.com/service-lasso/lasso-dagu) | app-owned Dagu service repo for workflow orchestration setups |
| [`service-lasso/service-template`](https://github.com/service-lasso/service-template) | template for creating new release-backed `lasso-*` service repos |
| [`service-lasso/service-lasso-app-node`](https://github.com/service-lasso/service-lasso-app-node) | Node host reference app template using Service Lasso |
| [`service-lasso/service-lasso-app-web`](https://github.com/service-lasso/service-lasso-app-web) | web host reference app template using Service Lasso |
| [`service-lasso/service-lasso-app-electron`](https://github.com/service-lasso/service-lasso-app-electron) | Electron host reference app template using Service Lasso |
| [`service-lasso/service-lasso-app-tauri`](https://github.com/service-lasso/service-lasso-app-tauri) | Tauri host reference app template using Service Lasso |
| [`service-lasso/service-lasso-app-packager-pkg`](https://github.com/service-lasso/service-lasso-app-packager-pkg) | Node packaging reference template for `pkg` packaged app outputs |
| [`service-lasso/service-lasso-app-packager-sea`](https://github.com/service-lasso/service-lasso-app-packager-sea) | Node packaging reference template for SEA packaged app outputs |
| [`service-lasso/service-lasso-app-packager-nexe`](https://github.com/service-lasso/service-lasso-app-packager-nexe) | Node packaging reference template for nexe packaged app outputs |

## Baseline runtime model

Service Lasso separates service definitions from runtime working data:

- `servicesRoot` is where service manifests and service payloads live.
- `workspaceRoot` is where Service Lasso writes runtime-managed state, logs, archives, and working files.

The default baseline services are checked into `services/` and are started by the [Quick Start](quick-start.md) flow.

## How services are acquired

Release-backed services use `artifact` metadata in `service.json`.

At install time Service Lasso:

1. reads the manifest
2. resolves the platform asset from the configured GitHub release
3. downloads and extracts the archive
4. records install metadata
5. runs config/start/health behavior according to the manifest and command invoked

Bundled application artifacts are produced by running the Service Lasso package flow ahead of time so service archives are already present in the application artifact. In that mode, first run should not need to download those services again.

Core releases publish both `service-lasso-<version>.tar.gz` for the lean runtime and `service-lasso-bundled-<version>.tar.gz` for the same runtime plus the baseline `services/` folder and pre-acquired baseline service archives.

## Where to start

For a new user running the project, start with [Quick Start](quick-start.md).

For a service author, start with [Service Authoring Overview](service-authoring/overview.md).

For manifest details, start with [service.json Reference](reference/service-json-reference.md).

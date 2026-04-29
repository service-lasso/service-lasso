---
title: Introduction
---

# Introduction

Service Lasso is a small runtime for acquiring, configuring, starting, stopping, monitoring, and updating local services from declarative `service.json` manifests.

The core idea is simple: an app commits a `services/` folder, each service folder contains a `service.json`, and Service Lasso uses those manifests to install release artifacts, prepare runtime config, launch managed services, expose state through API/CLI surfaces, and report what is healthy or needs attention.

## What this repo owns

This `service-lasso/service-lasso` repo owns:

- the Service Lasso CLI and runtime API
- the canonical `service.json` contract documentation
- baseline core service manifests under `services/`
- release artifact and npm package build definitions
- Docusaurus docs for runtime, operator, and service-authoring behavior
- validation scripts for clean-clone and reference-app scenarios

It does not own every service implementation. Each release-backed service should live in its own `service-lasso/lasso-*` repo and publish its own GitHub release artifacts.

## Related repos

Current related repos:

- `service-lasso/lasso-echoservice`: controllable harness service used for lifecycle, logs, health, and runtime validation.
- `service-lasso/lasso-serviceadmin`: operator/admin UI service.
- `service-lasso/lasso-node`: release-backed Node runtime provider.
- `service-lasso/lasso-python`: release-backed Python runtime provider.
- `service-lasso/lasso-java`: release-backed Java runtime provider.
- `service-lasso/lasso-traefik`: release-backed Traefik edge/router service.
- `service-lasso/lasso-nginx`: release-backed NGINX service used by the baseline Traefik setup.
- `service-lasso/lasso-localcert`: release-backed local certificate provider.
- `service-lasso/service-template`: template for creating new `lasso-*` service repos.
- `service-lasso/service-lasso-app-node`: Node reference app template using Service Lasso.
- `service-lasso/service-lasso-app-web`: web reference app template using Service Lasso.
- `service-lasso/service-lasso-app-electron`: Electron reference app template using Service Lasso.
- `service-lasso/service-lasso-app-tauri`: Tauri reference app template using Service Lasso.

## Baseline runtime model

Service Lasso separates service definitions from runtime working data:

- `servicesRoot` is where service manifests and service payloads live.
- `workspaceRoot` is where Service Lasso writes runtime-managed state, logs, archives, and working files.

The default baseline service inventory is documented in [Baseline Service Inventory](development/baseline-service-inventory.md).

## How services are acquired

Release-backed services use `artifact` metadata in `service.json`.

At install time Service Lasso:

1. reads the manifest
2. resolves the platform asset from the configured GitHub release
3. downloads and extracts the archive
4. records install metadata
5. runs config/start/health behavior according to the manifest and command invoked

Bundled application artifacts are produced by running the Service Lasso package flow ahead of time so service archives are already present in the application artifact. In that mode, first run should not need to download those services again.

## Where to start

For a new user validating the project, start with [Clean Clone Scenario Validation](development/clean-clone-scenario-validation.md).

For a service author, start with [Create a New Lasso Service](development/new-lasso-service-guide.md).

For manifest details, start with [service.json Reference](reference/service-json-reference.md).

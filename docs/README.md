---
title: Service Lasso Docs
slug: /
---

# Service Lasso Docs

This repo is the canonical home for the Service Lasso runtime, service manifest contract, release artifact contract, and operator-facing runtime documentation.

The `docs/` folder is both the GitHub-readable documentation source and the Docusaurus site root.

Run the local docs build from the repo root:

```powershell
npm run docs:build
```

Run the local docs development server:

```powershell
npm run docs:start
```

Serve the last production build locally:

```powershell
npm run docs:serve
```

## Docs pipeline

The `Docs Site` workflow in `.github/workflows/docs-site.yml` runs `npm ci` and `npm run docs:build` for docs-related pull requests and pushes to `develop`.

Pushes to `main` build the same Docusaurus site and deploy `docs/build` to GitHub Pages:

```text
https://service-lasso.github.io/service-lasso/
```

## Runtime status

Service Lasso is the core runtime and contract repo. It provides the CLI/API runtime, service discovery, service installation/acquisition, lifecycle orchestration, update checks, and release-backed baseline service definitions.

The preferred runtime-root model is:

- `servicesRoot`: where service manifests and acquired service payloads live
- `workspaceRoot`: where Service Lasso stores runtime-managed state, logs, archives, and working data

## Canonical general docs

Use this short list as the current high-value documentation map:

- [Introduction](INTRODUCTION.md): what Service Lasso is, what this repo owns, and where related repos fit.
- [Clean Clone Scenario Validation](development/clean-clone-scenario-validation.md): copy-paste validation runbook for a fresh clone that starts the baseline services.
- [Baseline Service Inventory](development/baseline-service-inventory.md): the baseline `services/` set that Service Lasso should acquire, configure, and start.
- [Create a New Lasso Service](development/new-lasso-service-guide.md): agent-ready guide for creating a release-backed `service-lasso/lasso-*` service repo.
- [service.json Reference](reference/service-json-reference.md): canonical manifest fields, artifact metadata, health checks, actions, env, dependencies, and update policy.
- [Complete service.json Union Schema](reference/SERVICE-JSON-COMPLETE-UNION-SCHEMA.md): detailed manifest shape reference.
- [Service Config Types](reference/SERVICE-CONFIG-TYPES.md): service pattern taxonomy for providers, apps, infrastructure services, health checks, env, and dependency graphs.
- [Core Runtime Release Artifact](development/core-runtime-release-artifact.md): what the downloadable runtime release contains.
- [Core Runtime Publishable Package](development/core-runtime-publishable-package.md): what the published npm package contains and how consumers install it.
- [Runtime Provider Release Services Delivery Plan](development/runtime-provider-release-services-delivery-plan.md): current provider service release matrix for Node, Python, Java, Traefik, NGINX, and local certificates.
- [Service Update Management Plan](development/service-update-management-plan.md): update discovery, download, install scheduling, and notification behavior.
- [Recovery, Doctor, and Upgrade Hooks](development/service-recovery-doctor-upgrade-hooks-plan.md): restart policy, preflight/doctor hooks, recovery, and upgrade hook contracts.
- [Reference Apps](reference-apps.md): choose the right host/template repo and understand the release output options.
- [Windows Containment Tiers](windows-containment-tiers.md): Windows containment guidance for service execution.

## Source of truth for `service.json`

When discussing or changing the general `service.json` contract:

- update the core `service-lasso` docs first
- keep `service.json` as the only service manifest source of truth
- mirror or link from individual service repos only after the core contract is updated

Current canonical files:

- [service.json Reference](reference/service-json-reference.md)
- [Complete service.json Union Schema](reference/SERVICE-JSON-COMPLETE-UNION-SCHEMA.md)
- [Service Config Types](reference/SERVICE-CONFIG-TYPES.md)

## Repo boundary rule

Keep docs in this repo when they describe:

- general manifest schema
- shared runtime behavior
- provider/dependency semantics
- reusable service taxonomy
- cross-service/platform contract rules
- release artifact and npm package behavior
- the split between `servicesRoot` and `workspaceRoot`

Keep docs in individual service repos when they describe:

- service-specific UI or runtime behavior
- service-specific routes, ports, config files, or page specs
- service-specific packaging quirks that do not generalize back into the core contract
- exact release assets for that service repo

## Service authoring entrypoint

Use [Create a New Lasso Service](development/new-lasso-service-guide.md) when creating or reviewing a new service repo.

That guide is the canonical handoff for:

- service ID and repo naming
- `@` prefix rules for core-owned services
- required release artifacts and artifact naming
- `service.json` artifact metadata
- service repo verification
- updating core, service-template, and reference-app inventories
- PR, merge, and branch archive hygiene

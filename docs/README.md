---
title: Service Lasso Docs
slug: /
---

# Service Lasso Docs

This repo is the canonical home for the Service Lasso runtime, service manifest contract, and release-backed service authoring guidance.

The `docs/` folder is both the GitHub-readable documentation source and the Docusaurus site root.

## Runtime Model

Service Lasso is the core runtime and contract repo. It provides the CLI/API runtime, service discovery, service installation/acquisition, lifecycle orchestration, update checks, and release-backed baseline service definitions.

The preferred runtime-root model is:

- `servicesRoot`: where service manifests and acquired service payloads live
- `workspaceRoot`: where Service Lasso stores runtime-managed state, logs, archives, and working data

## Start Here

Use this short list as the public documentation map:

- [Introduction](INTRODUCTION.md): what Service Lasso is, what this repo owns, and where related repos fit.
- [Service Catalog](service-catalog.md): available core services, app-owned add-on services, and reference apps.
- [Quick Start](quick-start.md): clone the repo, install dependencies, start the baseline services, open the useful URLs, and stop cleanly.
- [Service Authoring Overview](service-authoring/overview.md): ordered process for planning, manifesting, releasing, wiring, and validating a service.
- [service.json Reference](reference/service-json-reference.md): canonical manifest fields, artifact metadata, health checks, actions, env, dependencies, and update policy.
- [One-shot Jobs](reference/one-shot-jobs.md): setup-step contract for schema init, sample data loading, certificate generation, and other non-daemon workloads.
- [Reference Apps](reference-apps.md): choose the right host/template repo and understand the release output options.

## Source of truth for `service.json`

When discussing or changing the general `service.json` contract:

- update the core `service-lasso` docs first
- keep `service.json` as the only service manifest source of truth
- mirror or link from individual service repos only after the core contract is updated

Current canonical files:

- [service.json Reference](reference/service-json-reference.md)
- [One-shot Jobs](reference/one-shot-jobs.md)

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

Use [Service Authoring Overview](service-authoring/overview.md) when creating or reviewing a new service repo. It links to the numbered authoring process and the detailed [Create a New Lasso Service](development/new-lasso-service-guide.md) handoff.

That guide is the canonical handoff for:

- service ID and repo naming
- `@` prefix rules for core-owned services
- required release artifacts and artifact naming
- `service.json` artifact metadata
- service repo verification
- PR, merge, and branch archive hygiene

## Docs Development

Run the local docs build from the repo root:

```powershell
npm run docs:build
```

Run the local docs development server:

```powershell
npm run docs:start
```

Pushes to `main` deploy the site to:

```text
https://service-lasso.github.io/service-lasso/
```

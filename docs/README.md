---
title: Service Lasso Docs
slug: /
---

# Service Lasso Docs

Service Lasso discovers, configures, runs, observes, and updates local services from declarative `service.json` manifests. This is the canonical documentation for the Core runtime and its shared contracts; service-specific screens and behavior belong in the service that owns them.

## Choose your starting point

| I want to… | Start here |
| --- | --- |
| Run services | [Run and manage services](operations/README.md) for first start, health, logs, recovery, and backup guidance. |
| Build a service | [Service authoring overview](service-authoring/overview.md) for the required five-step authoring sequence. |
| Integrate into an app | [Use Service Lasso in your app](integration/README.md) to choose a reference app, inventory, routing, SSO, and package output. |
| Look up a reference | [Technical reference](reference/README.md) for the stable manifest, CLI, API, MCP, state, endpoint, and workflow contracts. |

## Key concepts

Read [Key concepts](key-concepts.md) for the service manifest, `servicesRoot`, `workspaceRoot`, and Core/app/service ownership boundaries.

## First time with Service Lasso

1. Read [What is Service Lasso?](INTRODUCTION.md) for boundaries and the repo ecosystem.
2. [Choose how to run it](choose-how-to-run.md): run the checked-in baseline, use a reference app, or package an app-owned inventory.
3. Follow the [Quick start](quick-start.md).
4. Complete [first-run setup](complete-first-run-setup.md) when the runtime enters setup mode.
5. Use the [Service Catalog](service-catalog.md) to find the services in the baseline or app inventory.

## Documentation boundaries and status

Operational pages explain an operator task and link to the contract that governs it. Reference pages define the exact API, schema, or persistence contract and should not be read as step-by-step runbooks. Plans, draft proposals, historical reviews, and release-specific evidence remain explicitly labelled and are not statements of current shipped behavior.

See the [documentation map](documentation-map.md) for the complete page inventory, primary navigation home, classification, and intentional unlisted status. See [Contribute and maintain](contributing/README.md) to build or maintain this site.

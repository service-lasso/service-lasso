---
title: Service Lasso Docs
slug: /
---

# Service Lasso Docs

Service Lasso discovers, configures, runs, observes, and updates local services from declarative `service.json` manifests. This is the canonical reader documentation for Core and its components. Component repositories own implementation and code-governing specifications; reader guides belong here.

## Choose your starting point

**First useful result:** [Getting started](getting-started/README.md) → [Beginner Todo app](getting-started/beginner-todo-app.md) → [Make the Todo durable](getting-started/make-todo-app-durable.md) → [Configure and recover](operate-your-service.md) → [Package it](package-your-app.md). Optional visual demo: [Quick start](quick-start.md).

[Copy a task for your agent or connect MCP](agent-prompts.md).

| I want to… | Start here |
| --- | --- |
| Run services | [Run and manage services](operations/README.md) for first start, health, logs, recovery, and backup guidance. |
| Build a service | [Service authoring overview](service-authoring/overview.md) for the required five-step authoring sequence. |
| Integrate into an app | [Use Service Lasso in your app](integration/README.md) to choose a reference app, inventory, routing, SSO, and package output. |
| Look up a reference | [Technical reference](reference/README.md) for the stable manifest, CLI, API, MCP, state, endpoint, and workflow contracts. |

## Component guides

[Service Admin and template guides](components/README.md) · [Use the default stack](ui-documentation.md) · [Service Admin UI guide](operator-ui/service-admin-ui-guide.md) · [Capture status](operator-ui/capture-manifest.md)

[Documentation ownership and migration](components/documentation-migration.md) records remaining source migrations and packaged help copies.

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

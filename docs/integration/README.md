---
title: Use Service Lasso in your app
slug: /integration
---

# Use Service Lasso in your app

An app owns its `services/` inventory and workspace location; Service Lasso supplies the runtime and shared contracts. Choose a reference app before copying patterns so the host and packaging model match the application you are building.

Start with [PostgreSQL and a working app](../first-useful-service.md): install, connect, and prove a database write/read before choosing a larger template.

## Integration path

1. [Choose a reference app](../reference-apps.md) for Node, web, desktop, or executable packaging outputs.
2. Install the published `@service-lasso/service-lasso` runtime using the [CLI, HTTP API, and npm guide](../runtime/README.md).
3. Provide an app-owned `services/` inventory; [Services and companion projects](../ecosystem/README.md) and the [service.json reference](../reference/service-json-reference.md) define the ownership boundary and contract.
4. Choose source, bootstrap-download, or bundled outputs using [Reference Apps](../reference-apps.md) and [Packages and releases](../releases/README.md).
5. If the app needs local routing or SSO, follow the bounded [ZITADEL consumer integration](../reference/zitadel-consumer-integration.md) contract.
6. For an existing app, use [template upgrade compatibility](../reference/template-upgrade-compatibility.md) before changing its provider inventory.

Service Admin is a managed service. Its [operator guides](../components/README.md) and [UI guide](../operator-ui/service-admin-ui-guide.md) live here alongside runtime documentation.

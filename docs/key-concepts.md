---
title: Key concepts
---

# Key concepts

Service Lasso reads a service inventory instead of embedding service behavior in an app host. Each `services/<id>/service.json` manifest is the canonical declaration of artifacts, configuration, dependencies, commands, endpoints, and health checks.

- **`servicesRoot`** contains manifests and acquired service payloads.
- **`workspaceRoot`** contains runtime-managed state, logs, archives, and working data.
- **Core** owns the shared CLI, API, lifecycle behavior, and contracts in this repository.
- **A service repository** owns its service-specific UI, behavior, and released assets.
- **An app host** owns its inventory and chooses whether to use source, bootstrap-download, or bundled packaging.

For the exact manifest contract, use the [technical reference](reference/README.md). For the practical first run, use [Quick start](quick-start.md).

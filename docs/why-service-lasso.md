---
title: "Why Service Lasso: app-owned local services"
---

# Why Service Lasso: app-owned local services

An application can need more than its own executable: a database, a local API,
a search service, or a routing layer. Service Lasso lets the application own that
supporting service inventory and run native services through a common lifecycle.
The same ownership model gives developers and agents a runtime they can start,
inspect, test and clean up for one worktree.

## Build an app that brings its supporting services

Consider a desktop app with a local API and PostgreSQL. The builder needs to
acquire the right service artifacts, configure them, start dependencies in order,
check readiness and stop the processes the app owns. End users should be able to
use the application without assembling that lifecycle themselves.

The app supplies a `services/` inventory of `service.json` manifests and chooses
its workspace location. Core supplies discovery, installation, configuration,
lifecycle, health and update operations. Service packages describe their own
artifacts and commands. Embedding the runtime does not mean embedding a database
inside the app's process: supporting services remain separate managed processes.

Use the [app integration guide](integration/README.md) to choose a host, then the
[npm runtime guide](runtime/README.md) for the embedding API and CLI. The
[reference apps](reference-apps.md) show Node, web, Electron and Tauri choices;
[packaging outputs](releases/README.md) distinguish source, bootstrap-download
and bundled distributions. Artifact availability and support depend on the chosen
service and target platform.

Start with the [Todo app](getting-started/beginner-todo-app.md), then
[add PostgreSQL](getting-started/intermediate-make-todo-app-durable.md). Use
[service authoring](service-authoring/overview.md) when your supporting service
needs a package of its own. For the division between Core, Secrets Broker and
templates, read [Lasso, Broker, and templates explained](understand-service-lasso.md).

## Give each agent a runtime it can test independently

Git worktrees separate source files. They do not automatically separate a shared
database, service workspace or listener. If two agents test against the same
runtime, a healthy response can come from the wrong branch and one agent's
cleanup can interrupt the other's work.

Give each worktree its own service inventory and workspace, discover its runtime
identity and allocated endpoints, and retain those selectors with the test
results. Each agent can then exercise its branch against its own state and stop
its owned runtime when finished. A validator can use the same recorded lane
instead of assuming a familiar localhost port identifies the right checkout.

[One worktree, one runtime](one-worktree-one-runtime.md) walks through the existing
source demo helper and the contracts an app's own test harness should use.

## Understand the boundary

This is operational separation. It is not a hostile-code sandbox: services running
under the same OS account share that account's trust boundary. Separate workspaces,
environment mappings and process ownership checks do not make mutually untrusted
agents safe to run together. Read [service environment isolation](security/service-environment-isolation.md)
and the [resource and isolation model](reference/resource-isolation-model.md) before
choosing host controls.

Broker-backed delivery can keep secrets out of manifests and support RAM-backed
files, but a consumer can still copy values to disk, logs or dumps; swap and client
caching also require host/application policy. The canonical delivery limits live
in [startup Broker resolution](reference/startup-broker-resolution.md),
[Linux tmpfs files](reference/linux-app-secret-files.md) and
[RAM WebDAV delivery](reference/ram-webdav-secret-files-review.md).

These pages explain current source contracts and product fit. A source feature or
passing local example does not qualify an exact published package. Consult
[capabilities and limitations](reference/runtime-capabilities.md), the
[secrets capability ledger](reference/secrets-capability-ledger.md) and
[package/release guidance](releases/README.md) for the evidence relevant to your
candidate and platform.

## Choose the next step

- Building an app: [Use Service Lasso in your app](integration/README.md).
- Testing independent branches: [One worktree, one runtime](one-worktree-one-runtime.md).
- Choosing an execution approach: [Service Lasso, containers or process managers?](service-lasso-containers-process-managers.md).

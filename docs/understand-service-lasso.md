---
title: Lasso, Broker, and templates explained
---

# Lasso, Broker, and templates explained

**Service Lasso runs your services. Secrets Broker supplies their secrets. A template helps you package a service or build an app that uses them.**

Imagine a desktop app with a local API and a database. Users need all three to work together: the right versions installed, the database ready before the API starts, and credentials available without putting them in the repository. These components divide up that work.

## Service Lasso: run the services your app needs

Service Lasso reads a `services/` folder. Each service has a `service.json` describing where to get it, how to configure and start it, what it depends on, and how to check its health.

The runtime handles that lifecycle. You can control it from the CLI, HTTP API, or **Service Admin**, the companion browser UI. Your app chooses its services; Lasso follows their manifests.

**Use it when:** your app needs supporting services installed and managed together on a local machine.

[Try the demo](quick-start.md) · [Embed it in an app](runtime/README.md) · [Browse services](service-catalog.md)

## Secrets Broker: keep secret values out of service definitions

The component's name is **Secrets Broker** (`lasso-secretsbroker`, managed as `@secretsbroker`). It provides an encrypted local store and controlled access to secrets. A service declares the secret access it needs; Core resolves authorized references through Broker when preparing the service.

For the example app, the API can refer to a database credential rather than committing its value in `service.json`. Broker handles secret storage and access; Service Lasso handles service startup. Service Admin exposes the operator-facing controls.

**Use it when:** services need credentials, tokens, or other secret values as part of their configuration.

The local encrypted store is the Release 1 scope. External provider operations and automation have separate support and validation states; check the capability ledger before depending on them. Encrypted storage does not replace operating-system access controls or backups.

[Secrets Broker repository](https://github.com/service-lasso/lasso-secretsbroker) · [Secret access declarations](reference/service-secret-access-policy.md) · [Setup and recovery](reference/vault-key-bootstrap.md) · [Capability status](reference/secrets-capability-ledger.md)

## Service template: make a service Lasso can run

[`service-template`](https://github.com/service-lasso/service-template) is the starting point for a new `lasso-*` service repository. Use it to package your API, tool, or other service with a manifest and release artifacts that Lasso can acquire.

The flow is: **create the service repo → define `service.json` → publish and validate its artifacts → add the released manifest to your app**. The template helps create the service; it is not itself the running service manager.

**Use it when:** you want to add a service that is not already in the catalog.

[Create a service](service-authoring/overview.md) · [Create its release repository](service-authoring/03-create-release-repo.md) · [Manifest reference](reference/service-json-reference.md)

## App templates: build the app around Lasso

App templates are different from the service template. They show how a **Node, web, Electron, or Tauri app** consumes Service Lasso and supplies its own service inventory.

For the example desktop app, start with an Electron or Tauri app template. If its API needs a new service package, use `service-template` for that separate service repository.

[Choose an app template](reference-apps.md) · [See all companion projects](ecosystem/README.md)

## Where to start

| You want to… | Start here |
| --- | --- |
| See it work before choosing anything | [Run the demo](quick-start.md) |
| Run an existing service | [Service catalog](service-catalog.md) |
| Package your own service | [Service authoring](service-authoring/overview.md) |
| Build an app using Lasso | [App templates](reference-apps.md) |
| Understand secret storage and recovery | [Secrets Broker setup](reference/vault-key-bootstrap.md) |

[All documentation](README.md)

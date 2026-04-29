---
title: Service Authoring Overview
---

# Service Authoring Overview

Service authoring is the process for creating a Service Lasso service that can be installed, started, monitored, updated, and reused from another project.

Use this section when you are creating a new `service-lasso/lasso-*` service repo, updating an existing service repo, or adding a released service to an app or template.

## Outcome

A finished service has:

- a clear service type and ownership decision
- one canonical `service.json`
- release artifacts attached to a GitHub release
- checks that prove Service Lasso can acquire and use the service
- a pinned manifest in each consuming app or core baseline folder

## Follow This Order

1. [Plan the Service](01-plan-service.md): decide whether the service is core-owned, app-owned, a provider, a managed daemon, or provider-backed.
2. [Write `service.json`](02-write-service-json.md): define identity, artifacts, commands, env, dependencies, ports, health, and update policy.
3. [Create the Release Repo](03-create-release-repo.md): build the dedicated `lasso-*` repo, package artifacts, and publish release assets.
4. [Wire Consumers](04-wire-consumers.md): copy the released manifest into each app or baseline `services/<id>/service.json`.
5. [Validate and Release](05-validate-release.md): prove acquisition, startup, health, updates, and release outputs before calling the service ready.

## When to Use Reference Docs

The numbered pages are the process. Reference docs are for detail while doing a step:

- [service.json Reference](../reference/service-json-reference.md) for exact manifest fields.
- [Service Config Types](../reference/SERVICE-CONFIG-TYPES.md) for service shape examples.
- [Complete service.json Union Schema](../reference/SERVICE-JSON-COMPLETE-UNION-SCHEMA.md) for exhaustive schema review.
- [Runtime Provider Release Services Delivery Plan](../development/runtime-provider-release-services-delivery-plan.md) for current core provider release versions.
- [Create a New Lasso Service](../development/new-lasso-service-guide.md) for the full repo creation handoff.

## Rule of Thumb

If someone clones a consuming app, Service Lasso should be able to read that app's `services/<id>/service.json`, download the referenced release artifact when needed, and run or expose the service according to the manifest. If that is not true yet, the service is not ready.

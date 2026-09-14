# Service Admin Overview and Navigation

Service Admin is the browser UI for inspecting and controlling local Service Lasso services. It gives operators one place to review runtime health, service state, dependency posture, route metadata, safe logs, variables, Secrets Broker status, and local UI settings without reading raw manifests or command output first.

Status: mixed runtime-backed and metadata-only surface. Service Admin reads live Service Lasso runtime data where routes expose it, shows safe metadata where a page is intentionally inspection-only, and marks preview or local-preference behavior where no durable backend contract exists yet.

## How Service Admin relates to the runtime

The Service Lasso runtime owns service discovery, lifecycle state, health checks, actions, route metadata, and runtime API responses. Service Admin is the operator-facing UI layered over that runtime boundary. When a page is runtime-backed, the UI should show evidence operators can trust, such as service ids, health states, operation ids, timestamps, and runtime readiness signals.

Service Admin must not imply that a page is live or durable unless the runtime or service API proves it. For page-by-page backing status, start with [Product status and safety](product-status-and-safety.md).

## Primary navigation

| Navigation | What it is for | First related guide |
| --- | --- | --- |
| Dashboard | Runtime summary for service health, warnings, lifecycle posture, and recovery entry points. Check it first when the instance feels unhealthy. | [Product status and safety](product-status-and-safety.md) |
| Services | Search and inspect Service Lasso services, open service detail, and run supported lifecycle actions when the runtime exposes them. | [How to create a basic service](how-to-create-a-basic-service.md), [Service actions](service-actions.md) |
| Dependencies | Review service dependency and secret-ref relationships from safe metadata. Use it to understand what may be blocked before restarting or reconfiguring services. | [Product status and safety](product-status-and-safety.md) |
| Routes | Inspect service route metadata and internal endpoints. Treat route listings as configured reachability unless a runtime check proves the endpoint is reachable. | [Product status and safety](product-status-and-safety.md) |
| Logs | Read safe runtime log lines and log source metadata through the runtime boundary. Use logs after Dashboard or Runtime identify the affected service. | [Runtime and Logs Operator Runbook](runtime-and-logs-operator-runbook.md), [Product status and safety](product-status-and-safety.md) |
| Runtime | Inspect runtime health, readiness, version, and check history. Use this page to separate UI issues from runtime availability issues. | [Runtime and Logs Operator Runbook](runtime-and-logs-operator-runbook.md), [Health checks](health-checks.md) |
| Installed | Review installed service metadata, manifest paths, and local availability. Do not treat it as an installer unless a specific action provides that contract. | [Service install and setup config](service-install-and-setup-config.md) |
| Variables | Review global and service-local environment variable posture and secret-ref usage without exposing raw values. | [Environment Variables: Global and Service Reuse](environment-variables-global-and-service-reuse.md) |
| Network | Review endpoint, host, port, and exposure metadata for local services. Use it with Routes when a service is healthy but unreachable. | [Product status and safety](product-status-and-safety.md) |
| Operations / Inbox | Review durable operator notices from the runtime Inbox API, mark them read, hide or restore them, and open safe in-app targets. Toasts are not the durable record. | [Operations Inbox Operator Guide](operations-inbox-operator-guide.md) |
| Operations / Telemetry | Inspect runtime and Secrets Broker telemetry status metadata. This page does not configure exporters or reveal telemetry headers or tokens. | [Operations Telemetry Operator Guide](operations-telemetry-operator-guide.md), [Product status and safety](product-status-and-safety.md) |
| Operations / Audit | Inspect safe operation and broker audit metadata where exposed. Use operation ids, audit ids, timestamps, and outcomes as evidence. | [Product status and safety](product-status-and-safety.md) |
| Secrets Broker | Review local KV secrets, providers, topology, and guarded secret-management workflows. Broker ready and lockout counts live on Dashboard. Raw secret values and provider credentials stay out of the UI. | [Variables and Secrets Broker Safety Guide](variables-and-secrets-broker-safety-guide.md), [Product status and safety](product-status-and-safety.md) |
| Settings | Adjust local Service Admin preferences such as appearance. Do not assume identity, account, or notification durability without a live backend contract. | [Product status and safety](product-status-and-safety.md) |
| Help Center | Read operator guides and runbooks sourced from `docs/help/`. Use search when you already know the surface or symptom. | [Help Docs](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/help/README.md) |

## What to check first

When something looks wrong, start with the narrowest evidence that can prove where the problem lives:

1. Open Dashboard and check overall runtime status, Broker ready, lockout counts, problem services, and recovery prompts.
2. Open Runtime if Dashboard cannot load, looks stale, or reports runtime health warnings.
3. Open Services and the affected service detail to confirm lifecycle state, health, recent action results, and operation ids.
4. Open Dependencies when a service is blocked by another service, a secret ref, or startup order.
5. Open Logs for the affected service after you know which service or runtime check failed.
6. Open Variables and Secrets Broker when the failure mentions environment variables, secret refs, provider state, setup, policy, or reveal/rotation workflows.
7. Open Routes and Network when the service is healthy but an endpoint, host, or port is not reachable.
8. Open Operations / Audit when you need a trail of actions, outcomes, audit reasons, operation ids, or broker events.
9. Open Operations / Inbox when a toast or banner is gone and you still need the durable operator notice.

Keep support evidence metadata-only. Do not paste raw secrets, provider credentials, tokens, cookies, private keys, request bodies, response bodies, recovery material, or environment values into tickets, logs, or Help Center examples.

---

[Component guides](../README.md) · Imported from [lasso-serviceadmin](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/help/service-admin-overview-and-navigation.md). The [migration inventory](../documentation-migration.md) records ownership and remaining work.

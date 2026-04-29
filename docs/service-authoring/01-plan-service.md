---
id: 01-plan-service
title: 1. Plan the Service
---

# 1. Plan the Service

Start by deciding what the service is, who owns it, and how Service Lasso should treat it. Do this before creating release artifacts or writing a detailed manifest.

## Decide Ownership

Use these naming rules consistently:

| Decision | Rule | Example |
| --- | --- | --- |
| Core-owned service | service ID starts with `@` | `@node`, `@nginx`, `@serviceadmin` |
| App-owned service | service ID does not use `@` | `echo-service`, `worker-api` |
| GitHub repo | use `service-lasso/lasso-<name>` for shared service repos | `service-lasso/lasso-nginx` |
| Service folder | folder matches the service ID exactly | `services/@nginx/service.json` |

Only use `@` for core-owned Service Lasso services and providers.

## Choose the Service Shape

Pick one shape before writing `service.json`:

| Shape | Use when | Common fields |
| --- | --- | --- |
| Provider | The service supplies a runtime or tool to other services and should not run as a daemon. | `role: "provider"`, `artifact`, `globalenv` |
| Managed daemon | The service owns and runs its executable. | `artifact`, platform command, `ports`, `healthcheck` |
| Provider-backed app | The service runs through another provider such as `@node`, `@python`, or `@java`. | `execservice`, `executable`, `args`, `depend_on` |
| Optional app service | Consumers opt in and must configure it first. | `enabled: false`, explicit env/config notes |

For exact manifest fields, use the [service.json Reference](../reference/service-json-reference.md).

## Define the Consumer Contract

Record these decisions before implementation:

- Which apps or templates should include this service?
- Which ports and URLs does the service expose?
- Which env variables does it require or export?
- Which services must start before it?
- Which healthcheck proves it is ready?
- Which upstream runtime/tool version is being packaged?
- Which platforms are supported by the first release?

## Exit Criteria

Move to step 2 only when:

- service ID and ownership are settled
- service shape is selected
- runtime/tool version and platform support are known
- dependencies, ports, env, and health intent are clear

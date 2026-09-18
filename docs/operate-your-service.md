---
title: Configure and recover a service
---

# Configure and recover a service

Start with the [Beginner — Todo app](getting-started/beginner-todo-app.md), the [Intermediate — durable PostgreSQL step](getting-started/intermediate-make-todo-app-durable.md), or the [Admin demo](quick-start.md). Make one change, then repeat the same success check you used before the change.

## Change configuration

In Admin, open **Services**, select the service, and inspect its configuration and current endpoints. Stop the selected service before changing settings that require a restart. Apply the change, start it, and check both readiness and the consuming app. The [configuration guide](reference/service-config-editor-api.md) explains validation, previews, and apply results.

For the PostgreSQL example, use the maximum-connections exercise in the walkthrough. A requested port is a preference; the runtime's allocated endpoint is the connection detail your app needs.

## Declare a secret reference

Secrets Broker resolves a named reference for an authorized service. The manifest carries the reference and access policy; it should not carry the real value.

```json
{
  "env": { "DB_PASSWORD": "${database.PASSWORD}" },
  "broker": {
    "enabled": true,
    "imports": [{
      "namespace": "shared/database",
      "ref": "database.PASSWORD",
      "as": "DB_PASSWORD",
      "required": true
    }]
  }
}
```

This is the reference portion, not a complete service or permission grant. Follow the [service secret access policy](reference/service-secret-access-policy.md) to authorize only that service, namespace, reference, and resolve operation. Supply the value through the configured broker provider. Start the service and verify the app can authenticate; inspect presence and resolution status without printing the resolved value. A missing required reference should block startup rather than silently use a default.

The checked-in `node-sample-service` is a complete manifest example with generated-secret imports and explicit grants. Its generated-secret fixture also requires a configured Broker; a standalone PostgreSQL inventory does not include one.

## Understand a failure

1. **Identify the service.** In Admin's Services list, distinguish **Stopped** from a running process that fails health checks. Open the named service, not every log in the fleet.
2. **Read the latest attempt.** Open its Logs view and match the time to its last start. Note the first useful error and any failed dependency. Avoid copying whole logs containing application data.
3. **Take the matching action.** Use the table below, then start the service once.
4. **Prove recovery.** Wait for health/readiness, then repeat the app's functional check. For the example, run `npm run check`.

| Evidence | Recovery action |
| --- | --- |
| Address already in use | Inspect the allocated endpoint and owning process; choose a free preferred port and restart this service. |
| Missing required secret | Supply the reference through the authorized provider and check its grant; retry startup. |
| Dependency unhealthy | Repair the named dependency first, then retry the consumer. |
| Download or extraction failed | Check connectivity, platform asset, and pinned release; retry installation. |
| Database directory initialization error | Preserve existing data; verify the configured directory and use the example's dedicated first-run directory. |

For a deeper read-only diagnosis, use [runtime doctor](reference/runtime-doctor-status.md), [health history](reference/healthcheck-reference.md), and [dependency diagnostics](reference/baseline-dependency-diagnostics.md). Stop commands preserve state; resetting or deleting a workspace is not a routine recovery step.

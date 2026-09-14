# Service secret-access assignments

Status: metadata-only operator inspector. Service Admin shows live
`broker.accessPolicy` grants from installed service manifests. It does not
simulate Vault policy language and it never renders secret values.

This surface binds to Core
[`docs/reference/service-secret-access-policy.md`](https://github.com/service-lasso/service-lasso/blob/develop/docs/reference/service-secret-access-policy.md).
Admin does not invent a second policy model.

## What operators see

| Field | Source |
| --- | --- |
| Service id | `broker.accessPolicy.serviceId` or the manifest `id` |
| Namespace | `grants[].namespace` |
| Refs | `grants[].refs`, or `namespace-wide` when refs are omitted |
| Operations | `resolve`, `create`, `update`, `rotate`, `delete` |
| Purpose | `grants[].purpose` |
| Missing assignment | Core `GET /api/secrets/audit` for declared imports without a matching resolve grant |

Empty means no grants and no missing import assignments on this instance.
Unavailable means the runtime audit or service list could not be read.

## What this page is not

- Not Policy Simulation.
- Not a Vault playground.
- Not lockout, telemetry, or operational-controls (#118).
- Not a place that reveals, copies, or logs secret values.

---

[Component guides](../README.md) · Imported from [lasso-serviceadmin](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/help/security-secret-access-assignments.md). The [migration inventory](../documentation-migration.md) records ownership and remaining work.

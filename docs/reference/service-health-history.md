# Service Health History

Service Lasso records a bounded per-service health transition history in each service state directory.

## State File

Health transitions are persisted at:

```text
<service-root>/.state/health.json
```

The file contains:

- `serviceId`
- `updatedAt`
- `transitions[]`, capped to the most recent 50 entries by default

Each transition records:

- `status`: `healthy` or `unhealthy`
- `checkType`: `process`, `http`, `tcp`, `file`, `variable`, `provider`, or `unknown`
- `observed`: safe target metadata such as URL without query strings, TCP host/port, service-relative file path, or variable name
- `reason`: stable transition reason
- `detail`: bounded health summary
- `at`: observation timestamp

Repeated identical status/check/reason observations update `updatedAt` without appending another transition. A new transition is appended when health status, check type, or reason changes.

## API

```text
GET /api/services/{serviceId}/health
GET /api/services/{serviceId}/health/history
GET /api/services/{serviceId}
```

`GET /api/services/{serviceId}/health` evaluates the service health and records a transition when state changes. The response includes the current `health` result and the updated `history`.

`GET /api/services/{serviceId}/health/history` reads the persisted transition history without running a new health check.

Service detail responses include `service.healthHistory`.

## CLI

```text
service-lasso health history [serviceId] [--services-root <path>] [--workspace-root <path>] [--json]
```

Without `serviceId`, the command lists persisted health history for all discovered services.

## Regression Summary

Diagnostics bundles derive a compact health regression summary from recent persisted transitions. The summary includes:

- `firstFailure`: earliest unhealthy transition in the selected bundle scope, or `null`
- `latestState`: latest transition in the selected bundle scope, or `null`
- `flappingCount`: number of healthy/unhealthy status changes
- `impactedServiceIds`: services with any failure or flapping
- per-service transition count, first failure, latest state, flapping count, and impacted flag

## Safety

Health history is operator-facing metadata only. It must not store raw secret values, credential payloads, provider tokens, private keys, cookies, passwords, environment values, or recovery material.

HTTP observed targets strip query strings, fragments, and URL credentials before persistence. Variable health checks persist only a variable key when the expression is a simple `${NAME}` reference; other expressions are recorded as `<expression>`.

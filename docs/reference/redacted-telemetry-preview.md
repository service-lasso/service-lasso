# Redacted Telemetry Preview

Service Lasso exposes a read-only telemetry preview for the first OpenTelemetry-shaped core baseline:

```text
GET /api/telemetry
GET /api/services/{serviceId}/telemetry
POST /api/telemetry/export-test
```

The preview is metadata-only. It gives Service Admin and operators a stable contract for exporter status, trace/correlation identifiers, lifecycle spans, health-check spans, runtime metric signals, and a redacted OTLP export-readiness envelope before live OTLP export is enabled by default.

The runtime also includes a bounded in-memory `apiRequests` preview for recent operator/API request outcomes. These entries use route templates and status classes only, such as `/api/services/{serviceId}/health` and `2xx`; they do not include raw URL paths, query strings, headers, request bodies, or response bodies.

Every core API response also includes safe correlation headers:

```text
x-service-lasso-correlation-id
x-service-lasso-trace-id
```

The values match the corresponding `apiRequests[].signal.correlationId` and `apiRequests[].signal.traceId` entries in `/api/telemetry`, allowing Service Admin or support tooling to match an operator-visible response with the redacted telemetry preview without logging raw URLs, query strings, headers, request bodies, or response bodies.

## Redaction Contract

Telemetry attributes use an allowlist and value-level redaction. The API may return:

- service id, role, enabled state, version, artifact tag, and artifact asset name
- lifecycle booleans and last lifecycle action
- runtime provider id/provider service id
- health status, readiness, and blocking reason
- operation phase, outcome, and duration/count metadata
- safe API request metadata: HTTP method, route template, route group, mutating flag, response status code/status class, and duration
- trace id, span id, and Service Lasso correlation id

The API must not return raw secret values, environment values, provider credentials, cookies, authorization headers, private keys, recovery material, raw URL paths or query strings, raw request/response bodies, full file contents, or raw service config values.

Allowed string attributes are still checked for sensitive-looking content before they are returned or sent to the local mock collector. Bearer tokens, GitHub-style tokens, AWS access keys, private-key blocks, basic-auth URLs, sensitive key/value pairs, and Service Lasso secret regression sentinels are replaced with `[REDACTED]`. This prevents an otherwise allowed field such as service version, artifact metadata, health detail, or provider metadata from carrying secret-shaped values through the preview.

Exporter endpoint values, OTLP headers, and payload bodies are never returned. `/api/telemetry` only reports whether `SERVICE_LASSO_OTEL_ENABLED` and `OTEL_EXPORTER_OTLP_ENDPOINT` make export configured.

## Export Readiness Envelope

`/api/telemetry` includes an `exportPreview` object. It is safe status evidence, not a network exporter:

- `mode` is `disabled` by default.
- `mode` becomes `dry_run` only when `SERVICE_LASSO_OTEL_ENABLED` is enabled, `OTEL_EXPORTER_OTLP_ENDPOINT` is configured, and `SERVICE_LASSO_OTEL_EXPORT_MODE=dry-run`.
- `status` remains `not_sent`; this API does not send telemetry to the OTLP endpoint.
- `signalCount`, `serviceCount`, `allowedAttributeCount`, and `safeEnvelopeFields` describe the sanitized envelope that would be eligible for export.
- API request preview entries count as safe signals only after route/path values have been reduced to route templates.
- `endpointValueReturned`, `headersValueReturned`, and `bodyValueReturned` are always `false`.
- `droppedFieldClasses` repeats the redaction boundary so operators can see which categories stay out of the envelope.

## Local Mock Export Test

`POST /api/telemetry/export-test` is an explicit operator smoke-test action for a local mock collector. It is disabled by default and only sends when all of the following are true:

- `SERVICE_LASSO_OTEL_ENABLED` is enabled.
- `OTEL_EXPORTER_OTLP_ENDPOINT` is configured to a loopback HTTP(S) endpoint.
- `SERVICE_LASSO_OTEL_EXPORT_MODE=mock-collector`.

The action sends a sanitized OTLP-shaped JSON envelope made from the same allowlisted lifecycle, health, runtime, and API request metadata returned by the preview. It does not send raw paths, query strings, headers, request/response bodies, env values, config file contents, endpoint values, or operator-supplied OTLP headers.

The API response reports only safe proof fields: mode, status, protocol, signal count, service count, collector status code, local-only enforcement, and redaction booleans. It never returns the endpoint value, headers, or exported payload body.

## Scope

This is a preview/status contract plus a local mock-collector smoke path, not a production exporter. Normal telemetry export remains disabled by default. Follow-up work can connect production collector export once lifecycle/health/request events use this allowlisted attribute model and local mock export has been verified in the canonical demo.

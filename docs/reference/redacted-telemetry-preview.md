# Redacted Telemetry Preview

Service Lasso exposes a read-only telemetry preview for the first OpenTelemetry-shaped core baseline:

```text
GET /api/telemetry
GET /api/services/{serviceId}/telemetry
```

The preview is metadata-only. It gives Service Admin and operators a stable contract for exporter status, trace/correlation identifiers, lifecycle spans, health-check spans, runtime metric signals, and a redacted OTLP export-readiness envelope before live OTLP export is enabled by default.

The runtime also includes a bounded in-memory `apiRequests` preview for recent operator/API request outcomes. These entries use route templates and status classes only, such as `/api/services/{serviceId}/health` and `2xx`; they do not include raw URL paths, query strings, headers, request bodies, or response bodies.

## Redaction Contract

Telemetry attributes use an allowlist. The API may return:

- service id, role, enabled state, version, artifact tag, and artifact asset name
- lifecycle booleans and last lifecycle action
- runtime provider id/provider service id
- health status, readiness, and blocking reason
- operation phase, outcome, and duration/count metadata
- safe API request metadata: HTTP method, route template, route group, mutating flag, response status code/status class, and duration
- deterministic trace id, span id, and Service Lasso correlation id

The API must not return raw secret values, environment values, provider credentials, cookies, authorization headers, private keys, recovery material, raw URL paths or query strings, raw request/response bodies, full file contents, or raw service config values.

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

## Scope

This is a preview/status contract, not a full collector. It does not send telemetry to an OTLP endpoint during normal runtime execution yet. Follow-up work can connect real export once lifecycle/health events use this allowlisted attribute model and the dry-run envelope has been verified in the canonical demo.

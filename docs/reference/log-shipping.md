# Log Shipping Preview API

Service Lasso exposes a bounded log-shipping status surface at `GET /api/log-shipping`.

The endpoint is intentionally a preview/status contract. It lets Service Admin and operators see whether shipping is configured, which sources are in scope, whether runtime log samples can be redacted safely, and whether a dry-run envelope would be ready. The endpoint does not transmit logs.

## Configuration

Log shipping is disabled by default.

```powershell
$env:SERVICE_LASSO_LOG_SHIPPING_ENABLED = "1"
$env:SERVICE_LASSO_LOG_SHIPPING_SINK = "openobserve"
$env:SERVICE_LASSO_LOG_SHIPPING_ENDPOINT = "http://localhost:5080/api/default/default/_json"
$env:SERVICE_LASSO_LOG_SHIPPING_MODE = "dry-run"
```

Optional settings:

- `SERVICE_LASSO_LOG_SHIPPING_SINK`: `openobserve`, `generic-http`, `otlp-http`, or `filebeat`.
- `SERVICE_LASSO_LOG_SHIPPING_SOURCES`: comma-separated source set. Supported values are `core_runtime`, `service_runtime`, `service_admin_api`, `secrets_broker_audit`, and `health_release_deploy`. The default is `all`.
- `SERVICE_LASSO_LOG_SHIPPING_SPOOL_DIR`: marks a local spool path as configured without returning the path value from the API.

## Redaction Boundary

The preview response never returns sink endpoint values, headers, spool paths, payload bodies, raw environment values, provider credentials, private keys, cookies, authorization material, raw service config values, or unredacted secret regression sentinels.

Runtime-managed service log sample records are bounded and pattern-redacted before they are returned. External sources such as Service Admin API logs and Secrets Broker audit logs are represented as source coverage entries until their owning repos expose concrete safe adapters.

## Response Shape

The response is rooted at `logShipping` and includes:

- `sink`: configured sink type, endpoint/spool presence, retry policy, and status.
- `redaction`: forbidden field classes and pattern classes.
- `sources`: source coverage and queued-record estimates.
- `sampleRecords`: bounded redacted runtime-log samples.
- `redactionSelfTest`: deterministic redaction test proof for Service Admin to surface as a redaction status test action.
- `exportPreview`: dry-run envelope readiness and safe envelope fields.

`exportPreview.status` is always `not_sent` for this endpoint.

## Redaction Self-Test

`redactionSelfTest` is a deterministic proof object. It exercises representative secret, token, authorization, private-key, and basic-auth patterns through the same redaction helper used for runtime log samples. It returns only redacted output, pattern labels, counts, status, and boolean safety flags.

The self-test never returns test sentinel values, endpoint values, headers, spool paths, request/response bodies, raw environment values, credentials, or payload bodies. It is status evidence only; the endpoint still does not transmit records.

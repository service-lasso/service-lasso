# Operator Diagnostics Bundle

Service Lasso can export a redacted diagnostics bundle for the full baseline or one service.

## CLI

Command:

    service-lasso diagnostics bundle [serviceId|baseline] --services-root PATH --workspace-root PATH --output PATH --json

When serviceId is omitted, or when baseline is supplied, the bundle includes every discovered service. The command writes a deterministic folder with:

- manifest.json: bundle metadata and service summaries
- services/SERVICE_ID/summary.json: per-service manifest, state, update, recovery, and lifecycle evidence
- services/SERVICE_ID/logs.json: bounded redacted log excerpts

## API

Endpoints:

    GET /api/diagnostics/bundle
    GET /api/diagnostics/bundle?service=SERVICE_ID

The API returns the same redacted JSON shape as manifest.json.

## Redaction Contract

The bundle is operator evidence, not a secret export.

- Manifest env and globalenv values are summarized by key only.
- Token, password, private-key, cookie, auth, credential, and secret-bearing fields are replaced with [REDACTED].
- Common credential shapes in log excerpts are replaced.
- Log excerpts are bounded to the latest 40 non-empty lines per runtime log file.
- Runtime command strings are redacted because they may contain resolved environment or launch material.

The bundle may include safe metadata such as service ids, manifest paths, state paths, ports, dependency ids, artifact names, update/recovery status, health-adjacent lifecycle state, and redacted log context.

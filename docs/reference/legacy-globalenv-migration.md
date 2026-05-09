# Legacy globalenv migration planner

The legacy `env` / `globalenv` migration planner helps operators move existing secret-like configuration toward explicit Secrets Broker refs without exposing raw values.

The planner is metadata-only. It must never print or persist raw existing env values in plans, logs, diagnostics, screenshots, reports, GitHub comments, or PR bodies.

## What it scans

For each discovered service, the planner inspects:

- `env` entries: candidates that can be converted to service-local broker imports.
- `globalenv` entries: candidates that are reported with manual writeback guidance because global shared emission can affect multiple services.

Each key is classified as:

- `secret`: strong key-name match such as `PASSWORD`, `TOKEN`, `SECRET`, `API_KEY`, `CLIENT_SECRET`, `PRIVATE_KEY`.
- `ambiguous`: potentially sensitive key-name match such as `AUTH`, `CREDENTIAL`, `DSN`, `CONNECTION`, or generic `KEY`.
- `non-secret`: common non-secret names such as `PUBLIC_URL`, `BASE_URL`, `HOST`, `PORT`, `LOG_LEVEL`, `NODE_ENV`, or keys without secret-like patterns.

The value itself is never returned. Candidate metadata is limited to presence, length, fingerprint, and value kind (`literal`, `selector`, or `empty`).

## Dry-run output

A dry-run plan includes safe metadata only:

```json
{
  "serviceId": "api",
  "source": "env",
  "key": "DB_PASSWORD",
  "classification": "secret",
  "state": "planned",
  "metadata": {
    "present": true,
    "length": 32,
    "fingerprint": "1b7c4...",
    "valueKind": "literal"
  },
  "proposed": {
    "provider": "@secretsbroker",
    "backend": "local",
    "namespace": "services/api",
    "ref": "api.DB_PASSWORD",
    "as": "DB_PASSWORD",
    "required": true
  }
}
```

Denied or unsupported states remain explicit:

- `denied`: policy has blocked this key from automatic planning.
- `unsupported`: the source cannot be automatically migrated by this bounded planner, for example legacy `globalenv` writeback.
- `needs-confirmation`: ambiguous candidate; operator confirmation is required before apply.

## Before / after example

Before:

```json
{
  "env": {
    "DB_PASSWORD": "existing value hidden by planner",
    "PUBLIC_URL": "http://localhost:3000"
  }
}
```

Dry-run proposed change:

```json
{
  "env": {
    "DB_PASSWORD": "${api.DB_PASSWORD}",
    "PUBLIC_URL": "http://localhost:3000"
  },
  "broker": {
    "enabled": true,
    "imports": [
      {
        "namespace": "services/api",
        "ref": "api.DB_PASSWORD",
        "as": "DB_PASSWORD",
        "required": true
      }
    ]
  }
}
```

## Apply gate

Apply is intentionally separate from dry-run and requires:

1. explicit confirmation token: `APPLY_LEGACY_GLOBALENV_MIGRATION`
2. non-empty audit reason
3. optional `allowAmbiguous` for ambiguous candidates

Automatic apply only changes service-local `env` candidates. Legacy `globalenv` candidates stay manual because they may be shared across several services; operators should first write values into the chosen broker backend and validate every consumer before removing shared emission.

## Rollback guidance

Before applying, keep the original `service.json` for every affected service. Rollback is:

1. restore original `env` / `globalenv` entries
2. remove generated `broker.imports` for affected refs
3. keep affected services stopped until required refs are restored or the manifest rollback is complete
4. preserve the audit reason and dry-run plan with raw values redacted

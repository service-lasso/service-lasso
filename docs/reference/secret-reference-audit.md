# Secret Reference Audit

Service Lasso exposes a read-only secret reference audit so operators and API consumers can find services that depend on broker-managed secret refs without printing secret material.

## API

- GET /api/secrets/audit
- GET /api/services/SERVICE_ID/secrets/audit

The response includes service id, manifest path, reference metadata, location, status, and aggregate counts. It never includes resolved values, raw env values, provider credentials, tokens, passwords, or private-key material.

Reference statuses:

- present: the broker ref is declared in broker.imports, broker.exports, or broker.writeback.generatedSecrets.
- missing: a broker selector in namespace.key form is used in env, globalenv, install files, or config files but is not declared in broker policy.
- malformed: a secret-shaped selector is present but is not a supported broker ref in namespace.key form.

## CLI

Commands:

- service-lasso secrets audit --json
- service-lasso secrets audit SERVICE_ID --json

Human output prints aggregate counts only. JSON output returns the same safe metadata as the API.

## Scope

This audit is intentionally diagnostic. It does not resolve secrets, contact a provider, create a new broker, or validate runtime authorization. Broker enforcement remains the responsibility of the Secrets Broker integration and runtime execution path.

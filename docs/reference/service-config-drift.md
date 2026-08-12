# Service Configuration Drift

Service Lasso can compare a service manifest's desired generated config files with the current materialized files on disk without mutating runtime state.

## API

```http
GET /api/services/{serviceId}/config-drift
```

The response includes one drift report:

- `serviceId`, `checkedAt`, and `configured`
- `summary.total`, `summary.drifted`, `summary.unchanged`, `summary.changed`, `summary.missing`, and `summary.unmanaged`
- `files[]` entries with `path`, `absolutePath`, `status`, hashes, sizes, and redacted previews only when a file is drifted

Statuses:

- `unchanged`: the materialized file matches the manifest-rendered desired content.
- `changed`: the materialized file exists but differs from desired content.
- `missing`: the manifest still declares the file, but it is absent on disk.
- `unmanaged`: the previous config state recorded a materialized file that is no longer declared by the manifest.

## CLI

```powershell
service-lasso config-drift [serviceId] --json
```

Without a service id, the command reports every discovered service. The command is read-only.

## Safety

Drift output never returns full file bodies. File comparison uses SHA-256 hashes and bounded previews. Preview lines containing secret-like fields such as passwords, tokens, credentials, cookies, private keys, API keys, and DSNs are redacted before they are returned through the API or CLI.

The drift check does not run setup, install, config, repair, or lifecycle actions. A later repair/apply workflow should use a separate issue and require explicit operator confirmation.

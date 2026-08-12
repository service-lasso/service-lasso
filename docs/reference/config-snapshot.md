# Configuration Snapshot Export and Import

Status: initial CLI contract.

Service Lasso can export operator-safe service configuration snapshots and preview importing a snapshot without applying it.

## Commands

Export all discovered service configuration:

```powershell
service-lasso config-snapshot export --services-root ./services --workspace-root ./workspace --json
```

Export one service:

```powershell
service-lasso config-snapshot export @serviceadmin --services-root ./services --workspace-root ./workspace --json
```

Preview importing a snapshot:

```powershell
service-lasso config-snapshot import ./workspace/config-snapshots/service-lasso-config-snapshot-2026-05-27T00-00-00-000Z.json --services-root ./services --workspace-root ./workspace --json
```

The import command is dry-run only in this contract. It reports services that are unchanged, would be created, or would be updated, with version and manifest-diff reasons. It does not write manifests, state, logs, config files, or runtime data.

## Snapshot Contract

Snapshots are JSON documents with this shape:

```json
{
  "schemaVersion": "service-lasso.config-snapshot.v1",
  "createdAt": "2026-05-27T00:00:00.000Z",
  "runtimeVersion": "0.1.0",
  "policy": {
    "runtimeState": "excluded",
    "logs": "excluded",
    "rawSecrets": "redacted",
    "machineLocalPaths": "excluded",
    "importDefault": "dry-run"
  },
  "serviceCount": 1,
  "services": []
}
```

Each service entry uses paths relative to `servicesRoot` and includes a redacted `service.json` view. Snapshot files do not include `.state` runtime files, log file contents, workspace paths, service root absolute paths, process ids, or runtime health/lifecycle records.

## Secret-Safety Rules

Manifest `env` and `globalenv` values are redacted by key. Sensitive fields such as passwords, secrets, tokens, credentials, private keys, cookies, API keys, DSNs, generated content, stdout, and stderr are recursively replaced with `[redacted]`.

Because exported snapshots intentionally do not contain raw values, import currently produces a dry-run diff only. A future mutating import must require an explicit apply command and confirmation after a fresh preview.

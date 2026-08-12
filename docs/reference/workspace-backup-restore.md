# Workspace Backup and Restore Planning

Status: initial CLI contract.

Service Lasso can create a redacted snapshot of runtime-owned workspace state and preview restore implications without applying changes.

## Commands

Create a backup archive:

~~~powershell
service-lasso backup create --services-root ./services --workspace-root ./workspace --json
~~~

Preview a restore:

~~~powershell
service-lasso backup restore-plan ./workspace/backups/service-lasso-backup-2026-05-21T00-00-00-000Z.zip --services-root ./services --workspace-root ./workspace --json
~~~

The restore-plan command is read-only. It reports what would be overwritten or created, archive structure findings, redacted manifest compatibility, version mismatches, root mismatches, service count differences, target path conflicts, and unsupported backup schemas. It does not write service state, launch services, or overwrite files.

## Backup Archive Contract

Backups are zip archives with this root entry:

~~~json
{
  "schemaVersion": "service-lasso.workspace-backup.v1",
  "createdAt": "2026-05-21T00:00:00.000Z",
  "runtimeVersion": "0.1.0",
  "servicesRoot": "/app/services",
  "workspaceRoot": "/app/workspace",
  "policy": {
    "manifests": "redacted",
    "state": "redacted",
    "logContents": "excluded",
    "restore": "plan-only"
  },
  "serviceCount": 1,
  "services": []
}
~~~

Each service has:

- manifest.redacted.json
- redacted .state/*.json files when present
- logs.metadata.json with log paths and file sizes only

## Restore Dry-Run Report

`backup restore-plan --json` emits a machine-readable report with:

- `archive.manifestEntry`, `archive.structureOk`, and `archive.issues`
- per-service `operation` of `create` or `overwrite`
- per-service `targetPath`, `targetExists`, and `targetKind`
- per-service archive entry counts for redacted manifests, logs metadata, and expected state files
- per-service `manifestCompatibility` based on the redacted service manifest
- `blocked` reason codes such as `backup_manifest_missing`, `unsupported_backup_schema`, `<serviceId>:target_path_conflict`, `<serviceId>:redacted_manifest_missing`, and `<serviceId>:state_file_missing`

The report remains non-mutating even when `ok` is `false`.

## Secret-Safety Rules

Backup creation redacts manifest env and globalenv values and recursively redacts sensitive state fields such as passwords, secrets, tokens, credentials, private keys, cookies, generated content, stdout, and stderr.

Log file contents are excluded. Only log metadata is included.

Actual restore execution is intentionally not part of this contract. A later mutating restore command must require a fresh restore plan and explicit operator confirmation.

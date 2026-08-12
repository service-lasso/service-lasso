# Backup, File Export, and SFTP Export

_Status: design reference for Service Lasso backup and file movement behaviour._

This document defines the item 5 capability area:

- backup
- restore from backup
- selected file/folder export
- SFTP export

This replaces the older wording of “portable bundle import/export” for this capability area. Service Lasso may later have app/package bundle work, but this document is specifically about backing up and moving service files.

## Core distinction

Backup, file export, and SFTP export are related, but they are not the same thing.

| Capability | Meaning |
| --- | --- |
| Backup | Service-owned recovery artifact intended to be restorable. |
| Restore | Manual/gated action that mutates service state from a backup artifact. |
| File export | Operator-selected copy of service files/folders out of the workspace. |
| SFTP export | A delivery target for backup artifacts or selected file exports. |

The important rule:

```text
backup is a recovery operation
file export is a file movement operation
SFTP export is a transport/destination
```

## Ownership boundary

| Concern | Owner |
| --- | --- |
| Backup action contract | Service Lasso core / service manifest |
| Restore action contract | Service Lasso core / service manifest |
| Archive creation/extraction | `@archive` / `lasso-archive` provider using 7-Zip where available |
| Action execution, inputs, history and permissions | Service Lasso core |
| Scheduled backup workflow | Service Lasso action + Dagu generated workflow |
| File browsing and selected file export UI | `lasso-files` / Service Admin surface |
| Service workspace source provider | Service Lasso workspace files provider |
| SFTP destination adapter | Files/export integration layer |
| Backup artifact format and verification | Service Lasso core contract, service-specific implementation |

Dagu may schedule and run generated workflow tasks, but each task should call the Service Lasso action API. Dagu does not own backup semantics.

## Archive provider

Service Lasso already has an `@archive` utility provider backed by `lasso-archive`, which packages 7-Zip.

Backup and file export should use this provider where an archive operation is needed. Individual services should not each vendor their own archive implementation unless they need a service-specific backup format such as a database dump.

Default archive guidance:

- use `@archive` for generic workspace/folder/file archiving
- prefer `.7z` artifacts for Service Lasso-created archive backups/exports
- use service-native formats first when required for correctness, such as database dump formats
- allow the backup/export action to combine service-native dump output into a final `.7z` artifact
- record the archive tool/provider version in backup metadata where practical
- use `@archive` extraction for restore validation/extraction where practical

`@archive` should be treated as a provider dependency for archive-backed backup/export actions. If a service requires archive-backed backup, the action should fail clearly when the archive provider is unavailable rather than silently falling back to inconsistent host tools.

## Backup model

A backup is an action run that creates a durable artifact and records metadata.

A backup should record:

- service id
- action id
- run id
- created time
- selected scope
- included roots
- excluded roots
- artifact path or external destination reference
- artifact format, such as `.7z`
- archive provider/tool version when known
- size when known
- checksum when known
- service state before backup
- whether the service was stopped, paused or left running
- verification result

A backup may be service-specific. For example, a database service may use a dump command, while a file-based service may archive selected workspace folders through `@archive`.

## Restore model

Restore is an action, not a reverse export.

Restore must be manual or explicitly approved unless a future policy says otherwise.

Restore should normally:

- require confirmation
- validate the selected backup first
- require the service to be stopped, unless the service explicitly supports hot restore
- use `@archive` extraction for `.7z` artifacts where practical
- record exactly what was restored
- preserve or rotate existing state where practical
- emit audit/history events

Restore must not be scheduled by default.

## File export model

File export lets an operator export selected files or folders from a service workspace.

File export is not automatically a restorable backup. It may export only a subset of files and may not include enough metadata to safely restore the service.

File export should support:

- selected files
- selected folders
- include/exclude filters
- optional archive output through `@archive`
- optional `.7z` output
- optional checksum
- local download/output target
- external destination target, including SFTP

The Files surface should only expose service files through registered file sources. It should not allow arbitrary host filesystem browsing by default.

## Files UI archive flow

The Files UI may expose an “Archive folder” or “Archive selection” action for any allowed service workspace folder.

That UI action should not run 7-Zip directly in the browser or inside `lasso-files`. It should call the Service Lasso action/export API with the selected file source, folder path and archive options. Service Lasso then runs the archive operation through the normal action system and delegates the archive work to `@archive`.

Expected flow:

1. Operator selects a folder or file set in the Files UI.
2. Operator chooses “Archive folder” or “Archive selection”.
3. Files UI submits an archive/export action request to Service Lasso.
4. Service Lasso validates the source is inside an allowed service file source.
5. Service Lasso resolves the `@archive` provider.
6. `@archive` creates the `.7z` artifact.
7. Service Lasso records artifact metadata, checksum where practical, action history and audit.
8. UI shows the produced archive as downloadable, restorable/exportable when applicable, or available for SFTP export.

The archive action may be exposed as a file export action, a backup step, or a helper action used by backup/export workflows. The UI should label the result accurately: an arbitrary archived folder is a file export artifact, not necessarily a restorable service backup.

## SFTP export model

SFTP export is a destination adapter.

It can be used for:

- sending a backup artifact to a remote host
- sending a selected file export to a remote host
- copying logs or diagnostics bundles out of a service workspace

SFTP export should not define backup contents. It only receives an artifact or selected file set produced by another action/export step.

If the export is folder or multi-file based, the export flow should normally create a `.7z` artifact through `@archive` first, then send that artifact to SFTP.

Required SFTP destination inputs:

- host
- port
- username
- auth reference, preferably broker-backed
- remote path
- overwrite policy
- host key policy

Sensitive values must be supplied through broker refs or stored payload references, not plain manifest values.

## Action conventions

Backup, restore and export should use the generic action model.

Suggested action ids:

| Action id | Purpose |
| --- | --- |
| `backup` | Create a restorable service backup. |
| `backup-files` | Create an archive artifact from selected workspace files/folders, normally through `@archive`. |
| `verify-backup` | Verify a backup artifact before it is considered usable. |
| `restore` | Restore from a selected backup artifact. |
| `extract-backup` | Extract a backup artifact for validation or restore, normally through `@archive`. |
| `export-files` | Export selected service files/folders. |
| `archive-selection` | Archive a selected file/folder set through `@archive` for download or delivery. |
| `export-backup-sftp` | Send an existing backup artifact to SFTP. |
| `export-files-sftp` | Send a selected file export to SFTP. |

Actions may be simple command-backed actions or workflow actions with steps.

Example workflow shape:

```json
{
  "actions": {
    "backup": {
      "description": "Create a restorable service backup.",
      "mode": "workflow",
      "requiredServiceState": "any",
      "steps": [
        {
          "id": "quiesce",
          "type": "service-lasso-action",
          "actionId": "stop",
          "condition": "backup-requires-stopped-service"
        },
        {
          "id": "archive",
          "type": "service-lasso-action",
          "actionId": "backup-files"
        },
        {
          "id": "verify",
          "type": "service-lasso-action",
          "actionId": "verify-backup"
        },
        {
          "id": "resume",
          "type": "service-lasso-action",
          "actionId": "start",
          "run": "always",
          "condition": "was-running-before-workflow"
        }
      ]
    }
  }
}
```

## Inputs

Large or sensitive action inputs should use stored payload references.

For SFTP export, do not pass credentials inline. Pass a destination payload that references secrets through the broker.

Example input payload shape:

```json
{
  "source": {
    "type": "backup-artifact",
    "backupId": "backup-2026-07-02T02-00-00Z"
  },
  "destination": {
    "type": "sftp",
    "host": "backup.example.internal",
    "port": 22,
    "username": "service-lasso",
    "authRef": "broker://backup/sftp/private-key",
    "remotePath": "/backups/service-lasso/example/",
    "overwrite": "fail-if-exists"
  }
}
```

For a Files UI archive action, the source input should identify the registered file source and selected path rather than a raw host path.

Example source shape:

```json
{
  "source": {
    "type": "file-selection",
    "sourceId": "service-workspace",
    "serviceId": "example-service",
    "paths": ["runtime/data"],
    "archiveFormat": "7z"
  }
}
```

## Service workspace boundaries

Backup and export must respect service workspace boundaries.

Default allowed roots should be service-owned folders such as:

- service runtime state
- service data
- service logs when explicitly requested
- service config materialised by Service Lasso

Default excluded roots should include:

- downloaded provider/runtime binaries unless explicitly needed
- temporary folders
- cache folders
- secrets and credentials unless explicitly exported through a safe broker-backed flow
- host-global paths outside the service workspace

## Secrets handling

Backups and file exports must not leak secrets by accident.

Rules:

- secrets are excluded by default
- exported credentials must require explicit operator intent
- SFTP credentials must come from broker refs or stored payload refs
- action history must redact sensitive values
- backup metadata should record that secrets were excluded or intentionally included, without exposing secret values
- 7-Zip password/encryption options must not be used as a substitute for Service Lasso permission, broker and audit controls

## Audit and permissions

Backup, restore and export are durable operator actions and must be audited.

Minimum audit fields:

- actor
- service id
- action id
- run id
- source scope
- destination type
- artifact id/path/reference
- archive format/provider when applicable
- result
- timestamp
- confirmation state where applicable

Permission guidance:

| Operation | Permission level |
| --- | --- |
| Backup | service operator |
| Download/export selected files | service file read/export permission |
| Archive selected folder | service file read/export permission |
| Export to SFTP | service file export + destination permission |
| Restore | elevated/destructive action permission |
| Include secrets in export | explicit secrets/export permission |

## UI expectations

Service Admin and Files surfaces should make the difference clear:

- “Create backup” means produce a restorable artifact.
- “Restore backup” means mutate service state from a backup.
- “Export files” means copy selected files or folders.
- “Archive folder” means create an archive artifact from a selected folder using Service Lasso and `@archive`.
- “Export via SFTP” means choose SFTP as the delivery destination.

The UI should not label arbitrary file export as backup unless it uses the backup action and records backup metadata.

For archive-backed operations, the UI should show the archive format and provider where useful, for example `.7z via @archive`.

## Related docs

- `docs/reference/scheduled-service-actions.md`
- `docs/reference/service-action-inputs.md`
- `docs/reference/healthcheck-reference.md`

## Follow-up implementation areas

- Backup artifact registry/history.
- Archive-backed backup/export actions using `@archive`.
- Files UI “Archive folder” / “Archive selection” action.
- Restore validation and extraction through `@archive`.
- Files export action API.
- SFTP destination adapter.
- Restore validation and confirmation flow.
- UI surfaces for backup history and file export.
- Audit and permission checks for backup/export/restore.

# Scheduled Service Actions

_Status: design reference for the Service Lasso action/workflow contract._

This document defines the generic model for scheduled service operations.

The short version:

```text
Backup is an action.
Cron is a schedule attached to an action.
A scheduled action can expand into workflow steps.
Dagu runs the workflow tasks.
Each Dagu task calls a Service Lasso action API.
Service Lasso remains the source of truth for the action implementation.
```

## Ownership boundary

| Concern | Owner |
| --- | --- |
| Action definitions | Service Lasso / `service.json` |
| Action command, cwd, env, workspace and service state | Service Lasso |
| Action permissions, audit and history | Service Lasso |
| Schedule declaration | Service action in `service.json` |
| Managed workflow registry | Service Lasso |
| Workflow task scheduling and task run history | Dagu |
| Generated workflow sync | `lasso-dagu` |

Dagu may run the generated workflow tasks, but those tasks call Service Lasso APIs. Dagu does not become the source of truth for the service action implementation.

## Manifest model

Service actions can be simple single operations or workflow-style actions with steps.

```json
{
  "actions": {
    "backup": {
      "description": "Create a service backup.",
      "mode": "workflow",
      "requiredServiceState": "any",
      "concurrency": "skip-if-running",
      "steps": [
        {
          "id": "stop",
          "type": "service-lasso-action",
          "actionId": "stop",
          "condition": "was-running-before-workflow"
        },
        {
          "id": "backup",
          "type": "service-lasso-action",
          "actionId": "backup-files"
        },
        {
          "id": "verify",
          "type": "service-lasso-action",
          "actionId": "verify-backup"
        },
        {
          "id": "start",
          "type": "service-lasso-action",
          "actionId": "start",
          "run": "always",
          "condition": "was-running-before-workflow"
        }
      ],
      "schedules": [
        {
          "id": "nightly",
          "label": "Nightly backup",
          "enabled": true,
          "cron": "0 2 * * *",
          "timezone": "Australia/Melbourne"
        }
      ]
    },
    "backup-files": {
      "description": "Archive the service workspace backup roots.",
      "mode": "command",
      "commandline": {
        "win32": "scripts\\backup.ps1",
        "linux": "./scripts/backup.sh",
        "darwin": "./scripts/backup.sh",
        "default": "./scripts/backup.sh"
      },
      "cwd": "${SERVICE_ROOT}",
      "timeoutSeconds": 3600
    },
    "verify-backup": {
      "description": "Verify the backup artifact.",
      "mode": "command",
      "commandline": {
        "default": "./scripts/verify-backup.sh"
      },
      "cwd": "${SERVICE_ROOT}",
      "timeoutSeconds": 600
    }
  }
}
```

## Actions

An action may define:

- `description`: operator-facing explanation.
- `mode`: `built-in`, `command`, `workflow`, or `handler`.
- `commandline`: platform-specific command payload for command-backed actions.
- `args`: structured argument array when commandline is not needed.
- `cwd`: working directory resolved in the service context.
- `env`: service-local environment additions for the action run.
- `timeoutSeconds`: maximum run time.
- `requiredServiceState`: `any`, `running`, `stopped`, or `healthy`.
- `manualOnly`: prevents scheduled execution when true.
- `requiresConfirmation`: requires explicit operator confirmation for manual runs.
- `concurrency`: run overlap policy such as `skip-if-running`.
- `steps`: ordered workflow steps.
- `schedules`: cron schedules attached to the action.

## Workflow steps

A workflow-style action can contain steps.

Initial step types:

| Step type | Meaning |
| --- | --- |
| `service-lasso-action` | Call another Service Lasso action, usually on the same service. |
| `command` | Run an inline command through Service Lasso runtime rules. |
| `wait` | Wait for a service state, health state, delay or future condition. |

Recommended default: use `service-lasso-action` steps where possible. This keeps command definitions in Service Lasso actions and lets Dagu display workflow tasks without owning the actual command implementation.

Step fields:

- `id`: stable step id.
- `type`: step type.
- `serviceId`: optional target service id; defaults to current service.
- `actionId`: target action for `service-lasso-action` steps.
- `run`: `normal`, `on-success`, `on-failure`, or `always`.
- `condition`: optional condition such as `was-running-before-workflow`.
- `params`: optional action parameters.
- `timeoutSeconds`: optional step timeout.

## Schedules

Schedules are attached to actions, not a separate free-floating cron list.

Schedule fields:

- `id`: stable schedule id.
- `label`: operator-facing label.
- `enabled`: whether the schedule is active.
- `cron`: cron expression.
- `timezone`: explicit timezone or inherited app timezone.
- `concurrency`: schedule-level overlap policy.
- `onFailure`: failure policy.
- `params`: optional parameters passed into the action/workflow.

## Managed workflow registry

Service Lasso publishes scheduled action workflows for Dagu to consume.

Example registry entry:

```json
{
  "id": "minecraft.backup.nightly",
  "managedBy": "service-lasso",
  "serviceId": "minecraft",
  "actionId": "backup",
  "scheduleId": "nightly",
  "cron": "0 2 * * *",
  "enabled": true,
  "checksum": "sha256:example",
  "steps": [
    {
      "id": "stop",
      "type": "service-lasso-action",
      "serviceId": "minecraft",
      "actionId": "stop"
    },
    {
      "id": "backup",
      "type": "service-lasso-action",
      "serviceId": "minecraft",
      "actionId": "backup-files"
    },
    {
      "id": "start",
      "type": "service-lasso-action",
      "serviceId": "minecraft",
      "actionId": "start",
      "run": "always",
      "condition": "was-running-before-workflow"
    }
  ]
}
```

`lasso-dagu` mirrors this into generated Dagu workflows. Managed Dagu workflows should carry enough metadata to detect drift and to keep manually-authored Dagu workflows separate.

## Dagu task execution

Each generated Dagu task calls the Service Lasso action-run API.

```text
POST /api/services/:serviceId/actions/:actionId/runs
```

Example payload:

```json
{
  "source": "dagu",
  "workflowId": "minecraft.backup.nightly",
  "scheduleId": "nightly",
  "stepId": "backup",
  "parentActionId": "backup"
}
```

Service Lasso records both the individual action result and the parent workflow context.

## Backup and restore guidance

Backup is just an action, usually schedule-enabled.

For the broader item 5 contract covering backup, restore, selected file export and SFTP export, see `docs/reference/backup-file-export-sftp.md`.

Restore is also an action, usually manual/gated. Restore actions normally receive selected file inputs from the Files surface or backup history.

```json
{
  "actions": {
    "restore": {
      "description": "Restore selected backup files.",
      "mode": "command",
      "manualOnly": true,
      "requiresConfirmation": true,
      "requiredServiceState": "stopped",
      "commandline": {
        "default": "./scripts/restore.sh"
      }
    }
  }
}
```

Restore should not be scheduled by default. It should validate selected input files before mutating the service workspace.

## Related implementation issues

- service-lasso/service-lasso#782
- service-lasso/service-lasso#783
- service-lasso/service-lasso#784
- service-lasso/lasso-dagu#5
- service-lasso/lasso-dagu#6

# Service Action Inputs

_Status: design reference for Service Lasso action input payloads._

Service actions may require inputs. The action name is only a label/id; the generic model is:

```text
service action + input payload + execution policy
```

This supports actions such as:

- backup
- restore
- import
- export
- seed
- migrate
- repair
- validate
- clear-cache

## Input forms

Service Lasso supports two input forms:

| Form | Purpose |
| --- | --- |
| Inline inputs | Small, safe values passed directly in the action-run payload. |
| Input references | Larger or safety-critical input payloads stored in Service Lasso and passed by id. |

Both forms are valid. Service Lasso validates both before the action runs.

## Inline inputs

Inline inputs are useful for small explicit values, especially in Git-controlled or custom Dagu workflows.

Example:

```json
{
  "source": "dagu",
  "workflowId": "custom.minecraft-export-world",
  "stepId": "export-world",
  "inputs": {
    "world": "survival",
    "format": "zip",
    "includeLogs": false
  }
}
```

Inline inputs are suitable for:

- mode flags
- dry-run booleans
- small option values
- non-sensitive names/ids
- custom Git-controlled Dagu workflow parameters

## Input references

Input references are preferred when the payload is large, selected interactively, or needs a stronger audit trail.

Example:

```json
{
  "source": "dagu",
  "workflowId": "minecraft.restore.manual",
  "stepId": "restore",
  "parentActionId": "restore",
  "inputRef": {
    "type": "service-lasso-action-input",
    "id": "restore_req_123"
  }
}
```

Input references are suitable for:

- selected file lists
- backup artifact selections
- checksums
- restore requests
- preflight output
- operator reason text
- permission/audit context
- payloads that should not be copied into Dagu workflow files or Dagu logs

## Restore example

Restore is not a special runtime primitive. It is an action with an input contract.

```json
{
  "actions": {
    "restore": {
      "label": "Restore",
      "description": "Restore from selected backup files.",
      "mode": "workflow",
      "manualOnly": true,
      "requiresConfirmation": true,
      "input": {
        "mode": "inline-or-reference",
        "preferReference": true,
        "allowInline": ["mode", "dryRun"]
      },
      "steps": [
        {
          "id": "preflight",
          "type": "service-lasso-action",
          "actionId": "restore-preflight"
        },
        {
          "id": "apply",
          "type": "service-lasso-action",
          "actionId": "apply-restore"
        }
      ]
    }
  }
}
```

A Service Admin restore flow should normally create an input reference first:

```json
{
  "id": "restore_req_123",
  "serviceId": "minecraft",
  "actionId": "restore",
  "createdBy": "operator",
  "reason": "Restore selected world backup",
  "inputs": {
    "mode": "replace",
    "dryRun": false,
    "files": [
      {
        "sourceId": "service-lasso-workspaces",
        "serviceId": "minecraft",
        "rootId": "backups",
        "path": "world-2026-07-02.zip",
        "checksum": "sha256:example"
      }
    ]
  }
}
```

Dagu then receives only the reference id and calls Service Lasso action APIs with that reference.

## Managed Service Lasso workflows

For generated Service Lasso workflows, prefer input references when action input comes from operator selection or Service Lasso state.

```text
Service Admin
  operator selects files
  Service Lasso creates inputRef
  Dagu runs generated workflow tasks
  each Dagu task calls Service Lasso with inputRef
```

## Custom Git-controlled Dagu workflows

Custom Dagu workflows may pass proper inline input values directly to Service Lasso action APIs.

```text
Git-controlled Dagu workflow
  task calls Service Lasso action API
  task passes inline inputs
  Service Lasso validates inputs
  Service Lasso runs the action
```

This lets advanced users write custom Dagu flows without bypassing Service Lasso execution policy.

## Action-run API payload

Action runs should support both `inputs` and `inputRef`.

```json
{
  "source": "dagu",
  "workflowId": "custom.minecraft-export-world",
  "stepId": "export-world",
  "inputs": {
    "world": "survival",
    "format": "zip"
  },
  "inputRef": {
    "type": "service-lasso-action-input",
    "id": "optional_ref"
  }
}
```

When both are present, Service Lasso should merge only according to the action input policy. A safe default is:

```text
inputRef supplies the main payload
inline inputs may override only explicitly allowed fields
```

## Runtime requirements

Service Lasso must:

- validate action inputs before execution
- reject fields not allowed by the action input policy
- resolve input references before the action runs
- record the input reference id and allowed inline metadata in action history
- avoid copying large or high-risk payloads into generated workflow files
- expose clear diagnostics when required inputs are missing

## Related implementation issues

- service-lasso/service-lasso#784
- service-lasso/service-lasso#782
- service-lasso/service-lasso#783
- service-lasso/lasso-dagu#5
- service-lasso/lasso-dagu#6

# Service Action Inputs

_Status: first runtime contract for generic action payloads._

Service actions can opt in to typed payloads for manual API calls and workflow engines. The action declaration owns the payload policy. A run request can then provide an inline payload, a reference to a stored payload, or both when the action explicitly allows mixed values.

## Manifest Policy

Declare payload support under `actions.<actionId>.payload`:

```json
{
  "actions": {
    "backup": {
      "mode": "command",
      "command": "node",
      "args": ["runtime/backup.mjs"],
      "payload": {
        "inline": true,
        "references": true,
        "allowMixed": true,
        "required": true,
        "schema": {
          "type": "object",
          "required": ["retainDays"],
          "additionalProperties": false,
          "properties": {
            "retainDays": { "type": "integer" },
            "mode": { "type": "string" }
          }
        },
        "recordInlineFields": ["retainDays", "mode"]
      }
    }
  }
}
```

Fields:

- `inline`: permits request body `payload` values.
- `references`: permits request body `payloadRef` values.
- `allowMixed`: permits both `payload` and `payloadRef` in one run. Inline values override referenced values.
- `required`: rejects runs without either payload source.
- `schema`: JSON-schema-style object validation for the resolved payload.
- `recordInlineFields`: whitelist of inline payload fields that may be recorded in action history.

## Run Requests

Inline payload:

```json
{
  "source": "manual",
  "payload": {
    "retainDays": 7,
    "mode": "full"
  }
}
```

Stored payload reference:

```json
{
  "source": "dagu",
  "workflowId": "minecraft.backup.nightly",
  "scheduleId": "nightly",
  "payloadRef": "nightly-backup"
}
```

Mixed payload:

```json
{
  "payloadRef": "nightly-backup",
  "payload": {
    "mode": "incremental"
  }
}
```

Stored payload references resolve from `<service-root>/.state/action-payloads/<payloadRef>.json`. Reference ids may contain letters, numbers, dot, dash, and underscore.

## Runtime Environment

Action processes receive:

- `SERVICE_LASSO_ACTION_PAYLOAD`: resolved payload JSON object.
- `SERVICE_LASSO_ACTION_PAYLOAD_REF`: stored reference id, or empty string.
- `SERVICE_LASSO_ACTION_PAYLOAD_SOURCE`: `none`, `inline`, `reference`, or `mixed`.
- `SERVICE_LASSO_ACTION_INLINE_METADATA`: whitelisted inline metadata JSON object.

## History

Action history records only the reference and whitelisted inline metadata:

```json
{
  "source": "mixed",
  "referenceId": "nightly-backup",
  "inline": {
    "mode": "incremental"
  }
}
```

The full resolved payload is not stored in history.

# Operator Command Facade

Service Lasso exposes a local read-only command facade for chat and automation bridges:

```http
POST /api/operator/commands
```

The endpoint accepts a small command request:

```json
{
  "command": "service @serviceadmin logs --tail 20",
  "args": [],
  "serviceId": "@serviceadmin",
  "tail": 20,
  "actor": {
    "source": "chat-bridge",
    "channel": "telegram",
    "chatId": "-5128051597",
    "senderId": "42",
    "senderDisplay": "Operator",
    "sourceMessageId": "1001",
    "roles": ["operator"]
  }
}
```

Supported first-slice commands:

| Command | Class | Behavior |
| --- | --- | --- |
| `status` | `read` | Summarizes runtime service counts and top operator notifications. |
| `services` | `read` | Lists service ids, lifecycle state, health, port metadata, and safe counts. |
| `service <id> status` | `read` | Returns one service summary. |
| `service <id> logs --tail N` | `read` | Returns the current runtime log tail only when `N` is between 1 and 80. |
| `updates check --plan` | `plan` | Reports the update-check target set without checking, downloading, or installing. |
| `diagnostics bundle --preview` | `plan` | Returns diagnostics bundle preview metadata, not bundle contents. |
| `restart <id> --plan` | `plan` | Returns restart safety and orchestration planning metadata without restarting. |

Responses use contract version `operator-command.v1` and include:

- `ok`, `statusCode`, `command`, and stable error `code` values.
- `commandClass`: `read`, `plan`, or `blocked`.
- `summary`: compact operator-facing text.
- `data`: structured payload for OpenClaw or another bridge to render.
- `safety`: redaction/truncation flags and omitted sensitive field classes.
- `audit`: the persisted audit metadata for the command.

Actor metadata is optional for local API/shell callers. When omitted, Service Lasso records `source: "api"` and `actorId: "api:local"`. Chat bridge callers must send `actor.source: "chat-bridge"` with `channel`, `chatId`, and `senderId`.

Chat-originated actor metadata is accepted only from a trusted local bridge request. Configure the local runtime with `SERVICE_LASSO_CHAT_BRIDGE_TOKEN` and send the matching value in the `X-Service-Lasso-Chat-Bridge-Token` header. The token itself is not included in command responses or audit records.

Audit events are appended to:

```text
<workspaceRoot>/.state/operator-command-audit.jsonl
```

Audit records include the normalized actor, command, read/plan/blocked class, target service id when present, status code, stable error code, redaction/truncation flags, and future `planId`/`confirmationId` fields. Audit records must stay metadata-only.

Unsupported commands, unknown services, mutating commands without `--plan`, and invalid or unbounded log tails fail closed with a 4xx response. The facade does not handle Telegram SDK details, allowlists, or confirmation tokens; those stay in the OpenClaw bridge and later confirmation-token work.

The facade must not return raw environment values, secrets, provider credentials, tokens, cookies, private keys, or diagnostic payload contents. Log output is bounded, redacted, and marked when redaction or truncation occurred.

## Mutating Command Confirmations

Chat or automation bridges can issue a short-lived confirmation record after they have shown a fresh dry-run plan to the operator:

```http
POST /api/operator/confirmations
```

```json
{
  "command": "restart @serviceadmin",
  "actor": {
    "source": "chat-bridge",
    "channel": "telegram",
    "chatId": "-5128051597",
    "senderId": "42",
    "sourceMessageId": "1001"
  },
  "planId": "restart-plan-2026-05-29T00:00:00Z",
  "plan": {
    "dryRun": true,
    "serviceId": "@serviceadmin"
  },
  "expiresInSeconds": 300
}
```

The response returns `operator-command-confirmation-response.v1`, the pending confirmation metadata, and a short confirmation phrase such as `confirm restart @serviceadmin`. The persisted public record stores only metadata and plan/capability fingerprints; it does not store the raw plan or the bridge credential.

To confirm, the bridge must send the same actor, the same dry-run plan, and the exact phrase before expiry:

```http
POST /api/operator/confirmations/{confirmationId}/confirm
```

Confirmation fails closed when the actor changes, the phrase does not match, the plan changes, the record expires, the record is no longer pending, or the target service capability/lifecycle fingerprint changes. Audit events are appended to:

```text
<workspaceRoot>/.state/operator-command-confirmation-audit.jsonl
```

Confirmation audit records are metadata-only and include the event kind, result status, stable error code when denied, actor id, chat metadata, command, target service id, and plan id.

After confirmation, the same trusted actor can execute the confirmed mutation through the guarded handoff endpoint:

```http
POST /api/operator/confirmations/{confirmationId}/execute
```

```json
{
  "actor": {
    "source": "chat-bridge",
    "channel": "telegram",
    "chatId": "-5128051597",
    "senderId": "42",
    "sourceMessageId": "1001"
  },
  "plan": {
    "dryRun": true,
    "serviceId": "@serviceadmin"
  }
}
```

Execution requires a confirmed, unexpired, unused record for the same actor and the same plan fingerprint. Service capability/lifecycle state is checked again immediately before the lifecycle action runs. A successful handoff marks the confirmation `executed`, appends an `executed` confirmation audit event, and returns the lifecycle action response. Reuse, actor mismatch, plan drift, expiry, or capability drift fail closed.

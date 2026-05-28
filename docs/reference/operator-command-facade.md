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
  "tail": 20
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

Unsupported commands, unknown services, mutating commands without `--plan`, and invalid or unbounded log tails fail closed with a 4xx response. The facade does not handle Telegram SDK details, allowlists, or confirmation tokens; those stay in the OpenClaw bridge and later confirmation-token work.

The facade must not return raw environment values, secrets, provider credentials, tokens, cookies, private keys, or diagnostic payload contents. Log output is bounded, redacted, and marked when redaction or truncation occurred.

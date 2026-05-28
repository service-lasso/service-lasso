# Telegram Group Control Plan

Service Lasso should support Telegram group operation through an OpenClaw-mediated command path first. Direct Telegram bot handling inside the Service Lasso runtime is a later option only if the mediated path cannot meet local-first operation, authorization, audit, and confirmation requirements.

## Recommended Path

The first implementation should route Telegram messages through OpenClaw, then call Service Lasso over the existing local API/CLI boundary.

OpenClaw owns:

- Telegram chat delivery, message parsing, and reply formatting.
- Telegram chat id and user id allowlists.
- Human-readable confirmation prompts and short-lived confirmation tokens.
- Mapping Telegram senders to a Service Lasso actor identity.

Service Lasso owns:

- Operator-safe command execution over existing runtime APIs and CLI commands.
- Capability checks for the requested action.
- Dry-run plans for mutating commands.
- Audit records for chat-originated reads, plans, confirmations, and mutations.
- Structured, redacted response payloads that can be rendered safely in a group chat.

This keeps Service Lasso independent of Telegram SDK details and reuses the existing local operator model. It also lets other chat or automation frontends use the same command contract later.

## Command Classes

The first command set should be read-only or planning-only:

| Command | Service Lasso source | Notes |
| --- | --- | --- |
| `status` | `GET /api/operator/notifications`, dashboard summary | Summarize critical/warning/info counts and top current blockers. |
| `services` | `GET /api/services` | List service id, running state, health, and current port/url metadata. |
| `service <id> status` | service detail, health, readiness | Return one safe service summary. |
| `service <id> logs --tail N` | runtime log API | Require bounded `N`; redact and truncate output. |
| `updates check --plan` | update discovery and dry-run/install plan surfaces | Report available updates without installing. |
| `diagnostics bundle --preview` | diagnostics bundle preview | Report what would be included, not the bundle contents. |
| `restart <id> --plan` | restart safety preflight and dry-run plan | Planning only in the first pass. |

Mutating commands must not run in the first Telegram slice. Later mutating support must use a fresh dry-run response, an explicit confirmation prompt, a short expiry, and a Service Lasso audit event tying the action to the mapped actor and Telegram message context.

## Authorization And Identity

Telegram authorization is two-layered:

- Chat-level allowlist: only configured Telegram group ids can invoke Service Lasso commands.
- Sender-level allowlist: only configured Telegram user ids can invoke commands, with optional role mapping.

OpenClaw should map the Telegram sender to a Service Lasso actor envelope before calling Service Lasso:

~~~json
{
  "channel": "telegram",
  "chatId": "-5128051597",
  "senderId": "123456789",
  "senderDisplay": "operator",
  "serviceLassoActor": "telegram:123456789",
  "roles": ["operator"]
}
~~~

Service Lasso should trust only a locally configured OpenClaw bridge or explicit local token, not arbitrary remote Telegram metadata. Runtime API calls should include safe actor headers or a local bridge credential so audit records can distinguish shell, web UI, and chat-originated activity.

## Confirmation Model

Mutating or high-risk commands require a two-step flow:

1. Generate a read-only plan with blockers, affected services, expected state changes, and an expiry.
2. Confirm the exact plan id from the same authorized Telegram user before expiry.

The confirmation prompt must include the action, affected service ids, risk level, plan expiry, and a short confirmation phrase or button. Confirmation must fail closed if the plan is stale, the sender changes, capabilities change, or the Service Lasso runtime state no longer matches the plan preconditions.

## Telegram Output Contract

Group replies should be compact and deterministic:

- One summary line with status, service count, or action result.
- A short table or bullet list for the most important items.
- Links or local URLs only when they are already operator-facing and safe.
- Truncated logs with line count and truncation marker.
- No raw environment values, secrets, provider credentials, tokens, cookies, private keys, diagnostic payloads, or full support bundles.

OpenClaw may format responses for Telegram, but Service Lasso should return structured fields and safety metadata rather than pre-rendered Telegram markdown.

## Audit Requirements

Every chat-originated command should leave durable metadata:

- command name, command class, and target service ids.
- mapped actor, Telegram chat id, Telegram sender id, and message id where available.
- request time, result status, and safe error code.
- dry-run plan id and confirmation id for mutating flows.
- redaction/truncation flags for log or diagnostic output.

Audit records must not store raw command output when the output can include logs, env values, credentials, secret material, or diagnostic payloads.

## Cross-Repo Dependencies

- `service-lasso/service-lasso`: define the command contract, safe response shapes, actor envelope, confirmation/audit API, and first read-only command facade.
- `service-lasso/work-agents`: track OpenClaw bridge work and operational rollout tasks.
- `service-lasso/lasso-serviceadmin`: no first-slice dependency; later UI work may display chat-originated audit events.
- `service-lasso/lasso-secretsbroker`: no first-slice dependency; any future secret-related chat command must stay metadata-only unless Secrets Broker exposes an explicit safe contract.

## Non-Goals

- Direct Telegram bot handling inside the Service Lasso runtime.
- Exposing the Service Lasso runtime API to the public internet.
- Running mutating commands from Telegram without dry-run and confirmation.
- Returning raw logs, diagnostic bundles, secrets, env values, tokens, provider credentials, or private keys in group chat.
- Replacing the local CLI, API, or Service Admin UI.

## Implementation Slices

1. Add a read-only Service Lasso command facade for chat/automation clients: service-lasso/service-lasso#558.
2. Add a chat-origin actor envelope and audit event contract: service-lasso/service-lasso#559.
3. Add OpenClaw bridge work to parse Telegram commands, enforce allowlists, call the local Service Lasso facade, and render compact replies: service-lasso/work-agents#21.
4. Add a later confirmation-token flow for mutating commands after the read-only path is proven: service-lasso/service-lasso#560.

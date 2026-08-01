# Operator Inbox API

Service Lasso owns the durable operator Inbox. Service Admin and workflow producers should use the runtime APIs below instead of storing Inbox state in the UI.

Inbox records are persisted under the workspace `.state` directory and survive Service Admin refreshes and runtime restarts. Records store safe metadata only. Raw secrets, credentials, provider tokens, cookies, private keys, passwords, bearer tokens, and raw payloads must be excluded or redacted before persistence.

## Item Model

Each item uses the `service-lasso.operator-inbox-item.v1` shape:

- `id`: stable runtime id derived from `dedupeKey`
- `dedupeKey`: producer-owned key used to upsert recurring notices
- `title`, `summary`, `details`: bounded human-readable text
- `type`: `system`, `workflow`, `service`, `update`, `security`, `help`, or `error`
- `severity`: `info`, `success`, `warning`, `error`, or `critical`
- `source`: `runtime`, `service`, `workflow`, `updater`, `broker`, `admin-ui`, or `system`
- `state`: `unread` or `read`
- `visibility`: `visible` or `hidden`
- `createdAt`, `updatedAt`, `readAt`, `hiddenAt`
- `relatedTarget`: optional safe references such as `serviceId`, `workflowId`, `updateId`, `auditId`, `backupExportId`, or `route`
- `action`: optional action metadata with `label`, `target`, `kind`, and `availability`

## Routes

```text
GET  /api/operator/inbox
GET  /api/operator/inbox/:id
GET  /api/operator/inbox/counts
POST /api/operator/inbox/record
POST /api/operator/inbox/:id/read
POST /api/operator/inbox/:id/unread
POST /api/operator/inbox/:id/hide
POST /api/operator/inbox/:id/unhide
POST /api/operator/inbox/bulk
```

`GET /api/operator/inbox` supports `filter`, `type`, `state`, `visibility`, `severity`, `source`, `limit`, and `cursor`.

Supported `filter` values are:

- `all`: visible items
- `unread`: visible unread items
- `updates`: visible update items
- `system`: visible system items
- `workflow`: visible workflow items
- `service`: visible service items
- `errors`: visible error or critical items
- `hidden`: hidden items

`POST /api/operator/inbox/record` upserts an item by `dedupeKey`. Existing read/hidden state is preserved while title, summary, details, severity, target, and action metadata refresh.

`POST /api/operator/inbox/bulk` accepts:

```json
{
  "action": "read",
  "ids": ["inbox-update-core-available"]
}
```

Bulk mutation is intentionally limited to `read` and `hide`, so broad UI actions cannot accidentally restore or unread important records.

## Service Admin Contract

Service Admin should use:

- `GET /api/operator/inbox?filter=unread` for unread menus and badges
- `GET /api/operator/inbox/counts` for header/sidebar counts
- `POST /api/operator/inbox/:id/read` when an operator opens or acknowledges an item
- `POST /api/operator/inbox/:id/hide` for dismiss actions that should be restorable
- `GET /api/operator/inbox?filter=hidden` and `POST /api/operator/inbox/:id/unhide` for restore surfaces

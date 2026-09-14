---
title: Operations Inbox Operator Guide
description: Open durable operator notices at Operations / Inbox, mark them read, hide or restore them, and follow safe in-app targets.
status: runtime-backed
tags: ["inbox", "operations", "notices", "updates"]
---

# Operations Inbox Operator Guide

Status: runtime-backed. **Operations / Inbox** at `/inbox` reads durable
operator notices from Service Lasso `GET /api/operator/inbox` and
`GET /api/operator/inbox/counts`. Mark-read, hide, and restore call the matching
runtime mutation routes. Toasts and banners may still show immediate feedback;
the Inbox is the record you can reopen later.

Use this guide with [Runtime and Logs Operator Runbook](runtime-and-logs-operator-runbook.md),
[Operations Audit Operator Guide](operations-audit-operator-guide.md), and
[Product status and safety](product-status-and-safety.md).

## How To Open Inbox

Open Inbox from any of these operator surfaces:

- Sidebar **Operations → Inbox**
- Header **Inbox** chip, which also shows an unread count when the runtime
  counts API is available
- Direct route `/inbox`

If the unread badge is missing, the runtime Inbox API is unavailable or the
unread count is zero. A missing badge is not proof that notices were never
recorded.

## What Inbox Shows

Each row is a durable operator notice. Safe fields include title, summary,
optional details, type, severity, unread or read state, and the recorded time.

Typical types include system, workflow, service, update, security, help, and
error notices. Examples that Core already emits include runtime startup, service
health transitions, workflow outcomes, package update available or installed,
and diagnostics archive completion.

The page does not invent notices. If Core has not recorded an event, Inbox will
not show it.

## Unread, Read, All, And Hidden

Use the filter buttons above the list:

| Filter | What it lists |
| --- | --- |
| Unread | Visible notices that still need operator review. This is the default view. |
| Read | Visible notices already marked read. |
| All | Every visible notice, unread and read. |
| Hidden | Notices hidden from the default list. They stay in the runtime store until restored. |

**Mark read** records that you have seen a notice. **Mark all read** marks every
visible unread notice in the current list. Mark-read does not hide the notice;
switch to Read or All to find it again.

**Hide** removes a visible notice from Unread, Read, and All. **Restore** on the
Hidden view returns it to the visible list. Hide is not delete. Core keeps the
record so operators can unhide it later.

## Deep Links

When a notice includes a safe in-app target, Inbox shows an Open service, Open
logs, or similar action. Allowed targets stay inside Service Admin routes such
as a service detail page, Logs, Runtime, Audit, or Telemetry.

Inbox must not follow external URLs, `operator.json` paths, API token routes, or
other secret-looking targets. If a notice has no safe target, there is no deep
link.

## Live, Fixture, And Unavailable States

| Source banner | Meaning |
| --- | --- |
| Live runtime Inbox | Rows came from the Service Lasso Inbox API. Treat them as durable operator records. |
| Fixture preview | Explicit Service Admin stub mode is enabled. Rows are sample messages only and were not persisted by the runtime. |
| Inbox unavailable | The runtime Inbox API is missing, returned an error, or could not be parsed. The page shows that state instead of pretending messages were saved. |

Do not use fixture rows as evidence that a live runtime recorded a notice. Do
not treat an unavailable Inbox as an empty Inbox.

## What Inbox Must Exclude

Inbox titles, summaries, details, tickets, screenshots, and handoff notes must
not include:

- secret values
- `operator.json` tokens
- bearer tokens, cookies, or session material
- provider credentials, private keys, or recovery material
- raw request bodies, response bodies, or unredacted environment dumps

If a notice would need one of those fields to explain itself, show a redacted
summary and a next action instead.

## Relationship To Toasts And Banners

Transient UI messages can still appear for immediate feedback. They are not the
durable record. If you need to revisit an update, health, workflow, or startup
notice after the toast is gone, open Operations / Inbox.

Existing toasts should not create a second noisy Inbox item for the same
condition. Core uses stable correlation keys so the same condition updates one
notice instead of flooding the list.

## Current Runtime Producers

Inbox can only show events Core has actually written. Current useful producers
include runtime startup, service lifecycle and health transitions, workflow
outcomes, update available or installed notices, and diagnostics or archive
completion.

Secrets Broker attention notices and backup or restore outcome producers are
still tracked on Service Lasso core issue `#833`. Until those producers land,
do not expect Broker lockout or backup-restore outcomes to appear as Inbox
rows. Use Dashboard, Secrets Broker, and Audit for those surfaces instead of
assuming Inbox coverage.

## Unavailable Inbox Triage

When Inbox is unavailable:

1. Open Runtime and confirm the runtime API is healthy.
2. Confirm same-origin `GET /api/operator/inbox` and
   `GET /api/operator/inbox/counts` respond through Service Admin.
3. Confirm the Service Lasso build includes the operator Inbox API. Older
   runtimes return 404 and Service Admin shows the unavailable banner.
4. If counts load but the list is empty, the runtime has no matching notices
   for the current filter. That is an empty Inbox, not an unavailable Inbox.

## Safe Handoff Evidence

When escalating an Inbox notice, include:

- notice title, type, severity, and recorded time
- unread, read, or hidden state
- affected service id when the notice names one
- the in-app target you followed, such as service detail or Logs
- runtime health state if Inbox itself is unavailable

Exclude secret values, operator tokens, bearer material, raw payloads, and
unredacted log excerpts.

---

[Component guides](../README.md) · Imported from [lasso-serviceadmin](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/help/operations-inbox-operator-guide.md). The [migration inventory](../documentation-migration.md) records ownership and remaining work.

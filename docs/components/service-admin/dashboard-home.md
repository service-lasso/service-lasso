---
title: Dashboard home operator chips
description: How operator home splits fleet mix, named failures, listen ports, Inbox, generation, Traefik, and log volume without secret values.
status: runtime-backed
tags: ["dashboard", "home", "telemetry", "inbox"]
---

# Dashboard home operator chips

Dashboard `/` shows the current job, not vanity totals. Use it to see what is
running, what failed, which ports are listening, and whether Inbox, generation,
Traefik, or log volume need a follow-up page.

## Fleet mix

The Services card splits **running**, **available**, **stopped**, and
**crashed**. Crashed is a metrics overlay so a dead process is not counted only
as stopped. An empty fleet is zeros.

## Named failures

Warnings and problem services list the service name, a sanitized note, last
start, and **Not installed** when `installed` is false. Open the service for
repair. Home never shows secret values, env dumps, or filesystem paths.

## Listen ports

The Listen ports card counts unique daemon ports from dashboard endpoints. It
is not a count of documentation or UI links. Open Network for the full table.

## Inbox, generation, Traefik, and logs

- Inbox unread is a count that opens `/inbox`. It does not rebuild Inbox.
- Generation lane is the active runtime generation id and classification.
- Traefik compares entrypoint listens with live backends. Missing Traefik is
  explicit.
- Log volume is stdout/stderr line counts. Stderr volume is not automatically
  an application error.

Broker ready and lockouts stay on home as already shipped. They are not part
of this chip set.

---

[Component guides](../README.md) · Imported from [lasso-serviceadmin](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/help/dashboard-home.md). The [migration inventory](../documentation-migration.md) records ownership and remaining work.

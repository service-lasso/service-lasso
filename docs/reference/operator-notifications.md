---
title: Operator Notifications API
sidebar_label: Operator Notifications
---

# Operator Notifications API

GET /api/operator/notifications returns a read-only, operator-facing feed of
current attention items for Service Admin and other local consumers. It merges
runtime state that otherwise lives behind separate update, recovery, lifecycle,
health, and dashboard/diagnostic surfaces.

The feed is safe metadata only. Notification messages must not echo raw logs,
environment values, provider credentials, secret values, command stdout/stderr,
private keys, tokens, cookies, passwords, or recovery material. Source-specific
details remain available through their owning APIs where already permitted.

## Response shape

~~~json
{
  "notifications": [
    {
      "dedupeKey": "lifecycle_crashed:echo-service",
      "kind": "lifecycle_crashed",
      "severity": "critical",
      "serviceId": "echo-service",
      "message": "Service \"echo-service\" crashed and is not running.",
      "firstSeenAt": "2026-05-20T00:00:00.000Z",
      "lastSeenAt": "2026-05-20T00:00:00.000Z",
      "relatedActionEndpoint": "/api/services/echo-service/restart",
      "source": "lifecycle"
    }
  ],
  "summary": {
    "generatedAt": "2026-05-20T00:01:00.000Z",
    "total": 1,
    "critical": 1,
    "warning": 0,
    "info": 0
  }
}
~~~

## Notification contract

Each item includes:

| Field | Meaning |
| --- | --- |
| dedupeKey | Stable key for merging equivalent source events. |
| kind | One of update_available, update_failed, install_deferred, recovery_review, lifecycle_crashed, health_unhealthy, blocked_start, or diagnostic_warning. |
| severity | critical, warning, or info. |
| serviceId | Owning service id, or null for aggregate diagnostics. |
| message | Safe operator summary. It must not include raw source payload values. |
| firstSeenAt / lastSeenAt | Oldest and newest source timestamps after dedupe. |
| relatedActionEndpoint | Owning API endpoint for follow-up, or null if none exists. |
| source | Source family: updates, recovery, lifecycle, health, or diagnostics. |

The endpoint sorts notifications by severity first, then newest lastSeenAt,
then dedupeKey. Multiple recovery events for the same service/kind are merged
into a single current notification with the earliest first-seen and latest
last-seen timestamps.

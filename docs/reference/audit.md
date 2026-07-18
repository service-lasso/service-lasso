---
title: Audit
---

# Audit

Service Lasso Audit is a durable, metadata-only event history for operator and system actions that change, inspect, or protect the local runtime. It helps operators answer who or what initiated an action, which runtime or service subject it targeted, whether the action succeeded, and where the related service state lives.

Audit is not telemetry. Telemetry describes aggregate runtime health, operational counters, timings, and diagnostic signals that can be exported or previewed for observability. Audit records discrete events with stable actor, action, subject, outcome, timestamp, and correlation metadata. Audit is designed for review and accountability, not performance measurement or raw troubleshooting capture.

## Storage Layout

Runtime/global events are stored under the workspace root:

```text
<workspaceRoot>/.service-lasso/audit/runtime/YYYY-MM-DD.jsonl
```

Service-scoped events are stored with the service state:

```text
<serviceRoot>/.state/audit/events.jsonl
```

Operator command facade events also keep facade-specific audit files under the workspace state directory:

```text
<workspaceRoot>/.state/operator-command-audit.jsonl
<workspaceRoot>/.state/operator-command-confirmation-audit.jsonl
```

Runtime/global events describe workspace-level activity, such as operator queue acknowledgements, workflow facade transitions, runtime recovery checks, global service discovery, and actions where no portable service state should own the record. Service-scoped events describe activity tied to a specific service id and should move with portable service bundles because the audit file is inside that service root.

Portable bundles should preserve `.state/audit/events.jsonl` when service state is exported or moved. This lets a receiving Service Lasso instance retain the service's metadata-only action history without copying workspace-global events that belong to the previous runtime instance.

## Event Shape

Durable audit events use `service-lasso.audit-event.v1` semantics. The runtime API currently exposes audit records from `GET /api/audit` with pagination and filters for service id, actor, action, outcome, source, time range, and free-text query.

Core fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable event id. |
| `timestamp` | UTC event time. |
| `source` | Producer such as `runtime`, `service`, `service-admin`, `secrets-broker`, `operator`, `workflow`, or `system`. |
| `actor` | Safe actor id or `unknown` when the caller cannot be identified. |
| `action` | Stable action name. |
| `outcome` | `success`, `failure`, `denied`, or `skipped` where supported. |
| `subject` / `subjectType` / `subjectId` | Safe target metadata for the event. |
| `serviceId` | Service id for service-scoped events. |
| `method` / `routeTemplate` / `statusCode` | Safe API metadata when an HTTP route produced the event. |
| `summary` / `reason` | Bounded human-readable metadata, never raw payloads. |
| `correlationId` / `traceId` / `relatedRevisionId` | Safe linking metadata for related events, requests, or revisions. |
| `metadata` | Structured safe values only: strings, numbers, booleans, nulls, arrays, and objects. |

Example runtime event:

```json
{
  "source": "operator",
  "actor": "web:<User>",
  "action": "operator-action.acknowledge",
  "outcome": "success",
  "subject": "operator-action:restart-plan-42",
  "statusCode": 200,
  "summary": "Acknowledged operator action",
  "reason": "reviewed restart plan",
  "metadata": {
    "previousStatus": "pending",
    "currentStatus": "acknowledged"
  }
}
```

Example service-scoped event:

```json
{
  "source": "runtime",
  "actor": "system",
  "action": "service.lifecycle.start",
  "outcome": "success",
  "subject": "service:@nginx",
  "serviceId": "@nginx",
  "statusCode": 200,
  "summary": "Started service",
  "metadata": {
    "provider": "process",
    "port": 18080
  }
}
```

## Tamper Evidence

Audit files are append-only JSONL chains. Each persisted event records a sequence number, the previous event hash, and the current event hash. Readers can use those fields to classify the chain:

| Classification | Meaning |
| --- | --- |
| `verified` | The file was readable and each event's sequence and hash link matched the previous event. |
| `broken` | The file was readable, but at least one event was missing, reordered, edited, truncated, or had a mismatched hash link. |
| `unavailable` | The file could not be read or no chain was available for the requested scope. |

The tamper-evidence guarantee proves continuity of the local metadata history that Service Lasso can read. It does not prove that the host filesystem, backup media, clock, caller identity provider, or runtime process could not be compromised.

## Audited Actions

Audit should cover durable operator and system actions, including:

- lifecycle start, stop, restart, reload, crash, and recovery decisions;
- setup-step and one-shot job execution;
- service config changes, config apply preflight decisions, and config revision metadata;
- service metadata changes such as favorites and dependency graph placement;
- operator action queue acknowledgement and status transitions;
- operator command reads, plans, confirmations, denials, expiry, and execution handoff;
- workflow facade run cancel, retry, sync, and repo activation transitions;
- broker reference, identity, writeback, migration, and access-policy decisions;
- backup, restore, export, update, import, and release verification actions when those features execute a durable operation.

Read-only dashboard and diagnostics views should be audited when they carry an actor envelope, affect review state, or expose sensitive operational context. Routine health polling, telemetry previews, and static service discovery should stay out of Audit unless they feed a durable operator decision.

## Sensitive Data Rules

Audit must never store secret values, provider credentials, raw config payloads, raw request bodies, raw terminal or stdin input, or raw log lines.

Do not put these values in first-class fields or nested `metadata`:

- tokens, passwords, cookies, private keys, authorization headers, session material, or broker-resolved secret values;
- provider credentials, OAuth callback payloads, portable master keys, recovery material, or generated service credentials;
- raw `service.json`, `server.json`, environment files, patch bodies, config forms, request bodies, terminal input, or command stdin;
- stdout, stderr, application log lines, diagnostic bundles, command output, or log search results.

Store stable metadata instead: ids, file names, relative paths, route templates, redaction flags, result codes, counts, hashes, revisions, plan ids, confirmation ids, and bounded summaries that have already been redacted.

## Retention And Cleanup

Service Lasso currently keeps runtime and service audit files until the operator removes the workspace or service state. Cleanup tooling should prefer retention by age, exported archive, or explicit operator action, and it must audit the cleanup metadata before removing old files.

Service-scoped audit retention follows the service root. Removing a service root removes that service's portable audit history unless it was exported first. Runtime/global audit retention follows the workspace root.

## Admin UI

The Service Admin Audit page should read from `GET /api/audit`, display the product surface as **Audit**, and link back to this reference. Once live wiring exposes the page in the canonical Admin UI, this document should link directly to that route for runtime and service-scoped views.

## Limitations And Non-goals

Audit is not a secret store, credential vault, log archive, telemetry warehouse, SIEM replacement, legal records system, or immutable remote ledger. It is local-first metadata evidence for Service Lasso actions.

Audit cannot recover events that were never emitted, prove intent beyond the actor envelope it received, or guarantee host-level integrity after filesystem compromise. External backup, signing, rotation, or retention services may strengthen the evidence chain later, but those are outside the current local runtime contract.

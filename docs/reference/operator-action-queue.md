# Operator Action Queue

Service Lasso stores operator action-required items in a workspace-level queue at .state/operator-actions.json.

The queue is for work that needs an operator decision or acknowledgement after runtime checks, recovery, updates, diagnostics, blocked starts, failed checks, or config drift. It is not a log archive and it must not store raw secrets, credentials, tokens, environment values, or diagnostic payloads.

## Item Contract

Each item contains:

- id: stable id derived from the dedupe key.
- dedupeKey: source-owned key used to update repeated events instead of creating duplicates.
- status: open, acknowledged, or deferred.
- severity: info, warning, or critical.
- source: kind, optional serviceId, and optional safe reference.
- title and summary: operator-safe text only.
- evidence: short safe label/value pairs, never raw payloads.
- firstSeenAt, lastSeenAt, updatedAt, and mutation timestamps.

Repeated records with the same dedupeKey update the existing item, preserve firstSeenAt, refresh lastSeenAt, and reopen an acknowledged item.

The queue also contains acknowledgementHistory: sanitized acknowledgement audit entries with itemId, actor, reason, acknowledgedAt, previousStatus, and currentStatus.

Acknowledging an item appends an acknowledgementHistory entry even when the item was already acknowledged. History actor and reason values are sanitized before persistence and API output.

## API

List queue:

~~~http
GET /api/operator/actions
~~~

Record or update an item:

~~~http
POST /api/operator/actions/record
~~~

~~~json
{
  "dedupeKey": "recovery:@node:doctor",
  "severity": "warning",
  "source": {
    "kind": "recovery",
    "serviceId": "@node",
    "reference": "doctor"
  },
  "title": "Recovery doctor warning",
  "summary": "Doctor reported a warning.",
  "evidence": [
    {
      "label": "step",
      "value": "doctor-warn"
    }
  ]
}
~~~

Mutate an item:

~~~http
POST /api/operator/actions/{actionId}/acknowledge
POST /api/operator/actions/{actionId}/defer
POST /api/operator/actions/{actionId}/reopen
~~~

acknowledge accepts optional actor and reason strings. defer accepts an optional deferredUntil string.

Retrieve acknowledgement history for one item:

~~~http
GET /api/operator/actions/{actionId}/acknowledgements
~~~

~~~json
{
  "itemId": "action-recovery:-node:doctor",
  "acknowledgements": [
    {
      "itemId": "action-recovery:-node:doctor",
      "acknowledgedAt": "2026-05-22T00:00:00.000Z",
      "actor": "operator@example.com",
      "reason": "Reviewed recovery warning.",
      "previousStatus": "open",
      "currentStatus": "acknowledged"
    }
  ]
}
~~~

## CLI

~~~powershell
service-lasso operator actions list --json
service-lasso operator actions acknowledge <actionId> --json
service-lasso operator actions defer <actionId> --until 2026-05-22T00:00:00.000Z --json
service-lasso operator actions reopen <actionId> --json
~~~

The CLI uses the same --services-root and --workspace-root options as the other runtime commands.

## Safety

Producers must pass only safe summaries and references. The queue writer also redacts common credential-like patterns from title, summary, and evidence fields before persistence, but that is a guardrail rather than permission to submit secret-bearing data.

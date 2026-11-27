# Stack runtime read — Core #1973

Architect-Conductor: root coordinator approves this additive bounded design.
Existing closed operator DTOs remain untouched. No release/deployment authority.

- AC-SR-1: authenticated GET `/api/operator/v2/stack-runtime` accepts exactly
  0..25 unique admitted serviceId values, no other query keys. Trusted workspace
  read permission (the registered runtime service visibility grant) is checked passively; no auth enrolment,
  reconciliation, retention cleanup or mutations originate from this read.
- AC-SR-2: existing envelope wraps `{observedAt,coreUptimeMs,activeOperations,
  rows,incidents}`. Core uptime uses monotonic runtime-generation elapsed time.
  Rows contain exactly `{serviceId,uptimeMs,restartCount}`. Running current-run
  uptime derives from authoritative lifecycle start; stopped/unknown is null.
  Restart count comes from hydrated durable lifecycle metrics; unobserved is null.
- AC-SR-3: activeOperations is `{scope:'workspace',count}` only for entitled
  administrator/owner identities and available passive durable state, else null.
  Counts queued/running/cancelling persisted records without reconciliation.
- AC-SR-4: incidents is null on unavailable history, otherwise newest-first at
  most 12 `{at,serviceId,kind}` entries selected from visible existing durable
  service health/lifecycle failures and authorized durable operations. Timestamps
  are event timestamps; no diagnostic text, URLs, actors, paths or payloads.
  Kinds: health_failed, operation_failed, operation_active, service_stopped.
  service_stopped uses real crashed lifecycle finishedAt only; intentional stops
  are excluded. Inbox events retain original createdAt, not acknowledgement times.
  Invalid/future timestamps are excluded and valid timestamps normalize to UTC.
  Expired/orphaned active records make operation state unavailable, without repair.
  A materially unavailable entitled source makes incidents null; viewer history
  excludes all operation records and count is null.
- AC-SR-5: prove real disposable runtime uptime/restart, in-flight/terminal ops,
  incidents, passive repeated reads, auth/invalid/failure behavior and regression.
  Broad #1973 stays open until coordinator confirms consumer/joint coverage.

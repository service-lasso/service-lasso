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

## Checkout Stack and connection intent (#1985)

- AC-SR-6: a Stack runtime row may include a `stackIntent` value. When
  available, `expected` identifies a service selected by this Core
  generation's startup plan and eligible to start. `gated` identifies a
  selected daemon waiting for secure first-run setup. `optional`, `disabled`
  and `unsupported` identify services without a running expectation for
  this generation. Providers use `prepared` only when Core reports both
  installed and configured, and `unprepared` otherwise. Platform support
  and bootstrap eligibility reuse the startup predicates. The authenticated
  scoped read exposes only this enum and preserves the existing row data.
- AC-SR-7: implicit source client launch uses the same local services and
  workspace roots as source startup. Resolve a live, owned loopback
  endpoint with the existing generation selector. No checked-in or
  fallback port substitutes for a missing or stale workspace instance.
  Preserve explicit client target flags, connection profiles and environment
  configuration. Without a selected local runtime, an interactive TUI
  opens its connect screen. When authentication is required, the TUI
  displays the target and requires confirmation before requesting a masked
  credential. Remote connection keeps the existing HTTPS admission policy.
  Secrets remain outside source, argv, output and stored connection profiles.
  Verify both checkout-local and explicit-connect outcomes with the pinned tool.

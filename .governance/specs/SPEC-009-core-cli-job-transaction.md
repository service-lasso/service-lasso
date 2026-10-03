# Core-owned CLI job transaction

## Scope

Issue #1582 succeeds the retired #1574 slice and delivers the Core-owned job
transaction consumed by CLI PR #32.
This is Development work on `develop`-based issue branches. It is neither
provider activation, host provisioning, deployment, publication, nor release
qualification.

## Requirements

- `CORE-CLI-JOB-001`: Core alone authenticates the transport actor and client,
  derives permission from trusted request context, requires the existing
  server-bound confirmation for a mutating lifecycle action, and records only
  safe audit metadata.
- `CORE-CLI-JOB-002`: Core creates, persists, and reconciles one durable job
  transaction. The idempotency key is bound to actor, workspace, action,
  target, and confirmation context; same-context replay returns the original
  job and changed context fails before another lifecycle effect.
- `CORE-CLI-JOB-003`: Core exposes only a schema-closed metadata-safe job
  inventory and status surface. CLI transports authenticated requests and does
  not create authority, durable state, or lifecycle effects locally.
- `CORE-CLI-JOB-004`: A compiled `service-lassoctl` exercises an owned
  disposable source-built Core with a scoped signed identity: preview, one
  action, exact replay, changed-context refusal, audit-safe denial, status,
  unsupported cancellation, and unrelated-service preservation.
- `CORE-CLI-JOB-005`: Native CI uses the target host's actual executable name
  on Windows, Linux, and macOS, retains the original failed job output, and
  does not waive a failed primary gate.
- `CORE-CLI-JOB-006`: Where the owner-installed host runner is used, the
  daemon creates and holds the per-job expected output and inventory from the
  accepted compiled client/primary identity. Caller paths, static state files,
  and self-issued nonce material are not job authority. Issuance and every
  terminal revocation are durably replay-safe.

## Evidence and boundaries

The required evidence is source tests plus an external compiled-client/Core
acceptance run after the custody gate. No test may activate a provider, alter
a persistent host, publish, deploy, or claim release acceptance. Native job
execution requires its isolated source/tree/executable/compiler and runtime
custody records before build or test invocation.

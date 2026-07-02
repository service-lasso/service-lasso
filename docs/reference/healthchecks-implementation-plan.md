# Healthchecks Implementation Plan

_Status: implementation handoff for the `healthchecks[]` contract._

This is a worker-facing plan for implementing the canonical Service Lasso `healthchecks` array contract.

## Target manifest shape

```json
"healthchecks": [
  {
    "id": "tcp-port-open",
    "type": "tcp",
    "host": "127.0.0.1",
    "port": "${HTTP_PORT}",
    "retries": 30,
    "interval": 250
  },
  {
    "id": "http-ready",
    "type": "http",
    "url": "http://127.0.0.1:${HTTP_PORT}/health",
    "expected_status": 200,
    "retries": 80,
    "interval": 250
  }
]
```

## Product rules

- `healthchecks` is canonical.
- Singular `healthcheck` is not the target schema.
- Temporary singular support is allowed only as an internal migration bridge while checked-in manifests are converted.
- Do not support `tcphost` or `tcpport` aliases.
- Every healthcheck item must have a unique `id`.
- `required` defaults to `true`.
- Startup is ready only when all required checks pass.
- Optional checks are diagnostics only.
- Each check owns its own retries, interval, start period, and timeout.

## Implementation phases

1. Contract and validation
   - Add `healthchecks?: ServiceHealthcheck[]` to `ServiceManifest`.
   - Add `id` and `required` to healthcheck types.
   - Add `udp` healthcheck type.
   - Add `timeout` shared option.
   - Validate unique check IDs.
   - Reject empty `healthchecks` arrays.
   - Reject both `healthcheck` and `healthchecks` together.
   - Reject `tcphost` and `tcpport` with a clear message.

2. Normalisation
   - Add a helper such as `getServiceHealthchecks(manifest)`.
   - Return explicit `healthchecks` when present.
   - Return temporary singular `healthcheck` only during migration if needed.
   - Return default process check only when no healthchecks are declared.

3. Check execution
   - Keep individual checkers small: process, http, tcp, udp, file, variable.
   - Add `checkUdp.ts` with send/expect semantics.
   - Resolve selectors before running each check.
   - Ensure file checks resolve selectors before filesystem access.
   - Ensure TCP supports default single-port, address, and host/port forms.

4. Readiness aggregation
   - Update startup readiness to run each check independently.
   - Honour per-check retries, interval, start period, and timeout.
   - Required checks gate startup.
   - Optional checks report diagnostics only.

5. Result contracts
   - Return aggregate health plus per-check results.
   - Start traces should include per-check outcomes.
   - APIs should expose checks as rows/cards, not a single opaque status string.

6. Runtime variables
   - Implement `outputvarregex` capture into runtime-scoped variables.
   - Make captured variables visible to variable healthchecks.
   - Include runtime variable source metadata such as stdout/stderr.

7. Manifest migration
   - Convert checked-in manifests from `healthcheck` to `healthchecks`.
   - Update examples in docs and tests.
   - Once migrated, decide whether singular `healthcheck` should be rejected immediately or left as a short deprecation bridge.

8. Tests
   - Validator tests for valid and invalid schemas.
   - Readiness tests for single and multiple checks.
   - Required/optional aggregation tests.
   - TCP default/address/host-port tests.
   - UDP send/expect tests.
   - File selector resolution tests.
   - Variable from `outputvarregex` tests.

## Result shape

Per-check result:

```ts
interface ServiceHealthcheckResult {
  id: string;
  type: ServiceHealthcheck["type"];
  required: boolean;
  healthy: boolean;
  attempts: number;
  detail: string;
}
```

Aggregate result:

```ts
interface ServiceHealthResult {
  healthy: boolean;
  detail: string;
  checks: ServiceHealthcheckResult[];
}
```

The aggregate is healthy only when every required check is healthy.

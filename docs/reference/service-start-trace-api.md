# Service Start Trace API

The service start trace API exposes the most recent start attempt timeline for a service:

```text
GET /api/services/{serviceId}/start-trace
```

The response contains:

- `serviceId`
- `trace`: the current or most recent start attempt, or `null`
- `history`: bounded recent start attempts, newest first

Each trace is ordered by event `order` and uses these phases:

- `dependency_resolution`
- `port_selection`
- `artifact_acquisition`
- `env_merge`
- `process_spawn`
- `health_check`
- `terminal_outcome`

Trace metadata is diagnostic metadata only. Environment values, broker payloads, provider credentials, tokens, passwords, private keys, cookies, recovery material, and raw secret values must not be emitted. Environment-related trace events expose key names and counts only.

Blocked starts are represented as a completed trace with status `blocked`. Health-check failures are represented as status `failed`. Successful starts are represented as status `succeeded`.

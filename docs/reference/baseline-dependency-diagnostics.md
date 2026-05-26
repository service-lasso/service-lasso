# Baseline Dependency Diagnostics

Service Lasso exposes a compact baseline dependency diagnostic payload for operator UIs and support bundles:

```text
GET /api/diagnostics/dependencies
```

The response is read-only and safe for issue evidence. It reports service readiness, dependency blockers, health state, declared or negotiated ports, and sanitized endpoint URLs. It does not include environment values, provider credentials, raw logs, tokens, passwords, cookies, private keys, or broker secret material.

## Baseline Summary

`diagnostics.summary.status` is one of:

| Status | Meaning |
| --- | --- |
| `running` | Every enabled service is currently running. |
| `startable` | No enabled service is blocked or degraded, and at least one enabled service can be started. |
| `blocked` | At least one enabled service has a start blocker. |
| `degraded` | No enabled service is blocked, but at least one running service is unhealthy. |

Disabled services are counted separately and do not block the baseline summary by themselves.

## Service Readiness

Each `diagnostics.services[]` entry includes:

- `readiness`: `ready`, `blocked`, `degraded`, `running`, or `disabled`.
- `blockingReason`: `missing_dependency`, `dependency_not_ready`, `not_installed`, `not_configured`, `port_occupied`, `unhealthy`, `disabled`, or `null`.
- `blockers`: operator-safe text explaining the current blocker.
- `nextAction`: the next suggested operator action.
- `dependencies`: per-dependency readiness and blocker metadata.
- `ports`: manifest-declared or runtime-negotiated port numbers.
- `endpoints`: sanitized endpoint labels, URLs, and ports.
- `health`: the existing Service Lasso health result for the service.

Endpoint URLs are stripped of username, password, query string, and fragment before they are returned.

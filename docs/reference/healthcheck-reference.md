# Healthchecks Reference

_Status: canonical healthcheck contract companion for `service.json`._

This page describes the Service Lasso `healthchecks` contract used by service manifests. The general manifest reference remains [`service-json-reference.md`](service-json-reference.md); this page gives healthcheck-specific examples and implementation rules.

## Canonical field

Use top-level `healthchecks` as an array.

```json
"healthchecks": [
  {
    "id": "http-health",
    "type": "http",
    "url": "http://127.0.0.1:${HTTP_PORT}/health",
    "expected_status": 200
  }
]
```

The singular `healthcheck` field is not the target contract. During implementation it may be accepted only as a temporary internal migration bridge while checked-in manifests are converted. New manifests should use `healthchecks` only.

## Evaluation model

Each item in `healthchecks` is evaluated as an independent readiness check.

Default semantics:

- every check is `required` unless it explicitly sets `"required": false`
- startup is ready only when all required checks pass
- optional checks are diagnostics only and must not block startup
- each check owns its own `retries`, `interval`, `start_period`, and `timeout`

No group-level `all` / `any` mode is part of the first contract. If alternatives are needed later, add grouping deliberately instead of overloading this first version.

## Supported healthcheck types

Service Lasso healthchecks are declared with `type`.

Supported types:

- `process`
- `http`
- `tcp`
- `udp`
- `file`
- `variable`

`process` is the default health model when no stronger readiness check is needed. Use `http`, `tcp`, `udp`, `file`, or `variable` when startup should wait for a specific readiness signal.

## Shared fields

Every healthcheck item has these shared fields:

```json
{
  "id": "readable-check-id",
  "type": "http",
  "required": true,
  "retries": 30,
  "interval": 1000,
  "start_period": 0,
  "timeout": 2000
}
```

Field meanings:

- `id`: stable unique identifier for this check within the service manifest.
- `type`: healthcheck type.
- `required`: whether this check gates startup readiness. Defaults to `true`.
- `retries`: number of readiness attempts before this check is considered failed.
- `interval`: milliseconds between attempts.
- `start_period`: milliseconds to wait before this check's first attempt.
- `timeout`: per-attempt timeout in milliseconds for checks that wait on network or process output.

When a service declares an explicit healthcheck item, Service Lasso should treat that item as a readiness check even when it omits `retries` or `interval`.

Intended defaults:

```text
required = true
retries = 10
interval = 1000ms
start_period = 0ms
timeout = implementation-defined per check, usually 2000ms for network checks
```

## HTTP healthcheck

Use `http` when the service exposes an HTTP readiness endpoint.

```json
"healthchecks": [
  {
    "id": "http-health",
    "type": "http",
    "url": "http://127.0.0.1:${HTTP_PORT}/health",
    "expected_status": 200,
    "retries": 80,
    "interval": 250
  }
]
```

Rules:

- `url` is required.
- `expected_status` defaults to `200` when omitted.
- Selectors such as `${HTTP_PORT}` are resolved before the request.
- Optional cookie handling may be supported for services whose readiness endpoint requires request state.

Optional cookie form:

```json
"healthchecks": [
  {
    "id": "http-cookie-health",
    "type": "http",
    "url": "http://127.0.0.1:${HTTP_PORT}/healthcheck",
    "expected_status": 200,
    "cookies": {
      "healthcheck": "ready"
    },
    "retries": 180
  }
]
```

## TCP healthcheck

Use `tcp` when readiness is represented by a socket accepting connections.

Service Lasso should support three clean TCP forms.

### Default single-port form

```json
"healthchecks": [
  {
    "id": "tcp-ready",
    "type": "tcp",
    "retries": 30
  }
]
```

This is allowed when the service has exactly one unambiguous resolved port. Service Lasso should connect to `127.0.0.1:<resolved-port>`.

If a service declares multiple ports, it must use the explicit `address` form or the explicit `host` + `port` form.

### Explicit address form

```json
"healthchecks": [
  {
    "id": "tcp-http-port",
    "type": "tcp",
    "address": "127.0.0.1:${HTTP_PORT}",
    "retries": 30
  }
]
```

### Explicit host and port form

```json
"healthchecks": [
  {
    "id": "tcp-http-port",
    "type": "tcp",
    "host": "127.0.0.1",
    "port": "${HTTP_PORT}",
    "retries": 30
  }
]
```

Rules:

- `address` is canonical when a single string is clearer.
- `host` + `port` is canonical when host and port should be edited independently.
- Bare `type: "tcp"` is canonical only for the unambiguous single-port case.
- Do not add `tcphost` or `tcpport` aliases. Service Lasso manifests are new, so the schema should stay clean.
- Selector resolution must work for derived port variables such as `${HTTP_PORT}`, `${SERVICE_PORT}`, and other declared port names.

## UDP healthcheck

Use `udp` when the service exposes a UDP readiness protocol.

UDP is connectionless, so a UDP check must not pretend that a port can be verified the same way as TCP. Prefer explicit `send` and `expect` semantics.

```json
"healthchecks": [
  {
    "id": "udp-ready",
    "type": "udp",
    "host": "127.0.0.1",
    "port": "${UDP_PORT}",
    "send": "ping",
    "expect": "pong",
    "retries": 80,
    "interval": 250,
    "timeout": 1000
  }
]
```

Optional address form:

```json
"healthchecks": [
  {
    "id": "udp-ready",
    "type": "udp",
    "address": "127.0.0.1:${UDP_PORT}",
    "send": "ping",
    "expect": "pong"
  }
]
```

Rules:

- `send` defines the datagram payload to send.
- `expect` defines the response payload required for a healthy result.
- Selector resolution should apply to `address`, `host`, `port`, `send`, and `expect`.
- Fire-and-forget UDP should be avoided for readiness because it does not prove the service received or handled the packet.

## File healthcheck

Use `file` when readiness is represented by a file that the service creates.

```json
"healthchecks": [
  {
    "id": "ready-file",
    "type": "file",
    "file": "${SERVICE_ROOT}/runtime/ready.txt",
    "retries": 30,
    "interval": 250
  }
]
```

Relative paths are resolved against the service root:

```json
"healthchecks": [
  {
    "id": "ready-file",
    "type": "file",
    "file": "runtime/ready.txt"
  }
]
```

Rules:

- Selector resolution should apply before checking the filesystem path.
- Relative paths remain service-root relative.
- Health details should report the resolved path checked.

## Variable healthcheck

Use `variable` when readiness is represented by a resolved variable.

```json
"healthchecks": [
  {
    "id": "service-url-ready",
    "type": "variable",
    "variable": "SERVICE_URL",
    "retries": 30
  }
]
```

Selector form should also work:

```json
"healthchecks": [
  {
    "id": "service-url-ready",
    "type": "variable",
    "variable": "${SERVICE_URL}",
    "retries": 30
  }
]
```

Rules:

- Bare names and `${VAR}` selector form should both be accepted.
- The healthcheck succeeds when the variable exists and resolves to a non-empty value.
- Variable health details should identify the variable key and scope without exposing sensitive values unnecessarily.

## Runtime variables from process output

A service can declare `outputvarregex` to capture variables from stdout or stderr.

```json
"outputvarregex": {
  "FILEBEAT_ENABLED_INPUTS": ".*Loading and starting Inputs completed. Enabled inputs: (\\d+).*"
},
"healthchecks": [
  {
    "id": "filebeat-inputs-ready",
    "type": "variable",
    "variable": "FILEBEAT_ENABLED_INPUTS",
    "retries": 180,
    "interval": 1000
  }
]
```

Rules:

- Each `outputvarregex` key is the variable name to set.
- Each value is a regex string.
- The first capture group becomes the variable value.
- Captured values should be stored as runtime-scoped service variables.
- Variable healthchecks should be able to wait for these runtime-captured values.
- Captured runtime variables should appear in service variable/operator surfaces with source metadata such as `stdout` or `stderr`.

## Multiple healthchecks examples

### TCP plus HTTP

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

Both checks are required because `required` defaults to `true`.

### Required and optional checks

```json
"healthchecks": [
  {
    "id": "http-ready",
    "type": "http",
    "url": "http://127.0.0.1:${HTTP_PORT}/health",
    "required": true
  },
  {
    "id": "diagnostic-ready-file",
    "type": "file",
    "file": "runtime/diagnostic-ready.txt",
    "required": false
  }
]
```

Startup is ready when `http-ready` passes. The optional file check is reported for diagnostics but does not block startup.

## Result model

Health APIs and start traces should report aggregate health plus individual check results.

Per-check result shape:

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

Aggregate shape:

```ts
interface ServiceHealthResult {
  healthy: boolean;
  detail: string;
  checks: ServiceHealthcheckResult[];
}
```

The aggregate is healthy only when all required checks are healthy.

## Implementation checklist

When changing healthcheck behaviour, update:

- `src/contracts/service.ts`
- `src/runtime/health/types.ts`
- `src/runtime/discovery/validateManifest.ts`
- `src/runtime/health/evaluateHealth.ts`
- `src/runtime/health/waitForReadiness.ts`
- the relevant checker under `src/runtime/health/`
- service variable resolution in `src/runtime/operator/variables.ts` when variables are involved
- service lifecycle/runtime state when new runtime values must persist
- API response contracts and dashboard/service detail surfaces for per-check results
- checked-in service manifests currently using singular `healthcheck`
- regression tests for startup readiness and direct health evaluation

Keep the schema clean. Prefer canonical Service Lasso field names over compatibility aliases unless there is a real existing manifest migration requirement.

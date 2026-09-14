# Health Checks

Use health checks to decide whether a service is merely running, ready for
traffic, or blocked by something it depends on. Service Admin should make those
signals visible in Runtime, Services, and service details without requiring an
operator to inspect the host first.

Use this guide with [Runtime and Logs Operator Runbook](runtime-and-logs-operator-runbook.md),
[How to Create a Basic Service](how-to-create-a-basic-service.md),
[Network and Service Routes Operator Guide](network-and-service-routes-operator-guide.md),
and [Environment Variables: Global and Service Reuse](environment-variables-global-and-service-reuse.md).

## Health States

Service Lasso health should map to three operator states.

| State | Meaning | Operator response |
| --- | --- | --- |
| `healthy` | The runtime check passed for the current service contract. | Keep monitoring. No repair is needed from health alone. |
| `warning` | The service is running or partially available, but a readiness, dependency, or freshness signal is weak. | Inspect service details, dependencies, and recent logs before restarting. |
| `critical` | The service cannot satisfy its required health contract, or the runtime cannot prove it is usable. | Treat the service as unavailable. Gather Runtime, Services, details, dependency, and log evidence before retrying actions. |

Runtime health and service health are related but different. A healthy runtime
means the coordinator API is reachable. A service can still be warning or
critical because its process exited, its readiness endpoint failed, a dependency
is missing, or required configuration is unresolved.

## Liveness, Readiness, and Dependency Checks

Liveness answers: is the service process alive enough that the runtime should
keep managing it? Use liveness to detect crashed or missing processes.

Readiness answers: can the service perform its main work now? A web service can
be live while still not ready because it is loading data, waiting for a port,
migrating a database, or warming a cache.

Dependency checks answer: can the service reach the providers it needs? A
service might be ready only when Node, Python, Java, a broker, a local database,
a generated config file, a route, or a secret reference is available.

Do not collapse these into one broad check when the operator needs different
repair actions. A failed liveness check usually points to start, executable, or
process management evidence. A failed readiness check points to app startup,
ports, URLs, config, and recent logs. A failed dependency check points to the
provider or shared resource first.

## Common Check Types

| Type | Use when | Good evidence | Watch for |
| --- | --- | --- | --- |
| `process` | Process presence is enough to prove the service is alive. | Runtime sees the expected process or managed owner. | It can report healthy while the app is not ready for requests. |
| `http` | The service exposes a health, readiness, or status URL. | Expected status code and response shape from the configured endpoint. | Wrong path, wrong protocol, stale base URL, redirects, auth, or slow startup. |
| `tcp` | An open socket is the best readiness signal. | Host and port accept connections on the intended interface. | A socket can open before the application is actually usable. |
| `file` | A generated file proves setup or runtime readiness. | File exists at the expected path and, when needed, has fresh content. | Stale files can survive a failed restart unless freshness is checked. |
| `variable` | A resolved variable, generated URL, or secret reference proves configuration readiness. | Runtime can resolve the required non-sensitive value or reference. | Raw secret values must not be exposed in UI, logs, tickets, or examples. |

## Recommended Baseline

For a simple first service, start with:

1. A `process` liveness check so Runtime can tell whether the service is alive.
2. An HTTP or TCP readiness check when the service exposes a local endpoint.
3. A dependency-specific check only when the service can start but cannot work
   without a provider, generated file, route, or resolved variable.

This keeps the first manifest easy to validate while avoiding false confidence
for services that listen on a port before they are usable.

For a worker, CLI wrapper, or provider service with no network endpoint,
`process` may be enough. For an API, UI, webhook receiver, or model server,
prefer `http` readiness if there is a real health URL; use `tcp` only when the
protocol has no useful HTTP response. Use `file` checks for setup receipts,
generated config, sockets, or marker files. Use `variable` checks when missing
configuration is the clearest reason the service should not be started or
shown as ready.

## Choosing the First Check

Ask what failure the operator needs to see first.

| Service shape | First check | Add next |
| --- | --- | --- |
| Long-running worker | `process` | Dependency check for required provider or queue. |
| Local web UI or API | `http` readiness endpoint | `process` liveness when the runtime manages the process separately. |
| TCP-only server | `tcp` | Logs and dependency checks when the socket opens before full readiness. |
| Service generated by setup action | `file` | `process` or endpoint readiness after setup succeeds. |
| Service controlled by shared configuration | `variable` | Endpoint or process check after required values resolve. |

Prefer the narrowest check that proves the service contract the UI claims. Do
not use `process` as the only check for a service that can be alive but unable
to serve traffic. Do not use an external vendor homepage as an HTTP readiness
check for a local managed service.

## How Failures Should Appear

Runtime should show the coordinator state, the affected service id, the current
health state, the latest check timestamp, and any runtime API or proxy failure.
If many services change together, confirm the runtime itself is healthy before
repairing individual services.

Services should show the affected service with lifecycle and health state close
together. A stopped service with a critical process check is different from a
running service with a warning readiness check.

Service details should show the check type, target, latest result, available
actions, relevant dependencies, path or URL metadata, and recent operation
evidence. The details page should give the operator enough context to choose
between config, start, restart, dependency repair, route repair, or log review.

Logs should be used to explain the health change, not to replace it. Check logs
around the latest health timestamp and keep escalations to service ids,
timestamps, operation ids, health states, and short redacted error summaries.

## Troubleshooting a Failed Check

Use this flow before repeating start or restart actions:

1. Open Runtime and confirm the runtime API is reachable and reporting fresh
   check times.
2. Open Services and identify the affected service id, lifecycle state, and
   health state.
3. Open service details and note the check type, target, dependencies, available
   actions, and latest operation result.
4. For `process`, check whether the service was expected to be running, whether
   the executable or working directory is configured, and whether a recent start
   operation failed.
5. For `http`, compare scheme, host, port, and path with Network and Service
   Routes. Confirm the endpoint is a runtime endpoint for this service.
6. For `tcp`, confirm the service is listening on the advertised bind address
   and port, then check whether another process owns the port.
7. For `file`, confirm the setup or config action creates the file and that
   stale files are not being reused as proof of readiness.
8. For `variable`, confirm the variable or secret reference resolves through the
   supported runtime path without exposing raw secret values.
9. Open Logs for `stderr`, then `stdout`, then `default` where available and
   compare recent lines with the failed check timestamp.
10. Check Dependencies when a provider, route, generated config, or secret
    reference is part of readiness.

Escalate with the service id, health state, check type, target, latest check
timestamp, lifecycle state, operation id when present, and the next check
already performed.

## False Positives and False Negatives

Common false positives:

- `process` is healthy but the app is still warming up or cannot serve traffic.
- `tcp` accepts connections before the application has loaded configuration.
- `file` exists from a previous run but was not regenerated by the current
  setup or start action.
- `variable` resolves to a placeholder, old local value, or non-sensitive
  fallback that is not valid for this machine.
- An HTTP check hits a generic root page instead of a real readiness endpoint.

Common false negatives:

- Readiness times out before a service with known slow startup reaches steady
  state.
- HTTP checks use `localhost` when the service binds only to a LAN address, or
  use a LAN address when the service is local-only.
- HTTPS is checked against a plain HTTP listener, or the path omits a required
  base path.
- A dependency is healthy but a route, firewall, or generated config points to
  the wrong endpoint.
- A service intentionally stops after a short task but is modeled as a
  long-running process.

When a check is noisy, tune the check target and evidence before changing
operator state mappings. Health should help operators decide the next action;
it should not hide uncertainty behind a green row or create alert fatigue with
known-invalid checks.

## Related Guides

- [Runtime and Logs Operator Runbook](runtime-and-logs-operator-runbook.md)
- [How to Create a Basic Service](how-to-create-a-basic-service.md)
- [Network and Service Routes Operator Guide](network-and-service-routes-operator-guide.md)
- [Environment Variables: Global and Service Reuse](environment-variables-global-and-service-reuse.md)

---

[Component guides](../README.md) · Imported from [lasso-serviceadmin](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/help/health-checks.md). The [migration inventory](../documentation-migration.md) records ownership and remaining work.

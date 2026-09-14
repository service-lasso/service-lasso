# Runtime and Logs Operator Runbook

Status: runtime-backed. Runtime and Logs read through the Service Lasso
runtime API boundary. Treat service ids, runtime health states, operation ids,
timestamps, advertised log types, and safe log lines as the evidence operators
can use for triage.

Service Admin depends on the runtime API for Dashboard, Services, Runtime, and
Logs workflows. If the runtime API is unavailable, those pages should show an
unavailable or degraded state instead of falling back to sample data.

## Runtime API Health

Start on Runtime when Dashboard, Services, or Logs cannot load live data. The
runtime health view separates Service Admin UI reachability from runtime API
availability.

Check these signals first:

- runtime readiness and overall health
- the time of the most recent successful check
- failed health rows and their affected service id
- API or proxy errors shown by Service Admin
- operation ids or correlation refs from recent lifecycle actions

Runtime health is not the same as individual service health. A healthy runtime
means the coordinator API is reachable and able to report state. A service can
still be stopped, degraded, misconfigured, missing a dependency, or failing its
own health checks while the runtime itself is healthy.

## Runtime Reload and Bulk Actions

Use runtime reload when service metadata or reloadable configuration should be
refreshed without restarting every service. Reload success means the runtime
accepted and completed the reload request; operators should still confirm that
affected service rows, details, dependencies, and logs show the expected state.

Bulk start, stop, and restart actions can change many services at once. Before
using a bulk action:

- confirm the operator intent is fleet-level, not a single-service repair
- check whether disabled services, provider services, and dependencies are
included by the runtime contract
- expect operation ids, status, and recovery guidance instead of relying only on
button state
- review Runtime and Services after completion to catch partial failures

If a bulk action leaves some services unchanged, treat it as a partial
operation. Open the affected service details, inspect dependencies, then review
recent logs for each failed service.

## Log Sources and Types

Logs are runtime-backed service evidence. Service Admin asks for logs by service
id and log type; the server resolves the configured paths. Browser routes,
query strings, and UI controls must not accept raw filesystem paths from the
operator.

Common log types are:

- `default`: the primary service log advertised by the runtime or service
  manifest. Combined/All in Service Admin maps to this type. Do not request
  `type=combined`.
- `stdout`: process standard output when the runtime captures it
- `stderr`: process standard error when the runtime captures it
- `access`: request or ingress access logs where a service exposes them
- `error`: service or web server error logs where a service exposes them

Service details Logs uses the same viewer as the Logs page for the current
service only. Choose a log from the service's source list, or toggle STDOUT and
STDERR. An empty resolved stderr file still uses the file editor. An advertised
source whose file is missing or unreadable uses the same empty view (file editor
when a path is resolved, or the empty-stream one-liner when it is not). It is
not a special unavailable card.

Not every service exposes every log type. Missing `access` or `error` logs can
be normal for a service that does not have an HTTP server or separate web
server log contract. Missing `stdout` or `stderr` can also be normal when the
runtime does not capture process streams for that service. Provider services
such as `@java` still advertise builtin `logs/runtime/` paths after install and
config; those files exist only after a supervised process start writes them.

## Where setup and lifecycle logs go

`{serviceId}:install` and `{serviceId}:config` labels (for example
`@java:install`) are lifecycle action-history markers. They are not Combined/All
log lines, not Inbox items, and not a dedicated provider install log.

- Combined/All (`type=default`) reads `{serviceRoot}/logs/runtime/service.log`
  NDJSON captured from a supervised process. Stdout and stderr are sibling
  `stdout.log` / `stderr.log` files in the same directory.
- When `service.log` has no NDJSON lines, Core may still return synthetic
  overview `entries` built from `actionHistory`. Service Admin Logs does not
  render those as a fake tail. They are leftover diagnostics, not the selected
  source.
- Manifest setup steps (when `setup.steps` exist) write
  `{serviceRoot}/logs/setup/{stepId}/{runId}/setup.log` plus stdout/stderr.
  `@java` has no setup steps, so install/config do not create those files.
- Named service actions write `{serviceRoot}/logs/actions/{actionId}/{runId}/`.
- Inbox is for operator notices (updates, security, and similar), not install
  or config command output.

Do not expect setup or install/config output in Combined/All unless a setup
step or discovered file under `{serviceRoot}/logs/` (outside `logs/runtime/`)
actually exists.

## When Logs Are Missing

When Logs shows no sources, no lines, or an empty advertised source, check in
this order:

- confirm Runtime is reachable and not reporting API or proxy failures
- confirm the service id exists in Services and service details
- check whether the service advertises the requested log type
- verify the service has started at least once since install or reload
- check whether the service manifest defines log capture or stream paths
- use service health and dependency state to decide whether the service never
  started far enough to write logs
- review Service Admin runtime proxy errors when same-origin `/api/*` requests
  fail

Do not paste raw credentials, tokens, cookies, private keys, request bodies,
response bodies, recovery material, or environment values into tickets or
support notes. Logs can contain application output, so keep triage summaries to
service ids, timestamps, health states, operation ids, and short redacted error
summaries.

## When a Service Fails to Start

Use Runtime, Services, service details, Logs, and Dependencies together:

1. Check the service row for lifecycle state and current health.
2. Open service details for required configuration, dependencies, and available
   actions.
3. Open Runtime to confirm the coordinator is healthy enough to run actions.
4. Open Logs for `stderr` first when available, then `stdout`, then `default`.
5. Check Dependencies for unavailable provider services or missing secret refs.
6. Rerun start or restart only after the failed operation state is understood.

If the runtime accepted a start action but the service remains stopped or
critical, look for operation id, service id, timestamp, runtime response,
dependency status, and recent log events. Use that evidence for handoff instead
of repeating broad start or restart actions.

## Combining Health and Recent Logs

Health checks tell operators what state the runtime currently reports. Recent
logs explain what happened near that state change. Use both before deciding on
reload, restart, configuration repair, or dependency recovery.

Useful triage pairs:

- runtime healthy plus service critical: inspect that service's logs,
  dependencies, and manifest configuration
- runtime degraded plus many services unavailable: repair runtime/API
  reachability before restarting individual services
- service started plus readiness warning: check dependency health and recent
  `stderr` or `default` logs
- logs unavailable plus service missing from Services: verify service discovery
  and runtime reload before checking file paths
- logs available but health stale: refresh Runtime and confirm the latest check
  timestamp before acting

## Safe Handoff Evidence

When escalating a Runtime or Logs problem, include:

- affected service id
- runtime health state and latest check timestamp
- service lifecycle state and service health
- action name and operation id when an action was attempted
- requested log type and whether the runtime advertised it
- short redacted error summary
- the next check already performed

Exclude raw secrets, provider credentials, tokens, cookies, private keys, full
environment dumps, request bodies, response bodies, recovery material, and
unredacted log excerpts.

---

[Component guides](../README.md) · Imported from [lasso-serviceadmin](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/help/runtime-and-logs-operator-runbook.md). The [migration inventory](../documentation-migration.md) records ownership and remaining work.

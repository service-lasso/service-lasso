# Operator Troubleshooting Runbooks

Status: operator guidance. Use these runbooks when Service Admin shows a
failure state and the operator needs a bounded first response before escalating.
Confirm live state in Runtime, Services, service details, Network, Logs,
Telemetry, Audit, Variables, or Secrets Broker before changing service
configuration.

Use this guide with [Runtime and Logs Operator Runbook](runtime-and-logs-operator-runbook.md),
[Health Checks](health-checks.md),
[Network and Service Routes Operator Guide](network-and-service-routes-operator-guide.md),
[Service Install and Setup Config](service-install-and-setup-config.md),
[Variables and Secrets Broker Safety Guide](variables-and-secrets-broker-safety-guide.md),
[Operations Telemetry Operator Guide](operations-telemetry-operator-guide.md),
and [Operations Audit Operator Guide](operations-audit-operator-guide.md).

Keep support evidence metadata-only. Do not paste raw secrets, provider
credentials, tokens, cookies, private keys, request bodies, response bodies,
recovery material, full environment dumps, or unredacted log excerpts into
tickets, screenshots, Help Center examples, or support notes.

## Service Will Not Start

Symptoms:

- The service remains stopped after Start.
- The action returns a failed operation id or no terminal result.
- Runtime shows a critical process or dependency check.

Likely causes:

- Missing executable, working directory, install path, or generated config.
- Required variable or secret reference is unresolved.
- A dependency service is stopped or unavailable.
- The service process exits during startup.

First checks:

1. Open Runtime and confirm the runtime API is healthy enough to run actions.
2. Open Services and capture service id, lifecycle state, health state, and
   latest operation id.
3. Open service details and check required config, dependencies, install path,
   and available actions.
4. Open Logs for `stderr`, then `stdout`, then `default` where advertised.
5. Check Variables or Secrets Broker for unresolved references without
   exposing raw values.

Next action:

- Fix the missing path, config, dependency, or reference that matches the first
  failed check, then run Start once and recheck Runtime, Services, and Logs.
  Escalate with service id, operation id, health state, dependency state, and a
  short redacted error summary if the service still does not start.

## Service Starts Then Becomes Degraded Or Critical

Symptoms:

- Lifecycle state changes to running, but health becomes warning or critical.
- Readiness or dependency checks fail after startup.
- Logs show repeated startup, retry, or shutdown summaries.

Likely causes:

- The process is alive but the app is not ready for traffic.
- A dependency, route, generated file, or variable becomes unavailable after
  start.
- Health checks point at the wrong URL, port, protocol, file, or readiness
  contract.

First checks:

1. Compare lifecycle state and health state in Services.
2. Review the failed check type in service details.
3. Use Health Checks to decide whether the problem is process, HTTP, TCP, file,
   variable, or dependency related.
4. Compare recent Logs with the latest health timestamp.
5. Check Dependencies before retrying broad restart actions.

Next action:

- Repair the failed readiness or dependency contract first. Restart only the
  affected service after the failed signal is understood. Escalate with the
  check type, target metadata, timestamp, operation id, and redacted log
  summary.

## Runtime API Unavailable

Symptoms:

- Dashboard, Services, Runtime, or Logs cannot load live data.
- Same-origin `/api/*` calls show unavailable, proxy, timeout, or non-JSON
  errors.
- Runtime health cannot provide a fresh check timestamp.

Likely causes:

- The Service Lasso runtime is stopped, unhealthy, or listening on a different
  host or port.
- Service Admin proxy configuration points at a stale runtime URL.
- A local firewall, port collision, or route configuration blocks the runtime
  API.

First checks:

1. Open Runtime and capture the unavailable state and latest visible error.
2. Confirm Service Admin itself is reachable so the issue is separated from UI
   startup.
3. Check Network or Service Routes for runtime endpoint metadata when
   available.
4. Check the runtime process and configured runtime URL through approved
   operator tooling.
5. Avoid direct service restarts until runtime reachability is restored or a
   runtime-specific blocker is identified.

Next action:

- Restore runtime API reachability or correct the proxy/runtime URL, then
  refresh Dashboard, Runtime, Services, and Logs. Escalate with the failing
  same-origin route, status class, runtime URL metadata, timestamp, and next
  check already performed.

## Logs Unavailable Or Empty

Symptoms:

- Logs shows no sources, no lines, or an unavailable state.
- A service fails, but the requested log type is absent.
- The log view loads metadata but no recent output appears.

Likely causes:

- The runtime API is unavailable or cannot resolve the service id.
- The service has not started far enough to write logs.
- The service does not advertise the selected log type.
- Manifest log capture or stream path metadata is missing or stale.

First checks:

1. Confirm Runtime is reachable and fresh.
2. Confirm the service exists in Services and service details.
3. Check whether the selected log type is advertised for that service.
4. Check lifecycle and health state to decide whether the service ever started.
5. Review service manifest or setup notes for log capture expectations.

Next action:

- Switch to an advertised log type or fix the manifest/runtime log metadata.
  If no logs are expected, document that clearly. Escalate with service id,
  requested log type, advertised log sources, lifecycle state, and a redacted
  summary of any visible error.

## Health Check Failing

Symptoms:

- Runtime or Services shows warning or critical health.
- A service remains running but readiness or dependency state is failing.
- The latest check timestamp is stale or the check target looks wrong.

Likely causes:

- The check type does not match the service contract.
- HTTP, TCP, file, variable, or dependency metadata is stale.
- The service is slow to reach readiness or cannot reach a dependency.
- A stale file or placeholder variable is being used as proof.

First checks:

1. Identify the check type, target, state, and latest timestamp.
2. Compare the check target with Network, Service Routes, Variables, and setup
   config.
3. Review Logs around the failed timestamp.
4. Check Dependencies when the service relies on providers, generated config,
   routes, or secret refs.
5. Confirm whether the failure is a false positive, false negative, or real
   service outage.

Next action:

- Fix the failing check target or the service condition it reveals, then rerun
  the smallest validation action. Escalate with check type, target metadata,
  service state, dependency state, timestamp, and the next check already run.

## Port Collision Or Endpoint Unreachable

Symptoms:

- A service is running, but its URL does not load.
- Network or Service Routes shows a route with invalid or conflicting metadata.
- A start action fails because a port is already in use.

Likely causes:

- Another process owns the advertised port.
- The service binds to `127.0.0.1` while the operator is trying a LAN URL, or
  binds to `0.0.0.0` when a local-only route was expected.
- The URL uses the wrong protocol, host, port, path, route provider, or
  exposure classification.
- Router or firewall state does not match Service Admin metadata.

First checks:

1. Open Network and compare URL, bind, port, protocol, and exposure.
2. Open Service Routes and compare host, path, target, provider, routing
   state, and config source.
3. Confirm the service lifecycle and health state in Services.
4. Check whether another process owns the same bind and port.
5. Review Logs for listener startup or bind failure summaries.

Next action:

- Assign a distinct port, correct route metadata, or repair the router/firewall
  mismatch, then reload runtime metadata and recheck Network, Service Routes,
  Services, and Health Checks. Escalate with endpoint metadata, route provider,
  service id, health state, and redacted bind error summary.

## Config Save Or Validation Failed

Symptoms:

- A config form or setup action reports validation failure.
- The service cannot start after a config change.
- Service details show stale or rejected config revision metadata.

Likely causes:

- Required fields are missing or use the wrong type, path, port, or URL shape.
- A value that should be a secret reference was pasted as plaintext.
- Generated config cannot be written to the expected path.
- The service does not support automatic backup or rollback for this config.

First checks:

1. Review the validation error without copying raw values.
2. Compare the field with Service Install and Setup Config guidance.
3. Check Variables for non-sensitive shared values and Secrets Broker for
   sensitive references.
4. Confirm generated config path, install path, and backup or rollback support.
5. Check Audit for operation receipt metadata when the save started an audited
   operation.

Next action:

- Correct the invalid field, replace sensitive plaintext with a secret ref, or
  restore the last known-good config path if supported. Escalate with service
  id, config field name, validation reason code, revision or operation id, and
  whether rollback is available.

## Installed Paths Missing Or Stale

Symptoms:

- Installed shows a missing or stale service path.
- Service details reference an executable, config, or working directory that
  does not exist.
- Start, setup, or health checks fail because files are unavailable.

Likely causes:

- The service package was moved, deleted, or partially installed.
- Generated files were not refreshed after setup or config changes.
- Runtime metadata still points at an old install root.
- A file health check is using stale evidence.

First checks:

1. Open Installed and capture the path state and service id.
2. Compare service details with install, executable, working directory, and
   config path metadata.
3. Check whether setup or config actions should regenerate the missing file.
4. Review Health Checks for file checks and freshness requirements.
5. Confirm Runtime has reloaded after package or path changes.

Next action:

- Reinstall, regenerate setup output, or correct runtime metadata, then reload
  Runtime and recheck Installed, Services, service details, and Health Checks.
  Escalate with path type, service id, stale path metadata, operation id, and
  the refresh action already attempted.

## Secrets Broker Provider Auth Required, Locked, Or Policy Denied

Symptoms:

- Secrets Broker provider or source state is auth-required, locked,
  unavailable, or policy-denied.
- Variables, topology, or service start shows unresolved secret refs.
- Reveal, rotate, write-back, or resolve operations fail closed.

Likely causes:

- Provider authentication is missing, expired, or intentionally locked.
- A policy blocks the requested operation or service scope.
- The source is unavailable or does not support the requested capability.
- The service has a missing, stale, or incorrectly scoped secret ref.

First checks:

1. Open Secrets Broker providers and capture provider/source state metadata.
2. Open topology or secrets rows for affected service refs and policy state.
3. Check Variables for refs without exposing raw values.
4. Review Audit for operation id, policy outcome, and reason metadata.
5. Confirm the requested capability is supported before retrying the operation.

Next action:

- Authenticate or unlock the provider through the supported flow, adjust policy
  when authorized, or replace the stale ref with a valid secret reference. Do
  not paste or request the raw secret value. Escalate with provider ref, source
  state, affected service ref, policy outcome, operation id, and next supported
  action.

## Telemetry Unavailable Or Exporter Disabled

Symptoms:

- Telemetry shows unavailable, degraded, missing trace context, or disabled
  exporter status.
- A service has logs but no telemetry status row.
- Export preview cannot prove that a collector or sink received data.

Likely causes:

- Runtime telemetry API is unavailable or stale.
- The service does not expose a telemetry status contract through Runtime.
- Export is intentionally disabled or configuration is incomplete.
- Trace context or correlation metadata is not propagated by the service.

First checks:

1. Open Runtime and confirm the runtime API is healthy.
2. Open Operations / Telemetry and capture affected service id, route,
   exporter status, signal kind, and trace context posture.
3. Check service state and Logs for redacted exporter or startup summaries.
4. Confirm whether telemetry export is intentionally disabled.
5. Use Audit only for operator actions, not for raw telemetry payload review.

Next action:

- Restore the runtime telemetry route, configure exporter metadata where
  supported, or document disabled export as intentional. Escalate with service
  id, telemetry route, exporter status, signal kind, correlation posture, and
  redacted error summary.

## Audit Chain Proof Broken Or Unavailable

Symptoms:

- Audit events are missing, unavailable, or cannot prove chain continuity.
- An operator action lacks expected receipt, operation id, or policy outcome.
- Verification status is broken, stale, or unavailable.

Likely causes:

- Runtime or audit API availability is degraded.
- The action completed before audit receipt metadata was recorded.
- A storage, retention, or verification dependency is unavailable.
- A policy or broker operation failed before terminal audit evidence was
  generated.

First checks:

1. Open Runtime and confirm the runtime API is reachable.
2. Open Operations / Audit and capture operation id, event type, policy
   outcome, chain state, and verification timestamp.
3. Compare the action receipt shown on the source page with Audit metadata.
4. Check Secrets Broker state when the audit event belongs to provider, policy,
   reveal, rotate, or write-back workflows.
5. Keep support evidence to ids, refs, typed outcomes, timestamps, and
   verification state.

Next action:

- Recheck Audit after runtime availability is restored or after the terminal
  operation result is visible. Escalate with operation id, event type, chain
  state, verification timestamp, related service or provider ref, and the exact
  missing proof.

## Escalation Packet

When a runbook cannot resolve the issue safely, include only metadata that lets
the next owner continue:

- affected service id or provider ref
- surface where the failure was observed
- lifecycle, health, policy, telemetry, audit, or route state
- operation id, correlation id, receipt id, or timestamp when visible
- one short redacted error summary
- checks already performed
- exact next safe action

Exclude raw credentials, tokens, cookies, private keys, request bodies,
response bodies, recovery material, full environment dumps, and unredacted log
output.

---

[Component guides](../README.md) · Imported from [lasso-serviceadmin](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/help/operator-troubleshooting-runbooks.md). The [migration inventory](../documentation-migration.md) records ownership and remaining work.

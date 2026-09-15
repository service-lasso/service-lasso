# Service Actions

Service actions are operator commands exposed by Service Admin for one service
or for a runtime-level group of services. They are control-plane operations:
operators should treat them as changes to service state, not as simple UI
shortcuts.

## Typical actions

- `start` launches a stopped service runtime. From Service Admin, success means
  the runtime accepted the request; operators should still verify the service
  moves to a running or healthy state afterward.
- `stop` asks the runtime to stop the service gracefully. If the service has
  dependents, operators should check whether those dependents become degraded
  or unavailable.
- `restart` is a stop followed by a start for the same service. Use it when a
  service needs to pick up runtime changes or recover from a bad state, then
  confirm the final state rather than assuming the restart finished cleanly.
- `reload` asks the runtime to refresh service metadata or apply reloadable
  configuration without a full stop/start cycle. A service may still require a
  restart when a setting is not reloadable.
- `install` prepares the service package, local runtime files, dependencies, or
  first-run state required before the service can start.
- `config` or `open_config` opens or applies the service configuration surface.
  Treat saved configuration as a mutating action when it changes how the service
  starts, connects, or stores state.
- `uninstall` removes an installed service package or runtime material. It is
  destructive and should require explicit operator confirmation before it runs.
- `open_logs` opens the log surface for the service. It does not mutate service
  state.
- `open_admin` opens the service's own admin surface when one is available. It
  may lead to service-specific mutations outside Service Admin.

## Service and Runtime Actions

Service-level actions apply to one selected service, usually from the service
details view or a row action. Runtime-level actions apply to the Service Lasso
runtime as a coordinator, such as bulk start or runtime reload.

Use service-level actions when the operator intent is scoped to one service:
start this service, stop this service, restart this service, inspect this
service's logs, or open this service's configuration. Use runtime-level actions
when the operator intent is about the fleet managed by the local runtime, such
as starting all enabled services or asking the runtime to reload service
metadata.

Bulk runtime actions can change several services at once. Before using one,
check whether disabled services, dependencies, and provider services are
included or excluded by the runtime contract. After it finishes, review the
runtime page and the affected service rows instead of validating only the
button result.

## Unavailable or Disabled Actions

An action can be unavailable when the service manifest does not define it, the
runtime does not support it for that service, the service is in the wrong state,
required configuration is missing, or the current operator is not allowed to run
it. Disabled controls should leave the service unchanged.

When an expected action is unavailable:

- check the service state and health first
- check whether the service is installed, configured, and enabled
- check whether a dependency or provider service is unavailable
- inspect logs for runtime errors or rejected requests
- use the service manifest reference to confirm the intended action name and
  behavior

Do not work around a disabled destructive action by using a broader runtime
action unless the operator intent and confirmation still match.

## Destructive and Privileged Actions

`uninstall`, configuration changes, broad runtime actions, and service-specific
admin operations can remove files, change runtime behavior, interrupt
dependents, or make a service unavailable. They should be explicit in the UI and
should ask for confirmation when the outcome is destructive, broad, or hard to
undo.

For mutating actions, collect an operator reason when the flow asks for one.
The reason should describe intent, such as maintenance, recovery, dependency
upgrade, or configuration correction. It must not contain credentials, tokens,
secret values, private keys, raw request bodies, or environment values.

Service Admin may show audit metadata, operation ids, correlation ids, or
status refs for mutating actions. Treat those as operator handoff evidence, not
as a guarantee that every deployment has durable external audit retention unless
the runtime or broker explicitly reports that retention.

## Follow-up Checks

After `start`, `stop`, `restart`, `reload`, `install`, `uninstall`, or a saved
configuration change, verify the result from more than one surface:

- status: the service row or detail page reflects the expected lifecycle state
- health: health checks settle to the expected healthy, degraded, stopped, or
  removed state
- runtime: the Runtime page reports the expected runtime posture and bulk action
  results
- logs: service logs and runtime logs show the operation outcome without
  unresolved errors
- dependencies: dependent services remain healthy or show an expected degraded
  state
- admin/config: any linked admin or config surface reflects the intended change

If an action reports success but the follow-up checks disagree, troubleshoot it
as an incomplete operation rather than rerunning it immediately.

## Failed Actions

Failed actions should surface a clear failure state, not just leave the button
enabled. Operators should look for the operation id, service id, error summary,
runtime response, and any correlation or audit ref shown in the UI.

Troubleshoot in this order:

- service details for the current state and available next action
- Logs for service stdout/stderr or runtime API errors
- Runtime for coordinator health, reload state, and bulk action outcomes
- Operations / Audit Logging for metadata-only mutation evidence when present
- the service manifest and configuration for missing dependencies, invalid
  action names, or unsupported lifecycle behavior

## Action design rules

- label actions clearly for operators
- avoid ambiguous labels
- keep destructive actions explicit
- prefer idempotent action behavior where possible
- show unavailable actions as unavailable instead of implying the action ran
- keep broad runtime actions visually distinct from single-service actions

## UI expectations

From Service Details and related pages, operators should be able to:

- run relevant actions quickly
- understand when actions are unavailable
- jump to logs/details after action execution

## Related References

- Runtime API behavior and same-origin proxy expectations:
  [`README.md`](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/README.md#runtime-api-endpoint)
- Service manifest action definitions:
  [`docs/service-json-reference.md`](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/service-json-reference.md#actions)
- Runtime telemetry and metadata-safe review:
  [`docs/operations-telemetry.md`](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/operations-telemetry.md)
- Audit metadata guardrails:
  [`docs/service-admin-table-surface-audit.md`](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/service-admin-table-surface-audit.md)

---

[Component guides](../README.md) · Imported from [lasso-serviceadmin](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/help/service-actions.md). The [migration inventory](../documentation-migration.md) records ownership and remaining work.

# Startup endpoint allocation

Service Lasso resolves the runtime API and every inbound service network
endpoint as one startup-wide allocation before any listener binds. Manifests
are proposals; `workspaceRoot/runtime/endpoint-allocation.json` is the resolved
runtime state.

## Policies

Each `endpoints[].port.strategy` selects one policy:

| Policy | Proposal behavior | Conflict behavior |
| --- | --- | --- |
| `automatic` | Any port in the allowed range is acceptable. | Select another available port. |
| `preferred` | Try the previous resolved port, then `port.default`. | Select another available port. |
| `fixed` | Require `port.default`. | Fail preflight before the API or any service starts. |

A legacy non-zero `ports.<name>` value is `preferred`. A legacy zero value is
`automatic`. Only an explicit `fixed` strategy creates a fixed allocation.
The runtime API uses `preferred` by default; use CLI
`--port-policy automatic|preferred|fixed` or
`SERVICE_LASSO_API_PORT_POLICY` to choose another policy.

An endpoint-specific `port.range` is intersected with the optional host range
from `SERVICE_LASSO_PORT_RANGE_START` and `SERVICE_LASSO_PORT_RANGE_END`.
Allocation fails when the intersection is empty or no candidate remains.

## Authority and conflict inputs

The planner considers all of these inputs while holding a host-wide lock:

- the runtime API proposal;
- every discovered inbound TCP or UDP service endpoint;
- previous stopped-service ports as preferences;
- verified `launching` or `running` process ownership as pinned allocations;
- active allocations from other Service Lasso lanes in the host registry;
- the workspace reservation ledger;
- actual operating-system bind probes;
- wildcard overlap (`0.0.0.0` or `::`) with loopback/specific bindings;
- endpoint and host-wide allowed ranges.

Verified adopted processes are pinned and cannot move while running. A stale
numeric value without verified process ownership is only a preference. PID or
lease equality alone never pins a port.

The host registry defaults to
`~/.service-lasso/endpoint-allocations.json`. Set
`SERVICE_LASSO_HOST_PORT_REGISTRY_PATH` to isolate it. When
`SERVICE_LASSO_INSTANCE_REGISTRY_PATH` is set, the endpoint registry is placed
beside that registry unless an explicit endpoint-registry path is supplied.
Registry writers use a verified owner lock and atomic, fsynced replacement.
The workspace plan at `runtime/endpoint-allocation.json` uses the same hardened
lifecycle-state boundary as process and generation documents: regular files
only, bounded JSON, explicit `service-lasso.endpoint-allocation.v2` schema,
atomic v1→v2 migration with a bounded `.v1.bak`, and fail-closed handling of
redirected or unsupported-new state.

## Resolved plan

The workspace plan contains one allocation id/revision, lane and optional
generation selectors, attempt number, phase, and safe endpoint records. Each
endpoint record includes:

- owner type/id and endpoint id;
- bind and advertised host;
- transport and protocol;
- declared policy and allowed range;
- resolved port and resolution (`pinned`, `fixed`, `preferred`,
  `renegotiated`, or `automatic`);
- resolved `bind`, `host`, `port`, and `url` selectors.

Read the active or terminal plan through:

```text
GET /api/runtime/endpoints/allocation
```

The response contains no command lines, environment values, credentials,
headers, query strings, or secret-bearing configuration content.

The allocation id is copied into process-ownership revisions and service start
traces. Resolved service ports are materialised into lifecycle state,
environment/command rendering, generated configuration, URLs, and health
checks before service start. Already configured startup services are
rematerialised before the API binds; an unconfigured service retains its
manifest-facing discovery state and consumes the reserved plan when its config
or start action runs.

When a reserved endpoint changes, Core derives the minimal direct and
transitive consumer set from dependency and selector references, rematerialises
affected env, globalenv, commands, generated files, URLs, routes, and health
targets from that one allocation revision, then reloads or restarts in
provider-before-consumer order. Cycles fail before mutation. A failed
rematerialise or restart compensates through the existing startup transaction.
APIs, logs, audit, and tests publish allocation and config digests only.

## Startup and bind races

Startup order is:

1. discover manifests and rehydrate verified ownership;
2. build and atomically reserve the complete endpoint plan;
3. rematerialise resolved selectors for configured startup services;
4. bind the runtime API;
5. install/configure/start eligible services in dependency order;
6. publish process ownership and runtime/service endpoint state.

An external process can still win a race after the bind probe. The runtime
handles API `EADDRINUSE` by releasing the failed plan, reinspecting the host,
replanning, and rematerialising. `SERVICE_LASSO_BIND_RETRY_LIMIT` controls the
finite retry count (default `2`, maximum `10`). Fixed endpoints do not move.

Stopping the runtime releases the host allocation and retains the workspace
plan with phase `released` for diagnosis. Historical workspace ledger entries
are marked stale rather than silently deleted.

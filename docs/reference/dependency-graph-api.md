# Dependency Graph API

Service Lasso exposes read-only dependency graph endpoints for operator UIs,
automation, and support evidence. These payloads contain service ids, names,
declared dependency links, and machine-readable relationship metadata only. They
do not include environment values, provider credentials, tokens, passwords,
cookies, private keys, raw logs, broker secret material, or recovery material.

## Full Graph

```http
GET /api/dependencies
```

Returns the discovered service graph:

- `nodes`: discovered services by `id` and `name`.
- `edges`: declared dependency links where `from` is the dependency service id
  and `to` is the consuming service id.

## Reverse Lookup

```http
GET /api/dependencies/{serviceId}/dependents
```

Returns services that depend on `{serviceId}`.

- `target.id`: requested service or provider id.
- `target.name`: discovered service name, or `null` when the id is only known
  from another service's missing dependency declaration.
- `target.exists`: whether the target manifest is currently discovered.
- `dependents[].relation`: `direct` when the dependent declares `{serviceId}`
  directly, otherwise `transitive`.
- `dependents[].depth`: number of graph hops from target to dependent.
- `dependents[].path`: dependency path from target to dependent.
- `dependents[].blockedBy`: dependency ids on that path that can block the
  dependent; missing manifests are marked with `missing: true`.
- `summary`: total, direct, transitive, and missing-target counts.

The traversal is cycle-protected. A cyclic graph is reported once per reachable
dependent and does not include the target as its own dependent.

## Endpoint Cutover Impact

Runtime endpoint cutover planning uses the same dependency graph as startup
ordering, then narrows the affected set with endpoint selector references in
materialised service surfaces. When a provider endpoint changes, consumers that
reference `endpoint.<id>.<field>` selectors are treated as selector consumers,
and their downstream dependents are included so reload/restart ordering remains
topological.

The planner records selector usage by artifact class only: `env`, `globalenv`,
`commandline`, `args`, `urls`, `healthchecks`, `install`, `config`, `setup`, and
`actions`. It does not return rendered values, secrets, raw config content, or
command outputs. If dependency cycles prevent a safe order, the planner fails
before mutation with an actionable cycle error.

Cutover execution uses that plan to rematerialise only the impacted set from
one allocation revision, then reloads a running service when it declares a
`reload` action and otherwise restarts through normal lifecycle. Provider
services are applied before consumers. Outgoing and incoming allocation
revisions remain distinct on lifecycle state until each service is stamped.
Failure rolls back generated files through the startup transaction journal
rather than a separate rollback mechanism. Published cutover results contain
allocation/config digests and service ids only.

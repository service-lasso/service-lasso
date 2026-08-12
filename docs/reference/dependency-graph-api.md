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

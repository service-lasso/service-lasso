# Environment Variables: Global and Service Reuse

Service Lasso supports service-scoped `env` values, compatibility `globalenv`
values, derived service variables, endpoint selectors, and explicit Secrets
Broker selectors. The final process environment that Service Lasso spawns is
always a string map.

## Scope types

- `env`: service-local values for one service or one action
- `globalenv`: compatibility values shared with other services
- derived: runtime-created values such as `SERVICE_ROOT`
- broker: explicit dotted selectors such as `${database.PASSWORD}`

## Value shapes

Use strings for ordinary variables:

```json
"env": {
  "APP_MODE": "local",
  "SERVICE_URL": "http://127.0.0.1:${endpoint.web.port}/"
}
```

Use string arrays for path-list values such as `PATH`, `PYTHONPATH`, plugin
paths, and tool search paths:

```json
"env": {
  "PATH": [
    "${PYTHON_HOME}",
    "${PYTHON_SCRIPTS_PATH}",
    "${SERVICE_ROOT}/bin"
  ]
}
```

Each array entry is resolved separately, then Service Lasso joins the entries
with the runtime platform path delimiter before launch: `;` on Windows and `:`
on macOS/Linux.

## Selector resolution

Selectors use `${...}` inside string values and string-array entries.

- `${SERVICE_ROOT}` resolves to the service package root.
- `${SERVICE_PATH}` is a compatibility alias for `SERVICE_ROOT`.
- `${SERVICE_STATE_ROOT}` resolves to the service runtime state root.
- `${SERVICE_DATA_PATH}` resolves to the service-local `data` directory.
- `${endpoint.<id>.<field>}` resolves from canonical endpoint metadata.
- `${namespace.KEY}` resolves only through declared Secrets Broker policy.

`${SERVICE_PORT}` remains a compatibility alias for legacy single-port
manifests. New authoring should reference the named endpoint directly, for
example `${endpoint.web.port}`.

Bare selectors such as `${API_KEY}` are local selectors only. They do not fall
back into broker namespaces. Broker references must stay dotted so access is
reviewable.

Unresolved selectors remain visible in diagnostics instead of silently turning
into empty strings. Service authors should define the variable, add the provider
dependency that exports it, or declare the broker import that owns it.

## Env vs globalenv

Prefer `env` for values consumed by a single service. Use `globalenv` only for
bounded compatibility values that are safe and intentionally reusable, such as
provider tool paths.

Do not use `globalenv` for secrets. Map secrets into service-local `env` keys
through explicit broker imports:

```json
"broker": {
  "imports": [
    {
      "namespace": "shared/database",
      "ref": "database.PASSWORD",
      "as": "DB_PASSWORD",
      "required": true
    }
  ]
},
"env": {
  "DB_PASSWORD": "${database.PASSWORD}"
}
```

## Provider path example

Provider services such as Python or Node should export concrete path values
through their own `globalenv` entries. Consuming services should depend on the
provider and reference those exported names.

```json
{
  "id": "python-app",
  "execservice": "@python",
  "depend_on": ["@python", "@node"],
  "env": {
    "PYTHONPATH": "${PYTHON_HOME}",
    "PYTHONUSERBASE": "${SERVICE_ROOT}/__packages__",
    "PATH": [
      "${PYTHON_HOME}",
      "${PYTHON_SCRIPTS_PATH}",
      "${PYTHON_USERBASE_PATH_SCRIPTS}",
      "${SERVICE_ROOT}/__packages__/Python311/Scripts",
      "${NODE_HOME}"
    ]
  }
}
```

`PYTHON_HOME`, `PYTHON_SCRIPTS_PATH`, `PYTHON_USERBASE_PATH_SCRIPTS`, and
`NODE_HOME` are provider-exported names. They are not derived automatically for
every service.

## Operator view

In Service Admin Variables, operators should be able to:

- search keys/values
- filter by scope
- sort columns
- identify which services consume each variable
- inspect unresolved selector diagnostics without exposing raw secret values

For the manifest-level contract, see
[`service-json-env-reference`](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/reference/service-json-env-reference.md).

---

[Component guides](../README.md) · Imported from [lasso-serviceadmin](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/help/environment-variables-global-and-service-reuse.md). The [migration inventory](../documentation-migration.md) records ownership and remaining work.

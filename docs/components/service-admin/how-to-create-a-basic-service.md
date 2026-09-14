# How to Create a Basic Service

This is the minimum flow for adding a new Service Lasso managed service.

## 1) Create a service folder

Create a service directory with your runtime files and a `service.json` manifest.

Example:

```txt
services/
  my-service/
    service.json
    bin/
    config/
    data/
```

## 2) Add service metadata

In `service.json`, define the service identity and runtime basics:

- `id`
- `name`
- `serviceType`
- `runtime`
- `version`
- `build`

## 3) Define runtime commands

Provide start/stop/restart-compatible execution details so the manager can control lifecycle.

Add service-local `env` values when the process needs runtime configuration.
Simple values are strings, and path-list values such as `PATH` can be arrays:

```json
"env": {
  "APP_MODE": "local",
  "SERVICE_URL": "http://127.0.0.1:${endpoint.web.port}/",
  "PATH": [
    "${SERVICE_ROOT}/bin",
    "${NODE_HOME}"
  ]
}
```

Array entries are resolved, then joined with the runtime platform path
delimiter before the process starts. Use provider-exported variables such as
`NODE_HOME` only after declaring the provider dependency that supplies them.

Declare concrete service interfaces in `endpoints[]` and refer to them by name
from `env`, health checks, and generated config. Keep variables outside
endpoint entries.

## 4) Add health checks

Use one or more health checks so the service can report healthy/warning/critical status.

## 5) Validate in Service Admin

After wiring the service:

- confirm it appears in **Services**
- confirm runtime state in **Runtime**
- confirm resolved endpoints in **Network** and use endpoint selectors such as `${endpoint.web.port}` when wiring dependent values
- confirm install/config/data paths in **Installed**

---

[Component guides](../README.md) · Imported from [lasso-serviceadmin](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/help/how-to-create-a-basic-service.md). The [migration inventory](../documentation-migration.md) records ownership and remaining work.

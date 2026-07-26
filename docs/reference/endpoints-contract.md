# Endpoints contract and migration guide

`endpoints[]` is the canonical manifest surface for service interfaces and resources. It replaces authoring against top-level `ports`, `portmapping`, and `urls`, while the runtime still normalizes those legacy fields for compatibility.

This document is the implementation reference for [#811](https://github.com/service-lasso/service-lasso/issues/811), [#810](https://github.com/service-lasso/service-lasso/issues/810), and package migration issues. Startup-wide allocation, reservation, renegotiation, and rematerialization semantics are owned by [#869](https://github.com/service-lasso/service-lasso/issues/869).

## Mental model

One endpoint represents one concrete interface, address, binding, device, mount, URL, or resource.

Endpoint entries describe author intent. They do not contain `env`, `globalenv`, `export`, or `exports` blocks. Variables stay in `env`, `globalenv`, broker policy, command lines, `healthchecks[]`, and materialized config templates.

Use selector form `${endpoint.<id>.<field>}` to read resolved endpoint values. Endpoint ids should prefer lower snake case, for example `web`, `admin_api`, or `https_files`.

## Fields

- `id`: selector-safe endpoint id, unique within the manifest.
- `kind`: `network`, `url`, `mount`, or `device`.
- `label`: optional operator-facing label.
- `direction`: `inbound` or `outbound` when useful.
- `transport`: `tcp` or `udp` for network bindings.
- `protocol`: `http`, `https`, `tcp`, or `udp`.
- `bind`: host/interface, usually `127.0.0.1` for local services.
- `port.default`: author-proposed port. `0` means automatic.
- `port.strategy`: `automatic`, `preferred`, or `fixed`.
- `port.policy`: accepted compatibility alias for `port.strategy`.
- `port.range`: optional `{ "start": number, "end": number }` constraint.
- `target`: endpoint id this endpoint targets, commonly a URL targeting a network endpoint.
- `url`: URL template or concrete URL for `url` endpoints.
- `exposure`: `local`, `lan`, or `public`.
- `required`: whether the endpoint is required for the service to function.
- `primary`: whether this is the primary operator-facing endpoint.

## Examples

Simple HTTP service:

```json
{
  "endpoints": [
    {
      "id": "web",
      "kind": "network",
      "label": "Web",
      "direction": "inbound",
      "transport": "tcp",
      "protocol": "http",
      "bind": "127.0.0.1",
      "port": { "default": 18080, "strategy": "preferred" },
      "exposure": "local",
      "primary": true
    },
    {
      "id": "ui",
      "kind": "url",
      "label": "UI",
      "target": "web",
      "url": "http://127.0.0.1:${endpoint.web.port}/",
      "exposure": "local",
      "primary": true
    }
  ]
}
```

Traefik-style service with many network endpoints:

```json
{
  "endpoints": [
    { "id": "web", "kind": "network", "transport": "tcp", "protocol": "http", "bind": "127.0.0.1", "port": { "default": 19080, "strategy": "preferred" } },
    { "id": "websecure", "kind": "network", "transport": "tcp", "protocol": "https", "bind": "127.0.0.1", "port": { "default": 19443, "strategy": "preferred" } },
    { "id": "admin", "kind": "network", "transport": "tcp", "protocol": "http", "bind": "127.0.0.1", "port": { "default": 19081, "strategy": "preferred" } },
    { "id": "mongo", "kind": "network", "transport": "tcp", "protocol": "tcp", "bind": "127.0.0.1", "port": { "default": 19160, "strategy": "preferred" } },
    { "id": "typedb", "kind": "network", "transport": "tcp", "protocol": "tcp", "bind": "127.0.0.1", "port": { "default": 19170, "strategy": "preferred" } }
  ]
}
```

TCP endpoint such as Mongo or TypeDB:

```json
{
  "endpoints": [
    {
      "id": "mongo",
      "kind": "network",
      "label": "Mongo TCP",
      "direction": "inbound",
      "transport": "tcp",
      "protocol": "tcp",
      "bind": "127.0.0.1",
      "port": { "default": 27017, "strategy": "preferred" },
      "exposure": "local"
    }
  ]
}
```

URL endpoint targeting a network endpoint:

```json
{
  "endpoints": [
    { "id": "api", "kind": "network", "protocol": "http", "bind": "127.0.0.1", "port": { "default": 17890, "strategy": "preferred" } },
    { "id": "health", "kind": "url", "target": "api", "url": "http://127.0.0.1:${endpoint.api.port}/health" }
  ]
}
```

Legacy port alias projected outside endpoints:

```json
{
  "endpoints": [
    { "id": "web", "kind": "network", "protocol": "http", "bind": "127.0.0.1", "port": { "default": 19080, "strategy": "preferred" } }
  ],
  "env": {
    "HTTP": "${endpoint.web.port}"
  },
  "globalenv": {
    "TRAEFIK_HTTP_PORT": "${endpoint.web.port}"
  }
}
```

Config materialization:

```json
{
  "config": {
    "files": [
      {
        "path": "runtime/app.yml",
        "content": "listen: ${endpoint.web.bind}:${endpoint.web.port}\npublicUrl: ${endpoint.ui.url}\n"
      }
    ]
  }
}
```

Healthcheck:

```json
{
  "healthchecks": [
    {
      "id": "web_health",
      "type": "http",
      "url": "http://127.0.0.1:${endpoint.web.port}/health",
      "expected_status": 200,
      "retries": 80,
      "interval": 250
    }
  ]
}
```

## Legacy migration

- `ports.<name> = 8199` normalizes to endpoint `name` with `kind: "network"`, `port.default: 8199`, and `port.strategy: "preferred"`.
- `ports.<name> = 0` normalizes to endpoint `name` with `kind: "network"` and `port.strategy: "automatic"`.
- `urls[]` entries normalize to `kind: "url"` endpoints whose ids are derived from their labels.
- `portmapping.HTTP = "${WEB_PORT}"` is a legacy alias when `web` is already a real network endpoint. Keep that compatibility in `env` or `globalenv`; do not create a fake endpoint.
- Numeric `portmapping` entries can normalize to network endpoints only when they are the only declaration of a real listener.
- Legacy `serviceport`, `serviceportsecondary`, `serviceportconsole`, and `serviceportdebug` style fields should migrate to named network endpoints such as `service`, `secondary`, `console`, or `debug`.

During compatibility, runtime APIs expose resolved endpoints as the primary operational state and continue returning `ports` and `portmapping` where existing callers require them.

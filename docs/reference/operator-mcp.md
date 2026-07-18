# Operator MCP

Service Lasso includes a first read-only Model Context Protocol (MCP) operator surface. The current implementation is a safe inspection prototype; the production roadmap extends it into a standards-compliant, authenticated and permission-controlled operator interface.

## Current implementation

The runtime currently exposes:

- MCP JSON-RPC requests at `POST /api/mcp`
- discovery metadata at `GET /api/mcp`
- protocol revision `2024-11-05`
- six read-only tools
- five read-only resources
- bounded log output and response redaction
- no lifecycle, configuration, update or other mutating tools

The prototype was delivered by [issue #592](https://github.com/service-lasso/service-lasso/issues/592) and [PR #604](https://github.com/service-lasso/service-lasso/pull/604).

### Current tools

| Tool | Purpose |
| --- | --- |
| `service_lasso_list_services` | Safe service inventory, lifecycle booleans, dependencies, ports and paths. |
| `service_lasso_get_health` | Health metadata for one service or all services. |
| `service_lasso_list_routes` | Route and port metadata for one service or all services. |
| `service_lasso_dependency_status` | Dependency readiness, blockers and next-action metadata. |
| `service_lasso_logs_summary` | Bounded recent runtime log lines for one service. |
| `service_lasso_diagnostics_summary` | Dependency and secret-reference audit summaries. |

### Current resources

- `servicelasso://services`
- `servicelasso://health`
- `servicelasso://routes`
- `servicelasso://dependencies`
- `servicelasso://diagnostics`

## Current limitations

The current surface must not be treated as the final production MCP boundary.

Known limitations include:

- handwritten JSON-RPC handling rather than the supported official MCP SDK
- an older protocol revision
- no stdio transport for local MCP clients
- incomplete modern Streamable HTTP request, notification and GET semantics
- no MCP-specific authentication, scope enforcement, Origin validation or per-client rate limiting
- schemas are advertised but inputs are not fully runtime-validated against them
- no tool annotations, output schemas or structured results
- some responses include absolute local runtime paths
- no Audit search, updates, recovery or configuration-drift tools
- no guarded lifecycle or maintenance tools

The production roadmap must correct these limitations without weakening the existing read-only and redaction guarantees.

## Target architecture

The production MCP server remains part of `service-lasso/service-lasso`, because the core runtime owns service discovery, lifecycle, dependency, port, health, update and Audit state.

```text
MCP client
  -> stdio or Streamable HTTP transport
  -> identity and policy enforcement
  -> MCP adapter
  -> shared Service Lasso operator facade
  -> lifecycle / health / logs / updates / recovery / Audit
```

Service Admin and MCP must use the same application-level operator operations. The MCP adapter must not call the runtime through HTTP loopback or reimplement lifecycle behaviour.

Repository ownership:

| Repository | Responsibility |
| --- | --- |
| `service-lasso/service-lasso` | MCP protocol, transports, identity, policy, tools, resources, action facades, Audit and product acceptance. |
| `service-lasso/lasso-serviceadmin` | MCP status, settings, permission matrix, client visibility, approvals and Audit UI. |
| `service-lasso/work-agents` | Worker MCP client configuration and validation after the product MCP is ready. It does not own product logic. |

## Transport model

Service Lasso is local-first and portable.

### stdio

stdio is the preferred transport for local desktop and developer MCP clients.

The stdio entry point must be a thin adapter to the active Service Lasso runtime. It must not start a second competing runtime or become a second owner of managed processes.

### Streamable HTTP

Streamable HTTP supports authenticated LAN or remote clients.

Production requirements include:

- loopback binding by default
- LAN/remote exposure only when explicitly enabled
- correct MCP initialise, request, notification, cancellation and shutdown behaviour
- Origin validation
- request body limits and timeouts
- OAuth protected-resource discovery
- authenticated and audience-bound access tokens
- per-client and per-actor rate limits
- no logging of protocol bodies or credentials

Human-readable discovery moves to `GET /api/mcp/info`. The existing `/api/mcp` behaviour receives a documented compatibility period while clients migrate.

## Operating modes

| Mode | Behaviour |
| --- | --- |
| Disabled | MCP transports are not available. |
| Read-only | Inspection tools and resources are available according to read scopes. This is the default. |
| Guarded | Authorised lifecycle and maintenance tools are available through policy, preflight, confirmation and Audit. |

Enabling guarded mode does not grant permission by itself. Identity scopes and server policy still control every tool call.

## Permission profiles

| Profile | Allowed capability |
| --- | --- |
| Observer | Inventory, health, routes, dependencies, logs, Audit and safe diagnostics according to granted read scopes. |
| Operator | Observer plus service start, stop and restart. |
| Maintainer | Operator plus install, setup, configuration and update actions. |
| Administrator | Maintainer plus runtime-wide actions and MCP policy administration. |

Suggested scopes:

- `service-lasso:read`
- `service-lasso:logs:read`
- `service-lasso:audit:read`
- `service-lasso:lifecycle:write`
- `service-lasso:config:write`
- `service-lasso:update:write`
- `service-lasso:runtime:admin`

For Streamable HTTP, Service Lasso acts as an OAuth protected resource and ZITADEL can provide authorisation. The runtime must validate issuer, signature, expiry, audience/resource and scopes.

The Audit actor is derived from validated identity. A model or client cannot choose its actor by supplying an MCP tool argument.

## Planned read-only surface

The production read surface should cover:

| Capability | Purpose |
| --- | --- |
| Runtime status | Runtime version, health, capabilities and safe instance identity. |
| Service list/detail | Paginated inventory and safe detail for a selected service. |
| Health | Readiness, check result and safe failure explanation. |
| Routes | Ports, route endpoints and Traefik state. |
| Dependencies | Dependencies, dependants, blockers and readiness. |
| Logs | Bounded, redacted, cursor-paginated output. |
| Audit | Filtered, cursor-paginated durable operator events. |
| Updates | Installed and available version metadata. |
| Configuration drift | Safe drift status without raw config or secret values. |
| Recovery | Recovery status, history and safe next action. |
| Operations | Status for long-running Service Lasso actions. |

Resources should use templates rather than returning unbounded global payloads:

- `servicelasso://runtime`
- `servicelasso://services/{serviceId}`
- `servicelasso://services/{serviceId}/health`
- `servicelasso://services/{serviceId}/routes`
- `servicelasso://services/{serviceId}/dependencies`

Every tool requires strict runtime input validation, output schemas, structured results, deterministic limits and stable errors. Absolute local roots should be replaced with opaque identifiers or safe relative paths.

## Planned guarded actions

The first guarded action slice includes:

- service start
- service stop
- service restart
- service install
- service configure
- setup step run
- update check
- update download
- update install
- runtime start all
- runtime stop all

Every mutating request must:

1. authenticate the client and actor
2. check the required scope and server policy
3. run normal Service Lasso dependency, port, health and safety preflight
4. return or bind the exact target and parameters
5. require an unexpired server confirmation when policy requires it
6. execute through the shared operator facade
7. record success, failure, denied or skipped outcome in durable Audit
8. return a correlation id and resulting state or operation id

Confirmations must be actor-bound, target-bound, parameter-bound, expiring and single-use. MCP client confirmation is useful user experience, but it does not replace server-side enforcement.

The MCP server will not expose generic shell commands, unrestricted terminal/stdin, unrestricted filesystem operations, raw configuration documents or secret values.

## Long-running operations

Install, setup, configure, update and runtime-wide actions may exceed a normal MCP request budget.

The runtime should return a durable operation id and provide scoped operation status and safe cancellation tools. Operation state includes only safe metadata such as phase, progress, target ids, timestamps, correlation id and terminal outcome.

The domain operation model should remain compatible with a future MCP Tasks adapter without making experimental protocol features a launch dependency.

## Redaction and Audit boundary

MCP responses and Audit events must not include:

- raw secret values
- environment values
- provider credentials
- access or refresh tokens
- authentication headers or cookies
- passwords or private keys
- broker payloads
- raw request bodies
- raw configuration documents
- raw terminal/stdin payloads
- unrestricted raw log content
- absolute paths unless explicitly safe and required

Route URLs strip usernames, passwords, query strings and fragments. Log output is bounded and redacted before serialization. Output contracts should use allowlisted fields instead of relying only on best-effort denylist scrubbing.

Every mutating attempt, including denied and failed attempts, records safe durable Audit metadata with actor, client, tool, target, outcome and correlation id.

## Delivery backlog

The implementation is tracked by [epic #858](https://github.com/service-lasso/service-lasso/issues/858).

Recommended order:

1. [#859 — official SDK and standards-compliant transports](https://github.com/service-lasso/service-lasso/issues/859)
2. [#860 — identity, OAuth discovery, scopes and policy](https://github.com/service-lasso/service-lasso/issues/860)
3. [#861 — complete read-only tools, resources and structured contracts](https://github.com/service-lasso/service-lasso/issues/861)
4. [#862 — guarded lifecycle and maintenance actions](https://github.com/service-lasso/service-lasso/issues/862)
5. [#863 — durable long-running operation status and cancellation](https://github.com/service-lasso/service-lasso/issues/863)
6. [#864 — security, conformance, packaging and canonical acceptance](https://github.com/service-lasso/service-lasso/issues/864)
7. [Service Admin #423 — MCP settings, permissions, approvals and health](https://github.com/service-lasso/lasso-serviceadmin/issues/423)
8. [work-agents #67 — worker configuration and canonical MCP verification](https://github.com/service-lasso/work-agents/issues/67)

## Definition of complete

The MCP product is shippable when:

- standard clients initialise and call tools over stdio and Streamable HTTP
- MCP protocol and transports use the supported official SDK
- Observer credentials cannot mutate state
- Origin, token audience and scope checks fail closed
- read tools have strict schemas, structured outputs, annotations and deterministic pagination
- guarded actions use exact server-side policy and confirmation
- normal lifecycle dependency, health and port negotiation behaviour is preserved
- duplicate/retried action calls cannot create unsafe repeated mutations
- long-running work remains observable and safely cancellable where supported
- every mutating attempt is present in durable Audit with a correlation id
- secret, config, token, cookie, private-key and path sentinels never appear in MCP output or Audit
- Windows, Linux and macOS packaged smoke coverage passes
- MCP Inspector and supported target clients pass acceptance
- the canonical demo verifies discovery, representative reads and one guarded lifecycle action
- Service Admin status, permission and approval surfaces use live runtime state
- operator setup, security, migration and troubleshooting documentation is complete

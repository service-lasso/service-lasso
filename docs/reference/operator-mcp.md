# Operator MCP

Service Lasso includes a first read-only Model Context Protocol (MCP) operator surface. The current implementation is a safe inspection prototype; the production roadmap extends it into a standards-compliant, authenticated and permission-controlled operator interface.

## Current implementation

The runtime currently exposes:

- MCP Streamable HTTP requests at `POST /api/mcp`
- discovery and compatibility metadata at `GET /api/mcp/info`
- a bounded migration response at `GET /api/mcp` that returns `405 Method Not Allowed`
- protocol revision `2024-11-05` on the compatibility metadata surface
- `@modelcontextprotocol/sdk` `1.30.0` pinned for MCP server registration and Streamable HTTP handling
- RFC 9728 protected-resource metadata at `GET /.well-known/oauth-protected-resource` when MCP OAuth is fully configured
- asymmetric JWT signature, issuer, expiry, configured-audience, and scope validation for configured Streamable HTTP
- trusted actor/client derivation from validated token claims; MCP arguments never supply actor authority
- exact Origin allowlisting, JSON content-type enforcement, and a 1 MiB request-body limit before protocol handling
- explicit `disabled`, `read-only` (default), and `guarded` transport modes, with a fail-closed read-only tool allowlist
- cumulative Observer, Operator, Maintainer, and Administrator profile classification from validated scopes
- independent fixed-window actor and client rate limits with safe `429` denial Audit events
- fail-closed `503` behavior when the MCP authorization Audit event cannot be persisted
- seven read-only tools
- six read-only resources
- an opt-in local stdio adapter connected directly to the active runtime process
- bounded log output and response redaction
- secret-metadata tool that never returns secret values
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
| `service_lasso_secret_metadata` | Secret refs, assignment, rotation readiness, and Secrets Broker availability. Never secret values. |

### Current resources

- `servicelasso://services`
- `servicelasso://health`
- `servicelasso://routes`
- `servicelasso://dependencies`
- `servicelasso://diagnostics`
- `servicelasso://secret-metadata`

## Current limitations

The current surface must not be treated as the final production MCP boundary.

Known limitations include:

- the legacy JSON-RPC compatibility handler remains in source until stdio and stateful sessions are fully migrated
- Streamable HTTP is currently stateless and does not yet expose resumable GET SSE sessions
- MCP OAuth is opt-in; without complete OAuth configuration Streamable HTTP remains loopback-local and uses the runtime's trusted local actor
- schemas are advertised but inputs are not fully runtime-validated against them, except `service_lasso_secret_metadata` which rejects additional properties
- no tool annotations, output schemas or structured results
- some responses include absolute local runtime paths
- secret metadata reports Broker lifecycle availability but does not query live lockout counts
- no Audit search, updates, recovery or configuration-drift tools
- no guarded lifecycle or maintenance tools

The production roadmap must correct these limitations without weakening the existing read-only and redaction guarantees.

## Streamable HTTP identity boundary

This partial `SPEC-006` `AC-6C` slice makes the configured Streamable HTTP
endpoint an OAuth protected resource. A standards-compatible OAuth
authorization server owns authorization and token issuance; Service Lasso only
validates the resulting access token and enforces resource-server policy.

All four OAuth settings are required together:

- `SERVICE_LASSO_MCP_OAUTH_ISSUER`
- `SERVICE_LASSO_MCP_OAUTH_JWKS_URI`
- `SERVICE_LASSO_MCP_RESOURCE_URI` (the canonical URL ending in `/api/mcp`)
- `SERVICE_LASSO_MCP_OAUTH_AUDIENCE`

`SERVICE_LASSO_MCP_MODE` accepts `disabled`, `read-only`, or `guarded` and
defaults to `read-only`. Invalid values fail the MCP surface closed with `503`.
Disabled mode returns `404` for MCP transport and discovery routes. Read-only
mode accepts only the current allowlisted inspection tools. Guarded mode does
not itself grant authority and does not expose lifecycle or maintenance tools
in this issue; those remain owned by `#862`.

Rate limits are enabled by default and may be bounded with positive integer
settings:

- `SERVICE_LASSO_MCP_RATE_LIMIT_WINDOW_MS` (default `60000`, maximum `3600000`)
- `SERVICE_LASSO_MCP_RATE_LIMIT_PER_ACTOR` (default `120`, maximum `100000`)
- `SERVICE_LASSO_MCP_RATE_LIMIT_PER_CLIENT` (default `240`, maximum `100000`)

The actor and client counters are independent and use only validated, bounded
identity claims. A denial returns `429` with `Retry-After`, records a safe
`mcp.auth.denied` event, and never records a token or protocol body. Invalid
rate configuration fails the MCP request closed with `503`.

`SERVICE_LASSO_MCP_ALLOWED_ORIGINS` may contain a comma-separated list of exact
browser origins. The configured resource origin is always allowed. Requests
without an `Origin` header remain valid for non-browser MCP clients; any
present Origin must match the allowlist exactly. OAuth/resource URLs require
HTTPS, except loopback HTTP for local development and deterministic tests.

Partial OAuth configuration fails closed. When OAuth is configured:

- missing, malformed, incorrectly signed, wrong-issuer, expired, or
  wrong-configured-audience tokens receive `401`
- the challenge points clients to the RFC 9728 resource metadata endpoint
- every request requires `service-lasso:read`
- `service_lasso_logs_summary` additionally requires
  `service-lasso:logs:read`
- protected-resource metadata advertises only those two currently enforced
  scopes; guarded-action and broader read scopes remain owned by later issues
- validated subject and client claims become the trusted Audit actor/client;
  request bodies and tool arguments cannot override them
- cumulative validated scopes classify the identity as Observer, Operator,
  Maintainer, or Administrator for Audit and later guarded-policy use
- Audit records contain only safe actor/client/scope metadata and never token,
  header, cookie, or protocol-body material
- if the authorization Audit event cannot be persisted, protocol execution is
  skipped and the request receives a redacted `mcp_audit_unavailable` `503`

Without OAuth configuration, Streamable HTTP accepts only an authenticated
loopback runtime actor. This preserves local-first operation without turning
an unconfigured LAN listener into an unauthenticated MCP endpoint.

`#860` remains open only for stdio credential handling and smoke evidence. The
repository still has no thin stdio adapter to the active runtime. Starting a
second runtime or calling the runtime back over HTTP would violate the target
architecture, so this residual cannot be represented honestly by a standalone
credential parser or an isolated SDK transport test.

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

Set `SERVICE_LASSO_MCP_STDIO=1` when launching the normal runtime to attach
the SDK stdio transport to that same active runtime process. It does not start
a second runtime and does not call the API over HTTP. Because stdio has no
HTTP authorization header, all three protected process-environment settings
are required before the adapter starts:

- `SERVICE_LASSO_MCP_STDIO_CREDENTIAL` — a local, non-empty capability secret;
  it is never sent over MCP, recorded in Audit, logged, or returned.
- `SERVICE_LASSO_MCP_STDIO_ACTOR` — a bounded trusted local actor id.
- `SERVICE_LASSO_MCP_STDIO_CLIENT_ID` — a bounded trusted local client id.

The runtime records only the actor, client, permission profile, and scopes in
the safe `mcp.auth.allowed` Audit event. Missing or malformed stdio settings
fail closed and do not enable the adapter. Configure these variables through
the desktop/client process's protected environment or equivalent OS-managed
secret facility; do not put them in manifests, command arguments, logs, or
MCP request bodies.

### Streamable HTTP

Streamable HTTP supports authenticated LAN or remote clients.

Production requirements include:

- loopback binding by default
- LAN/remote exposure only when explicitly enabled
- correct MCP initialise, request, notification, cancellation and shutdown behaviour
- exact Origin validation
- JSON request content and body-size limits; request timeouts remain follow-up
- OAuth protected-resource discovery
- signature-, issuer-, expiry-, audience-, and resource-bound access tokens
- independent per-client and per-actor rate limits with safe denial Audit
- no logging of protocol bodies or credentials

Human-readable discovery moves to `GET /api/mcp/info`. The existing `/api/mcp` behaviour receives a documented compatibility period while clients migrate.

The first SDK-backed migration slice keeps existing read-only tool and resource names stable for `POST /api/mcp` clients. Clients must send an MCP-compatible `Accept` header, such as `application/json, text/event-stream`. Plain `GET /api/mcp` no longer returns discovery JSON; callers should use `GET /api/mcp/info` for operator-facing metadata.

## Operating modes

| Mode | Behaviour |
| --- | --- |
| Disabled | MCP transports are not available. |
| Read-only | Inspection tools and resources are available according to read scopes. This is the default. |
| Guarded | The mode is accepted and reported, but this `#860` slice still exposes only read-only tools. Authorised lifecycle and maintenance tools arrive through `#862` policy, preflight, confirmation and Audit. |

Enabling guarded mode does not grant permission by itself. Identity scopes and server policy still control every tool call.
Read-only mode rejects any tool outside the current inspection allowlist before
the SDK handler runs, so adding a later guarded tool cannot silently widen the
default surface.

## Permission profiles

| Profile | Allowed capability |
| --- | --- |
| Observer | Inventory, health, routes, dependencies, logs, Audit and safe diagnostics according to granted read scopes. |
| Operator | Observer plus service start, stop and restart. |
| Maintainer | Operator plus install, setup, configuration and update actions. |
| Administrator | Maintainer plus runtime-wide actions and MCP policy administration. |

Profiles are classified cumulatively. An Operator must have read plus lifecycle
scope; a Maintainer must also have configuration and update scopes; an
Administrator must additionally have runtime-admin scope. A high privilege
scope presented without its prerequisite scopes does not upgrade the profile.
This issue records and tests the profile matrix while continuing to expose no
mutating tools; guarded-action enforcement remains `#862`.

Suggested scopes:

- `service-lasso:read`
- `service-lasso:logs:read`
- `service-lasso:audit:read`
- `service-lasso:lifecycle:write`
- `service-lasso:config:write`
- `service-lasso:update:write`
- `service-lasso:runtime:admin`

For Streamable HTTP, Service Lasso acts as an OAuth protected resource and a standards-compatible OAuth server can provide authorisation. The runtime must validate issuer, signature, expiry, the configured audience and scopes.

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
| Secret metadata | Refs, assignment, rotation readiness, and Broker availability without values. First slice: `#1067` / `SPEC-006` `AC-6A`. Live lockout counts remain later. |
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

The implementation is tracked by [epic #858](https://github.com/service-lasso/service-lasso/issues/858) and bound to `.governance/specs/SPEC-006-operator-mcp.md`.

Recommended order:

1. [#859 — official SDK and standards-compliant transports](https://github.com/service-lasso/service-lasso/issues/859) (merged through PR #1029)
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

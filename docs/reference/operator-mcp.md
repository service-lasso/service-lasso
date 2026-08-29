# Operator MCP

Service Lasso includes a versioned Model Context Protocol (MCP) operator surface for inspecting the active runtime and, only in explicit guarded mode, invoking a bounded set of lifecycle and maintenance actions. It uses the same discovery, health, route, dependency, lifecycle, update, recovery and Audit functions as the normal operator surfaces.

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
- fifteen read-only tools with strict input/output schemas, titles, annotations, text compatibility content and `structuredContent`
- twelve explicit guarded tools in `guarded` mode, each with a strict allowlisted schema, shared application facade, authoritative preflight and durable Audit
- seven static read-only resources and seven service-scoped resource templates
- an opt-in local stdio adapter connected directly to the active runtime process
- bounded log output and response redaction
- secret-metadata tool that never returns secret values
- durable, actor/client-bound idempotency results and expiring single-use server confirmations for actions that require confirmation
- durable long-running operation records with actor/workspace isolation, bounded retention, restart reconciliation, safe progress, and cancellation where the underlying action supports it

The prototype was delivered by [issue #592](https://github.com/service-lasso/service-lasso/issues/592) and [PR #604](https://github.com/service-lasso/service-lasso/pull/604).

### Current tools

| Tool | Purpose |
| --- | --- |
| `service_lasso_runtime_status` | Runtime version, readiness and supported read capabilities. |
| `service_lasso_list_services` | Cursor-paginated safe service inventory and lifecycle metadata. |
| `service_lasso_get_service` | Allowlisted detail for one service. |
| `service_lasso_get_health` | Health metadata for one service or all services. |
| `service_lasso_list_routes` | Route, port and effective Traefik metadata for one service or all services. |
| `service_lasso_dependency_status` | Dependency readiness, blockers and next-action metadata. |
| `service_lasso_logs_summary` | Bounded, redacted, cursor-paginated runtime log summaries for one service. |
| `service_lasso_audit_search` | Filtered, cursor-paginated durable Audit events with sensitive metadata omitted. |
| `service_lasso_update_status` | Installed, available and downloaded update state without URLs, paths or hook output. |
| `service_lasso_config_drift` | Opaque config-artifact drift status without paths, values, hashes or previews. |
| `service_lasso_recovery_status` | Cursor-paginated recovery history without commands, output or raw messages. |
| `service_lasso_operation_status` | Read one actor-owned durable operation by opaque id; Administrators may inspect another actor explicitly. |
| `service_lasso_list_operations` | List actor-owned operations with deterministic bounded pagination; Administrators may explicitly include all actors. |
| `service_lasso_diagnostics_summary` | Dependency and secret-reference audit summaries. |
| `service_lasso_secret_metadata` | Secret refs, assignment, rotation readiness, and Secrets Broker availability. Never secret values. |

### Current resources

- `servicelasso://services`
- `servicelasso://runtime`
- `servicelasso://health`
- `servicelasso://routes`
- `servicelasso://dependencies`
- `servicelasso://diagnostics`
- `servicelasso://secret-metadata`

Service-scoped resource templates are:

- `servicelasso://services/{serviceId}`
- `servicelasso://services/{serviceId}/health`
- `servicelasso://services/{serviceId}/routes`
- `servicelasso://services/{serviceId}/dependencies`
- `servicelasso://services/{serviceId}/updates`
- `servicelasso://services/{serviceId}/drift`
- `servicelasso://services/{serviceId}/recovery`

### Guarded tools

Guarded tools are advertised only when `SERVICE_LASSO_MCP_MODE=guarded` and the active runtime has supplied the shared action facade. Read-only mode remains the default and does not advertise or execute them.

| Tool | Required profile and scope | Confirmation |
| --- | --- | --- |
| `service_lasso_start_service`, `service_lasso_stop_service`, `service_lasso_restart_service` | Operator; `service-lasso:lifecycle:write` | Required |
| `service_lasso_install_service`, `service_lasso_configure_service`, `service_lasso_run_setup_step` | Maintainer; `service-lasso:config:write` | Required |
| `service_lasso_check_updates` | Maintainer; `service-lasso:update:write` | Not required |
| `service_lasso_download_update`, `service_lasso_install_update` | Maintainer; `service-lasso:update:write` | Required |
| `service_lasso_start_all`, `service_lasso_stop_all` | Administrator; `service-lasso:runtime:admin` | Required |
| `service_lasso_cancel_operation` | The original action profile and scope; `service-lasso:read` is also required | Not applicable |

Omit `execute` or set it to `false` to receive the authoritative plan. When confirmation is required, that response contains a server-issued confirmation id, phrase and expiry. Execute by resending the allowlisted action parameters with `execute: true`, a unique idempotency key, and the matching confirmation fields. The runtime recomputes the plan and rejects any actor, client, action, target, parameter, plan, candidate revision, phrase or expiry mismatch before mutation. A completed idempotency key returns the committed business result with truthful replay metadata and an opaque server key id; altered parameters conflict, and an in-progress or uncertain result is never repeated automatically. A terminal Audit outage leaves a durable pending outcome that a later identical request reconciles without repeating mutation.

The action schemas accept service ids, declared setup-step ids and the update-install `force` flag only where applicable. There is no generic command, shell, terminal, raw configuration, environment, filesystem or secret input.

### Durable operations

Install, configuration, setup, update, and runtime-wide actions enter the durable operation model when they exceed the default one-second MCP request budget. A client receives `service-lasso-mcp-operation-accepted.v1` with an opaque operation id, then polls `service_lasso_operation_status` or uses `service_lasso_list_operations`. Fast completions keep the existing guarded-action response contract.

Operation records contain only the action, status, bounded phase and progress, safe summary, timestamps, allowlisted target ids, one shared Audit correlation id, cancellation support, terminal outcome, and whether the caller owns the record. They never retain action parameters, idempotency keys, confirmation material, configuration bodies, paths, raw output, logs, credentials, secret values, or unbounded errors. State is scoped to the active workspace and protected with the runtime's private-state storage. An actor sees only its own records unless an Administrator explicitly requests cross-actor inspection.

Only update checks and update downloads are safely cancellable. `service_lasso_cancel_operation` returns `requested`, `unsupported`, or `too_late`; a request cancellation signal uses the same safe path while the MCP request remains active. A live runner owns cancellation through its durable heartbeat, so another MCP process requests cancellation through state and cannot claim success merely from the action name. Client disconnect does not repeat or orphan the guarded mutation. After Core restart, a terminal result is accepted only from the operation's opaque, correlation-bound guarded execution record or an explicit authoritative adapter; ambient install, configuration, or running snapshots never prove that a particular operation completed. An unproven non-terminal operation remains honestly `detached` and expires as `interrupted` rather than consuming capacity forever.

Terminal records are retained for 24 hours by default, with an implementation maximum of seven days and a bounded store of 48 records. Active runners publish a generation identity and bounded heartbeat, while terminal Audit publication uses a deterministic event identity under the operation-state claim so reconciliation cannot duplicate an outcome. Cleanup and interrupted-operation reconciliation occur during later operation reads, lists, and mutations. The operation domain is independent of experimental MCP Tasks.

Confirmation binds the manifest and template bytes plus the exact existing executable inputs resolved by the same launch resolver used by the process supervisor. That includes service/provider launch files, basename and option-file arguments, recursive setup steps, doctor steps, lifecycle stop overrides, and update hooks. Update-install plans state the stop-override and pre/post/failure-hook subprocess effects that can actually run; forced installs omit the inactive stop effect. After the pre-upgrade hook, the runtime rereads and rehashes the confirmed archive, then extracts only those immutable in-memory bytes so a path replacement cannot be legitimized as the installed candidate.

### Read contract, limits and errors

Every tool rejects additional properties at runtime. Read tools are annotated read-only, non-destructive, idempotent and closed-world; guarded tools are explicitly annotated mutating with per-action destructive and open-world hints. Successful calls return the same versioned payload in text and structured form. Synchronous guarded completions include bounded target, effect and resulting lifecycle-state fields. Cursors are deterministic decimal offsets; malformed, non-canonical or stale offsets fail rather than silently restarting a page.

| Surface | Default | Maximum |
| --- | ---: | ---: |
| Service inventory and update state | 50 | 100 |
| Log summaries | 20 | 50 |
| Audit search | 50 | 100 |
| Recovery history | 20 | 100 |
| Durable operations | 50 | 100 |

Read errors use stable codes such as `unknown_service`, `feature_unavailable`, `forbidden`, `invalid_cursor` and `invalid_request`. Guarded actions additionally distinguish mode, profile, scope, confirmation and idempotency failures. Errors contain a stable code and safe message, never an internal exception, root path, raw log/config value or credential.

Streamable HTTP requires `service-lasso:read` for all tools, `service-lasso:logs:read` for `service_lasso_logs_summary`, `service-lasso:audit:read` for `service_lasso_audit_search`, and the action scope shown above for guarded tools. The protected-resource metadata advertises all seven supported scopes. The trusted local stdio adapter defaults to read and log scopes; guarded stdio scopes must be set explicitly.

## Current limitations

The current surface must not be treated as the final production MCP boundary.

Known limitations include:

- the legacy JSON-RPC compatibility handler remains in source until stdio and stateful sessions are fully migrated
- Streamable HTTP is currently stateless and does not yet expose resumable GET SSE sessions
- MCP OAuth is opt-in; without complete OAuth configuration Streamable HTTP remains loopback-local and uses the runtime's trusted local actor
- the read surface is stateless; clients should treat cursors as snapshot-relative and retry a fresh query after `invalid_cursor`
- secret metadata reports Broker lifecycle availability but does not query live lockout counts
- durable operations intentionally use the current tool contract rather than experimental MCP Tasks; a future Tasks adapter must preserve the same domain and safety behavior

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
not itself grant authority; each guarded tool still requires the validated
profile, exact scope, authoritative preflight, idempotency key and any required
server confirmation.

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
- `service_lasso_logs_summary` additionally requires `service-lasso:logs:read`
- `service_lasso_audit_search` additionally requires `service-lasso:audit:read`
- guarded tools additionally require their lifecycle, configuration, update or runtime-admin scope
- protected-resource metadata advertises all seven supported read and guarded-action scopes
- validated subject and client claims become the trusted Audit actor/client;
  request bodies and tool arguments cannot override them
- cumulative validated scopes classify the identity as Observer, Operator,
  Maintainer, or Administrator for Audit and guarded-policy enforcement
- Audit records contain only safe actor/client/scope metadata and never token,
  header, cookie, or protocol-body material
- if the authorization Audit event cannot be persisted, protocol execution is
  skipped and the request receives a redacted `mcp_audit_unavailable` `503`

Without OAuth configuration, Streamable HTTP accepts only an authenticated
loopback runtime actor. This preserves local-first operation without turning
an unconfigured LAN listener into an unauthenticated MCP endpoint.

`#860` is complete through PR `#1137`. The opt-in stdio adapter attaches to the
active runtime and preserves the same identity, scope, Audit and redaction
boundary without starting a second runtime or calling back over HTTP.

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
- `SERVICE_LASSO_MCP_STDIO_SCOPES` — optional comma- or space-separated scopes.
  It defaults to `service-lasso:read service-lasso:logs:read`; guarded stdio
  actions require explicitly configured supported write scopes and the
  resulting cumulative profile.

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
| Guarded | Read tools plus the twelve explicit lifecycle, maintenance, and cancellation tools are available, subject to validated scope/profile policy, preflight, idempotency, confirmation and Audit. |

Enabling guarded mode does not grant permission by itself. Identity scopes and server policy still control every tool call.
Read-only mode rejects any tool outside the current inspection allowlist before
the SDK handler runs, so enabling guarded tools cannot silently widen the
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
The runtime enforces both the cumulative profile and the action-specific scope;
neither alone authorizes mutation.

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

## Read-only surface

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
| Operations | Explicit unsupported-capability status until durable action state is delivered by #863. |

Service-specific resources use templates rather than returning unbounded global payloads:

- `servicelasso://runtime`
- `servicelasso://services/{serviceId}`
- `servicelasso://services/{serviceId}/health`
- `servicelasso://services/{serviceId}/routes`
- `servicelasso://services/{serviceId}/dependencies`
- `servicelasso://services/{serviceId}/updates`
- `servicelasso://services/{serviceId}/drift`
- `servicelasso://services/{serviceId}/recovery`

Every current read tool has strict runtime input validation, an output schema, structured results, deterministic limits and stable errors. Absolute local roots and config paths are omitted or replaced with opaque identifiers.

## Guarded action execution model

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

The confirmed plan also binds endpoint allocations, dependency/setup targets, canonical manifest definitions, template-source digests, resolved service/provider launch files, recursive setup-step execution files, and exact SHA-256 update/install candidates. Template bytes are rechecked at materialization; launch and setup files are rechecked after awaited preparation immediately before process spawn; provider downloads are verified before write; and cross-process idempotency locks recover only atomically claimed orphan owners.

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

Safe route URLs are projected to protocol, host and path metadata without query strings or fragments. URLs containing credential- or secret-like material fail closed as invalid metadata and are not serialized. Log output is bounded and redacted before serialization. Output contracts use allowlisted fields instead of relying only on best-effort denylist scrubbing.

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

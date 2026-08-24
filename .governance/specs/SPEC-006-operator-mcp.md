# Operator MCP

## Intent
Give Cursor and other MCP clients a local-first operator surface on the Service Lasso runtime: inspect services, secret *metadata*, logs, and later guarded lifecycle actions through the same facades Service Admin uses. This spec binds the production MCP programme already tracked as GitHub `#858`–`#864` and the product leftover `#1067`. It does not invent a second MCP server or a second secrets product.

## Scope
Included:
- One MCP adapter in `service-lasso` that reuses runtime/operator facades
- Read-only tools and resources, including secret metadata without values
- Later programme slices for official SDK transports, identity/scopes, complete read tools, guarded actions, long-running operations, and release gates
- Documentation in `docs/reference/operator-mcp.md`

Explicitly out of scope:
- A parallel MCP server in Service Admin, Secrets Broker, or work-agents
- Secret values, tokens, cookies, private keys, recovery material, raw env, or KV get/reveal in MCP output
- Generic shell, unrestricted filesystem, raw config documents, or stdin tools
- Guessing a new transport/identity architecture beyond `#858` / `docs/reference/operator-mcp.md`
- Service Admin MCP settings UI (`lasso-serviceadmin#423` is already closed)
- Canonical demo recycle or keep-alive ownership from this spec
- Official SDK / stdio / Streamable HTTP replacement (`#859`, open draft PR `#1029`)
- OAuth discovery and mutating lifecycle tools (`#860`, `#862`)

## Acceptance Criteria
- `AC-6A`: The read-only MCP prototype exposes a dedicated secret-metadata tool and resource that return allowlisted metadata only: secret refs, namespace/key, assignment/access-policy status, rotation readiness, and Secrets Broker lifecycle availability. Responses, resources, and tests never include secret values, credential sentinels, env values, tokens, cookies, private keys, recovery material, or absolute workspace/manifest/log paths. Live broker lockout counts stay on the existing telemetry bridge until a later slice; this criterion reports lockout as not queried rather than fetching KV.
- `AC-6B`: MCP protocol plumbing uses the supported official TypeScript SDK with stdio and standards-compliant Streamable HTTP (`#859`). This criterion is not satisfied by handwritten JSON-RPC alone.
- `AC-6C`: Streamable HTTP identity, OAuth protected-resource discovery, scopes, and server-side policy fail closed (`#860`). Observer credentials cannot mutate state. Actors come from validated identity, never from tool arguments.
- `AC-6D`: The complete read-only operator surface covers runtime status, paginated services, health, routes, dependencies, bounded redacted logs, Audit search, updates, drift, recovery, and operations, with strict schemas and structured output (`#861`). `#1067` closes only when this criterion plus `AC-6G` meet the product bar for services, secret metadata, and logs.
- `AC-6E`: Guarded lifecycle and maintenance tools call shared operator facades, enforce Observer/Operator/Maintainer/Administrator boundaries, and require actor-bound server confirmation (`#862`).
- `AC-6F`: Long-running install/update actions return a durable operation id that can be polled and cancelled (`#863`).
- `AC-6G`: Security, redaction, conformance, packaging, and canonical demo acceptance gates run in the normal CI/release path (`#864`).

## Tests and Evidence
- Focused `tests/operator-mcp.test.js` coverage for tool/resource advertisement, secret-metadata shape, unknown-service errors, extra-argument rejection, and `assertNoSecretMaterial` redaction.
- Later slices add identity, guarded-action, operation, Inspector, stdio, and packaged-app evidence under `#859`–`#864`.

## Documentation Impact
- `.governance/specs/SPEC-006-operator-mcp.md`
- `docs/reference/operator-mcp.md`
- `.governance/project/BACKLOG.md` MCP issue register
- `.governance/project/PROJECT_INTENT.md`

## Verification
- `npm run build` then `node --test --test-concurrency=1 tests/operator-mcp.test.js`
- No live tokens or secret values in fixtures, logs, or MCP responses

## Change Notes
- 2026-08-21: `#1067` / `AC-6A` adds `service_lasso_secret_metadata` and `servicelasso://secret-metadata` on the existing handwritten MCP prototype. `#859` draft PR `#1029` remains the transport owner; this slice does not replace JSON-RPC or add OAuth.
- Live Secrets Broker lockout aggregates remain a residual for a later `#861`/`#864` slice so MCP does not grow a second KV or telemetry client.

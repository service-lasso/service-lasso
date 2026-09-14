# Product status and safety

Service Admin pages use the same status language in Help Center docs so operators can tell whether a surface is backed by a live runtime contract, static metadata, a preview contract, development-only scaffolding, or a planned backend.

Do not describe a page as live, durable, runtime-backed, or production-ready unless the implementation and tests prove that contract. When a page is useful but not fully backed by a service API, describe what is safe to inspect and which backend contract is still required.

## Status categories

| Status | Meaning | Documentation rule |
| --- | --- | --- |
| Runtime-backed | The page reads or writes through a live Service Lasso runtime or service API contract. | Name the API boundary and describe the durable evidence operators can trust. |
| Metadata-only | The page shows refs, states, ids, timestamps, health, audit, or policy metadata without raw secret, credential, or payload material. | State that the page is for inspection or review and does not mutate backend state. |
| Preview/static contract | The page models a planned or versioned contract with fixtures, static examples, or dry-run output. | Mark examples as preview evidence and avoid claiming live backend durability. |
| Stub/dev-only | The page or behavior is available only for local development, tests, or placeholder flows. | Call out the dev-only source and block operator actions that would imply a real backend. |
| Planned/backend contract required | The page has a product direction but still needs a backend route, storage contract, worker, or service integration. | Name the missing contract and link future docs to the owning issue when one exists. |

## Current Service Admin page status

| Surface | Current status | Operator note |
| --- | --- | --- |
| Dashboard | Runtime-backed | Reads runtime dashboard metadata through the Service Admin runtime proxy. Treat service state, health, Broker ready, lockout counts, and lifecycle metadata as the operator-visible runtime summary. Never show secret values or auto-onboard because home loaded. |
| Services | Runtime-backed | Lists Service Lasso service metadata and lifecycle state from the runtime. Service actions must keep returning operation ids, safe status, and recovery guidance. |
| Runtime | Runtime-backed | Shows runtime health and readiness signals. Health rows are operational status evidence, not raw process logs or secret-bearing diagnostics. |
| Logs | Runtime-backed | Reads runtime log metadata and safe log lines through the runtime boundary. Docs must continue to describe redaction and retention limits. |
| Variables | Metadata-only | Shows environment and secret-ref posture without raw values. It is not a secrets viewer or credential editor. |
| Dependencies | Metadata-only | Shows service dependency and secret-ref relationships derived from safe metadata. It does not prove credential validity by itself. |
| Installed | Metadata-only | Shows install paths, manifests, and local availability metadata. It does not install or mutate services unless a separate action explicitly provides that contract. |
| Network and Service Routes | Metadata-only | Shows route and network posture from configured service metadata. It should not imply public reachability unless a runtime check proves it. |
| Operations / Telemetry | Metadata-only | Shows Service Lasso runtime and Secrets Broker telemetry status through runtime APIs. It does not configure exporters, send telemetry, or reveal OTLP endpoints, headers, tokens, cookies, raw request bodies, raw response bodies, or environment values. |
| Operations / Audit Logging | Metadata-only with runtime-backed events where exposed | Shows durable action and broker audit metadata when the runtime exposes it, and fallback status when unavailable. It must not claim immutable audit durability unless the backend audit sink and tests prove it. |
| Secrets Broker Secrets | Preview/static contract with guarded runtime reads where exposed | `/secrets-broker` redirects here. Secret rows, previews, receipts, and operation trails are metadata-only. Reveal, rotate, reset, policy, and migration actions require broker operation ids, audit reasons, confirmation, and terminal status evidence before docs can call them applied. Home shows Broker ready and lockout counts. |
| Secrets Broker Sources | Metadata-only setup guidance | Shows provider setup and source posture. Authentication status may be shown, but provider tokens and credential material must never appear. |
| Secrets Broker Topology | Metadata-only | Shows service-to-secret-ref relationships and validation state. It does not prove secret value availability. |
| Support Bundle and Diagnostics | Excluded from Release 1 GA | No route, navigation item, preview, or export ships in the GA surface. A future release requires a redacted backend export API and released-artifact evidence that bundles omit secrets. |
| Settings | Stub/dev-only or local preference backed, depending on page | Appearance and display settings are local UI preferences. Account, profile, and notification pages must not claim external identity or notification durability without a live backend contract. |

## Writing future Help Center docs

- Start each operator article with a status statement using one of the categories above.
- Say exactly which API, fixture, local preference, or static contract the surface uses.
- Include the safe evidence an operator can trust, such as service id, operation id, audit id, correlation id, health state, version, provider ref, or timestamp.
- Include a negative claim when needed: no raw secrets, provider credentials, tokens, cookies, private keys, request bodies, response bodies, recovery material, or environment values.
- If a backend contract is missing, say what is missing instead of presenting the workflow as live.

---

[Component guides](../README.md) · Imported from [lasso-serviceadmin](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/help/product-status-and-safety.md). The [migration inventory](../documentation-migration.md) records ownership and remaining work.

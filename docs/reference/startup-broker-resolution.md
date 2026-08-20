# Startup broker resolution

Service launch can consume Secrets Broker refs declared in `service.json` without exposing resolved values outside the launch materialization boundary.

## Manifest shape

Declare broker imports under `broker.imports`, then reference them from `env` with `${namespace.KEY}` selectors:

```json
{
  "id": "api",
  "name": "API",
  "description": "Service using broker-backed config",
  "env": {
    "DATABASE_URL": "postgres://app:${database.PASSWORD}@db/service",
    "API_TOKEN": "${service.API_TOKEN}"
  },
  "broker": {
    "imports": [
      {
        "namespace": "shared/database",
        "ref": "database.PASSWORD",
        "as": "DB_PASSWORD",
        "required": true
      },
      {
        "namespace": "services/api",
        "ref": "service.API_TOKEN",
        "as": "API_TOKEN",
        "required": false
      }
    ]
  }
}
```

Precedence at launch is:

1. provider env from the selected runtime provider
2. Service Lasso manifest/derived/global variables, with broker selectors substituted only for declared imports
3. broker imports with `as` names that do not override existing manifest env keys
4. scoped broker writeback identity env, when the service declares broker writeback permissions

When scoped broker writeback identity env is issued, Service Lasso also records safe transport-binding metadata when the launcher identity is known. Unix launchers default to the current launcher UID as `unix-uid`. Windows launchers can provide a stable service-account or launcher SID with `SERVICE_LASSO_BROKER_TRANSPORT_BINDING_KIND=windows-sid` and `SERVICE_LASSO_BROKER_TRANSPORT_BINDING_SUBJECT=<sid>`. These values are metadata only; the scoped credential value remains secret and must not be logged or persisted.

When an installed or configured Secrets Broker helper and signing material are available, the launcher also asks `secretsbroker admin launch-lease issue` for a signed launch identity lease and injects it through `SERVICE_LASSO_BROKER_IDENTITY_LEASE`. The helper receives service id, workspace id, allowed refs/namespaces, allowed operations, expiry, one-time identity id, and optional transport binding. If the helper is unavailable or no signing key/API token is configured, the runtime keeps the existing local scoped credential path so bootstrap and tests remain compatible. The signed lease is launch-only authority and must not be written to lifecycle state, logs, diagnostics, issue comments, PR bodies, or persisted fixtures.

Raw broker values may be present only in the process environment/config handed to the launched service. They must not be written to logs, status payloads, diagnostics, issue comments, PR bodies, or test artifacts.

## Startup pipeline

The runtime startup path is formalized as:

1. Compile a selector plan from service `env` plus `broker.imports`.
2. Deduplicate broker refs so each unique selector is looked up at most once per launch.
3. Batch lookup the unique refs through the live Secrets Broker `POST /v1/resolve` boundary. Core issues a one-time launch identity lease (no transport binding, because loopback HTTP rejects bound leases), authenticates with the operator API token, and maps typed outcomes back onto the original import refs. Tests and callers may still supply an explicit `brokerLookup` to keep the plumbing path.
4. Classify every unresolved ref as one of:
   - `missing`
   - `locked`
   - `auth-required`
   - `policy-denied`
   - `source-unavailable`
   - `degraded`
5. For each declared `broker.writeback.generatedSecrets[]` entry whose `source` is `broker:generate` and whose ref is still `missing`, call Secrets Broker `POST /v1/provisioning/operations/apply` with `generationMode: broker_generated`. This is first-run onboard only. Discovery never writes KV. Default `allowOverwrite: false` skips refs that already resolve. Then re-run the resolve lookup for those refs.
6. Fail closed before process spawn when any `required: true` import is unresolved.
7. Materialize resolved values only into the launched service environment/config.
8. Issue a scoped broker writeback identity when the service declares writeback permissions, including transport-binding metadata when available.
9. Issue a broker-signed launch identity lease through the Secrets Broker helper when available and inject it only into the launched process environment.
10. Emit safe metadata only: ref name, classification, `required`, `as` target, identity id, expiry, and transport-binding kind/subject when present.

Policy-denied refs are intentionally separate from missing refs. Operators should see that access was denied, not that config disappeared.

## Cache invalidation

Selector plans are cached by service manifest path/id and the effective `env` + `broker.imports` content. The cache invalidates when:

- an env template changes
- a broker import is added, removed, renamed, or changes `required` / `as`
- materialization templates change for config/install planning

The cache stores selector metadata only, never resolved broker values.

## Safe diagnostics

Safe failure metadata example:

```json
{
  "ref": "database.PASSWORD",
  "status": "locked",
  "required": true,
  "as": "DB_PASSWORD"
}
```

Unsafe output that must not be logged or returned:

```text
DB_PASSWORD=...
access_token=...
client_secret=...
raw resolved secret values
```

## Node Sample Service rotation and update testing

Git-managed source of truth: `services/node-sample-service/`. Workspace copies under `workspace/canonical-services-root` are demo runtime trees, not the authoring source.

Default/canonical services do not ship live KV secrets. `node-sample-service` declares:

- Non-secrets (plain env, not Broker): `NODE_SAMPLE_PUBLIC_LABEL`, `NODE_SAMPLE_FEATURE_FLAG`, `NODE_SAMPLE_PUBLIC_URL`
- Optional consumer import: `shared/sample` / `sample.API_TOKEN` (KV path `shared/sample/sample.API_TOKEN`)
- First-run producer: `services/node-sample-service` / `sample.GENERATED_TOKEN` (KV path `services/node-sample-service/sample.GENERATED_TOKEN`)

Operator steps (path/ref names only; never print values):

1. Ensure `@secretsbroker` is ready, then start `node-sample-service`. First start generates the missing producer once.
2. Confirm KV metadata list shows `services/` (or the producer path). Admin at root previously showed empty because nothing was seeded.
3. Open `http://127.0.0.1:<service-port>/diagnostics`. Check `secrets.generatedToken.present` and `last4` only.
4. Rotate the producer through Secrets Broker rotation activate (or Admin KV write of a new version), then restart the sample. `last4` should change. List/metadata still must not include values.
5. Update `NODE_SAMPLE_FEATURE_FLAG` in the service config/Variables editor and restart. Diagnostics `nonSecrets.featureFlag` should change without a Broker provisioning apply.

Optional: write `sample.API_TOKEN` under `shared/sample` if you need a consumer-import path. It is not required for start.

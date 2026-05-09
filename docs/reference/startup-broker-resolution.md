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

Raw broker values may be present only in the process environment/config handed to the launched service. They must not be written to logs, status payloads, diagnostics, issue comments, PR bodies, or test artifacts.

## Startup pipeline

The runtime startup path is formalized as:

1. Compile a selector plan from service `env` plus `broker.imports`.
2. Deduplicate broker refs so each unique selector is looked up at most once per launch.
3. Batch lookup the unique refs through the Secrets Broker boundary.
4. Classify every unresolved ref as one of:
   - `missing`
   - `locked`
   - `auth-required`
   - `policy-denied`
   - `source-unavailable`
   - `degraded`
5. Fail closed before process spawn when any `required: true` import is unresolved.
6. Materialize resolved values only into the launched service environment/config.
7. Emit safe metadata only: ref name, classification, `required`, and `as` target.

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

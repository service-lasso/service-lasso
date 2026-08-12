# Service Secret Access Policy

_Status: first manifest-side contract for Secrets Broker resolve authorization._

Service Lasso service manifests declare secret use in `broker.imports`,
`broker.exports`, and `broker.writeback`. `broker.accessPolicy` is the
manifest-side assignment that says which service identity is allowed to use
which broker namespace/ref for a specific operation and purpose.

This contract is metadata only. It must never contain raw secret values,
provider tokens, private keys, recovery material, cookies, passwords, or
credential payloads.

## Shape

```json
{
  "id": "api-service",
  "broker": {
    "enabled": true,
    "accessPolicy": {
      "serviceId": "api-service",
      "workspace": "local-demo",
      "grants": [
        {
          "namespace": "shared/database",
          "scope": "shared",
          "refs": ["database.PASSWORD"],
          "operations": ["resolve"],
          "purpose": "connect to the shared database at runtime"
        }
      ]
    }
  }
}
```

Fields:

- `serviceId`: optional service id the assignment applies to. When present it
  must match the top-level manifest `id`.
- `workspace`: optional workspace or deployment scope such as `local-demo`,
  `site-a`, or another operator-owned name.
- `grants`: optional list of allowed namespace/ref operations.
- `grants[].namespace`: broker namespace boundary such as `shared/database`,
  `services/api-service`, or `global`.
- `grants[].scope`: optional scope classification: `workspace`, `service`,
  `app`, `shared`, or `global`.
- `grants[].refs`: optional explicit dotted refs. Omit only when the grant is
  intentionally namespace-wide for the listed operations.
- `grants[].operations`: allowed operations. Supported values are `resolve`,
  `create`, `update`, `rotate`, and `delete`.
- `grants[].purpose`: non-empty review/audit purpose metadata.

## Allowed and denied refs

Allowed runtime import:

```json
{
  "env": {
    "DB_PASSWORD": "${database.PASSWORD}"
  },
  "broker": {
    "imports": [
      {
        "namespace": "shared/database",
        "ref": "database.PASSWORD",
        "as": "DB_PASSWORD",
        "required": true
      }
    ],
    "accessPolicy": {
      "serviceId": "api-service",
      "workspace": "local-demo",
      "grants": [
        {
          "namespace": "shared/database",
          "scope": "shared",
          "refs": ["database.PASSWORD"],
          "operations": ["resolve"],
          "purpose": "connect api-service to the shared database"
        }
      ]
    }
  }
}
```

Denied runtime import:

```json
{
  "env": {
    "DB_ROOT_PASSWORD": "${database.ROOT_PASSWORD}"
  },
  "broker": {
    "accessPolicy": {
      "serviceId": "api-service",
      "workspace": "local-demo",
      "grants": [
        {
          "namespace": "shared/database",
          "scope": "shared",
          "refs": ["database.PASSWORD"],
          "operations": ["resolve"],
          "purpose": "connect api-service to the shared database"
        }
      ]
    }
  }
}
```

The denied example uses `database.ROOT_PASSWORD` but does not declare a
matching `broker.imports[]` entry or a matching `broker.accessPolicy` grant.
Service Lasso reports this as missing policy metadata without revealing a
secret value.

## Runtime validation

Manifest parsing validates malformed assignments:

- `broker.accessPolicy.serviceId` must match the top-level manifest `id`.
- grant namespaces and refs must use the same bounded broker namespace/ref
  syntax as imports and writeback policy.
- grant operations must be one of `resolve`, `create`, `update`, `rotate`, or
  `delete`.
- if `broker.accessPolicy` is present, each `broker.imports[]` ref must have a
  matching `resolve` grant.
- if `broker.accessPolicy` is present, generated writeback refs must have a
  matching operation grant for their export namespace.

The secret reference audit also reports missing access-policy assignment for
declared broker imports. That report includes service id, namespace/ref,
operation, status, and reason only; it does not include resolved secret values.

## Integration boundary

This is the Service Lasso manifest-side contract. Actual Secrets Broker
authorization enforcement is tracked by
`service-lasso/lasso-secretsbroker#30`.

Service Admin policy simulation remains a UI follow-up: it should consume this
metadata and broker enforcement/audit results, not claim enforcement from the UI
alone.

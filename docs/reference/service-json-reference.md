# service.json Reference

_Status: canonical runtime manifest reference._

This doc is the one-stop reference for the current `service.json` direction in the core `service-lasso` runtime.

It is meant to make the runtime and service templates usable without forcing service authors to reconstruct the contract from scattered notes.

## What this doc covers

- top-level manifest purpose
- common top-level fields
- `actions`
- `setup`
- env / broker / dependencies / ports
- healthcheck direction
- examples
- what is currently canonical vs still illustrative

## Important current rule

The current template direction is:

- **default health model = `process`**
- other health models are used only when explicitly declared by service config

Supported explicit healthcheck types include:

- `http`
- `tcp`
- `file`
- `variable`

## Purpose of `service.json`

`service.json` is the canonical service manifest used by Service Lasso to understand how a service should be discovered, prepared, executed, and monitored.

At a high level it carries:

- identity
- operator metadata
- lifecycle/action hints
- runtime execution settings
- environment settings
- explicit Secrets Broker imports/exports/write-back policy
- dependency hints
- health expectations

## Current sample manifest

The current sample in this repo is:

```json
{
  "id": "echo-service",
  "name": "Echo Service",
  "description": "Minimal sample service used to prove the service-template contract.",
  "enabled": true,
  "version": "0.1.0",
  "logoutput": true,
  "icon": [
    {
      "provider": "lucide",
      "name": "terminal"
    }
  ],
  "logo": [
    {
      "path": "./logo.svg"
    }
  ],
  "servicetype": 50,
  "servicelocation": 10,
  "actions": {
    "install": {
      "description": "Prepare the sample runtime payload if needed."
    },
    "config": {
      "description": "Materialize effective runtime config for the sample service."
    },
    "start": {
      "description": "Start the sample echo service."
    },
    "stop": {
      "description": "Stop the sample echo service gracefully."
    }
  },
  "execconfig": {
    "serviceorder": 100,
    "serviceport": 0,
    "execcwd": "runtime",
    "executable": "echo-service",
    "env": {
      "ECHO_MESSAGE": "hello from service-template"
    },
    "depend_on": [],
    "healthcheck": {
      "type": "process"
    }
  }
}
```

## Top-level fields

### `id`

Unique service identifier.

Example:

```json
"id": "echo-service"
```

Current direction:

- required
- should be stable
- should align with the service repo’s identity

### `name`

Human-facing display name.

Example:

```json
"name": "Echo Service"
```

### `description`

Short operator-facing description.

### `enabled`

Whether the service is enabled by default.

### `role`

Declares whether the manifest describes a normal managed service or a local runtime provider.

Supported values:

- `service` or omitted: a normal service that can be installed, configured, started, stopped, and health-checked as a managed process when execution metadata is present
- `provider`: a runtime provider such as `@node`, `@python`, or `@java`; providers can be local/no-download or release-backed through `artifact` metadata

Provider-role services are installed/configured so their variables and dependency contract are available, but baseline start does not launch them as long-running daemon processes unless a later provider contract explicitly requires that.

Example:

```json
"role": "provider"
```

### `version`

Current package/version identity for the service.

### `logoutput`

Whether stdout/stderr style runtime logging should be captured/displayed.

### `icon`

UI/operator-facing symbolic icon list.

Current direction:

- `icon` should be an array of entries
- each entry should identify an icon `provider` and `name`
- consumers can choose the first icon provider they support

Example:

```json
"icon": [
  {
    "provider": "lucide",
    "name": "terminal"
  }
]
```

### `logo`

UI/operator-facing image/logo list.

Current direction:

- `logo` should be an array of entries
- the simple form is just `path`
- later entries can grow to include more metadata such as format/theme/size

Example:

```json
"logo": [
  {
    "path": "./logo.svg"
  }
]
```

### `servicetype`

Numeric service type classification value.

### `servicelocation`

Numeric service location classification value.

## `actions`

`actions` is where the service defines or overrides named lifecycle actions.

Current intended rule:

- actions correspond to known Service Lasso lifecycle/action names
- service config can override how a named action behaves for that service
- if a service does not override a supported action, Lasso default behavior applies

Current sample actions:

- `install`
- `config`
- `start`
- `stop`

### Current action examples

```json
"actions": {
  "install": {
    "description": "Prepare the sample runtime payload if needed."
  },
  "config": {
    "description": "Materialize effective runtime config for the sample service."
  },
  "start": {
    "description": "Start the sample echo service."
  },
  "stop": {
    "description": "Stop the sample echo service gracefully."
  }
}
```

### Current action semantics direction

- `install`
  - prepare/install payload and required local setup
- `config`
  - materialize effective config from explicit inputs
- `start`
  - launch the service runtime
- `stop`
  - stop the service gracefully

Additional action names may exist later, but this first-pass template should stay small and lifecycle-focused.

## `execconfig`

`execconfig` contains the runtime execution contract.

This is where the service tells Lasso how to run and supervise it.

### `serviceorder`

Startup ordering hint.

Example:

```json
"serviceorder": 100
```

### `serviceport`

Primary service port.

In the sample, `0` is being used as a simple first-pass placeholder/default meaning “no fixed service port required by this sample”.

### `execcwd`

Execution working directory.

Example:

```json
"execcwd": "runtime"
```

### `executable`

Executable or executable key/name used for the service runtime.

Example:

```json
"executable": "echo-service"
```

Current direction:

- when a service runs directly, `executable` can be the local binary/script name or path
- when a service runs through a runtime provider, `executable` should be treated as the executable key exposed by that provider

Provider-backed example:

```json
"execservice": "@node",
"executable": "NODE",
"args": ["runtime/server.js"]
```

Meaning:

- `execservice` chooses the runtime/provider service to use
- `executable` chooses which executable from that provider should be invoked
- the resulting runtime command is conceptually `NODE runtime/server.js`

This means `execservice` and `executable` are related, but not the same thing:

- `execservice` = who runs it
- `executable` = what binary from that runner gets used

Practical rule:

- use both when you want provider-backed execution to stay explicit
- do not assume `execservice` alone is enough unless Service Lasso later defines provider defaults clearly enough to make `executable` optional

### `args` and `commandline`

`args` is the structured argument array passed to the selected executable.

`commandline` is a platform-specific string map used when a service needs to preserve an exact startup argument string:

```json
"commandline": {
  "win32": " --config=\"${SERVICE_ROOT}\\runtime\\service.yml\" --port=\":${SERVICE_PORT}\"",
  "darwin": " --config=\"${SERVICE_ROOT}/runtime/service.yml\" --port=\":${SERVICE_PORT}\"",
  "linux": " --config=\"${SERVICE_ROOT}/runtime/service.yml\" --port=\":${SERVICE_PORT}\"",
  "default": " --config=\"${SERVICE_ROOT}/runtime/service.yml\" --port=\":${SERVICE_PORT}\""
}
```

Current core behavior:

- Service Lasso selects `commandline[process.platform]`, falling back to `commandline.default`.
- `${...}` selectors are resolved with the same service variables used for env/config materialization.
- Selector planning classifies `${VAR}` as local/current-service/derived/legacy-compatible lookup and `${namespace.KEY}` as an explicit broker lookup.
- Bare names never fall through into broker namespaces; broker lookups must use dotted selectors.
- Repeated dotted broker selectors are deduplicated before a broker resolver is called.
- The resolved commandline is parsed into process arguments and overrides `args` during `start` and `restart`.
- `commandline` is the arguments payload after the executable; it does not include the executable itself.
- Keep `args` as the fallback when no platform/default commandline is declared.

### `execservice`

Runtime-provider service used to run this service through another packaged/runtime service.

Example:

```json
"execservice": "@node"
```

Use this when:

- the service should run through a packaged Node/Python/Java runtime provider
- the service does not own the runtime binary directly inside its own payload

Do not use this when:

- the service already ships and runs its own executable directly

### `env`

Service-local environment variables.

Example:

```json
"env": {
  "ECHO_MESSAGE": "hello from service-template"
}
```

Current direction:

- service env should be explicit
- avoid depending on uncontrolled host-machine env leakage
- use `${VAR}` for local/current-service/derived values and legacy `globalenv` compatibility
- use `${namespace.KEY}` only for explicit Secrets Broker selectors; unresolved or denied broker refs stay unresolved for diagnostics rather than falling back to a bare local name

### `broker`

`broker` is the first-class Secrets Broker manifest contract. It lets a service declare the namespaces and refs it consumes, the values it exports, and which generated secrets it may write back.

Services without a `broker` block keep the existing behavior. There is no implicit migration from `env` or `globalenv` into broker state.

Shape:

```json
"broker": {
  "enabled": true,
  "namespace": "services/consumer",
  "buckets": [
    {
      "namespace": "services/consumer",
      "kind": "service",
      "description": "private values for this service"
    },
    {
      "namespace": "shared/database",
      "kind": "shared"
    }
  ],
  "imports": [
    {
      "namespace": "shared/database",
      "ref": "database.PASSWORD",
      "as": "DB_PASSWORD",
      "required": true
    }
  ],
  "exports": [
    {
      "namespace": "services/producer",
      "ref": "producer.PUBLIC_URL",
      "source": "${SERVICE_URL}",
      "required": false
    }
  ],
  "writeback": {
    "allowedNamespaces": ["services/producer"],
    "allowedOperations": ["create", "update", "rotate"],
    "allowedRefs": ["producer.API_TOKEN"],
    "allowOverwrite": false,
    "auditReason": "capture generated service token",
    "generatedSecrets": [
      {
        "ref": "producer.API_TOKEN",
        "source": "${API_TOKEN}",
        "operation": "create",
        "required": true
      }
    ]
  }
}
```

Fields:

- `enabled`: optional boolean. `false` can be used to leave a declared broker contract dormant.
- `namespace`: optional default service namespace. It must be a non-empty broker namespace string such as `services/consumer`.
- `buckets`: optional array declaring the namespace buckets this manifest participates in. Bucket namespaces must be unique.
- `buckets[].namespace`: a namespace boundary such as `services/consumer`, `apps/reference`, `shared/database`, or `global`.
- `buckets[].kind`: optional bucket kind: `service`, `app`, `shared`, or `global`.
- `buckets[].description`: optional human-readable note for review/audit.
- `imports`: optional array of explicit broker refs the service may consume.
- `imports[].namespace`: namespace authorization boundary for the import.
- `imports[].ref`: dotted broker selector such as `database.PASSWORD`.
- `imports[].as`: optional local variable name to materialize the import into. This stays service-specific, so a ref such as `${database.PASSWORD}` can become `DB_PASSWORD` for one process and `PGPASSWORD` for another.
- `imports[].required`: optional boolean; required imports should fail closed when absent or denied.
- `exports`: optional array of values this service publishes to broker namespaces.
- `exports[].namespace`: namespace authorization boundary for the export.
- `exports[].ref`: dotted broker selector such as `producer.PUBLIC_URL`.
- `exports[].source`: local selector or literal value to export, for example `${SERVICE_URL}`.
- `exports[].required`: optional boolean; required exports should fail closed when the source is unavailable.
- `writeback.allowedNamespaces`: optional array limiting namespaces this service may write generated secrets into.
- `writeback.allowedOperations`: optional array of allowed generated-secret operations: `create`, `update`, `rotate`, `delete`.
- `writeback.allowedRefs`: optional array limiting generated-secret refs within the allowed namespaces.
- `writeback.allowOverwrite`: optional boolean; defaults should be treated as no overwrite unless a broker implementation explicitly opts in.
- `writeback.auditReason`: optional non-empty operator/audit reason attached to generated-secret capture.
- `writeback.generatedSecrets`: optional array declaring generated values that may be captured from service-local variables and written back through the broker.
- `writeback.generatedSecrets[].ref`: dotted broker ref that must also have a matching `exports[].ref`.
- `writeback.generatedSecrets[].source`: local selector or literal source, for example `${API_TOKEN}`. Sources are resolved from service-local variables; raw secret values must not be logged.
- `writeback.generatedSecrets[].operation`: optional operation for this capture: `create`, `update`, `rotate`, or `delete`.
- `writeback.generatedSecrets[].required`: optional boolean; required captures should fail closed when the source cannot be resolved.

Launch-time writeback identity:

- Services with `broker.writeback` declared receive a short-lived per-launch broker credential from the runtime.
- The credential is scoped to the service id plus `writeback.allowedNamespaces`, `writeback.allowedRefs`, and `writeback.allowedOperations`.
- Runtime injects the credential through reserved process env keys: `SERVICE_LASSO_BROKER_IDENTITY_ID`, `SERVICE_LASSO_BROKER_CREDENTIAL`, and `SERVICE_LASSO_BROKER_CREDENTIAL_EXPIRES_AT`.
- Lifecycle state may persist non-secret identity metadata for audit (`id`, service id, issued/expires/revoked timestamps, scope, audit reason), but must not persist the raw credential value.
- Stop/restart revokes active launch credentials; expiry also denies later writeback attempts.
- Broker writeback audit records should use the launched service identity and the optional `writeback.auditReason`.

Selector semantics:

- `${VAR}` means local/current-service variables only, including derived variables and legacy-compatible values already visible to the service.
- `${namespace.KEY}` means an explicit broker lookup.
- Bare names never fall through into broker namespaces.
- Broker refs must be dotted. This keeps broker access reviewable and prevents accidental secret reads from ordinary env selectors.
- Duplicate bucket namespaces, duplicate import refs, duplicate `imports[].as` names, duplicate export namespace/ref pairs, duplicate writeback refs, and duplicate generated-secret refs are invalid.
- `imports[].as` may intentionally line up with an `env` key only when that env value is exactly the same dotted broker selector, for example `"DB_PASSWORD": "${database.PASSWORD}"`. It must not collide with `globalenv` output names.

Producer example:

```json
{
  "id": "token-producer",
  "name": "Token Producer",
  "description": "Generates a service token and publishes it to the broker.",
  "env": {
    "PUBLIC_URL": "http://127.0.0.1:${SERVICE_PORT}/"
  },
  "broker": {
    "enabled": true,
    "namespace": "services/token-producer",
    "buckets": [{ "namespace": "services/token-producer", "kind": "service" }],
    "exports": [
      {
        "namespace": "services/token-producer",
        "ref": "token.PUBLIC_URL",
        "source": "${PUBLIC_URL}",
        "required": true
      }
    ],
    "writeback": {
      "allowedNamespaces": ["services/token-producer"],
      "allowedOperations": ["create", "update", "rotate"],
      "allowedRefs": ["token.PUBLIC_URL"],
      "allowOverwrite": false,
      "auditReason": "publish generated token endpoint",
      "generatedSecrets": [
        {
          "ref": "token.PUBLIC_URL",
          "source": "${PUBLIC_URL}",
          "operation": "create",
          "required": true
        }
      ]
    }
  }
}
```

Consumer example:

```json
{
  "id": "token-consumer",
  "name": "Token Consumer",
  "description": "Consumes an explicit broker value.",
  "env": {
    "TOKEN_ENDPOINT": "${token.PUBLIC_URL}"
  },
  "broker": {
    "enabled": true,
    "namespace": "services/token-consumer",
    "buckets": [
      { "namespace": "services/token-consumer", "kind": "service" },
      { "namespace": "services/token-producer", "kind": "shared" }
    ],
    "imports": [
      {
        "namespace": "services/token-producer",
        "ref": "token.PUBLIC_URL",
        "as": "TOKEN_ENDPOINT",
        "required": true
      }
    ]
  }
}
```

Migration from `globalenv`:

```json
{
  "globalenv": {
    "DB_PASSWORD": "${DB_PASSWORD}"
  }
}
```

Legacy `globalenv` remains a compatibility path for bounded provider/tool values that are already safe to share. New cross-service secret flow should move to explicit broker imports/exports so values are bucketed as current-service, app-level, explicitly shared, or truly global instead of ambiently merged into every launched process.

Ordinary services should consume broker values through service-local `env` names or through an explicit CLI/adapter resolution step. Keep the manifest reviewable:

- map each secret to a concrete env key, for example `"DB_PASSWORD": "${database.PASSWORD}"`
- declare the same dotted ref in `broker.imports[]`; undeclared dotted refs are denied instead of falling back to ambient/global lookup
- do not print resolved values in normal logs, diagnostics, issue comments, or support bundles
- prefer env mapping for long-running processes; use CLI-style resolution only for controlled setup/adapter paths that do not echo arguments or outputs containing raw secrets
- missing, locked, auth-required, policy-denied, source-unavailable, or degraded refs should fail with actionable diagnostics that name the ref and reason without including the secret value
- startup resolution batches unique declared broker selectors once per launch and materializes raw values only into the launched service environment/config boundary; see [Startup Broker Resolution](./startup-broker-resolution.md)

Becomes an explicit broker contract:

```json
{
  "env": {
    "DB_PASSWORD": "${database.PASSWORD}"
  },
  "broker": {
    "enabled": true,
    "namespace": "services/api",
    "buckets": [
      { "namespace": "services/api", "kind": "service" },
      { "namespace": "shared/database", "kind": "shared" }
    ],
    "imports": [
      {
        "namespace": "shared/database",
        "ref": "database.PASSWORD",
        "as": "DB_PASSWORD",
        "required": true
      }
    ]
  }
}
```

### `depend_on`

Explicit dependencies.

Example:

```json
"depend_on": []
```

Current direction:

- use this for services that require another service/runtime/provider first
- keep empty for the minimal sample

## Healthcheck

### Default rule

Current rule:

- if a service does not explicitly require another model, the default is **`process`**

Example:

```json
"healthcheck": {
  "type": "process"
}
```

This is the right default for a simple sample service.

### Explicit healthcheck types

Service Lasso supports these explicit healthcheck types:

- `http`
- `tcp`
- `file`
- `variable`

`process` is the current template default direction; use one of the explicit types above when a service needs a stronger readiness signal.

### `process` healthcheck

Use when:

- service health is adequately represented by the process being up/running
- you do not need a deeper readiness endpoint yet

Sample:

```json
"healthcheck": {
  "type": "process"
}
```

### `http` healthcheck

Use when:

- the service exposes an HTTP readiness or health endpoint

Sample:

```json
"healthcheck": {
  "type": "http",
  "url": "http://localhost:${SERVICE_PORT}/health",
  "expected_status": 200
}
```

### `tcp` healthcheck

Use when:

- readiness is best represented by a socket accepting connections

Sample:

```json
"healthcheck": {
  "type": "tcp"
}
```

This relies on the configured service host/port.

### `file` healthcheck

Use when:

- the service creates a file that represents successful readiness/setup

Sample:

```json
"healthcheck": {
  "type": "file",
  "file": "${SERVICE_HOME}/.state/runtime/ready.txt"
}
```

### `variable` healthcheck

Use when:

- a specific resolved/exported variable is the readiness signal

Sample:

```json
"healthcheck": {
  "type": "variable",
  "variable": "${SERVICE_URL}"
}
```

## Other important manifest aspects

### Setup lifecycle steps

`setup.steps` defines Service Lasso's first-class one-shot job contract. Use setup for named local preparation work that runs after `install` and `config` but is not a daemon process.

For operator behavior, CLI/API surfaces, dependency ordering, provider-backed execution, rerun policy, and TypeDB init/sample guidance, see [One-shot Jobs](one-shot-jobs.md).

Examples:

```json
"setup": {
  "steps": {
    "install-python-deps": {
      "description": "Install service-local Python dependencies.",
      "commandline": {
        "win32": "pip.exe install --user -r \"${SERVICE_ROOT}\\requirements.txt\"",
        "default": "pip install --user -r \"${SERVICE_ROOT}/requirements.txt\""
      },
      "timeoutSeconds": 120,
      "rerun": "ifMissing"
    },
    "load-sample": {
      "description": "Load sample data through Python.",
      "depend_on": ["typedb", "typedb:init-schema", "@python"],
      "execservice": "@python",
      "commandline": {
        "win32": "\"${SERVICE_ROOT}\\jobs\\load-sample\\basic_upload.py\" --port ${TYPEDB_PORT}",
        "default": "\"${SERVICE_ROOT}/jobs/load-sample/basic_upload.py\" --port ${TYPEDB_PORT}"
      },
      "timeoutSeconds": 300,
      "rerun": "manual"
    }
  }
}
```

Runtime behavior:

- Direct setup: omit `execservice`; the selected `commandline` is parsed as the executable plus arguments, or `executable` plus `args` can be used.
- Provider-backed setup: set `execservice` to `@node`, `@python`, or `@java`; `commandline` or `args` becomes the provider executable's argument payload.
- Platform selection uses `commandline[process.platform]` with `commandline.default` fallback.
- Dependencies in `depend_on` can name services or setup steps using `<serviceId>:<stepId>`.
- Service dependencies must be installed/configured; non-provider service dependencies are started and health-checked before the setup step runs.
- Setup runs capture stdout/stderr logs and persist results in `.state/setup.json`.
- `rerun` supports `ifMissing`, `manual`, and `always`; baseline bootstrap runs non-manual setup steps and skips already successful `ifMissing` steps.

CLI:

```powershell
service-lasso setup list
service-lasso setup run @localcert
service-lasso setup run typedb init-schema
```

### Release artifacts and update policy

Current core manifests use first-class `artifact` metadata when a service archive should be acquired from a GitHub release.

Pinned example:

```json
"artifact": {
  "kind": "archive",
  "source": {
    "type": "github-release",
    "repo": "service-lasso/lasso-echoservice",
    "tag": "2026.4.20-a417abd"
  },
  "platforms": {
    "win32": {
      "assetName": "echo-service-win32.zip",
      "archiveType": "zip"
    }
  }
}
```

If `artifact.source.tag` is present and no active `updates` policy is declared, Service Lasso treats the service as pinned.

Moving update checks require an explicit `updates` block:

```json
"updates": {
  "enabled": true,
  "mode": "notify",
  "track": "latest",
  "checkIntervalSeconds": 3600
}
```

Supported `updates.mode` values:

- `disabled`
- `notify`
- `download`
- `install`

Current core status:

- `notify` can be used by the read-only update discovery function to classify `pinned`, `latest`, `update_available`, `unavailable`, or `check_failed`
- `download` downloads candidates without installing them
- `install` can install candidates through CLI/API or the opt-in scheduler when policy and safety gates allow
- `install` mode must declare an `installWindow` and `runningService` policy
- `installWindow` is enforced before automatic install work; out-of-window installs are deferred before download/extract
- `runningService` controls whether a running service is deferred or stopped/restarted during install

### Environment generation

Current broader Service Lasso direction includes:

- explicit service-local env via `env`
- possible cross-service/global env behavior via `globalenv`

The sample template keeps this minimal for now.

### Ports and URLs

More complex services can use additional fields such as:

- `serviceportsecondary`
- `serviceportconsole`
- `serviceportdebug`
- `portmapping`
- `urls`

These are not all used in the minimal sample, but they remain relevant for more complex services.

### Runtime-provider relationships

Runtime-provider services use:

- `execservice`

This is relevant when a service is run via another runtime-provider service such as Node, Python, or Java.

The minimal sample does not use this yet.

## Canonical vs illustrative right now

### Treat as current first-pass canonical direction

- one service per repo
- `service.json` as the main service contract file
- lifecycle-focused `actions`
- `execconfig` as the execution contract section
- explicit `env`
- explicit `depend_on`
- default health model of `process`
- explicit override to other health models when needed

### Still illustrative / not fully locked yet

- exact numeric meaning of `servicetype`
- exact numeric meaning of `servicelocation`
- final exact schema shape for all optional `execconfig` fields
- final exact health schema normalization
- final exact release artifact conventions across all service types

## Recommended authoring guidance

For the first template-based service:

1. keep the manifest small
2. use `process` health unless another model is clearly needed
3. explicitly declare env and dependencies
4. avoid mixing generated runtime state into package content
5. prefer clarity over trying to model every advanced feature on day one

## Related docs

Start here for the broader Service Lasso contract:

- `docs/service-authoring/overview.md`
- `docs/development/new-lasso-service-guide.md`

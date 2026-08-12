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
- `udp`
- `file`
- `variable`

## Runtime field alignment snapshot

This reference tracks each runtime-facing field as:

- `implemented`: the TypeScript manifest contract, validation, and runtime behavior agree.
- `compatibility`: the runtime accepts the field to preserve older manifests, but new authoring should prefer the canonical field.
- `planned`: the reference describes intended behavior that is not implemented end-to-end yet.

| Field | Status | TypeScript contract | Runtime/lifecycle behavior |
| --- | --- | --- | --- |
| `actions` | implemented | `ServiceManifest.actions?: ServiceActionPolicy` with action definitions, payload policy, workflow steps, and schedule maps | Validated during manifest discovery, used by service action run APIs, used by lifecycle stop overrides, and published through `GET /api/workflows/registry` for enabled scheduled actions. Closed alignment issue: [#777](https://github.com/service-lasso/service-lasso/issues/777). |
| `install` / `config` | implemented | `ServiceActionMaterialization` with `files[]` and `templates[]` | Lifecycle install/config can materialize inline file content and render service-root-relative template files into bounded generated targets, then persist generated paths in lifecycle artifact state. |
| `files` | implemented | `ServiceManifest.files?: ServiceFilesPolicy` with service-root-relative workspace roots | Validated during manifest discovery and published through `GET /api/files/workspaces` as the `service-lasso-workspaces` registry for file-manager consumers. |
| `outputvarregex` | compatibility | `ServiceManifest.outputvarregex?: Record<string, string>` | Validated during manifest discovery as a legacy-compatible stdout/stderr variable extraction contract for services that use `variable` healthchecks. |
| `serviceorder` | implemented | `ServiceManifest.serviceorder?: number` | Validated as a top-level whole number and used by dependency graph ordering for otherwise-independent services. Closed alignment issue: [#778](https://github.com/service-lasso/service-lasso/issues/778). |
| `execconfig.serviceorder` | compatibility | `ServiceManifest.execconfig?: ServiceExecutionConfig` with `serviceorder?: number` | Accepted for legacy manifests and normalized behind top-level `serviceorder`; top-level `serviceorder` takes precedence when both are present. Closed alignment issue: [#778](https://github.com/service-lasso/service-lasso/issues/778). |
| `requires` | implemented | `ServiceManifest.requires?: Record<string, string>` | Validated as a capability-to-version-requirement map; dependency graph resolves each capability to exactly one enabled provider service and reports missing or ambiguous provider choices with operator-action messages. |
| `provides` | implemented | `ServiceManifest.provides?: Record<string, string>` | Validated as provider capability metadata and surfaced in service summaries/diagnostics so consumers can see capability/version information. |

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
    "healthchecks": [
      {
        "id": "process-health",
        "type": "process"
      }
    ]
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

`actions` is where the service defines or overrides named lifecycle and operator actions.

Alignment status: implemented. See [#777](https://github.com/service-lasso/service-lasso/issues/777).

Current intended rule:

- actions correspond to known Service Lasso lifecycle/action names
- service config can override how a named action behaves for that service
- if a service does not override a supported action, Lasso default behavior applies
- scheduled operations stay attached to the action they trigger

Current sample actions:

- `install`
- `config`
- `start`
- `stop`
- `backup`
- `restart`
- `validate`
- `export`
- `update-check`

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

### Scheduled actions

A scheduled operation is still a service action. Cron is only one trigger attached to that action.

Backup, restart, validate, export, update-check, and similar operations should be modeled as actions. If an action needs automation, declare one or more schedules under `actions.<actionId>.schedules`.

Do not create a separate top-level cron or schedules list that points back at an action. Service Lasso keeps the action definition, service context, cwd/env resolution, permissions, logs, and audit under the service action.

```json
"actions": {
  "backup": {
    "label": "Backup",
    "description": "Create a verified service backup.",
    "mode": "workflow",
    "requiredState": "running",
    "requiresConfirmation": true,
    "manualOnly": false,
    "timeoutSeconds": 900,
    "steps": [
      { "id": "stop", "type": "service-lasso-action", "actionId": "stop" },
      { "id": "backup", "type": "service-lasso-action", "actionId": "backup" },
      { "id": "verify", "type": "service-lasso-action", "actionId": "verify-backup" },
      { "id": "start", "type": "service-lasso-action", "actionId": "start", "run": "always", "condition": "was-running-before-workflow" }
    ],
    "schedules": {
      "nightly": {
        "label": "Nightly backup",
        "enabled": true,
        "cron": "15 2 * * *",
        "timezone": "Australia/Sydney",
        "concurrencyPolicy": "skip-if-running",
        "failurePolicy": "record",
        "parameters": {
          "retainDays": 7
        }
      }
    }
  }
}
```

Action fields currently validated by discovery:
- `label` and `description`
- `mode`: `built-in`, `command`, `workflow`, or `handler`
- `command`, `commandline`, and `args` for command-backed actions
- `cwd` and `env`, resolved in the service context
- `timeoutSeconds`
- `requiredState`: `any`, `running`, or `stopped`
- `requiresConfirmation` and `manualOnly`
- `permissions`
- `steps` for workflow-backed actions
- `payload`: opt-in inline/reference action payload policy
- `schedules`

Workflow step fields currently validated by discovery:
- `id`
- `type`: currently `service-lasso-action`
- `actionId`: action invoked for this workflow step
- `run`: `on-success` or `always`
- `condition`
- `parameters`

Action payloads are documented in `docs/reference/service-action-inputs.md`.
An action can allow inline request payloads, stored payload references, or both.
The runtime resolves references from `.state/action-payloads/<payloadRef>.json`,
checks the resolved payload against the action schema, exposes it to the action
process as `SERVICE_LASSO_ACTION_PAYLOAD`, and stores only the payload reference
id plus whitelisted inline fields in action history.

Schedule fields currently validated by discovery:
- schedule id from the `schedules` map key
- `label`
- `enabled`
- `cron`: 5- or 6-field cron expression
- `timezone`, omitted to inherit the app timezone
- `concurrencyPolicy`: `skip-if-running` or `allow-parallel`
- `failurePolicy`: `record`, `retry`, or `disable-schedule`
- `parameters`

### Current action semantics direction

- `install`
  - prepare/install payload and required local setup
- `config`
  - materialize effective config from explicit inputs
- `start`
  - launch the service runtime
- `stop`
  - stop the service gracefully

Finite lifecycle actions continue to use their existing bounded runtime behavior. Scheduled actions add contract metadata for later workflow/scheduler consumers; they do not turn cron into a separate service-level action list.

### Install/config materialization

`install.files[]` and `config.files[]` materialize inline content:

```json
{
  "config": {
    "files": [
      {
        "path": "./runtime/config.env",
        "content": "SERVICE_PORT=${SERVICE_PORT}\n"
      }
    ]
  }
}
```

`install.templates[]` and `config.templates[]` render checked-in template files from the service package into generated output paths:

```json
{
  "config": {
    "templates": [
      {
        "source": "./templates/config.env.template",
        "target": "./runtime/config.env"
      }
    ]
  }
}
```

Rules:

- `source` resolves relative to the service root/package and must stay inside that root.
- `target` supports the same Service Lasso variable resolution used by inline materialized file paths, then must stay inside the service root.
- Template file content is rendered with Service Lasso variables before it is written.
- Generated target paths are recorded in lifecycle `installArtifacts.files` or `configArtifacts.files` alongside inline file outputs.
- Existing `files[]` behavior remains unchanged.

The runtime publishes scheduled action workflows through `GET /api/workflows/registry`. The registry is generated from validated service manifests, hides disabled services and disabled schedules, and includes stable workflow ids, service/action/schedule metadata, tags, workflow steps, and per-entry checksums for Dagu drift detection.

## `execconfig`

`execconfig` contains the runtime execution contract.

This is where the service tells Lasso how to run and supervise it.

### `serviceorder`

Startup ordering hint. Lower values start earlier when services are otherwise independent. Hard dependencies from `depend_on` remain stronger than `serviceorder`, and shutdown remains the reverse of the resolved startup order.

The runtime accepts legacy `execconfig.serviceorder` and normalizes it into the service manifest contract. A top-level `serviceorder` value is also accepted and takes precedence when both are present.

Alignment status: implemented for top-level `serviceorder`; `execconfig.serviceorder` is compatibility input. See [#778](https://github.com/service-lasso/service-lasso/issues/778).

Example:

```json
"serviceorder": 100
```

### `serviceport`

Primary service port.

In the sample, `0` is being used as a simple first-pass placeholder/default meaning “no fixed service port required by this sample”.

New manifests should use canonical `endpoints[]` declarations. A non-zero
legacy numeric port is a `preferred` proposal, not a fixed binding. Declare
`"port": { "default": 18080, "strategy": "fixed" }` only when the service
cannot run on another port. See
[Startup Endpoint Allocation](startup-endpoint-allocation.md) for proposal,
reservation, wildcard-overlap, and resolved-selector semantics.

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
"depend_on": ["@node"],
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
- declare the `execservice` provider in top-level `depend_on`; provider-backed execution fails closed until that provider is installed and configured
- release-backed providers must have an installed artifact command and root; Service Lasso does not fall back to an ambient host executable when the release artifact is unprepared
- omitting `execservice` remains the explicit choice for a direct executable that may resolve from the service payload or host environment

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
"depend_on": ["@node"],
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
  "ECHO_MESSAGE": "hello from service-template",
  "PATH": [
    "${PYTHON_HOME}",
    "${PYTHON_SCRIPTS_PATH}",
    "${SERVICE_ROOT}/bin"
  ]
}
```

Current direction:

- service env should be explicit
- avoid depending on uncontrolled host-machine env leakage
- use `${VAR}` for local/current-service/derived values and legacy `globalenv` compatibility
- use `${namespace.KEY}` only for explicit Secrets Broker selectors; unresolved or denied broker refs stay unresolved for diagnostics rather than falling back to a bare local name
- env and `globalenv` values can be strings or arrays of non-empty strings
- string arrays resolve selectors per entry and join with the host path delimiter before a process is spawned

Canonical derived path variables:

- `SERVICE_ROOT` is the canonical service package root.
- `SERVICE_PATH` is a compatibility alias for `SERVICE_ROOT`, intended for portable donor-style examples that refer to the service package path.
- `SERVICE_STATE_ROOT` points at the runtime state root for the service.
- `SERVICE_DATA_PATH` points at the service-local `data` directory.
- `SERVICE_EXECUTABLE_HOME` points at the installed artifact extraction root when a release artifact is installed, otherwise the service package root.
- `SERVICE_ARTIFACT_ROOT` is present only when an installed release artifact has an extracted path.
- `SERVICE_ARTIFACT_COMMAND` is present only when the installed release artifact declares both an extracted path and command.

Provider-level path variables such as `NODE_HOME`, `PYTHON_HOME`, and `PYTHON_SCRIPTS_PATH` are not derived automatically for every service. Provider services should export the concrete names they support through their own `globalenv` entries, usually from `SERVICE_ARTIFACT_ROOT` or `SERVICE_ARTIFACT_COMMAND`, and consuming services should depend on the provider that supplies them.

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
  "accessPolicy": {
    "serviceId": "consumer",
    "workspace": "local-demo",
    "grants": [
      {
        "namespace": "shared/database",
        "scope": "shared",
        "refs": ["database.PASSWORD"],
        "operations": ["resolve"],
        "purpose": "connect to the shared database at runtime"
      },
      {
        "namespace": "services/producer",
        "scope": "service",
        "refs": ["producer.API_TOKEN"],
        "operations": ["create", "rotate"],
        "purpose": "capture and rotate generated service token metadata"
      }
    ]
  },
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
- `accessPolicy`: optional manifest-side assignment for Secrets Broker authorization. It does not carry secret values.
- `accessPolicy.serviceId`: optional service id the assignment applies to; when present it must match the top-level manifest `id`.
- `accessPolicy.workspace`: optional workspace/deployment scope such as `local-demo` or an operator-defined site/workspace id.
- `accessPolicy.grants[]`: allowed namespace/ref operation grants with purpose metadata.
- `accessPolicy.grants[].namespace`: broker namespace boundary such as `shared/database` or `services/producer`.
- `accessPolicy.grants[].scope`: optional scope classification: `workspace`, `service`, `app`, `shared`, or `global`.
- `accessPolicy.grants[].refs`: optional array of dotted refs. Omit only when a namespace-wide grant is intentional for the listed operations.
- `accessPolicy.grants[].operations`: allowed operations: `resolve`, `create`, `update`, `rotate`, or `delete`.
- `accessPolicy.grants[].purpose`: non-empty audit/review purpose metadata.
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
- When the launcher identity is known, runtime also includes transport-binding metadata through `SERVICE_LASSO_BROKER_TRANSPORT_BINDING_KIND` and `SERVICE_LASSO_BROKER_TRANSPORT_BINDING_SUBJECT`. Unix launchers default this to the current launcher UID; Windows launchers should provide a stable service-account SID once the launcher policy is fixed.
- Lifecycle state may persist non-secret identity metadata for audit (`id`, service id, issued/expires/revoked timestamps, scope, audit reason, transport-binding kind/subject), but must not persist the raw credential value.
- Stop/restart revokes active launch credentials; expiry also denies later writeback attempts.
- Broker writeback audit records should use the launched service identity and the optional `writeback.auditReason`.

Selector semantics:

- `${VAR}` means local/current-service variables only, including derived variables and legacy-compatible values already visible to the service.
- `${namespace.KEY}` means an explicit broker lookup.
- Bare names never fall through into broker namespaces.
- Broker refs must be dotted. This keeps broker access reviewable and prevents accidental secret reads from ordinary env selectors.
- Duplicate bucket namespaces, duplicate import refs, duplicate `imports[].as` names, duplicate export namespace/ref pairs, duplicate writeback refs, and duplicate generated-secret refs are invalid.
- `imports[].as` may intentionally line up with an `env` key only when that env value is exactly the same dotted broker selector, for example `"DB_PASSWORD": "${database.PASSWORD}"`. It must not collide with `globalenv` output names.
- If `broker.accessPolicy` is present, every declared broker import must have a matching `resolve` grant, and every generated writeback capture must have a matching operation grant for the export namespace.
- Selectors used without a matching `broker.imports[]` declaration or access-policy grant are treated as missing policy metadata, not as implicit broker access. See [Service Secret Access Policy](./service-secret-access-policy.md).

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
- use the metadata-only [Legacy globalenv Migration](./legacy-globalenv-migration.md) planner before converting existing literal env/globalenv secrets; ambiguous and globalenv candidates require operator confirmation/manual writeback

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

### `requires`

Provider capability requirements.

Example:

```json
"requires": {
  "java": ">=17",
  "postgres": ">=15"
}
```

Runtime behavior:

- each capability resolves to one enabled discovered provider before startup ordering
- the resolved provider service id is treated as a concrete dependency
- missing providers produce a clear missing-provider message
- multiple matching providers produce an ambiguous-provider message; pin with `depend_on` or remove duplicate providers before start
- explicit `depend_on` service ids continue to work and can be used alongside capability requirements

### `provides`

Provider capability metadata.

Example:

```json
"provides": {
  "java": "17.0.18+8"
}
```

Provider manifests should declare the capability name and version they satisfy. Service summaries and diagnostics expose this metadata so operators can understand which concrete provider satisfied a capability requirement.

## Healthcheck

### Default rule

Current rule:

- if a service does not explicitly require another model, the default is **`process`**

Example:

```json
"healthchecks": [
  {
    "id": "process-health",
    "type": "process"
  }
]
```

This is the right default for a simple sample service.

### Explicit healthcheck types

Service Lasso supports these explicit healthcheck types:

- `http`
- `tcp`
- `file`
- `variable`

`process` is the current template default direction; use one of the explicit types above when a service needs a stronger readiness signal.

When a service declares an explicit `healthchecks[]` item, startup readiness waits by default even if the manifest omits readiness timing fields. Default readiness settings are:

- `retries`: `10`
- `interval`: `1000` milliseconds
- `start_period`: `0` milliseconds
- `timeout`: `2000` milliseconds per network attempt

Existing manifests that set `retries`, `interval`, `start_period`, or `timeout` keep those explicit values.
`timeout` is optional and must be an integer number of milliseconds when present. HTTP and TCP healthchecks use it as the per-attempt network wait limit. Process, file, and variable healthchecks accept the shared field for manifest compatibility, but their immediate readiness evaluation does not wait on external network I/O.

### `process` healthcheck

Use when:

- service health is adequately represented by the process being up/running
- you do not need a deeper readiness endpoint yet

Sample:

```json
"healthchecks": [
  {
    "id": "process-health",
    "type": "process"
  }
]
```

### `http` healthcheck

Use when:

- the service exposes an HTTP readiness or health endpoint

Sample:

```json
"healthchecks": [
  {
    "id": "http-health",
    "type": "http",
    "url": "http://localhost:${SERVICE_PORT}/health",
    "expected_status": 200,
    "timeout": 2000
  }
]
```

HTTP healthchecks may include an optional `cookies` string map when a readiness endpoint requires cookie state. Cookie values support the same selector resolution as `url`; omit `cookies` for ordinary stateless health endpoints.

```json
"healthchecks": [
  {
    "id": "http-cookie-health",
    "type": "http",
    "url": "http://localhost:${SERVICE_PORT}/healthcheck",
    "expected_status": 200,
    "cookies": {
      "healthcheck": "ready",
      "workspace": "${SERVICE_ID}"
    }
  }
]
```

### `tcp` healthcheck

Use when:

- readiness is best represented by a socket accepting connections

Sample:

```json
"healthchecks": [
  {
    "id": "tcp-health",
    "type": "tcp",
    "timeout": 2000
  }
]
```

Bare `type: "tcp"` uses `127.0.0.1` and infers the port only when the service has exactly one unambiguous declared or resolved port.

Use `address` when a single TCP target string is clearer:

```json
"healthchecks": [
  {
    "id": "tcp-address-health",
    "type": "tcp",
    "address": "127.0.0.1:${HTTP_PORT}"
  }
]
```

Use `host` + `port` when the values should be edited independently:

```json
"healthchecks": [
  {
    "id": "tcp-port-health",
    "type": "tcp",
    "host": "127.0.0.1",
    "port": "${HTTP_PORT}"
  }
]
```

Multiple-port services must declare `address` or `host` + `port`. Legacy alias names such as `tcphost` and `tcpport` are not supported.

### `udp` healthcheck

Use when:

- readiness depends on a UDP service replying to an explicit probe payload
- a TCP connect check would be misleading because UDP is connectionless

Sample:

```json
"healthcheck": {
  "type": "udp",
  "host": "127.0.0.1",
  "port": "${UDP_PORT}",
  "send": "ping",
  "expect": "pong",
  "timeout": 1000
}
```

UDP healthchecks require either `address` or `host` + `port`, and they require both `send` and `expect`. Service Lasso sends the configured datagram and only reports healthy when the response exactly matches `expect` within the timeout. Fire-and-forget UDP checks are intentionally not treated as strong readiness proof.

### `file` healthcheck

Use when:

- the service creates a file that represents successful readiness/setup

Sample:

```json
"healthchecks": [
  {
    "id": "ready-file",
    "type": "file",
    "file": "${SERVICE_ROOT}/runtime/ready.txt"
  }
]
```

Selector resolution applies before the filesystem check. Relative paths remain
resolved against the service root, absolute paths remain supported, and health
details report the resolved path that was checked.

### `variable` healthcheck

Use when:

- a specific resolved/exported variable is the readiness signal
- a legacy-compatible `outputvarregex` declaration derives that variable from process output

Sample:

```json
"healthchecks": [
  {
    "id": "service-url-ready",
    "type": "variable",
    "variable": "${SERVICE_URL}"
  }
]
```

### `outputvarregex`

`outputvarregex` declares legacy-compatible variables extracted from managed process output. Each map key is the variable name to set. Each value is a JavaScript regular expression string applied to stdout/stderr lines collected by the managed process runtime.

Example:

```json
"outputvarregex": {
  "FILEBEAT_ENABLED_INPUTS": ".*Enabled inputs: (\\d+).*"
},
"healthchecks": [
  {
    "id": "filebeat-inputs-ready",
    "type": "variable",
    "variable": "FILEBEAT_ENABLED_INPUTS",
    "retries": 180
  }
]
```

Runtime contract:

- `outputvarregex` must be an object whose keys are non-empty variable names and whose values are valid regular expression strings.
- The first capture group becomes the variable value.
- If a valid regex has no capture group, the full match becomes the variable value.
- Existing manifests without `outputvarregex` behave unchanged.
- This stays separate from `env` and `globalenv`; it is for stdout/stderr-derived runtime variables that can feed `variable` healthchecks.

## Other important manifest aspects

### Files workspace roots

`files` declares service-owned workspace roots that may be exposed to a file-manager consumer such as `lasso-files`.
This stays separate from Config/Definition editing: `service.json` remains the service definition, while `files.roots[]`
describes bounded runtime/workspace file surfaces.

```json
"files": {
  "enabled": true,
  "roots": [
    {
      "id": "workspace",
      "label": "Workspace",
      "path": ".",
      "mode": "read-write"
    },
    {
      "id": "logs",
      "label": "Logs",
      "path": "./logs",
      "mode": "read-only"
    },
    {
      "id": "state",
      "label": "Runtime State",
      "path": "./.state",
      "mode": "read-only",
      "protected": true
    }
  ]
}
```

Runtime rules:

- `files.enabled` must be `true` before roots are published.
- `files.roots[].path` must be relative to the service root and cannot escape it with traversal or absolute paths.
- `mode` is `read-only` or `read-write`; protected roots are exposed as non-writable even when a manifest accidentally marks them read-write.
- Hidden and protected roots are preserved as registry safety metadata.
- `GET /api/files/workspaces` returns source `service-lasso-workspaces`, service id/name, root id/label, relative path, resolved path, mode, access, and safety metadata for each declared root.

### Setup lifecycle steps

`setup.steps` defines Service Lasso's first-class one-shot job contract. Use setup for named local preparation work that runs after `install` and `config` but is not a daemon process.
When setup work needs service-owned orchestration, keep the step visible here and move the implementation into a helper such as `scripts/lasso-<service>.mjs` or platform scripts under `scripts/setup/`. See [Setup Helper Conventions](../service-authoring/setup-helper-conventions.md) for the recommended layout, provider/runtime requirements, idempotence rules, readiness polling, exit-code behavior, logging, and sensitive-value handling.

For operator behavior, CLI/API surfaces, dependency ordering, provider-backed execution, rerun policy, and TypeDB init/sample guidance, see [One-shot Jobs](one-shot-jobs.md).

Examples:

```json
"setup": {
  "steps": {
    "install-python-deps": {
      "description": "Install service-local Python dependencies.",
      "cwd": "${SERVICE_ROOT}",
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
- Optional `cwd` selects the setup command's working directory. It supports Service Lasso variables, relative paths resolve from `SERVICE_ROOT`, absolute paths must still be inside `SERVICE_ROOT`, missing/non-directory values fail before spawn, and setup run history records the resolved cwd.
- Setup commands do not inherit the full host process environment. Their environment starts from a narrow platform process-launch allowlist, then adds provider env, Service Lasso derived variables, resolved service `env`/`globalenv`/broker values, and setup-step `env`; host-only variables are not visible unless they are part of that explicit allowlist or declared through Service Lasso-controlled inputs.
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
      "archiveType": "zip",
      "checksum": {
        "algorithm": "sha256",
        "assetName": "SHA256SUMS.txt"
      }
    }
  }
}
```

`artifact.platforms.<platform>.checksum` is optional for compatibility with older manifests, but release-backed services should declare it when checksum evidence exists. Supported checksum forms:

- `{"algorithm": "sha256", "value": "<64-hex-sha256>"}` verifies against a checksum embedded directly in `service.json`.
- `{"algorithm": "sha256", "assetName": "SHA256SUMS.txt"}` downloads that release asset, parses a SHA-256 entry for the selected archive, and verifies before extraction.

Checksum verification happens before archive extraction and before install state is written. Missing checksum assets, malformed checksum files, unsupported algorithms, or digest mismatches fail closed with an actionable error. Successful installs persist safe verification evidence in install state: algorithm, source, expected digest, actual digest, artifact asset name, checksum asset name when used, and verification timestamp.

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

### Endpoints, ports, and URLs

`endpoints[]` is the canonical manifest surface for service interfaces and resources. See [Endpoints contract and migration guide](./endpoints-contract.md) for endpoint fields, selector examples, and migration rules.

Legacy fields such as `ports`, `portmapping`, `urls`, `serviceportsecondary`, `serviceportconsole`, and `serviceportdebug` remain compatibility inputs while existing manifests are normalized. New authoring should use `endpoints[]` network and URL entries, with variables expressed outside endpoint entries through `env`, `globalenv`, health checks, command lines, or materialized config templates.

Service catalog compatibility and runtime APIs normalize legacy port declarations into endpoint-aware runtime state so operators can see the resolved interface model before install/start.

### Compatibility metadata

The read-only service catalog compatibility report is generated from existing
manifest fields:

- supported platforms come from `artifact.platforms`, with `default` acting
  as a cross-platform fallback
- provider requirements come from `execservice` and setup-step
  `execservice` declarations
- discovered providers are `not-ready` until install/config completes and a
  release-backed provider has an installed artifact command/root
- declared port requirements come from normalized network endpoints, including compatibility `ports`
- service dependency requirements come from `depend_on`

The report classifies the current host as `compatible`, `unsupported`, or
`missing-requirements` and lists operator-safe blockers without mutating
install, setup, or lifecycle state.

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

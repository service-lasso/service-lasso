---
id: legacy-setup-migration
title: Legacy Setup Migration
---

# Legacy Setup Migration

Service Lasso service authors should use the structured top-level `setup.steps`
contract for one-shot preparation work. Some donor services came from a
TypeRefinery-era manifest shape that stored setup commands under
`execconfig.setup.default[]` or platform arrays and encoded behavior with
punctuation prefixes.

This page explains how to translate that donor syntax during migration. It is a
compatibility guide, not a new public authoring contract.

## Current Contract

Use `setup.steps` for named local preparation work that runs after install and
config but is not supervised as a long-running process. See
[One-shot Jobs](./one-shot-jobs.md) for CLI/API behavior, dependency ordering,
provider-backed execution, rerun policy, and persisted setup history.

The current `service.json` reference also documents setup behavior under
[Setup lifecycle steps](./service-json-reference.md#setup-lifecycle-steps).

Relevant runtime surfaces:

- `GET /api/setup`
- `GET /api/services/:serviceId/setup`
- `POST /api/services/:serviceId/setup/run/:stepId?`
- setup run state persisted under `.state/setup.json`
- setup command stdout/stderr captured in the persisted run history

For service log reading outside setup history, use the bounded
[Runtime Log API](./runtime-log-api.md).

## Legacy Syntax Summary

Legacy donor manifests commonly used this shape:

```json
{
  "execconfig": {
    "setup": {
      "default": [
        "# prepare Keycloak",
        ";bin/kc.sh build --db=postgres",
        "@python scripts/render-realm.py",
        "&bin/kc.sh start-dev --http-port 8080"
      ],
      "win32": [
        "# prepare Keycloak",
        ";bin\\kc.bat build --db=postgres"
      ]
    }
  }
}
```

The punctuation carried implicit meaning:

| Legacy input | Migration target |
| --- | --- |
| `# comment` | Move useful operator context into `description`, issue notes, or migration docs. Drop comments that only narrated the old file. |
| `; command` | Create a named direct `setup.steps.<stepId>` entry using `commandline` or `executable` plus `args`. |
| provider-backed command line | Create a named setup step with `execservice` and `commandline` or `args`. |
| platform arrays such as `default`, `win32`, `linux`, `darwin` | Convert to `commandline.default`, `commandline.win32`, `commandline.linux`, or `commandline.darwin` inside the same named step when they describe the same operation. |
| `& background command` | Do not translate directly. Model a daemon as the service `start` contract, model finite preparation as a normal setup step, or reject the migration until the intended behavior is explicit. |
| setup marker files or implicit once-only behavior | Use setup run state and `rerun`, usually `ifMissing` for idempotent bootstrap or `manual` for destructive/demo data steps. |

## Keycloak-Style Example

Legacy donor-style setup:

```json
{
  "id": "keycloak",
  "execconfig": {
    "setup": {
      "default": [
        "# Build optimized Keycloak image after config is materialized",
        ";bin/kc.sh build --db=postgres",
        ";bin/kc.sh import --file \"${SERVICE_ROOT}/realm/demo-realm.json\""
      ],
      "win32": [
        "# Build optimized Keycloak image after config is materialized",
        ";bin\\kc.bat build --db=postgres",
        ";bin\\kc.bat import --file \"${SERVICE_ROOT}\\realm\\demo-realm.json\""
      ]
    }
  }
}
```

Structured Service Lasso setup:

```json
{
  "id": "keycloak",
  "setup": {
    "steps": {
      "build-optimized-server": {
        "description": "Build the optimized Keycloak server after config is materialized.",
        "cwd": "${SERVICE_ROOT}",
        "commandline": {
          "win32": "bin\\kc.bat build --db=postgres",
          "default": "bin/kc.sh build --db=postgres"
        },
        "timeoutSeconds": 300,
        "rerun": "ifMissing"
      },
      "import-demo-realm": {
        "description": "Import the packaged demo realm when explicitly requested.",
        "depend_on": ["keycloak:build-optimized-server"],
        "cwd": "${SERVICE_ROOT}",
        "commandline": {
          "win32": "bin\\kc.bat import --file \"${SERVICE_ROOT}\\realm\\demo-realm.json\"",
          "default": "bin/kc.sh import --file \"${SERVICE_ROOT}/realm/demo-realm.json\""
        },
        "timeoutSeconds": 300,
        "rerun": "manual"
      }
    }
  }
}
```

The migrated steps are named, dependency-aware, and visible through the setup
CLI/API. The demo realm import is `manual` because importing sample data can be
destructive or surprising in a reused workspace.

## Provider-Backed Example

If a donor setup line relied on a runtime provider, keep that relationship
explicit:

```json
{
  "setup": {
    "steps": {
      "render-realm-config": {
        "description": "Render the Keycloak realm file from service-local inputs.",
        "depend_on": ["@python"],
        "execservice": "@python",
        "cwd": "${SERVICE_ROOT}",
        "commandline": {
          "win32": "\"${SERVICE_ROOT}\\scripts\\render-realm.py\" --out \"${SERVICE_ROOT}\\realm\\demo-realm.json\"",
          "default": "\"${SERVICE_ROOT}/scripts/render-realm.py\" --out \"${SERVICE_ROOT}/realm/demo-realm.json\""
        },
        "timeoutSeconds": 120,
        "rerun": "ifMissing"
      }
    }
  }
}
```

`execservice` identifies the provider that runs the step. `commandline` or
`args` describes the payload passed to that provider. Direct steps omit
`execservice`.

## Unsupported Or Ambiguous Legacy Behavior

Do not silently preserve these donor-era behaviors:

- Background setup commands. A setup step is finite. Long-running commands
  belong in the service start contract, not in setup.
- Comment-only steps. Put useful text in `description` or migration notes.
- Implicit shell semantics. Prefer structured `executable` plus `args` when a
  command does not need platform-specific quoting.
- Host environment leakage. Setup commands receive Service Lasso-controlled
  variables, provider env, service env/globalenv/broker values, and a narrow
  process-launch allowlist. Add required inputs to the manifest instead of
  depending on arbitrary host env.
- Unnamed once-only markers. Use persisted setup state and explicit `rerun`
  policy instead of private marker-file conventions.
- Multiple unrelated setup operations in one string. Split them into named
  steps so dependency ordering, retries, logs, and operator actions are clear.

When the old behavior cannot be classified safely, reject the migration for
that line and open a follow-up issue in the owning service repo.

## Why The Punctuation DSL Is Not Preferred

The old punctuation DSL was compact, but it hid intent in string prefixes and
array order. Structured `setup.steps` is the preferred contract because it:

- gives every operation a stable id for CLI, API, logs, and dependencies
- records operator-facing descriptions beside the runnable command
- separates direct commands from provider-backed execution
- makes platform-specific command payloads explicit
- captures setup state and rerun policy in a durable runtime-owned file
- avoids treating background processes as setup work
- validates fields before a command is spawned

Migration should produce a manifest that a service author can review without
knowing the donor punctuation rules.


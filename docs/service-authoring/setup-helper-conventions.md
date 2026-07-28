---
id: setup-helper-conventions
title: Setup Helper Conventions
---

# Setup Helper Conventions

Service manifests should stay reviewable. When setup work grows beyond a short command, keep the operator-visible step in `service.json` and move the service-specific orchestration into service-owned helper code.

Use this convention for setup work such as certificate generation, database preparation, optimized framework builds, schema loading, bootstrap users, local trust material, and other one-shot jobs that must be repeatable on Windows, Linux, and macOS.

## Preferred Layout

Prefer a Node ESM helper when the service can depend on a Node provider or already packages Node-based tooling:

```text
lasso-<service>/
  scripts/
    lasso-<service>.mjs
  service.json
```

The helper should expose small subcommands instead of one large bootstrap mode:

```powershell
node scripts/lasso-keycloak.mjs generate-keystore
node scripts/lasso-keycloak.mjs ensure-database
node scripts/lasso-keycloak.mjs build
```

Each subcommand should own one durable result. That keeps setup logs, rerun policy, and failure recovery aligned with the `setup.steps` entry that invoked it.

## Manifest Pattern

Keep each setup step visible in `service.json`, even when the implementation lives in the helper. Operators and consuming apps should be able to inspect the manifest and understand what local preparation will run.

```json
{
  "depend_on": ["@node", "postgres"],
  "setup": {
    "steps": {
      "generate-keystore": {
        "description": "Generate the local Keycloak HTTPS keystore.",
        "execservice": "@node",
        "cwd": "${SERVICE_ROOT}",
        "commandline": "scripts/lasso-keycloak.mjs generate-keystore",
        "timeoutSeconds": 60,
        "rerun": "ifMissing"
      },
      "ensure-database": {
        "description": "Create the Keycloak database and role when missing.",
        "execservice": "@node",
        "cwd": "${SERVICE_ROOT}",
        "commandline": "scripts/lasso-keycloak.mjs ensure-database",
        "depend_on": ["postgres"],
        "timeoutSeconds": 120,
        "rerun": "ifMissing"
      },
      "build-optimized": {
        "description": "Run the service optimized build after config is materialized.",
        "execservice": "@node",
        "cwd": "${SERVICE_ROOT}",
        "commandline": "scripts/lasso-keycloak.mjs build",
        "depend_on": ["generate-keystore", "ensure-database"],
        "timeoutSeconds": 300,
        "rerun": "ifMissing"
      }
    }
  }
}
```

Use `execservice: "@node"` when Service Lasso should run the helper through the Node provider. The manifest must declare the provider dependency in the same way it would for any other provider-backed command. Do not assume `node`, `NODE_HOME`, or other provider paths are present unless the manifest depends on the provider that exports them.

Use direct commands only when the service repo owns the executable path and does not need a provider:

```json
{
  "setup": {
    "steps": {
      "prepare-data": {
        "cwd": "${SERVICE_ROOT}",
        "commandline": {
          "win32": ".\\bin\\service-tool.exe prepare-data",
          "default": "./bin/service-tool prepare-data"
        },
        "rerun": "ifMissing"
      }
    }
  }
}
```

## Platform Script Fallback

Platform-specific scripts remain appropriate when a service should not require Node, when the upstream toolchain is already shell or PowerShell native, or when a provider would make the install path heavier than the setup work.

Use this layout:

```text
lasso-<service>/
  scripts/
    setup/
      generate-keystore.ps1
      generate-keystore.sh
      ensure-database.ps1
      ensure-database.sh
  service.json
```

Then bind the same manifest-visible step to the platform script:

```json
{
  "setup": {
    "steps": {
      "generate-keystore": {
        "description": "Generate local development certificates.",
        "cwd": "${SERVICE_ROOT}",
        "commandline": {
          "win32": "pwsh -NoLogo -NoProfile -File scripts\\setup\\generate-keystore.ps1",
          "default": "sh scripts/setup/generate-keystore.sh"
        },
        "timeoutSeconds": 60,
        "rerun": "ifMissing"
      }
    }
  }
}
```

If the Windows and POSIX scripts cannot share behavior naturally, keep them small and document the shared contract in the service repo README.

## Helper Requirements

Helper code is part of the service contract. Treat it like release code, not an ad hoc bootstrap script.

- Idempotence: each subcommand must be safe to rerun. Check for existing files, databases, users, schemas, and build outputs before mutating them. Prefer no-op success when the desired state already exists.
- Readiness polling: when a helper depends on another service, poll a bounded readiness signal instead of sleeping a fixed amount. Respect the setup step timeout and fail with a clear message when the dependency never becomes ready.
- Exit codes: return `0` only when the desired state exists. Return non-zero for invalid input, missing provider tools, failed readiness, failed writes, or failed verification.
- Logging: write concise progress to stdout and actionable diagnostics to stderr. Avoid dumping full environment blocks, generated config, or command lines that include sensitive values.
- Sensitive values: read secrets through Service Lasso-provided environment variables or broker-backed files. Do not write raw secrets into `service.json`, logs, issue comments, release notes, or persisted setup state.
- Paths: resolve service-local files from `SERVICE_ROOT`, runtime state from Service Lasso-provided state/data variables, and provider tools from provider-exported env. Do not depend on the caller's current working directory except through the manifest `cwd`.
- Arguments: keep subcommand names stable and explicit. Avoid positional argument contracts that are hard to review in `service.json`.
- Verification: after mutating local state, confirm the expected artifact, database, schema, file, or command output exists before exiting successfully.

## Author Checklist

Before releasing a service with helper-backed setup:

- `service.json` lists every setup step operators need to know about.
- The helper or platform scripts live under `scripts/`.
- Provider-backed helpers declare `execservice` and the matching provider dependency.
- Each setup step has a clear `description`, `cwd`, timeout, rerun policy, and dependency list when needed.
- Helper subcommands are idempotent and produce bounded logs.
- Secrets are resolved at runtime and never stored in the manifest or helper output.
- Local validation runs the setup path at least twice: once from a clean state and once as an idempotent rerun.

## Related References

- [Write `service.json`](02-write-service-json.md)
- [One-shot Jobs](../reference/one-shot-jobs.md)
- [Create a New Lasso Service](../development/new-lasso-service-guide.md)

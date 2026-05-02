---
id: one-shot-jobs
title: One-shot Jobs
---

# One-shot Jobs

Service Lasso models one-shot jobs as `setup.steps` in `service.json`.

Use one-shot jobs for local work that must run after a service is installed/configured but should not be supervised as a daemon. Typical examples are schema initialization, sample data loading, certificate generation, dependency import, tool-cache preparation, and other repeatable setup work.

Do not use one-shot jobs for long-running servers, background workers, health-monitored daemons, or arbitrary application workflows that are unrelated to preparing the managed service.

## Contract

Declare jobs under `setup.steps`:

```json
{
  "setup": {
    "steps": {
      "init-schema": {
        "description": "Initialize the TypeDB schema.",
        "depend_on": ["typedb"],
        "execservice": "@java",
        "commandline": {
          "win32": "-jar \"${SERVICE_ROOT}\\jobs\\typedb-init.jar\" --address ${TYPEDB_ADDRESS}",
          "default": "-jar \"${SERVICE_ROOT}/jobs/typedb-init.jar\" --address ${TYPEDB_ADDRESS}"
        },
        "timeoutSeconds": 120,
        "rerun": "manual"
      },
      "load-sample": {
        "description": "Load sample data into TypeDB.",
        "depend_on": ["typedb", "typedb:init-schema", "@python"],
        "execservice": "@python",
        "args": ["jobs/load-sample/basic_upload.py"],
        "timeoutSeconds": 300,
        "rerun": "manual"
      }
    }
  }
}
```

Common fields:

- `description`: operator-facing summary for CLI/API/Admin surfaces.
- `depend_on`: services or setup steps that must complete first. Setup step dependencies use `<serviceId>:<stepId>`.
- `execservice`: optional provider service such as `@node`, `@python`, or `@java`.
- `commandline`: platform map where `win32`, `linux`, or `darwin` override `default`.
- `executable` and `args`: structured command form when a platform commandline is not needed.
- `env`: setup-step environment additions.
- `timeoutSeconds`: maximum runtime before the step is failed.
- `rerun`: `ifMissing`, `manual`, or `always`.

## Runtime Behavior

Service Lasso runs setup steps after install/config and before dependent startup work that needs the setup result.

Runtime behavior is intentionally different from daemon startup:

- Direct setup omits `execservice`; the selected commandline is parsed as executable plus args, or `executable` plus `args` can be used.
- Provider-backed setup uses the acquired provider command from `@node`, `@python`, `@java`, or another provider service.
- Variables from service env, `globalenv`, provider globals, and runtime paths are resolved before execution.
- Service dependencies are installed/configured first; non-provider service dependencies are started and health-checked before the step runs.
- Setup step dependencies wait for the referenced setup step result before execution.
- Stdout, stderr, exit code, timeout, start/end time, and status are persisted under `.state/setup.json`.
- Baseline bootstrap runs non-manual setup steps and skips already successful `ifMissing` steps.

## CLI and API

CLI:

```powershell
service-lasso setup list
service-lasso setup run typedb
service-lasso setup run typedb init-schema --force
service-lasso setup run typedb --include-manual --json
```

API:

- `GET /api/setup`
- `GET /api/services/:serviceId/setup`
- `POST /api/services/:serviceId/setup/run/:stepId?`

The API reports the same durable setup state that the CLI reads, so Service Admin and app hosts can surface setup history without inventing another contract.

## TypeDB Use

`lasso-typedb` owns the long-running TypeDB daemon. Schema initialization and sample data loading should be implemented as `setup.steps` in that service repo, not as separate fake daemon services.

Tracked follow-up work:

- [`service-lasso/lasso-typedb#2`](https://github.com/service-lasso/lasso-typedb/issues/2): TypeDB init/schema job.
- [`service-lasso/lasso-typedb#3`](https://github.com/service-lasso/lasso-typedb/issues/3): TypeDB sample data loader job.

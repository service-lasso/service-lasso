# Runtime Dry-Run Plans

Runtime dry-run plans describe what a mutating action would do without launching processes or writing runtime, install, update, or setup state.

## API

- `GET /api/runtime/actions/startAll/plan`
- `GET /api/runtime/actions/stopAll/plan`
- `GET /api/runtime/actions/autostart/plan`
- `GET /api/services/{serviceId}/update/install/plan`
- `GET /api/runtime/actions/importService/plan?manifestPath={absolute-or-relative-service-json-path}`

Each response includes:

- dryRun: true
- order: service ids that would run in dependency order
- steps: per-service action, status, prerequisites, expected state changes, and the mutating endpoint
- skipped: non-blocking services excluded from the action
- blockers: services that prevent the plan from being directly applied
- mutations: []

Plans must not include raw secret values, provider credentials, environment payload values, or log contents.

## CLI

- `service-lasso plan start --json`
- `service-lasso plan stop --json`
- `service-lasso plan autostart --json`
- `service-lasso plan update-install {serviceId} --json`
- `service-lasso plan import {manifestPath} --json`

The CLI commands use the same response contract as the API and add `servicesRoot` and `workspaceRoot` to show which local runtime roots were inspected. The plan commands are read-only: they do not create workspace directories, write service state, copy app-owned manifests, launch processes, or install update candidates.

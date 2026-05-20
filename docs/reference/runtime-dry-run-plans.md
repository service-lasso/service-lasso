# Runtime Dry-Run Plans

Runtime dry-run plans describe what a mutating action would do without launching processes or writing runtime, install, update, or setup state.

## API

- GET /api/runtime/actions/startAll/plan
- GET /api/runtime/actions/stopAll/plan
- GET /api/runtime/actions/autostart/plan
- GET /api/services/{serviceId}/update/install/plan

Each response includes:

- dryRun: true
- order: service ids that would run in dependency order
- steps: per-service action, status, prerequisites, expected state changes, and the mutating endpoint
- skipped: non-blocking services excluded from the action
- blockers: services that prevent the plan from being directly applied
- mutations: []

Plans must not include raw secret values, provider credentials, environment payload values, or log contents.

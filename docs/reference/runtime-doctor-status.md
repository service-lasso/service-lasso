# Runtime Doctor Status

Status: draft foundation for `service-lasso.runtime-doctor.v1`

The runtime doctor is a read-only diagnosis surface shared by the CLI and runtime API. It reconciles local persisted runtime state with safe live evidence and returns one machine-readable classification plus a safe recommended action.

## Surfaces

- CLI: `service-lasso doctor status --json`
- API: `GET /api/runtime/doctor`

Both surfaces use the same payload shape:

```json
{
  "doctor": {
    "contractVersion": "service-lasso.runtime-doctor.v1",
    "classification": "healthy",
    "recommendedAction": "resume",
    "readOnly": true
  }
}
```

## Current Evidence

This foundation slice reports safe metadata only:

- selected runtime instance and candidate instance registry records;
- expected workspace and services roots;
- runtime and service process ownership registry entries with identity classifications;
- port reservation ledger entries and non-stale endpoint conflicts;
- missing or disabled dependency blockers;
- evidence file paths for the runtime instance, process registry, generation registry, startup transaction, endpoint allocation, and port reservation ledger;
- persistence classifications for those workspace lifecycle documents (`missing`, `current`, `legacy`, `corrupt`, `unsupported-old`, `unsupported-new`, `redirected`, `oversized`, `migration-interrupted`) with safe absolute paths only.

The payload omits command lines, raw environment values, rendered config contents, and secret-bearing material. Malformed, partially migrated, or forward-version lifecycle state never becomes process-termination authority.

## Stable Classifications

The first supported classification set is:

- `healthy`
- `not_running`
- `wrong_lane`
- `ambiguous_generation`
- `identity_mismatch`
- `unknown_owner`
- `preferred_port_occupied`
- `fixed_port_conflict`
- `reservation_drift`
- `configuration_drift`
- `partial_startup`
- `state_corrupt`
- `migration_required`

The doctor is advisory. It never performs recovery mutations; operators must invoke a separate lifecycle or repair action to mutate state.

Identity mismatch, unknown ownership, and occupied preferred/fixed ports recommend `request_operator_confirmation`. Those classifications never recommend process termination.

Canonical demo verification and canonical deploy attach the doctor JSON object on failure so operators see the same classification without inspecting logs.

Partial startup reads the startup-transaction journal. Phases before `process_spawned` recommend `resume`; later active or blocked phases recommend `roll_back`.

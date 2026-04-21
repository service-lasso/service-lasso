# Serviceadmin integration validation

This document tracks the bounded validation work for `ISS-034` / `TASK-034`.

The goal is not "finish `lasso-@serviceadmin`" in one jump. The goal is to prove the current `service-lasso` runtime can satisfy the first real consumer-facing contracts that the admin UI already expects, then make the remaining gaps explicit.

## Scope

In scope for the current bounded validation slice:
- service meta persistence used by:
  - favorites
  - dependency graph layout persistence
- live log compatibility routes used by the logs screen
- bounded dashboard summary/services/detail adapter routes for the current admin data model
- current proof of what the admin UI can consume directly from the runtime today

Out of scope for this slice:
- replacing every dashboard page stub with a full runtime-backed data model
- redesigning the admin UI data model
- packaging/reference app rollout

## Task list

1. Add runtime-owned service meta persistence and compatibility routes.
   status: done

2. Add runtime-owned live log info and chunk-read routes.
   status: done

3. Validate the current `lasso-@serviceadmin` logs contract against the runtime.
   status: partial

4. Add a bounded runtime-backed dashboard adapter for the current dashboard / services / service-detail consumer model.
   status: done

5. Validate the current `lasso-@serviceadmin` consumer against the bounded runtime adapter routes.
   status: in_progress

6. Record any remaining consumer-model gaps as explicit follow-up work before calling the integration slice complete.
   status: in_progress

## Current verified outcomes

The following runtime-facing contracts are now implemented and covered in `service-lasso` tests:

- `GET /api/services/meta`
- `PATCH /api/services/:serviceId/meta`
- `GET /api/services/log-info?service=<id>&type=default`
- `GET /api/logs/read?service=<id>&type=default&limit=<n>&before=<n>`
- `GET /api/dashboard`
- `GET /api/dashboard/services`
- `GET /api/dashboard/services/:serviceId`

Direct proof in `service-lasso`:
- `npm test`
- route coverage in:
  - `tests/operator-data.test.js`
  - `tests/api-spine.test.js`

What that proves:
- favorites and dependency-graph layout can now persist through runtime-owned per-service state
- log readers can fetch stable runtime log metadata and chunked log content from the managed log files
- the runtime can project bounded summary/services/detail payloads in the current admin UI shape using real runtime state, dependencies, variables, endpoints, and recent managed log output

## Current consumer findings

### Verified

- `lasso-@serviceadmin` builds successfully with the current codebase.
- The logs provider contract shape matches the runtime routes that now exist.
- The runtime now exposes bounded dashboard adapter routes for the current admin summary/services/detail model.

### Invalidated

- `lasso-@serviceadmin` log-provider tests currently fail because they assert unencoded `@serviceadmin` query-string values, while the actual URL builder correctly emits `%40serviceadmin`.

This is a consumer-test expectation mismatch, not a `service-lasso` route-shape mismatch.

### Still uncovered / partial

- The main dashboard, services list, dependencies view, runtime page, variables page, network page, and service-detail page are still powered by the admin UI's large stub-backed dashboard model.
- Those pages do not yet consume the new bounded runtime adapter routes as their primary data source, even when `VITE_SERVICE_LASSO_API_BASE_URL` is configured.
- The admin repo still needs its hook/stub layer updated to switch from stub data to:
  - `GET /api/dashboard`
  - `GET /api/dashboard/services`
  - `GET /api/dashboard/services/:serviceId`

## Next recommended slice

The next clean delivery step is:

**patch `lasso-@serviceadmin` to consume the bounded runtime dashboard adapter routes instead of the large stub model, then rerun the consumer validation against the demo/runtime shape.**

That should stay bounded to the currently implemented runtime contract rather than inventing a bigger future dashboard schema first.

---
unlisted: true
---

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
   status: done

4. Add a bounded runtime-backed dashboard adapter for the current dashboard / services / service-detail consumer model.
   status: done

5. Validate the current `lasso-@serviceadmin` consumer against the bounded runtime adapter routes.
   status: done

6. Record any remaining consumer-model gaps as explicit follow-up work before calling the integration slice complete.
   status: done

## Live smoke checklist

Current bounded live-smoke checklist:

1. Start `service-lasso` against explicit demo roots and confirm `/api/health` plus dashboard routes are reachable.
   status: done

2. Start at least one real managed demo service so the admin consumer sees non-empty runtime data.
   status: done

3. Build and serve `lasso-@serviceadmin` with `VITE_SERVICE_LASSO_API_BASE_URL` pointed at the live runtime.
   status: done

4. Confirm the served admin app loads against the live runtime stack and record the concrete evidence.
   status: done

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
- `lasso-@serviceadmin` now uses the bounded runtime dashboard adapter routes when `VITE_SERVICE_LASSO_API_BASE_URL` is configured, while still preserving the local stub fallback when the runtime API is absent.
- `lasso-@serviceadmin` unit tests now pass with the encoded log-query expectations and the new runtime dashboard adapter coverage.
- Live local smoke passed against the real stack:
  - `service-lasso` runtime on `http://127.0.0.1:18081`
  - `lasso-@serviceadmin` preview on `http://127.0.0.1:17700`
  - runtime `/api/health` returned `ok`
  - runtime `/api/dashboard` reported `4` services and `2` running services
  - runtime `/api/dashboard/services/echo-service` reported `echo-service` as `running`
  - runtime log-info route resolved `echo-service` log path successfully
  - admin preview root `/` returned `200`
  - admin preview service route `/services/echo-service` returned `200`

### Still uncovered / partial

- The admin UI still depends on the bounded compatibility adapter shape rather than a cleaner long-term dedicated admin contract, so this should be treated as a compatibility bridge rather than the final consumer API design.

## Next recommended slice

The next clean delivery step is:

**treat `ISS-034` as complete and carry the remaining long-term consumer-contract cleanup into later package/reference-app work rather than blocking core runtime completion on a broader admin-API redesign.**

That should stay bounded to the currently implemented runtime contract rather than inventing a bigger future dashboard schema first.

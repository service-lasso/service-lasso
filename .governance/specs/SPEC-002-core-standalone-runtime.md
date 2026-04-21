# Core Standalone Runtime

## Intent
Create the first real product spec for `service-lasso` by moving from bootstrap-only governance into an executable core runtime slice. This matters because the repository now has a tracked bounded runtime implementation and needs governed traceability as it widens toward donor parity. The first core milestone proved that Service Lasso can run as a standalone manager and consume canonical service manifests directly; the current work under this spec is widening that bounded slice carefully with direct verification.

## Scope
Included in this spec:
- establish the first tracked source tree for the core runtime inside this repo
- define the first bounded standalone runtime slice and its execution boundary
- implement a runnable entrypoint for the core runtime/server
- support canonical `service.json` manifest discovery/parsing for the first runtime slice
- provide direct runnable verification against fixture/sample service definitions
- maintain at least one tracked runnable harness service fixture that can exercise runtime/demo behavior through both API and UI surfaces
- add the minimum build/validation/release plumbing needed to make the core repo behave like a real product repo
- update canonical docs/traceability so the implemented behavior is distinguished from donor/reference-only notes

Explicitly out of scope for this spec:
- full donor parity
- complete service lifecycle/provider matrix
- production-ready UI/operator features (those belong in `lasso-@serviceadmin`)
- every future manifest normalization decision
- every future runtime provider/integration type
- broad service catalog migration

## Acceptance Criteria
- `AC-1`: `service-lasso` contains a tracked core runtime source tree instead of being docs/bootstrap-only.
- `AC-2`: A standalone runtime entrypoint can be executed locally and start successfully in a bounded development mode.
- `AC-3`: The runtime can discover and parse canonical `service.json` manifests from a defined service root and report the discovered services reliably.
- `AC-4`: The first runtime slice has direct runnable verification evidence using fixture/sample service definitions, not surrogate-only documentation proof.
- `AC-4A`: The tracked fixture set includes a runnable harness-style sample service that can be started independently and used to exercise API/UI, persistence, and behavior-simulation flows for later runtime supervision work.
- `AC-4B`: The runtime includes one bounded real execution/supervision path that can start, observe, stop, and persist runtime state for a directly executable service definition.
- `AC-4C`: The runtime broadens bounded health support beyond `process` and `http` by directly accepting and evaluating at least one additional donor-aligned manifest health type with runnable verification evidence.
- `AC-4D`: The runtime can optionally wait for bounded startup readiness using donor-aligned health retry fields so start/restart flows can distinguish "process launched" from "service became ready".
- `AC-4E`: The runtime supports a bounded manifest-driven `globalenv` propagation model so services can emit shared env values, the runtime can merge them deterministically, and operator/API surfaces can expose the merged shared env.
- `AC-4F`: The runtime owns a bounded port-negotiation slice so manifests can declare desired ports, runtime config/start can resolve collisions deterministically, and operator/API surfaces can expose the assigned ports and resolved URLs.
- `AC-4G`: The runtime supports a bounded install/config materialization slice so manifests can declare service-scoped files to generate, `install` can perform a real preparation step on disk, `config` can render effective runtime config with resolved variables, and lifecycle/state output records what was materialized.
- `AC-4H`: The runtime extends bounded provider-backed execution so at least one provider-managed service can run through its provider path and surface provider/runtime evidence through the API and persisted state.
- `AC-4I`: The runtime supports a bounded manager-level orchestration slice so `startAll` and `stopAll` can operate across enabled services in deterministic order with explicit skip reasons and direct API proof.
- `AC-4J`: The runtime owns a bounded managed-log slice so supervised processes write stdout/stderr into stable runtime-owned log files, the API exposes real recent log output, and persisted runtime state records the runtime log locations.
- `AC-4K`: The runtime extends bounded orchestration with explicit `reload` and `autostart` semantics so services can opt into startup orchestration, startup can trigger autostart deterministically, and runtime `reload` can rediscover manifests while stopping and restarting previously running eligible services with direct API proof.
- `AC-4L`: The runtime extends bounded observability with explicit per-service runtime-log archival and retention so new managed runs roll forward without unbounded log growth and the logs API can surface retained recent archives deterministically.
- `AC-4M`: The runtime extends bounded observability with explicit process/runtime metrics so persisted runtime state and API/operator surfaces can report launch, termination, duration, and log-count evidence beyond pid/running state without claiming full donor-depth process-tree metrics.
- `AC-4N`: The runtime provides one explicit demo-instance quickstart, reset path, and scripted smoke validation flow so a reviewer can exercise the bounded runtime end to end against explicit `servicesRoot` and `workspaceRoot` without manual repo cleanup.
- `AC-4O`: The runtime exposes one bounded consumer-compatibility slice for `lasso-@serviceadmin` so the admin UI can use current runtime metadata, log-read, and core dashboard surfaces without consumer-only hacks.
- `AC-5`: Core repo build/validation/release plumbing exists at a minimum viable level so the repo behaves like an actual product repository.
- `AC-6`: Project docs/backlog/spec traceability clearly identify which runtime behavior is now implemented here versus which behavior still lives only in donor/reference material.

## Tests and Evidence
Required evidence for this spec:
- local execution proof that the standalone runtime entrypoint starts
- direct proof of manifest discovery/parsing against one or more fixture/sample service definitions
- direct proof that the tracked harness fixture can start locally and expose its documented API/UI surface
- direct proof that the bounded execution supervisor can start and stop a real process while persisting runtime state updates
- direct proof that at least one additional donor-aligned manifest health type can be parsed and evaluated successfully by the runtime
- direct proof that configured readiness wait loops can succeed and time out deterministically during bounded start behavior
- direct proof that bounded manifest-driven `globalenv` values can be merged and injected into dependent service execution/runtime API output
- direct proof that bounded runtime port negotiation can assign ports, resolve collisions deterministically, and surface resolved network data through the API
- direct proof that bounded install/config actions can materialize service-scoped files on disk and persist artifact metadata for rerunnable effective config generation
- direct proof that at least one provider-backed service can execute through its provider path and report provider/runtime evidence through the API
- direct proof that runtime-level `startAll` / `stopAll` orchestration can start and stop eligible services in deterministic order while reporting explicit skip reasons for ineligible services
- direct proof that supervised processes write real stdout/stderr output into runtime-owned log files, that the logs API exposes recent captured output, and that persisted runtime state records the runtime log paths
- direct proof that `autostart`-eligible services can start automatically on runtime boot and through a runtime action, and that `reload` can rediscover manifests while stopping and restarting previously running eligible services deterministically
- direct proof that prior per-service runtime log files are archived on the next managed start, that retention prunes older archives deterministically, and that the logs API surfaces retained archive metadata
- direct proof that persisted runtime state and API/operator surfaces expose bounded launch, termination, duration, and log-count metrics that survive runtime restart and remain consistent with current managed log files
- direct proof that the documented demo-instance smoke flow can start the runtime against explicit roots, exercise one direct service plus one provider-backed service, inspect runtime/operator surfaces, stop the services cleanly, and rerun from a reset state
- direct proof that the runtime can satisfy the bounded `lasso-@serviceadmin` integration contract for service meta persistence, live log reads, and the current dashboard/service-detail consumer surfaces
- build/validation proof for the new core source tree
- documentation updates that map the new runtime slice to the canonical contract/docs
- explicit residual-gap notes for lifecycle/provider behaviors not yet implemented

Suggested verification layers for this spec:
- unit or small integration checks for manifest loading/parsing where practical
- direct manual/runtime smoke proof for entrypoint startup and discovered service output
- packaging/build verification for the new repo plumbing

## Documentation Impact
- `.governance/project/PROJECT_INTENT.md`
- `.governance/project/BACKLOG.md`
- `.governance/specs/SPEC-002-core-standalone-runtime.md`
- `README.md`
- canonical runtime/manifest docs under `docs/reference/`
- any new build/run/release docs created for the core runtime

## Verification
Verify this spec by running the core runtime locally from tracked repo source and proving:
1. the runtime starts,
2. it loads configured fixture/sample manifests,
3. discovered services are reported correctly,
4. build/validation steps pass for the new source tree,
5. docs/backlog/spec references point at the new implemented runtime slice rather than only bootstrap artifacts.

Classify verification honestly as direct proof, partial proof, or surrogate-only proof where relevant. Passing docs/build checks alone is not sufficient to satisfy this spec.

## Change Notes
- This spec is the explicit transition point from bootstrap-only repo setup into real `service-lasso` product implementation.
- The first runtime slice should stay intentionally bounded: prove a runnable standalone core before widening into full donor parity or broad manifest redesign.
- Donor material under `ref/` remains useful evidence and reference input, but implemented behavior must now move into tracked repo source with direct verification.
- The tracked fixture set may evolve from static manifest-only samples into runnable harness services when that improves direct verification for runtime hardening and later supervision work.

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

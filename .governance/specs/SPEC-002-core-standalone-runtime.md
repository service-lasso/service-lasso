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
- `AC-4P`: The repo exposes one bounded package-boundary scaffold so a private `packages/core` wrapper package can target the current built runtime + CLI without moving source yet.
- `AC-4Q`: The broader reference-app rollout lives outside the core repo so the canonical web, node, electron, and tauri app-host starters exist as sibling template repos under `C:\projects\service-lasso` and matching GitHub template repos instead of in-repo app placeholder packages.
- `AC-4R`: The repo exposes one bounded downloadable runtime artifact so the built core runtime, the private core wrapper package, and release metadata can be staged, verified, and attached to tagged GitHub releases without claiming a finished npm publish flow yet.
- `AC-4S`: The repo exposes one bounded self-contained publishable `@service-lasso/service-lasso` package payload so sibling starter repos can consume the core runtime through a package registry, with public npmjs as the default consumer path and GitHub Packages retained only where explicitly configured, and the starter rollout has an explicit minimal POC contract around host output, Echo Service, and Service Admin.
- `AC-4T`: The repo documents one governed remediation execution plan that separates reference-app host types, packaging targets, bundled/no-download behavior, and canonical `service.json` ownership so future repo and pipeline changes stop depending on chat-only intent.
- `AC-4U`: The core manifest contract grows first-class release/install metadata inside `service.json`, and the runtime can acquire/install a service from that manifest without requiring `start`.
- `AC-4V`: Core and sibling app release flows stop depending on manual tag creation and instead produce releases from protected-branch pushes using the project's timestamped `yyyy.m.d-<shortsha>` version pattern with direct artifact/package proof.
- `AC-4W`: The sibling app repo lineup is normalized to canonical host-type and packaging-target names, deprecated starter repos are retired, and bundled outputs honestly prove "no first-run download" behavior.
- `AC-4X`: Release readiness is proven from a fresh consumer perspective across the core package, GitHub release artifacts, service acquisition, Echo Service, Service Admin, and canonical reference-app repos, with every failed, blocked, or unproven scenario converted into tracked follow-up work.
- `AC-4Y`: Core service completion planning explicitly classifies donor-aligned runtime/provider services such as `@node`, `@python`, `@java`, `@traefik`, `@archive`, and `@localcert` as implemented, baseline, optional, or deferred, with implementation-grade follow-up issues for anything required before core completion can be claimed.
- `AC-4Z`: A clean clone of `service-lasso` has one documented baseline start path that can acquire, configure, and start the expected baseline services from their canonical service repos where downloads are required: `@traefik`, `@node`, `echo-service`, and `service-admin`. Any baseline service that is intentionally local/no-download must be explicitly documented as such, and any missing capability must be tracked as a release-readiness blocker before core completion is claimed.
- `AC-4AA`: The manifest contract defines a bounded service recovery, doctor/preflight, and lifecycle-hook shape so future monitoring, restart, and upgrade work can be implemented from explicit `service.json` policy instead of hidden runtime defaults.
- `AC-4AB`: The manifest contract defines a bounded service update policy shape, and the runtime can perform read-only update discovery for `github-release` artifact sources, classifying pinned, latest, update-available, unavailable, and check-failed states without downloading or installing artifacts.
- `AC-4AC`: The runtime persists bounded per-service update state separately from active install state, including last check evidence, available release metadata, downloaded candidate metadata, deferred install reasons, and failure evidence, while corrupt or missing update state degrades safely.
- `AC-4AD`: The CLI exposes bounded operator update commands for listing persisted update state, checking release sources, downloading update candidates, and explicitly installing candidates with clear human output and stable JSON output.
- `AC-4AE`: The runtime API exposes bounded update status and actions so app hosts and Service Admin can list persisted update state, check release sources, download candidates, and install candidates without shelling out to the CLI.
- `AC-4AF`: The runtime can run an opt-in policy-driven update scheduler that respects per-service update mode and check intervals, suppresses duplicate in-flight work, records update state, and performs notify, download, or install actions according to explicit `service.json` policy.
- `AC-4AG`: Scheduled update installs respect explicit maintenance-window and running-service policy, defer safely with persisted operator evidence when not eligible, and only bypass those safety checks when an operator uses an explicit force path.
- `AC-4AH`: Service Admin can consume the bounded update API/state and surface operator-facing update notifications, per-service update states, and allowed check/download/install actions without shelling out to the CLI.
- `AC-4AI`: Update lifecycle verification proves CLI, API, persisted update state, and runtime install metadata agree across deterministic fixture-backed success, latest, failed, and deferred paths, with an opt-in live Echo Service release verification command for real GitHub release artifacts.
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
- direct proof that a bounded `packages/` workspace exists with a private core wrapper package exposing the current built runtime/CLI targets without moving the current runtime source yet
- direct proof that the canonical web, node, electron, and tauri reference-app starters exist as sibling repos under `C:\projects\service-lasso`, that the matching GitHub repos exist, and that those GitHub repos are marked as templates for quick-start use
- direct proof that a bounded release artifact can be staged, that it contains the documented shipped files, that the staged artifact entrypoint can boot against explicit runtime roots, and that tagged GitHub releases can attach that packaged artifact
- direct proof that a self-contained publishable `@service-lasso/service-lasso` payload can be staged, packed, installed into a temporary consumer, published to the configured public npm registry, and boot the runtime against explicit runtime roots
- explicit documentation that each sibling starter repo's first meaningful POC remains clonable/executable, shows host-owned output, and can surface `lasso-@serviceadmin` against a real `lasso-echoservice`-backed runtime
- direct proof that the remediation execution list, backlog, and package/reference docs all agree on the four active workstreams around naming, manifest ownership, bundled semantics, and release versioning
- direct proof that core release/package workflows create timestamped `yyyy.m.d-<shortsha>` release versions from protected-branch pushes without requiring manual tag creation
- direct proof that the core runtime can install/acquire a service from manifest-owned release metadata without starting it, including a supported CLI path in addition to the bounded runtime/API flow
- direct proof that the canonical sibling app repos and packaging-target repos exist with the expected names, while deprecated/vague starter repos are retired or archived explicitly
- direct proof that clean consumer installs and release artifacts work end to end across `@service-lasso/service-lasso`, Echo Service, Service Admin, and the canonical reference-app repos, including source/template, bootstrap-download, and bundled/no-download modes
- direct proof that each canonical reference-app source host can start its own runtime, mount Service Admin, discover `echo-service` and `service-admin`, and drive Echo Service through install/config/start/stop without leaking app/runtime child processes
- documentation and backlog proof that donor-aligned core runtime/provider services are classified explicitly, including a tracked Java runtime service path for donor `_java` rather than leaving Java only in reference material
- direct clean-clone proof for the documented baseline start path, including service acquisition where manifests point at release artifacts, dependency-aware install/config/start sequencing, and runtime API evidence that `@traefik`, `@node`, `echo-service`, and `service-admin` reached their expected final states or were explicitly classified as local/no-download/deferred
- direct proof that valid recovery/doctor/hook manifest policies parse into typed runtime contracts, invalid unsafe shapes are rejected, and existing manifests remain valid without opting into automatic restart or hook execution
- direct proof that an opt-in runtime monitor can start/stop cleanly, skip ineligible services deterministically, and restart a crashed service when explicit monitoring and restart policy allow it
- direct proof that configured doctor/preflight steps run before restart, block restart when policy requires, and can warn/continue without replacing the service process prematurely
- direct proof that configured pre-upgrade and post-upgrade hooks run around update install, required hook failure blocks successful install reporting, rollback/onFailure hooks run for failed upgrade simulations, hook timeout is visible, and update state records bounded hook evidence
- direct proof that recovery history and manual doctor/preflight execution are available through bounded CLI and API surfaces, with JSON output for app hosts and persisted `.state/recovery.json` agreement
- direct proof that the recovery/hook lifecycle keeps API, CLI, persisted recovery state, monitor restart, doctor/preflight, and update hooks in agreement across deterministic Echo-style E2E fixtures
- direct proof that valid update policies parse into typed runtime contracts, unsafe active/pinned combinations are rejected, and read-only update discovery classifies pinned, latest, update-available, unavailable, and check-failed release states through deterministic fake GitHub release metadata
- direct proof that update state writes and rehydrates from `.state/updates.json`, distinguishes available/downloaded/deferred/failed state, does not mutate active `install.json` artifact metadata, and safely ignores missing or corrupt update state
- direct proof that `service-lasso updates list/check/download/install` supports human and JSON output, persists state transitions, downloads candidates without changing active install metadata, blocks install when policy disallows it, and supports explicit forced install
- direct proof that update API routes return persisted state, check updates, download candidates without mutating active install metadata, install with policy/force behavior, and return structured errors for invalid request bodies or missing services
- direct proof that the opt-in update scheduler skips disabled/pinned services, respects configured intervals, suppresses duplicate in-flight work, performs notify/download/install actions according to service policy, and starts/stops cleanly with the API server
- direct proof that install-mode updates defer outside maintenance windows before download/install, defer while running when policy requires a stopped service, and stop/restart a running service when policy explicitly allows it
- direct proof that Service Admin displays update availability, downloaded candidates, deferred install windows, and failed checks from the update API shape, with bounded check/download/install action wiring
- direct proof that update lifecycle verification covers installed-old, latest-installed, download failure, install failure, outside-window deferral, CLI/API agreement, persisted `.state/updates.json`, active install metadata, and a live release-backed Echo Service update path through an explicit verifier
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
- release-readiness validation docs under `docs/development/`
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
- 2026-04-25: `#98` adds `service-lasso start` as the documented baseline bootstrap command. It directly verifies dependency-aware install/config/start sequencing and rerun idempotency with fixture services, while the real `@traefik` baseline remains deferred to `#102`.
- 2026-04-25: `#99` adds `npm run verify:baseline-start` and a pull-request smoke workflow for the documented baseline start command. The smoke uses generated local fixtures for deterministic API/lifecycle/cleanup proof; release-backed Traefik inclusion remains tracked by `#102`.
- 2026-04-25: `#102` creates `service-lasso/lasso-traefik` and release `2026.4.25-5301df9` with Windows/Linux/macOS Traefik archives and `service.json`. Core `@traefik` is now enabled and release-backed, with direct `npm run verify:traefik-release` proof plus inclusion in `npm run verify:baseline-start`.
- 2026-04-25: `#91` aligns the scoped reference-app and service-template inventories with the documented baseline. `service-template`, app-node, app-web, app-electron, app-tauri, and app-packager-pkg now carry `echo-service`, `service-admin`, `@node`, and release-backed `@traefik`, with local and CI validation plus post-merge releases.
- 2026-04-25: `#89` adds `npm run verify:reference-app-lifecycle`, a fresh-clone source-host smoke across app-node, app-web, app-electron, app-tauri, and app-packager-pkg that verifies host shell, Service Admin route, app-owned runtime service discovery, Echo Service install/config/start/stop, and process cleanup.
- 2026-04-25: `#93` promotes Java from donor/reference-only material into bounded core provider support. Core now has `services/@java/service.json`, provider resolution for `execservice: "@java"`, lifecycle/runtime evidence for Java-provider-backed execution, and an explicit deferred release-backed JRE repo plan.
- 2026-04-26: `#131` adds the bounded manifest contract for future service recovery, doctor/preflight steps, restart policy, and upgrade/restart hooks. This contract is validation-only; runtime monitoring and hook execution remain tracked under `#132` through `#138`.
- 2026-04-26: `#132` adds the first bounded opt-in runtime monitor loop. It can be started/stopped by the API server, evaluates explicit `monitoring` + `restartPolicy` service policy, restarts crashed services when allowed, and reports deterministic skip/restart events. Persisted recovery history and operator surfaces remain tracked under `#135` and `#136`.
- 2026-04-26: `#133` adds bounded doctor/preflight execution before restart. Passing doctor steps allow restart, block-policy failures prevent restart before the existing process is replaced, and warn-policy failures continue while remaining visible to later recovery-state work.
- 2026-04-26: `#134` adds bounded upgrade-hook execution around update install. Required pre/post upgrade hook failures prevent success reporting, rollback/onFailure hooks run for failed upgrade simulations, timeout evidence is recorded, and hook results are visible in update state while durable recovery history remains tracked under `#135`.
- 2026-04-27: `#135` adds bounded durable recovery history in `.state/recovery.json`. Monitor decisions, doctor/preflight results, restart outcomes, and upgrade hook phase results are persisted per service, rehydrate safely, and retain the latest 100 events by default.
- 2026-04-27: `#136` adds bounded recovery CLI/API surfaces. Operators and app hosts can list recovery history, fetch a single service history, and run manual doctor/preflight checks without restarting the service while persisting the resulting evidence.
- 2026-04-27: `#137` adds Service Admin recovery visibility. The admin UI consumes the recovery API/state shape, surfaces monitor/doctor/restart/hook status in dashboard, services table, and service detail views, and wires a manual doctor action through the runtime API.
- 2026-04-27: `#138` adds deterministic recovery/hook E2E verification. Echo-style fixtures prove monitor crash restart, doctor/preflight, update hook execution, runtime API, CLI output, and `.state/recovery.json` stay in agreement, with `npm run verify:recovery-hooks` as an explicit verifier.
- 2026-04-27: `#159` makes local runtime providers explicit with `role: "provider"`. Baseline start installs/configures provider manifests such as `@node`, skips managed daemon launch for them, and reports provider health once installed/configured instead of falsely treating short-lived provider probes as failed services.
- 2026-04-27: `#167` documents the provider release-service delivery plan for `@node`, `@python`, `@java`, and `@traefik`. Current truth remains explicit: only `@traefik` is release-backed today, while `@node`, `@python`, and `@java` are local/no-download providers until `#168`, `#169`, and `#170` deliver verified service repos. `#171` tracks Traefik contract hardening and `#172` tracks core/reference integration after provider releases exist.
- 2026-04-27: `#174` locks the first multi-version provider artifact matrix. `lasso-node` should publish Node `24` and `25` artifacts with core selecting Node `24`; `lasso-java` should publish Java `17` and `21` artifacts with core selecting Java `17`; `lasso-python` should publish Python `3.11.5` and `3.14.4` artifacts with core selecting Python `3.11.5`. Provider repo release tags still use `yyyy.m.d-<shortsha>`; runtime versions belong in asset names and manifest selection.
- 2026-04-27: `#176` tightens provider artifact naming to exact upstream runtime versions. Initial provider assets should use exact names such as `lasso-node-v24.15.0-win32.zip`, `lasso-node-v25.9.0-win32.zip`, `lasso-java-17.0.18+8-win32.zip`, `lasso-java-21.0.10+7-win32.zip`, `lasso-python-3.11.5-win32.zip`, and `lasso-python-3.14.4-win32.zip`; core/default selection remains Node `v24.15.0`, Java `17.0.18+8`, and Python `3.11.5`.
- 2026-04-27: `#171` hardens `service-lasso/lasso-traefik` as the current release-service reference pattern. Release `2026.4.27-354433e` publishes Windows/Linux/macOS Traefik archives, released `service.json`, and `SHA256SUMS.txt`; core `@traefik` is pinned to that verified release and remains covered by `npm run verify:traefik-release`.
- 2026-04-27: `#168` creates `service-lasso/lasso-node` as the release-backed Node.js provider repo. Release `2026.4.27-13573bd` publishes exact Node `v24.15.0` and `v25.9.0` Windows/Linux/macOS archives, released `service.json`, and `SHA256SUMS.txt`; direct core install/acquire proof can download the default `v24.15.0` artifact without starting a managed daemon.
- 2026-04-26: `#121` and `#122` add the first bounded service update-management slice. `service.json` now accepts explicit `updates` policy, unsafe active/pinned combinations are rejected, and read-only GitHub-release discovery can classify pinned/latest/update-available/unavailable/check-failed states without downloading or installing artifacts.
- 2026-04-26: `#123` adds bounded durable update state under `.state/updates.json`. Check results, available releases, downloaded candidates, install deferrals, and failures are stored separately from active installed artifact metadata and rehydrate through service detail output.
- 2026-04-26: `#124` adds bounded update CLI commands. Operators can list/check updates, download candidates, and explicitly install a candidate with human or JSON output while scheduler, maintenance-window policy, dedicated API routes, and Service Admin UI work remain tracked separately at that point in the rollout.
- 2026-04-26: `#125` adds bounded runtime API routes for update status, checks, candidate downloads, and candidate installs. App hosts and Service Admin can now call backend update actions directly; scheduler, maintenance-window safety, and UI notifications remain tracked separately at that point in the rollout.
- 2026-04-26: `#126` adds the first opt-in policy-driven update scheduler. It respects disabled/pinned services, per-service check intervals, duplicate in-flight suppression, and explicit notify/download/install modes. Maintenance-window running-service safety and UI notification treatment remain tracked under `#127` and `#128` at that point in the rollout.
- 2026-04-26: `#127` adds bounded safety gates for scheduled update installs. Install-mode updates now defer outside `updates.installWindow`, defer when a running service policy requires the service to be stopped, and can stop/restart a running service when `updates.runningService` allows it; explicit force remains the operator bypass.
- 2026-04-26: `#128` coordinates the Service Admin UI update notification slice in `service-lasso/lasso-serviceadmin#12`. The dashboard, services table, and service detail view now surface update states from the runtime API shape and expose bounded check/download/install actions, with local Service Admin tests, build, and lint passing before merge.
- 2026-04-26: `#129` adds deterministic update lifecycle E2E verification plus `npm run verify:service-updates`. The deterministic suite proves CLI/API/state/install agreement across old/new/latest, download failure, install failure, and outside-window deferral; the live verifier proves a real Echo Service GitHub release check/download/install path without making normal tests depend on live GitHub state.

# Clean Clone Baseline Start Evaluation

Date: 2026-04-24

Latest update: 2026-04-28

Linked issues: `#95`, `#96`, `#97`, `#98`, `#99`, `#102`, `#158`, `#159`, `#160`, `#171`, `#172`, `#185`, `#187`, `#189`, `#191`, `#193`, `#195`, `#198`, `#201`

OpenSpec binding: `SPEC-002`, `AC-4Z`

## Question

If a user clones `service-lasso` and runs the start command, will it download the baseline services from their service repos and run them?

Expected baseline services:

- `@traefik`
- `localcert`
- `nginx`
- `@node`
- `echo-service`
- `service-admin`

## Current Answer

Verified on `develop`.

The documented command name is now:

```powershell
service-lasso start --services-root ./services --workspace-root ./workspace
```

As of 2026-04-27, the core CLI has a bounded baseline bootstrap command that installs, configures, and starts the baseline inventory in dependency order, then leaves the API running.

`@traefik` now points at the canonical `service-lasso/lasso-traefik@2026.4.27-bbc7f15` release artifact. The command can acquire, configure, and start Traefik as a real release-backed baseline service using donor-style `commandline` startup flags, `depend_on: ["localcert", "nginx"]`, HTTP `/ping` readiness, and shared Traefik port/globalenv/portmapping outputs.

Issue `#158` fixed the release-backed command execution gap for `echo-service` and `service-admin`: after install, direct execution now prefers the acquired artifact command over any checked-in fixture command, and artifact-relative commands run from the extracted artifact root.

Issue `#159` fixed the provider-state ambiguity for `@node`: it is a `role: "provider"` service, so baseline start installs/configures it, skips managed daemon start, and reports provider health once installed/configured. Issue `#172` then moved the checked-in `@node` manifest to the pinned release-backed `service-lasso/lasso-node@2026.4.27-13573bd` artifact. Issue `#195` added the missing Traefik dependency edge for `localcert` and `nginx`. Issue `#198` promotes `nginx` from a dependency marker to the release-backed managed service `service-lasso/lasso-nginx@2026.4.27-712c75f`, so baseline start now acquires, configures, starts, and healthchecks NGINX before Traefik. Issue `#201` makes `localcert` and `service-admin` explicit core services while preserving their established IDs and lifecycle behavior.

## Final Fresh-Clone Evidence

Fresh-clone command evaluated on 2026-04-27:

```powershell
git clone --branch develop https://github.com/service-lasso/service-lasso.git <temp>
cd <temp>
npm ci
npm run build
node dist/cli.js start --services-root ./services --workspace-root ./workspace --port <temp-port> --json
```

Observed result:

- `npm ci` passed.
- `npm run build` passed.
- the Service Lasso API reported `/api/health` status `ok`.
- `@node`, `@traefik`, `echo-service`, and `service-admin` acquired and extracted release artifacts from their configured GitHub releases.
- `@traefik`, `echo-service`, and `service-admin` reported installed/configured/running/healthy.
- `@node` reported installed/configured, `running=false`, `healthType=provider`, and `healthy=true`, which is its expected provider state.
- `stopAll` cleanup was called after verification.

Final observed baseline state:

| Service | Installed | Configured | Running | Healthy | Artifact source |
| --- | --- | --- | --- | --- | --- |
| `localcert` | yes | yes | no | yes | local/no-download core provider-role utility |
| `nginx` | yes | yes | yes | yes | `service-lasso/lasso-nginx@2026.4.27-712c75f` |
| `@traefik` | yes | yes | yes | yes | `service-lasso/lasso-traefik@2026.4.27-bbc7f15` |
| `@node` | yes | yes | no | yes | `service-lasso/lasso-node@2026.4.27-13573bd` |
| `echo-service` | yes | yes | yes | yes | `service-lasso/lasso-echoservice@2026.4.20-a417abd` |
| `service-admin` | yes | yes | yes | yes | core release-backed service from `service-lasso/lasso-serviceadmin@2026.4.18-170a1af` |

## Historical Evidence

Clean-clone command evaluated:

```powershell
git clone --branch develop https://github.com/service-lasso/service-lasso.git <temp>
cd <temp>
npm ci
npm start
```

Observed result:

- `npm ci` completed successfully.
- `npm start` exited with code `1`.
- The process failed before the core API started.
- Failure message: `Cannot find module '<temp>\\dist\\index.js'`.

The failure happens because `npm start` runs:

```powershell
node --enable-source-maps dist/index.js
```

but a clean clone does not have `dist/index.js` until the TypeScript build has run.

## Current Core Service Inventory

Initial `service-lasso/services/` manifests observed during issue `#95`:

- `services/@node/service.json`
- `services/@java/service.json`
- `services/@python/service.json`
- `services/echo-service/service.json`
- `services/node-sample-service/service.json`

Missing from the expected clean-clone baseline:

- `services/@traefik/service.json`
- `services/service-admin/service.json`

Issue `#97` added the baseline manifest IDs to the core services root. Issue `#102` turns `@traefik` from a disabled placeholder into a release-backed Traefik service artifact from `service-lasso/lasso-traefik`. Issue `#171` hardens that service repo contract, issue `#185` adds HTTP `/ping` readiness, issue `#187` restores Traefik env/globalenv outputs, issue `#189` restores the full service-port map, issue `#191` pins the donor-compatible `portmapping`, issue `#193` pins donor-style commandline flags, and issue `#195` pins the core manifest to the verified `2026.4.27-bbc7f15` release with `depend_on: ["localcert", "nginx"]`. Issue `#198` pins `nginx` to the release-backed managed service repo `service-lasso/lasso-nginx@2026.4.27-712c75f`. Issue `#93` adds `@java` as a bounded provider outside the starter baseline. Issue `#172` pins `@node`, `@python`, and `@java` to their verified release-backed provider repos.

Current `services/echo-service/service.json` carries both a local fixture fallback and release artifact metadata. Install/acquire uses the release-backed artifact metadata from `service-lasso/lasso-echoservice`.

Current `services/@node/service.json` is a release-backed runtime/provider manifest with `role: "provider"` and artifact source `service-lasso/lasso-node@2026.4.27-13573bd`.

Current `services/@python/service.json` is an optional release-backed runtime/provider manifest with artifact source `service-lasso/lasso-python@2026.4.27-63f915c`. The first Python provider release supports Windows official Python.org embeddable archives only.

Current `services/@java/service.json` is an optional release-backed runtime/provider manifest with artifact source `service-lasso/lasso-java@2026.4.27-b313cb0`.

## 2026-04-27 Direct Checked-In Manifest Proof Before Final Fresh Clone

Command shape exercised against tracked `services/` manifests copied to a temporary services root:

```powershell
npm run build
node dist/cli.js start --services-root <tracked-services-copy> --workspace-root <temp-workspace> --port <temp-port> --json
```

Observed after issue `#158` fix:

| Service | Installed | Configured | Running | Healthy | Artifact source |
| --- | --- | --- | --- | --- | --- |
| `localcert` | yes | yes | no | yes | local/no-download core provider-role utility |
| `nginx` | yes | yes | yes | yes | `service-lasso/lasso-nginx@2026.4.27-712c75f` |
| `@traefik` | yes | yes | yes | yes | `service-lasso/lasso-traefik@2026.4.27-bbc7f15` |
| `echo-service` | yes | yes | yes | yes | `service-lasso/lasso-echoservice@2026.4.20-a417abd` |
| `service-admin` | yes | yes | yes | yes | core release-backed service from `service-lasso/lasso-serviceadmin@2026.4.18-170a1af` |
| `@node` | yes | yes | no | yes | `service-lasso/lasso-node@2026.4.27-13573bd` |

This directly verifies that release-backed `@node`, `@traefik`, `echo-service`, and `service-admin` are acquired from their configured GitHub releases. Managed daemons remain running/healthy after the baseline start path, while `@node` verifies the expected provider outcome: installed/configured, not launched as a managed daemon, and provider-health true.

## Current CLI/API Capability

Current CLI commands:

- `service-lasso`
- `service-lasso serve`
- `service-lasso start`
- `service-lasso install <serviceId>`
- `service-lasso help`
- `service-lasso --version`

Current capability:

- The API can perform lifecycle actions when running.
- The CLI can acquire/install one service from manifest-owned artifact metadata.
- The API can run `startAll` after services are installed and configured.

Current implemented capability:

- `service-lasso start` discovers the baseline services, installs/configures/starts enabled services in dependency order, reports skipped disabled services, and leaves the API running.
- `tests/bootstrap-start.test.js` proves install/config/start sequencing and rerun idempotency against a four-service baseline fixture.
- `npm run verify:baseline-start` builds the CLI and runs the documented `service-lasso start` command end to end against the real release-backed `@node` and `@traefik` artifacts plus generated deterministic `echo-service` and `service-admin` fixtures.
- `.github/workflows/baseline-start-smoke.yml` runs that same command-level smoke on pull requests to `develop` and on manual dispatch.
- `npm run verify:traefik-release` directly proves the public Traefik release archive can be acquired, configured, started, and observed healthy through the runtime API.

Current remaining capability notes:

- the deterministic baseline-start smoke still uses generated fixtures for `echo-service` and `service-admin`; direct checked-in-manifest proof covers release-backed `echo-service` and `service-admin` after `#158`
- `@node` provider non-daemon behavior is now explicit after `#159` and release-backed after `#172`
- deterministic live reference-app lifecycle proof passed on 2026-04-25 for all five canonical reference apps through `npm run verify:reference-app-lifecycle`

## Gap Issues

The clean-clone baseline start use case is split into these implementation-grade follow-up issues:

- `#96`: make `npm start` work from a clean clone.
- `#97`: add release-backed baseline service manifests to the core services root.
- `#98`: add a bootstrap start command for baseline service install/config/start.
- `#99`: add deterministic clean-clone baseline start smoke verification.
- `#102`: create the canonical release-backed `@traefik` service repo/artifact and include it in the baseline release-backed proof.
- `#171`: harden the `lasso-traefik` release-service contract and pin core to the original verified release.
- `#185`: align the released Traefik manifest and core baseline pin with donor-style HTTP readiness via `/ping`.
- `#187`: restore Traefik env/globalenv outputs for downstream services and operator APIs.
- `#189`: restore the full Traefik service-port map and prove resolved network/globalenv output.
- `#191`: preserve donor-compatible `portmapping` and expose it through the network API.
- `#193`: preserve donor-style Traefik commandline startup flags and execute manifest `commandline` during runtime start/restart.
- `#195`: add missing `localcert` and `nginx` baseline dependency entries and pin Traefik to the dependency-bearing release.
- `#198`: promote `nginx` to a release-backed managed baseline service with its own canonical service repo/release.
- `#172`: integrate release-backed runtime provider manifests into the core inventory.
- `#158`: fix checked-in baseline start so release-backed Echo Service and Service Admin start from acquired artifacts and remain running.
- `#159`: clarify and enforce `@node` local provider behavior in baseline start.
- `#160`: replace stale clean-clone baseline evaluation with final direct current evidence.

All listed gap issues are complete as of this update.

## Completion Target

The use case is complete only when a fresh clone can run the documented start path and produce direct evidence that:

- the Service Lasso API is running
- the baseline services are discovered
- release-backed services are acquired from their canonical service repos
- services are installed and configured
- services are started in dependency order
- runtime API state shows expected installed/configured/running outcomes
- child processes are cleaned up deterministically during verification

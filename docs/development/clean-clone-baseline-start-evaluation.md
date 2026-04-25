# Clean Clone Baseline Start Evaluation

Date: 2026-04-24

Latest update: 2026-04-25

Linked issues: `#95`, `#96`, `#97`, `#98`, `#99`

OpenSpec binding: `SPEC-002`, `AC-4Z`

## Question

If a user clones `service-lasso` and runs the start command, will it download the baseline services from their service repos and run them?

Expected baseline services:

- `@traefik`
- `@node`
- `echo-service`
- `service-admin`

## Current Answer

Partial.

The documented command name is now:

```powershell
service-lasso start --services-root ./services --workspace-root ./workspace
```

As of 2026-04-25, the core CLI has a bounded baseline bootstrap command that installs, configures, and starts the baseline inventory in dependency order, then leaves the API running.

Remaining gap: `@traefik` is still an intentionally disabled placeholder until `#102` creates the canonical release-backed Traefik service repo/artifact. The command reports disabled baseline services as skipped/deferred instead of pretending they started.

## Evidence

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
- `services/@python/service.json`
- `services/echo-service/service.json`
- `services/node-sample-service/service.json`

Missing from the expected clean-clone baseline:

- `services/@traefik/service.json`
- `services/service-admin/service.json`

Issue `#97` adds those manifest IDs to the core services root. `@traefik` remains a disabled placeholder until issue `#102` creates a canonical release-backed Traefik service repo/artifact.

Current `services/echo-service/service.json` is a local fixture manifest. It does not currently prove the expected release-backed download path from `service-lasso/lasso-echoservice`.

Current `services/@node/service.json` is a local runtime/provider fixture. It does not currently document whether `@node` is intentionally no-download/local or a release-backed runtime service.

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
- `npm run verify:baseline-start` builds the CLI and runs the documented `service-lasso start` command end to end against generated baseline fixtures for `@node`, `@traefik`, `echo-service`, and `service-admin`.
- `.github/workflows/baseline-start-smoke.yml` runs that same command-level smoke on pull requests to `develop` and on manual dispatch.

Current missing capability:

- release-backed Traefik acquisition/start remains blocked on `#102`.
- the deterministic baseline-start smoke is intentionally fixture-backed; full clean-clone proof against real release-backed service repos remains blocked until the baseline inventory includes canonical release-backed `@traefik`.

## Gap Issues

The clean-clone baseline start use case is split into these implementation-grade follow-up issues:

- `#96`: make `npm start` work from a clean clone.
- `#97`: add release-backed baseline service manifests to the core services root.
- `#98`: add a bootstrap start command for baseline service install/config/start.
- `#99`: add deterministic clean-clone baseline start smoke verification.
- `#102`: create the canonical release-backed `@traefik` service repo/artifact and include it in the baseline release-backed proof.

## Completion Target

The use case is complete only when a fresh clone can run the documented start path and produce direct evidence that:

- the Service Lasso API is running
- the baseline services are discovered
- release-backed services are acquired from their canonical service repos
- services are installed and configured
- services are started in dependency order
- runtime API state shows expected installed/configured/running outcomes
- child processes are cleaned up deterministically during verification

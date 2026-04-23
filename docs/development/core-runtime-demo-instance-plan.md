# Core runtime demo-instance plan

This document now doubles as the current demo-instance quickstart and the residual-hardening note for the bounded `service-lasso` demo flow.

The original goal was to turn the core runtime into a reviewable demo instance. That bounded goal is now implemented. The current purpose of this document is to show:
- what the demo proves today
- which commands are the canonical demo commands
- what evidence the scripted demo smoke actually checks
- what still remains outside the bounded demo slice

## Purpose

The demo instance proves, in one local runnable slice, that `service-lasso` can:
- start a real core API process
- load a real managed service tree from `services/`
- expose service/runtime/operator endpoints from that tree
- run bounded lifecycle actions against demo services
- write/read structured `.state` data
- show provider execution behavior for the demo services
- give the UI/harness a stable target to exercise

## Current demo commands

Use these commands from the repo root:

```bash
npm run demo:start
npm run demo:smoke
npm run demo:reset
```

Default demo roots:
- `servicesRoot = <repo>/services`
- `workspaceRoot = <repo>/workspace/demo-instance`

Override flags when needed:
- `--services-root=<path>`
- `--workspace-root=<path>`
- `--port=<number>`
- `--preserve` for `demo:smoke` if you want to keep demo output after the smoke run

`demo:start`:
- builds the repo
- starts the runtime against the demo roots
- prints the API URL, `servicesRoot`, and `workspaceRoot`

`demo:smoke`:
- resets the demo roots first
- starts the runtime against explicit roots
- exercises the bounded end-to-end flow
- stops the runtime and resets the demo again unless `--preserve` is set

`demo:reset`:
- removes the demo workspace
- removes tracked demo `.state` and `logs` output
- removes manifest-declared install/config artifact files for the demo service set

## Implemented success bar

The bounded demo instance is considered implemented because all of the following are now true:

1. A reviewer can start the core runtime with one documented command.
2. The runtime comes up against a known demo `services/` root.
3. The main demo endpoints return stable, expected data.
4. At least one demo service can be taken through install -> config -> start -> health -> stop in a repeatable way.
5. Structured `.state` files can be inspected before and after lifecycle actions.
6. The demo can be re-run cleanly without hand-editing the repo.
7. There is one documented smoke test flow for humans and one scripted validation flow for automation.

Important honesty rule:
- this demo is execution-backed, not state-flip-only
- the smoke flow proves one direct managed service path and one provider-backed path
- passing docs or state-file inspection alone is not enough

## Current demo service set

The bounded demo currently uses:
- `echo-service` as the direct managed service path
- `@node` as the runtime provider dependency
- `node-sample-service` as the provider-backed managed service path

This keeps the demo small while still proving:
- direct execution
- provider-backed execution
- dependency-aware startup
- runtime/operator surfaces
- persisted runtime/state/log/metrics evidence

## Scope boundary for the demo

### In scope
- local development-mode runtime startup
- demo service root and fixture/demo services
- stable documented demo commands
- bounded lifecycle demonstration
- state persistence + inspection proof
- runtime/dependencies/operator endpoint proof
- one repeatable smoke-test flow
- one repeatable scripted validation flow

### Out of scope for this demo slice
- full production packaging/distribution
- full process supervision parity with donor runtime
- complete provider catalog
- remote multi-instance deployment model
- full UI/operator product completion
- all future runtime hardening work

## Current scripted smoke flow

`npm run demo:smoke` currently verifies all of the following:

1. reset the demo roots to a known clean state
2. start the runtime against explicit `servicesRoot` and `workspaceRoot`
3. confirm:
   - `/api/health`
   - `/api/services`
   - `/api/runtime`
   - `/api/dependencies`
4. run `echo-service` through:
   - `install`
   - `config`
   - `start`
5. confirm `echo-service`:
   - reports healthy
   - writes runtime logs
   - exposes runtime metrics
   - persists `.state/runtime.json`
6. run `@node` and `node-sample-service` through `install` and `config`
7. start `node-sample-service`
8. confirm provider-backed evidence and bounded `@node` dependency launch evidence
9. confirm aggregate runtime metrics include the exercised services
10. run runtime `stopAll`
11. confirm the direct and provider-backed services are stopped cleanly
12. stop the runtime and reset demo output again by default

The regression wrapper for this flow is:
- `tests/demo-instance.test.js`

## Quick reviewer flow

For a manual review:

1. Run `npm run demo:start`
2. Fetch or open:
   - `/api/health`
   - `/api/services`
   - `/api/runtime`
   - `/api/dependencies`
3. Run lifecycle actions against `echo-service`:
   - `install`
   - `config`
   - `start`
   - `stop`
4. Inspect:
   - `/api/services/echo-service`
   - `/api/services/echo-service/health`
   - `/api/services/echo-service/logs`
   - `/api/services/echo-service/metrics`
   - `services/echo-service/.state/`
5. Run `npm run demo:reset` when done

## Evidence expectations

The minimum honest evidence for this demo slice is:
- `npm run demo:smoke`
- `npm test`

Anything weaker should be treated as partial proof only.

## Relationship to later runtime hardening

This demo plan does **not** replace the broader runtime roadmap.

The bounded demo slice does not replace later hardening work. The main follow-on consumer proof should now be:
- `lasso-@serviceadmin` integration validation against the current runtime API using the same bounded demo/runtime shape

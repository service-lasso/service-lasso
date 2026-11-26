# Operator v2 coverage matrix

Scope: current `develop` operator/v2 contract. This is not native, ROOT, or GA
qualification evidence.

## Contract operations

| Operation | Core test | CLI test | TUI test | Cross-client |
| --- | --- | --- | --- | --- |
| discovery | `tests/operator-v2-contract.test.js`; `tests/operator-v2-routes.test.js` | `tests/core-client.test.js` | `internal/api/operator_*_test.go` | `verify-v2-clients.mjs` |
| services | `tests/operator-v2-routes.test.js` | `tests/core-client.test.js`; `real-core-read-acceptance.test.js` | `internal/api/operator_*_test.go` | `verify-v2-clients.mjs`; mutable harness |
| detail | `tests/operator-v2-contract.test.js` | `tests/core-client.test.js` | `internal/api/operator_*_test.go` | mutable harness |
| graph | `tests/operator-v2-routes.test.js` | `tests/core-client.test.js` | `internal/api/operator_graph_test.go` | TUI terminal E2E |
| reconciliation context | `tests/durable-reconciliation-context-http.test.js` | `tests/core-client.test.js` | `internal/api/operator_context_http_test.go` | `verify-v2-clients.mjs`; mutable harness |
| lifecycle availability | `tests/operator-v2-contract.test.js`; `tests/operator-v2-routes.test.js` | `tests/real-core-durable-acceptance.test.js` | `internal/api/operator_*_test.go` | mutable harness |
| preview | `tests/operator-v2-contract.test.js`; `tests/operator-v2-routes.test.js` | `tests/real-core-durable-acceptance.test.js` | `internal/api/operator_mutations` tests | mutable harness |
| execute | `tests/operator-v2-contract.test.js`; `tests/operator-v2-routes.test.js` | `tests/real-core-durable-acceptance.test.js` | `internal/api/operator_mutations` tests | mutable harness |
| operation readback | `tests/operator-v2-contract.test.js`; `tests/operator-v2-routes.test.js` | `tests/real-core-durable-acceptance.test.js` | `internal/api/operator_*_test.go` | mutable harness |
| cancel | `tests/operator-v2-contract.test.js`; `tests/operator-v2-routes.test.js` | `tests/real-core-durable-acceptance.test.js` | `internal/api/operator_*_test.go` | mutable harness |
| v2 error envelope | `tests/operator-v2-contract.test.js`; `tests/operator-v2-routes.test.js` | `tests/core-client.test.js` | `internal/api/operator_*_test.go` | negative cases |
| stale revision 409 | route tests | `real-core-durable-acceptance.test.js` | client tests | mutable harness |

## Advertised journeys

`overview`, `detail`, and `graph` are implemented and advertised. `logs` and the
remaining mutation/form journeys are not advertised until corresponding Core
routes exist. TUI navigation skips unadmitted journeys, so it cannot turn into a
404.

## Executable gates

Core:

```sh
npm run build
node --test --test-concurrency=1 tests/operator-v2-contract.test.js tests/operator-v2-routes.test.js
node --experimental-test-coverage --test --test-concurrency=1 tests/operator-v2-contract.test.js tests/operator-v2-routes.test.js
GO=/path/to/go node scripts/verify-v2-clients.mjs
GO=/path/to/go node scripts/verify-v2-mutable-clients.mjs
```

CLI:

```sh
npm run build
node --test tests/core-client.test.js tests/real-core-acceptance.test.js tests/real-core-durable-acceptance.test.js
node --experimental-test-coverage --test tests/core-client.test.js
```

TUI:

```sh
go test ./...
go test -coverprofile=/tmp/tui.cover ./...
node scripts/run-local-e2e.mjs --suite v2 --core-dir <clean-core> \
  --expected-core-revision <40-char-sha> --output-dir /tmp/tui-e2e \
  --npm-cli <npm-cli.js> --python <python>
```

## Measured coverage (24 November 2026)

- Core `operator-v2.js`: 99.68% lines, 75.00% branches, 100.00% functions.
- Core `src/server/index.ts`: 15.54% lines with the v2-only suite; it contains all
  non-v2 runtime routes, so this is not a v2 contract percentage.
- TUI `internal/api`: 55.3% statements; `internal/app`: 56.9%; `internal/coreentry`:
  75.8%.
- CLI targeted v2 tests pass; line coverage is not yet enforced.

The actual gate is the operation matrix above. Whole-repository line coverage is
not 100% and is not claimed.

## Remaining non-v2 gaps

- macOS privileged native helper/ConPTY lanes.
- Authentic native originals, independent ROOT admission, qualification, GA.
- Full TUI journeys beyond `overview`/`detail`/`graph` are intentionally not advertised.

## Passive HTTP check samples (#1973 graph slice)

Selected contract: `.governance/specs/operator-v2-selected/HEALTH-CHECK-SAMPLES-AMENDMENT.md`
AC-HCS-1..6. GET `/api/operator/v2/health-check-samples?serviceId=...` accepts
1..25 distinct known IDs with authenticated runtime identity and workspace:read.
It returns the first effective configured HTTP check's real monitor observations,
up to 60 chronological samples in 900 seconds per service. No new probe schedule
is introduced: launch the normal CLI with `SERVICE_LASSO_MONITOR=1` to opt into
the existing monitor (default off; explicit `monitor:false` overrides it). The
product wrapper forwards `monitor` and `monitorIntervalMs`. Existing monitor
requires enabled monitoring, enabled restart
policy, and installed/configured/running lifecycle. Disabled restarts can retain
`onCrash:false,onUnhealthy:false`. A configured check with no observations is
configured with an empty sample list. The existing monitor boot snapshot remains
unchanged; changing the current check yields an empty projection until a matching
source runs (normally after restarting the runtime). Reads never probe or mutate
the recorder. Buffer state disappears with its runtime generation.

Direct real HTTP/timer proof and denied/invalid/isolation/configuration/window
proof: `npm run build && node --test tests/health-check-samples.test.js`. Existing
`tests/recovery-monitor.test.js`, v2 contract/routes, health-state and health-timeout
suites guard compatibility. This slice does not complete uptime/restart/incident
work in #1973 and is not native/release qualification.

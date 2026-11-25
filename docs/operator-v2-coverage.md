# Operator v2 coverage matrix

Scope: current `develop` operator/v2 contract. This is not native, ROOT, or GA
qualification evidence.

## Contract operations

| Operation | Core test | CLI test | TUI test | Cross-client |
| --- | --- | --- | --- | --- |
| discovery | `tests/operator-v2-contract.test.js`; `tests/operator-v2-routes.test.js` | `tests/core-client.test.js` | `internal/api/operator_*_test.go` | `verify-v2-clients.mjs` |
| services | `tests/operator-v2-routes.test.js` | `tests/core-client.test.js`; `real-core-read-acceptance.test.js` | `internal/api/operator_*_test.go` | `verify-v2-clients.mjs`; mutable harness |
| detail | `tests/operator-v2-contract.test.js` | `tests/core-client.test.js` | `internal/api/operator_*_test.go` | mutable harness |
| reconciliation context | `tests/durable-reconciliation-context-http.test.js` | `tests/core-client.test.js` | `internal/api/operator_context_http_test.go` | `verify-v2-clients.mjs`; mutable harness |
| lifecycle availability | `tests/operator-v2-contract.test.js`; `tests/operator-v2-routes.test.js` | `tests/real-core-durable-acceptance.test.js` | `internal/api/operator_*_test.go` | mutable harness |
| preview | `tests/operator-v2-contract.test.js`; `tests/operator-v2-routes.test.js` | `tests/real-core-durable-acceptance.test.js` | `internal/api/operator_mutations` tests | mutable harness |
| execute | `tests/operator-v2-contract.test.js`; `tests/operator-v2-routes.test.js` | `tests/real-core-durable-acceptance.test.js` | `internal/api/operator_mutations` tests | mutable harness |
| operation readback | `tests/operator-v2-contract.test.js`; `tests/operator-v2-routes.test.js` | `tests/real-core-durable-acceptance.test.js` | `internal/api/operator_*_test.go` | mutable harness |
| cancel | `tests/operator-v2-contract.test.js`; `tests/operator-v2-routes.test.js` | `tests/real-core-durable-acceptance.test.js` | `internal/api/operator_*_test.go` | mutable harness |
| v2 error envelope | `tests/operator-v2-contract.test.js`; `tests/operator-v2-routes.test.js` | `tests/core-client.test.js` | `internal/api/operator_*_test.go` | negative cases |
| stale revision 409 | route tests | `real-core-durable-acceptance.test.js` | client tests | mutable harness |

## Advertised journeys

Only `overview` and `detail` are implemented and advertised. `graph`, `logs`,
and later mutation metadata journeys are not advertised until corresponding Core
routes exist. This prevents a TUI navigation from turning into a 404.

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

## Remaining non-v2 gaps

- macOS privileged native helper/ConPTY lanes.
- Authentic native originals, independent ROOT admission, qualification, GA.
- Full TUI journeys beyond `overview`/`detail` are intentionally not advertised.

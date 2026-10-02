---
title: Core 1509 current Admin-pin qualification
---

# Core 1509 current Admin-pin qualification

This author record covers Core PR [#1509](https://github.com/service-lasso/service-lasso/pull/1509), governing issue [#1504](https://github.com/service-lasso/service-lasso/issues/1504), and `SPEC-002` `AC-4BY.2`. It is a development evidence record, not merge, release, promotion, deployment, or GA approval.

## Candidate and source boundary

The PR's historical remote head was `922beb522607900beaac418c98ac13299a5dca98`. This work merged only the current, already-merged Core PR [#1567](https://github.com/service-lasso/service-lasso/pull/1567), commit `2633c07be25512d0a84f9bfa28de6be5edff35e8`, producing product candidate `b19024ae984ad3b3a8a0779b60c3f7791e0528dc` before this evidence-only record.

The source tree binds these native assets:

| Asset | SHA-256 | Provenance boundary |
| --- | --- | --- |
| `tests/fixtures/windows-held-exit-probe.exe` | `0ecf7133ff0fd07137fdd88b5dec1128993ec1582aeba163fa66b5def521e2f6` | source `windows-held-exit-probe.cs` SHA-256 `e3dd8775977894f472a35c19036a620e5f774254a661aba44ba43b63e8001765`, 6,656 bytes, normalized PE timestamp and module identifier |
| `src/runtime/execution/windows-managed-launcher-native.exe` | `2aa66997bdb44677350456b1d598eb30787389c6a9878000d7f55e9f9f1414fc` | source SHA-256 `220ef6f6f9c2f99568937713f45861a2679e194174e831c6cdfa0dc1907b4281`, 34,816 bytes, normalized PE timestamp and module identifier |

`#1567` changes the native held-exit provenance/compiler qualification and settles owned launcher stderr only inside the existing launcher deadline before projecting the closed payload boundary. It does not broaden PID control, relax containment, change a timeout, permit a retry, or expose payload/error material.

## Historical failures retained

| Historical job | First observed boundary | Classification |
| --- | --- | --- |
| Lifecycle process tree Windows, run `36756462372`, job `110027845985` | `newcomer diagnostics observe a real API startup failure before owned cleanup` expected a `post_release_hook` event but observed none. The same run later exercised a `post_release_hook` failure successfully; that later result does not repair the failed assertion. | Invalidated historical exact head; native snapshot inspection had retried 51 times and reported `descendant_command_partial_copy`, so the causal relation remains unproven. |
| Packaged Admin lifecycle macOS, run `36756462492`, job `110027847187` | Exact released-Admin qualification reached `acceptance_complete`, then the Cypress child ended with exit `1`. The retained secret-free observation had reachable Admin, four completed `200` transport observations, and provider UI `bulk_migration` / `row_render`. | Invalidated historical exact head. Those observations do not bind an HTML, network, or render failure to the browser timeout or to Core. HTTP `200` is not UI acceptance. |

The historical raw logs remain external failure evidence and are not copied into this repository. They were read to identify the first observable boundary only. No blind rerun, timeout increase, concurrency change, permission change, or security-policy bypass occurred.

## Current direct checks

Every local test shell used a newly generated `SERVICE_LASSO_WORKSPACE_ROOT`, `SERVICE_LASSO_INSTANCE_REGISTRY_PATH`, and `SERVICE_LASSO_HOST_PORT_REGISTRY_PATH` before its first invocation. No shared registry, retained test PID, or unknown process was terminated.

| Check | Result | What it directly proves |
| --- | --- | --- |
| `npm run build` | Passed | Current TypeScript and copied runtime assets build. |
| `node --test --test-concurrency=1 --test-name-pattern="newcomer diagnostics observe a real API startup failure before owned cleanup" tests/process-ownership.test.js` | Passed | A real API start failure produces `post_release_hook` in the secret-safe diagnostic before owned cleanup. |
| `node --test --test-concurrency=1 tests/real-admin-browser-runner-shutdown.test.js` | Passed, 4 tests | The local runner reaches first-run readiness, waits for forced Admin exit and late managed finalization, keeps teardown failure metadata safe, and waits for closing servers before removal. It is supporting runner evidence, not released-Admin browser acceptance. |
| `tests/windows-compiler-process-budget.test.ps1` | Passed | The bounded compiler-budget unit cases pass. |
| `tests/windows-compiler-process-budget-real-adapter.test.ps1` | Passed | The bounded compiler real-adapter cases pass. |
| Windows PowerShell normal `-File scripts/verify-windows-process-inspector.ps1 -HeldExitFixture` | Blocked | This host's script-execution policy rejected the normal invocation. No execution-policy bypass or host change was used. Hosted Windows evidence remains required. |

## Released Admin pin and browser boundary

The packaged workflow still pins immutable published bytes independently from the browser harness:

| Component | Identity |
| --- | --- |
| Published Admin | release `2026.8.31-f015b44`, revision `f015b4445b0526546a309301270186a697588166`, release ID `380051618` |
| Admin browser harness | `1e1a85ee9478da0c95dde86be10245ff44fb879f` from `service-lasso/lasso-serviceadmin` |
| Published Broker | release `2026.8.31-f340883`, revision `f340883056ec3cf74b535fb46490b39382e8c823`, release ID `379635299` |

For each platform, Core installs the released Admin and Broker through its production checksum-verifying path, checks the selected archive against `SHA256SUMS.txt`, binds Core and harness source revisions, and retains metadata-only evidence. The workflow has a 60-minute job limit; this record did not change it. It continues to require first run, comprehensive lifecycle, stopped lifecycle, and Windows local-operator-lockout browser flows without mutation retry, captures, credentials, paths, or secret values in retained evidence.

This source review proves the pin and guard design. It does not produce the required three-platform released-browser result, does not identify the historical macOS browser failure, and does not establish that a `200` response rendered the required UI state.

## Qualification status and next action

Current local native and runner checks are **Verified** within their direct boundaries. The historical Windows and macOS failures remain **Invalidated**. Full current-head hosted lifecycle and released-Admin browser qualification are **Blocked pending natural CI**. The next executable action is to push this exact PR head, retain its natural CI outputs, and have a fresh peer review this complete record and the exact-head outcomes before any merge decision.

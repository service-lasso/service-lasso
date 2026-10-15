# Core #1538 / PR #1551 packaged-browser qualification handover

## Candidate and scope

- Candidate: `d349831eb84a5e61e61ee2da799fda77f664e91e` on `feature/1538-durable-http-update-cancellation`, targeting `develop` through PR #1551.
- Reviewed development comparison: `93d9d343a058d296069c017d17f4f8d1fc1505ea..d349831eb84a5e61e61ee2da799fda77f664e91e`. The corrected comparison base is `93d9d343a058d296069c017d17f4f8d1fc1505ea`; do not use the stale `027852...` field in the earlier review.
- #1538 remains bound to `SPEC-006 AC-6F`. Its public scope is only `update_check` and `update_download`; no unsupported operation was advertised or added.

## Exact-head provider result

All current MCP source/package rows and Release Qualification rows are successful at the candidate. Packaged Admin Lifecycle run `36864114774` is terminal with Linux success, Windows job `110375246024` failure, macOS job `110375246022` failure, and aggregate job `110382370620` failure. This is a **NO-GO** for merge, release, publication, promotion, deployment, or GA.

The terminal raw provider logs are retained outside the PR worktree and were not altered:

| Evidence | SHA-256 | Direct observation |
| --- | --- | --- |
| `D:\projects\service-lasso\audit-evidence\handover-20261001-cli-tui\core1551-d349-natural-browser-failures\job-110375246024.raw.log` | `ddb75aef5038fc4d423f7d5db1a5b28db46b03e9748e9fb1622f1ca6119d7f0e` | Windows first-run `POST /api/services/sample-service/start` returned 409 `invalid_lifecycle_state`: managed-process ownership enrollment and containment both failed. |
| `D:\projects\service-lasso\audit-evidence\handover-20261001-cli-tui\core1551-d349-natural-browser-failures\job-110375246022.raw.log` | `52222f628681c62235ae06864d7ed0f24a327ec131949a5f9e3b76c361030ad0` | macOS first-run passed; later comprehensive Broker-detail readiness made one request but retained `pending`, null HTTP/service fields, no controls, and skeleton-only rendering after four seconds. The verifier recorded four HTTP 200 transport observations and `provider_validation_complete`. |

These observations have separate existing owner tracks: Windows containment attribution is Core #1326 (`SPEC-002 AC-4BH/AC-4BI`); the macOS pending-delivery/render boundary is Core #1565 (`SPEC-002 AC-4BY.2`). #1382 remains the distinct historical macOS trusted-identity-after-restart investigation. Neither defect is demonstrated as caused by #1538's HTTP update/cancellation delta, so no product repair was made on this branch.

## Bounded discriminating experiment

A fresh detached exact-head checkout was created at `D:\projects\service-lasso\_review-runs\core1538-d349-packaged-win-20261001`. It used a normal `npm ci`, a normal build, a fresh exact Admin harness checkout at `7385136072a855ca144594842344a7241a733ab4`, normal frozen harness install, and the published checksum-bound Windows Admin/Broker archives. The only registry inputs were supported owned paths:

- `SERVICE_LASSO_WORKSPACE_ROOT=D:\projects\service-lasso\_review-runs\core1538-d349-packaged-win-20261001\qualification\workspace`
- `SERVICE_LASSO_INSTANCE_REGISTRY_PATH=D:\projects\service-lasso\_review-runs\core1538-d349-packaged-win-20261001\qualification\owned-registry\instances.json`
- `SERVICE_LASSO_HOST_PORT_REGISTRY_PATH=D:\projects\service-lasso\_review-runs\core1538-d349-packaged-win-20261001\qualification\owned-registry\ports.json`

The released-Admin first-run browser journey passed once. Its terminal log is `D:\projects\service-lasso\_review-runs\core1538-d349-packaged-win-20261001\qualification\windows-first-run-terminal.log`, SHA-256 `24c209ee12f86716f0d35a34c08b9f4ee5e77be25666cdca31d28dff5cd7520c`. It records Cypress child `exitCode: 0` and `close exitCode: 0`, one passing test in 19 seconds, and verified Core/Broker identity metadata. This falsifies a persistent local reproduction of the hosted Windows containment failure; it does not convert the hosted terminal failure into a pass or establish a platform/root cause.

## Owned HTTP proof

The fresh exact-head build ran the complete owned `tests/durable-lifecycle-http.test.js` suite once with distinct supported instance/host registry paths. The retained terminal log is `D:\projects\service-lasso\_review-runs\core1538-d349-packaged-win-20261001\qualification\durable-http-12-terminal.log`, SHA-256 `d0f0e7eae0af0f972d866555437b9e138d2e06a7910b466f4721aca1886b173f`.

It reports 12 tests, 12 pass, 0 fail, duration `100822.9588 ms`. The two #1538 cases passed: actual held-provider cross-process `update_check` cancellation plus confirmed `update_download` cancellation/redacted readback, and the cancellation-versus-concurrent-success terminal-precedence race. This is direct source/runtime evidence for #1538; it is not packaged Admin qualification.

## Evidence hygiene disposition

`git diff --check 93d9d343a058d296069c017d17f4f8d1fc1505ea..d349831eb84a5e61e61ee2da799fda77f664e91e` reports 2,028 whitespace findings. They are entirely committed historical evidence: `audit-evidence/continuation-20260930-1520/core1551-5115-windows-browser-failure.raw.log` (SHA-256 `8914e98777b1587500118bc563238fd17bfc3b49d1fe3bc138941de1fe2becac`) and `audit-evidence/continuation-20260930-1520/windows-artifact/packaged-admin-lifecycle-win32.json` (SHA-256 `9b23e9176beee76e41818d42e1a2381a17cfe0bdfdaa9e9518f543ab09999dc3`). The bytes are preserved unchanged. Their encoding/hygiene disposition is a reviewable PR evidence defect, not a basis to rewrite raw failed evidence or waive the failed browser gate.

## Next executable action

Obtain a separate full independent review of this complete candidate plus this handover. Keep #1326 and #1565 open until a bounded experiment establishes each failure's owning cause; any repair belongs on its own issue/spec-bound develop branch. Do not retry the failed provider workflow, weaken timeouts/concurrency/admission, modify released artifacts, or merge this PR on the basis of the local Windows nonreproduction.

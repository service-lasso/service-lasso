# Independent cumulative review: Core #1538 / PR #1551

## Decision at review time

**NO-GO for merge, release, publication, promotion, deployment, or GA.** This is not a source rejection of the #1538 HTTP operation contract. The candidate still has terminal failed packaged-Admin checks and incomplete required exact-head checks. No independent GA declaration is made.

## Identity and comparison

| Field | Verified value |
| --- | --- |
| Worktree | `D:\projects\service-lasso\_worktrees\core-1538-durable-http-updates` |
| Branch | `feature/1538-durable-http-update-cancellation` |
| Candidate | `d349831eb84a5e61e61ee2da799fda77f664e91e` |
| Candidate parents | `bb2c000d534d7cf970c07120fd281c5da48b6a6f`, `93d9d343a058d296069c017d17f4f8d1fc1505ea` |
| Current `develop` parent and comparison target | `93d9d343a058d296069c017d17f4f8d1fc1505ea` |
| Merge base | `02785268392318f14af3d0596df1ca5414957ce8` |
| PR | [#1551](https://github.com/service-lasso/service-lasso/pull/1551), open, target `develop`, exact head matches candidate |
| Issue | [#1538](https://github.com/service-lasso/service-lasso/issues/1538), open; child of #1465; mapped to `SPEC-006 AC-6F` |
| Scope inspected | Complete direct `93d9d343..d349831e` cumulative delta: 10 files, 1,414 insertions, 6 deletions; all #1538 commits through `5115a14`, `62c2b15`, `318a37e`, `bb2c000`, then current-develop integration `d349831e` |

The candidate worktree was clean throughout review. `git fsck --connectivity-only` completed without reported connectivity errors. No product files, provider settings, GitHub state, release artifacts, or retained application state were changed by this review.

## Requirement and source assessment

Issue #1538 requires public Core HTTP support for only `update_check` and `update_download`, with guarded admission, actor-scoped durable operations, actual supported cancellation, immutable replay claims, recovery/readback, metadata-only Audit, and redaction. The candidate adds those two actions to the lifecycle route mapping in `src/server/index.ts`; it keeps unsupported actions out of that public mapping.

Reviewed source and direct test coverage establish the following implementation claims:

- Guarded HTTP authorization derives actor/profile/scopes from validated transport identity. `update_download` uses the guarded confirmation preflight; `update_check` remains safely non-confirmed by its existing policy.
- The HTTP parser rejects duplicate JSON keys before durable claim/mutation. Preflight binds the same actor/client, confirmation, action/parameters, and immutable request fingerprint used by the guarded action journal.
- Durable records retain only safe operation fields. The review readback test checks actor isolation and absence of the temporary absolute path. Audit assertions require both cancellation and terminal `cancelled` events for each exercised update operation.
- `McpOperationService.cancel` persists `cancelling` under the durable state lock, aborts the local runner or waits for a live remote runner, and retains a concurrently committed guarded success rather than rewriting it as `cancelled`. The dedicated race test validates this terminal-success precedence.
- Actual held-provider HTTP requests are made and then aborted. The test covers one cross-process same-key `update_check` claim, a confirmed `update_download`, explicit foreign-actor `404` readback, supported cancellation, persisted terminal cancellation, duplicate-key rejection, and redacted readback.
- Existing tests cover restart reconciliation, complete guarded policy/profile/scope availability, changed immutable-context conflict, exact replay, `unsupported`, and `too_late` semantics. These are direct test evidence for the shared durable-operation boundary; the #1538 test directly covers the new update actions.

No source-level vulnerability, missing authorization boundary, unsupported-action advertisement, cancellation-state overwrite, or privacy leak was found in the inspected cumulative delta.

## Direct local runtime evidence

A fresh detached exact-HEAD worktree was created at `D:\projects\service-lasso\_review-runs\core1538-d349-http-20261001-1300` with a unique owned npm cache. It used normal `npm ci` with normal settings (no dry-run, package-lock-only, omitted dependencies, ignored scripts, or disabled bin links).

| Check | Result | Classification |
| --- | --- | --- |
| `npm ci` | exit 0; 1,417 packages installed; 0 reported vulnerabilities | direct local dependency proof |
| `npm run build` | exit 0; normal TypeScript build | direct local build proof |
| First full `tests/durable-lifecycle-http.test.js` run | exit 1: 8/12 passed; all 2 #1538 tests passed | preserved environment failure, not a full pass |
| Isolated full `tests/durable-lifecycle-http.test.js` run | exit 0; 12/12 passed in 94.342 s | direct local HTTP runtime proof |

The first full-suite failure was consistently `Host registry file exceeds the bounded size.` at runtime registration, affecting four non-#1538 lifecycle cases. It used the pre-existing shared host registry and was not retried or deleted. The successful isolated run used only the supported test/runtime configuration inputs `SERVICE_LASSO_INSTANCE_REGISTRY_PATH` and `SERVICE_LASSO_HOST_PORT_REGISTRY_PATH`, both under the fresh reviewer-owned run directory. This prevents host-state interference without altering application semantics, source, compilers, test assertions, timeouts, or safety policy.

## Provider evidence

Historical failure was inspected and preserved distinctly from current evidence:

- MCP Product Acceptance job `110138925372` on `bb2c000...` failed at `Verify fresh-consumer packaged MCP and canonical action`; its aggregate `110142331573` therefore failed. It does not qualify `d349831e`.
- The candidate's current source conformance and Release Qualification packaged MCP rows are exact-head evidence; historical green or failed work was not promoted into an exact-head conclusion.

At the final live readback, current exact-head runs were:

| Workflow/run | Exact head state | Review treatment |
| --- | --- | --- |
| MCP Product Acceptance `36864114961` | source conformance and all three packaged platform jobs succeeded; aggregate `require-mcp-product-acceptance` is queued | incomplete; no aggregate pass |
| Release Qualification `36864115042` | MCP source and Linux/macOS/Windows packaged MCP success; Broker IPC Linux/Windows success; `qualify-products` still running | incomplete; no release-qualification pass |
| Packaged Admin Lifecycle `36864114774` | macOS and Windows failed at `Drive released Admin lifecycle browser contracts`; Linux still running | terminal failures are blockers; root cause unclassified until terminal workflow logs are available |

CodeQL, dependency review, release-governance validation, docs build, baseline start smoke, endpoint allocation, runtime-generation lanes, and lifecycle process-tree rows were successful at the same readback. Those successes do not replace the pending/failed gates above.

## Cumulative quality finding

`git diff --check 93d9d343..d349831e` reports 2,028 whitespace findings, all in committed historical evidence: [raw Windows browser failure log](../continuation-20260930-1520/core1551-5115-windows-browser-failure.raw.log) lines 1-974 and [metadata artifact](../continuation-20260930-1520/windows-artifact/packaged-admin-lifecycle-win32.json) lines 1-40. This is a diff-hygiene defect in the cumulative PR, though normalizing the raw log during review would alter retained failure evidence. Track a disposition for the evidence encoding/attributes separately; it is not evidence that the #1538 runtime contract is broken.

## Handover

The next executable action is to wait for the three current exact-head workflow aggregates to become terminal, retrieve their terminal logs/artifacts without rerunning them, and classify the two packaged-Admin browser failures by direct evidence. If all required current runs become successful and the evidence artifact readbacks apply to `d349831e`, request the separately required independent review/merge decision. Do not merge, publish, promote, deploy, or declare GA from this report.

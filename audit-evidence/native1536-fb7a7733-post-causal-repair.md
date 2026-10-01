# Post-causal repair

Started: 2026-10-02T01:39:01.3238047+10:00
Branch: fix/1535-same-held-command-query
HEAD: fb7a773341336221b5d69ade385435eda2caa12e
Tree: d8a769b2afbcb1c8c2ec75681fa2988b853a753a
WorkspaceRoot: C:\Users\MAXBAR~1\AppData\Local\Temp\service-lasso-1536-a31c6cd3f4d94dd88d73c6b87d2cc02f\workspace
InstanceRegistry: C:\Users\MAXBAR~1\AppData\Local\Temp\service-lasso-1536-a31c6cd3f4d94dd88d73c6b87d2cc02f\instances.json
HostPortRegistry: C:\Users\MAXBAR~1\AppData\Local\Temp\service-lasso-1536-a31c6cd3f4d94dd88d73c6b87d2cc02f\ports.json

## Build

> service-lasso@0.1.0 build
> tsc -p tsconfig.json && node scripts/copy-runtime-assets.mjs

Build exit: 0
## Sequence test
TAP version 13
# Subtest: Windows managed terminal monitor keeps root-exit finalization in the same native inspection episode
ok 1 - Windows managed terminal monitor keeps root-exit finalization in the same native inspection episode
  ---
  duration_ms: 6213.9303
  type: 'test'
  ...
# Subtest: Windows public HTTP stop starts a fresh native inspection episode after a terminal monitor refresh
ok 2 - Windows public HTTP stop starts a fresh native inspection episode after a terminal monitor refresh
  ---
  duration_ms: 11042.8815
  type: 'test'
  ...
# Subtest: Windows public HTTP stop consumes a terminal root-exit finalizer only after its fresh inspection episode
not ok 3 - Windows public HTTP stop consumes a terminal root-exit finalizer only after its fresh inspection episode
  ---
  duration_ms: 7340.7128
  type: 'test'
  location: 'D:\\projects\\service-lasso\\_worktrees\\issue-1535-same-held-command-query\\tests\\process-ownership.test.js:3890:1'
  failureType: 'testCodeFailure'
  error: 'Managed process finalization failed: service "public-stop-terminal-finalizer-service" (pid 91636, phase finalize, code FINALIZATION_DID_NOT_CONVERGE).'
  code: 'ERR_TEST_FAILURE'
  name: 'ManagedProcessFinalizationError'
  stack: |-
    stopAllManagedProcesses (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/runtime/execution/supervisor.js:2080:15)
    async file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6726:13
    async Object.stop (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6736:9)
    async TestContext.<anonymous> (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/tests/process-ownership.test.js:3951:5)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...

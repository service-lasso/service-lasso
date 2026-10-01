# Post-repair terminal finalizer sequence

Started: 2026-10-02T01:37:22.4422091+10:00
Branch: fix/1535-same-held-command-query
HEAD: fb7a773341336221b5d69ade385435eda2caa12e
Tree: d8a769b2afbcb1c8c2ec75681fa2988b853a753a
WorkspaceRoot: C:\Users\MAXBAR~1\AppData\Local\Temp\service-lasso-1536-d5b9908c93e44591bc972ea9f9fea29a\workspace
InstanceRegistry: C:\Users\MAXBAR~1\AppData\Local\Temp\service-lasso-1536-d5b9908c93e44591bc972ea9f9fea29a\instances.json
HostPortRegistry: C:\Users\MAXBAR~1\AppData\Local\Temp\service-lasso-1536-d5b9908c93e44591bc972ea9f9fea29a\ports.json

## Build

> service-lasso@0.1.0 build
> tsc -p tsconfig.json && node scripts/copy-runtime-assets.mjs

Build exit: 0
## Sequence test
TAP version 13
# Subtest: Windows adopted monitor retains a real terminal tree refresh through shutdown
ok 1 - Windows adopted monitor retains a real terminal tree refresh through shutdown
  ---
  duration_ms: 7718.6581
  type: 'test'
  ...
# Subtest: Windows explicit adopted stop starts a new real tree inspection episode after a terminal monitor refresh
ok 2 - Windows explicit adopted stop starts a new real tree inspection episode after a terminal monitor refresh
  ---
  duration_ms: 8232.3314
  type: 'test'
  ...
# Subtest: Windows managed terminal monitor keeps stopAll in the same native inspection episode
ok 3 - Windows managed terminal monitor keeps stopAll in the same native inspection episode
  ---
  duration_ms: 16578.3043
  type: 'test'
  ...
# Subtest: Windows managed terminal monitor keeps root-exit finalization in the same native inspection episode
not ok 4 - Windows managed terminal monitor keeps root-exit finalization in the same native inspection episode
  ---
  duration_ms: 10379.7355
  type: 'test'
  location: 'D:\\projects\\service-lasso\\_worktrees\\issue-1535-same-held-command-query\\tests\\process-ownership.test.js:3702:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:

    true !== false

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: false
  actual: true
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/tests/process-ownership.test.js:3760:12)
    process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: Windows explicit managed stop starts a fresh native inspection episode after a terminal monitor refresh
ok 5 - Windows explicit managed stop starts a fresh native inspection episode after a terminal monitor refresh
  ---
  duration_ms: 9632.6446
  type: 'test'
  ...
# Subtest: Windows public HTTP stop starts a fresh native inspection episode after a terminal monitor refresh
not ok 6 - Windows public HTTP stop starts a fresh native inspection episode after a terminal monitor refresh
  ---
  duration_ms: 10431.0624
  type: 'test'
  location: 'D:\\projects\\service-lasso\\_worktrees\\issue-1535-same-held-command-query\\tests\\process-ownership.test.js:3834:1'
  failureType: 'testCodeFailure'
  error: 'Managed process finalization failed: service "managed-terminal-finalizer-service" (pid 63000, phase finalize, code FINALIZATION_DID_NOT_CONVERGE).'
  code: 'ERR_TEST_FAILURE'
  name: 'ManagedProcessFinalizationError'
  stack: |-
    stopAllManagedProcesses (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/runtime/execution/supervisor.js:2067:15)
    async file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6726:13
    async Object.stop (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6736:9)
    async TestContext.<anonymous> (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/tests/process-ownership.test.js:3879:5)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: Windows public HTTP stop consumes a terminal root-exit finalizer only after its fresh inspection episode
not ok 7 - Windows public HTTP stop consumes a terminal root-exit finalizer only after its fresh inspection episode
  ---
  duration_ms: 6608.6661
  type: 'test'
  location: 'D:\\projects\\service-lasso\\_worktrees\\issue-1535-same-held-command-query\\tests\\process-ownership.test.js:3890:1'
  failureType: 'testCodeFailure'
  error: 'Managed process finalization failed: service "managed-terminal-finalizer-service" (pid 63000, phase finalize, code FINALIZATION_DID_NOT_CONVERGE).'
  code: 'ERR_TEST_FAILURE'
  name: 'ManagedProcessFinalizationError'
  stack: |-
    stopAllManagedProcesses (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/runtime/execution/supervisor.js:2067:15)
    async file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6726:13
    async Object.stop (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6736:9)
    async TestContext.<anonymous> (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/tests/process-ownership.test.js:3951:5)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# {"kind":"lifecycle-failure","httpStatus":409,"attemptStatus":"failed","events":[{"phase":"dependency_resolution","status":"completed","failurePhase":null},{"phase":"port_selection","status":"completed","failurePhase":null},{"phase":"artifact_acquisition","status":"completed","failurePhase":null},{"phase":"env_merge","status":"completed","failurePhase":null},{"phase":"process_spawn","status":"failed","failurePhase":"post_release_hook"},{"phase":"terminal_outcome","status":"failed","failurePhase":null}],"failurePhases":[],"deadlineExceeded":false}
# Subtest: API preserves and can stop truthful running state after enrollment containment fails
not ok 8 - API preserves and can stop truthful running state after enrollment containment fails
  ---
  duration_ms: 4407.9507
  type: 'test'
  location: 'D:\\projects\\service-lasso\\_worktrees\\issue-1535-same-held-command-query\\tests\\process-ownership.test.js:3963:1'
  failureType: 'testCodeFailure'
  error: 'Managed process finalization failed: service "managed-terminal-finalizer-service" (pid 63000, phase finalize, code FINALIZATION_DID_NOT_CONVERGE).'
  code: 'ERR_TEST_FAILURE'
  name: 'ManagedProcessFinalizationError'
  stack: |-
    stopAllManagedProcesses (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/runtime/execution/supervisor.js:2067:15)
    async file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6726:13
    async Object.stop (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6736:9)
    async TestContext.<anonymous> (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/tests/process-ownership.test.js:4021:5)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: API restart preserves and can stop truthful replacement state after enrollment containment fails
not ok 9 - API restart preserves and can stop truthful replacement state after enrollment containment fails
  ---
  duration_ms: 9232.8517
  type: 'test'
  location: 'D:\\projects\\service-lasso\\_worktrees\\issue-1535-same-held-command-query\\tests\\process-ownership.test.js:4030:1'
  failureType: 'testCodeFailure'
  error: 'Managed process finalization failed: service "managed-terminal-finalizer-service" (pid 63000, phase finalize, code FINALIZATION_DID_NOT_CONVERGE).'
  code: 'ERR_TEST_FAILURE'
  name: 'ManagedProcessFinalizationError'
  stack: |-
    stopAllManagedProcesses (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/runtime/execution/supervisor.js:2067:15)
    async file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6726:13
    async Object.stop (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6736:9)
    async TestContext.<anonymous> (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/tests/process-ownership.test.js:4097:5)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...

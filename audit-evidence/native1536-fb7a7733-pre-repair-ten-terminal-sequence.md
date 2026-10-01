# Pre-repair ten-test terminal sequence

Started: 2026-10-02T01:34:24.6456488+10:00
Branch: fix/1535-same-held-command-query
HEAD: fb7a773341336221b5d69ade385435eda2caa12e
Tree: d8a769b2afbcb1c8c2ec75681fa2988b853a753a
WorkspaceRoot: C:\Users\MAXBAR~1\AppData\Local\Temp\service-lasso-1536-4f856ee661d34616a9ca5410e8ec1caa\workspace
InstanceRegistry: C:\Users\MAXBAR~1\AppData\Local\Temp\service-lasso-1536-4f856ee661d34616a9ca5410e8ec1caa\instances.json
HostPortRegistry: C:\Users\MAXBAR~1\AppData\Local\Temp\service-lasso-1536-4f856ee661d34616a9ca5410e8ec1caa\ports.json

## Test
TAP version 13
# Subtest: Windows persistent partial native command query fails before the startup hook
not ok 1 - Windows persistent partial native command query fails before the startup hook
  ---
  duration_ms: 440.3266
  type: 'test'
  location: 'D:\\projects\\service-lasso\\_worktrees\\issue-1535-same-held-command-query\\tests\\process-ownership.test.js:3419:1'
  failureType: 'testCodeFailure'
  error: 'Cannot verify workspace lifecycle lock owner: windows_process_command_partial_copy_exhausted'
  code: 'ERR_TEST_FAILURE'
  stack: |-
    file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/runtime/process/registry.js:35:19
    process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    async resolveWorkspaceLockOwnerIdentity (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/runtime/process/registry.js:41:16)
    async acquireWorkspaceLifecycleLock (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/runtime/process/registry.js:297:27)
    async withWorkspaceLifecycleLock (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/runtime/process/registry.js:374:21)
    async beginRuntimeGeneration (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/runtime/instance/registry.js:429:12)
    async startApiServerInternal (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6207:26)
    async startApiServer (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6061:12)
    async TestContext.<anonymous> (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/tests/process-ownership.test.js:3436:17)
    async Test.run (node:internal/test_runner/test:1054:7)
  ...
# Subtest: Windows adopted monitor retains a real terminal tree refresh through shutdown
ok 2 - Windows adopted monitor retains a real terminal tree refresh through shutdown
  ---
  duration_ms: 7495.458
  type: 'test'
  ...
# Subtest: Windows explicit adopted stop starts a new real tree inspection episode after a terminal monitor refresh
ok 3 - Windows explicit adopted stop starts a new real tree inspection episode after a terminal monitor refresh
  ---
  duration_ms: 8263.0153
  type: 'test'
  ...
# Subtest: Windows managed terminal monitor keeps stopAll in the same native inspection episode
ok 4 - Windows managed terminal monitor keeps stopAll in the same native inspection episode
  ---
  duration_ms: 10856.5964
  type: 'test'
  ...
# Subtest: Windows managed terminal monitor keeps root-exit finalization in the same native inspection episode
ok 5 - Windows managed terminal monitor keeps root-exit finalization in the same native inspection episode
  ---
  duration_ms: 12847.078
  type: 'test'
  ...
# Subtest: Windows explicit managed stop starts a fresh native inspection episode after a terminal monitor refresh
ok 6 - Windows explicit managed stop starts a fresh native inspection episode after a terminal monitor refresh
  ---
  duration_ms: 12658.7465
  type: 'test'
  ...
# Subtest: Windows public HTTP stop starts a fresh native inspection episode after a terminal monitor refresh
not ok 7 - Windows public HTTP stop starts a fresh native inspection episode after a terminal monitor refresh
  ---
  duration_ms: 10819.8283
  type: 'test'
  location: 'D:\\projects\\service-lasso\\_worktrees\\issue-1535-same-held-command-query\\tests\\process-ownership.test.js:3826:1'
  failureType: 'testCodeFailure'
  error: 'Managed process finalization failed: service "managed-terminal-finalizer-service" (pid 39400, phase finalize, code FINALIZATION_DID_NOT_CONVERGE).'
  code: 'ERR_TEST_FAILURE'
  name: 'ManagedProcessFinalizationError'
  stack: |-
    stopAllManagedProcesses (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/runtime/execution/supervisor.js:2067:15)
    async file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6726:13
    async Object.stop (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6736:9)
    async TestContext.<anonymous> (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/tests/process-ownership.test.js:3871:5)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: Windows public HTTP stop consumes a terminal root-exit finalizer only after its fresh inspection episode
not ok 8 - Windows public HTTP stop consumes a terminal root-exit finalizer only after its fresh inspection episode
  ---
  duration_ms: 9081.8842
  type: 'test'
  location: 'D:\\projects\\service-lasso\\_worktrees\\issue-1535-same-held-command-query\\tests\\process-ownership.test.js:3882:1'
  failureType: 'testCodeFailure'
  error: 'Managed process finalization failed: service "managed-terminal-finalizer-service" (pid 39400, phase finalize, code FINALIZATION_DID_NOT_CONVERGE).'
  code: 'ERR_TEST_FAILURE'
  name: 'ManagedProcessFinalizationError'
  stack: |-
    stopAllManagedProcesses (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/runtime/execution/supervisor.js:2067:15)
    async file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6726:13
    async Object.stop (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6736:9)
    async TestContext.<anonymous> (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/tests/process-ownership.test.js:3943:5)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# {"kind":"lifecycle-failure","httpStatus":409,"attemptStatus":"failed","events":[{"phase":"dependency_resolution","status":"completed","failurePhase":null},{"phase":"port_selection","status":"completed","failurePhase":null},{"phase":"artifact_acquisition","status":"completed","failurePhase":null},{"phase":"env_merge","status":"completed","failurePhase":null},{"phase":"process_spawn","status":"failed","failurePhase":"post_release_hook"},{"phase":"terminal_outcome","status":"failed","failurePhase":null}],"failurePhases":[],"deadlineExceeded":false}
# Subtest: API preserves and can stop truthful running state after enrollment containment fails
not ok 9 - API preserves and can stop truthful running state after enrollment containment fails
  ---
  duration_ms: 10646.4754
  type: 'test'
  location: 'D:\\projects\\service-lasso\\_worktrees\\issue-1535-same-held-command-query\\tests\\process-ownership.test.js:3955:1'
  failureType: 'testCodeFailure'
  error: 'Managed process finalization failed: service "managed-terminal-finalizer-service" (pid 39400, phase finalize, code FINALIZATION_DID_NOT_CONVERGE).'
  code: 'ERR_TEST_FAILURE'
  name: 'ManagedProcessFinalizationError'
  stack: |-
    stopAllManagedProcesses (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/runtime/execution/supervisor.js:2067:15)
    async file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6726:13
    async Object.stop (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6736:9)
    async TestContext.<anonymous> (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/tests/process-ownership.test.js:4013:5)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: API restart preserves and can stop truthful replacement state after enrollment containment fails
not ok 10 - API restart preserves and can stop truthful replacement state after enrollment containment fails
  ---
  duration_ms: 18191.9676
  type: 'test'
  location: 'D:\\projects\\service-lasso\\_worktrees\\issue-1535-same-held-command-query\\tests\\process-ownership.test.js:4022:1'
  failureType: 'testCodeFailure'
  error: 'Managed process finalization failed: service "managed-terminal-finalizer-service" (pid 39400, phase finalize, code FINALIZATION_DID_NOT_CONVERGE).'
  code: 'ERR_TEST_FAILURE'
  name: 'ManagedProcessFinalizationError'
  stack: |-
    stopAllManagedProcesses (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/runtime/execution/supervisor.js:2067:15)
    async file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6726:13
    async Object.stop (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/server/index.js:6736:9)
    async TestContext.<anonymous> (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/tests/process-ownership.test.js:4089:5)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...

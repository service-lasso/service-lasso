# #1536 owned full-suite live receipt

- Candidate head: `fb7a773341336221b5d69ade385435eda2caa12e`.
- Command: `npm test`.
- Dedicated inputs: `%TEMP%\\service-lasso-1535-fb7a7733-full\\workspace`, `%TEMP%\\service-lasso-1535-fb7a7733-full\\registries\\instances.json`, and `%TEMP%\\service-lasso-1535-fb7a7733-full\\registries\\ports.json`.
- Handle: `70137`; this receipt is appended while that one process remains live.
- Capture began after the invocation. Earlier raw chunks remain only in this task's tool outputs and are not reconstructed here. No second run was started.
- This is a live record, not a terminal result. It has no exit status or TAP summary yet.

## Raw chunk `e65fe0`

```text
# Subtest: operator action queue is available through API and CLI
ok 585 - operator action queue is available through API and CLI
  ---
  duration_ms: 4188.7773
  type: 'test'
  ...
# Subtest: operator command confirmations issue and confirm with the same trusted chat actor
ok 586 - operator command confirmations issue and confirm with the same trusted chat actor
  ---
  duration_ms: 1225.7963
  type: 'test'
  ...
# Subtest: operator command confirmations execute a confirmed mutation once
ok 587 - operator command confirmations execute a confirmed mutation once
  ---
  duration_ms: 575.5064
  type: 'test'
  ...
# Subtest: operator command confirmations reject execution when the confirmed plan changes
ok 588 - operator command confirmations reject execution when the confirmed plan changes
  ---
  duration_ms: 587.1816
  type: 'test'
  ...
# Subtest: operator command confirmations reject execution when actor or capability state changes
ok 589 - operator command confirmations reject execution when actor or capability state changes
  ---
  duration_ms: 606.0959
  type: 'test'
  ...
# Subtest: operator command confirmations deny actor mismatch and capability drift
ok 590 - operator command confirmations deny actor mismatch and capability drift
  ---
  duration_ms: 533.1911
  type: 'test'
  ...
```

The tool response for this chunk was truncated after test 604. This file records only the displayed bytes, without inferring omitted content.

## Raw chunk `333d9e`

```text
# Subtest: runtime logs archive previous runs and enforce bounded retention
ok 605 - runtime logs archive previous runs and enforce bounded retention
  ---
  duration_ms: 40602.791
  type: 'test'
  ...
# Subtest: service metrics surface persisted process evidence and survive runtime restart
ok 606 - service metrics surface persisted process evidence and survive runtime restart
  ---
  duration_ms: 2958.3573
  type: 'test'
  ...
# Subtest: GET /api/services/:id/variables returns manifest and derived variables
ok 607 - GET /api/services/:id/variables returns manifest and derived variables
  ---
  duration_ms: 827.7616
  type: 'test'
  ...
# Subtest: runtime-captured output variables satisfy healthchecks and API variable scope
ok 608 - runtime-captured output variables satisfy healthchecks and API variable scope
  ---
  duration_ms: 5134.1918
  type: 'test'
  ...
# Subtest: runtime-captured output variables satisfy canonical healthchecks arrays
ok 609 - runtime-captured output variables satisfy canonical healthchecks arrays
  ---
  duration_ms: 5445.2625
  type: 'test'
  ...
# Subtest: GET /api/globalenv returns the merged bounded shared env map
ok 610 - GET /api/globalenv returns the merged bounded shared env map
  ---
  duration_ms: 899.0194
  type: 'test'
  ...
# Subtest: provider globalenv can resolve installed artifact command variables
ok 611 - provider globalenv can resolve installed artifact command variables
  ---
  duration_ms: 657.6439
  type: 'test'
  ...
```

## Raw chunk `760169`

```text
# Subtest: service variables include merged globalenv entries and managed processes receive them
ok 612 - service variables include merged globalenv entries and managed processes receive them
  ---
  duration_ms: 5438.2866
  type: 'test'
  ...
# Subtest: GET /api/services/:id/network returns operator network endpoints
ok 613 - GET /api/services/:id/network returns operator network endpoints
  ---
  duration_ms: 1142.899
  type: 'test'
  ...
# Subtest: GET /api/services/:id/network resolves manifest portmapping
ok 614 - GET /api/services/:id/network resolves manifest portmapping
  ---
  duration_ms: 952.4177
  type: 'test'
  ...
# Subtest: config negotiates colliding ports deterministically and surfaces resolved network endpoints
ok 615 - config negotiates colliding ports deterministically and surfaces resolved network endpoints
  ---
  duration_ms: 1312.7257
  type: 'test'
  ...
# Subtest: managed processes receive negotiated port env values
ok 616 - managed processes receive negotiated port env values
  ---
  duration_ms: 6704.8106
  type: 'test'
  ...
# Subtest: GET /api/variables and /api/network aggregate operator surfaces across services
ok 617 - GET /api/variables and /api/network aggregate operator surfaces across services
  ---
  duration_ms: 1116.1407
  type: 'test'
  ...
# Subtest: inbox emit system producer records first-run setup without poll storms
ok 618 - inbox emit system producer records first-run setup without poll storms
  ---
  duration_ms: 27.0326
  type: 'test'
  ...
```

The tool response for this chunk was truncated after test 636. This file records only the displayed bytes, without inferring omitted content.

## Raw chunk `16ddf5`

```text
# Subtest: #862 records safe terminal failures and preflight skips without repeating mutation
ok 637 - #862 records safe terminal failures and preflight skips without repeating mutation
  ---
  duration_ms: 8123.8928
  type: 'test'
  ...
# Subtest: #862 durably reconciles a terminal Audit outage without repeating mutation
ok 638 - #862 durably reconciles a terminal Audit outage without repeating mutation
  ---
  duration_ms: 2474.5452
  type: 'test'
  ...
# Subtest: #862 denies wrong modes, profiles, and scopes before mutation with stable Audit outcomes
ok 639 - #862 denies wrong modes, profiles, and scopes before mutation with stable Audit outcomes
  ---
  duration_ms: 339.7275
  type: 'test'
  ...
# Subtest: #862 redacts secrets and paths from plans, results, durable state, and Audit
ok 640 - #862 redacts secrets and paths from plans, results, durable state, and Audit
  ---
  duration_ms: 3875.0041
  type: 'test'
  ...
# Subtest: #862 advertises only explicit strict guarded tools and executes them through the injected facade
ok 641 - #862 advertises only explicit strict guarded tools and executes them through the injected facade
  ---
  duration_ms: 3046.5174
  type: 'test'
  ...
```

## Raw chunk `ec9fe9`

```text
# Subtest: #862 HTTP guarded lifecycle actions use the active runtime dependency and orchestration facade
ok 642 - #862 HTTP guarded lifecycle actions use the active runtime dependency and orchestration facade
  ---
  duration_ms: 88306.5411
  type: 'test'
  ...
# Subtest: #860 protects Streamable HTTP with OAuth discovery, trusted identity, scopes, and content boundaries
ok 643 - #860 protects Streamable HTTP with OAuth discovery, trusted identity, scopes, and content boundaries
  ---
  duration_ms: 1125.6126
  type: 'test'
  ...
```

## Raw chunk `5def3e`

```text
# Subtest: #860 keeps unconfigured MCP loopback-local and rejects remote identity spoofing
ok 644 - #860 keeps unconfigured MCP loopback-local and rejects remote identity spoofing
  ---
  duration_ms: 451.7437
  type: 'test'
  ...
# Subtest: #860 fails closed when only part of the MCP OAuth configuration is present
ok 645 - #860 fails closed when only part of the MCP OAuth configuration is present
  ---
  duration_ms: 423.0885
  type: 'test'
  ...
# Subtest: #860 rejects hostname lookalikes as insecure JWKS endpoints
ok 646 - #860 rejects hostname lookalikes as insecure JWKS endpoints
  ---
  duration_ms: 0.4585
  type: 'test'
  ...
# Subtest: #860 resolves explicit MCP modes, cumulative permission profiles, and bounded rate configuration
ok 647 - #860 resolves explicit MCP modes, cumulative permission profiles, and bounded rate configuration
  ---
  duration_ms: 0.2417
  type: 'test'
  ...
# Subtest: #860 enforces guarded-mode profile evidence plus independent actor and client rate limits
ok 648 - #860 enforces guarded-mode profile evidence plus independent actor and client rate limits
  ---
  duration_ms: 329.39
  type: 'test'
  ...
```

The tool response for this chunk was truncated after test 657. This file records only the displayed bytes, without inferring omitted content.

## Raw chunk `a5c7f7`

```text
# Subtest: #1465 cross-process durable claim atomically replays matching requests and rejects altered requests
ok 658 - #1465 cross-process durable claim atomically replays matching requests and rejects altered requests
  ---
  duration_ms: 4667.9673
  type: 'test'
  ...
# Subtest: #863 one coalesced workspace heartbeat keeps concurrent operation runners live
ok 659 - #863 one coalesced workspace heartbeat keeps concurrent operation runners live
  ---
  duration_ms: 10708.5106
  type: 'test'
  ...
# Subtest: #863 production provider and download aborts cancel durably without false failure or candidate state
ok 660 - #863 production provider and download aborts cancel durably without false failure or candidate state
  ---
  duration_ms: 3236.8337
  type: 'test'
  ...
# Subtest: #863 actor/workspace isolation fails closed while Administrator inspection is explicit
ok 661 - #863 actor/workspace isolation fails closed while Administrator inspection is explicit
  ---
  duration_ms: 3547.0681
  type: 'test'
  ...
# Subtest: #863 guarded authorization is decided before any durable operation is created
ok 662 - #863 guarded authorization is decided before any durable operation is created
  ---
  duration_ms: 28.8113
  type: 'test'
  ...
```

The tool response for this chunk was truncated after test 671. This file records only the displayed bytes, without inferring omitted content.

## Raw chunk `117981`

```text
# Subtest: MCP endpoint advertises read-only operator tools and resources
ok 672 - MCP endpoint advertises read-only operator tools and resources
  ---
  duration_ms: 1758.7037
  type: 'test'
  ...
# Subtest: MCP tool calls return redacted log summaries and sanitized routes
ok 673 - MCP tool calls return redacted log summaries and sanitized routes
  ---
  duration_ms: 1158.5514
  type: 'test'
  ...
# Subtest: MCP secret metadata returns refs, assignment, and rotation without secret values
ok 674 - MCP secret metadata returns refs, assignment, and rotation without secret values
  ---
  duration_ms: 1041.0639
  type: 'test'
  ...
# Subtest: operator notifications merge update recovery lifecycle health and diagnostic items safely
ok 675 - operator notifications merge update recovery lifecycle health and diagnostic items safely
  ---
  duration_ms: 1018.4985
  type: 'test'
  ...
# Subtest: operator notifications return update availability and install deferral action endpoints
ok 676 - operator notifications return update availability and install deferral action endpoints
  ---
  duration_ms: 739.2564
  type: 'test'
  ...
```

## Raw chunk `f98ab3`

```text
# Subtest: workflow-projected metadata token stages package, normal, and bundled artifacts through closed fixture routes
ok 678 - workflow-projected metadata token stages package, normal, and bundled artifacts through closed fixture routes
  ---
  duration_ms: 50467.4504
  type: 'test'
  ...
# Subtest: operator tools stage only checksum-verified release bytes
ok 679 - operator tools stage only checksum-verified release bytes
  ---
  duration_ms: 61.1203
  type: 'test'
  ...
# Subtest: operator tool identity rejects incomplete platform inventory
ok 680 - operator tool identity rejects incomplete platform inventory
  ---
  duration_ms: 0.7887
  type: 'test'
  ...
# Subtest: release metadata token is consumed and removed before child work
ok 681 - release metadata token is consumed and removed before child work
  ---
  duration_ms: 0.2271
  type: 'test'
  ...
```

The tool response for this chunk was truncated after test 752. This file records only the displayed bytes, without inferring omitted content.

## Raw chunk `7d0aee`

```text
# Subtest: API startup clears a reused PID and starts a replacement without touching the unrelated process
ok 753 - API startup clears a reused PID and starts a replacement without touching the unrelated process
  ---
  duration_ms: 5224.6605
  type: 'test'
  ...
# Subtest: rehydration returns adopted running state with retained ports
ok 754 - rehydration returns adopted running state with retained ports
  ---
  duration_ms: 936.493
  type: 'test'
  ...
# Subtest: rehydration records a safe blocker for unverifiable persisted process owners
ok 755 - rehydration records a safe blocker for unverifiable persisted process owners
  ---
  duration_ms: 78.6597
  type: 'test'
  ...
# Subtest: API restart replaces an adopted persisted process and keeps retained ports
ok 756 - API restart replaces an adopted persisted process and keeps retained ports
  ---
  duration_ms: 7471.6988
  type: 'test'
  ...
```

This tool response was truncated across a stack trace between displayed tests 760 and 767. The omitted bytes are not reconstructed; until terminal TAP, this chunk cannot establish a pass.

## Raw chunk `dbae86`

```text
# Subtest: Windows managed launcher round-trips empty, quoted, spaced, trailing-slash, and Unicode arguments
ok 773 - Windows managed launcher round-trips empty, quoted, spaced, trailing-slash, and Unicode arguments
  ---
  duration_ms: 3560.1822
  type: 'test'
  ...
# Subtest: Windows managed launcher strips loader controls from bootstrap and restores them only for the target
ok 774 - Windows managed launcher strips loader controls from bootstrap and restores them only for the target
  ---
  duration_ms: 3777.203
  type: 'test'
  ...
# Subtest: Windows managed launcher rejects same-size approved script changes after guarded preflight
ok 775 - Windows managed launcher rejects same-size approved script changes after guarded preflight
  ---
  duration_ms: 926.9121
  type: 'test'
  ...
# Subtest: Windows managed launcher holds approved files through post-resume acknowledgment failure containment
ok 776 - Windows managed launcher holds approved files through post-resume acknowledgment failure containment
  ---
  duration_ms: 2019.4537
  type: 'test'
  ...
# Subtest: Windows acknowledgement containment retains launching when the final tree reveals a live descendant
ok 777 - Windows acknowledgement containment retains launching when the final tree reveals a live descendant
  ---
  duration_ms: 4363.5391
  type: 'test'
  ...
```

The tool response for this chunk ended at displayed test 788; only the displayed bytes above are appended.

## Raw chunk `f57657`

```text
# Subtest: Windows explicit adopted stop starts a new real tree inspection episode after a terminal monitor refresh
ok 789 - Windows explicit adopted stop starts a new real tree inspection episode after a terminal monitor refresh
  ---
  duration_ms: 7456.8271
  type: 'test'
  ...
# Subtest: Windows managed terminal monitor keeps stopAll in the same native inspection episode
ok 790 - Windows managed terminal monitor keeps stopAll in the same native inspection episode
  ---
  duration_ms: 9724.0482
  type: 'test'
  ...
# Subtest: Windows managed terminal monitor keeps root-exit finalization in the same native inspection episode
ok 791 - Windows managed terminal monitor keeps root-exit finalization in the same native inspection episode
  ---
  duration_ms: 6033.1547
  type: 'test'
  ...
# Subtest: Windows explicit managed stop starts a fresh native inspection episode after a terminal monitor refresh
ok 792 - Windows explicit managed stop starts a fresh native inspection episode after a terminal monitor refresh
  ---
  duration_ms: 10254.4385
  type: 'test'
  ...
# Subtest: Windows public HTTP stop starts a fresh native inspection episode after a terminal monitor refresh
not ok 793 - Windows public HTTP stop starts a fresh native inspection episode after a terminal monitor refresh
  ---
  duration_ms: 9815.3827
  type: 'test'
  location: 'D:\\projects\\service-lasso\\_worktrees\\issue-1535-same-held-command-query\\tests\\process-ownership.test.js:3826:1'
  failureType: 'testCodeFailure'
  error: 'Managed process finalization failed: service "managed-terminal-finalizer-service" (pid 83372, phase finalize, code FINALIZATION_DID_NOT_CONVERGE).'
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
```

## Raw chunk `e14ff0`

```text
# Subtest: Windows public HTTP stop consumes a terminal root-exit finalizer only after its fresh inspection episode
not ok 794 - Windows public HTTP stop consumes a terminal root-exit finalizer only after its fresh inspection episode
  ---
  duration_ms: 6650.7208
  type: 'test'
  location: 'D:\\projects\\service-lasso\\_worktrees\\issue-1535-same-held-command-query\\tests\\process-ownership.test.js:3882:1'
  failureType: 'testCodeFailure'
  error: 'Managed process finalization failed: service "managed-terminal-finalizer-service" (pid 83372, phase finalize, code FINALIZATION_DID_NOT_CONVERGE).'
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
# Subtest: API preserves and can stop truthful running state after enrollment containment fails
not ok 795 - API preserves and can stop truthful running state after enrollment containment fails
  ---
  duration_ms: 4596.8846
  type: 'test'
  ...
# Subtest: API restart preserves and can stop truthful replacement state after enrollment containment fails
not ok 796 - API restart preserves and can stop truthful replacement state after enrollment containment fails
  ---
  duration_ms: 8230.0169
  type: 'test'
  ...
# Subtest: API restart persists stopped state when ordinary replacement enrollment fails
not ok 797 - API restart persists stopped state when ordinary replacement enrollment fails
  ---
  duration_ms: 5954.3091
  type: 'test'
  ...
# Subtest: managed unexpected root exit terminates the remaining verified process tree
ok 798 - managed unexpected root exit terminates the remaining verified process tree
  ---
  duration_ms: 1384.2461
  type: 'test'
  ...
# Subtest: managed Windows job contains a child spawned after enrollment when the service root exits before refresh
ok 799 - managed Windows job contains a child spawned after enrollment when the service root exits before refresh
  ---
  duration_ms: 2069.5245
  type: 'test'
  ...
```

## Raw chunk `9d77a9`

```text
# Subtest: managed Windows root auto-exit contains its verified child and grandchild process tree
ok 800 - managed Windows root auto-exit contains its verified child and grandchild process tree
  ---
  duration_ms: 35883.1399
  type: 'test'
  ...
# Subtest: whole-runtime shutdown waits for a pending managed finalizer before cleanup
not ok 802 - whole-runtime shutdown waits for a pending managed finalizer before cleanup
  ---
  duration_ms: 986.2698
  type: 'test'
  location: 'D:\\projects\\service-lasso\\_worktrees\\issue-1535-same-held-command-query\\tests\\process-ownership.test.js:4346:1'
  failureType: 'testCodeFailure'
  error: 'Managed process finalization failed: service "managed-terminal-finalizer-service" (pid 83372, phase finalize, code FINALIZATION_DID_NOT_CONVERGE).'
  code: 'ERR_TEST_FAILURE'
  name: 'ManagedProcessFinalizationError'
  stack: |-
    stopAllManagedProcesses (file:///D:/projects/service-lasso/_worktrees/issue-1535-same-held-command-query/dist/runtime/execution/supervisor.js:2067:15)
  ...
# Subtest: whole-runtime shutdown reports safe service, pid, and finalization phase on failure
not ok 803 - whole-runtime shutdown reports safe service, pid, and finalization phase on failure
  ---
  duration_ms: 1010.2905
  type: 'test'
  location: 'D:\\projects\\service-lasso\\_worktrees\\issue-1535-same-held-command-query\\tests\\process-ownership.test.js:4395:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    2 !== 1
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 1
  actual: 2
  operator: 'strictEqual'
  ...
# Subtest: runtime and service ownership are durable before readiness and clear after confirmed stop
not ok 806 - runtime and service ownership are durable before readiness and clear after confirmed stop
  ---
  duration_ms: 7833.9345
  type: 'test'
  ...
# Subtest: runtime restart adopts a registry owner even when runtime.json discarded running state
not ok 807 - runtime restart adopts a registry owner even when runtime.json discarded running state
  ---
  duration_ms: 2871.2063
  type: 'test'
  ...
```

After displayed test 809, chunks `574abc`, `b087a7`, and `b0afe0` each produced zero output after 30 seconds. This is a live silence observation, not a terminal outcome.

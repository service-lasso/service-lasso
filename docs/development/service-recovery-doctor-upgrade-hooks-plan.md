# Service Recovery, Doctor, And Upgrade Hooks Plan

This document captures the governed plan for GitHub issue `#130` and the implemented recovery/doctor/upgrade-hook slices.

## Goal

Service Lasso needs a safe path for monitoring services, restarting services after crash or unhealthy states, running doctor/preflight steps before restart or upgrade, and executing upgrade hooks without hiding failures from operators.

The first implemented slice is intentionally contract-only:

- `monitoring` describes whether future runtime monitor work may check a service periodically
- `restartPolicy` describes explicit automatic restart intent and limits
- `doctor` describes bounded preflight steps with timeout and failure policy
- `hooks` describes bounded lifecycle hook phases for restart and upgrade flows

The contract alone did not enable runtime behavior; the follow-on slices below add bounded runtime execution.

The second implemented slice adds the first bounded runtime monitor:

- the API server can opt into starting a monitor loop
- only services with `monitoring.enabled` and `restartPolicy.enabled` are eligible
- crashed services can be restarted when `restartPolicy.onCrash` is true
- unhealthy services can be restarted when `restartPolicy.onUnhealthy` is true and the configured threshold is reached
- restart attempts respect `maxAttempts`, `backoffSeconds`, and duplicate in-flight protection
- monitor decisions are returned to callers and persisted into bounded recovery history

The third implemented slice adds restart doctor/preflight execution:

- configured `doctor.steps` run before `restart`
- `block` policy prevents restart before the current service process is stopped or replaced
- `warn` policy records the failed step result and allows restart to continue
- step execution is bounded by `timeoutSeconds`
- doctor results are persisted into bounded recovery history; manual doctor CLI/API surfaces remain tracked separately

The fourth implemented slice adds upgrade-hook execution around update install:

- `preUpgrade` runs after update policy/window/running-service gates pass and before the candidate archive is extracted
- `postUpgrade` runs after the candidate is installed and any required stop/start safety work has completed
- required hook failures prevent update install from reporting success
- failed upgrade simulations run `rollback` and `onFailure` hook phases when configured
- hook run evidence is recorded in `.state/updates.json` under `hookResults`
- hook run evidence is also persisted into bounded recovery history

The fifth implemented slice adds durable recovery history:

- `.state/recovery.json` stores bounded event history per service
- monitor decisions, doctor runs, restart outcomes, and upgrade hook phase results append to the same history file
- history loading normalizes missing or partial state so operators can rehydrate persisted evidence safely
- retention defaults to the latest 100 events per service to prevent unbounded monitor growth

## Manifest Shape

Example:

```json
{
  "monitoring": {
    "enabled": true,
    "intervalSeconds": 30,
    "unhealthyThreshold": 2,
    "startupGraceSeconds": 5
  },
  "restartPolicy": {
    "enabled": true,
    "onCrash": true,
    "onUnhealthy": true,
    "maxAttempts": 3,
    "backoffSeconds": 10
  },
  "doctor": {
    "enabled": true,
    "timeoutSeconds": 15,
    "failurePolicy": "block",
    "steps": [
      {
        "name": "validate-config",
        "command": "node",
        "args": ["./doctor/validate-config.mjs"],
        "timeoutSeconds": 5,
        "failurePolicy": "warn"
      }
    ]
  },
  "hooks": {
    "preRestart": [
      {
        "name": "pre-restart",
        "command": "node",
        "args": ["./hooks/pre-restart.mjs"]
      }
    ],
    "postUpgrade": [
      {
        "name": "post-upgrade",
        "command": "node",
        "args": ["./hooks/post-upgrade.mjs"],
        "failurePolicy": "block"
      }
    ]
  }
}
```

## Supported Hook Phases

- `preRestart`
- `postRestart`
- `preUpgrade`: executed before update candidate extraction
- `postUpgrade`: executed after update candidate installation
- `rollback`: executed when a guarded upgrade path fails after hook execution begins
- `onFailure`: executed after rollback for failed upgrade simulations

## Failure Policy

Bounded hook and doctor definitions support:

- `block`: a failed step blocks restart or update install success reporting
- `warn`: a failed step is recorded but does not block by default
- `continue`: a failed step is recorded while continuing the guarded operation

## Follow-On Issues

- `#132`: runtime service monitor and auto-restart loop - first bounded slice implemented
- `#133`: doctor/preflight execution before restart or upgrade - restart preflight implemented
- `#134`: pre-upgrade, post-upgrade, and rollback hook execution - implemented for update install
- `#135`: persisted recovery, doctor, restart, and hook history - implemented
- `#136`: CLI and API surfaces
- `#137`: Service Admin UI status
- `#138`: end-to-end recovery and hook verification

# Service Recovery, Doctor, And Upgrade Hooks Plan

This document captures the governed plan for GitHub issue `#130` and the first contract slice in `#131`.

## Goal

Service Lasso needs a safe path for monitoring services, restarting services after crash or unhealthy states, running doctor/preflight steps before restart or upgrade, and executing upgrade hooks without hiding failures from operators.

The first implemented slice is intentionally contract-only:

- `monitoring` describes whether future runtime monitor work may check a service periodically
- `restartPolicy` describes explicit automatic restart intent and limits
- `doctor` describes bounded preflight steps with timeout and failure policy
- `hooks` describes bounded lifecycle hook phases for restart and upgrade flows

No automatic restart, monitor loop, doctor execution, or hook execution is enabled by this contract alone.

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
- `preUpgrade`
- `postUpgrade`
- `rollback`
- `onFailure`

## Failure Policy

Bounded hook and doctor definitions support:

- `block`: a failed step should block the guarded operation once execution exists
- `warn`: a failed step should be visible but not block by default
- `continue`: a failed step should be recorded while continuing the guarded operation

## Follow-On Issues

- `#132`: runtime service monitor and auto-restart loop
- `#133`: doctor/preflight execution before restart or upgrade
- `#134`: pre-upgrade, post-upgrade, and rollback hook execution
- `#135`: persisted recovery, doctor, restart, and hook history
- `#136`: CLI and API surfaces
- `#137`: Service Admin UI status
- `#138`: end-to-end recovery and hook verification


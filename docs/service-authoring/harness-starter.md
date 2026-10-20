---
title: Check the harness starter contract
---

# Check the harness starter contract

At reviewed source `a8e6d7aede951e76d280f7592a2ab43f9644b1c3`,
`service-lasso-harness` validates a contract, extracts its archive, reads the
manifest and executes its command directly. It writes result files from that
execution. This does not exercise the real Service Lasso runtime lifecycle.

Use this task to check contract and packaging integration. For real service
acceptance, follow [Validate and release](05-validate-release.md) with the owning
service's executable verifier and retained evidence.

## Prerequisites

Use a recorded harness source revision, its declared Go toolchain, and an owned
checkout. Select a fresh disposable output directory: the runner replaces its
`workspace` subdirectory before execution. The example contract lives at
`examples/service-template/service-harness.json`. Its artifact path is relative
to the contract file, so package the example first.

## Exercise the starter

From the harness checkout, build its bundled example:

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\package.ps1
```

Validate the contract, then run it with an owned output directory:

```sh
go run ./cmd/service-lasso-harness validate-contract --contract examples/service-template/service-harness.json
go run ./cmd/service-lasso-harness run --contract examples/service-template/service-harness.json --output-dir output/example-run
```

Inspect `run-result.json`, `summary.json` and, when start executes,
`process-output.log`. For a successful bundled example, expect `artifact.exists`
to be true and the enabled stages to report their direct-run results. The CLI's
legacy “stub run complete” label does not describe the execution boundary.

The runner extracts ZIP or tar.gz archives into its workspace, reads
`service.json`, prepares `execconfig` environment values and waits for the manifest
command to finish. Process health reflects successful command completion. Other
accepted health types currently report contract acceptance without probing their
endpoints. The declared health timeout does not bound command execution. Stop
records that the synchronous command completed; it does not demonstrate stopping
a long-running service.

Declared dependencies and every `expect`/`artifacts` requirement are not fully
implemented. The result does not prove Core API lifecycle, dependency installation,
alternative health checks or real-service shutdown. Keep these limits alongside
any result receipt.

## Failure recovery and cleanup

If validation fails, correct the contract against the harness's local validation
contract. If the artifact is missing or extraction fails, check package output,
archive format and the contract-relative path. For process failures, inspect the
retained local result and process output. Retain failure artifacts while diagnosing;
rerun only after addressing the cause, using a fresh owned output directory.

After the observed command has completed, remove only the disposable output and
example package created for this task. Do not use this result to authorize cleanup
of an existing service workspace or substitute it for an observed real-service stop.

The reviewed README and usage-flow identities appear in
[the authoring migration decisions](../components/authoring-migration-decisions.json).
Harness schema, architecture, CLI/build contracts and intended Core lifecycle-engine
requirements remain in the harness repository. This source reconciliation is not
fresh platform or newcomer runtime acceptance.
---
title: Check the harness starter contract
---

# Check the harness starter contract

The reviewed `service-lasso-harness` starter can validate a contract, resolve an
example archive and write result files. Its `run` engine is a stub: it records
intended stages without executing Service Lasso install/start/health/stop.

Use this task to check contract and packaging integration. For real service
acceptance, follow [Validate and release](05-validate-release.md) with the owning
service's executable verifier and retained evidence.

## Prerequisites

Use a recorded harness source revision, its declared Go toolchain, and an owned
checkout/output directory. The example contract lives at
`examples/service-template/service-harness.json`. It resolves the artifact relative
to the contract file, so package the example before running the stub.

## Exercise the starter

From the harness checkout, build its bundled example:

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\package.ps1
```

Validate the example contract, then produce the starter result:

```sh
go run ./cmd/service-lasso-harness validate-contract --contract examples/service-template/service-harness.json
go run ./cmd/service-lasso-harness run --contract examples/service-template/service-harness.json --output-dir output/example-run
```

Inspect `run-result.json` and `summary.json` in the selected output directory.
The reviewed starter validates the contract, defaults omitted health type to
`process`, resolves the archive and records intended stage status. These files do
not prove a process was installed, started, healthy or stopped.

## Failure recovery and cleanup

If validation fails, correct the contract against the harness's owning schema and
CLI contract. If the artifact is missing, check the example package output and its
contract-relative path. Retain failed result files while diagnosing the problem;
rerun the starter only after addressing the recorded cause.

After review, remove only the disposable output/example artifact created for this
task. The stub result does not authorize cleanup of a real service workspace and
does not replace an observed real-service stop.

The reviewed README and usage-flow identities appear in
[the authoring migration decisions](../components/authoring-migration-decisions.json).
Harness schemas, architecture, CLI/build contracts and future lifecycle-engine
requirements remain in the harness repository. No new harness execution is claimed
by this documentation migration.

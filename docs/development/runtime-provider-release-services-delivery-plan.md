# Runtime Provider Release Services Delivery Plan

Date: 2026-04-27

Linked issues: `#167`, `#168`, `#169`, `#170`, `#171`, `#172`

Spec binding: `SPEC-002`, `AC-4H`, `AC-4W`, `AC-4Y`, `AC-4Z`

## Purpose

Service Lasso needs a clear delivery path for runtime/provider services that may be acquired from GitHub releases instead of relying on tools already installed on the host machine.

This plan covers:

- `@node`
- `@python`
- `@java`
- `@traefik`

It separates current truth from target delivery so the repo does not imply release-backed provider behavior before the service repos, releases, manifests, and validation exist.

## Current State

| Service | Current repo | Current core behavior | Release-backed today | Notes |
| --- | --- | --- | --- | --- |
| `@node` | none | local/no-download provider using host `node` | no | Used by baseline as an explicit provider. It is installed/configured but not launched as a daemon. |
| `@python` | none | local/no-download provider using host `python` | no | Fixture/provider manifest exists, but it is not part of the default baseline. |
| `@java` | none | local/no-download provider using host `java` | no | Tracked by the Java plan; release-backed JRE redistribution is deferred until vendor/license/security choices are made. |
| `@traefik` | `service-lasso/lasso-traefik` | release-backed managed router service | yes | Current verified release is `2026.4.25-5301df9`. |

Current Traefik release:

- Repo: `https://github.com/service-lasso/lasso-traefik`
- Release: `https://github.com/service-lasso/lasso-traefik/releases/tag/2026.4.25-5301df9`

No `service-lasso/lasso-node`, `service-lasso/lasso-python`, or `service-lasso/lasso-java` GitHub repos exist at the time of this plan.

## Target Service Repo Pattern

Each release-backed runtime/provider service should have a dedicated repo:

| Service | Target repo | Primary issue |
| --- | --- | --- |
| `@node` | `service-lasso/lasso-node` | `#168` |
| `@python` | `service-lasso/lasso-python` | `#169` |
| `@java` | `service-lasso/lasso-java` | `#170` |
| `@traefik` | `service-lasso/lasso-traefik` | `#171` |

Each repo should publish releases from protected-branch pushes using:

```text
yyyy.m.d-<shortsha>
```

Each repo should include:

- `service.json`
- `README.md`
- `LICENSE`
- release workflow
- local package/release verification script
- platform archives for supported platforms
- explicit supported-platform matrix
- optional checksum/provenance output when practical

## Artifact Naming

Use a predictable artifact name per platform:

| Service | Windows | Linux | macOS |
| --- | --- | --- | --- |
| `@node` | `lasso-node-win32.zip` | `lasso-node-linux.tar.gz` | `lasso-node-darwin.tar.gz` |
| `@python` | `lasso-python-win32.zip` | `lasso-python-linux.tar.gz` | `lasso-python-darwin.tar.gz` |
| `@java` | `lasso-java-win32.zip` | `lasso-java-linux.tar.gz` | `lasso-java-darwin.tar.gz` |
| `@traefik` | `lasso-traefik-win32.zip` | `lasso-traefik-linux.tar.gz` | `lasso-traefik-darwin.tar.gz` |

If a repo cannot support all three platforms initially, the repo README, `service.json`, and issue evidence must state the supported subset explicitly. Unsupported platform behavior must fail clearly instead of implying a missing archive exists.

## Manifest Contract

Provider manifests should keep `role: "provider"` and should not be treated as long-running daemons unless a future service-specific reason is documented.

The release-backed provider manifest should include:

- `id`
- `name`
- `version`
- `role: "provider"`
- `enabled`
- `artifact.kind: "archive"`
- `artifact.source.type: "github-release"`
- `artifact.source.repo`
- `artifact.source.tag`
- per-platform `assetName`, `archiveType`, `command`, and optional `args`
- provider-specific env/globalenv values
- a version or smoke command that can prove the extracted runtime works

Provider install/acquire means:

1. download the provider archive from its configured GitHub release
2. extract it under the service state/extracted area
3. materialize any configured files
4. record install metadata
5. report provider health from the installed executable or explicit provider check
6. skip daemon launch for baseline/provider-only start behavior

## Service-Specific Decisions

### `@node`

Target issue: `#168`

Recommended first delivery:

- package a known Node.js runtime distribution or a thin wrapper around an approved Node distribution
- expose `NODE`, and optionally `NODE_HOME`, through provider env/globalenv
- verify `node --version` from the extracted artifact
- prove one provider-backed service can run through `execservice: "@node"`

Key risk:

- Node distribution license/provenance and platform coverage must be explicit before release-backed use is claimed.

### `@python`

Target issue: `#169`

Recommended first delivery:

- choose Python distribution source and license
- package a minimal provider runtime or approved embedded distribution
- expose `PYTHON`, and optionally `PYTHON_HOME`, through provider env/globalenv
- verify `python --version` from the extracted artifact
- prove one provider-backed Python fixture can run through `execservice: "@python"`

Key risk:

- Python embedded distribution behavior differs by platform. The repo must document what is supported and what is intentionally deferred.

### `@java`

Target issue: `#170`

Recommended first delivery:

- choose JRE/JDK vendor and license, for example Eclipse Temurin if approved
- package the selected Java runtime with explicit platform support
- expose `JAVA` and `JAVA_HOME` through provider env/globalenv
- verify `java --version` from the extracted artifact
- prove one Java-provider-backed fixture can run through `execservice: "@java"`

Key risk:

- Java redistribution has the clearest vendor/license/security-update decision point. Do not create a release-backed JRE repo until that decision is documented.

### `@traefik`

Target issue: `#171`

Current delivery state:

- repo exists
- releases exist
- core manifest points at `service-lasso/lasso-traefik@2026.4.25-5301df9`
- core live verifier exists as `npm run verify:traefik-release`

Recommended next delivery:

- review `lasso-traefik` against the shared service repo contract
- add checksum/provenance output if practical
- keep release asset names aligned with the table above
- keep core `services/@traefik/service.json` pinned to a verified release
- run `npm run verify:traefik-release` after any release update

## Core and Reference Integration

Target issue: `#172`

Core integration should happen only after a provider repo has a verified release.

Migration order:

1. Keep local/no-download provider manifests as the current truth.
2. Create and verify the provider service repo.
3. Add or update the provider manifest's `artifact` block in core.
4. Add targeted install/acquire verification for that provider.
5. Re-run `npm test`.
6. Re-run `npm run verify:baseline-start` if the provider is part of the baseline.
7. Update reference app and `service-template` inventories only after core proof passes.

Baseline rule:

- `@node` is part of the current default baseline, so release-backed `@node` migration affects the clean-clone baseline contract.
- `@python` and `@java` are not part of the current default baseline, so they should remain optional unless a consuming baseline service requires them.
- `@traefik` is already release-backed and remains part of the default baseline.

## Delivery Order

Recommended order:

1. Harden the shared service repo template/contract using `lasso-traefik` as the reference implementation.
2. Deliver `lasso-node`, because `@node` is already part of the baseline and unlocks a no-host-Node provider path for app services.
3. Integrate release-backed `@node` into core and revalidate the baseline.
4. Deliver `lasso-python`, because Python is a common donor/provider class but not baseline-critical.
5. Deliver `lasso-java` after the JRE vendor/license/security decision.
6. Update reference app/service-template inventories as each provider becomes release-backed and verified.

## Verification Gates

Each provider repo must prove:

- package/release workflow passes
- release version uses `yyyy.m.d-<shortsha>`
- all documented release assets exist
- archive contents match `service.json`
- provider version command works from the extracted archive
- repo README explains supported platforms and usage

Core must prove:

- manifest parsing accepts the release-backed provider manifest
- install/acquire downloads and extracts the provider archive
- provider health reports correctly
- provider services are not launched as daemons by default
- provider-backed child service execution works where applicable
- update discovery works if the provider manifest opts into updates

Reference repos must prove:

- fresh clone works with their committed `services/` inventory
- source/bootstrap-download artifacts can acquire provider services
- bundled/no-download artifacts contain already acquired archives when that artifact mode is produced
- Service Admin can display the provider state clearly

## Open Risks

- Runtime redistribution policies differ for Node, Python, and Java.
- Platform-specific embedded runtime layouts may require different commands/env by OS.
- Java security updates require an explicit maintenance owner and cadence.
- Moving `@node` from local/no-download to release-backed changes the baseline start contract and must be revalidated from a fresh clone.
- Bundled artifacts in reference repos must avoid first-run downloads only after provider archives are acquired during packaging.

## Completion Definition

This provider-release program is complete when:

- `lasso-node`, `lasso-python`, and `lasso-java` either have verified release-backed repos or are explicitly deferred with approved reasons.
- `lasso-traefik` remains aligned with the shared service repo contract.
- core manifests accurately distinguish release-backed providers from local/no-download providers.
- clean-clone validation proves the default baseline with any release-backed provider changes.
- reference app inventories and release outputs are consistent with the final provider state.

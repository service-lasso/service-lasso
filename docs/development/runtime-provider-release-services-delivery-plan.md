---
unlisted: true
---

# Runtime Provider Release Services Delivery Plan

Date: 2026-04-27

Linked issues: `#167`, `#168`, `#169`, `#170`, `#171`, `#172`, `#174`, `#176`, `#179`, `#195`, `#198`

Spec binding: `SPEC-002`, `AC-4H`, `AC-4W`, `AC-4Y`, `AC-4Z`

## Purpose

Service Lasso needs a clear delivery path for runtime/provider services that may be acquired from GitHub releases instead of relying on tools already installed on the host machine.

This plan covers:

- `@node`
- `@python`
- `@java`
- `@traefik`
- `@nginx`

It separates current truth from target delivery so the repo does not imply release-backed provider behavior before the service repos, releases, manifests, and validation exist.

## Current State

| Service | Current repo | Current core behavior | Release-backed today | Notes |
| --- | --- | --- | --- | --- |
| `@node` | [`service-lasso/lasso-node`](https://github.com/service-lasso/lasso-node) | release-backed provider in the current core baseline | yes, repo release exists | Core manifest pins `2026.4.27-eca215a`, acquires exact Node `v24.15.0`, and skips provider daemon launch. |
| `@localcert` | [`service-lasso/lasso-localcert`](https://github.com/service-lasso/lasso-localcert) | release-backed provider in the current core baseline | yes, repo release exists | Core manifest pins `2026.4.27-591ed28`, acquires local cert material, exports certificate globals, and skips provider daemon launch. |
| `@python` | [`service-lasso/lasso-python`](https://github.com/service-lasso/lasso-python) | optional release-backed provider in core | yes, Windows-only repo release exists | Core manifest pins `2026.4.27-63f915c` and can acquire official Python.org Windows embeddable `3.11.5`; Linux/macOS remain deferred. |
| `@java` | [`service-lasso/lasso-java`](https://github.com/service-lasso/lasso-java) | optional release-backed provider in core | yes, repo release exists | Core manifest pins `2026.4.27-b313cb0` and can acquire Eclipse Temurin JRE `17.0.18+8` across Windows/Linux/macOS. |
| `@traefik` | [`service-lasso/lasso-traefik`](https://github.com/service-lasso/lasso-traefik) | release-backed managed router service depending on local `@localcert` and `@nginx` utility manifests | yes | Current verified release is `2026.4.27-bbc7f15`. |
| `@nginx` | [`service-lasso/lasso-nginx`](https://github.com/service-lasso/lasso-nginx) | release-backed managed NGINX dependency in the current core baseline | yes, repo release exists | Core manifest pins `2026.4.27-712c75f`, acquires NGINX Open Source `1.30.0`, and starts it before Traefik. |

Current Traefik release:

- Repo: [`service-lasso/lasso-traefik`](https://github.com/service-lasso/lasso-traefik)
- Release: `https://github.com/service-lasso/lasso-traefik/releases/tag/2026.4.27-bbc7f15`

[`service-lasso/lasso-node`](https://github.com/service-lasso/lasso-node), [`service-lasso/lasso-python`](https://github.com/service-lasso/lasso-python), and [`service-lasso/lasso-java`](https://github.com/service-lasso/lasso-java) now exist and have verified releases. Core manifests now point at those verified releases; remaining reference/service-template refresh can proceed from this core truth.
[`service-lasso/lasso-nginx`](https://github.com/service-lasso/lasso-nginx) also exists and has a verified release-backed managed-service contract for the baseline Traefik dependency.

## Target Service Repo Pattern

Each release-backed runtime/provider service should have a dedicated repo:

| Service | Target repo | Primary issue |
| --- | --- | --- |
| `@node` | [`service-lasso/lasso-node`](https://github.com/service-lasso/lasso-node) | `#168` |
| `@python` | [`service-lasso/lasso-python`](https://github.com/service-lasso/lasso-python) | `#169` |
| `@java` | [`service-lasso/lasso-java`](https://github.com/service-lasso/lasso-java) | `#170` |
| `@traefik` | [`service-lasso/lasso-traefik`](https://github.com/service-lasso/lasso-traefik) | `#171` |
| `@nginx` | [`service-lasso/lasso-nginx`](https://github.com/service-lasso/lasso-nginx) | `#198` |

Each repo should publish releases from protected-branch pushes using:

```text
yyyy.m.d-<shortsha>
```

The GitHub release tag is the Service Lasso packaging release version. It is not the runtime version. Runtime versions must be visible in the artifact names and in the service manifest variant that consumes them.

Artifact names must include the exact upstream framework/tool version being packaged. Do not use only a major version such as `24`, `25`, `17`, or `21` in a provider archive name.

Each repo should include:

- `service.json`
- `README.md`
- `LICENSE`
- release workflow
- local package/release verification script
- platform archives for supported platforms
- explicit supported-platform matrix
- checksum/provenance output when practical

## Runtime Version Matrix

The first provider repos must support multiple runtime versions per provider.

| Provider | Runtime versions to release | Core/default version |
| --- | --- | --- |
| `@node` | `v24.15.0`, `v25.9.0` | `v24.15.0` |
| `@java` | `17.0.18+8`, `21.0.10+7` | `17.0.18+8` |
| `@python` | `3.11.5`, `3.14.4` | `3.11.5` |

Core baseline rule:

- baseline/core manifests use the first exact version listed in the set
- baseline/core manifests must not automatically float to the newest version in the set
- newer provider versions remain available for apps that choose them explicitly

Expected upstream sources:

- Node: official Node.js distribution archives for `v24.15.0` and `v25.9.0`
- Java: Eclipse Temurin/Adoptium JRE archives for Java `17.0.18+8` and `21.0.10+7`
- Python: official Python.org archives for `3.11.5` and `3.14.4`

For Java, keep the exact upstream version with build metadata in release metadata and manifest metadata. If a repo later decides to normalize `+` to another filename-safe separator, the README and release metadata must state that mapping explicitly.

## Artifact Naming

Use a predictable artifact name per platform:

| Service | Windows | Linux | macOS |
| --- | --- | --- | --- |
| `@node` `v24.15.0` | `lasso-node-v24.15.0-win32.zip` | `lasso-node-v24.15.0-linux.tar.gz` | `lasso-node-v24.15.0-darwin.tar.gz` |
| `@node` `v25.9.0` | `lasso-node-v25.9.0-win32.zip` | `lasso-node-v25.9.0-linux.tar.gz` | `lasso-node-v25.9.0-darwin.tar.gz` |
| `@python` `3.11.5` | `lasso-python-3.11.5-win32.zip` | Deferred | Deferred |
| `@python` `3.14.4` | `lasso-python-3.14.4-win32.zip` | Deferred | Deferred |
| `@java` `17.0.18+8` | `lasso-java-17.0.18+8-win32.zip` | `lasso-java-17.0.18+8-linux.tar.gz` | `lasso-java-17.0.18+8-darwin.tar.gz` |
| `@java` `21.0.10+7` | `lasso-java-21.0.10+7-win32.zip` | `lasso-java-21.0.10+7-linux.tar.gz` | `lasso-java-21.0.10+7-darwin.tar.gz` |
| `@traefik` | `lasso-traefik-win32.zip` | `lasso-traefik-linux.tar.gz` | `lasso-traefik-darwin.tar.gz` |
| `nginx` `1.30.0` | `lasso-nginx-1.30.0-win32.zip` | `lasso-nginx-1.30.0-linux.tar.gz` | `lasso-nginx-1.30.0-darwin.tar.gz` |

If a repo cannot support all three platforms initially, the repo README, `service.json`, and issue evidence must state the supported subset explicitly. Unsupported platform behavior must fail clearly instead of implying a missing archive exists.

## Manifest Contract

Provider manifests should keep `role: "provider"` and should not be treated as long-running daemons unless a future service-specific reason is documented.

Managed utility services such as `@nginx` should omit `role: "provider"` when they are expected to start and remain running under Service Lasso supervision.

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
- a selected exact runtime version for the service manifest, for example Node `v24.15.0`, Java `17.0.18+8`, or Python `3.11.5`

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

- package official Node.js runtime distributions for Node `v24.15.0` and Node `v25.9.0`
- name release assets with the exact Node version, for example `lasso-node-v24.15.0-win32.zip`
- make the core baseline manifest select Node `v24.15.0`
- expose `NODE`, and optionally `NODE_HOME`, through provider env/globalenv
- verify `node --version` from the extracted artifact
- prove one provider-backed service can run through `execservice: "@node"`

Key risk:

- Node distribution license/provenance and platform coverage must be explicit before release-backed use is claimed.

Current delivery evidence:

- Repo: [`service-lasso/lasso-node`](https://github.com/service-lasso/lasso-node)
- Release: `https://github.com/service-lasso/lasso-node/releases/tag/2026.4.27-eca215a`
- Release workflow: `https://github.com/service-lasso/lasso-node/actions/runs/24975752579`
- Assets: exact Node `v24.15.0` and `v25.9.0` Windows/Linux/macOS archives, `service.json`, and `SHA256SUMS.txt`
- Core proof: `service-lasso install @node` against the checked-in core manifest acquired `lasso-node-v24.15.0-win32.zip` from release `2026.4.27-eca215a` and left `running=false`. `node-sample-service` also started through the acquired `@node` runtime executable.

### `@python`

Target issue: `#169`

Recommended first delivery:

- choose Python distribution source and license
- package Python `3.11.5` and Python `3.14.4`
- name release assets with the exact Python version, for example `lasso-python-3.11.5-win32.zip`
- make the core baseline manifest select Python `3.11.5` if/when Python is included in a baseline
- expose `PYTHON`, and optionally `PYTHON_HOME`, through provider env/globalenv
- verify `python --version` from the extracted artifact
- prove one provider-backed Python fixture can run through `execservice: "@python"`

Key risk:

- Python.org publishes Windows embeddable archives, but does not publish equivalent portable runtime archives for Linux/macOS. The first provider release is intentionally Windows-only until an approved cross-platform Python distribution source exists.

Current delivery evidence:

- Repo: [`service-lasso/lasso-python`](https://github.com/service-lasso/lasso-python)
- Release: `https://github.com/service-lasso/lasso-python/releases/tag/2026.4.27-63f915c`
- Release workflow: `https://github.com/service-lasso/lasso-python/actions/runs/24978375174`
- Assets: `lasso-python-3.11.5-win32.zip`, `lasso-python-3.14.4-win32.zip`, `service.json`, and `SHA256SUMS.txt`
- Core proof: `service-lasso install @python` against the checked-in core manifest acquired `lasso-python-3.11.5-win32.zip` from release `2026.4.27-63f915c` and left `running=false`.

### `@java`

Target issue: `#170`

Recommended first delivery:

- use Eclipse Temurin/Adoptium if the vendor/license/security decision is approved
- package Java `17.0.18+8` and Java `21.0.10+7`
- prefer JRE artifacts unless a concrete provider-backed workload requires a JDK
- name release assets with the exact Java version and build metadata, for example `lasso-java-17.0.18+8-win32.zip`
- make the core baseline manifest select Java `17.0.18+8` if/when Java is included in a baseline
- expose `JAVA` and `JAVA_HOME` through provider env/globalenv
- verify `java --version` from the extracted artifact
- prove one Java-provider-backed fixture can run through `execservice: "@java"`

Key risk:

- Java redistribution now uses Eclipse Temurin/Adoptium JRE archives for the first provider release. Security-update cadence and future runtime updates still need explicit maintenance ownership when the provider is integrated into app inventories.

Current delivery evidence:

- Repo: [`service-lasso/lasso-java`](https://github.com/service-lasso/lasso-java)
- Release: `https://github.com/service-lasso/lasso-java/releases/tag/2026.4.27-b313cb0`
- Release workflow: `https://github.com/service-lasso/lasso-java/actions/runs/24978746504`
- Assets: exact Java `17.0.18+8` and `21.0.10+7` Windows/Linux/macOS archives, `service.json`, and `SHA256SUMS.txt`
- Core proof: `service-lasso install @java` against the checked-in core manifest acquired `lasso-java-17.0.18+8-win32.zip` from release `2026.4.27-b313cb0` and left `running=false`.

### `@traefik`

Target issue: `#171`

Current delivery state:

- repo exists
- releases exist
- core manifest points at [`service-lasso/lasso-traefik`](https://github.com/service-lasso/lasso-traefik) release `2026.4.27-bbc7f15`
- core live verifier exists as `npm run verify:traefik-release`
- the release manifest includes platform `commandline` entries for the Traefik providers-file path, dashboard/API flags, entrypoints, ping readiness, and insecure transport flag; Service Lasso resolves those strings into process args at start/restart time
- the released Traefik manifest carries local certificate and NGINX dependency intent; core represents those dependencies with prefixed core service IDs `@localcert` and `@nginx`, and starts release-backed managed `@nginx` from [`service-lasso/lasso-nginx`](https://github.com/service-lasso/lasso-nginx) release `2026.4.27-712c75f` before Traefik

Recommended next delivery:

- review `lasso-traefik` against the shared service repo contract
- publish `SHA256SUMS.txt` checksum output with the release archives
- keep release asset names aligned with the table above
- keep core `services/@traefik/service.json` pinned to a verified release
- run `npm run verify:traefik-release` after any release update

### `@nginx`

Target issue: `#198`

Current delivery evidence:

- Repo: [`service-lasso/lasso-nginx`](https://github.com/service-lasso/lasso-nginx)
- Release: `https://github.com/service-lasso/lasso-nginx/releases/tag/2026.4.27-712c75f`
- Release workflow: `https://github.com/service-lasso/lasso-nginx/actions/runs/25007138693`
- Assets: NGINX Open Source `1.30.0` Windows/Linux/macOS archives, `service.json`, and `SHA256SUMS.txt`
- Core target behavior: `service-lasso start` acquires, configures, starts, and healthchecks `@nginx` before starting `@traefik`.

## Core and Reference Integration

Target issue: `#172`

Core integration should happen only after a provider repo has a verified release.

Integration order:

1. Create and verify the provider service repo.
2. Add or update the provider manifest's `artifact` block in core.
3. Add targeted install/acquire verification for that provider.
4. Re-run `npm test`.
5. Re-run `npm run verify:baseline-start` if the provider is part of the baseline.
6. Update reference app and `service-template` inventories only after core proof passes.

Baseline rule:

- `@node` is part of the current default baseline, so release-backed `@node` changes affect the clean-clone baseline contract. Core should use Node `v24.15.0`, not Node `v25.9.0`.
- `@python` and `@java` are not part of the current default baseline, so they should remain optional unless a consuming baseline service requires them. If included later, core should use Python `3.11.5` and Java `17.0.18+8`, not Python `3.14.4` or Java `21.0.10+7`.
- `@traefik` is already release-backed and remains part of the default baseline.
- `@nginx` is part of the current default baseline because `@traefik` depends on it; it is a managed service rather than a provider marker.

## Delivery Order

Recommended order:

1. Harden the shared service repo template/contract using `lasso-traefik` as the reference implementation.
2. Deliver `lasso-node`, because `@node` is already part of the baseline and unlocks a no-host-Node provider path for app services.
3. Integrate release-backed `@node` into core and revalidate the baseline. Completed under `#172`.
4. Deliver `lasso-python`, because Python is a common provider class but not baseline-critical. Completed with a Windows-only first release.
5. Deliver `lasso-java` after the JRE vendor/license/security decision. Completed with Eclipse Temurin JRE releases.
6. Deliver `lasso-nginx` as a managed core service for the Traefik dependency. Completed under `#198`.
7. Update core/reference app/service-template inventories as each provider becomes release-backed and verified. Core is complete under `#172` and `#198`; reference/template refresh remains the next inventory propagation step.

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
- Moving `@node` from local/no-download to release-backed changes the baseline start contract and must continue to be covered by clean-clone/baseline verification.
- Bundled artifacts in reference repos must avoid first-run downloads only after provider archives are acquired during packaging.

## Completion Definition

This provider-release program is complete when:

- `lasso-node`, `lasso-python`, and `lasso-java` either have verified release-backed repos or are explicitly deferred with approved reasons. Current state: all three repos exist; Python is Windows-only for its first release.
- `lasso-traefik` remains aligned with the shared service repo contract; current proof is release `2026.4.27-bbc7f15` with checksum output, HTTP `/ping` readiness, env/globalenv outputs, the full service-port map, `portmapping`, platform `commandline`, and explicit `@localcert` / `@nginx` dependencies in core.
- `lasso-nginx` has a verified release-backed managed-service repo and core manifest pin. Current proof is release `2026.4.27-712c75f` with NGINX Open Source `1.30.0` Windows/Linux/macOS archives, HTTP `/health`, and checksums.
- core manifests accurately distinguish release-backed providers from any remaining local/no-download providers.
- clean-clone validation proves the default baseline with any release-backed provider changes.
- reference app inventories and release outputs are consistent with the final provider state.

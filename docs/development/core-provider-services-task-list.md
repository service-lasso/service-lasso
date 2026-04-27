# Core Provider Services Task List

Date: 2026-04-27

Parent planning issues: `#167`, `#174`, `#176`, `#179`

Spec binding: `SPEC-002`, `AC-4Y`, `AC-4Z`

## Execution Order

| Order | Service | Repo | Issue | Status | Purpose |
| --- | --- | --- | --- | --- | --- |
| 1 | `@traefik` | `service-lasso/lasso-traefik` | `#171` | Done | Harden the existing release-backed service repo into the pattern for the provider repos. |
| 2 | `@node` | `service-lasso/lasso-node` | `#168` | Done | Create the release-backed Node provider repo and publish exact-version artifacts. |
| 3 | `@python` | `service-lasso/lasso-python` | `#169` | Done | Create the release-backed Python provider repo and publish exact-version artifacts. |
| 4 | `@java` | `service-lasso/lasso-java` | `#170` | Done | Create the release-backed Java provider repo after vendor/license/security policy is explicit. |

Integration follow-up:

- `#172` integrates verified provider releases into core and reference manifests.
- `#178` tracks optional future `@archive`; it is not part of this four-service completion list because core already extracts `zip`, `tar.gz`, and `tgz`.

## Required Artifacts

Provider artifact names must include the exact upstream runtime/tool version.

| Service | Required artifacts |
| --- | --- |
| `@traefik` | Keep existing `lasso-traefik-win32.zip`, `lasso-traefik-linux.tar.gz`, `lasso-traefik-darwin.tar.gz` naming unless a future Traefik versioned naming change is approved. |
| `@node` | `lasso-node-v24.15.0-win32.zip`, `lasso-node-v24.15.0-linux.tar.gz`, `lasso-node-v24.15.0-darwin.tar.gz`, `lasso-node-v25.9.0-win32.zip`, `lasso-node-v25.9.0-linux.tar.gz`, `lasso-node-v25.9.0-darwin.tar.gz` |
| `@python` | First release supports official Python.org Windows embeddable archives only: `lasso-python-3.11.5-win32.zip`, `lasso-python-3.14.4-win32.zip`. Linux/macOS portable runtime packaging is deferred until an approved upstream distribution strategy exists. |
| `@java` | `lasso-java-17.0.18+8-win32.zip`, `lasso-java-17.0.18+8-linux.tar.gz`, `lasso-java-17.0.18+8-darwin.tar.gz`, `lasso-java-21.0.10+7-win32.zip`, `lasso-java-21.0.10+7-linux.tar.gz`, `lasso-java-21.0.10+7-darwin.tar.gz` |

Release tags still use the Service Lasso release pattern:

```text
yyyy.m.d-<shortsha>
```

## Core Defaults

Core/default manifests must select the first runtime version from each provider set:

| Provider | Core/default version |
| --- | --- |
| `@node` | `v24.15.0` |
| `@python` | `3.11.5` |
| `@java` | `17.0.18+8` |

The default must not float automatically to the newest provider version.

## Per-Service Done Criteria

Each service repo is done only when:

- the repo exists under the `service-lasso` org
- protected-branch release workflow creates `yyyy.m.d-<shortsha>` releases
- release assets match the documented artifact names
- `service.json` points at the released artifacts
- platform smoke tests prove the extracted runtime/tool works
- README explains supported platforms, artifact names, and usage
- the service issue records release URL, asset list, and verification evidence

`@traefik` evidence: `service-lasso/lasso-traefik#1` hardened the repo contract, and follow-up `service-lasso/lasso-traefik#2` released `2026.4.27-38bd54d` with Windows/Linux/macOS archives, `service.json`, `SHA256SUMS.txt`, and HTTP `/ping` readiness. Core `services/@traefik/service.json` is pinned to that release, and `npm run verify:traefik-release`, `npm run verify:baseline-start`, and `npm test` passed after the pin.

`@node` evidence: `service-lasso/lasso-node#1` added the provider packaging repo, `service-lasso/lasso-node#2` moved macOS packaging to `macos-15-intel`, release `2026.4.27-13573bd` published exact Node `v24.15.0` and `v25.9.0` Windows/Linux/macOS archives, `service.json`, and `SHA256SUMS.txt`, and direct Service Lasso install/acquire proof downloaded the default `v24.15.0` artifact without starting a managed daemon.

`@python` evidence: `service-lasso/lasso-python#1` added the provider packaging repo, release workflow `24978375174` passed, release `2026.4.27-63f915c` published official Python.org Windows embeddable archives for Python `3.11.5` and `3.14.4`, released `service.json`, and `SHA256SUMS.txt`, and direct Service Lasso install/acquire proof downloaded the default `3.11.5` artifact without starting a managed daemon. Linux/macOS provider archives remain intentionally unsupported in this first release.

`@java` evidence: `service-lasso/lasso-java#1` added the provider packaging repo, `service-lasso/lasso-java#2` removed the latest-version fallback and pinned exact Eclipse Temurin release assets, release workflow `24978746504` passed, release `2026.4.27-b313cb0` published Java `17.0.18+8` and `21.0.10+7` Windows/Linux/macOS archives, released `service.json`, and `SHA256SUMS.txt`, and direct Service Lasso install/acquire proof downloaded the default `17.0.18+8` artifact without starting a managed daemon.

## Core Integration Gate

Do not update core/reference manifests for a provider until that provider repo has:

- a successful release workflow
- a verified GitHub release
- install/acquire proof through Service Lasso
- provider health proof
- provider-backed child service proof where applicable

After each provider is integrated, run:

```powershell
npm test
npm run verify:baseline-start
```

Run additional live checks for the service type where available.

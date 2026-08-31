# Secrets Broker live-readiness record

> Current capability maturity is governed by the canonical
> [Secrets capability ledger](./secrets-capability-ledger.md). This record
> preserves the candidate release boundary; historical source and local
> evidence below must not be read as proof that every capability is currently
> validated.

This record defines the release boundary for the Service Lasso, Secrets Broker,
and Service Admin candidates. A green source test or a healthy process alone is
not a go-live decision. The exact published artifacts, their pinned versions,
their authenticated cross-process behavior, and their supported capability
scope must agree.

## Intended product role

Secrets Broker is the only component that handles managed secret values. It:

- keeps the local store encrypted and keeps custody material out of public
  runtime and browser contracts;
- resolves manifest-declared refs for an exact service under a short-lived,
  signed, service-scoped launch lease;
- accepts generated or operator-supplied values only through authenticated,
  policy-checked, audited mutation boundaries;
- exposes metadata inventory, bounded reveal, creation, edit/reset,
  decommission/restore, version rotation, encrypted backup/restore, master-key
  rotation, lockout, provider status, and migration contracts;
- records a serialized, tamper-evident metadata-only audit chain; and
- uses an OS-authenticated named pipe on Windows or an owner/peer-credential
  checked Unix socket on Linux and macOS production hosts.

Core owns service dependency discovery, permissions, setup orchestration,
secret-to-service materialisation, linked-consumer rotation, restart/readiness,
rollback, and the authenticated management proxy. Service Admin is a client of
that Core boundary; it never receives Broker transport credentials or key
custody material.

## Supported first release scope

| Capability | Release status | Required boundary |
| --- | --- | --- |
| Local encrypted store, generated values, read/resolve, reveal, edit/reset | Supported | Auth, policy, audit, confirmation where applicable |
| Local version stage/activate/rollback/retire | Supported through Core for linked refs | Core must converge every discovered consumer or roll back |
| Decommission and encrypted tombstone restore | Supported | Fresh signed plan, dependency gate, audit, idempotency |
| Encrypted backup, verification, restore, and master-key rotation | Supported | Broker-owned paths, exact operation ids, audit, restart proof |
| Windows named pipe and Unix socket production transport | Supported | No production TCP listener; exact OS peer boundary |
| Vault/OpenBao and AWS source reads and validated migration targets | Supported only for explicitly configured connections | Per-connection capability, bounded provider protocol, write then independent verification |
| Provider configuration persistence and general remote edit/reset/rotation/policy | Not in the first-release scope | Must remain disabled and return typed `unsupported` until #134 is complete |

The UI must derive action availability from the connection-scoped operation
manifest. A provider-family capability label is not permission to enable an
apply button.

## Candidate evidence

The current candidates have the following direct evidence:

- Broker: complete Go tests, `go vet`, packaged Windows binary scans with zero
  reachable vulnerabilities, Windows package/harness verification, and clean
  Linux/amd64 plus macOS/arm64 cross-compilation.
- Core: build and focused authenticated Broker, management proxy, permission,
  setup, request-policy, linked-rotation, and protected-state suites on Windows;
  the focused Unix-socket/security boundary also passes in WSL. Bounded and
  bundled release/package verification and a real Broker/consumer restart
  journey pass without plaintext residue. Release Qualification downloads the
  exact pinned Broker release, verifies the published archive digest, and runs
  that real subprocess journey over a Windows named pipe and a Linux Unix
  socket. The dedicated gate requires a Broker binary and cannot silently turn
  into the source-suite skip used by ordinary contributor runs. Broker PR `#177`
  added digest-pinned private-PKI source trust; immutable release
  `2026.8.31-f340883` targets merge
  `f340883056ec3cf74b535fb46490b39382e8c823`. Its publicly redownloaded
  Windows, Linux, and macOS archives, SBOMs, manifest, and checksum file match
  GitHub's SHA-256 digests and all eight provenance attestations. The released
  Windows binary also passed the Core/Admin first-run contract with no insecure
  TLS mode. Core pins that release; live readiness still requires terminal
  green hosted product, aggregate, and post-merge evidence for the final Core
  and Admin candidates.
- Service Admin: 106 unit tests, four packaged-runtime tests, production audit
  with no known vulnerabilities, Windows package verification, and a packaged
  Electron/Cypress journey through a real Core and Broker. The journey covers
  authenticated identity, linked-consumer rotation/restart, create,
  reveal/clear, decommission/restore, backup/verify/restore, master-key rotation,
  provider validation, and retryable inventory recovery. All 70 persisted audit
  records had their SHA-256 hashes recomputed and their chain verified from
  `genesis`; candidate values and audit reasons were absent.

Cross-compilation and WSL are not substitutes for hosted native execution. The
candidate cannot be called live-ready until the exact commits pass their hosted
Windows, Ubuntu, and macOS workflows and the packaged Admin real-browser gate
passes on Windows and Ubuntu.

## Remaining release gates

1. Publish the Core candidate through review and keep the full hosted build,
   audit, release, startup/recovery, checksum-bound Windows named-pipe and Linux
   Unix-socket subprocess, and docs qualification green.
2. Publish the Service Admin candidate after those revisions exist remotely;
   require the packaged Windows, Ubuntu, and macOS real-browser workflow to
   record the exact Core and Broker revisions.
3. Release Service Admin, pin its exact tag in Core, rerun Core release/package
   qualification, and promote the final reviewed Core commit.
4. Verify the public release manifests, asset digests, installed versions, live
   process versions, authenticated UI, linked rotation, restart recovery, and
   no-leak evidence all refer to those exact releases.

Until those gates pass, the correct verdict is **release candidate, not live**.
Broker issue [#134](https://github.com/service-lasso/lasso-secretsbroker/issues/134)
is now closed as implementation history, but closure does not establish current
Admin compatibility, cross-platform live behavior, or capability completeness.
Those maturity claims remain controlled by the canonical ledger and its exact
row-specific evidence.

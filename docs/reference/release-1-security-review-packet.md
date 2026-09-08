# Release 1 independent security review packet

Status: ready for independent review; external approval not yet recorded

Tracking issue: [service-lasso/service-lasso#1151](https://github.com/service-lasso/service-lasso/issues/1151)

Prior packet issue: [service-lasso/service-lasso#1208](https://github.com/service-lasso/service-lasso/issues/1208)

Acceptance authority: `SPEC-007` `AC-7F` through `AC-7H`

This packet replaces the rejected Core/npm identity `2026.9.1-1f4ec40` /
`1f4ec40f13fe3867b24ca901c42fe31c69e01e8d`. The independent AC-7H reject of
that set is
[comment 5578080923](https://github.com/service-lasso/service-lasso/issues/1151#issuecomment-5578080923).
That reject is not extended to these bytes. Historical published-package
failures `33500138538`, `33503750329`, and `33506286697` remain `failure`.

The delivery owner assembled this replacement packet and must not self-certify
the independent review. A later session must be a named independent AC-7H
reviewer bound to this packet commit plus the immutable identities below.

## Exact review scope

| Component | Immutable identity | Publication |
| --- | --- | --- |
| Core | `b0c3a1bef977c26d956d3d827025fe8c39c17799`; `2026.9.8-b0c3a1b` | [GitHub release](https://github.com/service-lasso/service-lasso/releases/tag/2026.9.8-b0c3a1b) ID `384922556` and `@service-lasso/service-lasso@2026.9.8-b0c3a1b` |
| Service Admin | `f015b4445b0526546a309301270186a697588166`; `2026.8.31-f015b44` | [GitHub release](https://github.com/service-lasso/lasso-serviceadmin/releases/tag/2026.8.31-f015b44) ID `380051618` |
| Secrets Broker | `f340883056ec3cf74b535fb46490b39382e8c823`; `2026.8.31-f340883` | [GitHub release](https://github.com/service-lasso/lasso-secretsbroker/releases/tag/2026.8.31-f340883) ID `379635299` |
| Cross-repository Admin harness | `f7abf981f8f0bbbbd7fdf352237fd84950d95ca3` | Pinned by the Core published-package workflow |

Review applies only to these bytes, manifests, checksums, SBOMs, attestations,
and evidence. A replacement archive, npm version, commit, workflow, dependency
graph, or security-control change requires delta review and fresh qualification.

npm live readback at packet assembly:

- `latest` = `2026.9.8-b0c3a1b`
- `gitHead` = `b0c3a1bef977c26d956d3d827025fe8c39c17799`
- integrity = `sha512-+Ji5n6DStatgqDAZrcGqiIEssbiEA5urnpHzyW019oT9RK07oZVR5/VfOqTrqr5Vnc+TZIiYZRUzSC0zAwbyLw==`
- shasum = `5caef5d9cd8a3a6904a442c70b493bfca6588081`
- tarball = `https://registry.npmjs.org/@service-lasso/service-lasso/-/service-lasso-2026.9.8-b0c3a1b.tgz`
- provenance predicate `https://slsa.dev/provenance/v1`; Sigstore log index `2760528145`

Unbundled Core SHA-256 values from `SHA256SUMS.txt` match GitHub API asset
digests: win32 `3beaedb6a5db489d521d573927b79d06fab9b8b03dd4756eac4df38c6e5c3e1e`;
linux and darwin `63cb818d30628d6ca506f864421b8888d2f8d7558d06461cd16db19bf345bd22`.

## Why this replacement exists

Independent AC-7H rejected Core `2026.9.1-1f4ec40` because a live
`npm audit --omit=dev --audit-level=low` against that frozen graph reported
`fast-uri@3.1.5` (high) and `qs@6.15.3` (moderate). Source remediation landed on
`develop` as `#1220` (`fast-uri@3.1.7`) and `#1223` (`qs` override `6.16.0`).
A lockfile fix does not remediate published bytes, so Core was republished from
current `origin/develop` `b0c3a1bef977c26d956d3d827025fe8c39c17799`.

Admin `2026.8.31-f015b44` and Broker `2026.8.31-f340883` are reused after
delta-review: exact SHAs, public asset digests, and checksum pins are unchanged.
Admin `pnpm audit --prod` at the release SHA reports no known vulnerabilities.
Broker `govulncheck ./...` and `govulncheck -mode=binary` on the shipped Windows
executables report zero reachable and zero imported-package findings.

## Product and security boundaries

Release 1 is a local-first encrypted-store product. Core owns service manifests,
process supervision, the trusted runtime request context, the allowlisted Broker
proxy, and operator policy projection. Broker owns plaintext secret handling,
encrypted persistence, key lifecycle, resolve/writeback, local management
authorization, lockout, and metadata-only audit/events. Admin is an untrusted
display and action-request client: it receives capability and safe metadata, and
cannot create authority by sending actor or permission fields in a body.

The protected management path is Admin browser to loopback Core, then Core to
Broker over authenticated local IPC. Windows uses a named pipe and POSIX uses a
Unix-domain socket. The Broker is not exposed as a remote HTTP management
service in the Release 1 path. Remote Admin identity is accepted only through
the exact loopback proxy with the configured trusted-ingress identity headers;
missing or mismatched ingress evidence fails closed. Loopback bootstrap and
operator actions use the runtime-established `local-root` boundary.

Trust ends at the local account/host, the Core process boundary, the authenticated
IPC peer, the selected portable-key/recovery holders, and explicitly configured
external sources. Release 1 does not claim protection after host or operator
account compromise, malicious kernel/administrator control, compromised
recovery quorum, or deliberate plaintext disclosure by an authorized operator.

## Threat model and mitigations

| Threat | Release 1 control | Evidence |
| --- | --- | --- |
| Artifact substitution or downgrade | Exact immutable tags, SHA-256 manifests, checksum-before-extraction, release/API identity checks, SLSA provenance, npm integrity and `gitHead`, and eleven fail-closed negative acquisition cases | Core [release run 34252075366](https://github.com/service-lasso/service-lasso/actions/runs/34252075366) attempt 2, npm [run 34252079559](https://github.com/service-lasso/service-lasso/actions/runs/34252079559), published-package [run 34256052728](https://github.com/service-lasso/service-lasso/actions/runs/34256052728) |
| Forged actor, permission, or confirmation | Authority derives from the trusted runtime request context; body spoofing is ignored/rejected; risky actions require server-bound confirmation and idempotency | Published-package `trustedLifecycle`, `adminBrowser`, `durableAudit`, and exactly-once mutation records |
| Secret leakage through UI, logs, evidence, diagnostics, or storage | Values remain inside Broker except explicitly authorized one-time/controlled reveal; retained evidence is metadata-only; sentinel checks cover browser, audit, diagnostics, browser storage, routes, and support surfaces | Published-package `noLeak` on all platforms; exact Admin focused browser 7/7 |
| IPC impersonation or remote exposure | Named-pipe/Unix-socket transport, authenticated launch identity, allowlisted method/path set, loopback proxy boundary, fail-closed unavailable/auth outcomes | Release Qualification [run 34250860854](https://github.com/service-lasso/service-lasso/actions/runs/34250860854) and published-package run 34256052728 |
| Replay or duplicate mutation | Operation identifiers, single-use confirmation, exact plan revalidation, idempotency, mutation retry disabled, aggregate mutation-count verification | Each platform record reports `brokerRestart: 1`, `providerMigrationApply: 1`, and `mutationRetry: false` |
| Partial rotation or consumer failure | Stage/activate/owner action/rollback/retire state machine, source remains authoritative on denied/unavailable provider outcomes, restart persistence | Published-package `comprehensiveLifecycle`, `rollback`, `persistence`, and `brokerContinuity` |
| Unauthorized reveal or destructive action | Separate permissions, audit reason, explicit confirmation, bounded reveal, decommission plan and recoverable tombstone | Admin release browser run and final published-package browser lifecycle |
| Brute force or denial scoped too broadly | Per-identity/per-operation/per-reference lockouts, five-minute bounded cooldown, exact-scope confirmed clear, unrelated reads remain available | Windows `localOperatorLockout` plus durable lockout event in run 34256052728 |
| Corrupt state, wrapper, backup, or recovery input | Authenticated encryption, key/store matching, integrity verification, atomic replacement, restore plan/apply, fail-closed locked/degraded outcomes | Published-package backup/restore/key-rotation/restart scenarios and Broker recovery tests |
| Path, archive, or process-boundary escape | Canonical destinations, checksum before extraction, archive traversal controls, owned-process fingerprints, Windows Job containment, bounded cleanup convergence | Release Qualification and published-package `productionAcquisition`/`cleanupConvergence` |
| Audit tampering or omission | Hash-chained durable metadata-only audit; protected mutations fail when required audit persistence is unavailable | Release Qualification Broker IPC outcomes and published-package `durableAudit` |

## Cryptography and key lifecycle

- Local secret payloads use AES-256-GCM with a portable master key. Key ids are
  fingerprints; plaintext keys and secret values are excluded from status,
  audit, event, diagnostic, and retained evidence.
- On Windows, the local copy of the portable master key uses current-user DPAPI
  with Service Lasso entropy and a converged DACL limited to the current user
  and LocalSystem. Reparse traversal, extra/partial ACL entries, owner drift that
  cannot be repaired, or post-change validation failure remain fail-closed.
- macOS and Linux do not claim an OS keychain wrapper in this release. They use
  explicit portable-key/recovery input and report the local wrapper provider as
  unsupported rather than silently weakening custody.
- Break-glass recovery uses Shamir threshold shares. A share may be encrypted
  to one explicit `age` X25519 recipient; only recipient fingerprints and safe
  policy metadata are retained. PGP bootstrap is unavailable and excluded.
- Backup restore requires integrity verification and an exact confirmed plan.
  Master-key rotation rewraps encrypted material, requires restart verification,
  and prompts for a newly created and verified backup/recovery set.
- Key or recovery loss can make data irrecoverable. Release 1 does not escrow
  portable keys or private recovery identities and cannot recover them from
  logs, GitHub artifacts, or Service Admin.

## Identity, IPC, and abuse cases to reproduce

The reviewer should attempt at least the following negative cases against an
isolated temporary store: missing/invalid local API token; forged body actor;
untrusted remote origin; mismatched ingress headers; viewer mutation; stale or
replayed plan; reused confirmation/idempotency key; reveal without reason or
confirmation; secret-like audit reason; oversized body; unknown or disallowed
Broker method/path; wrong IPC peer; duplicate or redirected checksum/provenance;
wrong-head attestation; archive traversal; wrong master key; corrupt ciphertext,
wrapper, recovery share, or backup; insufficient recovery quorum; provider
denied/unavailable during apply; owner action failure; audit unavailable; Broker
stop during lifecycle; restart and cleanup under process identity change.

Expected behavior is typed failure, no unauthorized mutation, no secret output,
no broad lockout, and recoverable state where the operation contract promises
rollback or tombstone recovery.

## Dependency, SBOM, and supply-chain state

- Core exact release graph at `b0c3a1be`: `npm audit --omit=dev --audit-level=low`
  reports zero vulnerabilities across 143 production dependencies. Full
  `npm audit` reports zero findings of any severity (1471 dependency entries).
  Locked remediations are `fast-uri@3.1.7` and `qs@6.16.0`.
- Admin exact release graph at `f015b44`: `pnpm audit --prod` reports no known
  vulnerabilities. The shipped Admin SBOMs do not contain `@humanfs/node`,
  `browserslist`, `@faker-js/faker`, or Cypress `qs`. Admin `develop` still has
  Dependabot alert [#61](https://github.com/service-lasso/lasso-serviceadmin/security/dependabot/61)
  (`@humanfs/node`, development scope) and CodeQL `js/request-forgery` [#2](https://github.com/service-lasso/lasso-serviceadmin/security/code-scanning/2)
  on Admin `develop` `5beac027…`, not on released Admin bytes. Full Admin
  `pnpm audit` (including dev) currently reports three high and three moderate
  advisories in build/test packages; those are not this production graph.
- Broker exact release source and native shipped Windows executables pass
  `govulncheck`. Zero reachable and zero imported-package vulnerabilities.
  Three module-only advisories in required `golang.org/x/crypto@v0.55.0` are
  not called: `GO-2026-5932` (`openpgp`, PGP excluded), plus `GO-2026-6354` and
  `GO-2026-6355` (`crypto/ssh` DoS). Broker does not import `golang.org/x/crypto/ssh`.
- Core GitHub readback at packet assembly: zero open Dependabot, code-scanning,
  and secret-scanning alerts. Broker open-alert counts are zero. Admin open
  alerts are the develop-only residuals above, not the reused release SHA.
- Every Core platform archive includes or is paired with a CycloneDX SBOM,
  checksum manifest, provenance/attestation, and exact asset inventory. Public
  GitHub API digests equal `SHA256SUMS.txt` for every listed file.

## Repository and publication control readback

Live API readback on 2026-09-08 reports the protected `release` environment
still requires reviewer `wildone`, with `deployment_branch_policy` limited to
protected branches. Publication was dispatched from `develop` at
`b0c3a1bef977c26d956d3d827025fe8c39c17799`. `node scripts/verify-core-release-authority.mjs`
read back required code-owner reviews, `qualify-release`, administrator
enforcement, no force-push, read-only default workflow permissions, SHA pinning,
and the `release` environment.

Core `develop` protection, CODEOWNERS, SECURITY.md, and selected-action SHA
pinning remain the `AC-7F` authority boundary. Secret-scanning validity checks
remain unavailable on the current repository/org entitlement and are not claimed
enabled.

Publication runs:

- Hosted Release Qualification
  [34250860854](https://github.com/service-lasso/service-lasso/actions/runs/34250860854)
  workflow_dispatch at exact SHA, terminal green, including production and
  tooling audits.
- GitHub Release Artifact
  [34252075366](https://github.com/service-lasso/service-lasso/actions/runs/34252075366)
  attempt 1 failed at CI `upload-artifact` finalize (403 intermediary) after
  attestations succeeded and before `gh release create`. That failed attempt
  did not create a release. Attempt 2 created immutable tag `2026.9.8-b0c3a1b`
  and verified asset policy. The failed attempt is not converted into a pass.
- Publish Package
  [34252079559](https://github.com/service-lasso/service-lasso/actions/runs/34252079559)
  attempt 1 published `+ @service-lasso/service-lasso@2026.9.8-b0c3a1b` with
  provenance; consumer verify 404'd during registry processing. Attempt 2
  verified the live package after it became visible. No second publish of a new
  version occurred.
- Published-package qualification
  [34256052728](https://github.com/service-lasso/service-lasso/actions/runs/34256052728)
  attempt 1 only; `mutationRetry: false`.

The independent reviewer must bind the final decision to the exact head of this
packet revision as well as the immutable component identities above. Approval of
the rejected `1f4ec40` set, of packet PR `#1210` / `c341552`, or of later
unreviewed `develop` bytes is not this review.

## Static, dynamic, and fuzz evidence

- CodeQL is green at this Core SHA: push run
  [33901415635](https://github.com/service-lasso/service-lasso/actions/runs/33901415635)
  and later scheduled run
  [34157579985](https://github.com/service-lasso/service-lasso/actions/runs/34157579985)
  while `develop` remained at `b0c3a1be`. Exact Admin release CodeQL run
  `33437554078` remains the released-Admin record. Admin `develop` CodeQL alert
  `#2` is out of this release set.
- Broker release qualification performs native source and both-binary
  `govulncheck` on each target operating system in
  [run 33376912641](https://github.com/service-lasso/lasso-secretsbroker/actions/runs/33376912641).
  Live 2026-09-08 `govulncheck` at the same SHA remains zero reachable / zero
  imported.
- Core hosted Release Qualification passed the complete release suite, real
  Broker IPC, package/release policy, provenance, negative acquisition, and
  aggregate gates in
  [run 34250860854](https://github.com/service-lasso/service-lasso/actions/runs/34250860854).
- Exact Admin release real-browser qualification passed on Windows, Linux, and
  macOS in
  [run 33437554122](https://github.com/service-lasso/lasso-serviceadmin/actions/runs/33437554122).
- A focused exact-release Admin replay passed 57/57 navigation, page/table,
  topology, redaction, and release-surface assertions plus 7/7 Chromium browser
  cases.
- Broker `FuzzSecurityContractParsers` ran for 30 seconds against the exact
  release source: 785,686 executions, 43 newly interesting inputs, no crash or
  failure. This is bounded pre-review fuzz evidence, not continuous-fuzzing or
  proof of absence of parser defects.

## Published three-platform acceptance

[Run 34256052728](https://github.com/service-lasso/service-lasso/actions/runs/34256052728)
is terminal green at exact Core `b0c3a1bef977c26d956d3d827025fe8c39c17799`.
Windows, Linux, macOS, and aggregate jobs passed. GitHub retained exactly three
nonempty, unexpired 90-day records (expire `2026-12-07T17:16:03Z`):

- win32 artifact `10068454792` (1357 bytes)
- darwin artifact `10068290629` (1345 bytes)
- linux artifact `10068155187` (1344 bytes)

Each record binds Core `2026.9.8-b0c3a1b`, npm integrity/latest, Admin
`2026.8.31-f015b44`, Broker `2026.8.31-f340883`, harness
`f7abf981f8f0bbbbd7fdf352237fd84950d95ca3`, workflow SHA `b0c3a1be`, attempt 1,
`mutationRetry: false`, `acquisitionRetry: false`, `startupRetry: false`,
`brokerRestart: 1`, `providerMigrationApply: 1`, all eleven negative acquisition
cases `success`, and every applicable first-run, lifecycle, dashboard,
continuity, trusted-action, provider, migration, rollback, persistence, audit,
no-leak, stopped-service, and cleanup scenario `success`. Windows also records
`localOperatorLockout: success`.

Historical published-package failures remain `failure` and were not retried as
mutations: `33500138538`, `33503750329`, `33506286697`. The rejected-set green
run `33509489660` stays evidence for the rejected identity only. `#1209` later
closed via PR `#1227` is included in this SHA as post-reject `develop` source;
it does not convert those historical failures into passes.

## Recovery and incident response

Operators must keep the portable key or threshold recovery shares separately
from the encrypted store, wrappers, backups, and host. Before key rotation they
must verify a current backup and recovery policy; immediately after rotation
they must create and verify a replacement set. A restore is not successful
until integrity, key matching, Broker restart, inventory, linked consumer, and
audit continuity pass.

Suspected disclosure requires stopping affected services, preserving
metadata-only audit and process evidence, rotating the affected secret and
owner action, invalidating exposed operator/provider credentials, verifying
consumer rollback/restart, and publishing a replacement release if shipped
bytes or dependencies are affected. Report vulnerabilities through each
repository's `SECURITY.md`; never place values, keys, recovery shares, tokens,
raw logs, environment dumps, or provider response bodies in issues or artifacts.

## Explicit non-claims

Release 1 does not claim PGP bootstrap; external-provider GA parity; bulk
campaigns; full Secrets Sync apply; scheduled rotation; Broker mutation MCP;
HSM custody; FIPS validation; MFA; macOS/Linux OS-keychain custody; protection
from a compromised administrator/kernel/operator or recovery quorum; recovery
without retained key/share material; continuous fuzzing; formal verification;
or protection from unknown future vulnerabilities.

## Independent reproduction

Use the [independent Windows PC test plan](./release-1-independent-windows-test-plan.md)
for the exact artifact, npm, runtime, UI, lifecycle, recovery, audit, persistence,
failure-path, and metadata-only result record on a clean Windows 11 x64 host.

1. Verify the three release objects are immutable and resolve to the exact SHAs
   in this packet. Download asset inventories, checksum manifests, SBOMs, and
   attestations through the GitHub API; compare every public asset digest.
2. Verify npm `2026.9.8-b0c3a1b` has the exact `gitHead`, `latest` identity,
   integrity, tarball bytes, and provenance shown by Core publish run
   `34252079559`.
3. In isolated clean consumers on Windows, Linux, and macOS, acquire all three
   publications through the production path and run the unchanged published
   package workflow at Core `b0c3a1be…`; require all four jobs green and
   exactly three current-run records.
4. Parse each record and require `outcome: success`, `mutationRetry: false`, all
   negative proofs/scenarios `success`, and exact mutation counts. Retain no
   captures, credentials, paths, raw logs, configuration, environment values,
   or secret values.
5. Re-run exact production audits, Broker source/native binary scans, CodeQL,
   the focused parser fuzz target, Admin release-surface/browser checks, and the
   abuse cases above. Use temporary stores and destroy test secret material
   through the harness cleanup path. Do not treat the 2026-09-08 reject, or any
   later source merge, as covering unreviewed published bytes.

## Reviewer decision record

The independent reviewer must append or link a signed decision containing:

- reviewer name/organization and independence statement;
- review date, packet commit, and exact component identities;
- methods and platforms exercised;
- findings with severity, reproduction, disposition, and residual risk;
- explicit `approve`, `approve with accepted residuals`, or `reject` decision;
- confirmation that no technical gap was reclassified as green by waiver.

Until that record exists and every blocking finding is resolved, Release 1 is
not approved for `develop`-to-`main` promotion or GA publication.

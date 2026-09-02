# Release 1 independent security review packet

Status: ready for independent review; external approval not yet recorded  
Tracking issue: [service-lasso/service-lasso#1208](https://github.com/service-lasso/service-lasso/issues/1208)  
Acceptance authority: `SPEC-007` `AC-7F` through `AC-7H`

## Exact review scope

| Component | Immutable identity | Publication |
| --- | --- | --- |
| Core | `1f4ec40f13fe3867b24ca901c42fe31c69e01e8d`; `2026.9.1-1f4ec40` | [GitHub release](https://github.com/service-lasso/service-lasso/releases/tag/2026.9.1-1f4ec40) and `@service-lasso/service-lasso@2026.9.1-1f4ec40` |
| Service Admin | `f015b4445b0526546a309301270186a697588166`; `2026.8.31-f015b44` | [GitHub release](https://github.com/service-lasso/lasso-serviceadmin/releases/tag/2026.8.31-f015b44) |
| Secrets Broker | `f340883056ec3cf74b535fb46490b39382e8c823`; `2026.8.31-f340883` | [GitHub release](https://github.com/service-lasso/lasso-secretsbroker/releases/tag/2026.8.31-f340883) |
| Cross-repository Admin harness | `f7abf981f8f0bbbbd7fdf352237fd84950d95ca3` | Pinned by the Core published-package workflow |

Review applies only to these bytes, manifests, checksums, SBOMs, attestations,
and evidence. A replacement archive, npm version, commit, workflow, dependency
graph, or security-control change requires delta review and fresh qualification.

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
| Artifact substitution or downgrade | Exact immutable tags, SHA-256 manifests, checksum-before-extraction, release/API identity checks, SLSA provenance, npm integrity and `gitHead`, and eleven fail-closed negative acquisition cases | Core [release run 33496660751](https://github.com/service-lasso/service-lasso/actions/runs/33496660751), npm [run 33498620912](https://github.com/service-lasso/service-lasso/actions/runs/33498620912), published-package [run 33509489660](https://github.com/service-lasso/service-lasso/actions/runs/33509489660) |
| Forged actor, permission, or confirmation | Authority derives from the trusted runtime request context; body spoofing is ignored/rejected; risky actions require server-bound confirmation and idempotency | Published-package `trustedLifecycle`, `adminBrowser`, `durableAudit`, and exactly-once mutation records |
| Secret leakage through UI, logs, evidence, diagnostics, or storage | Values remain inside Broker except explicitly authorized one-time/controlled reveal; retained evidence is metadata-only; sentinel checks cover browser, audit, diagnostics, browser storage, routes, and support surfaces | Published-package `noLeak` on all platforms; exact Admin focused browser 7/7 |
| IPC impersonation or remote exposure | Named-pipe/Unix-socket transport, authenticated launch identity, allowlisted method/path set, loopback proxy boundary, fail-closed unavailable/auth outcomes | Release Qualification [run 33495376111](https://github.com/service-lasso/service-lasso/actions/runs/33495376111) and published-package run 33509489660 |
| Replay or duplicate mutation | Operation identifiers, single-use confirmation, exact plan revalidation, idempotency, mutation retry disabled, aggregate mutation-count verification | Each platform record reports `brokerRestart: 1`, `providerMigrationApply: 1`, and `mutationRetry: false` |
| Partial rotation or consumer failure | Stage/activate/owner action/rollback/retire state machine, source remains authoritative on denied/unavailable provider outcomes, restart persistence | Published-package `comprehensiveLifecycle`, `rollback`, `persistence`, and `brokerContinuity` |
| Unauthorized reveal or destructive action | Separate permissions, audit reason, explicit confirmation, bounded reveal, decommission plan and recoverable tombstone | Admin release browser run and final published-package browser lifecycle |
| Brute force or denial scoped too broadly | Per-identity/per-operation/per-reference lockouts, five-minute bounded cooldown, exact-scope confirmed clear, unrelated reads remain available | Windows `localOperatorLockout` plus durable lockout event in run 33509489660 |
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

- Core exact release graph: `npm audit --omit=dev` reports zero vulnerabilities
  across 143 production dependencies.
- Admin exact release graph: `pnpm audit --prod` reports zero advisories across
  292 production dependencies.
- Broker exact release source and native shipped executables pass
  `govulncheck`. The main binary reports zero reachable and zero imported-package
  vulnerabilities. One module-only advisory, `GO-2026-5932`, is in the
  unimported `golang.org/x/crypto/openpgp` package; the shipped code does not call
  it and PGP bootstrap is excluded. Helper binaries report no vulnerabilities.
- GitHub readback reports zero open Dependabot, code-scanning, and secret-scanning
  alerts in all three repositories at packet preparation time.
- Every platform archive includes or is paired with a CycloneDX SBOM, checksum
  manifest, provenance/attestation, and exact asset inventory. Public download
  bytes and retained workflow bytes were digest compared.

## Repository and publication control readback

Live API readback on 2026-09-02 reports an active Release 1 branch ruleset in
each repository. Core `develop`, Admin `develop`, and Broker `main` all require a
pull request, one approval, stale-review dismissal, CODEOWNERS review,
last-push approval, strict terminal-green checks, conversation resolution, and
linear history; administrator enforcement is enabled and force-push/deletion
are disabled. Core ruleset `21891323`, Admin ruleset `21891335`, and Broker
ruleset `21891331` are active.

Each repository has a read-back `CODEOWNERS` file, `SECURITY.md`, selected-action
GitHub Actions policy with immutable-SHA pinning required, private vulnerability
reporting, secret scanning, push protection, Dependabot security updates, and a
protected `release` environment requiring reviewer `wildone`. Open Dependabot,
code-scanning, and secret-scanning alert counts are zero in all three
repositories. Requests to enable secret-scanning validity checks were accepted
by the repository API, but subsequent readback remained `disabled`; the packet
therefore records that control as unavailable on the current repository/org
entitlement and does not claim it is enabled.

The initial packet PR
[#1210](https://github.com/service-lasso/service-lasso/pull/1210) merged at
`c341552542a432f1e9951140ee18188c0e68d4f5`. Exact-merge Docs
[33515497884](https://github.com/service-lasso/service-lasso/actions/runs/33515497884),
CodeQL [33515497909](https://github.com/service-lasso/service-lasso/actions/runs/33515497909),
MCP Product Acceptance
[33515497989](https://github.com/service-lasso/service-lasso/actions/runs/33515497989),
and Release Qualification
[33515498018](https://github.com/service-lasso/service-lasso/actions/runs/33515498018)
are terminal green. The latter two retain three and eight exact-SHA artifacts,
respectively. The independent reviewer must bind the final decision to the exact
head of this final-readback packet revision as well as the immutable component
identities above.

## Static, dynamic, and fuzz evidence

- CodeQL is green at the exact Core and Admin release heads. Broker release
  qualification performs native source and both-binary `govulncheck` on each
  target operating system in [run 33376912641](https://github.com/service-lasso/lasso-secretsbroker/actions/runs/33376912641).
- Core exact-merge Release Qualification passed the complete release suite,
  real Broker IPC, package/release policy, provenance, negative acquisition,
  and aggregate gates in [run 33495376111](https://github.com/service-lasso/service-lasso/actions/runs/33495376111).
- Exact Admin release real-browser qualification passed on Windows, Linux, and
  macOS in [run 33437554122](https://github.com/service-lasso/lasso-serviceadmin/actions/runs/33437554122).
- A focused exact-release Admin replay passed 57/57 navigation, page/table,
  topology, redaction, and release-surface assertions plus 7/7 Chromium browser
  cases.
- Broker `FuzzSecurityContractParsers` ran for 30 seconds against the exact
  release source: 785,686 executions, 43 newly interesting inputs, no crash or
  failure. This is bounded pre-review fuzz evidence, not continuous-fuzzing or
  proof of absence of parser defects.

## Published three-platform acceptance

[Run 33509489660](https://github.com/service-lasso/service-lasso/actions/runs/33509489660)
is terminal green at exact Core `1f4ec40f13fe3867b24ca901c42fe31c69e01e8d`.
Windows, Linux, macOS, and aggregate jobs passed. GitHub retained exactly three
nonempty, unexpired 90-day records. Each record binds the same immutable Core,
Admin, Broker, npm integrity, and workflow revision; all eleven negative
acquisition cases pass; every applicable first-run, lifecycle, dashboard,
continuity, trusted-action, provider, migration, rollback, persistence, audit,
no-leak, stopped-service, and cleanup scenario is `success`.

Earlier dispatches exposed independent Windows npm/Broker-start and macOS
readiness intermittency. They remain historical evidence, were not converted to
passes, and did not mutate after failed preconditions. Exact Windows first-run
reproduction then passed twice in isolated registries, followed by the clean
three-platform run above with no mutation retry. The reviewer should treat
cross-platform startup/qualification reliability as an explicit residual to
assess, not as erased history. Post-release hardening is tracked in
[Core issue #1209](https://github.com/service-lasso/service-lasso/issues/1209).

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

1. Verify the three release objects are immutable and resolve to the exact SHAs
   in this packet. Download asset inventories, checksum manifests, SBOMs, and
   attestations through the GitHub API; compare every public asset digest.
2. Verify npm `2026.9.1-1f4ec40` has the exact `gitHead`, `latest` identity,
   integrity, tarball bytes, and provenance shown by Core publish run
   `33498620912`.
3. In isolated clean consumers on Windows, Linux, and macOS, acquire all three
   publications through the production path and run the unchanged published
   package workflow at Core `1f4ec40f...`; require all four jobs green and
   exactly three current-run records.
4. Parse each record and require `outcome: success`, `mutationRetry: false`, all
   negative proofs/scenarios `success`, and exact mutation counts. Retain no
   captures, credentials, paths, raw logs, configuration, environment values,
   or secret values.
5. Re-run exact production audits, Broker source/native binary scans, CodeQL,
   the focused parser fuzz target, Admin release-surface/browser checks, and the
   abuse cases above. Use temporary stores and destroy test secret material
   through the harness cleanup path.

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

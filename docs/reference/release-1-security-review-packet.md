# Release 1 independent security review packet

Status: AC-7H **approve with accepted residuals** for Core/npm
`2026.9.22-f3de461` ([#1402 decision record](https://github.com/service-lasso/service-lasso/issues/1402#issuecomment-5781828161),
2026-09-23), subject to the recorded single-operator control limitation. The
prior AC-7H **approve with accepted residuals** covered Core/npm
`2026.9.11-462f837` only ([#1151 comment](https://github.com/service-lasso/service-lasso/issues/1151#issuecomment-5645610452),
2026-09-12) and does not cover these later bytes.
Review request: [service-lasso/service-lasso#1402](https://github.com/service-lasso/service-lasso/issues/1402)
Prior packet issue: [service-lasso/service-lasso#1208](https://github.com/service-lasso/service-lasso/issues/1208)
Acceptance authority: `SPEC-007` `AC-7F` through `AC-7H`

> **Related:** [Delivery-owner evidence readback](./release-1-independent-security-review-report.md)
> records technical verification of the **rejected** `2026.9.1-1f4ec40` set.
> See [GA decision](./release-1-ga-decision.md) for live publication state.

## Exact review scope

| Component | Immutable identity | Publication |
| --- | --- | --- |
| Core | `f3de46166c03d3feca5b27fa72f941e0ce8472ae`; `2026.9.22-f3de461` | [GitHub release](https://github.com/service-lasso/service-lasso/releases/tag/2026.9.22-f3de461) ID `393972333` and `@service-lasso/service-lasso@2026.9.22-f3de461` (integrity `sha512-Y9sawMjrZkPd95fNHCWHGHjT6CL4cPkYr7i+BvZhImJvU7agiHCzpuC8/X7Tlgip+KD7iRQA8EAIEJeqZZz4DA==`, shasum `ce8672a6705ca1b4a9dffb0c2b2d3131b3da8ffb`) |
| Service Admin | `f015b4445b0526546a309301270186a697588166`; `2026.8.31-f015b44` | [GitHub release](https://github.com/service-lasso/lasso-serviceadmin/releases/tag/2026.8.31-f015b44) |
| Secrets Broker | `f340883056ec3cf74b535fb46490b39382e8c823`; `2026.8.31-f340883` | [GitHub release](https://github.com/service-lasso/lasso-secretsbroker/releases/tag/2026.8.31-f340883) |
| Cross-repository Admin harness | `f7abf981f8f0bbbbd7fdf352237fd84950d95ca3` | Pinned by the Core published-package workflow |

Previously approved identities retained as history: Core/npm
`2026.9.11-462f837` / `462f837b25224e98103296b4597807b5beea00c5` (Lane AN,
2026-09-12). Rejected identities that this packet does **not** approve: Core/npm
`2026.9.1-1f4ec40` / `1f4ec40f13fe3867b24ca901c42fe31c69e01e8d`; packet
`#1210` / `c341552`; docs PR `#1232` / `2026.9.8-b0c3a1b`.

Review applies only to these bytes, manifests, checksums, SBOMs, attestations,
and evidence. A replacement archive, npm version, commit, workflow, dependency
graph, or security-control change requires delta review and fresh qualification.

## Candidate revision and gate evidence

Candidate `2026.9.22-f3de461` contains 84 commits after the prior approved
`462f837`, including `#1241` isolation parsing and fail-closed `require`, `#1401`
restart-path isolation fail-closed (the prior review's required next identity),
`#1387` Linux PostgreSQL library resolution, `#1392` Linux process enumeration,
`#1394` Windows sidecar replacement, `#1379` portable newcomer proof bundles, and
retained lifecycle diagnostics from `#1391`, `#1396`, and `#1398`.

| Gate on the exact SHA | Run |
| --- | --- |
| Release Qualification | [35758557194](https://github.com/service-lasso/service-lasso/actions/runs/35758557194) |
| MCP Product Acceptance | [35758557293](https://github.com/service-lasso/service-lasso/actions/runs/35758557293) |
| Packaged Admin Lifecycle Acceptance | [35758557458](https://github.com/service-lasso/service-lasso/actions/runs/35758557458) |
| CodeQL | [35758557221](https://github.com/service-lasso/service-lasso/actions/runs/35758557221) |
| Release Artifact | [35758779276](https://github.com/service-lasso/service-lasso/actions/runs/35758779276) |
| Publish Package | [35758782877](https://github.com/service-lasso/service-lasso/actions/runs/35758782877) |
| Published Package Three-OS Qualification | [35763042401](https://github.com/service-lasso/service-lasso/actions/runs/35763042401) |

Unbundled archive SHA-256: win32
`10287449ee990d1b66856a5e37138cc4434ef080033b085558bf265247d07e3d`;
linux/darwin `5352efc24b2b71170c0c11b48203357f5301172500187e2f2090d989348d6f49`.
The Publish Package run's production and tooling audit steps passed, and the npm
publication reports a signed provenance statement. Attempt 1 of the Publish
Package run failed at its `Verify published package from npm` step because the
new version was not yet visible through the registry propagation window; the
publish step itself had already reported
`+ @service-lasso/service-lasso@2026.9.22-f3de461`. Only the failed job was
rerun (the exists-guard skipped republishing) and attempt 2 passed with
`{"ok":true,"classification":"verified"}`. The attempt-1 failure is retained as
a reliability residual and is not converted into a pass.

AC-7H **approve with accepted residuals** was recorded for this candidate on
2026-09-23 in the [#1402 decision record](https://github.com/service-lasso/service-lasso/issues/1402#issuecomment-5781828161),
including the single-operator control limitation and the retained residuals.
No GA claim may assert enforced independent branch approval or review on
Core/Admin `develop`; independence is session role only.

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
| Artifact substitution or downgrade | Exact immutable tags, SHA-256 manifests, checksum-before-extraction, release/API identity checks, SLSA provenance, npm integrity and `gitHead`, and eleven fail-closed negative acquisition cases | Core [release run 34614413642](https://github.com/service-lasso/service-lasso/actions/runs/34614413642), npm registry readback of `2026.9.11-462f837` (workflow [34614418000](https://github.com/service-lasso/service-lasso/actions/runs/34614418000) attempt 1 stays failure), published-package [run 34625492347](https://github.com/service-lasso/service-lasso/actions/runs/34625492347) |
| Forged actor, permission, or confirmation | Authority derives from the trusted runtime request context; body spoofing is ignored/rejected; risky actions require server-bound confirmation and idempotency | Published-package `trustedLifecycle`, `adminBrowser`, `durableAudit`, and exactly-once mutation records |
| Secret leakage through UI, logs, evidence, diagnostics, or storage | Values remain inside Broker except explicitly authorized one-time/controlled reveal; retained evidence is metadata-only; sentinel checks cover browser, audit, diagnostics, browser storage, routes, and support surfaces | Published-package `noLeak` on all platforms; exact Admin focused browser 7/7 |
| IPC impersonation or remote exposure | Named-pipe/Unix-socket transport, authenticated launch identity, allowlisted method/path set, loopback proxy boundary, fail-closed unavailable/auth outcomes | Release Qualification [run 34469524380](https://github.com/service-lasso/service-lasso/actions/runs/34469524380) and published-package run 34625492347 |
| Replay or duplicate mutation | Operation identifiers, single-use confirmation, exact plan revalidation, idempotency, mutation retry disabled, aggregate mutation-count verification | Each platform record reports `brokerRestart: 1`, `providerMigrationApply: 1`, and `mutationRetry: false` |
| Partial rotation or consumer failure | Stage/activate/owner action/rollback/retire state machine, source remains authoritative on denied/unavailable provider outcomes, restart persistence | Published-package `comprehensiveLifecycle`, `rollback`, `persistence`, and `brokerContinuity` |
| Unauthorized reveal or destructive action | Separate permissions, audit reason, explicit confirmation, bounded reveal, decommission plan and recoverable tombstone | Admin release browser run and final published-package browser lifecycle |
| Brute force or denial scoped too broadly | Per-identity/per-operation/per-reference lockouts, five-minute bounded cooldown, exact-scope confirmed clear, unrelated reads remain available | Windows `localOperatorLockout` plus durable lockout event in run 34625492347 |
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

- Core candidate `f3de461`: the Publish Package run's production
  (`npm audit --omit=dev --audit-level=low`) and tooling
  (`npm audit --audit-level=high`) steps passed with zero vulnerabilities, and an
  independent production audit of the candidate lockfile reported zero
  vulnerabilities. The prior `462f837` graph reported zero across 143 production
  dependencies; that count is historical.
- Admin exact release graph: `pnpm audit --prod` reports zero advisories across
  292 production dependencies.
- Broker exact release source and native shipped executables pass
  `govulncheck`. The main binary reports zero reachable and zero imported-package
  vulnerabilities. One module-only advisory, `GO-2026-5932`, is in the
  unimported `golang.org/x/crypto/openpgp` package; the shipped code does not call
  it and PGP bootstrap is excluded. Helper binaries report no vulnerabilities.
- GitHub readback on 2026-09-23 reports zero open Dependabot, code-scanning, and
  secret-scanning alerts for Core and Broker. Admin reports zero Dependabot and
  secret-scanning alerts with one open **critical** code-scanning alert on its
  development head, retained as the sibling-repo hygiene residual described in
  the control readback above.
- Every platform archive includes or is paired with a CycloneDX SBOM, checksum
  manifest, provenance/attestation, and exact asset inventory. Public download
  bytes and retained workflow bytes were digest compared.

## Repository and publication control readback

Live API readback on 2026-09-23 reports active Release 1 branch rulesets in
all three repositories. Broker `main` is protected by its classic branch
protection together with active ruleset `21891331`; the effective controls
require a pull request, one approval, stale-review dismissal, CODEOWNERS review,
last-push approval, strict terminal-green checks, conversation resolution, and
linear history. Core `develop` (ruleset `21891323`, updated 2026-09-15) and Admin
`develop` (ruleset `21891335`, updated 2026-09-15) are active with linear
history, deletion and non-fast-forward protection, and administrator
enforcement, but currently set `required_approving_review_count` 0,
`require_code_owner_review` false, `require_last_push_approval` false, and no
required status checks; classic `develop` protection also reports no required
status checks. The delivery owner is the only configured reviewer and
CODEOWNERS owner and cannot self-approve, so approval and last-push controls are
not currently enforced on Core/Admin `develop`. This is recorded as a
control-limitation residual for the reviewer and the operator, not as a
satisfied control.

Each repository has a read-back `CODEOWNERS` file, `SECURITY.md`, selected-action
GitHub Actions policy with immutable-SHA pinning required, private vulnerability
reporting, secret scanning, push protection, Dependabot security updates, and a
protected `release` environment requiring reviewer `wildone`. Open alert counts
on 2026-09-23: Core Dependabot/code-scanning/secret-scanning 0/0/0; Broker
0/0/0; Admin Dependabot 0 and secret-scanning 0, with one open **critical**
code-scanning alert (`js/request-forgery`, `runtime/server.js`) on Admin
`develop` head `01d4438`, not on the pinned release `f015b44`; it is retained as
a sibling-repo development-scope hygiene residual and is not a Core
production-graph finding. Requests to enable secret-scanning validity checks
were accepted by the repository API, but subsequent readback remained
`disabled`; the packet therefore records that control as unavailable on the
current repository/org entitlement and does not claim it is enabled.

The rejected packet PR
[#1210](https://github.com/service-lasso/service-lasso/pull/1210) merged at
`c341552542a432f1e9951140ee18188c0e68d4f5` and remains historical. This
replacement packet is a new docs PR targeting `develop` and must be signed
against its own merge or head commit plus Core/npm `2026.9.11-462f837`.
Hosted Release Qualification on that SHA is
[34469524380](https://github.com/service-lasso/service-lasso/actions/runs/34469524380).
The independent reviewer must not implement product code, merge, publish, or
promote `main`.

## Static, dynamic, and fuzz evidence

- CodeQL is green at the exact Core and Admin release heads. Broker release
  qualification performs native source and both-binary `govulncheck` on each
  target operating system in [run 33376912641](https://github.com/service-lasso/lasso-secretsbroker/actions/runs/33376912641).
- Core exact-SHA Release Qualification passed the complete release suite,
  real Broker IPC, package/release policy, provenance, negative acquisition,
  and aggregate gates in [run 34469524380](https://github.com/service-lasso/service-lasso/actions/runs/34469524380).
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

[Run 34625492347](https://github.com/service-lasso/service-lasso/actions/runs/34625492347)
is terminal green at exact Core `462f837b25224e98103296b4597807b5beea00c5`
(attempt 1). Windows, Linux, macOS, and aggregate jobs passed. GitHub retained
exactly three nonempty, unexpired 90-day records (`10275075407` win32,
`10274393550` darwin, `10274044042` linux; expire `2026-12-10`). Each record
binds Core `2026.9.11-462f837`, npm integrity/latest, Admin `2026.8.31-f015b44`,
Broker `2026.8.31-f340883`, and workflow SHA `462f837`; all eleven negative
acquisition cases pass; every applicable first-run, lifecycle, dashboard,
continuity, trusted-action, provider, migration, rollback, persistence, audit,
no-leak, stopped-service, and cleanup scenario is `success`;
`mutationRetry: false`; `brokerRestart: 1`; `providerMigrationApply: 1`.

Earlier dispatches and historical published-package failures `33500138538`,
`33503750329`, and `33506286697` remain failures. The rejected-identity clean
run `33509489660` does not qualify these bytes. npm verify run `34614418000`
stays failure. The reviewer should treat cross-platform startup/qualification
reliability as an explicit residual to assess, not as erased history.

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
2. Verify npm `2026.9.22-f3de461` has the exact `gitHead`
   `f3de46166c03d3feca5b27fa72f941e0ce8472ae`, `latest` identity, integrity
   `sha512-Y9sawMjrZkPd95fNHCWHGHjT6CL4cPkYr7i+BvZhImJvU7agiHCzpuC8/X7Tlgip+KD7iRQA8EAIEJeqZZz4DA==`,
   and tarball bytes. Treat historical npm failures as failures, not converted
   green.
3. In isolated clean consumers on Windows, Linux, and macOS, acquire all three
   publications through the production path and require published-package
   [run 35763042401](https://github.com/service-lasso/service-lasso/actions/runs/35763042401)
   all four jobs green and exactly three current-run records.
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

Lane AN appended approve-with-accepted-residuals on 2026-09-12 for Core/npm
`2026.9.11-462f837` / `462f837b25224e98103296b4597807b5beea00c5` and packet
merge `155d643256ee050299883d1634be067a1ff4ebce`. Residuals recorded there
remain in force: npm run `34614418000` stays red; historical published-package
failures stay failures; `gh`=`wildone` is also delivery owner; packet merge
includes Dependabot not in that Core SHA.

Operator publication of `2026.9.13-1bffd1b` / `1bffd1bca177de213e3a0bd3efb54125dc5cf107`
is a post-review delta (`#1241` isolation fail-closed plus later docs/Dependabot).
It does not reuse the AN signature.

AC-7H **approve with accepted residuals** for Core/npm `2026.9.22-f3de461` was
recorded on 2026-09-23 against packet revision
`a144abf024e44831685663e832a6f4b777b5c61f` in the
[#1402 decision record](https://github.com/service-lasso/service-lasso/issues/1402#issuecomment-5781828161).
Accepted residuals: single-operator control limitation (no enforced required
approvals/CODEOWNERS/last-push/required checks on Core/Admin `develop`); Admin
development-scope critical code-scanning alert not on the pinned release;
publish attempt-1 reliability residual; isolation L2–L4 not implemented with
`require` other than none failing closed; `#1326` and `#1382` open; `#1330`
macOS proof deferred; `gh` operator/delivery-owner independence limitation; and
historical failed runs retained as failures. No technical gap was reclassified
as green by waiver.

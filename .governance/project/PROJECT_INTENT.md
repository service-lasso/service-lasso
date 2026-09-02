# Project Intent

Use this file to capture the project-specific intent that governance cannot provide.

## Purpose
Service Lasso is the core runtime and contract repository for running local packaged services under one governed manager. Its job is to define and implement the shared service model, discover service manifests, orchestrate install/config/start/stop/health behavior, and provide the reusable runtime surface that service repos and the Service Admin UI depend on.

## Context
Bootstrap/governance setup is now in place and remains durable. The first core runtime implementation batch is landed (`#2` to `#8`), and this repository is now in the hardening phase for startup configuration, persistence rehydration, stronger API semantics, and real execution supervision.

The broader multi-repo shape is already established:
- `service-lasso` = core runtime + canonical shared contract/docs
- `service-template` = the template for individual services
- `lasso-@serviceadmin` = the operator UI
- sibling app-host and packaging-target repos = quick-start consumers around the core runtime, with the canonical lineup tracked in current docs and issues

This repo is therefore the place where the real core behavior must live and continue hardening:
- standalone runtime/server entrypoint
- manifest discovery and parsing
- service lifecycle orchestration
- dependency/env/health semantics
- runtime config loading for `servicesRoot` and `workspaceRoot`
- state persistence and startup rehydration
- packaging/release mechanics for the core runtime itself
- publishable package mechanics so sibling starter repos can consume the core runtime cleanly
- one operator MCP on the core runtime for safe reads plus guarded lifecycle and maintenance actions through shared application facades (`SPEC-006`); never secret values, raw config/log payloads, local roots, generic shell, terminal/stdin, raw filesystem, or raw configuration tools

## Constraints
- Governance/spec/backlog traceability must remain in place while product code starts.
- This repo is private and should preserve clear auditability for decisions and changes.
- Hardening should stay bounded and staged: stabilize contracts/config/state before widening provider/runtime complexity.
- `develop` branch protection, CODEOWNERS reviews, SHA-pinned Actions, and the protected `release` publication environment are the 1.0 repository authority (`SPEC-007` `AC-7F`, `#1164`). Live API readback must stay honest if a setting cannot be applied on this hosting tier.
- `develop` is the sole development source of truth and default branch. Normal agent work must never use `main` as its baseline or pull-request target.
- `main` is promotion/release only, except for an authorised urgent hotfix that must be reconciled into `develop` immediately.
- `.governance/` remains the canonical governance source of truth for this repo.
- Release 1.0 is the local encrypted-store product defined by `SPEC-007`
  `AC-7F`; later-wave external mutation, campaigns, full Sync apply, scheduled
  rotation, Broker mutation MCP, HSM, FIPS, and MFA are explicit non-claims.
- Release publication is manual, approval-gated, and fail-closed on any known
  production vulnerability, mutable Action reference, missing shipped-archive
  SBOM/provenance/signature, or failed published-package evidence (`SPEC-007`
  `AC-7G`).
- Release 1 promotion is additionally fail-closed on independent security
  review of the exact immutable Core, Admin, Broker, npm, and evidence packet.
  Internal evidence assembly is not external approval, and a waiver never
  converts missing technical proof into a pass (`SPEC-007` `AC-7H`, `#1208`).

## Risks
- Staying in analysis/doc mode too long would create false progress without a running core.
- Starting too broadly could mix manifest redesign, runtime implementation, provider integration, and release plumbing into one hard-to-verify change.
- Service-specific setup-step jobs can still fail if runtime artifacts, platform commandlines, or provider dependencies are not validated in the owning service repo.
- Divergence between `develop` and `main` can create false completion claims and lost integration work unless branch direction is enforced mechanically and in repository instructions.

## Assumptions
- The first trustworthy milestone, a runnable standalone core slice, is now achieved.
- The current highest-value work is proving release readiness from a clean consumer perspective: package install, GitHub release artifacts, manifest-owned service acquisition, Service Admin integration, Echo Service behavior, and canonical reference-app source/bootstrap/bundled outputs.
- Hosted Windows cold start and load can make a real PowerShell identity smoke slower than the product's caller-owned process-control deadline. The smoke therefore uses its own explicit bounded test allowance; deterministic injected tests remain the authority for the unchanged product deadline, helper termination, and fail-closed classifications.
- GitHub-backed issues/project board remain the system of record for governed execution tracking.
- Bootstrap artifacts remain part of repo history, but active delivery is now product-spec driven.

## Key Behaviors
- The core runtime should discover canonical `service.json` manifests and treat them as operational contract files, not passive metadata.
- First-run service start may generate missing declared Broker-produced secrets once; manifest discovery must not write KV.
- `node-sample-service` is the tracked rotation/update fixture for non-secret env plus optional consumer and generated producer secrets.
- The core runtime should expose a standalone execution surface independent of any app-host-specific assumptions.
- Service lifecycle work should converge on explicit actions such as install, config, start, stop, and health/status reporting.
- Real-host Windows process-identity smoke must prove both an owned full fingerprint and an identity mismatch within an explicit test-only bound appropriate for hosted cold start/load. It must not relax or replace deterministic proof that production process control carries one absolute caller deadline and terminates over-budget helper processes safely (`SPEC-002` `AC-4BH`, `AC-4BS.2`).
- Full Windows CIM identity inspection must never be unbounded: calls without an outer deadline receive a 15-second fail-closed default, while an explicit caller deadline remains authoritative and is never inflated.
- Canonical demo network identity is operator-owned configuration rather than a checked-in machine address. Deploy requires an explicit bind host and either a client-visible URL host or complete runtime/Admin URLs; verifier and watchdog require a shared host unless their complete URLs are supplied. Internal loopback-only service health and ownership checks remain explicit local contracts (`SPEC-002` `AC-4N.1`).
- Real lifecycle fixtures must bound their cleanup waiters independently of product behavior so an acceptance failure reaches a terminal, attributable result before the workflow timeout. Test cleanup may not hide the original assertion behind an unbounded finalizer wait, and its bound may not change or excuse product process-control deadlines.
- In-process CLI, scheduler, and recovery-monitor durable mutations resolve an explicit actor, reuse the HTTP permission helper and audit store, deny ungranted or unconfirmed sensitive work without mutation, and never persist secret values (`SPEC-002` `AC-4CC`).
- Leftover HTTP durable mutations (update check/download/install, setup run, recovery doctor, and runtime startAll/stopAll/autostart/reload) resolve the trusted request-policy actor, call `enforcePermission` before mutation, deny ungranted or unconfirmed callers without side effects, and audit identity without secret values (`SPEC-002` `AC-4CD`).
- Service lifecycle mutations must derive authority from the trusted runtime request context and enforce the same permission and confirmation decisions projected to Service Admin. Final cross-repository acceptance pins the exact checksum-bound Admin release, acquires the published Admin and Broker archives through Core's production install path, and drives the unchanged released UI against the candidate Core on Windows, Linux, and macOS. The packaged proof must retain authenticated protected Broker transport across target readiness reads and a single durable provider-migration apply, and must prove a visibly enabled, confirmed, exactly-once local-root restart followed by ready-state refresh without retries, captures, credentials, paths, or secret values in evidence (`SPEC-002` `AC-4BY`, `AC-4BY.1`, `AC-4BY.2`).
- Canonical released-artifact startup on Windows must exercise the hardened managed launcher against the real checksum-bound extracted Service Admin ESM entrypoint from a pristine workspace. Synthetic launcher fixtures and a separately injected browser harness remain supporting evidence, not substitutes for Core API plus Admin UI readiness, exact release identity, bounded acknowledgement, and rollback/process/lock convergence (`SPEC-002` `AC-4CB`).
- Dependency, env, and health semantics should remain explicit and reviewable through docs/specs as implementation hardens.
- Product implementation should proceed through bounded specs/issues rather than undocumented chat intent.
- Setup steps may declare `creates` file and directory output guards so `rerun: ifMissing` can skip or rerun from real expected outputs, with secret-free guard metadata in setup state (`SPEC-002` `AC-4AK.1`).
- Setup steps may declare `fingerprint` input templates so `rerun: ifChanged` skips when the stored input hash is unchanged and reruns when declared inputs or the installed artifact release tag change, storing a hash only (`SPEC-002` `AC-4AK.2`).
- PGP bootstrap is unavailable in Release 1; use the approved age/recovery
  model. Fleet and Sessions are retired/hidden, and Policy Simulation is
  replaced by actual service-manifest secret-access assignments.
- Loopback operators authenticate as `local-root` without a password, and may still use Lasso-local password, vault token, or SSO/ZITADEL when configured. `FORCE_SSO` in Broker KV applies only to remote origins and cannot disable loopback methods. First-run local-admin username, token, and password are written into Secrets Broker KV `runtime/local-operator` before the INIT page can reveal them; copy/save remains the operator backup (`SPEC-005` `AC-5C`, `AC-5J`). Remote non-loopback identity is the Traefik trusted-ingress actor from the exact loopback Admin proxy; missing or mismatched Traefik/canonical headers fail closed (`SPEC-002` `AC-4BX`).
- Operator MCP reuses runtime facades, stays metadata-only for secrets and config, and publishes strict versioned read contracts with deterministic pagination and stable safe errors (`SPEC-006` `AC-6A`, `AC-6D`).
- Operator MCP Streamable HTTP remains authenticated-loopback-only until a complete OAuth resource configuration enables signature-, issuer-, expiry-, configured-audience-, scope-, Origin-, and content-boundary enforcement. MCP defaults to read-only, supports explicit disabled/guarded configuration, rate-limits validated actors and clients independently, and fails closed when its Audit event cannot be persisted (`SPEC-006` `AC-6C`).
- Core emits durable operator Inbox items for runtime/setup, lifecycle failure, health transitions, scheduled workflow outcomes, update notices, and Broker needs-attention when Core already reports it (`SPEC-002` `AC-4CA`).
- Guarded MCP actions derive actor and permission profile only from validated transport identity, preflight through the same application facade used by runtime operators, require server-bound single-use confirmation for risky mutations, and replay duplicate idempotency keys without repeating lifecycle effects (`SPEC-006` `AC-6E`).
- Long-running MCP configuration, setup, update, and runtime-wide actions become durable actor/workspace-scoped operations when they exceed the request budget. Safe operation records survive client disconnects and runtime restarts, expose bounded status/progress/terminal summaries without command, log, path, config, or secret material, and permit cancellation only where the underlying shared facade can stop safely (`SPEC-006` `AC-6F`).
- MCP release qualification treats the official Inspector/SDK protocol matrix, the complete security regression suite, and fresh-consumer packaged startup on Windows, Linux, and macOS as blocking product evidence. Canonical acceptance remains non-destructive except for one server-confirmed exactly-once lifecycle action, and retained artifacts contain only exact-SHA-bound version/result metadata without captures, credentials, raw logs, configuration, environment values, local paths, or secrets (`SPEC-006` `AC-6G`).

## Verification Expectations
Core product work should be verified with direct runnable evidence, not only documentation updates.

For the first runtime slice, expected proof should include:
- tracked source artifacts for the standalone core runtime
- direct local execution evidence that the runtime starts successfully
- direct proof that manifest discovery/parsing works against defined fixture/sample services
- documented residual gaps/blockers for anything not yet implemented
- backlog/spec traceability updated to distinguish shipped runtime behavior from remaining planned behavior
- working-release claims proven from the exact downloaded Core GitHub release and public npm package, with checksum-bound published Admin and Broker behavior on Windows, Ubuntu, and macOS plus exactly three retained metadata-only artifacts and direct artifact API readback; source builds are not publication proof
- GA promotion claims require a named independent reviewer, exact packet
  revision, dated decision, and disposition of every finding after all internal
  release, vulnerability, provenance, runtime, recovery, and ledger gates pass

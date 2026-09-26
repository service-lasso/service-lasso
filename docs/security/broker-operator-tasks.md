---
title: Operate and recover Secrets Broker
---

# Operate and recover Secrets Broker

This guide centralizes the 14 reader paths reviewed under [Core #1420](https://github.com/service-lasso/service-lasso/issues/1420). The [source decision ledger](../components/broker-migration-decisions.json) binds each path to Broker `develop` revision `fc6fc7b481dc8f9b6657a5d397a73b4a88384e2b`. API, security, manifest and verification contracts remain Broker-owned. These are reviewed source instructions; they do not establish acceptance of an installed release or a live external provider.

## Choose the setup you own

For a Core-managed workspace, use [first-run bootstrap and custody](../reference/vault-key-bootstrap.md). Core generates protected credentials internally, checks encrypted-store custody and authenticated IPC readiness, then provisions declared secrets without returning their values. It has no generated-master-key reveal, copy or download flow.

For a separately operated Broker, the CLI has a distinct local ceremony. Prerequisites are a verified Broker binary, operator-owned store/audit/wrapper locations, approved key custody and a recovery plan. Prefer an existing protected portable-key file for `key initialize`, `key unlock`, `key import` or `key rewrap`. The standalone `key initialize --generate --one-time-reveal` ceremony can emit the generated key once; do not run it in recorded terminals, CI, support captures or browser flows. Follow the exact [key lifecycle contract](https://github.com/service-lasso/lasso-secretsbroker/blob/fc6fc7b481dc8f9b6657a5d397a73b4a88384e2b/docs/master-key-lifecycle.md) for your installation.

Expected result: status is `ready` only after matching-key verification; wrapper status reports the supported local provider. A copied store without its usable wrapper/key remains `locked`. Wrong keys, corrupted payloads or unsupported wrapping fail closed. Preserve the original encrypted store and recovery material while diagnosing. Remove only disposable test copies after the Broker is stopped; a wrapper is machine/user custody, not a portable backup.

## Establish production local transport

Prerequisites: an approved service/launcher OS identity, protected endpoint ownership, the exact Broker's transport support and its signed launch-identity integration.

1. Select production mode and platform IPC. `secretsbroker serve --mode production --transport auto` selects Windows named pipe or Unix socket. Loopback HTTP is development/bootstrap compatibility and is rejected in production mode.
2. On Windows, authorize the specific launcher/service-account SID. Broad Administrators or LocalSystem access is disabled by default and rejected when enabled in production. On supported Unix platforms, use an owner-only socket and the supported same-UID peer check.
3. Keep API token/session and signed launch-lease checks in addition to OS transport authorization. Production secret-bearing resolve/write-back requests require a lease bound to the authenticated transport subject.
4. Verify readiness through the owning integration before starting secret-dependent consumers. If the identity boundary cannot be enforced, stop setup; do not fall back to HTTP or widen the ACL.

Expected result: the authorized local integration reaches the Broker and unsupported peers are denied. The source's cross-user Windows verifier needs a separate principal and credentials; missing prerequisites are Blocked, not a pass. See the exact [IPC contract](https://github.com/service-lasso/lasso-secretsbroker/blob/fc6fc7b481dc8f9b6657a5d397a73b4a88384e2b/docs/os-authenticated-ipc-transport.md). Stop only your owned test listener; preserve shared sockets, wrappers and running integrations.

## Inspect headless status safely

Prerequisites: a verified Broker binary and access to the intended protected store/configuration. Use the owning CLI's file options instead of placing key bytes in command arguments or history.

1. Use `secretsbroker admin status` with the required protected key/store options for your installation.
2. Inspect provider/source status and metadata lists before choosing a mutation. Status, search, operational events and audit export report metadata; they are not blanket proof of source reachability or action support.
3. Use `admin secrets reveal --no-echo` only when an authorized ref, audit reason and explicit confirmation are required to verify reveal access without printing the value. Ordinary status checks do not need reveal.

Expected result: typed safe status and next actions. `locked`, `source_auth_required`, `policy_denied`, `unsupported` and `degraded` require their corresponding corrective action, not suppression of the error. Preserve safe audit records and remove only task-created diagnostic files. The [headless CLI contract](https://github.com/service-lasso/lasso-secretsbroker/blob/fc6fc7b481dc8f9b6657a5d397a73b4a88384e2b/docs/headless-admin-cli.md) owns command flags and output exceptions.

## Back up, restore and rotate local custody

Prerequisites: an authorized local operator, a functioning audit sink, a protected backup destination and access to the matching key/recovery custody. Keep encrypted backups separate from keys and shares; encrypted artifacts remain sensitive operational data.

1. Inspect lifecycle status and the safe backup inventory. For the authenticated lifecycle API, create/list backups using opaque `backupId` values; verify the selected backup before considering restore.
2. Create a restore dry-run. The reviewed API binds a five-minute plan to the exact backup, key fingerprint and store digest. Review the target and expected state, then apply only that plan with explicit confirmation, bounded operation id and reason.
3. Verify the resulting lifecycle state through approved checks. A stale plan, incorrect key, changed store, incompatible artifact or unavailable audit sink must prevent mutation.
4. For local key rotation, use the owning lifecycle operation with confirmation and expected-state evidence. It generates key material inside the Broker and refreshes local wrapping; HTTP requests must not supply or receive key bytes. Keep prior recovery custody until the rotated store and backup have been verified under the operator's retention policy.

For a controlled separate-instance recovery, the CLI's `backup create`, `backup restore` and `key rotate` use explicit file custody. Follow the [backup and rotation contract](https://github.com/service-lasso/lasso-secretsbroker/blob/fc6fc7b481dc8f9b6657a5d397a73b4a88384e2b/docs/backup-restore-rotation.md); do not substitute a copied wrapper for the matching portable key. Stop the test instance before removing its disposable store. Preserve original backups, audit evidence and key material until recovery is verified. Without the matching key or valid recovery shares, encrypted values cannot be reconstructed; reconnect sources or initialize a new workspace through an explicit operator decision.

## Prepare a local recovery-share ceremony

Prerequisites: approved threshold/holder policy, the matching portable key, explicit offline destinations, and a separate recovery test store or host.

1. Choose the threshold and share holders before generating material. The supported ceremony is CLI-first; Service Admin can display policy/fingerprint metadata but must not collect or render share contents.
2. Use the Broker's recovery commands to write each share only to its explicit holder-controlled destination. Optional age/X25519 recipient envelopes use operator-supplied recipients; private identities are import-time inputs and must not be stored in Broker state.
3. Verify threshold recovery against a separate test store before relying on it. Only after reconstructed-key verification may local wrapping be refreshed.
4. Record safe fingerprints, policy id, threshold/count and outcome. Keep shares apart from encrypted backups and everyday wrappers.

Too few/wrong shares remain `locked`; corrupted/unverifiable data is `degraded`. Neither result authorizes wrapper mutation. PGP/keyserver/Keybase discovery is a future optional direction, not a required or delivered recovery dependency. The older portable-key introduction's statement that shares are future work is superseded by the reviewed [secure recovery contract](https://github.com/service-lasso/lasso-secretsbroker/blob/fc6fc7b481dc8f9b6657a5d397a73b4a88384e2b/docs/secure-initialization-recovery.md). Clean up only disposable recovered copies; retain holder material under the approved custody policy, never in screenshots or support bundles.

## Connect an external source

Prerequisites: the exact source schema, approved namespace/ref mappings, protected credential handles, trusted transport and the installed release's connection-scoped operation manifest.

1. Configure the source through its owning contract. Env sources name an exact variable; file sources use approved directories and bounded reads; exec sources require an approved executable/digest and explicit production opt-in. Do not paste credential values into source examples or documentation.
2. For Vault/OpenBao or AWS-compatible endpoints, configure the documented address, ref path/field mapping and credential handles. Status may classify local configuration without probing the external cluster; verify the intended integration separately.
3. For private PKI, set both `SECRETSBROKER_SOURCE_CA_FILE` and `SECRETSBROKER_SOURCE_CA_SHA256=sha256:<digest-of-exact-file-bytes>` in production. The CA must be an absolute, non-indirect regular PEM file of at most 1 MiB. Keep hostname/chain validation and redirect restrictions; do not disable certificate verification.
4. Inspect the exact connection's operation manifest before acting. Provider-family planning metadata never enables apply. A migration target requires explicit opt-in and complete provider-specific configuration; source protocol tests are not live-account certification.

Vault/OpenBao KV v2 facade operations and general management edit/reset/rotation are separate contracts. General remote management write/reset/rotation, policy apply and sync apply must not be inferred from a supported read or configured KV facade. AWS migration writes to an existing secret and requires independent readback; it does not imply `CreateSecret`. Preserve source data during migration.

Expected result: the authorized ref resolves internally and safe status reflects the supported operation. Authentication, rate limit, missing ref, conflict and sealed/locked results require operator reconciliation; no altered-input or widened-permission retry is implied. Retain redacted metadata and stop only temporary integration clients. Review exact source authority for [env/file/exec](https://github.com/service-lasso/lasso-secretsbroker/blob/fc6fc7b481dc8f9b6657a5d397a73b4a88384e2b/docs/env-file-exec-sources.md), [Vault/OpenBao](https://github.com/service-lasso/lasso-secretsbroker/blob/fc6fc7b481dc8f9b6657a5d397a73b4a88384e2b/docs/vault-openbao-source.md), [AWS](https://github.com/service-lasso/lasso-secretsbroker/blob/fc6fc7b481dc8f9b6657a5d397a73b4a88384e2b/docs/aws-secrets-manager-source.md) and [TLS trust](https://github.com/service-lasso/lasso-secretsbroker/blob/fc6fc7b481dc8f9b6657a5d397a73b4a88384e2b/docs/source-tls-trust.md).

## Use bounded adapters

The Broker MCP slice is a headless CLI adapter, not a long-running MCP transport server. List tools with `secretsbroker admin mcp tools`; status/source/provider/events/metadata tools remain read-only and metadata-only. Reveal, write and rotate tool names return unsupported. Inspect the [adapter contract](https://github.com/service-lasso/lasso-secretsbroker/blob/fc6fc7b481dc8f9b6657a5d397a73b4a88384e2b/docs/mcp-adapter.md) before integrating a client.

The OpenClaw exec resolver is a different value-bearing consumer boundary: it reads one request from stdin and writes a protocol response to stdout. Its reviewed interface uses loopback HTTP, token-file configuration and an `openclaw/*` allowlist; it does not establish compatibility with production IPC/transport-bound leases. Start the Broker independently before the consumer. Do not capture successful resolver responses in logs or documentation. Resolve the transport integration gap before claiming a production deployment; see the [resolver contract](https://github.com/service-lasso/lasso-secretsbroker/blob/fc6fc7b481dc8f9b6657a5d397a73b4a88384e2b/docs/openclaw-secretref-resolver.md).

Secrets Sync dry-run reports metadata and risk/next-action guidance; it does not write to GitHub or prove live bidirectional synchronization. No adapter result proves HSM, FIPS, MFA, remote rotation or live-provider certification.

For generic package authoring, use [Core authoring overview](../service-authoring/overview.md) and the component-owned release verifier. Companion reader navigation/removal remains under #1420 and parent #1265; Core guidance alone is not ecosystem migration or publication completion.

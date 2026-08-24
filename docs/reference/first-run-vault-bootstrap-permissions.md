---
title: First-run Vault Bootstrap and Permissions
sidebar_label: First-run Vault and Permissions
---

# First-run Vault Bootstrap and Permissions

This reference defines the Service Lasso first-run path from an empty workspace
to normal runtime. It ties the local vault bootstrap, local and remote auth
boundaries, actor resolution, action permissions, and audit requirements into
one operator-facing contract.

The related implementation trail is:

- [#822](https://github.com/service-lasso/service-lasso/issues/822): action permissions and audit identity model epic.
- [#823](https://github.com/service-lasso/service-lasso/issues/823): first-run setup mode and local vault bootstrap.
- [#824](https://github.com/service-lasso/service-lasso/issues/824): superseded generated-key reveal proposal; retained for history only.
- [#825](https://github.com/service-lasso/service-lasso/issues/825): local vs remote authentication rules.
- [#826](https://github.com/service-lasso/service-lasso/issues/826): action permission enforcement middleware.
- [#827](https://github.com/service-lasso/service-lasso/issues/827): ZITADEL actor and role mapping.
- [#1022](https://github.com/service-lasso/service-lasso/issues/1022): real Broker bootstrap and production resolution.
- [#1024](https://github.com/service-lasso/service-lasso/issues/1024): metadata-only public setup responses.

## Scope

Service Lasso owns the workspace Broker lifecycle; it does not invent a
browser-visible vault-owner credential. The host OS account is useful local
context for protected storage, IPC identity, diagnostics, and audit, but it is
not a remotely transferable product identity.

The local runtime owns setup-mode detection, vault readiness, normal autostart
blocking, safe setup audit events, and action permission checks. Services that
own identity providers, broker storage, OIDC callbacks, or provider-specific
session behavior keep those responsibilities outside core.

## Empty workspace flow

An empty workspace starts in setup mode until protected Broker runtime
credentials, the encrypted store, and the platform key-custody evidence all
agree. A legacy marker file never satisfies readiness. The setup status contract
is exposed by:

```http
GET /api/setup/status
```

The status response reports:

- setup state: `setup_required`, `setup_in_progress`, `setup_complete`,
  `setup_failed`, or `not_required`;
- whether the Broker vault is required and ready (never its filesystem path or
  IPC address);
- the bind host and whether setup is local-only or remote-token gated;
- blockers such as `setup_token_required_for_remote_bind`;
- operator context, including the host OS username as context only and
  `identitySource: "vault"`.

Normal service autostart must wait while setup mode is active. Provider
preparation, manifest discovery, and diagnostics can still run when they are
safe and non-mutating, but baseline service startup must not proceed until the
protected Broker custody is ready.

## Launch prerequisite contract

The normal launch path treats setup as a prerequisite phase before managed
services are allowed to start. Startup resolves the setup status first, then
uses that decision for both CLI output and runtime API state:

1. Discover the workspace and service roots.
2. Read protected Broker credential, encrypted-store, and key-custody status.
3. If setup is required, prepare only the setup-capable dependency set:
   `@node`, `@secretsbroker`, and `@serviceadmin`.
4. Expose setup mode through `GET /api/setup/status` and show the local setup
   URL from the runtime host and port when an interactive operator can complete
   setup.
5. Accept a setup token only as transient authorization for remote bootstrap;
   never as Broker key material.
6. Initialize protected Broker credentials, the encrypted local store, the
   authenticated local transport, and declared Broker-generated secrets.
7. Record setup decisions and denials as metadata-only audit/history events.
8. Re-read setup status after bootstrap; when setup is `not_required`, continue
   the regular managed service launch set in dependency order.

While setup mode is active, install and config reconciliation may still run for
services that are safe to prepare, but normal service process start is skipped
with a setup-mode reason. Existing workspaces skip setup mode only when protected
credentials and the encrypted Broker store prove ready together.

This split keeps first-run prerequisites visible without granting temporary
admin authority to every managed service. After setup, regular runtime
permission checks decide which authenticated actors can install, configure,
start, restart, import, restore, or rotate workspace resources.

## Vault bootstrap

The first setup action requires the release-backed `@secretsbroker` artifact to
be installed and configured, then creates and verifies its local custody:

```http
POST /api/setup/bootstrap
```

Core generates Broker API, launch-signing, and master-key material internally.
On Windows, the private credential envelope and Broker master-key wrapper use
CurrentUser DPAPI plus current-user/SYSTEM-only ACLs. On Unix-like systems,
private credential state and Broker transport files are owner-only and the local
IPC transport is bound to the current UID. These credentials never enter
command-line arguments or browser responses.

There is no generated-key reveal, copy, download, print, or acknowledgement
flow. Public bootstrap responses contain setup state, Broker readiness, safe
operator context, trust flags, auth metadata, and the count of provisioned
declarations only. Store paths, IPC addresses, tokens, signing keys, master
keys, wrapper data, credentials, and secret values remain internal.

If the vault key is lost and no backup or recovery path exists, Service Lasso
cannot recover encrypted local secrets. The safe recovery paths are restoring a
known-good workspace backup, re-bootstraping a new empty workspace, or
reconnecting providers and re-entering secrets through their owning setup flows.

## Headless and automation bootstrap

Automation, container, and headless runs do not depend on a UI reveal. They
must supply setup authorization through a configured source that can be audited
without logging values.

Accepted source classes are:

- `SERVICE_LASSO_SETUP_TOKEN` for gated remote bootstrap during setup mode;
- a local loopback setup session under the runtime-known OS operator boundary;
- preconfigured release/install state for `@secretsbroker` in image or
  automation workflows.

Logs and API responses may report the source class or safe correlation metadata.
They must not include paths, raw key values, setup tokens, provider tokens,
private keys, session cookies, passwords, or recovery material.

## Local and remote auth rules

`0.0.0.0` is a bind address, not a browser origin. Loopback origins are
`127.0.0.1`, `::1`, and `localhost` (plus other `127.0.0.0/8` client addresses).
Opening Admin as `http://192.168.x.x:17700` or a hostname is remote even when
Core or Admin listen on `0.0.0.0`.

Loopback is `local-root` without a password at the Core request-policy layer.
The first Admin visit still forces the operator to copy and save the local-admin
token and `local-operator` password (`SPEC-005` `AC-5J`). After that
acknowledge, later Admin visits require token or password login. Loopback keeps
an explicit **Continue as local-root** break-glass control (session-only).
Loopback still allows Lasso-local password, vault token, and SSO/ZITADEL when
configured, including when vault flag `runtime/auth` / `FORCE_SSO` is true, so a
bad flag cannot brick the machine or hide break-glass methods. Flip `FORCE_SSO`
from loopback via the KV editor.

First-run writes Lasso-local secrets into Broker KV path `runtime/local-operator`
(`LOCAL_OPERATOR_USERNAME`, `LOCAL_ADMIN_TOKEN`, `LOCAL_OPERATOR_PASSWORD`)
**before** the one-time loopback envelope is written, so INIT never shows
credentials that are not already in the vault. Copy/save on INIT remains the
operator backup. `GET /api/runtime/security` reports `firstRunPending` without
credential material. While pending but the envelope is not yet written, loopback
`GET /api/runtime/auth/first-run` returns 503 `first_run_vault_not_ready`
without secrets. Values are not stored in `service.json`. `operator.json` stays
the Broker daemon token and is not the operator login token. Workspaces that
already have hashed local-operator state marked acknowledged (or legacy files
with the acknowledgement field missing) cannot re-show a token that is no
longer in plaintext.

Remote login (when `FORCE_SSO` is off) is either the vault-retrieved token,
username `local-operator` plus the Lasso-local password via
`POST /api/runtime/auth/local`, or SSO when configured. Service Lasso must not
collect OS or Windows passwords in a web form. Remote failures are rate-limited;
loopback is not.

When `FORCE_SSO` is on, remote access requires a ZITADEL actor. Local and token
proofs are disabled remotely. Loopback continues to allow every configured
method. Traefik OIDC cutover remains a later phase. Prove this HTTP matrix with
`npm run verify:auth-e2e` (SPEC-005 `AC-5I`, `AC-5J`). Live ZITADEL browser SSO is not
part of that gate.

The local admin token is secret material. It must not appear in audit payloads,
diagnostics, telemetry, issue comments, or PR bodies.

## Actor model

Every mutating or sensitive action should resolve to one of these actor kinds:

| Actor kind | Source | Notes |
| --- | --- | --- |
| `local-root` | Runtime-proven loopback request | Administrative only inside the exact local trust boundary. |
| `local-token` | Explicit configured local admin token | Emergency/automation authority; never browser storage. |
| `zitadel-user` | ZITADEL-backed user session | Identity is proven by ZITADEL; Service Lasso maps it to a workspace actor. |
| `service-account` | Explicit service identity | Used by automation and services such as workflow runners. |
| `system` | Runtime-owned scheduler, supervisor, or health repair | Must carry a stable system actor id and reason. |

ZITADEL proves who the user is. Service Lasso decides what that actor can do.
ZITADEL subjects, groups, roles, and safe display metadata map to Service Lasso
users, linked identities, workspace roles, and entitlements through the platform
facade. Raw ZITADEL tokens, callbacks, cookies, and provider credentials do not
belong in core runtime state.

System actors such as scheduler, supervisor, and health repair are not implicit
admins. They can run only the bounded operations assigned to their service
identity or internal system role, and their audit records must say why the
runtime acted.

Service account actors such as Dagu or other workflow runners must be explicit
service identities. They receive named entitlements for the relevant workspace
and instance. A service account cannot borrow a human user's identity or bypass
broker policy.

## Permissions

Roles are workspace-scoped bundles of entitlements. Core entitlements include:

- `workspace:read`
- `workspace:admin`
- `secrets-broker-source:read`
- `secrets-broker-source:write`
- `secrets-broker-source:use`
- `secrets-broker:resolve`
- `workflow:run`

Permission checks must fail closed when the actor, workspace, role mapping,
entitlement, service identity, or target state is missing or inactive.

Durable HTTP routes resolve the actor from the trusted request-policy identity
(`local-root`, `local-token`, or `zitadel-user`). JSON bodies may carry
workflow metadata, but they must not supply actor authority. Unmapped ZITADEL
actors authenticate for reads when identity is proven, then fail closed for
mutating action runs until workspace grant mapping is applied. In-process
system and service-account callers pass an explicit permission actor; HTTP
cannot spoof those kinds.

Dangerous or elevated actions need confirmation even when the actor has a base
entitlement. Examples include service restart, destructive config apply,
restore, migration, vault rotation, provider disconnect, or service import. The
confirmation must be based on a fresh plan and must be bound to the same actor,
target, capability fingerprint, and expiry window before execution.

## Audit minimum

Audit is metadata evidence, not a secret store. Every setup, permission, and
elevated-action decision should record at least:

- event id, timestamp, contract version, and source;
- actor kind, actor id, workspace id, and instance id when known;
- action name, subject type, and subject id;
- outcome: `success`, `failure`, `denied`, or `skipped`;
- permission decision and missing entitlement or denial reason when applicable;
- auth method, such as `local-root`, `setup-token`, `zitadel-session`,
  `local-admin-token`, `service-identity`, or `system`;
- safe correlation ids, plan ids, confirmation ids, route templates, and status
  codes where available.

Audit must never include raw vault keys, setup tokens, local admin tokens,
bearer tokens, OIDC tokens, session cookies, provider credentials, raw secret
values, private keys, passwords, raw request bodies, raw terminal input, or
recovery material.

## Normal runtime invariant

After bootstrap is complete:

1. the Broker vault, protected credential state, and authenticated IPC probe are
   ready;
2. setup mode is disabled for normal startup;
3. local requests are still scoped by the local trust boundary;
4. remote requests require the configured login boundary;
5. ZITADEL claims map to Service Lasso actors and entitlements before any
   permission decision;
6. service accounts and system actors use explicit identities;
7. elevated actions require fresh plan-bound confirmation;
8. setup, permission, confirmation, and denial paths emit metadata-only audit
   evidence.

See also [Core Boundary Facade](./product-api-facade.md),
[Startup Broker Resolution](./startup-broker-resolution.md),
[Operator Command Facade](./operator-command-facade.md), and
[Audit](./audit.md).

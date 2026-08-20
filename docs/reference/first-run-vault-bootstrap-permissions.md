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
- [#824](https://github.com/service-lasso/service-lasso/issues/824): vault key sources, one-time reveal, and headless bootstrap.
- [#825](https://github.com/service-lasso/service-lasso/issues/825): local vs remote authentication rules.
- [#826](https://github.com/service-lasso/service-lasso/issues/826): action permission enforcement middleware.
- [#827](https://github.com/service-lasso/service-lasso/issues/827): ZITADEL actor and role mapping.

## Scope

Service Lasso root is a vault owner identity inside the workspace. It is not the
host OS root account, a Windows administrator account, a Unix UID, or the person
who launched the process. The current OS user is useful local context for
diagnostics and audit, but it does not grant product ownership by itself.

The local runtime owns setup-mode detection, vault readiness, normal autostart
blocking, safe setup audit events, and action permission checks. Services that
own identity providers, broker storage, OIDC callbacks, or provider-specific
session behavior keep those responsibilities outside core.

## Empty workspace flow

An empty workspace starts in setup mode when the configured local vault marker is
missing. The setup status contract is exposed by:

```http
GET /api/setup/status
```

The status response reports:

- setup state: `setup_required`, `setup_in_progress`, `setup_complete`,
  `setup_failed`, or `not_required`;
- the vault path and whether the vault is ready;
- the bind host and whether setup is local-only or remote-token gated;
- blockers such as `setup_token_required_for_remote_bind`;
- operator context, including the host OS username as context only and
  `identitySource: "vault"`.

Normal service autostart must wait while setup mode is active. Provider
preparation, manifest discovery, and diagnostics can still run when they are
safe and non-mutating, but baseline service startup must not proceed until the
vault owner identity exists.

## Launch prerequisite contract

The normal launch path treats setup as a prerequisite phase before managed
services are allowed to start. Startup resolves the setup status first, then
uses that decision for both CLI output and runtime API state:

1. Discover the workspace and service roots.
2. Read setup status from the configured workspace vault path.
3. If setup is required, prepare only the setup-capable dependency set:
   `@node`, `@secretsbroker`, and `@serviceadmin`.
4. Expose setup mode through `GET /api/setup/status` and show the local setup
   URL from the runtime host and port when an interactive operator can complete
   setup.
5. Accept non-interactive setup inputs only from configured setup sources such
   as `SERVICE_LASSO_SETUP_TOKEN`, `SERVICE_LASSO_VAULT_PATH`, or mounted
   secret-provider files.
6. Seed the vault owner identity, Owner group, built-in groups, and permission
   catalogue before normal mutating actions are allowed.
7. Record setup decisions and denials as metadata-only audit/history events.
8. Re-read setup status after bootstrap; when setup is `not_required`, continue
   the regular managed service launch set in dependency order.

While setup mode is active, install and config reconciliation may still run for
services that are safe to prepare, but normal service process start is skipped
with a setup-mode reason. Existing workspaces with a ready vault marker skip
setup mode and continue normal launch without the setup dependency restriction.

This split keeps first-run prerequisites visible without granting temporary
admin authority to every managed service. Secrets Broker is available only for
the setup boundary until the owner identity, built-in groups, and permission
catalogue are seeded; after that, regular action permission checks decide which
actors can install, configure, start, restart, import, restore, or rotate
workspace resources.

## Vault bootstrap

The first setup action creates the local vault root state and the initial owner
identity:

```http
POST /api/setup/bootstrap
```

For an interactive local setup, Service Lasso may generate initial vault key
material and reveal it exactly once to the local operator. The reveal surface is
a transfer moment, not storage. It must not be written to logs, audit events,
diagnostics bundles, issue comments, PR bodies, telemetry, service manifests, or
runtime state.

The durable vault record should store only what is needed to prove readiness and
identify the owner boundary. Safe metadata includes the vault path, workspace id,
owner actor id, created time, setup state, key source classification, and audit
correlation id.

If the vault key is lost and no backup or recovery path exists, Service Lasso
cannot recover encrypted local secrets. The safe recovery paths are restoring a
known-good workspace backup, re-bootstraping a new empty workspace, or
reconnecting providers and re-entering secrets through their owning setup flows.

## Headless and automation bootstrap

Automation, container, and headless runs must not depend on a UI reveal. They
must supply setup authority through configured sources that can be audited
without logging values.

Accepted source classes are:

- `SERVICE_LASSO_SETUP_TOKEN` for gated remote bootstrap during setup mode;
- `SERVICE_LASSO_VAULT_PATH` when the vault marker or vault implementation uses
  a non-default path;
- host/container secret files or mounted secret providers consumed by the setup
  runner;
- Secrets Broker or provider-specific references that are resolved only by the
  component that owns that provider boundary.

Logs and API responses may report the source class, source id, or path metadata
when safe. They must not include raw key values, setup tokens, provider tokens,
private keys, session cookies, passwords, or recovery material.

## Local and remote auth rules

`0.0.0.0` is a bind address, not a browser origin. Loopback origins are
`127.0.0.1`, `::1`, and `localhost` (plus other `127.0.0.0/8` client addresses).
Opening Admin as `http://192.168.x.x:17700` or a hostname is remote even when
Core or Admin listen on `0.0.0.0`.

Loopback is `local-root` without a password. Loopback still allows Lasso-local
password, vault token, and SSO/ZITADEL when configured, including when vault
flag `runtime/auth` / `FORCE_SSO` is true, so a bad flag cannot brick the
machine or hide break-glass methods. Flip `FORCE_SSO` from loopback via the KV
editor.

First-run seeds Lasso-local secrets into Broker KV path `runtime/local-operator`
(`LOCAL_ADMIN_TOKEN`, `LOCAL_OPERATOR_PASSWORD`) for audited per-field reveal.
Values are not stored in `service.json`. `operator.json` stays the Broker daemon
token and is not the operator login token.

Remote login (when `FORCE_SSO` is off) is either the vault-retrieved token,
username `local-operator` plus the Lasso-local password via
`POST /api/runtime/auth/local`, or SSO when configured. Service Lasso must not
collect OS or Windows passwords in a web form. Remote failures are rate-limited;
loopback is not.

When `FORCE_SSO` is on, remote access requires a ZITADEL actor. Local and token
proofs are disabled remotely. Loopback continues to allow every configured
method. Traefik OIDC cutover remains a later phase.

The local admin token is secret material. It must not appear in audit payloads,
diagnostics, telemetry, issue comments, or PR bodies.

## Actor model

Every mutating or sensitive action should resolve to one of these actor kinds:

| Actor kind | Source | Notes |
| --- | --- | --- |
| `vault-owner` | First-run vault owner identity | Root Service Lasso ownership for the workspace. |
| `local-operator` | Local setup or local API boundary | Valid only within local trust rules. |
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

1. the vault is ready and has a workspace owner identity;
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

---
title: Product API Facade Contract
sidebar_label: Product API Facade
---

# Product API Facade Contract

The product API facade owns Service Lasso account metadata that is broader than
runtime service state: users, workspaces, linked identities, request_context,
service_identities, provider connection metadata, roles/entitlements, and
authorization decisions for Secrets Broker and workflow/run resolution.

This contract is metadata-only. Provider secret payloads, OAuth access tokens,
refresh tokens, API keys, private keys, password values, portable master keys,
and recovery material must not be stored or returned by the facade. Store secret
material behind a Secrets Broker or source-backend reference and return only the
safe reference metadata needed to authorize and diagnose access.

## Data model

### `users`

A user is the internal product principal.

| Field | Notes |
| --- | --- |
| `id` | Stable internal user id such as `usr_...`. |
| `displayName` / `email` | Display metadata copied from a verified identity claim where available. |
| `status` | `active`, `disabled`, or `pending`. Disabled users fail authorization. |
| `linkedIdentityIds` | Links to external identities that can authenticate as this user. |
| `createdAt` / `updatedAt` | Audit timestamps. |

### `workspaces`

A workspace scopes users, provider connections, broker authorization, and
workflow/run ownership.

| Field | Notes |
| --- | --- |
| `id` | Stable internal workspace id such as `wks_...`. |
| `slug` / `displayName` | Operator-facing metadata. |
| `status` | `active`, `suspended`, or `archived`. Suspended/archived workspaces fail mutating actions. |
| `ownerUserId` | Internal owner user id. |
| `createdAt` / `updatedAt` | Audit timestamps. |

### `linked_identities`

A linked identity maps an external identity provider subject to an internal user
and one or more workspaces.

| Field | Notes |
| --- | --- |
| `id` | Stable link id. |
| `provider` | `zitadel`, `github`, `google`, `telegram`, `custom-oidc`, or another registered provider. |
| `issuer` | OIDC issuer or provider authority. |
| `subject` | Provider subject id. |
| `userId` | Internal user id. |
| `workspaceIds` | Workspaces this identity can enter after role checks. |
| `claims` | Safe claim metadata only: email, preferred username, groups. |
| `createdAt` / `lastSeenAt` | Audit timestamps. |

### `request_context`

Every broker/admin/provider/workflow API receives a canonical request context
instead of re-parsing cookies, tokens, route parameters, or provider-specific
auth state.

| Field | Notes |
| --- | --- |
| `userId` | Internal user id for a ZITADEL-backed user request, or service id for a service-authenticated request. |
| `workspaceId` | Active workspace resolved from request routing/defaults and verified against identity membership. |
| `instanceId` | Local Service Lasso instance boundary. Requests cannot cross instances. |
| `linkedIdentityId` | ZITADEL linked identity id for user requests, or service identity id for service-authenticated requests. |
| `entitlements` | Workspace-scoped grants flattened from roles or service identity policy. |
| `actor` | Safe actor descriptor: `kind`, `id`, and display label only. |
| `authMethod` | `zitadel-session` or `service-identity`. |
| `audit` | Safe actor/workspace/instance metadata for downstream audit events. |

The resolver returns fail-closed states for `unauthenticated`, `unauthorized`,
`expired-session`, `workspace-mismatch`, `service-identity-denied`,
`disabled-user`, and `workspace-inactive`. These responses may include safe
actor/workspace/instance ids when known, but never cookies, session secrets,
bearer tokens, provider credentials, raw secret values, key material, or
recovery material.

### `service_identities`

Service identities let local system actors such as `@node`, `@serviceadmin`, or
workflow runners call broker/admin APIs without pretending to be provider OAuth
users.

| Field | Notes |
| --- | --- |
| `id` | Stable internal service identity id. |
| `serviceId` / `displayName` | Service actor metadata safe for logs and audit. |
| `instanceIds` | Allowed Service Lasso instances. |
| `workspaceIds` | Workspaces the service identity may access. |
| `entitlements` | Explicit grants such as `secrets-broker:resolve`; no implicit admin rights. |
| `status` | `active` or `disabled`. Disabled service identities fail closed. |
| `createdAt` / `updatedAt` | Audit timestamps. |

Service-authenticated requests must provide the expected service id, workspace
id, and instance id. The resolver rejects unknown services, disabled services,
workspace mismatches, and instance mismatches as `service-identity-denied` or
`workspace-mismatch`.

### `provider_connections`

A provider connection is safe metadata for a third-party or service provider
integration. It must be clearly split from secret payloads.

| Field | Notes |
| --- | --- |
| `id` | Stable connection id such as `pc_...`. |
| `workspaceId` / `ownerUserId` | Ownership and authorization scope. |
| `provider` | Provider key, for example `github`, `stripe`, or `vault`. |
| `kind` | `oauth`, `api-token`, `webhook`, `secrets-broker-source`, or `custom`. |
| `displayName` | Operator-facing label. |
| `status` | `ready`, `needs-auth`, `expiring`, `refresh-failed`, `revoked`, `disabled`, `error`, or `deleted`. Deleted records are not listed by default. |
| `accountId` | Provider-side account, org, tenant, or installation id, when safe to expose. |
| `scopes` | Granted/expected provider scopes as labels. |
| `brokerNamespace` / `secretRef` | Pointer to secret material, never the value itself. |
| `expiresAt` / `lastRefreshAt` / `lastVerifiedAt` | Safe lifecycle timing metadata. |
| `lastError` | Safe diagnostic summary only; no provider response bodies or credentials. |
| `affectedSummary` | Safe summary of affected `serviceIds`, broker refs, and workflow ids. |
| `secretMaterialPresent` | Must be `false` in facade responses. A true value is a contract violation. |
| `createdAt` / `updatedAt` | Audit timestamps. |

Forbidden fields in facade provider connection payloads include `secret`,
`accessToken`, `refreshToken`, `apiKey`, `privateKey`, `password`,
`credential`, `keyMaterial`, and `recoveryMaterial`.

### `roles` and entitlements

Roles are workspace-scoped bundles of entitlements. The first concrete
entitlements are:

- `workspace:read`
- `workspace:admin`
- `provider-connection:read`
- `provider-connection:write`
- `provider-connection:use`
- `secrets-broker:resolve`
- `workflow:run`

Secrets Broker resolution requires `secrets-broker:resolve` in the same
workspace as the requested broker namespace. Workflow/run resolution requires
`workflow:run`; if a workflow uses provider connection metadata, it also
requires `provider-connection:use` for each referenced connection.

## Provider connection metadata API

The facade exposes CRUD for metadata only:

```text
GET   /api/platform/workspaces/{workspaceId}/provider-connections
POST  /api/platform/workspaces/{workspaceId}/provider-connections
GET   /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}
PATCH /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}
DELETE /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}
```

### Create request

```json
{
  "workspaceId": "wks_local_demo",
  "ownerUserId": "usr_01hzy9operator",
  "provider": "github",
  "kind": "oauth",
  "displayName": "GitHub Actions metadata connection",
  "accountId": "github-org-service-lasso",
  "scopes": ["repo:read", "workflow:read"],
  "brokerNamespace": "workspaces/local-demo/provider-connections/github",
  "secretRef": "provider.github.oauth.client"
}
```

### Response

```json
{
  "id": "pc_github_actions",
  "workspaceId": "wks_local_demo",
  "ownerUserId": "usr_01hzy9operator",
  "provider": "github",
  "kind": "oauth",
  "displayName": "GitHub Actions metadata connection",
  "status": "ready",
  "accountId": "github-org-service-lasso",
  "scopes": ["repo:read", "workflow:read"],
  "brokerNamespace": "workspaces/local-demo/provider-connections/github",
  "secretRef": "provider.github.oauth.client",
  "expiresAt": "2026-05-30T00:00:00Z",
  "lastRefreshAt": "2026-05-08T10:04:00Z",
  "lastVerifiedAt": "2026-05-08T10:05:00Z",
  "affectedSummary": {
    "serviceIds": ["@serviceadmin"],
    "brokerRefs": ["provider.github.oauth.client"],
    "workflowIds": ["wf_release_checks"]
  },
  "secretMaterialPresent": false,
  "createdAt": "2026-05-08T10:00:00Z",
  "updatedAt": "2026-05-08T10:05:00Z"
}
```

Delete removes the metadata record from the facade response set and emits a safe audit event; deletion of broker secret payloads remains a separate Secrets Broker operation. The response is safe to log because it contains reference metadata only. The
facade must never return raw provider secrets, access tokens, refresh tokens,
API keys, password values, private keys, key material, or recovery material.

## Provider connection lifecycle API

Provider lifecycle actions are stable core API contracts that UI and workflow
layers can call without embedding provider-specific behavior. The refresh/test
operations let consumers verify provider reachability and scope posture without
mutating provider secret payloads. Provider-specific OAuth or token flows may
still be unavailable in early slices; unavailable flows
must return actionable `setup-needed` or `provider-unavailable` responses rather
than dead actions.

```text
POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/connect
POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/reconnect
POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/refresh
POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/test
POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/disable
POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/disconnect
```

Normalized lifecycle statuses are:

- `connected`
- `expiring`
- `refresh_failed`
- `reconnect_required`
- `revoked`
- `permission_changed`
- `disabled`
- `source_auth_required`
- `degraded`
- `deleted`

Lifecycle responses include safe metadata only:

```json
{
  "connectionId": "pc_github_ready",
  "provider": "github",
  "action": "test",
  "status": "connected",
  "ok": true,
  "auditEvent": {
    "id": "audit_provider_ready_001",
    "workspaceId": "wks_local_demo",
    "connectionId": "pc_github_ready",
    "provider": "github",
    "action": "test",
    "fromStatus": "connected",
    "toStatus": "connected",
    "outcome": "success",
    "at": "2026-05-08T11:05:00Z",
    "actorUserId": "usr_01hzy9operator",
    "safeDetail": "Provider metadata check succeeded; no provider credential values returned."
  }
}
```

Unavailable or setup-required actions return actionable errors without provider
secret values:

```json
{
  "connectionId": "pc_slack_missing",
  "provider": "slack",
  "action": "connect",
  "status": "source_auth_required",
  "ok": false,
  "error": {
    "code": "setup-needed",
    "message": "Provider connection needs operator setup before it can be used.",
    "action": "Open the provider setup flow and complete authorization.",
    "provider": "slack",
    "retryable": true,
    "documentationRef": "docs/reference/product-api-facade.md#provider-connection-lifecycle-api"
  }
}
```

Each transition records a safe audit event with `workspaceId`, `connectionId`,
`provider`, `action`, `fromStatus`, `toStatus`, `outcome`, `at`, `actorUserId`,
and a `safeDetail`. Audit details may mention missing authorization, changed
permissions, or unavailable provider support, but must never include access
tokens, refresh tokens, API keys, provider secrets, key material, or recovery
material.

Reference lifecycle fixtures cover healthy, expiring, missing/setup-required, refresh-failed, denied, revoked, reconnect-required, disconnected, and deleted states in `src/platform/providerConnectionLifecycle.ts`.
Tests in `tests/provider-connection-lifecycle.test.js` verify status
normalization, secret-safe error payloads, unavailable action stubs, and safe
audit transition metadata.

## ZITADEL session mapping

When ZITADEL is used by a consuming app, Service Lasso maps the OIDC session to
internal context as follows:

1. Match `issuer` + `subject` to a `linked_identities` record with
   `provider: "zitadel"`.
2. Resolve the internal `userId` and allowed `workspaceIds` from that record.
3. Select the active workspace from request routing or the user's default
   workspace.
4. Load roles for that workspace and flatten them to entitlements.
5. Produce a request context containing `userId`, `workspaceId`, `instanceId`,
   `linkedIdentityId`, actor metadata, auth method, safe audit metadata, and
   entitlements.
6. Fail closed if the linked identity, workspace, user, session freshness, or
   required entitlement is missing.

ZITADEL remains app-owned. This facade contract describes how an authenticated
ZITADEL subject enters Service Lasso account/workspace authorization; it does
not make ZITADEL part of the Service Lasso core baseline.

## Service-authenticated requests

Broker-adjacent local services use the same request context shape through a
`service-identity` auth method. The identity must be explicitly allowed for the
requested `instanceId` and `workspaceId`, and receives only its configured
entitlements. This supports local runtime resolution such as `@node` reading a
broker ref without embedding provider credentials or raw secret values in the
runtime API.

Service identity failures are intentionally narrow:

- missing service auth -> `unauthenticated` / 401,
- unknown or disabled service -> `service-identity-denied` / 403,
- instance mismatch -> `service-identity-denied` / 403,
- workspace mismatch -> `workspace-mismatch` / 403,
- inactive workspace -> `workspace-inactive` / 403.

Audit metadata for service requests includes actor kind `service`, service id,
workspace id, instance id, auth method, and service identity id when known. It
must not include bearer tokens, local service credentials, provider credentials,
raw secrets, cookies, or session material.

## Authorization boundaries

Authorization is workspace-scoped and fail-closed:

- Provider connection read/write/use checks must compare the request workspace to
  the connection `workspaceId`.
- Secrets Broker checks must compare the request workspace to the broker
  namespace owner and require `secrets-broker:resolve`.
- Workflow/run checks must require `workflow:run`, then require
  `provider-connection:use` for each provider connection referenced by the run.
- Connections with status `needs-auth`, `revoked`, `disabled`, or `error` cannot
  be used for broker or workflow authorization.
- Request context resolution must represent `unauthenticated`, `unauthorized`,
  `expired-session`, `workspace-mismatch`, `service-identity-denied`,
  `disabled-user`, and `workspace-inactive` distinctly so callers can fail
  closed and show safe recovery guidance.
- Denied authorization responses may include metadata reasons such as
  `workspace-mismatch`, `missing-entitlement`, or `connection-not-ready`, but
  must not include provider secret values, tokens, cookies, session secrets, or
  key material.

## Test fixtures

The TypeScript contract lives in `src/platform/facade.ts`. Tests in
`tests/product-api-facade.test.js` verify:

- required facade model and endpoint concepts exist,
- ZITADEL session context maps to internal user/workspace context,
- provider connection metadata is split from secret payloads,
- Secrets Broker and workflow authorization boundaries are testable, and
- sensitive strings are rejected or absent from fixture/API shapes.

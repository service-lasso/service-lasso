---
title: Zitadel SSO Hub
sidebar_label: Zitadel SSO Hub
---

# Zitadel SSO Hub

Run a browser-usable local [ZITADEL](https://zitadel.com/) identity provider as
an **app-owned** Service Lasso stack, then connect one local application to it
with OpenID Connect (OIDC).

This guide builds a local SSO hub for development and integration testing. It
does not add ZITADEL to the Service Lasso baseline, create a hosted tenant, or
prove production or GA readiness.

## Outcome

```text
Your local application
    |  OIDC Authorization Code + PKCE
    v
ZITADEL over trusted local HTTPS
    |                         ^
    v                         | stable master key at launch only
PostgreSQL              Secrets Broker
    \                         /
     \---- Service Lasso -----/
            lifecycle, health, ports
```

When you finish:

- `https://localhost:18084/ui/console/` opens without a certificate warning;
- ZITADEL's readiness endpoint and OIDC discovery document respond over trusted
  HTTPS;
- a local application redirects to ZITADEL, returns to its registered callback,
  and validates an ID token from the local issuer.

## Before you begin

- Start with an **app-owned** `services/` inventory. Do not put ZITADEL in the
  checked-in Service Lasso baseline.
- Use a dedicated workspace, for example `workspace/zitadel-sso/`, rather than
  a shared demo workspace.
- Have Node.js and a built Service Lasso checkout or published runtime
  available.
- Decide the app's local callback URL before creating its ZITADEL application,
  for example `http://localhost:3000/auth/callback`.

The existing [ZITADEL consumer integration](../reference/zitadel-consumer-integration.md)
defines the ownership boundary and includes the minimal HTTP fixture. This guide
extends it into a browser-usable local HTTPS topology.

## 1. Create the app-owned service inventory

Your app owns this inventory and commits the non-secret manifest configuration:

```text
my-app/
  services/
    @secretsbroker/service.json
    @localcert/service.json
    postgres/service.json
    zitadel/service.json
  workspace/zitadel-sso/
```

Use the PostgreSQL and ZITADEL shape from
`fixtures/zitadel-consumer-app/services/` as the starting contract. The fixture
uses HTTP deliberately so it can stay small and testable; do not copy it
unchanged when a browser will use the hub.

For a trusted browser topology, add `@localcert` and make ZITADEL depend on it
as well as PostgreSQL:

```json
{
  "id": "zitadel",
  "depend_on": ["postgres", "@localcert"],
  "ports": { "http": 18084 },
  "env": {
    "ZITADEL_PORT": "${HTTP_PORT}",
    "ZITADEL_EXTERNALPORT": "${HTTP_PORT}",
    "ZITADEL_EXTERNALDOMAIN": "localhost",
    "ZITADEL_EXTERNALSECURE": "true",
    "ZITADEL_TLS_ENABLED": "true",
    "ZITADEL_TLS_CERTPATH": "${CERT_FILE}",
    "ZITADEL_TLS_KEYPATH": "${CERT_KEY}",
    "ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_REQUIRED": "false",
    "ZITADEL_DATABASE_POSTGRES_DSN": "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/zitadel_local?sslmode=disable",
    "ZITADEL_MASTERKEY": "${identity.ZITADEL_MASTERKEY}"
  },
  "globalenv": {
    "ZITADEL_ISSUER": "https://localhost:${HTTP_PORT}/",
    "ZITADEL_HEALTH_URL": "https://localhost:${HTTP_PORT}/debug/ready"
  }
}
```

Keep the complete artifact, platform command, broker, URL, and health-check
sections from the released ZITADEL manifest. Pin a reviewed
`service-lasso/lasso-zitadel` release rather than using a floating channel. The
working Windows example used `2026.9.25-93d4c84` for ZITADEL and
`2026.9.25-588398b` for `@localcert`; re-verify any replacement release before
adopting it.

PostgreSQL is also app-owned. Give the ZITADEL instance a dedicated local
database and data directory. Do not aim a test hub at a shared development or
production database.

## 2. Create and trust the local certificate

`@localcert` generates a CA and a server certificate for `localhost` and
`127.0.0.1`. It exports the certificate and key paths consumed by ZITADEL as
`${CERT_FILE}` and `${CERT_KEY}`.

Start the runtime once without `NODE_EXTRA_CA_CERTS`, then install, configure,
and run the local certificate setup:

```powershell
$runtime = '<path-to-service-lasso>\\dist\\cli.js'
node $runtime serve `
  --noautostart `
  --services-root .\services `
  --workspace-root .\workspace\zitadel-sso `
  --port 18085
```

Keep the runtime open while you run these requests in a second terminal:

```powershell
$api = 'http://127.0.0.1:18085/api/services/%40localcert'
Invoke-RestMethod -Method Post -Uri "$api/install" -ContentType 'application/json' -Body '{}'
Invoke-RestMethod -Method Post -Uri "$api/config" -ContentType 'application/json' -Body '{}'
Invoke-RestMethod -Method Post -Uri "$api/setup/run" -ContentType 'application/json' -Body '{}'
```

Trust the generated `services/@localcert/data/rootCA.pem` in the **Current
User** Trusted Root Certification Authorities store. This is an interactive,
machine-local trust decision. Do not bypass browser certificate errors.

Restart the Service Lasso process with the same CA so its Node.js health checks
also verify ZITADEL's HTTPS endpoint:

```powershell
$env:NODE_EXTRA_CA_CERTS = (Resolve-Path .\services\@localcert\data\rootCA.pem).Path
node <path-to-service-lasso>\dist\cli.js serve `
  --noautostart `
  --services-root .\services `
  --workspace-root .\workspace\zitadel-sso `
  --port 18085
```

Keep that terminal open. `--noautostart` means you choose precisely which
services start; it does not start Service Admin or unrelated inventory entries.

## 3. Provision the stable ZITADEL master key

Before the first ZITADEL start, use the Service Lasso Secrets Broker flow to
write one stable, exactly 32-byte `identity.ZITADEL_MASTERKEY` in namespace
`services/zitadel`.

The key is a secret, not a configuration sample. Never put it in `service.json`,
an environment file committed to the app, command history, test output, issue,
or support bundle. Changing it after ZITADEL has initialized can make encrypted
state unreadable. See [Vault setup and key custody](../reference/vault-key-bootstrap.md)
for the protected local-secret boundary.

Plan the initial local ZITADEL administrator in the app's bootstrap procedure.
Do not document credentials or private bootstrap material in the inventory.

## 4. Start the hub and prove it is ready

In a second terminal, start the dependency chain in order:

```powershell
$api = 'http://127.0.0.1:18085/api/services'
Invoke-RestMethod -Method Post -Uri "$api/%40secretsbroker/start" -ContentType 'application/json' -Body '{}'
Invoke-RestMethod -Method Post -Uri "$api/postgres/start" -ContentType 'application/json' -Body '{}'
Invoke-RestMethod -Method Post -Uri "$api/zitadel/start" -ContentType 'application/json' -Body '{}'
```

Check the Service Lasso view first:

```powershell
$services = Invoke-RestMethod 'http://127.0.0.1:18085/api/services'
$services.services |
  Where-Object id -in '@secretsbroker', 'postgres', 'zitadel' |
  Select-Object id, @{Name='running'; Expression={$_.lifecycle.running}}, @{Name='healthy'; Expression={$_.health.healthy}}
```

Then verify ZITADEL directly:

```powershell
curl.exe --cacert .\services\@localcert\data\rootCA.pem https://localhost:18084/debug/ready
curl.exe --cacert .\services\@localcert\data\rootCA.pem https://localhost:18084/.well-known/openid-configuration
```

**Pass:** all three managed services report running and healthy; readiness
returns `ok`; discovery returns an issuer of exactly `https://localhost:18084`.
Open `https://localhost:18084/ui/console/` only after these checks pass.

## 5. Register the consuming application

In the local ZITADEL console:

1. Create or select the local project for the app.
2. Create one application registration for the app.
3. Choose the application shape:
   - browser-only SPA: **User Agent** with Authorization Code + PKCE;
   - server-side web app: **Web** with Authorization Code + PKCE;
   - non-interactive service: an appropriate machine-to-machine flow.
4. Register the app's exact callback and post-logout URLs. For local HTTP
   callbacks, enable development mode only for that local registration.
5. Save the client ID in the app's local configuration. Keep confidential
   client material in the app's secret store, never in browser code.

ZITADEL recommends Authorization Code with PKCE for browser, native, and web
applications. The callback URI sent by the app must exactly match the
registration. See ZITADEL's [OIDC and PKCE guide](https://zitadel.com/docs/guides/integrate/login/oidc/login-users)
and [application settings guide](https://zitadel.com/docs/guides/manage/console/applications-overview).

## 6. Configure and verify the application

Use the issuer and discovery document instead of hard-coding token endpoints:

```dotenv
# App-owned .env.local; do not commit credentials.
ZITADEL_ISSUER=https://localhost:18084
ZITADEL_DISCOVERY_URL=https://localhost:18084/.well-known/openid-configuration
ZITADEL_CLIENT_ID=<local-zitadel-client-id>
ZITADEL_REDIRECT_URI=http://localhost:3000/auth/callback
ZITADEL_POST_LOGOUT_REDIRECT_URI=http://localhost:3000/
```

Verify the consumer, not just the identity service:

1. Start the app with this local configuration.
2. Choose sign in and confirm the browser reaches the local ZITADEL login form
   without a certificate warning.
3. Sign in with a local test user.
4. Confirm the browser returns to the registered callback and the app validates
   an ID token whose issuer is `https://localhost:18084`.
5. Exercise a protected route and, if the app uses roles, an unauthorized-role
   case.
6. Sign out and confirm the post-logout redirect.

Do not infer app SSO acceptance from a green ZITADEL readiness response. The
consumer's redirect, callback, token validation, and authorization checks are
the direct proof.

## Stop and keep the local state

Stop the managed services and runtime without deleting the database, Broker
state, certificate authority, or workspace:

```powershell
Invoke-RestMethod -Method Post `
  -Uri 'http://127.0.0.1:18085/api/runtime/actions/shutdown' `
  -ContentType 'application/json' `
  -Body '{"confirm":true}'
```

## What this does not prove

This guide proves a local, app-owned integration topology. It does not create
or validate a hosted tenant, real Scheduling Assistant users and roles,
production redirect URLs, public certificate management, production database
operations, or a GA release decision.

For the underlying contract, see [ZITADEL Consumer Integration](../reference/zitadel-consumer-integration.md).

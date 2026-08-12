---
title: Local Traefik ZITADEL SSO Bootstrap
sidebar_label: Local SSO Bootstrap
---

# Local Traefik ZITADEL SSO Bootstrap

This contract describes the local development bootstrap for protecting Service
Admin at:

```text
https://serviceadmin.servicelasso.localhost
```

The bootstrap is intentionally limited to Service Manager-style wiring and safe
metadata generation. Service Lasso core does not own an OIDC callback runtime,
session store, token validator, provider account lifecycle, or custom app-login
platform.

## Ownership boundary

- **Traefik** owns local host routing, TLS entrypoints, and middleware
  attachment.
- **`traefik-oidc-auth`** owns the OIDC login gate, callback handling, session
  validation, token checks, claim assertions, and identity header emission.
- **ZITADEL** owns the identity provider, users, projects, roles, claims, issuer,
  and OIDC client behavior.
- **Service Lasso core** starts/configures services, writes service-owned config,
  and passes protected Secrets Broker refs to the services that own them.
- **Service Admin** owns its app-level current-user/workspace behavior after the
  route boundary has supplied safe trusted identity metadata.

## Bootstrap command

Generate the local SSO bootstrap plan:

```powershell
node scripts/local-sso-bootstrap.mjs
```

By default this writes:

```text
runtime/local-sso-bootstrap.plan.json
```

Set `SERVICE_LASSO_LOCAL_SSO_PLAN` to write the plan elsewhere.

## Generated contract

The generated plan includes metadata for:

- Service Admin route:
  `https://serviceadmin.servicelasso.localhost`
- ZITADEL route:
  `https://zitadel.servicelasso.localhost`
- Traefik dashboard route:
  `https://traefik.servicelasso.localhost`
- OIDC middleware service id: `traefik-oidc-auth`
- OIDC middleware display name: `Service Lasso Traefik OIDC middleware`
- callback URI:
  `https://serviceadmin.servicelasso.localhost/oauth2/callback`
- post-logout URI: `https://serviceadmin.servicelasso.localhost/`
- ZITADEL client id: `service-lasso:traefik-oidc-auth`
- client secret ref:
  `secretref://@secretsbroker/zitadel/traefik-oidc-auth/client-secret`
- middleware local session secret ref:
  `secretref://@secretsbroker/traefik-oidc-auth/session-secret`

The plan also includes safe smoke-check steps for the expected local loop:

1. request the protected Service Admin route,
2. redirect unauthenticated requests to ZITADEL,
3. return to the `traefik-oidc-auth` callback URI,
4. render Service Admin with trusted identity headers and no raw token material.

## Safety requirements

Bootstrap output is metadata-only. It may include local domains, route names,
client ids, redirect URIs, scopes, trusted header names, and `secretref://`
pointers. It must not print, store, or commit raw client secrets, local session
secrets, access tokens, ID tokens, refresh tokens, cookies, provider
credentials, database passwords, private keys, recovery material, or env value
payloads.

The local domain suffix must be `servicelasso.localhost`, not `.local`. Tests
fail if `.local` or core-owned OIDC wording is introduced.

## Validation

Run the focused contract test:

```powershell
npm run build
node --test --test-concurrency=1 tests/local-sso-bootstrap.test.js
```

Run the full repository test gate when changing the bootstrap contract:

```powershell
npm test
```

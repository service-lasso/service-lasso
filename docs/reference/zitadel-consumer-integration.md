---
title: ZITADEL Consumer Integration
sidebar_label: ZITADEL Consumer Integration
---

# ZITADEL Consumer Integration

ZITADEL is an optional, app-owned identity service. Service Lasso can acquire,
configure, start, stop, and health-check the `service-lasso/lasso-zitadel`
release artifact, but the consuming app owns the decision to include ZITADEL,
the database, domain, issuer, client registrations, redirect URIs, and secret
lifecycle.

Do not add ZITADEL to the core baseline just because an app needs SSO. Commit it
inside that app's `services/` inventory instead.

## Traefik + ZITADEL + Service Admin SSO split

In the local Service Admin SSO path, do not build a custom OIDC auth facade in
Service Lasso by default. Use Traefik plus an OIDC middleware/plugin, such as
`traefik-oidc-auth`, together with ZITADEL as the identity provider.

Clean responsibility split:

- **Traefik**: front door, routing, TLS/localhost entrypoints, middleware hooks,
  protected-route enforcement, and OIDC middleware/plugin execution.
- **Traefik OIDC middleware/plugin**: OIDC redirect/callback/session gate,
  ZITADEL token validation, PKCE support, scopes, and claim/role assertions.
- **ZITADEL**: identity provider, login UI, users, projects, applications,
  roles, claims, issuer, and OIDC client configuration.
- **Service Lasso**: service orchestration and configuration generation only:
  compose hostnames, generate Traefik dynamic config, wire middleware options,
  verify/bootstrap ZITADEL app/client settings where supported, and expose or
  consume safe identity metadata contracts for Service Admin.

Service Lasso should not own the OIDC callback/session/token-validation runtime
unless a concrete gap proves the Traefik plugin path cannot satisfy the local
stack. If a gap appears later, prefer a small identity/context adapter over a
full replacement auth facade.

Service Lasso-owned SSO-adjacent responsibilities:

- **Hostname composition**: decide or generate local names from the Traefik
  localhost suffix convention, such as `serviceadmin.servicelasso.localhost`,
  `auth.servicelasso.localhost`, and `zitadel.servicelasso.localhost`.
- **Traefik dynamic config generation**: write or compose routers, services,
  and middlewares into Traefik runtime config such as `runtime/dynamic.yml`, so
  requests for those hostnames route to the right app or service and protected
  routes attach the OIDC middleware.
- **OIDC middleware configuration**: generate plugin configuration from safe
  references: ZITADEL issuer URL, client ID, configured scopes, callback path,
  role/claim assertions, and secret refs/handles where needed. Do not embed raw
  client secrets or tokens in generated public docs/logs.
- **ZITADEL bootstrap/verification**: create or verify the ZITADEL
  project/application/client where supported, including exact redirect URLs such
  as `https://serviceadmin.servicelasso.localhost/oidc/callback` or the selected
  plugin callback route.
- **Service Admin integration**: make Service Admin consume the resulting trusted
  headers/claims/context from the protected route boundary rather than owning a
  separate login system or parsing raw ZITADEL tokens.
- **Security hardening**: strip spoofed auth headers before middleware output,
  block direct bypass routes to protected apps, fail closed when OIDC/ZITADEL is
  unavailable, and keep tokens and secrets out of UI surfaces and logs.

The resulting flow is:

1. User opens `https://serviceadmin.servicelasso.localhost`.
2. Traefik routes the request through the configured OIDC middleware/plugin.
3. The middleware redirects unauthenticated users to ZITADEL.
4. ZITADEL authenticates the user and redirects back to the middleware callback.
5. The middleware validates the response/session and applies configured
   claim/role assertions.
6. Service Admin receives only the safe trusted identity metadata available at
   the protected route boundary and renders the operator as logged in for the
   resolved workspace/app context.

## Reference fixture

A concrete committed pattern lives at:

```text
fixtures/zitadel-consumer-app/services/postgres/service.json
fixtures/zitadel-consumer-app/services/zitadel/service.json
```

The fixture models an app-owned stack with:

- `postgres`: local PostgreSQL service that owns the `zitadel` database.
- `zitadel`: release-backed ZITADEL service that depends on `postgres`.
- broker import `identity.ZITADEL_MASTERKEY` from namespace `services/zitadel`.
- external local issuer `http://localhost:${HTTP_PORT}/`.
- console URL `http://localhost:${HTTP_PORT}/ui/console/`.
- health URL `http://127.0.0.1:${HTTP_PORT}/debug/ready`.

Copy the pattern into a reference app or product repo when that app opts into
local SSO. Keep the service inventory committed so reviewers can see that the
app, not the Service Lasso baseline, owns the identity dependency.

## Required app-owned inputs

The consuming app must supply these before `zitadel/start`:

| Input | Owner | Notes |
| --- | --- | --- |
| PostgreSQL dependency | App | Commit or otherwise provide a `postgres` service and start it before ZITADEL. The fixture uses `depend_on: ["postgres"]`. |
| `ZITADEL_DATABASE_POSTGRES_DSN` | App | The fixture builds `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/zitadel?sslmode=disable` from the sibling PostgreSQL service. Production apps should use their own database, credentials, TLS posture, and retention policy. |
| `ZITADEL_MASTERKEY` | App secret owner | Stable exactly-32-byte key. Store it in the app-owned Secrets Broker namespace, not in `service.json`, source control, logs, issue comments, or support bundles. |
| External domain and port | App | The local fixture uses `localhost` and `HTTP_PORT`. Packaged apps must set the externally visible host/port that users and OIDC clients will actually use. |
| Issuer URL | App | Must remain stable for OIDC clients. The fixture emits `ZITADEL_ISSUER=http://localhost:${HTTP_PORT}/`. |
| Redirect URIs | App | Register exact redirect URIs for each consuming client, for example `http://localhost:3000/auth/callback` for a local web app. |
| Client setup | App/ZITADEL admin | Create the project/application/client in ZITADEL and store client IDs/secrets according to the consuming app's secret policy. |

## Service Lasso-owned behavior

Service Lasso owns the bounded runtime mechanics:

1. Discover the committed app-owned `services/zitadel/service.json`.
2. Resolve declared ports and local selectors.
3. Acquire the `service-lasso/lasso-zitadel` release artifact during install.
4. Materialize install/config files declared by the manifest.
5. Inject resolved env, including the broker-provided master key, only at process
   launch.
6. Start the process with `start-from-init --masterkeyFromEnv --tlsMode disabled`
   for the local fixture contract.
7. Report readiness through `/debug/ready`.

Service Lasso does not own ZITADEL org/project/client administration, user
lifecycle, cross-instance trust, public TLS, or production database operations in
this slice.

## Smoke and blocked prerequisites

The fixture is intentionally safe to validate without starting a real identity
stack:

```bash
npm run build
node --test --test-concurrency=1 tests/zitadel-consumer-contract.test.js
```

That test proves the committed fixture manifests are loadable, app-owned,
non-baseline, dependency-linked, broker-backed for `ZITADEL_MASTERKEY`, and
documented.

A full acquisition/config/start smoke is valid only after the app supplies:

1. a reachable PostgreSQL service/database for ZITADEL,
2. the app-owned `identity.ZITADEL_MASTERKEY` broker secret with exactly 32
   bytes,
3. stable local external domain/port values,
4. the expected client redirect URIs.

Once those prerequisites exist in a real app workspace, the operator flow is:

```text
POST /api/services/postgres/install
POST /api/services/postgres/config
POST /api/services/postgres/start
POST /api/services/zitadel/install
POST /api/services/zitadel/config
POST /api/services/zitadel/start
GET  /api/services/zitadel/health
```

If any prerequisite is missing, fail closed and report the missing input. Do not
silently fall back to a generated master key or a default database.

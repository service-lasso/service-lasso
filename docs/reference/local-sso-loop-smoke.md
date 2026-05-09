# Local SSO loop smoke fixture

Service Lasso validates the local `servicelasso.localhost` SSO loop with a deterministic fixture that can run in CI without real provider credentials or a live browser login.

The fixture is intentionally a smoke/regression contract, not an auth runtime. Auth mechanics remain owned by Traefik, the external/plugin-owned `traefik-oidc-auth` middleware, and ZITADEL/service-owned configuration. Service Lasso core only verifies the generated route/config shape and safe evidence surfaces.

## Covered route loop

The smoke fixture covers:

```text
GET https://serviceadmin.servicelasso.localhost
-> protected Traefik route
-> traefik-oidc-auth redirects to ZITADEL
-> callback at https://auth.servicelasso.localhost/oauth2/callback
-> fixture session established by traefik-oidc-auth
-> Service Admin receives safe trusted identity metadata
```

It also covers the fail-closed path when the auth middleware is unavailable or no trusted identity context exists.

## Generated evidence

Run:

```powershell
npm run test:local-sso-loop
```

To write the fixture evidence directly:

```powershell
node scripts/local-sso-loop-smoke.mjs
```

By default this writes:

```text
runtime/local-sso-loop-smoke.evidence.json
```

The evidence contains only metadata:

- Service Admin, auth callback, and ZITADEL `servicelasso.localhost` routes
- protected route middleware chain
- spoofable identity header stripping
- trusted identity header allowlist returned by `traefik-oidc-auth`
- browser-flow expectations for redirect, callback, authenticated return, and fail-closed behavior
- captured page text/log/diagnostic examples with no credential material

## Safety assertions

Tests reject evidence containing:

- `.local` shorthand
- unauthenticated Service Admin bypass route names
- `trustForwardHeader: true`
- ID/access/refresh tokens
- client secrets
- session cookie values
- provider credentials
- raw secret values
- private keys or bearer tokens

The fixture uses deterministic fake states only and must not require real provider credentials.

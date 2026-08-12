# Traefik local route generation

Service Lasso writes Traefik dynamic route config for local app hosts under `servicelasso.localhost`. This is routing/config generation only; Service Lasso core does not implement a custom OIDC/session/token auth facade runtime.

## Hostname contract

Hostnames are composed as:

```text
<app>.servicelasso.localhost
```

Examples:

- `serviceadmin.servicelasso.localhost`
- `auth.servicelasso.localhost`
- `zitadel.servicelasso.localhost`

Use `.localhost`, not `.local`.

## Dynamic config target

`lasso-traefik` reads a file provider at:

```text
runtime/dynamic.yml
```

Service Lasso route generation should render a complete dynamic config object/YAML and replace this file atomically during config/update flows. The generated file contains only routers, services, and middleware references; it must not include tokens, OIDC client secrets, session cookies, provider credentials, or raw identity envelopes.

## Protected app routes

Protected app routes include:

- a router matching `Host("app.servicelasso.localhost")` for the generated app hostname
- `websecure` entrypoint
- TLS enabled
- a backend service URL pointing at the loopback/internal app port
- spoofed identity header stripping middleware
- forward-auth middleware reference

The default protected route middleware chain is:

```yaml
middlewares:
  - servicelasso-strip-spoofed-identity
  - servicelasso-forward-auth
```

`servicelasso-forward-auth` is a middleware reference/config boundary. Auth mechanics are owned by Traefik/auth middleware + ZITADEL/service-owned behavior, not by a Service Lasso core auth runtime.

## No default bypass route

Service Lasso must not generate an unauthenticated `serviceadmin` bypass route by default. Public routes must be explicitly marked as unprotected and must use their own app host/router identity.

## Test gate

Automated tests cover:

- hostname composition under `servicelasso.localhost`
- rejection of `.local` shorthand
- generated router/service/middleware shape
- protected route middleware attachment
- no default unauthenticated bypass route
- generated fixture/YAML absence of tokens, OIDC client secrets, session cookies, provider credentials, and other secret-like material

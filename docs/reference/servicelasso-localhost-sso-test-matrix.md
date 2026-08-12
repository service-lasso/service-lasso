# servicelasso.localhost SSO test matrix

This matrix is the automated regression map for the local Service Lasso SSO stack.

Corrected boundary: Service Lasso core owns route/config contracts and deterministic smoke evidence. Auth mechanics are owned by Traefik, external/plugin-owned `traefik-oidc-auth` / Service Lasso Traefik OIDC middleware, and ZITADEL/service-owned configuration. Service Lasso core must not implement a custom OIDC/session/token auth runtime.

## CI/local entrypoints

| Scope | Command | Repo | Evidence |
| --- | --- | --- | --- |
| Core full regression | `npm test` | `service-lasso/service-lasso` | Core API/runtime tests plus route generation, local SSO bootstrap, local SSO loop smoke, ZITADEL consumer fixtures, and leak harness tests. |
| Core docs | `npm run docs:build` | `service-lasso/service-lasso` | Docusaurus reference docs build, including this matrix and SSO smoke docs. |
| Traefik route generation | `npm run test:local-sso` and `node --test tests/traefik-local-route-generation.test.js` after `npm run build` | `service-lasso/service-lasso` | Hostname, route, middleware, `.localhost`, no-bypass, and no-secret route-generation assertions. |
| Local SSO loop smoke | `npm run test:local-sso-loop` | `service-lasso/service-lasso` | Deterministic Service Admin -> auth callback -> ZITADEL -> authenticated return and fail-closed smoke evidence. |
| ZITADEL bootstrap | `npm run test:oidc` and `npm test` | `service-lasso/lasso-zitadel` | Idempotent client bootstrap, redirect/post-logout/origin metadata, and metadata-only output. |
| Traefik protected routes | `npm test` | `service-lasso/lasso-traefik` | Packaged Traefik fixture checks, protected route middleware, header stripping, and `/ping` smoke. |
| Service Admin identity UI | targeted `vitest` auth-session/secrets-broker tests and `npm run build` | `service-lasso/lasso-serviceadmin` | Trusted identity UI states, safe actor/workspace metadata, and no-secret rendering. |

## Requirement matrix

| Requirement | Automated test location | Validation command | Notes |
| --- | --- | --- | --- |
| Hostname composition uses `servicelasso.localhost`. | `service-lasso/tests/traefik-local-route-generation.test.js`; `service-lasso/tests/local-sso-bootstrap.test.js`; `service-lasso/tests/local-sso-loop-smoke.test.js` | `npm run test:local-sso`; `npm run test:local-sso-loop`; full `npm test` | Tests reject `.local` shorthand and assert `serviceadmin.servicelasso.localhost`, `auth.servicelasso.localhost`, and `zitadel.servicelasso.localhost`. |
| Generated Traefik dynamic config contains routers/services/middlewares. | `service-lasso/tests/traefik-local-route-generation.test.js`; `service-lasso/tests/local-sso-loop-smoke.test.js` | `node --test tests/traefik-local-route-generation.test.js`; `npm run test:local-sso-loop` | Covers Service Admin protected route, auth callback route, ZITADEL route, backend services, and middleware chain. |
| Protected route allow/deny behavior. | `service-lasso/tests/local-sso-loop-smoke.test.js`; `service-lasso/lasso-traefik/runtime/protected-serviceadmin.example.yml` verified by `lasso-traefik/scripts/verify.mjs` | `npm run test:local-sso-loop`; `lasso-traefik` `npm test` | Fixture models unauthenticated redirect, authenticated return, and auth-unavailable fail-closed behavior. |
| Header stripping and trusted identity forwarding. | `service-lasso/tests/traefik-local-route-generation.test.js`; `service-lasso/tests/local-sso-loop-smoke.test.js`; `lasso-traefik/scripts/verify.mjs` | `npm run test:local-sso-loop`; `lasso-traefik` `npm test` | Spoofable browser headers are blanked; trusted headers are allowlisted from `traefik-oidc-auth`. |
| ZITADEL OIDC client bootstrap idempotency. | `lasso-zitadel/scripts/oidc-bootstrap.test.mjs` | `lasso-zitadel` `npm run test:oidc`; `npm test` | Covers create, verify existing, update drift, and no rotation of credentials unless explicitly requested. |
| Redirect URI and post-logout URI correctness. | `lasso-zitadel/scripts/oidc-bootstrap.test.mjs`; `service-lasso/tests/local-sso-bootstrap.test.js` | `lasso-zitadel` `npm run test:oidc`; `service-lasso` `npm run test:local-sso` | Uses `https://auth.servicelasso.localhost/oauth2/callback` for ZITADEL client metadata and deterministic local smoke metadata. |
| Callback/session validation boundary. | `service-lasso/tests/local-sso-loop-smoke.test.js` | `npm run test:local-sso-loop` | Covered as external/plugin-owned `traefik-oidc-auth` callback/session fixture evidence; core does not own session mechanics. |
| Service Admin authenticated/unauthenticated/forbidden/expired/workspace mismatch states. | `lasso-serviceadmin/src/features/auth-session/zitadel-session.test.tsx` | targeted `vitest` auth-session tests; `npm run build` | Renders safe identity, workspace, role, permission, and audit actor metadata only. |
| End-to-end Service Admin login return smoke path. | `service-lasso/tests/local-sso-loop-smoke.test.js` | `npm run test:local-sso-loop` | Deterministic smoke contract verifies redirect, callback return, and authenticated Service Admin page evidence. |
| Fail-closed auth unavailable/ZITADEL unavailable behavior. | `service-lasso/tests/local-sso-loop-smoke.test.js`; `lasso-traefik/scripts/verify.mjs`; `lasso-serviceadmin/src/features/auth-session/zitadel-session.test.tsx` | `npm run test:local-sso-loop`; `lasso-traefik` `npm test`; Service Admin targeted tests | Protected apps must not have default unauthenticated bypass routes. Missing/invalid identity context fails closed. |
| Secret-leak regression across page text, logs, generated config, diagnostics, snapshots, headers, and fixtures. | `service-lasso/tests/secret-leak-harness.test.js`; `service-lasso/tests/local-sso-loop-smoke.test.js`; `service-lasso/tests/local-sso-bootstrap.test.js`; `lasso-zitadel/scripts/oidc-bootstrap.test.mjs`; `lasso-serviceadmin/src/features/auth-session/zitadel-session.test.tsx`; `lasso-serviceadmin/src/features/secrets-broker/secrets-broker-setup.test.tsx` | Full repo tests and targeted SSO tests listed above | Deny-list covers ID/access/refresh tokens, client secrets, session cookies, provider credentials, raw secret values, private keys, bearer material, and raw env-like values. |

## Implementation issue coverage

| Issue | Current boundary/result | Automated gate |
| --- | --- | --- |
| `service-lasso/service-lasso#429` | Core Traefik dynamic route generation for `servicelasso.localhost`; no custom auth runtime. | `tests/traefik-local-route-generation.test.js`; `npm test`; docs build. |
| `service-lasso/service-lasso#430` | Legacy custom auth-facade runtime concept is blocked/superseded. | Matrix intentionally maps callback/session checks to `traefik-oidc-auth` fixture evidence, not Service Lasso-owned runtime tests. |
| `service-lasso/lasso-zitadel#2` | ZITADEL client bootstrap for external/plugin-owned OIDC middleware with metadata-only output. | `scripts/oidc-bootstrap.test.mjs`; `npm run test:oidc`; `npm test`. |
| `service-lasso/lasso-serviceadmin#90` | Service Admin consumes trusted protected-route identity context and renders safe metadata. | `src/features/auth-session/zitadel-session.test.tsx`; Secrets Broker setup leak tests; `npm run build`. |
| `service-lasso/lasso-traefik#13` | Protected Service Admin route middleware/templates/fixtures. | `runtime/protected-serviceadmin.example.yml` verified by `scripts/verify.mjs`; `npm test`. |
| `service-lasso/service-lasso#431` | Deterministic local SSO loop smoke/regression evidence. | `tests/local-sso-loop-smoke.test.js`; `npm run test:local-sso-loop`. |

## Required regression invariants

- Any `.local` shorthand in this SSO path must fail a test.
- Any token, cookie, client secret, provider credential, private key, raw env value, or raw secret material in generated config, docs examples, diagnostics, logs, page text, snapshots, headers, or fixtures must fail a test.
- Any Service Admin default unauthenticated bypass route must fail a test.
- Any reintroduction of Service Lasso-owned custom auth runtime language for this stack should be treated as boundary drift and corrected before implementation.

# Local operator auth (Phase 0) and SSO slots (Phase 1)

## Intent
Give operators a local login path before ZITADEL is required, while keeping loopback `local-root` as break-glass. Remote (LAN IP or hostname, including when processes bind `0.0.0.0`) must prove a Lasso-local secret. Vault `FORCE_SSO` forces remote SSO-only. On loopback it must not hide or reject local-root, Lasso-local password, vault token, or SSO/ZITADEL when configured.

## Scope
Included:
- Loopback vs remote origin rules in Core request-policy
- First-run ingest of local-admin token and local-operator credential into Secrets Broker KV
- Core `POST /api/runtime/auth/local` validation (token or Lasso-local password)
- Remote attempt rate-limiting that does not lock loopback
- Vault flag `runtime/auth` / `FORCE_SSO` honored for remote requests
- Identity-provider slots on `/api/runtime/security` (ZITADEL when enabled or packaged)
- Service Admin login UI for local, token, and provider buttons

Explicitly out of scope:
- Traefik OIDC middleware cutover
- Core OIDC/session facade revival (#430)
- Collecting OS/Windows passwords
- Migrating passwords into ZITADEL
- Changing `operator.json` (Broker daemon token only)

## Acceptance Criteria
- `AC-5A`: Requests whose effective client address is loopback (`127.0.0.1`, `::1`, `localhost`, `127.0.0.0/8`) authenticate as `local-root` without a password, including when `FORCE_SSO` is true. Loopback still accepts Lasso-local password, local-admin token, and a ZITADEL actor when configured. `FORCE_SSO` must not reject those proofs on loopback.
- `AC-5B`: `0.0.0.0` is a bind address, not a browser origin. A loopback Admin/Core proxy must forward the original client address; LAN/hostname clients are not `local-root`.
- `AC-5C`: First-run best-effort ingest writes local-admin token and local-operator password into Broker KV path `runtime/local-operator` without putting plaintext in `service.json`, without overwriting existing refs, and without logging values.
- `AC-5D`: Remote login (when `FORCE_SSO` is off) accepts (1) the local-admin token or (2) username `local-operator` plus the Lasso-local password. Validation is `POST /api/runtime/auth/local`. OS passwords are rejected as a credential source. Loopback accepts the same proofs even when `FORCE_SSO` is true.
- `AC-5E`: Remote validation failures are rate-limited per client address. Loopback is not rate-limited by this limiter.
- `AC-5F`: When KV `runtime/auth` field `FORCE_SSO` is true, remote requests accept only a ZITADEL actor. Local and token proofs are disabled remotely. Loopback continues to allow local-root, local, token, and ZITADEL.
- `AC-5G`: `GET /api/runtime/security` reports `forceSso`, `localTokenConfigured`, `localOperatorConfigured`, and `identityProviders` without credential material. Loopback responses still advertise configured providers when `FORCE_SSO` is true and must not add `force_sso_required`.
- `AC-5H`: Tests use fake sentinels only and never print live tokens.

## Tests and Evidence
- Request-policy unit tests for loopback, forwarded LAN client, token, force-SSO, and spoofed forwarded headers from a non-loopback peer.
- API tests for `POST /api/runtime/auth/local` success/failure and remote rate-limit.
- Admin unit tests for loopback vs remote vs force-SSO login UI.

## Documentation Impact
- `docs/reference/first-run-vault-bootstrap-permissions.md` local/remote rules
- This spec and `PROJECT_INTENT.md`

## Verification
- `npm test` targeted auth tests after `tsc`
- Admin `pnpm test` targeted auth tests

## Change Notes
- Vault flag path: KV `runtime/auth` field `FORCE_SSO` (`true` / `false`). Flip it from loopback via the KV editor so force-SSO cannot lock the operator out of the machine. `FORCE_SSO` applies only to remote origins.
- Local secrets path: KV `runtime/local-operator` fields `LOCAL_ADMIN_TOKEN` and `LOCAL_OPERATOR_PASSWORD`.
- Core prefers an explicit valid local-admin token or issued session as `local-token` even on loopback; otherwise a ZITADEL actor when presented; otherwise loopback is `local-root`. `FORCE_SSO` does not change that loopback order.
- `#1025` (trusted ingress / Admin port bypass remainder) stays open: this spec covers original-client forwarding from a loopback peer plus Admin origin checks, not full Traefik header normalization.

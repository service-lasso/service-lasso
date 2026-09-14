# Variables and Secrets Broker Safety Guide

Status: metadata-only operator guidance. Service Admin can show variable
posture, secret references, provider state, policy outcomes, and audit
metadata, but it must not render raw secret material.

Use this guide when deciding whether a value belongs in a service variable, a
global variable, or a Secrets Broker reference.

## Variables versus secret references

| Value type | Use it for | Operator expectation |
| --- | --- | --- |
| Service-scoped variable | Non-sensitive values used by one service, such as a port, feature flag, or local path. | The value may be visible to operators who can edit that service. |
| Global variable | Non-sensitive values reused by multiple services, such as a shared hostname, region, or public base URL. | Update once, then review which services consume the shared value. |
| Secret reference | Sensitive material that should be resolved by Secrets Broker, such as tokens, passwords, API keys, private keys, recovery material, and session credentials. | Service Admin shows the ref, source, state, policy, and audit metadata, not the resolved value. |

Shared values should become global variables only when they are safe to display
and are intentionally reused by more than one service. Sensitive shared values
should become secret references instead, even if every service needs the same
credential.

## What Service Admin must never render

Service Admin Help Center text, tables, drawers, previews, exports, and audit
views must never expose:

- raw secret values
- provider tokens
- API keys
- passwords
- private keys
- session tokens
- recovery material
- unredacted environment values that contain credential material

Masked placeholders and omitted fields are safety controls, not missing data.
Treat `masked`, `redacted`, `omitted`, and `metadata only` states as evidence
that the UI preserved the no-plaintext-secret boundary.

## Secrets Broker concepts

Secrets Broker keeps sensitive values behind a brokered metadata and policy
boundary:

- Providers describe the backing integration, such as a local encrypted store,
  mounted file source, exec adapter, or external secret manager.
- Sources are configured provider instances with auth, lock, health, and
  availability state.
- Topology links services to the secret refs they declare and shows whether refs
  are known, missing, blocked, or policy-denied.
- Policy decisions decide whether an operation may preview metadata, resolve a
  value for a service, reveal a single value to an authorized operator, rotate a
  credential, or write generated material back to a source.
- Resolution is the runtime path that supplies a service with the value it is
  allowed to receive.
- Reveal is a privileged operator workflow and must require explicit scope,
  confirmation, audit reason, policy allow state, and terminal operation
  evidence. It is not the default variables view.
- Write-back records generated or rotated material in the selected source only
  after policy, confirmation, and audit checks pass.

## Presenting broker states

When a source needs authentication, is locked, degraded, unavailable, or blocked
by policy, present the state as an action boundary. Show the provider/source ref,
safe reason code, affected service refs, audit or correlation id, and the next
operator action.

Do not replace an auth-required or policy-denied state with a raw value, copied
credential, request body, response body, provider token, or stack trace. If a
secret cannot be resolved, the safe answer is the state and recovery path, not
the secret.

## Operator workflow

1. Use **Dashboard** to check Broker ready and active lockout counts. Home never shows secret values and does not onboard on read.
2. Use **Variables** to review service-scoped and global non-sensitive values.
3. Promote duplicated non-sensitive values to global variables when shared use
   is intentional.
4. Move sensitive values into Secrets Broker and store only a secret ref in the
   service config.
5. Use **Secrets** for the local KV editor, **Providers** for source status,
   **Topology** and **Review** for mappings, and **Audit** for events.
6. Use reveal or write-back flows only when the UI asks for explicit
   confirmation, an audit reason, and terminal operation evidence.
7. Use **Audit** to review policy outcomes and operation receipts.

## Related docs

- [Environment Variables: Global and Service Reuse](environment-variables-global-and-service-reuse.md)
- [Product status and safety](product-status-and-safety.md)
- [Service install and setup config](service-install-and-setup-config.md)

---

[Component guides](../README.md) · Imported from [lasso-serviceadmin](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/help/variables-and-secrets-broker-safety-guide.md). The [migration inventory](../documentation-migration.md) records ownership and remaining work.

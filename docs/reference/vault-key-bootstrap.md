# Vault key bootstrap

This document is the implementation reference for
[service-lasso/service-lasso#824](https://github.com/service-lasso/service-lasso/issues/824).

## Purpose

Fresh setup needs one durable vault key contract for local onboarding and
headless/container deployments. The runtime may use raw key material internally
while creating the vault, but API responses, audit events, logs, and setup state
must expose only safe source metadata and a fingerprint.

## Source order

Service Lasso resolves vault key material in this order:

1. OS-managed keychain provider.
2. Mounted secret file, such as `SERVICE_LASSO_VAULT_KEY_FILE`.
3. Environment variable, such as `SERVICE_LASSO_VAULT_KEY`.
4. CLI parameter.
5. Generated local setup key.

CLI parameters are supported for compatibility and local scripts, but they are
the least-preferred supplied source because process listings and shell history
can expose command-line values.

## Supplied keys

When a supplied key is used before the vault exists:

- create the vault with that key
- do not reveal or echo the key through setup UI, API responses, logs, or audit
- expose the source type and source label, such as file path or env var name
- expose a safe SHA-256 fingerprint so the operator can compare sources
- audit the source type and fingerprint without storing the raw key

## Generated keys

When no supplied key is available:

- generate at least 32 random bytes
- reveal the generated key once during local setup
- require the operator to confirm it was saved before setup completes
- store only safe verification metadata and the vault material needed to unlock
  the vault
- never re-reveal the generated key after setup completion

The public bootstrap response uses `contractVersion:
"vault-key-bootstrap.v1"`. `oneTimeReveal` is only populated for generated-key
setup responses that explicitly request first reveal.

## Runtime input names

The first implementation slice reserves these runtime input names:

- `SERVICE_LASSO_VAULT_KEY_FILE`: mounted file containing the vault key.
- `SERVICE_LASSO_VAULT_KEY`: raw key material supplied by environment.

Future CLI wiring should map a CLI vault-key argument into the lower-priority
CLI source without changing the public response shape.

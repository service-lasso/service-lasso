# Secrets Broker key custody and first-run bootstrap

This document is the current Core implementation reference for
[service-lasso/service-lasso#1022](https://github.com/service-lasso/service-lasso/issues/1022)
and supersedes the generated-key reveal proposal in issue `#824`.

## Purpose

Fresh setup must initialize the real release-backed `@secretsbroker` service.
A marker file, mock vault state, or browser-held key never satisfies readiness.
Core considers setup complete only when protected workspace credentials, the
encrypted Broker store, platform custody evidence, authenticated local IPC, and
the Broker readiness probe agree.

## Custody model

Core generates independent random API-token, launch-signing, and master-key
material for the workspace. It stores the credential record under the workspace
private-state root with these platform boundaries:

- Windows: the private record is encrypted with CurrentUser DPAPI and restricted
  to the current SID plus `SYSTEM`; the Broker master key is imported into a
  separate DPAPI-protected wrapper before normal service launch.
- Unix-like systems: the private record and Broker transport files are regular,
  non-redirected owner-only files (`0600` under owner-only directories), and the
  Unix socket is bound to the current UID.

Same-user processes remain inside the local trust boundary on Unix-like systems;
operators who require stronger isolation must run Service Lasso under a
dedicated OS account or container boundary.

Credentials are supplied to the Broker only through the internal launch
environment. They are never command-line arguments and must not appear in API
responses, UI state, logs, audit events, diagnostics, manifests, or issue/PR
evidence.

## Bootstrap sequence

`POST /api/setup/bootstrap` is accepted only on loopback or with a valid
transient setup token. The endpoint then:

1. requires `@secretsbroker` to be discovered, installed, and configured;
2. creates or loads the protected workspace credential record;
3. initializes the encrypted store;
4. imports and verifies the Windows key wrapper when applicable;
5. starts the Broker on authenticated named-pipe or Unix-socket transport;
6. requires an authenticated readiness probe;
7. provisions required Broker-generated declarations without returning values;
8. records metadata-only setup audit events; and
9. returns the public `service-lasso.setup-status.v1` projection.

Any missing artifact, redirected executable, custody failure, malformed status,
unready IPC endpoint, or required provisioning failure stops setup. A legacy
store marker does not bypass these checks.

## Public response boundary

Public setup status and bootstrap responses may contain setup state, required
and ready booleans, safe OS operator context, bind/trust flags, auth metadata,
blockers, and a provisioned-declaration count.

They never contain store or wrapper paths, IPC addresses, master keys, API
tokens, signing keys, ciphertext, private credential envelopes, secret values,
or one-time reveal fields. There is no reveal, copy, download, print, or
acknowledgement flow for generated Broker key material.

## Headless and remote setup

`SERVICE_LASSO_SETUP_TOKEN` authorizes bootstrap on a non-loopback runtime bind;
it is not vault key material. It remains transient request authority and is
cleared by Service Admin after success or failure. Container/image automation
must preinstall and configure the exact Broker artifact before invoking the same
bootstrap endpoint.

## Recovery

Operators recover the local Broker through its audited encrypted backup,
verification, restore, and master-key-rotation APIs. If protected workspace
credentials and all valid backups are lost, Core cannot reconstruct encrypted
secret values; reconnect external providers or initialize a new workspace.

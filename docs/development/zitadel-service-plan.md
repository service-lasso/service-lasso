# ZITADEL Service Plan

Date: 2026-04-28

Linked issue: `#207`

OpenSpec binding: `SPEC-002`, `AC-4U`, `AC-4Y`

## Decision

ZITADEL is delivered as an optional release-backed service repo, not as a default core baseline service.

Repo:

- [`service-lasso/lasso-zitadel`](https://github.com/service-lasso/lasso-zitadel)

First release:

- `2026.4.27-8b38162`

Packaged upstream runtime:

- ZITADEL `v4.14.0`

Release assets:

- `lasso-zitadel-v4.14.0-win32.zip`
- `lasso-zitadel-v4.14.0-linux.tar.gz`
- `lasso-zitadel-v4.14.0-darwin.tar.gz`
- `service.json`
- `SHA256SUMS.txt`

## Runtime Contract

Consumers opt in by committing the released manifest as:

```text
services/zitadel/service.json
```

The released manifest is disabled by default because a working ZITADEL instance requires app-owned runtime configuration:

- PostgreSQL database reachable by ZITADEL
- stable 32-byte `ZITADEL_MASTERKEY`
- app-specific external domain/port decisions

The release-backed archive contains the upstream ZITADEL binary and Service Lasso package metadata. Service Lasso owns acquisition/unpack, but the app owns secrets and database configuration.

## Validation

Local service repo proof:

- `npm test` in `C:\projects\service-lasso\lasso-zitadel`
- packaged upstream ZITADEL `v4.14.0` for Windows
- extracted the generated archive
- verified the packaged binary reports `zitadel version v4.14.0`

GitHub release proof:

- workflow run `25009687459`
- Windows, Linux, and macOS packaging jobs passed
- release job created GitHub release `2026.4.27-8b38162`
- release contains platform archives, `service.json`, and `SHA256SUMS.txt`

## Follow-Up Boundary

Do not add ZITADEL to the checked-in core baseline until a consumer app also owns the required PostgreSQL service/configuration and secret management story. If a reference app needs a full identity stack, create a separate issue to add that app's `services/zitadel/service.json`, database dependency, env/secrets documentation, and smoke validation.

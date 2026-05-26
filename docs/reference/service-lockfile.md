# Service Lockfile

Status: initial runtime contract

Service Lasso can pin release-backed service artifact resolution in a lockfile next to the committed service manifests:

```text
services/
  service-lasso.lock.json
  @node/service.json
  @serviceadmin/service.json
  echo-service/service.json
```

The lockfile is generated from the checked-in `servicesRoot` manifests:

```powershell
service-lasso lockfile generate --services-root ./services --workspace-root ./workspace
service-lasso lockfile verify --services-root ./services --workspace-root ./workspace
```

Use `--json` in automation. `verify` exits non-zero when the lockfile is missing, stale, has extra entries, or cannot lock a release-backed artifact for the current platform.

## Format

The current format is `lockfileVersion: 1`:

```json
{
  "lockfileVersion": 1,
  "generatedBy": "service-lasso",
  "generatedAt": "2026-05-20T00:00:00.000Z",
  "services": [
    {
      "serviceId": "@node",
      "sourceType": "github-release",
      "sourceRepo": "service-lasso/lasso-node",
      "releaseTag": "2026.4.27-eca215a",
      "channel": null,
      "platform": "win32",
      "assetName": "lasso-node-v24.15.0-win32.zip",
      "assetUrl": null,
      "archiveType": "zip",
      "checksumSha256": null,
      "dependencies": []
    }
  ]
}
```

Each entry records the resolved service id, release repo, release tag, platform asset, archive type, optional direct asset URL, optional SHA-256 checksum, and manifest dependencies.

## Install behavior

When `service-lasso.lock.json` exists under `servicesRoot`, `install` validates the service's manifest-owned artifact metadata against the matching lockfile entry before acquiring the archive.

- A missing lockfile entry for a release-backed service fails closed.
- A stale entry fails closed.
- A locked `releaseTag` is used when resolving GitHub release metadata instead of floating to latest.
- A locked `checksumSha256` is verified after download and before extraction.

Services without `artifact` metadata are not included in the lockfile.

## Checksums

Service manifests may set `artifact.platforms.<platform>.sha256` to a 64-character SHA-256 hex digest. `lockfile generate` copies that value into `checksumSha256`. If it is absent, the lockfile records `null` and install still pins repo/tag/asset resolution, but it cannot prove archive bytes by checksum.

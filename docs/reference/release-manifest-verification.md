# Release Manifest Verification

`service-lasso release verify-manifest <manifestPath>` checks a local `service.json` and the release asset set beside it before a service release is published or consumed.

Use `--assets-root <path>` when the archives and checksum files are staged outside the manifest directory. Use `--release-version <yyyy.m.d-shortsha>` to verify the expected release label explicitly.

The verifier is read-only. It checks:

- `service.json` parses against the Service Lasso manifest contract.
- archive artifact metadata exists.
- the release label is present, uses `yyyy.m.d-<shortsha>`, and matches `artifact.source.tag` when both are supplied.
- runtime/service `version` metadata is present.
- the asset set includes `service.json` and each platform archive named by `artifact.platforms`.
- each archive has a verifiable SHA-256 checksum from `sha256`, `checksum.value`, `checksum.assetName`, or a local `SHA256SUMS.txt` / `SHA256SUMS` entry.

JSON output is intended for automation:

```powershell
service-lasso release verify-manifest .\service.json --assets-root .\dist\release --release-version 2026.5.29-abcdef1 --json
```

The command exits non-zero when any `error` finding is emitted. Findings include machine-readable `code`, `severity`, and safe asset/platform metadata only.

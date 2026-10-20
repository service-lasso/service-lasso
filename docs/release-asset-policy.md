# Service Lasso release asset policy

Status: baseline  
Created: 2026-05-08  
Scope: `service-lasso/service-lasso` GitHub release assets

## Expected assets

A Service Lasso core release tag `<version>` should publish both generic runtime archives and per-OS runtime bundle assets.

Required release assets:

```text
service-lasso-<version>.tar.gz
service-lasso-bundled-<version>.tar.gz
service-lasso-<version>-win32.zip
service-lasso-<version>-linux.tar.gz
service-lasso-<version>-darwin.tar.gz
service-lasso-bundled-<version>-win32.zip
service-lasso-bundled-<version>-linux.tar.gz
service-lasso-bundled-<version>-darwin.tar.gz
```

The generic archives remain useful as source/runtime staging outputs. The per-OS archives are the consumer-facing bundle set that proves Windows, Linux, and macOS release packaging is represented explicitly on the GitHub release.

## Validation helper

List expected assets for a release tag:

```bash
node scripts/check-release-assets.mjs --expected 2026.5.2-92235c2
```

Compare actual asset names against policy:

```bash
node scripts/check-release-assets.mjs 2026.5.2-92235c2 \
  service-lasso-2026.5.2-92235c2.tar.gz \
  service-lasso-bundled-2026.5.2-92235c2.tar.gz
```

The command exits non-zero when required assets are missing or unexpected names are present.

## Investigation: `2026.5.2-92235c2`

Release `2026.5.2-92235c2` currently has only these assets:

```text
service-lasso-2026.5.2-92235c2.tar.gz
service-lasso-bundled-2026.5.2-92235c2.tar.gz
```

Missing required assets:

```text
service-lasso-2026.5.2-92235c2-win32.zip
service-lasso-2026.5.2-92235c2-linux.tar.gz
service-lasso-2026.5.2-92235c2-darwin.tar.gz
service-lasso-bundled-2026.5.2-92235c2-win32.zip
service-lasso-bundled-2026.5.2-92235c2-linux.tar.gz
service-lasso-bundled-2026.5.2-92235c2-darwin.tar.gz
```

Root cause: `.github/workflows/release-artifact.yml` runs a single Ubuntu job, stages only `service-lasso-<version>.tar.gz` and `service-lasso-bundled-<version>.tar.gz`, and its release step uploads only those two archive paths. The successful workflow run for commit `92235c22835480e5638084031106d298fdcaf165` (`25256316836`) shows `gh release upload` invoked only for `ARCHIVE_PATH` and `BUNDLED_ARCHIVE_PATH`.

This affects the current release pipeline generally. It is not isolated to the `2026.5.2-92235c2` release: the workflow has no OS matrix and no release-asset policy gate for the per-OS bundle names above.

## Required pipeline follow-up

Before the next Service Lasso core release is considered complete, add a release workflow fix that:

1. builds/stages Windows, Linux, and macOS release bundle assets with the names in this policy;
2. uploads those assets to the GitHub release; and
3. runs a release-asset policy check before or immediately after upload so missing OS bundles fail the release job.

## Staged-transfer qualification

The same per-OS release assets are the only archive inputs eligible for the
release-asset staged-transfer protocol. Core resolves the release, asset IDs,
and canonical checksum itself; a CLI or TUI caller cannot supply an asset ID,
checksum, URL, or parser choice. Windows uses the closed ZIP profile. Linux and
macOS use the closed gzip TAR profile in
[the staged-transfer contract](api/staged-service-transfer.md), which admits
only bounded regular/directory USTAR members plus immediate GNU long-name or
POSIX per-file PAX path records.

TAR is not qualified merely because this policy requires `.tar.gz` assets or
because `tar -xzf` succeeds. Before Core enables staged TAR admission, the
release owner must retain real current GNU/Linux and BSD/macOS producer
fixtures/receipts, parser denial evidence, and the checksum-bound released
CLI/TUI/Core journey for Windows, Linux, and macOS. That gate preserves the
full three-OS release target while leaving unqualified TAR transfer fail-closed.

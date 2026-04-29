---
id: 05-validate-release
title: 5. Validate and Release
---

# 5. Validate and Release

Validation proves the service works through Service Lasso, not just that a repo built an archive.

## Required Checks

Run checks that prove:

- Service Lasso can read the consumer `services/<service-id>/service.json`
- Service Lasso can download or reuse the referenced archive
- the archive extracts on each supported platform
- configured commands resolve to real files
- dependencies start in order
- health checks report the expected state
- logs and env outputs are visible where the service contract promises them
- update checks can compare the pinned version with newer release metadata when update behavior is in scope

## Release Evidence

For each service repo release, record:

- release tag
- asset names
- upstream runtime/tool version packaged
- supported platforms
- local verification command output
- CI run URL
- any deferred platform or behavior gaps

For each consuming app, record:

- default download-on-start behavior
- bundled/no-download artifact behavior where applicable
- Service Admin visibility when the app includes `@serviceadmin`

## Exit Criteria

The service is ready only when:

- release assets exist and match `service.json`
- Service Lasso acquisition succeeds
- start/stop/health behavior is verified for managed services
- provider services expose expected env/globalenv values
- consuming apps include the right manifests
- documentation names the exact repo, release, and artifact expectations

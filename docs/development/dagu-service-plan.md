# Dagu Service Plan

Date: 2026-04-28

Linked issue: `#210`

OpenSpec binding: `SPEC-002`, `AC-4U`, `AC-4Y`

## Decision

Dagu is delivered as an optional release-backed service repo, not as a default core baseline service.

Repo:

- `service-lasso/lasso-dagu`

First release:

- `2026.4.27-a43c829`

Packaged upstream runtime:

- Dagu `v2.6.1`

Release assets:

- `lasso-dagu-v2.6.1-win32.zip`
- `lasso-dagu-v2.6.1-linux.tar.gz`
- `lasso-dagu-v2.6.1-darwin.tar.gz`
- `service.json`
- `SHA256SUMS.txt`

## Runtime Contract

Consumers opt in by committing the released manifest as:

```text
services/dagu/service.json
```

The released manifest is disabled by default so apps explicitly choose whether they need a local workflow engine.

Default startup:

```text
dagu start-all --host=127.0.0.1 --port=${HTTP_PORT} --dags=<service-root>/runtime/dags
```

Default healthcheck:

```text
http://127.0.0.1:${HTTP_PORT}/api/v2/health
```

The manifest also exports:

- `DAGU_HTTP_PORT`
- `DAGU_URL`
- `DAGU_HEALTH_URL`

## Validation

Local service repo proof:

- `npm test` in `C:\projects\service-lasso\lasso-dagu`
- packaged upstream Dagu `v2.6.1` for Windows
- extracted the generated archive
- verified the packaged binary reports `2.6.1`

GitHub release proof:

- workflow run `25010221397`
- Windows, Linux, and macOS packaging jobs passed
- release job created GitHub release `2026.4.27-a43c829`
- release contains platform archives, `service.json`, and `SHA256SUMS.txt`

## Follow-Up Boundary

Do not add Dagu to the checked-in core baseline until a consumer app has an explicit workflow use case and commits its own workflow files/configuration. If a reference app needs workflow orchestration, create a separate issue to add that app's `services/dagu/service.json`, sample workflows, UI/API smoke validation, and bundled/bootstrap artifact proof.

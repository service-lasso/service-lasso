# Linux ordinary source API lifecycle integration — #1923

Active Development slice SOURCE-API-1..4; existing supported durable lifecycle v1
API only. No production route or backend changes, default operator-v2 shim,
immutable template catalog admission, protected native actor/package/release
qualification or retained Core1681/CLI43 owner changes.

SOURCE-API-1: One fresh private workspace/services/registries/home with actual
Core createApiServer and awaited owned initialization, ephemeral loopback bind.
Reuse writeExecutableFixtureService for a host Node process fixture, declaring
install.files and config.files that produce independently read expected bytes.
Actual ephemeral RSA key/JWKS server and signed OAuth tokens use the supported
mcpHttpIdentity configuration. No dummy token or implicit local-root denial test.

SOURCE-API-2: Start a control service through actual preview/confirmation/execute
and preserve its running PID + Linux /proc startTimeTicks, manifest and owned
fixture/config bytes. Execute target install/config/start/stop/restart through
actual guarded HTTP API; read each terminal own operation and assert action/id/
target correlation, materialized files, live process/absence/restart birth.
Restart starts a stopped target or replaces a running one; additionally arrange
an actual running restart to establish changed identity. No mocked execution.

SOURCE-API-3: Same completed restart request/key replays identical operation ID
without another process birth/file rewrite or extra operation. Altered same-key
request conflicts. Genuine signed reader scope mutation is403 and foreign signer
is401, with no additional operation/file/process effects. Control identity and
file hashes stay unchanged after every action and denial.

SOURCE-API-4: Bounded HTTP/poll deadlines. Every process obtained from actual
Core runtime state is tracked by PID/start ticks; cleanup uses actual service
stop, awaits positive owned process absence, closes owned API/JWKS connections
and verifies no listener remains. On failure retain private evidence and report
cleanup failures rather than swallow them. Evidence is ordinary source/API
integration on Linux, never current published/native qualification. Distinct
root reviews exact new test source before execution; normal signed PR/squash
merge to develop, postmerge actual test and clean checkout close the issue.

Reuse tests/durable-lifecycle-http.test.js patterns and tests/test-helpers.js
without editing shared helpers or existing large tests. Existing single-action
claims/replay/actor tests remain independent; this test adds actual five-action
file/process effects and preservation of a RUNNING control identity.

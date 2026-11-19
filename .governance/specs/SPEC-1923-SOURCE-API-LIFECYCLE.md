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

## Actual Linux source proof — 2026-11-15

Distinct root accepted source candidate e0bd0103 and requested reserved cleanup
time. Final executed ac49ac6bcbc8d2242b23d9d6e049ac5f698bdc96 adds an internal45s
HTTP execution deadline with t.signal cancellation, retaining the outer120s and
separate cleanup request bounds. Process snapshots compare stable PID/start ticks,
not scheduler R/S transitions; live checks still reject zombies.

The genuine OAuth maintainer profile requires all four scopes: read, lifecycle:
write, config:write AND update:write. No runtime-admin scope is granted. This
follows resolveMcpPermissionProfile; config scope alone is not a maintainer.

Node22.23.2 focused test PASS1/1, zero skipped, ~9.5s execution. Production Core
source inputs are unchanged from the fresh merged #1921 build; artifact SHA256
2d56792a3841f38e5e478da419c2d6b8c557543d0df36d7f4c8b6b25bbc580fb.
Five target operations succeeded with unique IDs and actual installed/configured
file assertions. Start PID1678466/startticks31713270 became absent on stop;
restart-from-stopped PID1679212 was replaced by running restart PID1679595 with
new birth ticks. Same-key completed replay preserved its operation ID, process
and files with no added operation; altered same-key action409. Reader403 and
foreign-signature401 had unchanged actual owner snapshots. Running control
PID1677831/startticks31713074 and manifest/fixture/config hashes+mtime were stable.
All four recorded original process identities absent at cleanup, no forced cleanup,
API/JWKS ports closed. Evidence retained privately at
/tmp/operator-source-lifecycle-0QVGUh/receipt.json; test log
/tmp/core1923-first-test.log. No credential appears in receipt or test output.

These are real host Node source-fixture effects through the actual Core API,
not immutable template creation or native/package/product qualification. Final
root review, develop PR landing and postmerge focused source proof remain required.

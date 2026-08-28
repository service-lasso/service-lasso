# Canonical demo watchdog

The canonical Service Lasso demo uses operator-supplied network parameters. The
repository does not choose an IP address or hostname:

| Surface | URL |
| --- | --- |
| Service Admin | `http://<client-visible-host>:17700/` |
| Runtime API health | `http://<client-visible-host>:17883/api/health` |

Use the repo-owned watchdog when the canonical demo must be kept online:

```powershell
$bindHost = "<bind-host>"
$demoHost = "<client-visible-host>"
npm run demo:watchdog -- --bind-host=$bindHost --host=$demoHost
```

Use the hardened deploy command when a developer or validator needs to prove a
specific checked-out ref is the canonical live demo:

```powershell
npm run demo:deploy-canonical -- --ref HEAD --host=$bindHost --url-host=$demoHost --expect /api/log-shipping:200 --expect-json /api/telemetry:apiRequests
```

`demo:deploy-canonical` is the required path before claiming latest code is
live. It starts from the explicit `--ref`, requires the worktree HEAD to match
that ref, requires a clean checkout, tears down managed canonical runtime and
Service Admin ownership, removes stale runtime/workspace/service state through
the recycle path, runs the canonical verifier, runs endpoint expectations, and
writes `.demo-logs/canonical-deploy-summary.json`. JSON endpoint expectations
match an exact response path or a nested path anywhere in the response body, so
`--expect-json /api/telemetry:apiRequests` fails unless the deployed telemetry
payload contains an `apiRequests` field. The summary records the
git ref/commit, port owners and PIDs before/after teardown, forced recovery
actions when used, live runtime instance metadata, service release tags, URL
statuses, endpoint expectation results, and log paths. The command exits
non-zero if the checkout changes, canonical verification fails, a feature
endpoint is stale/missing/partial, or any required port is owned by an
unmanaged process.

By default the deploy command refuses unmanaged listeners on the canonical
ports `17883` and `17700`. `--force-recovery` may be used only during explicit
operator recovery; it is logged in the summary and attempts to terminate the
blocking port owners before deploying.

## Issue Worktree Proof

Ordinary developer and validator proof from issue worktrees should not depend
on the shared canonical ports. Prepare a worktree-owned proof lane first:

```powershell
npm run demo:worktree-proof -- --id=<issue-or-branch>
```

The command allocates free runtime, Service Admin, and demo service ports,
patches the copied demo manifests under the worktree proof root, and writes
`.demo-logs/worktree-proof/<id>/worktree-proof-summary.json`. Handoffs must
record the `runtime` and `serviceAdmin` URLs plus the `gate`, `verify`, and
`cleanup` commands from that summary. Validators should run those recorded
commands against the allocated URLs instead of assuming `17883` and `17700`.

At final handoff or safe blocker exit, run the recorded cleanup command. If
cleanup is intentionally skipped, record the reason and the summary path so the
owning worktree processes can be identified later.

The watchdog checks both operator-selected URLs before it attempts recovery. If either URL is
unreachable, it acquires `.demo-logs/demo-watchdog.lock.json` before launching
recovery so repeated scheduler runs cannot overlap. Manual recycle also acquires
the scheduled-task compatibility lock `.demo-logs/watchdog.lock`, which keeps the
Windows scheduled watchdog from starting a second recovery while validation is
already recycling the canonical demo. Recovery runs:

```powershell
npm run demo:recycle -- --port=17883 --host=$bindHost --runtime-url=http://${demoHost}:17883 --admin-url=http://${demoHost}:17700/
```

`demo:recycle` is a lower-level recovery primitive. It is useful when the
canonical demo should be refreshed without endpoint-specific assertions. It is
not enough for final "latest is deployed" proof because it does not require an
explicit git ref or feature endpoint expectations.

The command also sets `SERVICE_LASSO_PORT=17883` in the recovery process. This
keeps the runtime on the canonical port instead of falling back to the generic
development default.

Before claiming a demo deploy or recycle succeeded, run the canonical verifier
with the client-visible host or with both complete URLs:

```powershell
npm run demo:verify-canonical -- --host=$demoHost
```

The verifier checks the parameterized canonical ports, runtime health, Service Admin
reachability, runtime `servicesRoot` / `workspaceRoot`, the live release
metadata against the checked-in `services/` manifests, and each checkable
advertised service UI/API/health URL from those manifests. Provider-only
services are reported as URL reachability not applicable. Traefik web/websecure
entrypoints are excluded because they are routing entrypoints, not standalone
service pages. It reports separate failure codes for wrong runtime port, wrong
lane, missing service, unhealthy service, stale release pin, stale installed
artifact, wrong service port, unreachable LAN endpoints, and unreachable
advertised service URLs.

Logs are appended under `.demo-logs/`, including
`.demo-logs/demo-watchdog-recovery.log` for recovery output and the existing
`demo-recycle.*.log` files for detached demo runtime output.

Useful overrides:

| Setting | Purpose |
| --- | --- |
| `--bind-host=<host>` / `SERVICE_LASSO_DEMO_BIND_HOST` | Required listener bind host for watchdog recovery. |
| `--host=<host>` / `SERVICE_LASSO_DEMO_HOST` | Client-visible host used to derive both check URLs. Required unless both URLs are explicit. |
| `--runtime-port=<port>` / `SERVICE_LASSO_PORT` | Runtime port used for health and recovery. |
| `--runtime-url=<url>` / `SERVICE_LASSO_DEMO_RUNTIME_URL` | Explicit runtime base URL, propagated to recovery. |
| `--service-admin-url=<url>` / `SERVICE_LASSO_DEMO_ADMIN_URL` | Explicit Service Admin check URL. |
| `--runtime-health-url=<url>` | Explicit runtime health check URL. |
| `--lock-path=<path>` | Alternate repo-owned watchdog lock file for validation. |
| `--legacy-scheduler-lock-path=<path>` / `SERVICE_LASSO_DEMO_LEGACY_WATCHDOG_LOCK` | Alternate compatibility lock honored by the Windows scheduled task. |
| `--dry-run` | Check health and report that recovery would be needed without recycling. |

Every final demo handoff should include the branch, commit, the exact bind and
client-visible host or URL parameters, the parameterized `npm run demo:watchdog`
or `npm run demo:deploy-canonical -- --ref <ref> ...` result,
`.demo-logs/canonical-deploy-summary.json`, `npm run demo:verify-canonical`
output, endpoint expectation results for the changed feature surface, and live
network proof for both canonical URLs. Prefer `demo:deploy-canonical` for developer
and validator latest-demo claims; use `demo:watchdog` only for availability
recovery and `demo:recycle` only as the lower-level refresh primitive.

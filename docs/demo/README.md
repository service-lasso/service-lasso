---
title: Demo operations
---

# Demo operations

[Documentation home](../README.md) · [Quick start](../quick-start.md)

Use this guide after the [first run](../quick-start.md), when you need endpoint details, status checks, recovery, or an isolated development instance.

## Start and stop

Start the local demo (Node.js 22+, npm, Git, and internet access required):

```powershell
git clone --branch develop https://github.com/service-lasso/service-lasso.git
cd service-lasso
npm ci
npm run demo
```

Open Service Admin:

```text
http://127.0.0.1:17700/
```

The demo command builds the runtime, prepares the canonical demo service root, starts the demo API on port `17883`, and starts the baseline service set. Operators should not need to pass service roots, workspace roots, or ports for the normal local demo. `demo:start` and `demo:gate` default to that same canonical runtime port and bind it with a preferred port policy so recovery cannot silently take NGINX's reserved `18080` lane from a leftover reservation.

Complete [first-run setup](../quick-start.md#2-open-service-admin) before expecting regular services to run.

### Local demo URLs

| URL | Purpose |
| --- | --- |
| `http://127.0.0.1:17700/` | Service Admin UI |
| `http://127.0.0.1:17883/api/health` | Service Lasso API health |
| `http://127.0.0.1:17883/api/runtime` | runtime boundary, service root, workspace root, and version |
| `http://127.0.0.1:17883/api/services` | discovered services and lifecycle state |
| `http://127.0.0.1:4010/` | Echo Service UI/API |
| `http://127.0.0.1:4010/health` | Echo Service health endpoint |
| `http://127.0.0.1:18080/` | NGINX baseline web page |
| `http://127.0.0.1:18080/health` | NGINX health endpoint |
| `http://127.0.0.1:17890/health` | Secrets Broker health endpoint |
| `http://127.0.0.1:19081/ping` | Traefik health/ping endpoint |
| `http://127.0.0.1:19081/dashboard/` | Traefik dashboard |

Stop the canonical demo from this or another terminal:

```powershell
npm run demo:stop
```

`demo:stop` is a thin caller of `service-lasso stop`. It terminates the verified runtime and owned service process trees, then confirms the canonical runtime endpoint reservation is released. A reused PID is reported and never killed. `Ctrl+C` in the original start terminal uses the same stop path.

## Canonical Demo Lifecycle

The local canonical demo uses the checked-in services root and a dedicated workspace by default:

```text
services/
workspace/demo-instance/
```

Use these commands when operating or checking the demo:

| Command | Meaning |
| --- | --- |
| `npm run demo:start -- --port=17883` | Ensure the canonical demo is running and usable. Exits cleanly when the demo is already healthy. Starts one instance when no valid demo is running. |
| `npm run demo:stop -- --port=17883` | Stop the runtime API and every verified service process owned by the canonical workspace, then confirm those endpoint reservations are released. Safe to run from a second terminal. |
| `npm run demo:recycle -- --port=17883` | Acquire the canonical lane lock, then exactly stop → confirm stopped → start from the current built checkout → first-run autostart → verify. |
| `npm run demo:status -- --port=17883` | Print a non-mutating status report for process identity, allocation, health, lock paths, ownership evidence, workspace root, and demo logs. |
| `npm run demo:gate -- --port=17883` | Return one worker-safe gate result with endpoint health, listener state, lifecycle ownership, recovery lock path, recovery attempt evidence, and next safe action. |
| `npm run demo:verify-canonical -- --host=<client-visible-host> --port=17883` | Verify the canonical runtime health endpoint, Service Admin URL, Service Admin same-origin `/api/dashboard` and `/api/services` JSON responses, and advertised service URLs from resolved runtime endpoint state. Exits non-zero when either surface is not reachable, an Admin API path returns the HTML shell instead of runtime JSON, or the service state does not match the canonical contract. |
| `npm run demo:worktree-proof -- --id=issue-947` | Prepare an issue-worktree proof lane with free runtime, Service Admin, and demo service ports. Writes `worktree-proof-summary.json` with the allocated URLs plus exact `demo:gate`, `demo:verify-canonical`, and cleanup commands for developer and validator handoff. |
| `npm run demo:reset` | Clear the default demo workspace and managed demo service state. |
| `npm run demo:smoke` | Run an isolated end-to-end smoke test against the bounded demo fixture. |

Canonical demo network identity is supplied by the operator. The repository does
not choose an IP address or hostname. Given `--host=<client-visible-host>`, the
unattended checks are:

| URL | Purpose |
| --- | --- |
| `http://<client-visible-host>:17883/api/health` | Service Lasso runtime health |
| `http://<client-visible-host>:17700/` | Service Admin UI |
| `http://<client-visible-host>:17700/api/dashboard` | Service Admin same-origin runtime API probe |
| `http://<client-visible-host>:17700/api/services` | Service Admin same-origin service-state probe |

Start, stop, recycle, gate, status, and verification commands accept `--runtime-url=...`, `--admin-url=...`, `--workspace-root=...`, `--services-root=...`, `--timeout-ms=...`, `--demo-log-root=...`, and `--json` for automation. The canonical verifier also accepts `--host=...` to derive both canonical URLs; if `--host` is omitted, both URLs must be supplied explicitly. Demo wrappers are thin callers of the core `service-lasso start|stop|restart` contract. They do not keep a second PID or port ownership model. Recycle and start serialize on a host-wide lock keyed by the canonical runtime port, not by git worktree. Loopback recycle completes first-run vault bootstrap and confirmed `startAll` when setup mode is blocking autostart, then verifies; a blocked first-run stays a failed recycle. `demo:start` writes the latest canonical demo ownership/status record to `workspace/demo-instance/.service-lasso/demo-lifecycle.json` when it finds or starts a healthy demo. `demo:gate` also writes that lifecycle state. When runtime health is down and there is no wrong-owner, stale-lock, active-recovery, or listener-conflict blocker, the gate starts one detached Service Lasso runtime process, records the runtime log path under `.demo-logs/`, waits for the canonical endpoints, and returns `recovered` if they become healthy. It exits non-zero with a structured classification such as `runtime_port_owner_conflict`, `wrong_workspace_owner`, `stale_workspace_runtime_metadata`, `stale_recovery_lock`, `service_admin_down`, `service_admin_api_non_json`, `service_admin_api_down`, `service_admin_services_api_non_json`, `service_admin_services_api_down`, `canonical_service_state_mismatch`, or `service_startup_failure` when the worker should stop and hand off a blocker. `service_admin_api_non_json` means Service Admin was reachable but `/api/dashboard` returned non-JSON content, usually the HTML shell, so the visible UI is not actually connected to the runtime API. `canonical_service_state_mismatch` means the Admin API is reachable but the service list does not match the accepted canonical demo contract. Lifecycle state is reported under `workspace/demo-instance/.service-lasso/`; demo logs are reported under `.demo-logs/`. Unsafe states fail once with that classification instead of requiring agent-level investigation.

For ordinary issue worktree proof, prefer `npm run demo:worktree-proof -- --id=<issue-or-branch>` before touching the fixed canonical ports. The command copies the demo services into `workspace/demo-instance/worktree-proof/<id>/services`, allocates free ports, patches the copied manifests, and writes the allocated runtime/Admin URLs plus owner metadata under `.demo-logs/worktree-proof/<id>/worktree-proof-summary.json`. Developer issue comments and validator handoffs should quote the `gate`, `verify`, and `cleanup` commands from that summary so validation checks the exact worktree-owned instance. Use fixed `17883`/`17700` only for intentional shared canonical refreshes.

The current canonical demo accepts the source Service Admin dev server as the visible Admin surface on port `17700`. In that mode the runtime should discover eight manifests, run `@nginx`, `@traefik`, and `echo-service`, keep provider-only services `@java`, `@localcert`, and `@node` installed/configured but not daemonized, and leave `@serviceadmin` intentionally unmanaged because the source Admin server owns `17700`. `node-sample-service` is the provider-backed rotation/update fixture; `demo:verify-canonical` treats a runtime warning as expected only when the accepted service-state contract still leaves that sample unmanaged.

On npm/PowerShell combinations that do not pass script flags after the first separator, add a second separator before the script flags:

```powershell
$demoHost = "<client-visible-host>"
npm run demo:verify-canonical -- -- --host=$demoHost --json
```

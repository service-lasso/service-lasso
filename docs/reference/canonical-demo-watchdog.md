# Canonical demo watchdog

The canonical Service Lasso LAN demo is:

| Surface | URL |
| --- | --- |
| Service Admin | `http://192.168.1.53:17700/` |
| Runtime API health | `http://192.168.1.53:17883/api/health` |

Use the repo-owned watchdog when the canonical demo must be kept online:

```powershell
npm run demo:watchdog
```

The watchdog checks both LAN URLs before it attempts recovery. If either URL is
unreachable, it acquires `.demo-logs/demo-watchdog.lock.json` before launching
recovery so repeated scheduler runs cannot overlap. Recovery runs:

```powershell
npm run demo:recycle -- --port=17883
```

The command also sets `SERVICE_LASSO_PORT=17883` in the recovery process. This
keeps the runtime on the canonical port instead of falling back to the generic
development default.

Logs are appended under `.demo-logs/`, including
`.demo-logs/demo-watchdog-recovery.log` for recovery output and the existing
`demo-recycle.*.log` files for detached demo runtime output.

Useful overrides:

| Setting | Purpose |
| --- | --- |
| `--host=<host>` / `SERVICE_LASSO_DEMO_HOST` | LAN host for both default checks. |
| `--runtime-port=<port>` / `SERVICE_LASSO_PORT` | Runtime port used for health and recovery. |
| `--service-admin-url=<url>` | Explicit Service Admin check URL. |
| `--runtime-health-url=<url>` | Explicit runtime health check URL. |
| `--lock-path=<path>` | Alternate lock file for validation. |
| `--dry-run` | Check health and report that recovery would be needed without recycling. |

Every final demo handoff should include the branch, commit, `npm run demo:watchdog`
or `npm run demo:recycle -- --port=17883` result, and live LAN proof for both
canonical URLs.

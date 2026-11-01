---
title: "Advanced - Attach to a service terminal UI"
---

# Attach to a service terminal UI

A managed service normally writes logs. Some services also present a full-screen
terminal UI: a menu, a dashboard, an interactive installer. Service Lasso can
run that service on a pseudo terminal and expose an authenticated attach surface
so a terminal emulator can drive it.

This is opt-in and decided at start time. A service that is already running on
plain pipes cannot be attached to later; it must opt in and restart.

## Requirements

- A Core release that contains the `terminal` capability (`2026.10.27-fbd90b4`
  or newer).
- The bundled `service-lasso-pty` helper. Packaged Core artifacts include it
  under `native/pty/<platform>/` and verify its digest before spawning.
  Source checkouts must point at a helper:

  ```powershell
  $env:SERVICE_LASSO_PTY_HELPER = '<path to service-lasso-pty>'
  ```

- A service that runs an interactive terminal program, such as the `echo-tui`
  sample in the service catalog.

## Declare the terminal

Add `terminal` to the service manifest and give the process its normal command:

```json
{
  "id": "echo-tui",
  "args": ["-tui"],
  "terminal": { "enabled": true, "rows": 30, "cols": 100 },
  "healthchecks": [{ "id": "process-health", "type": "process" }]
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | required | Run the service under the PTY host. |
| `rows`, `cols` | `24`, `80` | Initial window size (1-1000). |
| `readOnly` | `false` | Allow output only; reject input and resize. |
| `idleTimeoutMs` | `900000` (15m) | Drop buffered output after inactivity (1m-24h). |
| `maxSessionMs` | `28800000` (8h) | Expire the session until restart (1h-7d). |

Because the process owns a terminal, `stdout` and `stderr` merge into one
stream. Keep the service's own log files if you need separate streams.

## Attach

Start the service as usual, then use the runtime terminal API.

~~~bash
# 1. Is the session available?
curl -s "$SERVICE_LASSO_API/api/services/echo-tui/terminal"

# 2. Read output after a sequence number
curl -s "$SERVICE_LASSO_API/api/services/echo-tui/terminal/output?after=0"

# 3. Send input (base64) and declare the controlling operator
curl -s -X POST "$SERVICE_LASSO_API/api/services/echo-tui/terminal/input" \
  -H 'content-type: application/json' \
  -d '{"data":"ZQ==","actor":"alice"}'

# 4. Resize when the emulator window changes
curl -s -X POST "$SERVICE_LASSO_API/api/services/echo-tui/terminal/resize" \
  -H 'content-type: application/json' \
  -d '{"rows":40,"cols":120}'
~~~

`output` returns base64 chunks with the highest `sequence`, plus `truncated`
when the oldest buffer was dropped. Input is limited to 64 KiB per request.

In a terminal emulator, decode `data`, write it to the screen, and send
keystrokes, resize events and the initial size through the same endpoints. The
`service-lasso-tui` operator client and the Admin UI cover their own surfaces;
this article describes the runtime API they use.

## Security boundaries

- The terminal API is loopback-only, like the rest of the runtime API. It has no
  network listener and no shell.
- Sessions are memory-only. The helper keeps a 256 KiB ring and never writes a
  transcript.
- `readOnly` rejects input and resize with `403`.
- The first actor that writes input becomes the session controller; another
  actor is rejected with `409` until the service restarts.
- After `maxSessionMs`, input and resize return `409` and output is unavailable.
- Input is audited by byte length only; raw keystrokes and secret values are
  never recorded.
- Attach never elevates privileges: the service runs as the same user as Core.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `terminal.available=false` with `reason=max_session_exceeded` | Restart the service. |
| Input returns `403` with `read_only` | The manifest sets `terminal.readOnly`. |
| Input returns `409` with `controlled` | Another actor already controls the session. |
| Start fails with "No PTY helper is available" | Source checkout without `SERVICE_LASSO_PTY_HELPER`. |
| Start fails with "Bundled PTY helper checksum mismatch" | The artifact's `native/pty` bytes were modified. |

Use the `echo-tui` sample to try the flow end to end: start it, poll
`/terminal/output`, press `e` to record an event, resize, then press `q` to shut
it down cleanly.

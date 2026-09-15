---
title: Service Admin capture manifest and refresh guide
---

# Service Admin capture manifest and refresh guide

This is the canonical capture record. Admin bundles an exported copy for offline help.

The later [newcomer verification](../development/newcomer-verification.md) includes a visible Echo detail capture and a verified detail-page stop/start sequence. The failures below remain historical evidence; they do not describe that later successful browser visit.

| Intended capture | Route/state | Environment | Result |
| --- | --- | --- | --- |
| Dashboard overview | `/`, task-owned proxy | Core `3307d61787918d6d6dd195facfb808e2c2c0c9a9`; Admin `5823f1b`; 1440×1024; 2026-09-14 | Blocked: headless page was blank |
| Services overview | `/services`, task-owned proxy | same | Blocked: headless page was blank |
| Help Center overview | `/help-center`, task-owned proxy | same | Blocked: headless page was blank |

## 15 September 2026 refresh attempt

Core issue worktree `docs/1281-operator-captures` at
`8d0201de3e8ebaf699f720a135f2110159cda99a` prepared an owned proof environment
on Windows. The intended Service Admin source was
`f5d7ea5012564eb6e470e12268752fe9efa9fd1f`; the owned runtime selected its
catalogued `@serviceadmin` artifact `2026.8.31-f015b44` on
`http://127.0.0.1:18101/`. Runtime was `http://127.0.0.1:18100`.

The generated gate rejected the environment with
`canonical_service_state_mismatch`: `node-sample-service` was installed,
configured, running and healthy, while its source contract requires a
manifest-only sample. The subsequent broader canonical verifier passed its
release-pin and endpoint checks, so the two checks disagree about whether this
is an acceptable capture state. The capture instructions require stopping on
the non-zero generated gate; no browser screenshots were taken and no capture
entry is claimed complete. The issue needs an agreed source-Admin state
contract or a proof-environment repair before these three routes can be
captured.

The isolated runtime and its services were stopped with the generated cleanup
command. No credentials, secret values or raw logs were captured.

## Refresh captures

1. Create issue worktrees from `develop` in Core and Service Admin.
2. Run Core `npm ci`, then `npm run demo:worktree-proof -- --id=<issue>`.
3. Start Service Admin on the allocated port with
   `SERVICE_LASSO_RUNTIME_PROXY_TARGET` set to the allocated Core URL.
4. Run the generated `gate` and `verify` commands. Stop on a non-zero result
   and record its classification; do not modify product behavior for a capture.
5. Use a real browser at 1440×1024, default theme and non-sensitive example
   data. Capture overview, important dialogs and workflow transitions.
6. Preserve originals and record asset route, state, reproduction, viewport,
   date, exact Core/Admin identity and verification result.

The current blank artifacts remain in the Service Admin PR as failed-capture
receipts only. Replace them with verified visible browser captures before
claiming screenshot-complete documentation.

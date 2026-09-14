---
title: Service Admin capture manifest and refresh guide
---

# Service Admin capture manifest and refresh guide

This is the Core mirror of Service Admin’s capture record.

| Intended capture | Route/state | Environment | Result |
| --- | --- | --- | --- |
| Dashboard overview | `/`, task-owned proxy | Core `3307d61787918d6d6dd195facfb808e2c2c0c9a9`; Admin `5823f1b`; 1440×1024; 2026-09-14 | Blocked: headless page was blank |
| Services overview | `/services`, task-owned proxy | same | Blocked: headless page was blank |
| Help Center overview | `/help-center`, task-owned proxy | same | Blocked: headless page was blank |

The task-owned proof allocated Runtime `http://127.0.0.1:18100` and Service
Admin `http://127.0.0.1:18101/`. It reached a live runtime, but canonical
verification reported `canonical_service_state_mismatch`: `node-sample-service`
ran although the source-Admin proof contract expects it to remain manifest-only.
No credentials, secret values or raw logs were captured.

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

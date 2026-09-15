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

## 15 September 2026 refresh attempts

The initial Core issue worktree was based on
`8d0201de3e8ebaf699f720a135f2110159cda99a`; the intended Service Admin source
was `f5d7ea5012564eb6e470e12268752fe9efa9fd1f` (the source later merged as
Admin `e3cb1ca192cd3719b34eb8cded895197746a4bac`). Its first owned proof
environment selected the catalogued `@serviceadmin` artifact
`2026.8.31-f015b44`, which could not prove that the current source Admin was
being rendered. It also started `node-sample-service`, although that fixture's
source policy is manifest-only. The generated gate correctly stopped the
attempt with `canonical_service_state_mismatch`; no screenshots were accepted.

The bounded proof-generator repair on Core `2e49fdf` keeps the sample disabled
only in the copied proof inventory, disables the packaged Admin only when a
validated `--source-admin-root` is supplied, and records an external source
Vite command with its required proxy target. It also generates an explicit
`--runtime-port` for dynamic-worktree verification while leaving canonical
verifier defaults unchanged. The focused demo-instance suite passed 43 tests
before this final flag-only correction; the flag regression itself passed.

A fresh owned proof, `1281-operator-captures-fresh-20260916`, used Core
`4741393df121a596831f0d1ad5d4398ff748b017`, runtime
`http://127.0.0.1:18100`, and source Admin Vite at
`http://127.0.0.1:18102/`. Its first-run step completed, but the generated
recycle still ended non-zero as `canonical_verification_failed`: runtime and
Admin port checks plus the operator MCP connection, discovery, and
representative-read checks all failed. The source Vite and Core proof services
were then stopped through their verified owned processes and generated cleanup;
the retained proof tree and logs remain available for diagnosis. No browser
screenshots are claimed, and no blank artifacts are part of this documentation.

The follow-up diagnosis found that the recycle wrapper omitted the selected
runtime and Admin ports when calling the verifier, which made it revert to
canonical defaults even though the dynamic URLs were supplied. Core `6c0d05e`
forwards the explicitly parsed ports and has regression coverage for both
dynamic and canonical values. No fresh runtime was started after that repair,
so it does not establish a canonical-verifier pass or an all-route capture
result. No credentials, secret values, or raw logs were captured.

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

Replace this record with verified, readable browser captures only after the
generated runtime gate and verifier both succeed.

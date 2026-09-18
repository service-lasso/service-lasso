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

## 16 September 2026 post-PR #1290 capture attempt

Core PR #1290 merged as `5172e802dd85ad705004c460ed2190fff8fe7dae`; this
fresh owned attempt executed the exact validated PR source
`31ebe19ac8aff070c37fe2abc4e78b6e85c8c519` with Service Admin source
`e3cb1ca192cd3719b34eb8cded895197746a4bac`. Proof ID
`1281-operator-captures-post1290-20260916` allocated Runtime
`http://127.0.0.1:18100` and source Service Admin
`http://127.0.0.1:18101/`. The generated gate reported `healthy`, and the
generated canonical verifier passed, including runtime, source-Admin,
operator-MCP, and service-state checks.

At a 1440×1024 viewport, the real browser stayed on its loading skeleton for
more than 30 seconds at `/`, `/services`, and `/help-center`. Each same-origin
API was independently reachable through source Admin (`/api/dashboard` and
`/api/services` both returned HTTP 200), but no route rendered readable
operator content and no browser error was emitted. The initial files were
rejected as invalid skeleton screenshots and removed; this refresh publishes
no images. The result is therefore **Blocked** for all three overview
captures, owned by Core #1281. The next action is a focused source-Admin
browser-load diagnosis that explains why the UI remains pending despite its
healthy same-origin API proxy, followed by a new isolated proof and inspected
captures. The owned runtime and source Vite process were stopped; the proof
summary, cleanup receipt, and logs remain under
`.demo-logs/worktree-proof/1281-operator-captures-post1290-20260916/`.

## 18 September 2026 current-source proof

Admin repair PR #623 is merged. A fresh isolated proof used Core
`66e98e1d30458bef1bcc09fd399859413c66a2fa` and current Admin
`c48f8d89b9eb0bc11b94b123acf68d74f0e3ac5d` at a 1512×982 viewport. The
generated runtime gate was healthy. The read-only Playwright tour then passed
all 40 static authenticated destinations without invoking reveal, edit,
reset, lifecycle, or record-specific actions.

The Services, Archive Utility Provider overview, and Help Center frames were
visually inspected in ignored review storage. No token, credential, raw log,
filesystem path, or external-link column was visible in those frames. The
Dashboard frame was rejected because it displayed live allocation and
generation details. Therefore **no images are published by this record** and
the public dashboard-tour requirement remains blocked pending a real,
public-safe Dashboard state or an authorised redaction policy. This is UI
evidence only; it is not a GA, security-review, or broad acceptance claim.

## Refresh captures

Create issue worktrees from `develop` in Core and Service Admin. Run Core
`npm ci`, then `npm run demo:worktree-proof -- --id=<issue>`. Start source
Service Admin on its allocated port with
`SERVICE_LASSO_RUNTIME_PROXY_TARGET` set to the allocated Core runtime URL and
`VITE_SERVICE_LASSO_API_BASE_URL` set to the allocated source-Admin URL. The
latter keeps browser API requests same-origin so the Vite proxy can retain the
loopback client identity. Run the generated `gate` and `verify` commands, stop
on any non-zero result, and record its classification. Do not change product
behaviour just to make a capture pass.

## Reusable Playwright tour

Install the browser once in the clean Core worktree, then run the tour against
the intended live Service Admin root:

```powershell
npx playwright install chromium
npm run capture:service-admin-tour -- --url=http://127.0.0.1:17700/
```

The tour uses an isolated dark browser context at **1512×982** with device
scale factor 1. On a loopback target only, it selects the password-free
local-root role in that temporary context; it never reads or enters a token or
password. It checks that actual UI has rendered before capturing these read-only
routes:

| Asset name | Route | Required state |
| --- | --- | --- |
| `dashboard.png` | `/` | Dashboard and Runtime health visible |
| `services.png` | `/services` | Services table rendered; the Links column is hidden |
| `archive-overview.png` | `/services/%40archive` | Archive Utility Provider Overview visible |
| `help-center.png` | `/help-center` | Help Center and local-docs notice visible |

Before it captures, the command visits all 40 current **static read-only**
authenticated destinations, including the Services, Operations, Secrets Broker,
Settings, and workspace routes. Redirect destinations are checked at their
resolved route. Dynamic record URLs and actions that need a specific record,
reveal a value, or mutate state are not invented or invoked by the suite.

The command saves a timestamped review set below `.tmp/service-admin-tour/`
and writes a metadata-only `capture-receipt.json` listing the requested and
resolved audit routes plus stable codes for any routes that could not render.
It completes the selected audit inventory before failing, and it creates no
screenshots if even one audited destination fails. Pass `--output-dir` when a
different ignored review directory is needed. It refuses to write directly to
`docs/static`, so an inspected image cannot accidentally become public content.
It also fails before any screenshot if it sees first-run credentials,
authentication-required, unavailable, or skeleton states. It does not sign in,
reveal data, modify lifecycle state, or invoke any operator action.

If an execution environment has a short command timeout, use four bounded audit
passes, then one capture-only pass. Together these cover the same inventory:

```powershell
1..4 | ForEach-Object {
  $start = ($_ - 1) * 10
  npm run capture:service-admin-tour -- --url=http://127.0.0.1:17700/ --audit-only --audit-start=$start --audit-limit=10
}
npm run capture:service-admin-tour -- --url=http://127.0.0.1:17700/ --skip-audit
```

The matching `--capture-start` and `--capture-limit` options can bound a
capture to one reviewed route where a command runner has a short timeout. They
never widen the capture scope beyond the four listed in this manifest.

After visual review, copy only the accepted images to the docs asset directory
in an issue branch, update this manifest with the exact Core/Admin identities
and verification results, and deliver them through the normal docs PR. A
successful capture run is UI evidence for its four routes only; it is not a GA,
security-review, or broad runtime-acceptance claim.

Replace this record with verified, readable browser captures only after the
generated runtime gate and verifier both succeed.

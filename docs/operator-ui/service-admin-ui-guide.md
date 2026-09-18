---
title: Service Admin UI guide
---

# Service Admin UI guide

Service Admin is the browser console for a local Service Lasso runtime. Open its
configured URL, then use the sidebar to move between operator surfaces. A page
may be **runtime-backed**, **metadata-only**, **preview**, or **unavailable**;
do not treat a visual status as durable unless the page states that it is
runtime-backed.

## First launch and navigation

1. Open the Service Admin URL reported by the Core demo/proof summary.
2. Start with **Dashboard**. If it cannot load, open **Runtime**; an unavailable
   banner means the UI has no usable runtime data.
3. Use the sidebar: **Services**, **Dependencies**, **Routes**, **Logs**,
   **Runtime**, **Installed**, **Variables**, **Network**, **Operations**,
   **Secrets Broker**, **Settings**, and **Help Center**.
4. Use page-toolbar and contextual Help links where present. A disabled control
   states its missing prerequisite or permission.

## Core operational workflow

1. In **Dashboard**, read runtime health, warnings, service totals, and Broker
   posture.
2. In **Services**, use search, filtering and sorting, then open the exact
   service row.
3. On the detail page, review status, dependencies, endpoints, health, setup
   and recent lifecycle evidence before choosing **Start**, **Stop**,
   **Restart**, install/configuration or update actions that are exposed.
4. Confirm risky actions in their dialog. Cancellation leaves state unchanged;
   validation identifies missing inputs or authority.
5. Refresh the detail page and Dashboard, then inspect **Logs** or **Runtime**
   to confirm resulting state. A toast alone is not confirmation.

## Page and control reference

| Page / route | Purpose and key controls | State handling |
| --- | --- | --- |
| Dashboard `/` | health summary, alerts, recovery links | loading/unavailable banner; verify by Runtime refresh |
| Services `/services`, `/services/:id` | search, filters, sorting, details and lifecycle actions | empty results, disabled actions, confirmation/cancel, error/recovery |
| Dependencies `/dependencies` | dependency and SecretRef relationships | metadata may be incomplete; use service detail for action evidence |
| Service Routes `/service-routes`, Network `/network` | configured endpoint/host/port metadata and open links | configuration is not reachability proof |
| Logs `/logs` | source selection and bounded log reading | empty/loading/read errors; never paste sensitive logs |
| Runtime `/runtime`, Installed `/installed` | runtime identity, readiness and installed metadata | separates UI from Core failures |
| Variables `/variables` | global/service variable and SecretRef posture | raw secret values are not displayed |
| Operations `/inbox`, `/operations/telemetry`, `/operations/audit-logging` | notices, telemetry and audit metadata | refresh after read/hide/restore mutations |
| Secrets Broker `/secrets-broker/*` | setup, inventory, providers, topology, policy and diagnostics | permission, confirmation, lockout and recovery are explicit |
| MCP `/mcp`, Security `/security` | safe MCP/security posture | configuration and mutations are runtime-authorized |
| Settings `/settings/*` | appearance, display, account and notification preferences | some data is local/metadata-only |
| Apps, Chats, Tasks, Users | available workspace surfaces | empty/unavailable states do not imply backend actions |
| Help Center `/help-center` | local operator guides and search | no-match state says **No docs matched the current search** |
| Sign-in, sign-up, OTP, forgot password and `/401`–`/503` | auth and error paths | availability depends on configured identity provider |

## Secrets Broker safety

Inventory, providers, topology, diagnostics, configuration, audit events,
backup keys and operational controls are distinct routes. Reveal, mutation,
decommission, rotation, policy and provider workflows require a trusted runtime
actor and can require a one-time confirmation. Record only safe identifiers,
outcomes and timestamps; never copy a value, recovery material, credential,
token, private key or raw request/log payload.

## Refreshing the documentation tour

Use the [capture manifest and refresh guide](capture-manifest.md) to run the
reviewed, read-only Playwright tour against a live Service Admin URL. It
creates an isolated 1512×982 review set and rejects setup, unavailable, and
skeleton screens before it writes an image. A normal run regenerates the
approved public assets in this guide's `docs/static/img/service-admin-tour/`
directory; the runner will not promote the Dashboard until its non-password
operational data has an approved redaction rule.

## Current UI tour

The normal runner invocation refreshes the public images shown here.

<img alt="Service Admin Services overview" src="/service-lasso/img/service-admin-tour/services.png" />

<img alt="Archive Utility Provider overview" src="/service-lasso/img/service-admin-tour/archive-overview.png" />

<img alt="Service Admin Help Center overview" src="/service-lasso/img/service-admin-tour/help-center.png" />

## Troubleshooting and glossary

- **Blank, loading or unavailable page:** open **Runtime**, refresh, and verify
  Core `/api/health` through the same-origin proxy.
- **Action disabled:** read the adjacent explanation; common causes are missing
  permission, unhealthy dependency, unsupported capability or confirmation.
- **Healthy but unreachable:** compare **Network** and **Service Routes**, then
  test the advertised interface separately.
- **No results:** clear search/filter controls before diagnosing a service.
- **Runtime-backed** means returned by Core; **metadata-only** is descriptive,
  not live proof; a **SecretRef** is a reference, not secret material; an
  **operation id** identifies a durable action outcome.

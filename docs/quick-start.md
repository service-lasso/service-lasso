---
title: Quick Start
---

# Start Service Lasso

Start the recommended managed stack, open the browser UI, and try managing a service. For background, see the [introduction](INTRODUCTION.md).

## 1. Start the stack

Install **Node.js 22.12+**, **npm**, and **Git**. You also need internet access to download the service releases; the first start takes longer than subsequent starts. Service artifacts have platform-specific support; for example, the pinned Python provider is Windows-only and is skipped on other hosts.

Run these commands in PowerShell or your usual terminal:

```sh
git clone --branch develop https://github.com/service-lasso/service-lasso.git
cd service-lasso
npm ci
npm start
```

The start command builds Core and invokes its owned baseline installer/startup with the checked-in `services/` manifests and persistent `workspace/`. The API uses loopback port 17883 with a fixed port policy; an occupied port fails rather than silently moving. Keep the terminal open. Core and the optional CLI use Node/npm and Git. Only the optional TUI needs Go 1.26+ for its first source build; `npm run operator:setup` builds both clients.

## 2. Open Service Admin

Open **[http://127.0.0.1:17700/](http://127.0.0.1:17700/)**.

A fresh workspace may show first-run setup. Complete the setup and save the credentials and recovery information it provides. Regular services wait until setup is complete. After saving the credential and completing setup, run `npm restart` from another terminal in the same checkout to resume the baseline. Inspect any service-specific prerequisites or failures in Admin. The [independent example review](development/documented-examples-verification.md) records a current Windows recycle/shutdown defect; recycle is not a qualified recovery step. For setup details, see [vault bootstrap](reference/vault-key-bootstrap.md).

## 3. Try a service

On the first-run credential screen, use both copy buttons, save both values privately, tick **I saved this token**, and continue. Sign in using the saved credential or the offered local session.

Once the services are running:

1. Open the [Echo demo](http://127.0.0.1:4010/) to see a managed service respond.
2. Find `echo-service` in Service Admin, open **Details**, and inspect its status and logs.
3. On that detail page, click **Stop service**, accept its confirmation dialog, wait for **Stopped**, then click **Start service** and reload the Echo page.

For the attached TUI, follow the [root README client setup](https://github.com/service-lasso/service-lasso/blob/develop/README.md#cli-and-tui-for-that-same-instance), open **Stack**, and select `echo-service` to see real HTTP health latency. Allow up to about 30 seconds for the first scheduled sample; the process check remains available alongside HTTP health.

Use the detail-page controls: the evaluated Admin release's table-row Stop button rejects the action because it does not present the required confirmation.

The baseline includes a browser admin, Echo Service, NGINX, Traefik, and supporting providers. See [baseline services](ecosystem/README.md#baseline-services) for their roles and platform notes.

## Automatic service startup

The managed `npm start` path prepares the baseline providers and starts all supported runnable baseline services after secure onboarding. Optional service manifests outside that baseline are not added to this startup set. The demo runtime has its own startup flow. The saved Admin automatic-start preference controls manifest automatic startup when requested; `npm start` explicitly starts the baseline instead.

To start only the runtime API for one launch, pass the explicit opt-out flag:

```sh
npm start -- --noautostart
```

In Service Admin releases that include the **Settings → Startup** page, **Automatically start enabled services** controls launches that request manifest automatic startup. The one-launch flag above does not change this saved preference.

## 4. Stop the stack

From another terminal in the same folder:

```sh
npm stop
```

You can also press `Ctrl+C` in the original start terminal. Start again with `npm start` (or use `npm restart` to stop and start the same owned workspace); stopping keeps the workspace data.

## Something didn't start?

If that fixed API port is occupied (including by another application), startup
reports `service=runtime-api phase=port_selection` and fails without stopping or
adopting the listener. Choose an unused port explicitly, for example
`npm start -- --port 18080` or `SERVICE_LASSO_PORT=18080 npm start` in a
Bash-compatible shell. Set the same port for `npm restart`, keep the same workspace
for every command, and connect Admin/CLI/TUI to the actual reported API URL.
Do not delete another instance's workspace or stop an unrelated process to clear
this conflict.

Baseline failures name the service, lifecycle action, observed startup phase and a
safe reason (for example `phase=health_check reason=required_readiness_failed`).
`github_release_metadata_rate_limited` means wait for the public API limit to
reset before retrying. An unclassified failure reports `<action>_failed` rather
than exposing exception text. Startup stops at the first failure and rolls back
its owned work; later services have not been proved running. Inspect that
service's private diagnostics in the same workspace before retrying.

Run `npm run status` for the source stack's read-only workspace report. The
[runtime health endpoint](http://127.0.0.1:17883/api/health) uses the selected API
port and helps distinguish Core startup from an Admin UI problem. Demo commands
use a separate workspace; see [baseline dependency diagnostics](reference/baseline-dependency-diagnostics.md)
for service readiness and blockers.

## Next steps

- Primary path: [Beginner — Todo app](getting-started/beginner-todo-app.md), then [Intermediate — make it durable with PostgreSQL](getting-started/intermediate-make-todo-app-durable.md), then [package it](package-your-app.md).
- [Give an agent the task](agent-prompts.md), including MCP diagnosis.
- [Embed the runtime with npm, CLI, or HTTP](runtime/README.md).
- [Choose a lean or bundled release archive](releases/README.md).
- [Explore all documentation](README.md).

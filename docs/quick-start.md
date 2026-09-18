---
title: Quick Start
---

# Try Service Lasso

Bring up the demo, open the browser UI, and try managing a service. For background, see the [introduction](INTRODUCTION.md).

## 1. Start the demo

Install **Node.js 22+**, **npm**, and **Git**. You also need internet access to download the service releases; the first start takes longer than subsequent starts. Service artifacts have platform-specific support; for example, the pinned Python provider is Windows-only and is skipped on other hosts.

Run these commands in PowerShell or your usual terminal:

```sh
git clone --branch develop https://github.com/service-lasso/service-lasso.git
cd service-lasso
npm ci
npm run demo
```

The demo command builds the runtime, uses the checked-in `services/` manifests, and keeps its runtime state in `workspace/demo-instance/`. Keep the terminal open while trying it.

## 2. Open Service Admin

Open **[http://127.0.0.1:17700/](http://127.0.0.1:17700/)**.

A fresh workspace may show first-run setup. Complete the setup and save the credentials and recovery information it provides. Regular services wait until setup is complete. If setup has finished but those services remain stopped, run this from a second terminal in the same folder:

```sh
npm run demo:recycle
```

This restarts the demo and completes its first-run autostart checks. For setup details, see [vault bootstrap](reference/vault-key-bootstrap.md).

## 3. Try a service

On the first-run credential screen, use both copy buttons, save both values privately, tick **I saved this token**, and continue. Sign in using the saved credential or the offered local session.

Once the services are running:

1. Open the [Echo demo](http://127.0.0.1:4010/) to see a managed service respond.
2. Find `echo-service` in Service Admin, open **Details**, and inspect its status and logs.
3. On that detail page, click **Stop service**, accept its confirmation dialog, wait for **Stopped**, then click **Start service** and reload the Echo page.

Use the detail-page controls: the evaluated Admin release's table-row Stop button rejects the action because it does not present the required confirmation.

The demo includes a browser admin, Echo Service, NGINX, Traefik, and supporting providers. See [baseline services](ecosystem/README.md#baseline-services) for their roles and platform notes.

## Automatic service startup

Normal runtime launches start enabled services automatically after the runtime API is ready. This is the default for both `npm start` and the demo runtime.

To keep that preference but start only the runtime API for one launch, pass the explicit opt-out flag:

```sh
npm start -- --noautostart
```

In Service Admin releases that include the **Settings → Startup** page, turn off **Automatically start enabled services** to leave services stopped when the runtime starts; turn it back on to restore the default. The one-launch flag does not change this saved preference.

## 4. Stop the demo

From another terminal in the same folder:

```sh
npm run demo:stop
```

You can also press `Ctrl+C` in the original start terminal. Start again with `npm run demo`; stopping keeps the workspace data.

## Something didn't start?

Run `npm run demo:status` for a read-only report. The [runtime health endpoint](http://127.0.0.1:17883/api/health) helps distinguish runtime startup from an Admin UI problem. Use the [demo operations guide](demo/README.md) for endpoint URLs, port conflicts, logs, recovery, and reset commands.

## Next steps

- Primary path: [Beginner — Todo app](getting-started/beginner-todo-app.md), then [Intermediate — make it durable with PostgreSQL](getting-started/intermediate-make-todo-app-durable.md), then [package it](package-your-app.md).
- [Give an agent the task](agent-prompts.md), including MCP diagnosis.
- [Embed the runtime with npm, CLI, or HTTP](runtime/README.md).
- [Choose a lean or bundled release archive](releases/README.md).
- [Explore all documentation](README.md).

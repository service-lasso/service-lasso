# Service Lasso

![Service Lasso brings your services together: manifests, runtime, browser controls, and secrets.](docs/static/img/service-lasso-overview.svg)

[![Docs build](https://github.com/service-lasso/service-lasso/actions/workflows/docs-site.yml/badge.svg?branch=develop)](https://github.com/service-lasso/service-lasso/actions/workflows/docs-site.yml?query=branch%3Adevelop) [![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-43853d?logo=nodedotjs&logoColor=white)](https://nodejs.org/) [![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**Run the services your app needs. Manage them in one place.**

Service Lasso installs, configures, starts, and monitors local services for you. Give it a service manifest; it handles downloads, dependencies, and startup order, with a browser UI to see what's running.

Use it to bring up a local app stack or ship supporting services with a Node, web, or desktop app. Manage native service processes through the UI, CLI, or HTTP API.

## Core, CLI, and TUI from one checkout

For an API-first local start, install **Node.js 22.12+**, **npm**, **Git**, and
**Go 1.26+** (`go` on your PATH). Internet access is needed for dependencies and
first-use client sources. Run these commands in a Bash-compatible terminal:

```sh
git clone --single-branch --branch develop https://github.com/service-lasso/service-lasso.git
cd service-lasso
npm ci
npm run operator:setup
npm run build

# Keep this generated local credential in this shell; do not print or commit it.
export SERVICE_LASSO_LOCAL_ADMIN_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
export SERVICE_LASSO_CLI_LOCAL_ADMIN_TOKEN="$SERVICE_LASSO_LOCAL_ADMIN_TOKEN"
export SERVICE_LASSO_API_TOKEN="$SERVICE_LASSO_LOCAL_ADMIN_TOKEN"
export SERVICE_LASSO_HOST=127.0.0.1

# Start the actual Core owner in the background so this shell can run both tools.
node --enable-source-maps dist/cli.js serve --noautostart --port 18080 &
core_pid=$!
```

Wait for Core to report its API at **http://127.0.0.1:18080**. Then, in the
**same terminal and folder**, run:

```sh
npm run cli -- --core-url http://127.0.0.1:18080 instance status
npm run tui -- --api http://127.0.0.1:18080
```

The TUI needs an attached terminal. Use Arrow keys, Tab, and Enter to navigate the Stack dashboard and
`q` to quit. API failures remain visible; an open dashboard alone does not prove
Core is connected. `--noautostart` starts Core without launching services. Core
owns service lifecycle; the CLI and TUI run only when requested.

After quitting the TUI, stop the exact Core process and clear this shell's token:

```sh
kill -TERM "$core_pid"
wait "$core_pid"
unset SERVICE_LASSO_LOCAL_ADMIN_TOKEN SERVICE_LASSO_CLI_LOCAL_ADMIN_TOKEN SERVICE_LASSO_API_TOKEN
```

For later foreground starts, `npm run serve -- --noautostart --port 18080`
uses the same Core server and supports Ctrl+C shutdown. The explicit API flags above select port 18080. The clients and existing demo
below otherwise default to port 17883; use the actual Core URL and its configured
credentials when connecting to another instance.

`operator:setup` builds the reviewed CLI and TUI source commits listed in
[scripts/source-operator-tools.mjs](scripts/source-operator-tools.mjs). `cli` and
`tui` also set up their own tool on first use. Builds live in the ignored
`.operator-tools/` folder; no sibling clones or global installs are needed.
Nothing downloads during `npm ci` beyond its ordinary dependencies. An interrupted
setup can be retried; if a setup lock remains after its process has stopped,
remove only its named `.operator-tools/cli.lock` or `.operator-tools/tui.lock`
directory before retrying. These are development source tools; packaged releases
retain their separate published-artifact requirements.

## Try it

You need **Node.js 22+**, **npm**, **Git**, and internet access to download service releases. The first start takes longer while those downloads complete.

```sh
git clone --branch develop https://github.com/service-lasso/service-lasso.git
cd service-lasso
npm ci
npm run demo
```

The normal runtime starts enabled services automatically. Use `npm start -- --noautostart` when you only want the runtime API for this launch; the Service Admin **Settings → Startup** preference controls the default for future launches.

Open **[Service Admin](http://127.0.0.1:17700/)**. If first-run setup appears, complete it and save the recovery information it provides. [First-run help →](docs/quick-start.md)

Once setup is complete and services are running, open the [Echo demo](http://127.0.0.1:4010/). Find `echo-service` in Service Admin to inspect its status and logs, then try stopping and starting it.

To stop the demo, run this from the same folder in another terminal:

```sh
npm run demo:stop
```

[How Service Lasso, Secrets Broker, and templates fit together →](docs/understand-service-lasso.md)

## Make it yours

**[Add PostgreSQL and connect an app →](docs/getting-started/intermediate-make-todo-app-durable.md)** · [Let your agent do it →](docs/agent-prompts.md)

- **Bring your services.** Describe how to install and run each one in a `service.json` manifest. [Write a service →](docs/service-authoring/overview.md)
- **Choose ready-made services.** Browse databases, runtimes, proxies, and other services you can add to your app. [Service catalog →](docs/service-catalog.md)
- **Embed the runtime.** Use the npm package or start from a Node, web, Electron, or Tauri reference app. [CLI, API, and npm →](docs/runtime/README.md) · [App templates →](docs/reference-apps.md)

[Demo commands, ports, and troubleshooting →](docs/demo/README.md)

## Go further

| When you need to… | Read |
| --- | --- |
| Run services, check health, logs, recovery, or backups | [Run and manage services](docs/operations/README.md) |
| Create a release-backed service | [Build a service](docs/service-authoring/overview.md) |
| Add Lasso to an application | [Use Service Lasso in your app](docs/integration/README.md) |
| Look up stable contracts | [Technical reference](docs/reference/README.md) |
| Set up access and secret boundaries | [Security and access](docs/security/README.md) |
| Build, test, or contribute | [Contribute and maintain](docs/contributing/README.md) |

Secrets support and validation status: [capability ledger](docs/reference/secrets-capability-ledger.md). Report vulnerabilities privately using [Security Advisories](SECURITY.md).

Apache-2.0 · [License](LICENSE)

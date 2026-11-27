# Service Lasso

![Service Lasso brings your services together: manifests, runtime, browser controls, and secrets.](docs/static/img/service-lasso-overview.svg)

[![Docs build](https://github.com/service-lasso/service-lasso/actions/workflows/docs-site.yml/badge.svg?branch=develop)](https://github.com/service-lasso/service-lasso/actions/workflows/docs-site.yml?query=branch%3Adevelop) [![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-43853d?logo=nodedotjs&logoColor=white)](https://nodejs.org/) [![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**Run the services your app needs. Manage them in one place.**

Service Lasso installs, configures, starts, and monitors local services for you. Give it a service manifest; it handles downloads, dependencies, and startup order, with a browser UI to see what's running.

Use it to bring up a local app stack or ship supporting services with a Node, web, or desktop app. Manage native service processes through the UI, CLI, or HTTP API.

## Start the recommended stack from a clone

Install **Node.js 22.12+**, **npm**, and **Git**. Internet access is needed for
service releases on the first start. Core itself does not require Go.

```sh
git clone --single-branch --branch develop https://github.com/service-lasso/service-lasso.git
cd service-lasso
npm ci
npm start
```

Keep this terminal open. This builds Core and uses its owned baseline startup to
install/configure the recommended services from `services/`, with persistent data
in `workspace/`. The API defaults to **http://127.0.0.1:17883** with a fixed port;
a conflicting listener is an error. Startup reports the actual API URL. First-use downloads can take several minutes. Unsupported provider
artifacts are explicitly skipped; this is the real managed stack, not a fixture.

Open **[Service Admin](http://127.0.0.1:17700/)** using the reported endpoint if it
was allocated differently. Complete first-run setup and privately save its
credentials and recovery information. Regular services wait for onboarding.
Successful setup resumes the selected prepared baseline services automatically
in the same runtime; no manual restart is needed. Saved autostart settings govern
subsequent ordinary Core starts; they do not widen this managed baseline selection.
`--noautostart` keeps this launch API-only. Use Admin to inspect
any service-specific prerequisites or failures. Once running, try the [Echo service](http://127.0.0.1:4010/).
[First-run help →](docs/quick-start.md)

From another terminal in the same checkout:

```sh
npm run status
npm stop
npm start
# Or restart the same workspace in one foreground command:
npm restart
```

Ctrl+C in the start terminal also shuts down the owned runtime. Stop/restart use
Core's workspace ownership checks and retain data. Use the same
`SERVICE_LASSO_WORKSPACE_ROOT` (and `SERVICE_LASSO_SERVICES_ROOT` if customized)
for every command. `SERVICE_LASSO_PORT` changes the API port; point clients at that
actual URL. Explicit root flags, for example `npm start -- --port 18080`, also work.
The separate [demo commands](docs/demo/README.md) use their own demo workspace.

If that fixed API port is occupied (including by another application), startup
reports `service=runtime-api phase=port_selection` and fails without stopping or
adopting the listener. Choose an unused port explicitly, for example
`npm start -- --port 18080` or `SERVICE_LASSO_PORT=18080 npm start` in a
Bash-compatible shell. Set the same port for `npm restart` and keep the same workspace
for every command. The source CLI and TUI find its running Core.
Do not delete another instance's workspace or stop an unrelated process to clear
this conflict.

Baseline failures name the service, lifecycle action, observed startup phase and a
safe reason (for example `phase=health_check reason=required_readiness_failed`).
`github_release_metadata_rate_limited` means wait for the public API limit to
reset before retrying. An unclassified failure reports `<action>_failed` rather
than exposing exception text. Startup stops at the first failure and rolls back
its owned work; later services have not been proved running. Inspect that
service's private diagnostics in the same workspace before retrying.

## CLI and TUI for that same instance

Core prepares the pinned `@tui` release during baseline startup. It launches
the binary in your terminal on demand. The checkout TUI needs Node/npm to run
Core and needs no local Go installation.

Run the TUI from the same checkout and workspace environment as Core:

```sh
node dist/cli.js tui
```

`npm run tui` is an alias for this command. The launcher finds the Core instance
for the selected workspace, including on a custom port. On Linux with an
onboarded Core running under the same user, it opens Stack automatically.
For remote sign-in, use `node dist/cli.js tui --connect`, confirm the HTTPS target,
then enter the OAuth bearer credential in the masked field. Existing named
profiles, explicit URLs and environment credentials are also supported.

The standalone CLI still uses its pinned source while its native release is
pending. For authenticated CLI reads in a Bash-compatible shell:

```sh
read -r -s -p "Local admin token: " SERVICE_LASSO_CLI_LOCAL_ADMIN_TOKEN; printf '\n'
export SERVICE_LASSO_CLI_LOCAL_ADMIN_TOKEN
npm run cli -- operator services
unset SERVICE_LASSO_CLI_LOCAL_ADMIN_TOKEN
```

CLI runtime commands also find the checkout's running Core. Use `--core-url` or
`--connection` to select a different instance. When you set custom services or
workspace roots, export them in both the startup and operator terminals.
Use Arrow keys, Tab and Enter to navigate the attached TUI, then `q` to quit.

### Release-backed client providers

`service-lasso tui` is available when Core's package command is on `PATH`.
The launcher checks that the installed binary matches the checked-in release
tag, platform and archive checksum. Core also supports `service-lasso cli`
when the workspace catalog contains a prepared `@cli` release. Follow release
adoption in [Core #1992](https://github.com/service-lasso/service-lasso/issues/1992).

## API-only development alternate

```sh
npm start -- --noautostart
# Or invoke the explicit serve entrypoint with your own port:
npm run serve -- --noautostart --port 18080
```

The opt-out skips service startup for this launch and preserves the saved
startup preference. `npm run dev` retains the development server flow.

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

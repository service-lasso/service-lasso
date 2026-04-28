# Service Lasso

Service Lasso is a Node-based runtime for discovering, installing, configuring, starting, stopping, monitoring, and updating local services from `services/*/service.json` manifests.

This repo is the core runtime and contract repo. It is not the Service Admin UI repo and it is not a reference app template.

## Requirements

- Node.js `>=22`
- npm
- Network access to GitHub releases when a service manifest points at release-backed artifacts

## Quick Start

Clone the repo, install dependencies, build the runtime, then start the verified baseline service set:

```powershell
git clone https://github.com/service-lasso/service-lasso.git
cd service-lasso
npm ci
npm run build
node dist/cli.js start --services-root ./services --workspace-root ./workspace --port 18080 --json
```

The command starts the Service Lasso API at:

```text
http://127.0.0.1:18080
```

Useful local URLs after startup:

| URL | Purpose |
| --- | --- |
| `http://127.0.0.1:18080/api/health` | Service Lasso API health |
| `http://127.0.0.1:18080/api/services` | discovered services and lifecycle state |
| `http://127.0.0.1:17700/` | Service Admin UI |
| `http://127.0.0.1:4010/` | Echo Service UI/API |
| `http://127.0.0.1:19081/dashboard/` | Traefik dashboard |

Stop managed services before closing the runtime:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:18080/api/runtime/actions/stopAll
```

Then stop the Service Lasso process with `Ctrl+C`.

## Baseline Services

The checked-in baseline proves that a clean clone can acquire and run real service artifacts.

| Service | Role | Source |
| --- | --- | --- |
| `@node` | release-backed Node runtime provider | acquired from `service-lasso/lasso-node@2026.4.27-eca215a`; installed/configured but not launched as a daemon |
| `@localcert` | release-backed core local certificate utility for Traefik | acquired from `service-lasso/lasso-localcert@2026.4.27-591ed28`; exports `CERT_FILE`, `CERT_KEY`, `CERT_PFX`, and `CAROOT_CERT`; no daemon launch |
| `@nginx` | release-backed NGINX Open Source service for Traefik routing dependencies | acquired from `service-lasso/lasso-nginx@2026.4.27-712c75f`; started as a managed daemon with HTTP `/health` |
| `@traefik` | local edge/router service depending on `@localcert` and `@nginx` | acquired from `service-lasso/lasso-traefik@2026.4.27-bbc7f15` |
| `echo-service` | test harness service with UI/API/log/state behavior | `service-lasso/lasso-echoservice` GitHub release |
| `@serviceadmin` | core browser UI for the Service Lasso runtime | `service-lasso/lasso-serviceadmin` GitHub release |

Additional manifests such as `@java`, `@python`, and `node-sample-service` exist for provider and fixture coverage. They are not part of the default baseline start command.

Optional service repos such as `service-lasso/lasso-zitadel` and `service-lasso/lasso-dagu` can be added by committing their released `service.json` into your app's `services/` folder. ZITADEL is intentionally not in this baseline because it requires app-owned PostgreSQL and `ZITADEL_MASTERKEY` configuration before start. Dagu is intentionally optional because workflow orchestration and workflow files are app-specific.

## Services Folder Contract

Service Lasso reads services from a services root. Each service lives in its own folder and is described by one manifest:

```text
services/
  echo-service/
    service.json
```

`service.json` is the source of truth for:

- service identity and dependency order
- runtime command or provider delegation
- ports, URLs, environment, and health checks
- install/config materialization
- release artifact download metadata
- update and recovery policy

Apps that use Service Lasso should commit their own `services/` folder with the exact service manifests they need. Service Lasso does not infer service inventory from sibling repos.

## CLI

Run the API only:

```powershell
node dist/cli.js serve --services-root ./services --workspace-root ./workspace --port 18080
```

Install a service artifact without starting it:

```powershell
node dist/cli.js install echo-service --services-root ./services --workspace-root ./workspace --json
```

Start the baseline services and leave the API running:

```powershell
node dist/cli.js start --services-root ./services --workspace-root ./workspace --port 18080 --json
```

Check or apply service updates:

```powershell
node dist/cli.js updates list --services-root ./services --workspace-root ./workspace
node dist/cli.js updates check echo-service --services-root ./services --workspace-root ./workspace --json
node dist/cli.js updates download echo-service --services-root ./services --workspace-root ./workspace
node dist/cli.js updates install echo-service --services-root ./services --workspace-root ./workspace --force
```

Inspect recovery history or run doctor checks:

```powershell
node dist/cli.js recovery status --services-root ./services --workspace-root ./workspace
node dist/cli.js recovery doctor echo-service --services-root ./services --workspace-root ./workspace --json
```

## API

The runtime exposes the same core operations through HTTP for app hosts and Service Admin.

Common endpoints:

```text
GET  /api/health
GET  /api/services
GET  /api/services/:id
POST /api/services/:id/install
POST /api/services/:id/config
POST /api/services/:id/start
POST /api/services/:id/stop
POST /api/runtime/actions/startAll
POST /api/runtime/actions/stopAll
GET  /api/updates
POST /api/updates/check
POST /api/services/:id/update/download
POST /api/services/:id/update/install
GET  /api/recovery
POST /api/services/:id/recovery/doctor
```

## Use From npm

The public package is:

```powershell
npm install @service-lasso/service-lasso
```

Programmatic use:

```ts
import { startApiServer } from "@service-lasso/service-lasso";

const api = await startApiServer({
  servicesRoot: "./services",
  workspaceRoot: "./workspace",
  port: 18080,
});

console.log(api.url);
```

CLI use from an installed package:

```powershell
npx service-lasso start --services-root ./services --workspace-root ./workspace --port 18080
```

The npm package provides the runtime and CLI. Your app still provides its own `services/` manifests and workspace location.

## Verification

Run the main regression suite:

```powershell
npm test
```

Run the clean-clone baseline start smoke:

```powershell
npm run verify:baseline-start
```

Run live release-backed service checks:

```powershell
npm run verify:traefik-release
npm run verify:echo-health
npm run verify:service-updates
npm run verify:recovery-hooks
```

## Releases

Protected pushes to `main` create:

- a GitHub release artifact named `service-lasso-<version>.tar.gz`
- a public npm package version for `@service-lasso/service-lasso`

Release versions use:

```text
yyyy.m.d-<shortsha>
```

Release details:

- [GitHub releases](https://github.com/service-lasso/service-lasso/releases)
- [npm package](https://www.npmjs.com/package/@service-lasso/service-lasso)

## Project Map

| Path | Purpose |
| --- | --- |
| `src/` | runtime, API server, CLI, lifecycle, health, update, and recovery implementation |
| `services/` | checked-in service manifests used by the core repo baseline and tests |
| `tests/` | Node test suite |
| `scripts/` | release, package, smoke, and live verification scripts |
| `docs/` | deeper design and operational docs |
| `.governance/` | specs, backlog, and delivery governance |

Start with these docs when you need more detail:

- [Docs site source](docs/README.md)
- [Clean clone scenario validation](docs/development/clean-clone-scenario-validation.md)
- [Create a new lasso service](docs/development/new-lasso-service-guide.md)
- [Core runtime layout](docs/development/core-runtime-layout.md)
- [Clean-clone baseline start evaluation](docs/development/clean-clone-baseline-start-evaluation.md)
- [Release artifact](docs/development/core-runtime-release-artifact.md)
- [Publishable package](docs/development/core-runtime-publishable-package.md)

Build the local documentation site:

```powershell
npm run docs:build
```

The `Docs Site` GitHub Actions workflow validates the Docusaurus build on docs-related pull requests and pushes to `develop`. Pushes to `main` also publish `docs/build` to GitHub Pages at `https://service-lasso.github.io/service-lasso/`.

## License

Apache-2.0

---
title: CLI, HTTP API, and npm
---

# CLI, HTTP API, and npm

[Documentation home](../README.md) · [Quick start](../quick-start.md)

Use Service Lasso from a terminal or embed it in your app. Build the source with `npm ci` and `npm run build` before using the `dist/cli.js` examples. Your app supplies its service manifests and workspace.

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
npx service-lasso start --services-root ./services --workspace-root ./workspace --port 18090
```

The npm package provides the runtime and CLI. Your app still provides its own `services/` manifests and workspace location.

## CLI

Run the API only:

```powershell
node dist/cli.js serve --services-root ./services --workspace-root ./workspace --port 18080
```

Install a service artifact without starting it:

```powershell
node dist/cli.js install echo-service --services-root ./services --workspace-root ./workspace --json
```

Import a released app-owned service manifest without enabling or starting it (replace `<release-tag>` with an existing release tag from the service repository):

```powershell
node dist/cli.js services import service-lasso/lasso-dagu --tag <release-tag> --services-root ./services --dry-run --json
node dist/cli.js services import service-lasso/lasso-dagu --tag <release-tag> --services-root ./services
```

The import command copies the release `service.json` asset into `services/<service-id>/service.json` and refuses to replace an existing manifest unless `--force` is provided.

Import a local Service Archive upload without enabling or starting it:

```powershell
node dist/cli.js services import --archive ./downloads/my-service.zip --services-root ./services --dry-run --json
node dist/cli.js services import --archive ./downloads/my-service.zip --services-root ./services --json
```

Archive imports stage and inspect the zip before touching `servicesRoot`, require exactly one valid `service.json`, reject unsafe archive paths, copy the archive content into `services/<service-id>/`, rescan discovery, and return a conflict state instead of overwriting an existing service.

Start the baseline services and leave the API running:

```powershell
node dist/cli.js start --services-root ./services --workspace-root ./workspace --port 18090 --json
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
GET  /api/runtime
GET  /api/runtime/capabilities
GET  /api/operator/inbox
GET  /api/operator/inbox/counts
POST /api/operator/inbox/record
POST /api/operator/inbox/:id/read
POST /api/operator/inbox/:id/hide
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

`POST /api/services/:id/start` and `POST /api/runtime/actions/startAll` use full start semantics: enabled services are installed, configured, non-manual setup steps are reconciled, and then startable services are started in dependency order. Provider-role services in the canonical baseline, including disabled-by-default providers such as `@archive` and supported `@python` artifacts, are still prepared, but they do not require a managed daemon process. Disabled non-provider services, unsupported host artifacts, already-running services, autostart filtering, and truly non-startable services remain explicit skip/blocker cases instead of being forced.

First-run setup is a launch prerequisite. When `GET /api/setup/status` reports
setup mode, the CLI/API runtime prepares only the setup dependency path
(`@node`, `@secretsbroker`, and `@serviceadmin`) and skips normal managed
service starts until the vault owner identity, Owner group, built-in groups, and
permission catalogue are seeded. Existing workspaces with a ready vault marker
continue the normal launch path.

# Core runtime publishable package

This document defines the current bounded publishable package flow for `service-lasso`.

It exists alongside the downloadable runtime artifact.

The important distinction is:
- the **release artifact** is a bounded downloadable runtime bundle
- the **publishable package** is the self-contained public npm payload that starter repos and other consumers can install

## Package identity

Current publish target:
- `@service-lasso/service-lasso`

Current registry target:
- `https://registry.npmjs.org`

Current package manager assumption:
- npm

Current package page:
- `https://www.npmjs.com/package/@service-lasso/service-lasso`

Consumer install example:

```bash
npm install @service-lasso/service-lasso
```

Public npm installs do not require a scoped `.npmrc` or GitHub Packages token.

Protected-branch publish uses the repository secret `NPM_TOKEN` and publishes with `npm publish --access public`.

Optional GitHub Packages `.npmrc` example for legacy/internal consumers:

```ini
@service-lasso:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

GitHub Packages' npm registry requires authentication to install packages, including public packages. Use a classic GitHub PAT with `read:packages` for local GitHub Packages installs if that legacy path is explicitly selected. Do not commit tokens into project files.

For GitHub Actions in sibling starter repos, the public npm path is:
- use `actions/setup-node` with `registry-url: https://registry.npmjs.org`
- run `npm ci` without package registry auth

For legacy GitHub Packages consumption, the authenticated path is:
- use `GITHUB_TOKEN`
- grant the consuming repository package read access on the package settings page
- keep the workflow permissions at `packages: read`

Legacy GitHub Packages consumers that needed this access were:
- `service-lasso-app-web`
- `service-lasso-app-node`
- `service-lasso-app-electron`
- `service-lasso-app-tauri`
- `service-lasso-app-packager-pkg`
- deferred packaging-target repos if they are ever created later: `service-lasso-app-packager-sea`, `service-lasso-app-packager-nexe`

Without that package setting, cross-repo workflow installs fail with:
- `403 Permission permission_denied: read_package`

## Why this exists

The sibling starter repos need a real package they can consume.

The earlier `packages/core` wrapper inside this repo was useful for establishing the package boundary, but by itself it was not publishable because it depended on `../../dist` paths that only exist inside this repo.

The bounded publish flow solves that by staging a self-contained payload that includes:
- built runtime output
- package entrypoints
- package metadata
- package dependency declarations for runtime archive acquisition/extraction
- package-level manifest metadata

## Current packaged files

Each staged publishable package currently contains:
- `LICENSE`
- `README.md`
- `dist/`
- `index.js`
- `index.d.ts`
- `cli.js`
- `package.json`
- `publish-artifact.json`

Current staged folder:
- `artifacts/npm/service-lasso-package-<version>/`

Current packed archive:
- `artifacts/npm/service-lasso-package-<version>/service-lasso-service-lasso-<version>.tgz`

Version rule:
- local staging/verification defaults to `package.json.version`
- protected-branch publish runs on `main` use `yyyy.m.d-<shortsha>`

## Entrypoints

Current package entrypoints are:
- library entrypoint: `index.js`
- CLI entrypoint: `cli.js`
- built runtime entrypoint: `dist/index.js`

Programmatic use:

```ts
import { createRuntime, startApiServer } from "@service-lasso/service-lasso";
```

CLI use:

```bash
service-lasso
```

Acquire/install a service without starting it:

```bash
service-lasso install echo-service --services-root ./services --workspace-root ./workspace
```

Machine-readable install output:

```bash
service-lasso install echo-service --services-root ./services --workspace-root ./workspace --json
```

## Local commands

Stage the publishable package:

```bash
npm run package:stage
```

Stage and verify the publishable package:

```bash
npm run package:verify
```

Verify a direct public npm install from a clean temporary consumer:

```bash
npm run verify:package-consumer
```

## Verification standard

The bounded verification step must prove:
- the staged package folder exists
- `npm pack` succeeds for the staged package
- the packed `.tgz` exists
- the staged package exports `createRuntime` and `startApiServer`
- the staged package ships the supported `service-lasso` CLI entrypoint
- a temporary consumer can install the packed `.tgz`
- the temporary consumer can boot the runtime against explicit `servicesRoot` and `workspaceRoot`
- a registry-backed consumer can install from `registry.npmjs.org` without package auth after the version is published
- the registry-installed CLI can run `service-lasso --version` and `service-lasso help`

## GitHub Actions behavior

The publish workflow should:
1. run `npm ci`
2. run `npm test`
3. run `npm run release:verify`
4. run `npm run package:verify`
5. upload the staged publishable package folder
6. on each protected-branch push to `main`, publish the staged package to public npm using the repository version pattern `yyyy.m.d-<shortsha>` rather than manual tag creation

For sibling starter repos consuming the package through GitHub Actions:
1. use the public npm registry
2. configure `actions/setup-node` with:
   - `registry-url: https://registry.npmjs.org`
3. run `npm ci` without GitHub Packages auth

Core automation now carries two direct registry-consumer proof paths:
1. `.github/workflows/verify-package-consumer.yml` can be dispatched manually against any branch that contains the verifier.
2. `.github/workflows/publish-package.yml` re-installs the published version from npmjs after `npm publish` and runs the same verifier automatically.

## Consumer assumption

Consumers such as the sibling starter repos are expected to:
- install `@service-lasso/service-lasso`
- provide their own `servicesRoot`
- provide their own `workspaceRoot`
- decide how to host or surface `lasso-@serviceadmin`
- decide how to supply `lasso-echoservice`

The package does not bundle:
- service trees
- workspace data
- starter repo code
- the admin UI
- the Echo Service payload

## Honest current label

This is a:

**bounded self-contained publishable package payload**

It now targets the public npm registry. The protected-branch publish proof remains blocked until the repository has a valid `NPM_TOKEN` secret and the next `main` publish workflow completes.

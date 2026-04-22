# Core runtime publishable package

This document defines the current bounded publishable package flow for `service-lasso`.

It exists alongside the downloadable runtime artifact.

The important distinction is:
- the **release artifact** is a bounded downloadable runtime bundle
- the **publishable package** is the self-contained npm/GitHub Packages payload that starter repos and other consumers can install

## Package identity

Current publish target:
- `@service-lasso/service-lasso`

Current registry target:
- `https://npm.pkg.github.com`

Current package manager assumption:
- npm

Current package page:
- `https://github.com/service-lasso/service-lasso/pkgs/npm/service-lasso`

Consumer auth example:

```bash
npm config set @service-lasso:registry https://npm.pkg.github.com
```

Authentication still needs a token with package-read access in the consuming environment.

For GitHub Actions in sibling starter repos, the official path is:
- use `GITHUB_TOKEN`
- grant the consuming repository package read access on the package settings page
- keep the workflow permissions at `packages: read`

Current repositories that need this access are:
- `service-lasso-app-web`
- `service-lasso-app-node`
- `service-lasso-app-electron`
- `service-lasso-app-tauri`
- packaging-target repos when they exist:
  - `service-lasso-app-packager-pkg`
  - `service-lasso-app-packager-sea`
  - `service-lasso-app-packager-nexe`

Without that package setting, cross-repo workflow installs fail with:
- `403 Permission permission_denied: read_package`

## Why this exists

The sibling starter repos need a real package they can consume.

The earlier `packages/core` wrapper inside this repo was useful for establishing the package boundary, but by itself it was not publishable because it depended on `../../dist` paths that only exist inside this repo.

The bounded publish flow solves that by staging a self-contained payload that includes:
- built runtime output
- package entrypoints
- package metadata
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

## Local commands

Stage the publishable package:

```bash
npm run package:stage
```

Stage and verify the publishable package:

```bash
npm run package:verify
```

## Verification standard

The bounded verification step must prove:
- the staged package folder exists
- `npm pack` succeeds for the staged package
- the packed `.tgz` exists
- the staged package exports `createRuntime` and `startApiServer`
- a temporary consumer can install the packed `.tgz`
- the temporary consumer can boot the runtime against explicit `servicesRoot` and `workspaceRoot`

## GitHub Actions behavior

The publish workflow should:
1. run `npm ci`
2. run `npm test`
3. run `npm run release:verify`
4. run `npm run package:verify`
5. upload the staged publishable package folder
6. on each protected-branch push to `main`, publish the staged package to GitHub Packages using the repository version pattern `yyyy.m.d-<shortsha>` rather than manual tag creation

For sibling starter repos consuming the package through GitHub Actions:
1. set workflow permissions to `packages: read`
2. configure `actions/setup-node` with:
   - `registry-url: https://npm.pkg.github.com`
   - `scope: "@service-lasso"`
3. pass `NODE_AUTH_TOKEN: ${{ github.token }}`
4. ensure the package settings page grants that repository GitHub Actions access

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

It does not yet claim a finished public npmjs.com rollout or polished consumer-host implementations across all starter repos.

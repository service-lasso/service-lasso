# Core runtime release artifact

This document defines the current bounded downloadable release artifact for `service-lasso`.

It is intentionally narrower than a full npm publish or installer rollout.

## Current artifact purpose

The current release artifact exists to provide:
- a downloadable built runtime
- the bounded private core wrapper package
- release metadata that says exactly what shipped
- a repeatable package + verification path that GitHub Actions can run

It does not yet claim:
- public npm publish readiness
- installer packaging
- bundled service trees
- bundled workspace data

## What ships

Each staged artifact contains:
- `LICENSE`
- `README.md`
- `package.json`
- `dist/`
- `packages/core/`
- `release-artifact.json`

The packaged archive is currently:
- `artifacts/service-lasso-<version>.tar.gz`

The staged folder is currently:
- `artifacts/service-lasso-<version>/`

## Why these files ship

- `dist/` contains the built runtime entrypoint and runtime/server modules
- `packages/core/` contains the bounded `@service-lasso/service-lasso` wrapper package and CLI bridge
- `package.json` records the current version and runtime engine requirement
- `README.md` and `LICENSE` give top-level runtime context and licensing
- `release-artifact.json` is the explicit shipped-file manifest

## What does not ship

The bounded artifact does not bundle:
- `src/`
- `tests/`
- `docs/`
- `services/`
- `workspace/`
- `ref/`
- `node_modules/`

Consumers are expected to provide their own:
- `servicesRoot`
- `workspaceRoot`

## Entrypoints inside the artifact

Current bounded entrypoints are:
- runtime entrypoint: `dist/index.js`
- core package entrypoint: `packages/core/index.js`
- CLI bridge: `packages/core/cli.js`

## Local commands

Build the staged artifact:

```bash
npm run release:artifact
```

Build and verify the staged artifact:

```bash
npm run release:verify
```

## Verification standard

The bounded verification step must prove:
- the staged folder exists
- the packaged `.tar.gz` exists
- the documented shipped files are present
- the staged `packages/core` wrapper can be imported
- the staged `dist/index.js` runtime can boot against explicit runtime roots

## GitHub Actions behavior

The repo workflow should:
1. run `npm ci`
2. run `npm test`
3. run `npm run release:verify`
4. upload:
   - `artifacts/service-lasso-<version>/`
   - `artifacts/service-lasso-<version>.tar.gz`
5. if the run is for a tag, attach the `.tar.gz` to the GitHub release

## Honest current label

This is a:

**bounded downloadable runtime artifact**

It is not yet the final public packaging story for Service Lasso.

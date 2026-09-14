---
title: Development and verification
---

# Development and verification

[Documentation home](../README.md) · [Quick start](../quick-start.md)

For contributors working on the runtime or documentation. Start issue branches from `develop` and submit changes through a pull request into `develop`.

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

- [Docs site source](../README.md)
- [Quick Start](../quick-start.md)
- [Service authoring overview](../service-authoring/overview.md)

Build the local documentation site:

```powershell
npm run docs:build
```

The `Docs Site` GitHub Actions workflow validates the Docusaurus build on docs-related pull requests and pushes to `develop`. Pushes to `main` also publish `docs/build` to GitHub Pages at `https://service-lasso.github.io/service-lasso/`.

## Verification

Run the main regression suite:

```powershell
npm test
```

Run the clean-clone baseline start smoke:

```powershell
npm run verify:baseline-start
```

Run the real app E2E state gate against the checked-in baseline manifests:

```powershell
npm run verify:real-app-e2e
```

This starts the built CLI/API runtime, verifies Service Admin/API state for the real baseline services, exercises a real lifecycle stop/start, and checks concrete service health endpoints including `@secretsbroker`. It also verifies every checkable advertised UI/API/health URL in the baseline manifests, including NGINX, Echo Service, Service Admin, Secrets Broker, Traefik admin, and the provider-backed Node sample service. The gate pins API and managed-service port negotiation to the local Service Lasso range `17880-17980` by setting `SERVICE_LASSO_PORT_RANGE_START`/`SERVICE_LASSO_PORT_RANGE_END`, so repeated or parallel local runs do not drift into random Windows firewall prompt ports.

Run the multi-instance port gate:

```powershell
npm run verify:multi-instance-ports
```

This starts two isolated Service Lasso instances at the same time inside `17880-17980` and fails if any API or managed-service port collides or escapes the range.

Run live release-backed service checks:

```powershell
npm run verify:traefik-release
npm run verify:echo-health
npm run verify:service-updates
npm run verify:recovery-hooks
```

## Security

Report vulnerabilities privately through GitHub Security Advisories. See [SECURITY.md](https://github.com/service-lasso/service-lasso/security/policy). Production dependencies must stay free of `npm audit --omit=dev` findings. Hosted workflows pin GitHub Actions to commit SHAs.

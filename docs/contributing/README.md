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

### Full suite on Linux

Use Node.js 22 or later and run `npm ci` in an isolated checkout. The full
suite also invokes real host tools: PowerShell (`pwsh`) for workflow/script
tests, `lsof` for listener ownership, and Python 3 through the `python` command
for the ConPTY cleanup-helper test. These are test prerequisites; Service Lasso
and Broker RAM secret delivery do not require them. Verify the commands before
starting the suite:

```sh
node --version
pwsh --version
lsof -v
python --version
```

The tools can live in a private test directory prepended to that process's
`PATH`. If only `python3` is installed, a private `python` symlink to that
executable supplies the expected command. Private extracted `lsof` packages may
also need their matching libraries in the test process's `LD_LIBRARY_PATH`.
Do not skip the tests to compensate for absent tools.

The foreign-owner rejection regression needs
`SERVICE_LASSO_UNOWNED_FIXTURE_ROOT`: an absolute physical directory owned by a
different UID, provisioned specifically for the test. Its writable parent must
belong to the test user so private diagnostics can be created beside it. A
root-owned disposable child under a private test-owned audit directory works.
This fixture is a test prerequisite, not a runtime privilege requirement.
`SERVICE_LASSO_TEST_BROKER_BIN` selects the actual native Broker executable for
the RAM WebDAV integration case; supply a build containing the file-grant API.

`npm test` builds and runs the configured suite with private workspace, instance,
and endpoint registries by default. To supply these paths explicitly, provide
all three distinct absolute inputs together:
`SERVICE_LASSO_WORKSPACE_ROOT`, `SERVICE_LASSO_INSTANCE_REGISTRY_PATH`, and
`SERVICE_LASSO_HOST_PORT_REGISTRY_PATH`. Keep the naturally closed JSON receipt
and its raw logs; passing focused checks does not turn an earlier failed full
run into a pass.

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

## Maintain the docs

The [documentation map](../documentation-map.md) is the inventory and routing record. Give each page one primary navigation home, cross-link related material instead of duplicating it, and accurately label guides, references, plans, and evidence. Preserve an existing document ID and URL unless a compatibility path is verified.

See [CI runner operations](../operations/self-hosted-wsl-runner.md) and [release verification](../release-asset-policy.md). Plans and historical release records are intentionally grouped under the collapsed **Plans and evidence** navigation section.

## Publishing this documentation

The Docs Site workflow validates documentation on pull requests and ordinary
`develop` pushes. A successful build alone does not publish the site.

For owner-authorized documentation publication, run **Docs Site** on `develop`
and select **publish** (or `gh workflow run docs-site.yml --ref develop -f publish=true`).
The default is validation only. Publishing runs the tooling audit, Secrets
capability ledger validation, and documentation build before deploying through
the `github-pages` environment. Its branch policy must admit `develop`.
Only the canonical development and release branches can publish manually;
release-branch pushes retain automatic publication. Documentation publication
does not promote or release the runtime.

Verify both the completed **Deploy docs** job and the live
[Service Lasso documentation](https://service-lasso.github.io/service-lasso/),
including a documentation page and its generated assets. Retain the run URL and
source commit in the governing issue (SPEC-002 AC-4AJ.5).

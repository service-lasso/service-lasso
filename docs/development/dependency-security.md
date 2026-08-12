# Dependency security boundaries

Service Lasso validates two dependency boundaries from the exact lockfile:

- `npm run audit:production` rejects every known production vulnerability.
- `npm run audit:tooling` rejects critical and high vulnerabilities in the full contributor, documentation, and build graph.

The Docusaurus 3.10.2 graph still contains moderate advisories through its development-only Webpack server (`webpack-dev-server` to `sockjs` to `uuid`). The production runtime and release package do not include this graph. Repository defaults do not expose the documentation development server in CI; hosted documentation uses a static build. Owner: core maintainers. Review date: 2026-09-12, or immediately when Docusaurus publishes a dependency update.

## Fail-closed image metadata boundary

Docusaurus depends on `image-size`, whose upstream 2.0.2 release has unpatched infinite-loop advisories in ICNS, JXL, and HEIF parsers. The current documentation tree has no image assets and does not require build-time dimension parsing. The lockfile therefore resolves `image-size` to the versioned `packages/image-size-safe` workspace replacement. It exposes the compatible module surface but rejects every parse request, so an untrusted image cannot enter a vulnerable parser or block the documentation build process.

Do not add documentation image assets while this replacement is active. Remove it only after upstream publishes a patched release, then restore image coverage and keep `npm run audit:tooling` green.

`serialize-javascript` is forced to patched version 7.1.0 for Docusaurus' copy and CSS minimizer plugins. The lockfile test prevents either security boundary from silently regressing.

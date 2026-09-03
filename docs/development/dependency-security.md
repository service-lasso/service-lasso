# Dependency security boundaries

Service Lasso validates two dependency boundaries from the exact lockfile:

- `npm run audit:production` rejects every known production vulnerability.
- `npm run audit:tooling` rejects critical and high vulnerabilities in the full contributor, documentation, and build graph.

The Docusaurus 3.10.2 development server resolves `sockjs` to patched `uuid` 11.1.1 through a narrow package override. The reviewed CommonJS `uuid.v4()` path used by `sockjs` remains compatible, and the lockfile test prevents the patched boundary from silently regressing. Both production-only and complete dependency audits must report zero known vulnerabilities.

## Fail-closed image metadata boundary

Docusaurus depends on `image-size`, whose upstream 2.0.2 release has unpatched infinite-loop advisories in ICNS, JXL, and HEIF parsers. The current documentation tree has no image assets and does not require build-time dimension parsing. The lockfile therefore resolves `image-size` to the versioned `packages/image-size-safe` workspace replacement. It exposes the compatible module surface but rejects every parse request, so an untrusted image cannot enter a vulnerable parser or block the documentation build process.

Do not add documentation image assets while this replacement is active. Remove it only after upstream publishes a patched release, then restore image coverage and keep `npm run audit:tooling` green.

`serialize-javascript` is forced to patched version 7.1.0 for Docusaurus' copy and CSS minimizer plugins. The lockfile test prevents any of these security boundaries from silently regressing.

Production `@modelcontextprotocol/sdk` still declares Express 4 and body-parser ranges that resolve `qs` to 6.15.3. Issue `#1219` forces `qs` to patched 6.16.0 so `npm audit --omit=dev` and the critical/high tooling gate stay fail-closed. Express and body-parser keep calling `qs.parse` without `comma: true`; the override does not change that call surface. Dependabot already landed `fast-uri` 3.1.7 in `#1220`. A source lockfile fix is not remediation of already-published Core npm `2026.9.1-1f4ec40`; republish belongs to `#1151`.

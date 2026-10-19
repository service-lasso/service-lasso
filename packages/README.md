# Packages

This directory contains the four private npm workspaces declared in the root
[package.json](../package.json). They provide a Core package boundary and local
security replacements for documentation and contributor tooling dependencies.

| Directory | Purpose |
| --- | --- |
| [`core/`](core/README.md) | Wraps the compiled Service Lasso runtime as `@service-lasso/service-lasso` and exposes the `service-lasso` CLI. The wrapper is included in runtime release artifacts. |
| [`image-size-safe/`](image-size-safe/package.json) | Replaces the docs tooling's `image-size` dependency with a compatible module surface that rejects all image parsing, preventing use of vulnerable parsers. |
| [`braces-safe/`](braces-safe/README.md) | A locally patched `braces` dependency for docs and contributor tooling. It bounds pattern size, nesting and AST traversal to guard against excessive processing. |
| [`http-cache-semantics-safe/`](http-cache-semantics-safe/README.md) | A locally patched HTTP cache-policy dependency for docs and contributor tooling. It requires revalidation for zero-age entries and avoids expensive header whitespace parsing. |

## Where the runtime source lives

The Core implementation lives in [`src/`](../src/) and builds into `dist/`.
`packages/core/` forwards to that built output, so the root runtime must be built
before using its runtime or CLI entry points. The source has not moved into
`packages/core/src/`.

## Security replacement maintenance

The three `*-safe` directories serve tooling dependencies rather than the Core
runtime implementation. npm resolves their original dependency names through
the workspace links recorded in [package-lock.json](../package-lock.json).
All four workspace packages are private.

The `braces` and `http-cache-semantics` copies retain upstream licenses and
original file hashes in their `UPSTREAM.json` files; their local patch versions
are not upstream releases. The `image-size` replacement deliberately disables
image parsing, so documentation image assets must not be added while it is active.

See [Dependency security boundaries](../docs/development/dependency-security.md)
for the patch details, checks and conditions for replacing these local copies
with upstream fixes.

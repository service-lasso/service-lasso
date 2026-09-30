# CLI Foundation

## Intent

Service Lasso's TypeScript CLI must be available to operators who do not have Node installed. This specification defines a bounded, self-contained native distribution without changing Core's existing Node archive or package-consumer contracts.

## Scope and boundaries

- Parent integration work is #1461; standalone binary delivery is #1546.
- The executable embeds the current compiled `dist/cli.js` dependency graph and a Node SEA runtime. It remains the same CLI contract, not a second runtime.
- Exact tooling is Node `22.23.2`, `esbuild` `0.28.2`, and `postject` `1.0.0-alpha.6`, each locked in `package-lock.json`.
- Supported native-build and execution rows are Windows x64, Linux x64, and macOS x64. Other CPU/OS combinations, Alpine, cross-built artifacts, release publication, and Core archive replacement are outside this slice.
- Binaries contain no network, shell, or dynamic-code loaders. Operator credentials continue to be read only from the existing process environment; no credential value is emitted into build provenance or test output.

## Acceptance criteria

- `AC-CLI-01`: Packaging builds one deterministic CommonJS bundle from the current compiled CLI and its static dependencies before SEA generation.
- `AC-CLI-02`: Each supported native row creates the SEA preparation blob and injects it into the matching Node `22.23.2` native executable. macOS output is ad-hoc signed only for CI execution; it is not a release-signing claim.
- `AC-CLI-03`: The generated `service-lasso` executable runs without `node` on `PATH`, preserving `--help`, `--version`, safe read-contract output, and nonzero safe invalid-input behavior.
- `AC-CLI-04`: The executable preserves the current CLI's stdout/stderr and environment credential boundaries. Tests use a sentinel and prove it is not echoed.
- `AC-CLI-05`: A provenance manifest binds each nonempty binary checksum to source SHA, target platform/architecture, Node, bundler, and injector versions. The manifest contains no paths, credentials, or environment values.
- `AC-CLI-06`: GitHub Actions executes the produced binary on native Windows, Linux, and macOS runners, uploads the binary plus metadata-only manifest, and never publishes, releases, deploys, or promotes it.
- `AC-CLI-07`: Documentation distinguishes local Windows proof from pending native Linux/macOS CI proof until terminal workflow results exist.

## Verification

Focused packaging tests must build a native executable and prove the command scenarios in `AC-CLI-03` and `AC-CLI-04`. The three workflow rows are direct native evidence; local nonmatching-platform builds or static workflow checks are surrogate evidence only.

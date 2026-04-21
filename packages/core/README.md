# `@service-lasso/service-lasso`

This is the bounded private workspace wrapper for the current Service Lasso runtime.

For now it intentionally bridges to the repo's current built output under `dist/` rather than claiming that the runtime source has already moved into `packages/core/src`.

Current purpose:
- make the intended core package boundary explicit
- expose the current built runtime through a private package target
- expose a matching CLI wrapper target
- let placeholder reference-app packages depend on the canonical core package name

This package is not the full package rollout yet.

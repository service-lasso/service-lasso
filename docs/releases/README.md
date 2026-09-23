---
title: Packages and releases
---

# Packages and releases

[Documentation home](../README.md) · [Quick start](../quick-start.md)

Choose a runtime distribution for your app or local installation.

## Releases

The project defines these release outputs:

- a lean GitHub release artifact named `service-lasso-<version>.tar.gz`
- a bundled GitHub release artifact named `service-lasso-bundled-<version>.tar.gz`
- a public npm package version for `@service-lasso/service-lasso`

The lean artifact contains the built runtime and npm production dependencies. Use it when your app or operator will provide its own `services/` folder and allow Service Lasso to download service archives during install/start.

The bundled artifact contains the built runtime, the checked-in baseline `services/` folder, and pre-acquired baseline service archives under each service `.state` folder. Use it when you want the baseline services to start without first-run service downloads after extracting the release archive.

Release versions use:

```text
yyyy.m.d-<7-character-lowercase-git-sha>
```

Release details:

- [GitHub releases](https://github.com/service-lasso/service-lasso/releases)
- [npm package](https://www.npmjs.com/package/@service-lasso/service-lasso)

Publication requires explicit release-owner authorisation. See [canonical release authority](../../.governance/rules/gov-09-release-authority.mdc) and [release traceability](../../.governance/project/RELEASE_TRACEABILITY.md). Availability of an archive is not a claim of release qualification; see the [release security review packet](../reference/release-1-security-review-packet.md) and [capability ledger](../reference/secrets-capability-ledger.md) for evidence and limitations.

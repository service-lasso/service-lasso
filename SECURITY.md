# Security Policy

This repository is the Service Lasso core runtime. Report vulnerabilities through GitHub private reporting so they are not discussed in public issues or pull requests.

## Supported versions

Only the currently published Core working-release line is supported for security fixes:

- the `develop` integration line used to produce the next working release
- the last published npm `@service-lasso/service-lasso` version and its matching Git tag

Older tags, local forks, and unpublished worktrees are out of support.

## Reporting a vulnerability

1. Use **GitHub Security Advisories** on [`service-lasso/service-lasso`](https://github.com/service-lasso/service-lasso/security/advisories/new).
2. Include the affected version or commit SHA, reproduction without exploit payloads, and impact.
3. Do not attach live tokens, vault material, or customer secrets.

We acknowledge private reports, confirm impact, and ship a fix on `develop` before any authorised promotion to `main`. Public disclosure waits until a fixed working release is available or we agree a date with the reporter.

## Supply chain

- GitHub Actions are SHA-pinned.
- `npm audit --omit=dev` must report zero production vulnerabilities.
- Publishing uses the protected `release` GitHub Environment, not pull-request workflows.
- Default Actions permissions are read-only. Pull requests from forks cannot write repository contents or secrets.

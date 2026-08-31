# Security Policy

This repository is the Service Lasso core runtime. Report vulnerabilities through GitHub private reporting so they are not discussed in public issues or pull requests.

## Supported versions

Service Lasso is preparing Release 1.0. Until GA, only the current `develop` candidate and the latest published Core working release receive security fixes. After GA, the latest Release 1.x line is supported unless a release notice explicitly extends support. Older development snapshots, local forks, and superseded releases are unsupported.

## Reporting a vulnerability

1. Use **GitHub Security Advisories** on [`service-lasso/service-lasso`](https://github.com/service-lasso/service-lasso/security/advisories/new).
2. Include the affected version or commit SHA, attack preconditions, impact, and a safe reproduction without exploit payloads.
3. Do not attach credentials, secret values, recovery material, private keys, customer data, local paths, or exploit data to ordinary logs or screenshots.

If private reporting is unavailable, contact the repository owner privately and provide only the minimum reproduction details. We acknowledge private reports, confirm severity and production reachability, coordinate a fix and advisory, and preserve an auditable disclosure timeline. Public disclosure waits until a fixed working release is available or we agree a date with the reporter.

## Remediation targets

- Critical production findings: triage within 24 hours; fix or fail-closed mitigation targeted within 72 hours.
- High production findings: triage within 2 business days; fix targeted within 7 days.
- Medium production findings: fix targeted within 30 days.
- Low production findings: fix targeted within 90 days.

Release 1.0 fails for any known unremediated production vulnerability of any severity. Build and development findings remain visible, and critical/high findings also block release. These targets do not claim immunity from unknown or future vulnerabilities.

## Supply-chain and release evidence

- GitHub Actions are SHA-pinned, default Actions permissions are read-only, and pull requests from forks cannot write repository contents or secrets.
- `npm audit --omit=dev` must report zero production vulnerabilities.
- Publishing uses the protected `release` GitHub Environment, not pull-request workflows.
- Release decisions bind the exact source commit, dependency graph, package and archive digests, SBOMs, provenance or attestations, three-platform scans, and published-artifact acceptance.

A green source build or published tag alone is not release evidence.

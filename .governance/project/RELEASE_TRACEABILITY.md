# Release decision traceability

Governing issue: [#1409](https://github.com/service-lasso/service-lasso/issues/1409). Canonical rule: [gov-09](../rules/gov-09-release-authority.mdc). Release 1 criteria: [SPEC-007 AC-7F/7G/7H](../specs/SPEC-007-secrets-capability-ledger.md).

| Requirement | Authoritative procedure or evidence | Decision boundary |
| --- | --- | --- |
| Exact release identity and version | [version implementation](../../scripts/release-version-lib.mjs), [release artifact workflow](../../.github/workflows/release-artifact.yml), [npm publication workflow](../../.github/workflows/publish-package.yml) | Tag, release name, npm version and artifact version are identical; full SHA matches the tag target and npm `gitHead`. |
| Required assets and checksums | [asset policy](../../docs/release-asset-policy.md), [asset check](../../scripts/check-release-assets.mjs), [release artifact workflow](../../.github/workflows/release-artifact.yml) | Immutable release assets, SHA-256 inventory and readback correspond to the candidate. |
| Terminal technical gates | [Release Qualification](../../.github/workflows/release-qualification.yml), [SPEC-007 AC-7F/7G/7H](../specs/SPEC-007-secrets-capability-ledger.md) | Agents report pass/fail on the exact SHA; no historical or surrogate substitution. |
| Published package and three OS proof | [Published Package Three-OS Qualification](../../.github/workflows/published-package-qualification.yml), [published package verifier](../../scripts/verify-published-package-qualification-artifacts.mjs) | Published npm and GitHub identities and Windows, Linux and macOS runs match the same immutable candidate. |
| Security packet and GA decision | [security review packet](../../docs/reference/release-1-security-review-packet.md), [GA decision record](../../docs/reference/release-1-ga-decision.md) | Owner alone accepts residual risk and declares GA; an independent review is mandatory only when explicitly named and mandated. |
| Promotion, publication and deployment | [branch workflow](GIT_WORKFLOW.md), [publication workflow](../../.github/workflows/publish-package.yml) | Separate explicit owner instruction; technical readiness or GA alone is not execution authority. |

For each proposed GA decision, record: release tag, full 40-character SHA,
package version, qualification run IDs/outcomes and artifact/checksum links;
each open investigation's classification (`blocking defect`, `accepted residual
risk`, `deferred follow-up`, `not applicable`); owner, date, risk acceptance
and explicit promotion/publication/deployment instructions if any. Historical
decision documents retain the candidate and policy under which they were written;
a later decision must not silently extend their evidence to new bytes.

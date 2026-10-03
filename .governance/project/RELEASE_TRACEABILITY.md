# Release decision traceability


## Current GA applicability (2026-10-04, #1613)

The owner's current GA delivery scope is Windows and Linux under [current GA platform scope](CURRENT_GA_PLATFORM_SCOPE.md). Older three-platform/macOS obligations below retain their historical/default meaning; macOS is Deferred / Not applicable for this GA, never PASS. All Windows/Linux product, native, operator, template, immutable-publication and same-byte evidence remains required. Existing executable three-platform gates are unchanged and require coherent separately reviewed propagation before two-platform readiness can be claimed. No current exact qualified candidate or deployment is established by this scope decision.

Governing issue: [#1409](https://github.com/service-lasso/service-lasso/issues/1409). Canonical rule: [gov-09](../rules/gov-09-release-authority.mdc). Release 1 criteria: [SPEC-007 AC-7F/7G/7H](../specs/SPEC-007-secrets-capability-ledger.md).

| Requirement | Authoritative procedure or evidence | Decision boundary |
| --- | --- | --- |
| Exact release identity and version | [version implementation](../../scripts/release-version-lib.mjs), [release artifact workflow](../../.github/workflows/release-artifact.yml), [npm publication workflow](../../.github/workflows/publish-package.yml) | Tag, release name, npm version and artifact version are identical; full SHA matches the tag target and npm `gitHead`. |
| Required assets and checksums | [asset policy](../../docs/release-asset-policy.md), [asset check](../../scripts/check-release-assets.mjs), [release artifact workflow](../../.github/workflows/release-artifact.yml) | Immutable release assets, SHA-256 inventory and readback correspond to the candidate. |
| Operator-tool release-metadata custody | [operator-tool staging](../../scripts/operator-tool-packaging-lib.mjs), [release staging entrypoints](../../scripts/release-artifact.mjs), [fixture coverage](../../tests/operator-tool-packaging.test.js) | A step-scoped token is consumed once before sequential normal/bundled staging, is absent from child environment state, is sent only as bearer auth to fixed GitHub metadata endpoints, and is absent from asset/redirect requests. This contract does not qualify a release. |
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

## Durable two-OS release contract (#1619)

[ADR-001](../decisions/ADR-001-two-os-release-evidence.md) and active [SPEC-008](../specs/SPEC-008-two-os-release-evidence.md) make the reviewed whole-chain migration concrete under SPEC-007 AC-7F/7G/7H. R1/R2 bind immutable policy and closed schema versions/keys; R3/R4 define custody and exact inventories; R5 binds workflow inputs/selectors/terminal gates; R6 requires real boundary denial/compatibility and direct proof; R7 retains unresolved blockers. The [canonical policy](ga-platform-scope.json) exact-byte SHA-256 is `159d644c161cf532c94d3bfe17ed55e32bf94c5d2843928945c450f6d8140c12`. Its actual commit/blob will be pinned from landed source, never guessed or caller-selected.

#1619 is documentation authored / awaiting independent entire review, not implemented qualification. Current develop source authority is d2df8e4bb9533da24acfece6beee4578b1d50357. Product author units must propagate Core candidate2/fullrelease1/npm1/technical qualification1/published qualification4/operator3, CLI protected2/portable2, TUI3 and template qualification-publication1 coherently. Empty protected tool/template catalogs remain empty until actual native proof, immutable publication/public same-byte readback and separate pins-only review. CLI30 Windows ZIP remains separately UNMET and blocking; actual inner TAR plumbing and Core outer ZIP do not discharge it. Existing EBUSY/runtime/native/input/private custody/credential/provider failures remain preserved. Darwin is Deferred / Not applicable, never PASS. No product execution or final GA follows this documentation.

| Tracked unit | Spec binding | State / completion evidence |
| --- | --- | --- |
| #1619 durable decision | SPEC-008 R1-R7 / SPEC-007 AC-7F/7G/7H | in_review after pushed PR; distinct entire source review pending |
| #1613 executable eligibility propagation | SPEC-008 R1-R6 | todo; Core/CLI/TUI/template source units, reader-first, reviewed exact current source and NEW input admission |
| #1562 native/operator/template delivery | SPEC-008 R6-R7 and original product requirements | blocked by retained current qualification defects; no blanket rerun authority |
| CLI #30 Windows ZIP | SPEC-008 R4 / original CLI protected-native spec | UNMET; independently reviewed ZIP producer/consumer contract and direct Windows evidence required |
| Actual protected publication/catalog pins | SPEC-008 R3/R7 / SPEC-007 AC-7G/7H | pending actual qualified immutable bytes/public readback and separate pins-only source review |
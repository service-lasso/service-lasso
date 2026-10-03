# Current GA platform scope — 4 October 2026

Governing issue: [#1613](https://github.com/service-lasso/service-lasso/issues/1613), under [SPEC-007 AC-7F/AC-7H](../specs/SPEC-007-secrets-capability-ledger.md) and [release authority](../rules/gov-09-release-authority.mdc).

The release owner instructed: “can do the GA without mac please, merge all PR's across all repos please”. This changes the technical platform scope of the current GA delivery to **Windows and Linux**. macOS is excluded from this GA qualification obligation. Record its unexecuted scenarios as `Deferred`, and its applicability to this GA as `Not applicable`; neither means `PASS` or `Verified`. Retain macOS implementation, support source, assets, contracts, failures and historical three-platform promises for future qualification. This decision does not retire macOS support or retroactively change any result.

This dated scope decision governs current GA applicability wherever older Core intent/spec/backlog/procedure text calls for Windows/Linux/macOS, three-OS evidence, or exactly three platform artifacts. Those historical/default three-platform requirements remain preserved; they must not be silently read as a third-platform prerequisite for this GA, nor may their existing executable gates be falsely reported as satisfied. The changed applicability extends to Core, CLI, TUI, service-template, Admin and Broker integration evidence for this GA. Unrelated product and release decisions are unchanged.

## Required evidence and unchanged boundaries

The documentation validator binds this current decision to these explicit fields. They describe applicability, not an executable qualification result.

| Decision field | Value |
| --- | --- |
| Authority | release owner |
| Decision date | 2026-10-04 |
| Governing issue | #1613 |
| Required qualification platforms | Windows, Linux |
| macOS applicability | Deferred / Not applicable to this GA; never PASS |

Windows and Linux must still prove every original Core, CLI, TUI, template, native and real operator requirement, including all five compiled TUI actions, keyboard, cancellation, error and runtime behavior; CLI workflows and template integration; production acquisition/import/cleanup/lifecycle ownership and deadlines; safe private evidence admission; and exactly matching checksum-bound published CLI/TUI/Core bytes. Windows ZIP and Linux TAR real-producer and consumer evidence remain required. Secure publication, immutable candidate identities, signatures/provenance/SBOMs, zero-known-vulnerability checks, asset inventory, protected provider controls, published npm identity and published-package native qualification remain required. No missing or failed Windows/Linux gate becomes a pass through this scope decision.

The current Windows/Linux failed and unresolved qualification results remain blocking defects. Preserve all retained natural failures and audit their exact-current identities separately. Private input/tool/native observer/foreign-owner fixture gaps remain blockers wherever needed for Windows/Linux. macOS-only protected helper/service access and BSD/macOS producer evidence are deferred for this GA; a shared dependency still needed by Linux or Windows cannot be waived as macOS-only.

The owner authorizes proceeding with GA delivery and governed PR merging. This instruction supplies no exact qualified candidate, final GA decision, release tag, npm version or evidence. Do not manufacture those identities. Existing owner authority and protected publication controls remain required; no automatic host deployment, changed provider settings, branch-protection bypass, skipped assertions, relaxed deadlines or altered gate algorithms is authorized by this documentation change.

## Propagation and executable readiness

This documentation PR establishes applicability, not executable two-platform acceptance. The documentation governance validator checks this explicit owner decision and retained requirements; it does not qualify a candidate. Existing three-platform qualification workflows and validators remain unchanged and must not be bypassed or called green when macOS is missing. Follow-up work under #1613 must bind the two-platform scope explicitly to the exact candidate and propagate it coherently through producers, aggregates, artifact inventory, retention/readback schemas, validators and their independently reviewed acceptance evidence. Removing one matrix entry alone is insufficient. Until that reviewed implementation and fresh complete-input admission are established, the two-platform GA path is **blocked**, not technically ready.

| Boundary | Current contract requiring reconciliation | Required follow-up |
| --- | --- | --- |
| Core | Release Qualification, Published Package Qualification and its artifact verifier retain Darwin rows, fixed three-platform inventory and terminal aggregation; packaged Admin/MCP/operator-tool gates also carry platform obligations. | Review the entire producer/consumer chain and candidate scope binding; retain every Windows/Linux assertion and original failed evidence. |
| CLI | Current develop contract retains Darwin native helper/grant prerequisites and multi-platform publication inventory; Windows ZIP and actual Core/operator proof remain open. | Record this GA scope in CLI governance; distinguish Darwin-only admission from shared publication/native requirements and keep Windows/Linux proof mandatory. |
| TUI | Current develop contract retains three-OS same-byte Core acceptance and native five-action/keyboard/error/cancel qualification. | Propagate scope through TUI candidate evidence and Core consumers while preserving every Windows/Linux scenario. |
| service-template | Current develop validation/publication carries Darwin archive and harness policy. | Align immutable template contract and exact release evidence applicability; do not replace owner-defined input grammar or template provenance. |
| Admin / Broker | Core integration still binds exact published Admin/Broker checksums and platform-specific acquisition/producer evidence. | Review owner contracts and publication inventories before implementation; no shared native or supply-chain requirement is implicitly waived. |

The GA decision record must name `Windows, Linux` as required platforms and `macOS: Deferred / Not applicable to this GA`, the owner/date/issue, all preserved failures and dispositions, and the exact release tag/full SHA/npm version with terminal run IDs and checksum/API readback evidence. Historical GA approvals apply only to their recorded candidate and policy. A merged documentation PR, green source build or historical release cannot qualify this new delivery.

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
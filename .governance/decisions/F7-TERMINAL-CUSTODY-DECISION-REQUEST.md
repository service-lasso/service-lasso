# F7 terminal custody: decision required for the Linux repair

Status: resolved by human approval and whole conductor selection in [ADR-004](ADR-004-f7-durable-prefix-terminal-custody.md), 2026-10-07. Linked work: #1724, #1687, #1640; draft PR1725 into develop. The following proposal remains historical decision context; ADR-004 and its complete canonical seven-document contract govern source preparation. No resource activation, native execution, merge or release follows.

## Concrete decision

Approve or reject the complete independently reviewed amendment06 Alternative A: the encrypted evidence package permanently authenticates the completed, explicitly bounded prefix. Results produced by final encryption, package persistence and its final verification are retained separately in pre-reserved original native slots held by an independent custodian. They are explicitly LIVE_ONLY, never reported as part of the durable package. If those later records are unavailable or lost, the attempt is incomplete and cleanup/reset remains refused. Host loss can destroy the live suffix; this design does not qualify full durable terminal custody.

The proposed change affects SPEC-010 F7 whole terminal acceptance, the canonical ONE source inventory, private manifest3/SDK5 dispatch, native resource/view rights and custodian retention lifetime. Public Node/W v1 stays unchanged. Secret transport T stays ciphertext-only; readable terminal views belong only to the admitted independent custodian. No new actor, account, key, grant or receiver is selected by this proposal.

The alternative is to retain the stronger existing requirement and supply an actual reviewed native provider that durably records an operation's effect and result together before returning. Current source has no such provider. Adding another ordinary observer or repeating encryption cannot satisfy that requirement.

## Why an implementation fix alone cannot close this boundary

An immutable record cannot contain the result of its own later final readback without changing the bytes being verified. Package encryption and persistence likewise produce results after the package's plaintext has closed. The unchanged once-only, self-inclusive terminal contract therefore has a causal conflict. Alternative A resolves it by changing acceptance, not by claiming the impossible chronology has been implemented.

The existing owner chat completed the requested #1640/#1687 refresh. Neither frozen draft has a live worker or assigned maintainer. No authentic ROOT creator/header/callsite is delivered; `f7_observer_begin(original_root_capsule, observer_reservations, out_owner)` remains a receiving proposal. Linux ADR-003 resolves Linux's same-populated-isolate reset architecture only; it does not select this F7 amendment or supply U1-U3.

## Reviewable evidence

- Whole corrected candidate: `D:/projects/service-lasso/_audit/f7-original-root-producer-reconciliation-oct05-06`, including all normative documents and preserved prior controls. ROOT.json SHA256 `4C1021F564AE0063261A8027F911CBCADE9BC150431744B94CD1D92E046FD228`.
- Different entire review: `D:/projects/service-lasso/_audit/f7-amendment06-entire-independent-contract-oct05-01/REPORT.md`, SHA256 `D895EBA8FCCB59B6D49027D76046DAE726A4F58F09A84D5B18689A3189010226`. Verdict CONDITIONAL_WHOLE_CONTRACT_SOURCE_GO, conditioned on explicit whole acceptance/resource/retention selection and canonical integration. Implementation and runtime remain unqualified.
- Fresh owner coordination: `D:/projects/service-lasso/_audit/linux1724-f7-fixture-dependency-refresh-oct07-01/REPORT.md`. PR1641 remains `96054614adbd1e6b8a738cdaeb5806e7f29ec49f`; PR1686 remains `580ea244a71846b49dc8e565252685ad971126fb`. Existing branches and private evidence remain untouched.

## Scope after a decision

Approval permits preparing the canonical amended specification and original creator/caller integration through governed sole-owner issue branches and different entire reviews. It is not approval of missing numeric budgets, an invented ROOT capsule, source grants, keys, receiver identity or native resource bindings. Actual resource admission and complete final implementation review remain separate gates before execution. Existing approved off-host receiver and credential-provider references are still missing; no replacement is provisioned here.

Rejection preserves current requirements and the retained evidence. Resume connected implementation only after an actual stronger provider or another reviewed compatible decision is delivered. Rollback leaves the ordinary removal guard closed and preserves originals, independent copies and private failure records. All eleven Linux failures remain unresolved until direct natural acceptance.

GOV-14-ARCH-005 requires blueprint review for changing persistence semantics or a trust boundary. The complete candidate has that review; explicit selection is still missing. This request is necessary because adopting reduced terminal durability silently would weaken the governing acceptance contract. The repair agent remains responsible for implementation and verification after the decision.

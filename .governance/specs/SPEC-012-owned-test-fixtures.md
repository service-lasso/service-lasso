# SPEC-012: Ordinary test-owned fixture teardown

Status: Active. Issue #1734. Owner scope decision: 2026-10-08, ordinary harness
temporary-file cleanup is outside the Service Lasso product contract. Review of
the ten saved failures confirms one unavailable teardown primitive, not ten
demonstrated service defects. This replaces the ordinary fixture-removal
acceptance dependency in #1724, without implementing or weakening the separate
SPEC-010/F7 native security-custody architecture or its default refusal.

**OTF-1:** An ordinary fixture creator allocates a fresh private `mkdtemp` root
under the real OS temp directory and records its original directory identity in
a module-private map. A creator-issued in-memory token binds that exact root;
paths, reconstructed objects and foreign tokens cannot select another root.
Only these creator-owned disposable fixtures can use ordinary teardown.

**OTF-2:** Keep all original product and orchestration assertions: actual process
ownership, stop/finalization, every retained member's absence, unrelated-process
survival, recovery classification, journals/ownership/residue, original Error
identity, verified private evidence copy, reset timing and unconditional env
restoration. No reset before successful original removal. Preserve negative,
partial-removal and post-removal reset/env/copy-tamper outcomes.

**OTF-3:** Before ordinary deletion verify creator/root identity, ownership,
private permissions, unredirected path and the existing sealed inventory/copy.
Release test-only held directory handles, then recheck the creator binding and
remove only that root. This is conventional teardown of a trusted same-user test
fixture, not hostile same-UID writer exclusion or native security authority.
Same-user hostile mutation during the filesystem operation is outside this
ordinary test model. The default `holdFixtureRoot.remove` still refuses without
strong writer exclusion, and all existing adversarial cases keep that boundary.

**OTF-4:** Preserve private diagnostic/evidence copies outside the deletion root
and the original retained failed runs. Bind summary removal policy to
`test-owned` or `writer-exclusion`, so ordinary cleanup is never labelled strong
native custody. Do not modify product runtime code for this harness correction.

**OTF-5:** Naturally rerun all seven hard-crash phases (including the original
allocation row), four positive teardown cases, recovered-compensation rows and
the existing adversaries on native Ubuntu. Run the configured full Linux suite
after scoped verification. Report exact counts and any fresh failures separately;
no skip, weakened assertions, fabricated success or release/deployment claim.

Acceptance review is separate from implementation verification: the review
selects the trusted disposable-fixture model explicitly, retains strong custody
as a separate contract, and requires unchanged observable assertions. Source and
native verification must subsequently prove the selected model actually works.

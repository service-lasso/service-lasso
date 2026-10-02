# Issue #1594 source delivery checkpoint

Mode: Development. Governing issue: #1594; parents #864 / #1386 and release #1577. Requirement: SPEC-006 AC-6G closed owned-temp cleanup observation. Branch: `fix/1594-closed-cleanup-diagnostics`, created only from freshly fetched develop `3a8d0c9c1510c7e5832dae1eca7bd38eacf02444`. Spec-first commit `028b563b771adce3b86436f6809743ff84b2d02e` was immediately pushed before implementation.

## Intent and implemented source

`scripts/owned-temp-cleanup.mjs` holds the existing eight-call removal policy and delay sequence. It reads only an own data descriptor for the terminal error code and projects a fixed allowlist or unknown. Only an adapter-minted failure can yield the closed operation/code/actual-invocation observation; raw errors are discarded rather than attached as cause or retained properties. `verify-mcp-packaged.mjs` keeps cleanup precedence, prior safe verification stage/code, earlier success/evidence output and exit 1 on terminal cleanup failure. Production removal uses unchanged recursive/force flags. Existing ownership, provenance, permission, deadlines and full CLI/TUI staging are untouched.

`tests/owned-temp-cleanup.test.js` exercises the actual production adapter with deterministic filesystem-error boundaries, exact counts/delays, hostile/getter/inherited/revoked/malformed inputs, terminal-code changes, privacy and transient recovery, plus real default filesystem removal. It also evaluates the verifier's actual finalization body across the primary-success/failure and cleanup-success/failure matrix. This source-body scenario is a controlled surrogate for complete installed-package acceptance, not a package qualification receipt. Existing `tests/packaged-verification-diagnostics.test.js` assertions are unchanged; its inert contexts receive the new observation dependency. MCP product test selection includes both diagnostic suites, and workflow path filters include the new source/test files.

## Verification and explicit limits

Manual source/diff review and `git diff --check` are the only local checks performed. Node/npm, compiler/helper/Core imports, installation, build, typecheck, syntax checks and test execution are UNEXECUTED. Git hooks were suppressed for authoring to preserve this boundary. Every intentional commit is immediately pushed. Fresh complete source/tool/native first-input custody and actual ROOT admission are required before any local product execution. The parent owns that gate and fresh cumulative independent review; no implementation-authored test substitutes for existing protected evidence.

The independent original diagnostic report was fully read and its SHA256 verified as `52C19778FCFFD7B1244F8093B307813903C9F32CF3AD69C0630BC545E4CAF636`. Original failed Windows jobs `110783481735` and `110783483340` on PR #1593 head `1ae8e7f2f97fa87e3f9df0d3d63f0724a18ae276` remain failed. Their raw-log hashes are `6B61BB917FA28B72446BC5DEB48D0E05E8E4F03B1B74B0D5EA250FF0AC4DBC8D` and `5E541A692FDB2B8431060786F359B63ED84954215169C788006720814B9E0AA1`, read/rehashed by the parent. Underlying filesystem cause remains UNOBSERVED; this repair does not attribute a lock/leak or change resource lifetime.

## Custody and next action

Explicit isolated source-authoring exception: the inherited dirty primary checkout and every existing issue branch/PR checkout remain under their existing owners and are untouched. The new clean isolated issue checkout is retained for the active PR and parent review/qualification path; it must not be deleted or repurposed before governed landing. No main access, provider controls, reruns, termination, retained-state cleanup, merge, publication, promotion or deployment occurred.

Next action: fresh independent cumulative source review of the frozen pushed PR, followed by parent-owned complete external custody and ROOT admission. Exact-head three-OS MCP, relevant native gates and complete CLI/TUI acceptance remain distinct pending technical gates. Issue #1594 stays open; this is implemented source awaiting review and execution, not verified full delivery or release readiness.

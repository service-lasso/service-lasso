# Staged service transfer acceptance matrix

This is the Development evidence map for issue #1463 / PR #1566. It maps
`SPEC-002 AC-4CH`, `AC-4CH.1`, and `AC-4CH.2` to executable evidence without
turning local fixtures into release, producer-policy, or GA claims.

| Requirement / scenario | Evidence | Result and proof strength |
| --- | --- | --- |
| Closed release-asset-only create request; no client size, digest, URL, asset ID, manifest, or workspace authority | `tests/staged-service-transfer.test.js`; `tests/staged-service-transfer-http.test.js` | Verified locally. The server-derived identity controls byte length and digest; query injection and malformed/misplaced transfer headers are denied. Direct runtime HTTP proof for the covered routes. |
| Trusted authenticated runtime actor and `service:configure` before body mutation | `src/server/index.ts` transfer route; HTTP contract test | Partially verified locally through the normal runtime request-policy path. The test uses a syntactically valid transport bearer plus the API runtime-auth fixture; it is not a released external identity-provider journey. |
| Actor-scoped status, metadata-only readback, exact replay, and no second child mutation | `tests/staged-service-transfer-http.test.js`; `tests/staged-service-transfer.test.js` | Verified locally. Readback omits the full archive digest and caller workspace; replay reports the same durable operation without another byte-object read. |
| Ordered chunks, range/length/hash binding, quota, expiry retention, digest terminality | `tests/staged-service-transfer.test.js` | Verified locally. Invalid ranges and altered chunks fail closed; capacity remains retained through expiry; digest mismatch becomes terminal before parser admission. |
| ZIP preflight, no extraction, no install/acquire/start/materialisation side effect | `tests/staged-service-transfer.test.js`; `src/runtime/release/release-archive-preflight.ts`; `src/runtime/operator/remote-service-registration.ts` | Verified locally for ZIP. The direct child writes only the manifest and immutable attachment bytes; it does not extract or activate the archive. |
| Exact Core-held byte object and complete release/platform/schema/actor/workspace/key binding | `tests/staged-service-transfer.test.js` direct-child attachment case | Verified locally with the production importer. It checks and retains exact bytes, digest, manifest binding, release identity, actor, workspace, stage, and operation ID; a second read returns null. |
| Redirected or linked configured services authority | `tests/staged-service-transfer.test.js` junction-denial case | Verified locally on Windows. A configured junction is denied before manifest, attachment metadata, or archive bytes are written. |
| Shared durable operation claim, prepared/claimed/sealed order, recovery without re-fetch or re-import | `tests/staged-service-transfer.test.js` journal and recovery cases | Verified locally. The unified operation/stage document is persisted under the cross-process lock before child invocation. |
| Abrupt separate-process failure after real child durable input and before outcome seal | `tests/fixtures/staged-transfer-hard-exit.mjs`; `tests/staged-service-transfer.test.js` hard-exit case | Verified locally. The fixture exits with code 73 after the production importer retains bytes; restart reconciles to consumed without resolver access or a second child import. |
| Corrupt/divergent retained state and unknown retention | migration/divergence and unknown recovery cases in `tests/staged-service-transfer.test.js` | Verified locally for divergent legacy sidecar denial and unknown claimed recovery. Broader deliberately corrupt unified-store permutations remain unproven. |
| Audit outbox exactly-once safe retry and privacy | `src/runtime/release/staged-service-transfer.ts`; focused transfer tests | Partially verified: source and current focused tests cover durable outbox ownership and no child retry. A dedicated failure/restart Audit-outbox test is still required. |
| Full closed HTTP matrix: duplicate headers, method/tail misplacement, all body limits, actor concealment, permission-before-body denial, all stage states | `tests/staged-service-transfer-http.test.js` | Partial. The current test proves missing/invalid/misplaced credentials, normal create/upload/finalize/confirmation/register/replay, safe GET, and query denial. The remaining negative matrix is open test work. |
| Owner-pinned released manifest and asset catalog | `src/runtime/release/service-producer-release-resolver.ts`; `tests/service-producer-release-policy-contract.test.js` | Blocked by #1524 producer owner catalog pin and independent review. Default stage creation correctly returns `503 release_provenance_unavailable`; fixture policy proof is surrogate-only. |
| Linux/macOS TAR release asset admission | `tests/staged-service-transfer.test.js`; `docs/api/staged-service-transfer.md` T1--T5 | Correctly fail-closed. TAR is not enabled: T1 independent review, T2 producer receipts, T3 producer fixtures, T4 parser/importer evidence, and T5 released CLI/TUI/Core three-OS journey are all outstanding. |
| Packaged Core plus released external CLI/TUI transfer on Windows, Linux, macOS | `docs/api/staged-service-transfer.md` | Blocked / not claimed. This requires the owner-pinned catalog and TAR qualification prerequisites; local test fixtures cannot replace it. |

## Execution record

The focused Development check is:

```text
npm run build
node --test --test-concurrency=1 tests/staged-service-transfer.test.js tests/staged-service-transfer-http.test.js tests/staged-service-transfer-contract.test.js tests/service-producer-release-policy-contract.test.js
```

It is direct local source/runtime evidence for the rows marked verified. It is
not release qualification, producer acceptance, an external client journey,
or a GA decision. Remaining rows stay open in `ISS-1463-implementation` and
the separately owned #1524/T1--T5 prerequisites.

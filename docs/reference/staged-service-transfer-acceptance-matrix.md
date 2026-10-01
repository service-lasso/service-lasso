# Staged service transfer acceptance matrix

This is the Development evidence map for issue #1463 / PR #1566. It maps
`SPEC-002 AC-4CH`, `AC-4CH.1`, and `AC-4CH.2` to executable evidence without
turning local fixtures into release, producer-policy, or GA claims.

| Requirement / scenario | Evidence | Result and proof strength |
| --- | --- | --- |
| Closed release-asset-only create request; no client size, digest, URL, asset ID, manifest, or workspace authority | `tests/staged-service-transfer.test.js`; `tests/staged-service-transfer-http.test.js` | Verified locally. The server-derived identity controls byte length and digest; query injection and malformed/misplaced transfer headers are denied. Direct runtime HTTP proof for the covered routes. |
| Trusted authenticated runtime actor and `service:configure` before body mutation | `src/server/index.ts` transfer route; `staged transfer HTTP keeps actors isolated, denies before body reads, and preserves terminal confirmation privacy` | Verified locally through the normal trusted loopback ingress request-policy path. A configured Viewer receives `403 permission_denied` before an announced JSON body is sent or provenance resolution can occur. This is not a released external identity-provider journey. |
| Actor-scoped status, metadata-only readback, exact replay, and no second child mutation | `tests/staged-service-transfer-http.test.js`; `tests/staged-service-transfer.test.js` | Verified locally. A second configured Owner receives the same `404` body for a non-owned stage as for a nonexistent stage. Readback omits confirmation and full archive digest; terminal replays report the same durable operation without another byte-object read. |
| Ordered chunks, range/length/hash binding, quota, expiry retention, digest terminality | `tests/staged-service-transfer.test.js` | Verified locally. Invalid ranges and altered chunks fail closed; capacity remains retained through expiry; digest mismatch becomes terminal before parser admission. |
| ZIP preflight, no extraction, no install/acquire/start/materialisation side effect | `tests/staged-service-transfer.test.js`; `src/runtime/release/release-archive-preflight.ts`; `src/runtime/operator/remote-service-registration.ts` | Verified locally for ZIP. The direct child writes only the manifest and immutable attachment bytes; it does not extract or activate the archive. |
| Exact Core-held byte object and retained release/platform/actor/workspace/key binding | `tests/staged-service-transfer.test.js` direct-child attachment case | Verified locally with the production importer. It checks and retains exact bytes, digest, manifest binding, release identity including platform, actor, workspace, stage, operation ID, and idempotency key; a second read returns null. The attachment does not carry an independently owner-pinned catalog identity, so this is not evidence of complete catalog/schema binding. |
| Redirected or linked configured services authority | `tests/staged-service-transfer.test.js` junction-denial case | Verified locally on Windows. A configured junction is denied before manifest, attachment metadata, or archive bytes are written. |
| Shared durable operation claim, prepared/claimed/sealed order, recovery without re-fetch or re-import | `tests/staged-service-transfer.test.js` journal and recovery cases | Verified locally. The unified operation/stage document is persisted under the cross-process lock before child invocation. |
| Abrupt separate-process failure after real child durable input and before outcome seal | `tests/fixtures/staged-transfer-hard-exit.mjs`; `tests/staged-service-transfer.test.js` hard-exit case | Verified locally. The fixture exits with code 73 after the production importer retains bytes; restart reconciles to consumed without resolver access or a second child import. |
| Receipt-bound atomic direct-child publication and durability failure classification | `tests/staged-service-transfer.test.js` private-publication boundary matrix; `tests/windows-directory-sync-helper.test.js`; managed/bootstrap provenance | The native bootstrap is a non-CLR PE. Before it starts the managed launcher it strips loader-sensitive inherited variables, holds the package-adjacent managed image through a no-write/no-delete handle, verifies its fixed reviewed digest and length, rejects reparse/final-path mismatch, launches non-detached, and returns the managed exit. The managed launcher then validates the closed directory payload and package-adjacent sync helper, holding its verified helper and directory handles across `CreateProcess`; the helper flushes the directory. Binding, launch, open, flush, close, or child-exit failure remains `unknown`. The direct native verifier is invoked through normal PowerShell without an execution-policy override. The current local PowerShell policy refuses scripts, so native provenance and behavioral evidence remain unavailable locally and require the hosted Windows direct proof. This is source/runtime fault evidence, not a power-loss qualification. |
| Corrupt/divergent retained state, orphan records, and unknown retention | `staged transfer fails closed for hostile unified-store permutations without refetching or reimporting` in `tests/staged-service-transfer.test.js`; migration/divergence and unknown-recovery cases | Verified locally. Unknown root/stage fields, duplicate stages, byte-object length substitution, operation/stage byte-object mismatch, orphan outbox, and journal workspace mismatch return `503` before provenance resolution or child import. This is direct source/runtime persistence proof; it is not an independent producer catalog or release qualification. |
| Audit outbox exactly-once safe retry and privacy | `tests/staged-service-transfer.test.js` append-before-removal restart case | Verified locally. A durable outbox replay after an already durable append retains one deterministic operation-bound event with only actor, target, operation, workspace, outcome, and status metadata; it never invokes the child again. |
| Closed HTTP header/body/route negative matrix | `staged transfer HTTP rejects malformed route grammar before state disclosure and accepts only strict transfer bodies` in `tests/staged-service-transfer-http.test.js` | Verified locally against a real Core HTTP server. Duplicate Authorization, misplaced transfer-token/confirmation headers, wrong JSON/octet-stream content type, duplicate and unknown JSON members, invalid JSON, query injection, and method/tail misplacement terminate with stable non-success outcomes before child import. |
| HTTP actor concealment, denied profile before body read, and every terminal stage/confirmation state | `staged transfer HTTP keeps actors isolated, denies before body reads, and preserves terminal confirmation privacy` in `tests/staged-service-transfer-http.test.js` | Verified locally against the real Core HTTP listener. The test drives separate Owner and Viewer ingress identities, the before-body `403` boundary, expired confirmation rejection, and privacy-safe readback for `expired`, `rejected`, `quarantined`, `unknown`, and consumed stages. Reuse is directly exercised where a durable operation exists; rejected and expired stages cannot reissue or consume a confirmation. |
| Owner-pinned released manifest and asset catalog | `src/runtime/release/service-producer-release-resolver.ts`; `tests/service-producer-release-policy-contract.test.js` | Blocked by #1524 producer owner catalog pin and independent review. Default stage creation correctly returns `503 release_provenance_unavailable`; fixture policy proof is surrogate-only. |
| Linux/macOS TAR release asset admission | `tests/staged-service-transfer.test.js`; `docs/api/staged-service-transfer.md` T1--T5 | Correctly fail-closed. TAR is not enabled: T1 independent review, T2 producer receipts, T3 producer fixtures, T4 parser/importer evidence, and T5 released CLI/TUI/Core three-OS journey are all outstanding. |
| Packaged Core plus released external CLI/TUI transfer on Windows, Linux, macOS | `docs/api/staged-service-transfer.md` | Blocked / not claimed. This requires the owner-pinned catalog and TAR qualification prerequisites; local test fixtures cannot replace it. |

## Execution record

The focused Development check is:

```text
npm run build
node --test --test-concurrency=1 tests/staged-service-transfer.test.js tests/staged-service-transfer-http.test.js tests/staged-service-transfer-contract.test.js tests/service-producer-release-policy-contract.test.js tests/windows-directory-sync-helper.test.js tests/mcp-product-artifact.test.js
```

The JavaScript transfer, HTTP, archive, and packaged-layout checks are run in
an owned temporary registry/workspace. Tests must never consume or mutate a
shared host or instance registry; an oversized shared registry remains invalid
input under its existing bounded-size rule. The helper probe rebuilds the
checked-in C# through the trusted .NET Framework compiler, rejects altered
provenance/source/binary identities, and records actual success,
invalid-argument, and directory-open exit paths when normal PowerShell permits
execution. This workstation's normal PowerShell policy refuses scripts, so
that native proof and `verify:mcp:packaged` are currently unavailable locally;
no execution-policy bypass is used. Hosted Windows evidence remains required.
These checks are not release qualification, producer acceptance, an external
client journey, or a GA decision. Owner catalog and TAR gates remain separately
owned #1524/T1--T5 prerequisites.

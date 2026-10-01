# Core #1463 / PR #1566 — 9da held-launcher and transfer qualification record

## Frozen review basis

- Review basis before this corrective update: `9da14497157ed36cec54729d9736986b10b5adbe` on `feature/1463-complete-staged-transfer`.
- Target branch: `develop`; no `main` input, comparison, target, or promotion was used.
- Governing requirements: `SPEC-002 AC-4CH` through `AC-4CH.2` and the staged-transfer contract.
- This record is author evidence only. It is not the required independent review, producer-owner catalog pin, exact-head qualification, release decision, or GA approval.

## Finding and repair

The frozen 9da native directory-sync launch path held the requested helper with `FileShare.Read` and checked its digest, but the utility payload still supplied the helper path, byte length, and digest. The payload deserializer was not itself the existing closed-world parser. That left native helper admission caller-controlled after the JavaScript-side sidecar check.

The corrective change makes the native launcher the complete admission boundary:

- It derives one package-adjacent helper path from the launcher's own assembly directory and compares the held regular file with the fixed reviewed helper digest and length.
- Its utility payload is exactly canonical UTF-8 `{"directory":...}`. It rejects malformed UTF-8/base64, duplicate keys including escaped keys, unknown helper/digest fields, reordered or whitespace-bearing spellings, and noncanonical string encodings before it opens either helper or directory handle.
- The JavaScript caller no longer sends helper authority. It strips `COR_`, `CORECLR_`, `COMPLUS_`, and `APPDOMAIN_MANAGER` names from the child environment. The launcher independently rejects those names before either launch mode consumes input.
- The existing final-path/reparse checks, read-only/no-delete helper handle, held directory handle, non-detached `CreateProcess`, child wait/exit check, and fail-closed unknown classification remain in place.

## Direct local evidence

Executed in the assigned Windows worktree:

1. `npm run build` — passed.
2. `scripts/verify-windows-process-inspector.ps1 -ManagedLauncherNative -Update` — passed; launcher source SHA-256 `2f79fdb9652d3aa2fb3a8de5169d889cf0943b6baf76bdf4329ceff7925d065b`, normalized native binary SHA-256 `c7aaddac28156d6f5164721d65f2a31bd96393e927526da7c8ddb9ea63b52d40`, length `39936`.
3. `scripts/verify-windows-process-inspector.ps1 -ManagedLauncherNative` — passed with 18 provenance negative cases.
4. `scripts/verify-windows-process-inspector.ps1 -DirectorySyncHelper -Behavioral` — passed with 18 provenance negative cases and three helper behavior cases.
5. `node --test --test-concurrency=1 tests/windows-directory-sync-helper.test.js` — passed (2/2). The test holds the actual package-adjacent helper open through native launch, rejects replacement, rejects duplicate/escaped/unknown/whitespace payloads, and rejects a loader-sensitive `COMPLUS_` child environment before a helper invocation.
6. The targeted staged-transfer and policy/contract suite produced 29 passes and one preserved failure in `tests/staged-service-transfer-http.test.js`: terminal `unknown` replay/reconfirmation returned `500` where the fixture expects `200`/`404`. A direct rerun reproduced the failure at the same terminal-state matrix. It is outside this native utility repair and remains an unqualified existing HTTP gate; no retry, timeout, concurrency, policy, or behavior relaxation was applied.
7. `npm run lint` is unavailable in this package (`Missing script: "lint"`); this is recorded rather than substituted with a different lint command.

## Qualification limits and next action

The direct Windows source/runtime boundary above is repaired and tested. This does not qualify the complete #1463 delivery. The owner-approved service-producer catalog pin is absent; TAR stays denied pending T1--T5; the released checksum-bound CLI/TUI/Core journey remains absent on Windows, Linux, and macOS; the frozen PR has pending/failed hosted checks; and an independent whole-review remains required.

Next executable action: a distinct reviewer should inspect the pushed corrective head, including the native binary/provenance match and the retained HTTP terminal-state failure, then issue an independent review without treating this author record as approval.

## Superseding pre-CLR repair

The earlier corrective description called the C# executable "native". That was
incorrect for loader-environment ordering: a .NET Framework executable enters
the CLR before `Main`. The current repair adds a separate unmanaged PE bootstrap
as the executable invoked by Core. It removes case-insensitive `COR_`,
`CORECLR_`, `COMPLUS_`, and `APPDOMAIN_MANAGER*` variables before it starts the
separately named managed launcher; it holds and hashes that managed image using
the fixed reviewed digest and length compiled into the bootstrap, rejects a
reparse/final-path mismatch, waits for the non-detached child, and returns its
exit. The managed component retains the previously repaired payload and helper
admission boundary. The bootstrap has independent source/binary/managed-image
provenance and a PE check that CLR metadata is absent. A hostile inherited
`COMPLUS_Version` directory-sync execution completes through that bootstrap.

This author evidence does not alter the retained HTTP `500` failure: the earlier
one-run result remains non-reproducible and therefore does not establish stale
state or refute the original cause. It also does not qualify catalog, TAR,
released three-OS, hosted exact-head, independent review, or GA gates.

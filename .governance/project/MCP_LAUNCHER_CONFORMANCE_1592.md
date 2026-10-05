# MCP launcher conformance #1592

Development source repair only, bound to `SPEC-002 AC-4BH/AC-4BJ`, the existing
`#864` artifact inventory, and `SPEC-003 BR-001/BR-005/BR-008`. The isolated
`fix/1592-mcp-launcher-conformance` checkout starts from current `develop`
`3a8d0c9c1510c7e5832dae1eca7bd38eacf02444`. The inherited primary checkout and
other issue-owned checkouts are preserved; no runtime or product import occurred.

## Direct retained failures

Each natural attempt remains failed, separately attributed:

| PR | Exact head | Run / job | Original log SHA-256 |
| --- | --- | --- | --- |
| #1591 | `0902c87398ea874448f3fda441e42568cfc79ac7` | `36988579136` / `110779194279` | `9aac1e5479b11cd08446f35d23517051845426f8b060e2c4eeba8d45d1c7bc71` |
| #1586 | `d33f78e579265c142d398b7d3de4261973af90bf` | `36988821556` / `110779966591` | `c8fb35d56ddbe8a85bd9df265d3ddeddfcc020fbc4d3b4f7a6fe4e4838e528f7` |

Original raw logs remain in the external audit bundle named
`mcp-source-conformance-4ef5beddd7a24dd5b5156377a674f0e9`, as
`1591-0902-original.log` and `1586-d33-original.log`; no raw source/process logs
are copied into this repository. Both fail the existing retained-evidence test
at `tests/mcp-product-artifact.test.js:674` (test declared at line 311).
The rejected source contains the awaited call with a legal trailing comma
immediately before spawning the same selected launcher. This is source/log
evidence, not a successful execution baseline or runtime root-cause acceptance.

## Repair and proof boundary

The source assertion retains its deadline-wrapper and launch-state checks,
permits an optional call trailing comma, and additionally requires `await`,
the completed statement immediately before wrapper spawn, and the same selected
launch-state executable as the spawner argument. All native inventory, hashes,
provenance, retired-asset, loader and packaging assertions remain intact.
No runtime source, executable, provenance, workflow or dependency bytes change.

Manual inspection of `supervisor.ts` confirms integrity uses the existing
`processControlDeadline(WINDOWS_MANAGED_LAUNCH_TIMEOUT_MS)` and awaited
`withProcessControlDeadline`, including abort propagation to the file check.
The launch-state creation check and second selected-executable check remain
before `managedProcessSpawner`. Regex presence remains surrogate-only proof.

## Existing behavioral coverage inspected, all UNEXECUTED

| Test in `tests/process-ownership.test.js` | Declared proof and limit |
| --- | --- |
| `Windows managed launcher rejects missing, oversized, corrupt, and redirected native assets before spawn` | Real reviewed launcher positive start/readiness, owned PID/creation evidence, stopped ownership, then four rejected native inputs with no managed record and unchanged stopped ownership. Initial rejection is classified `launch_state_creation`. |
| `Windows managed launcher revalidates its native asset after launch-state creation` | Same-size native corruption after the first integrity check must reject at `wrapper_spawn`, with the integrity error, no registry ownership and no managed record. #1592 adds a counting, non-spawning existing spawner hook and requires zero calls, making pre-spawn rejection explicit rather than inferring it solely from state. The hook is restored in `finally`. |
| `Windows guarded launcher starts an artifact-style JavaScript ESM entrypoint while approved bytes remain bound` | Real executable/script bindings, target marker and target-vs-wrapper identity, owned lifecycle and teardown. Synthetic service evidence does not replace released Admin acceptance. |
| `Windows managed launcher strips loader controls from bootstrap and restores them only for the target` | Mixed-case COR/CORECLR/COMPLUS/AppDomain controls accompany a real managed launch; target environment must equal the declared controls. This positive test does not by itself prove every unmanaged bootstrap loader boundary. |
| `Windows managed launcher rejects same-size approved script changes after guarded preflight` | Real same-size script mutation after initial hash approval rejects at `launcher_file_hash`, never writes the target execution marker, verifies one initial approval, and converges to stopped ownership. This is approved-target binding rejection, distinct from native-binary replacement. |

These Windows-only tests, current native-bootstrap safety tests, source
conformance, full native provenance checks and packaged three-OS MCP acceptance
remain required evidence. None is reported as run or passing in this unit.
In `tests/windows-directory-sync-helper.test.js`, the existing
`Windows unmanaged bootstrap attests the held managed launcher before any CLR startup`
test calls the actual bootstrap verifier and requires a passed receipt and absent
CLR metadata. `Windows native bootstrap retains managed-package ancestry through
the actual managed child exit` starts copied real native/managed/helper bytes,
requires held execution/helper rename rejection until the child gate completes,
checks terminal zero exit/no signal, rejects hostile closed payloads and invokes
the directory-sync path under hostile CLR loader controls. That path is related
bootstrap safety coverage, not direct managed-service loader acceptance.
The explicit zero-spawner observation gap is repaired within the existing test;
no parallel regex-mirroring test or new architecture is introduced.

## Handover and open gates

Manual source/diff review is available; syntax, imports, dependencies, builds,
tests, compiler/native helper execution are UNEXECUTED. Fresh complete external
exact-input custody and ROOT actual-read admission must precede local runtime
execution. Whole independent PR review and terminal natural exact-head relevant
CI/native evidence remain open. Original failed attempts are not waived by any
future success. No merge, rerun, provider-control change, publication, promotion,
deployment or release/GA decision is authorized by this repair.

Next action: independent whole-change source review of the frozen PR, followed
by the external custody/admission gate before any local execution. Keep the
clean issue checkout retained for that governed landing path.

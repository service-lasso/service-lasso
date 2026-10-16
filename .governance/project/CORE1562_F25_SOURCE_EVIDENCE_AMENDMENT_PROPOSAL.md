# #1562 F25 PowerShell source-evidence amendment proposal

Status: PROPOSED, not selected, SOURCE_UNRUN. SPEC-002 AC-4DI.4/R3/C3/G1
and the review32 complete F23-F25 requirement govern. This proposal changes
only a supplementary textual witness after separate review; it grants no native
closure, source GO or execution admission.

## Required behavior and present disagreement

The original requirement is globally rooted original owner references AND the
SAME nonreturning live invocation while original resources remain unresolved.
Retain the first initiating Exception object. Interruptions of retention must
record the original interruption through Add-OriginalToolError, shield recorder
failure, set recordingFailure and recordingFailed, and continue retaining.

The natural caee004 complete-suite run 38767249811/job116533568931 fails the
F25 PowerShell witness in tests/core1681-review32-source.test.js: it expects
`$owner.gate.Wait()` inside the infinite shielded loop. Actual
scripts/verify-windows-managed-launcher-bootstrap.ps1 Retain-ActiveOriginalOwner
uses `[Threading.Thread]::Sleep([Threading.Timeout]::Infinite)` at the same
boundary. The original while, interruption catch, original-error recorder and
nested recorder-failure catch remain. A source string match does not qualify
actual native interruption, allocation failure or nonreturning invocation.

## Exact prospective witness

After a DIFFERENT review selects this amendment, replace only the stale wait
statement in the existing assertion with the actual selected infinite-sleep
statement. Require the complete contiguous actual shape:

```powershell
while ($true) { try { [Threading.Thread]::Sleep([Threading.Timeout]::Infinite) } catch { try { Add-OriginalToolError 'custody-wait' $_.Exception } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true } } }
```

Bind the assertion to the actual Retain-ActiveOriginalOwner function body,
including the existing globally rooted owner and custody-record publication
before the loop. Require complete loop/try/catch nesting and consume the whole
retention tail, so an added return/break/throw or an earlier escape cannot pass
merely because a matching fragment remains. Reuse existing function extraction
and balanced source-region mechanisms where suitable; if they cannot establish
this bounded region, refuse source conformance rather than broaden admission.
Do not accept arbitrary sleeps, waits, equivalent-looking callbacks or a
substring of another function. All other original F25 assertions remain intact.

## Required source adversaries and positive case

The unchanged actual barrier must satisfy the new witness. Mutations of that
actual body must be rejected independently when they:

- replace Infinite with 0, 1, a finite duration or an unbound variable;
- remove the while loop or replace its condition with false;
- insert return, break or a propagating throw before or after the sleep;
- move sleep outside the original try/catch or remove the interruption catch;
- remove the nested recorder catch, recordingFailure assignment or primitive
  recordingFailed assignment, or replace the retained original Exception;
- add an escaping statement before the barrier while leaving a valid-looking
  copy in an unreachable/other function region;
- remove the original globally rooted owner/custody recording.

These are prospective source conformance checks, not actual native failure
injection and not the sole completion proof. Preserve original primary identity,
all independently safe once-only releases, unresolved resource retention and
native acceptance requirements. No target test is changed by this proposal.

## Review and execution boundary

A different fresh reviewer must inspect this entire proposal separately from
implementation acceptance, together with the cumulative fixture/helper source
and surrounding protected F25 behavior. Selection must be explicit and durable.
Only then author the bounded witness/adversaries and obtain a new entire review
of final source. NEW complete actual-input ROOT admission remains required
before local parser/import/compiler/build/test execution. Natural push CI is an
observation, never a substitute for those gates. Foreign-owner ROOT input,
Windows EBUSY and every other full product gate remain separate.

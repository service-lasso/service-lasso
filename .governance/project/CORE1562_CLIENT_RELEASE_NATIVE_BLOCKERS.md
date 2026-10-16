# #1562 current natural native blockers

Snapshot: 2026-10-16, exact272072d494df8d394e2a7e32533c4c964ebf5273.
Source changes and native qualification remain separate. No test/timeout/privacy
weakening or speculative cause is authorized by this record.

## Windows startup fixture privacy acquisition

Startup hard-crash matrix run38837326954: parent independently observed all7
Linux matrix jobs PASS and all7 Windows jobs FAIL. The author directly read
Windows job116769256149's actual completed log. Its fixture privacy transport
reports verification/protection response_unavailable, events in this order:
boot_enter, parse_enter, parse_ok, compiler_enter, compiler_ok,
native_enter_acquire. fixture_initialization and initialization_diagnostic_privacy
fail before crash/injection; original-privacy/held-acquire flags remain clear.
The actual fixed-bootstrap regression in fixture-privacy-transport-regressions.js
also fails its expected compiler phase with actual undefined at line91.

This proves the observed failed boundary, not a lock owner, timeout cause,
compiler defect or native handle acquisition outcome. No later successful
fixture custody, crash injection, startup recovery or operator acceptance is
established for these Windows rows. Existing actual private errors/fixtures
remain retained; do not remove them or disable privacy. Next bounded native
work is a causal closed observation of the original acquisition/transport failure
after the F25 AST intent unit and new exact source/review/admission gates.

## Packaged MCP and whole release distinction

bea07557 Windows packaged job116766860852 completed SUCCESS, with package archive
SHA2563de2a26f61b18816b7c6f45c17046cda308bdb9a7341b47032b3ee4780d64193.
The author directly read its actual success log. This supersedes earlier EBUSY
observations for that exact job only; no causal leak fix/all-head claim follows.
bea ReleaseQualification38836416766 later CANCELLED after mandatory documentation
push; full qualify-products116766860567 is CANCELLED, not failure or pass.
Current272 ReleaseQualification38837327003 was running at this snapshot, with
fullsuite116769680967 and Windows packaged116769681298 in progress. Do not
reuse prior exact-head successes to qualify changed bytes. macOS is current
scope N/A, never PASS for this delivery even if an unchanged workflow job succeeds.

# #1562 dce8 entire-review repair

SOURCE_UNRUN. The different entire review covered all fifty cumulative files.
F25 normative coverage gaps are resolved; this is not a third coverage failure.
The concrete independent P2 is C# version-specific own generic constraints.

The current invocation bridge prunes a method on authentic CONSTRAINT_MISMATCH
before better-member selection regardless of its independently supplied C#
profile. C# 7.3 introduced that pruning. Under the supported C#5 profile,
F<T>(T) where T:class against F(object), called with F(1), must first select the
better generic method and then fail its own constraint. Falling back to object
silently changes binding. Preserve supported5 behavior rather than denying the
entire old profile. Validate the actual version tuple, prune only7.3+, and for
older profiles retain the candidate's exact original mismatch privately until
the chosen candidate is known. Missing metadata/profile or any other original
failure stays a hard failure; no raw error-code reads or fallback selection.
Pair5.0/7.2 and7.3/8.0 actual-source regression rows, including cases where a
constraint-invalid candidate loses and where no valid fallback exists.

Complete existing direct caller trace (static, not executed): the only imported
callers are selected-body.mjs's call expression path and the original-source
bindFixture invocation closure in core1681-selected-overloads.test.js. The body
passes csharpLanguageVersion from its actual environment.languageVersion and
recursive scalar callees retain that same environment. Its scalar-body test
constructors explicitly supply languageVersion5.0; no fallback is added there.
bindFixture previously fixed5.0 and retains that existing fixture profile;
only the new paired source fixtures pass their explicit alternative tuple.
The invocation bridge itself has no default version and rejects missing or
malformed evidence. Both callers and their imported source/profile inputs are
included in the refreshed complete input proposal.

Before any authentic own-constraint mismatch is deferred, preserve the actual
declaring/enclosing substitutions with duplicate-declaration refusal. The error
map is keyed by the exact constructed candidate object consumed by overload
selection; only selected.candidate's original error is rethrown. A paired
constructed C<int> source fixture exercises the enclosing substitution path.

Primary language source:
https://github.com/dotnet/csharplang/blob/main/proposals/csharp-7.3/improved-overload-candidates.md
https://github.com/dotnet/csharplang/blob/main/Language-Version-History.md

Parent separately selected exactly two privacy payload list snapshots after
the repeated current-head natural Windows failure. New-Object List[object]
combined with direct @($list) has a published binder-failure report, including
empty lists and Windows PowerShell5.1. It is a source-driven hypothesis, not
observed proof that the current CI host has that cause:
https://github.com/PowerShell/PowerShell/issues/27558

Replace only the two direct conversions with ToArray snapshots: validation
keeps ancestors then held; finalization keeps held then ancestors. Retain the
same entry/handle references and existing private ErrorRecords, compiler313,
the actual original-compiler-response regression, ACL/owner/privacy checks,
timeouts and cleanup obligations. Preserve pipelined array forms and guardian
direct enumeration. No new bootstrap enum/grammar or failure-to-PASS mapping.
Natural exact-head CI after this source repair must establish its actual effect;
missingresponse/native cause remains unknown until then.

Different ENTIRE cumulative source review, complete actual-input/root admission,
native qualification and publication remain separate. No local target parser,
import, compiler, test, build, install or native command is authorized here.

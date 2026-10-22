# F25 committed normative requirement to actual-mutant coverage

State: SOURCE_UNRUN. This map changes no requirement. Two consecutive reviews
(dc9d5bed and 39edb785) found incomplete committed adversary coverage. A third
same-signature gap requires the scoped GOV13 circuit breaker/model reassessment.
The material corrective verification is this explicit clause-by-clause map,
named reachable mutants and their prospective authenticated child outcomes.
It does not certify execution, native behavior, parser/tool identity or ROOT.

All new IDs below belong to `tests/core1562-f25-normative-adversaries.test.js`.
Each named subtest must find its actual original target, change that source,
and await `isF25AstRejection`. Missing targets, unchanged source or generic
infrastructure failures cannot satisfy a row. No target mutant is executed.

| Committed clause | Named evidence family |
| --- | --- |
| Function defaults, parameter attributes/extra parameters, alternate body ParamBlock; filters/workflows | DEF.default, DEF.parameter-attribute, DEF.extra-parameter, DEF.body-paramblock, DEF.filter, DEF.workflow |
| Begin/Process/DynamicParam/Clean/named End and traps | BLOCK.begin, BLOCK.process, BLOCK.dynamicparam, BLOCK.clean, BLOCK.named-end, BLOCK.trap |
| Duplicate/relocated selected definitions and original local helper scope/order | DEF.duplicate.*, DEF.relocated.* for all four original nested helpers |
| Actual tool and retention aliases; no extra effect/provider/module/hook/evaluated callback | CTX.tool-alias, CTX.retention-alias, CTX.command, CTX.provider, CTX.module, CTX.hook, CTX.callback |
| Canonical registry type, comparer, construction/default/factory and same scoped target | REG.type, REG.comparer, REG.default-constructor, REG.factory, REG.scope |
| No registry replacement before/after definition | REG.replace-before-definition, REG.replace-after-definition |
| BOTH actual initialize/compile calls remain direct and after unique definition | CALL.initialize.indirect, CALL.initialize.before-definition, CALL.compile.indirect, CALL.compile.before-definition |
| Reachable direct original root, no pre-root escape/conditional effect | ROOT.return, ROOT.exit, ROOT.break, ROOT.continue, ROOT.throw, ROOT.conditional, ROOT.trap |
| No owner/key/start/registry rebinding after root | ROOT.owner-rebind, ROOT.key-rebind, ROOT.start-rebind, ROOT.registry-rebind |
| Immediate post-release OR condition; no relocation before root or after registry removal | GATE.before-root, GATE.after-remove; retained either-release-or-recorder test covers AND and each omission |
| Every three original recorders retains literal name/phase, scoped original nonstatic/non-nullconditional/literal Exception; no invocation/conversion/extra/redirection | REC.<phase>.command/phase/errorrecord/copied/other-member/PSItem/scope/static/nullconditional/computed/expandable/invoke/conversion/extra/redirection/indirect/pipeline/wrapper |
| Every inner shield keeps original assignment, primitive true flag, no extra command/throw/return/wrapper | SHIELD.<actual-occurrence>.errorrecord/copied/other-member/missing-flag/false-flag/command/throw/return/wrapper |
| Every recorder command/phase/Exception newline/comment boundary and every shield member newline/comment boundary, exact third incident | Retained all-original-recorder-boundaries and every-shield assignment split tests in core1562-powershell-retention-source.test.js; each actual occurrence is mutated separately |
| Finite/false/escaping/unshielded/unrooted/unreachable-copy barrier; inert comment and exact parser-preserved continuation positives | Retained finite/escaping/unshielded/unrooted test and actual-barrier positive test in core1562-powershell-retention-source.test.js |
| No explicit generic method binding or script requirements | Retained registry/retention/resource generic and Modules/Version/Admin test in core1562-powershell-retention-source.test.js |
| Strict source filename/hash/length/UTF8/base64; duplicate/trailing/malformed input/output and extra/partial stderr/stdout | Retained actual-child malformed-input and canonical-response tests in core1562-f25-ast-protocol.test.js |
| Spawn/stdin/EPIPE/stdout/stderr/signal/unexpected exit, all completions and real close, exact first/later/null/undefined/opaque originals | Accepted shared-collector event-driven SURROGATE tests in core1562-f25-ast-protocol.test.js; these never mint source denials or prove native execution |

The authoritative intent is CORE1562_F25_AST_WITNESS_CIRCUIT_BREAK.md, including
Meaningful AST adversaries, revision1 complete scopes/owned child/required
coverage, revision2 enclosing context, and first real-AST iteration corrections.
All original helper/fixture/opaque tests remain complete selected test files.
Full DIFFERENT ENTIRE cumulative source review is still required; no earlier
review that did not finish the whole helper/catalogue is promoted to SOURCE_GO.

SHIELD occurrence IDs bind all eighteen actual original catch assignments in
source order: 1 recorder-append, 2 copy-observation, 3 retention-copy-observation,
4 custody-record, 5 custody-wait, 6 start-false, 7 start-throw, 8 attachment,
9 stdin-close, 10 copy-start, 11 natural-exit, 12 available-exit, 13 initiating,
14 source-release, 15 raw-flush, 16 raw-dispose, 17 process-dispose, 18 result.
The test refuses any occurrence count other than eighteen; each variant changes
one selected occurrence while preserving every other original assignment.

Full normative reread also found the explicit fixed-child obligation to disable
module auto-loading had not been encoded. Set PSModuleAutoLoadingPreference to
None and replace Get-Content/ConvertFrom-Json catalogue loading with strict
System.IO/System.Text.Json reads and a closed JSON-value conversion. This adds
no module import, evaluated target code or parser fallback. The fixed catalogue
remains independently authored; the conversion must preserve its arrays and
operand data rather than deriving expected structure from the target program.
Use ordinal dictionaries with duplicate-key refusal, exact Int64 catalogue
numbers (all selected catalogue numbers are integers), strict strings, actual
null and non-enumerated array returns. No JSON conversion or IO module cmdlet
is required under None.

Parser.ParseInput is not a sandbox or a promise of no lookup: the pinned SDK's
post-parse SymbolResolver may perform Get-Module ListAvailable for source using
module directives before matcher refusal. The fixed baseline, every named
mutant and actual tool/runtime/ENV/discovery inputs still require NEW complete
admission. No hostile/unreviewed module experiment, native execution or new
authority is inferred. CTX.module is a parsed ordinary Import-Module command,
not a source using-module lookup experiment.

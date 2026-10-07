# Core1681 source foundation

SPEC-002 AC-4DI.4 / R3 / C3; Development, source only, in_progress.
Parent adopted entire requirements review15 ROOT
`c846461caeeaa7b3855af49a6303fa3e90ed9e10ae34e9cdd2d2a2207a5b7182`
and author14 ROOT
`04769f2e6b5db36da7450e3b508130c9eab331473a9a2ee6e8cb3e1565cc5795`.
This is real source authorship inside R6/K2/W1-W4/B4, awaiting a different
entire independent review. It is an incomplete foundation slice, not source GO.

## Implemented source

`tests/helpers/core1681-source-input.mjs` strictly decodes the complete original
UTF8 bytes, retains BOM/CRLF and scalar endpoints, copies the original bytes,
and derives original byte/UTF16 half-open ranges. The lexer accounts for every
token/trivia byte through EOF. Invalid UTF8, split scalar spans, unfinished
literals/comments, unsupported characters and language-specific literal forms
deny. C transformed/spliced/macro origins are not implemented: C denies before
producing a forest, rather than borrowing contiguous source ranges.

`tests/helpers/core1681-source-forest.mjs` supplies a closed recursive descent
subgrammar for C# and JavaScript. It actually parses expressions, arguments,
declarations, blocks, if/else, while and return/throw; it does not select body
templates, names, hashes or required-role rows. Supported C# declarations include
namespaces/repeated blocks, classes/structs/interfaces/enums, comma fields,
methods/constructors/formals/type parameters and auto/explicit accessor syntax.
Supported JS declarations include const/let comma bindings, ordinary functions,
anonymous function expressions, simple arrow formals, captures and named import
syntax. Required instance constructors, type initializers, property backing
storage and setter value storage are derived from the whole supported type body.
Enum Int32 values derive exact previous-plus-one or supported explicit constants.
Enumeration reparses a private original snapshot; supplied/mutated forest rows
cannot choose counters. Namespace/block structure is transparent to counters;
semantic method/block ownership stays separate. Synthesized entries have a tagged
anchor/role/ordinal noSpan origin and use the same parent counter.

`tests/helpers/core1681-source-binding.mjs` admits exactly all fourteen ordered
input classes and exact R23456-1/R6-DECLID-1/six adapter identities, with mandatory
raw bytes and source versions. It resolves supported declaration TypeIds/formals,
lexical references/captures, imported/source shadows, implicit default bases and
initializer/backing/accessor relations, then emits rich declaration records.
The checker reparses original bytes and compares the entire recomputed table,
including every field, scope and relation, against a candidate. Missing/extra
declarations, shifted counters, fabricated synthetic anchors and altered capture
metadata deny. This is declaration-subset checking, not complete K-BIND expression
typing, K-CALL transfer, K-SUBSTITUTE/OWNER proof, sourceDeclOcc injectivity or B4 GO.

`tests/helpers/core1681-source-catalogues.mjs` supplies fixed finite symbolic
CLR48 and separately conditional modern declaration subsets, including the
SystemException ancestry/constructor condition, plus distinct broad-Any Truth
and Nullish value descriptors. Catalogue validation requires full structured
rows, directions, constraints/attribute fields and tagged completion/effect
partitions; duplicate/ambiguous paths, wrong targets, receiver mismatch,
incomplete rows and invented effect booleans deny. Catalogue enumeration uses
structural ordinal sorting, not row insertion or hashes. Source binding accepts
only the exact fixed internal descriptors. These subsets are explicitly
incomplete for all six selected catalogue groups and have no installed authority.

## Explicit unsupported and unfinished scope

The exact selected fourteen source files are not advertised as supported by
these smaller implemented subgrammars. Genuine source containing unsupported
forms denies the entire unit before any accepted foundation table is returned.
C preprocessing/SDK forest and both PowerShell profiles are unsupported. C#
verbatim/interpolated strings, contextual lambdas, delegates, generic constraints,
partial/explicit-interface forms, constructor chains, attribute binding,
explicit base/interface binding, local functions, overload resolution,
foreach/for/switch/try/finally/using/lock and their lowered storage remain required.
JS templates/regexes, default/rest/destructuring formals, var hoisting, async,
ASI-sensitive return/throw, class/generator syntax, loops/try/finally beyond the
implemented while/if subgrammar, named function-expression scope, spread,
optional chaining and exact selected module/export/initializer binding remain
required. Recognized syntax alone does not produce an accepted imported value:
unsupplied named exports and unknown module initializers deny binding.

Expression/type inference, call overloads/conversions, full attributes/default
constants, generic constraints/substitution, return/ref-out correctness,
initializer/enumerator/callback/finally completion alternatives, SCC finite and
infinite-prefix reasoning, typed IR, CFG and proof DAG are unproduced. A supported
declaration table can therefore describe a syntactically supported body whose
typed expression semantics remain unproved; every result explicitly says so.

All fourteen original inputs, 183 roles, 35 ordered families and nine caller
comparisons remain the final selected scope. The original H-current string API
and every protected caller assertion are preserved. No catalogue subset or
foundation fixture is substituted for those roles/comparisons. All reached
readable H/CD bodies must eventually be bound; they are presently unsupported,
never opaque because Node/native authority is absent. Preserve all18 missing
concrete provider members and six catalogue groups as independent unmet gates.
Preserve CA-INIT-TOKEN-1, CA-INIT-NPM-1, CA-SDK-INIT-1, CA-RESOURCE-1,
CA-COMMAND-1, CA-STDERR-1 without claiming their real runtime behavior.

## Evidence and next boundary

`tests/core1681-source-foundation.test.js` contains meaningful authored positive
and negative vectors for exact origin/encoding/EOF, supported parsing/counters,
multiple declarations, captures/shadows, required synthetics, enum values,
catalogue substitution and complete fourteen-input intake. ALL tests are UNRUN.
No target import/parser/helper/Node/npm/compiler/test/native/ENV/ACL operation
occurred during authoring. Generic raw reads/hash/JSON/Git/diff checks are source
custody evidence only. Original32 pins/13 failures/73-before-TAP/05-07/compiler
length/NO_GO/private/unavailable history remains literal and unresolved.

Freeze/push the coherent cumulative source for parent audit and a NEW DIFFERENT
ENTIRE foundation review. Complete all selected frontends/catalogues before any
complete forest claim; then independently reviewed typed IR/CFG/proof DAG and
all nine caller migrations remain required. Before any target effect, require
NEW complete actual-input ROOT and parent admission for exact bytes. No previous
ROOT admits these sources. Source GO, SupportSafety, runtime/native acceptance,
publication/same-byte integration and GA remain unmet. The retained PR1681
branch/worktree is the explicit governed recovery/landing exception; parent owns
tracking/admission/landing and other workers/evidence remain preserved.

## #1681 foundation review17 F1-F4 repair and develop reconciliation (2026-10-07)

SPEC-002 AC-4DI.4 / R3 / C3, Development SOURCE ONLY / in_progress. Parent adopted ENTIRE foundation review17 ROOT3bd9425aaaf180251e8e50d03a3d1aaaefce74bb8557ba2c2a27d3aab1f92da0, REPORT40bb51e1adfb77dbff35af7223976c28a10e6b1cd93be10689a660f35403b092. This coherent repair requires F1 exact nearest-enclosing/qualified nested TypeIds, parameter precedence, arity and accessibility; F2 explicit/implicit ordered field/auto-property initializer associations, const exclusion, instance/static timing and separate checked/deferred base-constructor prerequisite; F3 complete finite JS binding keyword/context rules and denial of unlowered default formals; F4 closed catalogue effect-sort tags/payload/relations including Truth/Nullish consistency, preserving the fixed-descriptor gate. Meaningful positive/negative regressions are authored UNRUN.

Retained owned PR1681 branch is the GOV-10 recovery exception. Exact current develop ce56f59245821eefd2232cdec05e2cb42bd044e4 was merged normally as 372b7464; four append-only governance conflicts retain BOTH full #1681 and incoming #1718 contracts. Incoming dependency/docs source, original CLI executable mode and all selected14 source bytes are preserved; new current source/version associations will be recorded in the NEW cumulative ROOT. Historical original hashes remain history, never current admission.

Four modules remain foundation partial. All14 inputs/183 roles/35 families/9 callers/18 provider premises/6 catalogue groups, R1-R7/W1-W4/B4/K-BIND/K-CALL/K-SUBSTITUTE/K-OWNER, readable H/CD and six literal W4 adapters remain required. Shared producer/table checker is not an independent typed-proof kernel. sourceGo/admission/execution remain false; original32pins/13fails/73-before-TAP/05-07 NO_GO, 5326closure/249ranges/59supports/seven discrepancies including exactly four signature-document failures and private/unknown failures remain. No target imports/Node/helper/parser/npm/compiler/tests/XML/MSI/crypto/native/ENV/ACL effects. Natural CI push only. Freeze/push entire cumulative source for parent WHOLE audit and DIFFERENT fresh ENTIRE review19 before remaining profiles. No GA/publication/promotion/deployment/cleanup/force/rebase/settings/rerun.
### Foundation review17 F5 integration mapping (parent supplied)

SPEC-002 AC-4DI.4 / R3 / C3 also requires discovery through the unchanged standard isolated npm test runner. Rename the newly authored foundation regression file from .test.mjs to repository-standard .test.js and update its documentation references. Its .mjs helper imports remain explicit. This is additive test integration; all original protected .test.js files and runner assertions/globs stay unchanged. Regressions remain UNRUN locally and natural new-head CI is separate evidence.

## #1681 foundation review20 F6/F7 coherent repair (2026-10-07)

SPEC-002 AC-4DI.4 / R3 / C3, Development SOURCE ONLY / in_progress. Parent adopted entire review20 NO_GO ROOT a54722cfb0c5ef8f3064dfde03241c7acf87778fdb9852c0887e7a7e89a0c502, REPORT 2aad86cdba377ddb941d93d66ecc7b48f7e1e56c6321ec3326cb21e31fdac9ad. Sole fresh author21 owns the retained PR1681 checkout/branch under the existing GOV-10 recovery exception; previous author19/reviewer20 are stopped. Base/develop ce56f59245821eefd2232cdec05e2cb42bd044e4, inherited clean HEAD 2d3a0e01fb9e00075a4b013c98177310404df066.

F6 requires enclosing ordinary/function-expression/arrow context for JS return, no LineTerminator between every arrow formal boundary and =>, all CR/LF/U+2028/U+2029 (including comment trivia) for return/throw restricted productions, and correct JS line-comment termination. Ordinary contextual async identifier expressions remain valid; unsupported async syntax denies the entire unit. F7 requires zero-formal/no-access static constructors and a closed supported constructor category/modifier rule before synthetic-slot suppression or initializer timing effects. Preserve valid ordinary/static constructors, exact ordered instance/static field/property associations, const exclusion and separately deferred base-constructor transfer. Positive/negative source regressions remain UNRUN.

Retain original F1-F5 contracts, all14 exact source associations/183roles/35families/9callers/18provider premises/6catalogue groups, R1-R7/R6/K2/W1-W4/B4/K-BIND/K-CALL/K-SUBSTITUTE/K-OWNER, readable H/CD and six literal W4 adapters. Original32pins/13fails/73-before-TAP/05-07/compiler-length NO_GO, 5326closure/249ranges/59supports/seven discrepancies including exactly four signature-document failures, author18 recovery and private/unknown failures remain preserved. SourceGo/admission/execution/GA remain false, SupportSafety UNPROVED, runtime UNQUALIFIED, Mac DEFERRED_NOT_APPLICABLE. This is foundation repair, not complete CLI/TUI delivery.

Before any target effect require NEW complete actual-input ROOT, DIFFERENT ENTIRE source GO and parent admission. No target Node/npm/import/parser/helper/compiler/build/test/native/XML/MSI/ENV/ACL/crypto/extractor effects, no CI dispatch/rerun/cancel/gate weakening, force/rebase/reset/signing bypass/cleanup/settings/promotion/publication/deployment. Push every intentional commit immediately; capture natural CI handles and freeze COMPLETE cumulative candidate for parent WHOLE adoption and a DIFFERENT fresh ENTIRE review. After accepted foundation, the next actual selected unit is managed/acquisition C# profiles and complete symbolic CLR48 closure; full remaining profiles/catalogues/typed IR/CFG/proof DAG/caller migrations remain required. Parent alone owns provider tracking/review/admission/landing.

## #1681 review22 whole F8/F9/F10 expression bundle (2026-10-07)

SPEC-002 AC-4DI.4 / R3 / C3; Development SOURCE ONLY / in_progress. Parent adopted ENTIRE reviewer22 NO_GO ROOT d34c9f95518b77917538f981bdc30b52deb50ae2d57bf5daf66685be0c2e8311 / REPORT 8a78fe2a65a365ade44ce1c2ad46424958b97ba551b500755e1992af2993e50a. Fresh sole author23 owns the existing PR1681 recovery checkout/branch, inherited clean pushed35fbe60b/tree3f85c0b, develop/base ce56f592. F1-F7 remain retained; previous authors/reviewers stopped.

F8: both update operators require a supported name/member/index target (legal grouping preserved), prefix/postfix cardinality and the original JS postfix gap with no CR/LF/U+2028/U+2029, including block/line comments. Assignment/update literal/binary/update targets deny; numeric typing and const-write semantics stay deferred. F9: ungrouped arrow heads are permitted only in AssignmentExpression-capable grammar contexts; arithmetic/unary/comparison/logical operands deny while grouped arrow operands, nested arrows, call/array/object/conditional/assignment positions preserve their AST grouping and lexical closure ownership. F10: JS coalescing and logical families cannot mix across ungrouped binary trees; groups delimit this restriction. Pure chains and grouped combinations remain valid; C# keeps its separate rule. Meaningful parser/binder/checker positive and negative regressions are authored UNRUN.

All14 protected bytes/183roles/35families/9callers/18providers/6catalogue groups, full original143 scope and R1-R7/K2/W1-W4/B4/K bindings remain. Historical32pins/13fails/73TAP/05-07 compiler-length NO_GO, 5326closure/249ranges/59supports/7discrepancies/exact4signature failures and private/failed/recovery evidence remain. Separate managed compiled-source provenance mismatch and dependency1727 qualification failures are unchanged, never repaired by syntax work. Full selected profiles/catalogues/typed IR/CFG/proof DAG/caller migrations remain unfinished; after accepted foundation, next is managed/acquisition C# profiles and complete symbolic CLR48 closure, not inventory alone.

No target Node/npm/import/parser/helper/compiler/build/test/native/XML/MSI/ENV/ACL/crypto/extractor effects before NEW complete actual-input ROOT, DIFFERENT ENTIRE source GO and parent admission. sourceGo/execution/GA false; SupportSafety UNPROVED, runtime UNQUALIFIED, Mac DEFERRED_NOT_APPLICABLE. Push every intentional commit immediately, freeze complete cumulative candidate for DIFFERENT ENTIRE review, then STOP. No next-unit mutation, dispatch/rerun/cancel/gate weakening, reset/force/rebase/signing bypass/cleanup/provider settings/publication/promotion/deployment. Parent owns tracking/admission/landing.
## #1681 review24 F11 complete arrow production (2026-10-07)

SPEC-002 AC-4DI.4 / R3 / C3; Development SOURCE ONLY / in_progress. Parent adopted ENTIRE review24 SOURCE_NO_GO ROOT e89f7b8b3ec7da4146dc850288b0d0fe29fd93ad53d9dab7143251330773a5c1 / REPORT 9672975c3df1dee8cdad02cd551d600e170e74bb17a516e5a7571225d9975bcc. Sole fresh author25 accepts the existing clean pushed PR1681 recovery checkout at edb879f9344ded93dae26eaaf296cb78c8810d48/tree71bdc4950fd27758539f280f0b0084ba638aac3a; develop/base ce56f59245821eefd2232cdec05e2cb42bd044e4. Existing owner branch is retained under GOV-10 recovery; parent owns lifecycle/tracking/admission/landing.

F11 requires all three supported JS arrow heads to finish their AssignmentExpression production before the generic expression continuation loop. A block ConciseBody must not become an ungrouped binary left operand or ConditionalExpression test for ANY supported binary operator or conditional suffix. Preserve normal expression bodies, explicit grouped arrows, nested closures, call/array/object/conditional arms/assignment RHS, formals/capture ownership and separate C# grammar. Add meaningful parser/binder/shared-checker all-head/all-operator negative vectors and positive AST/group/capture assertions; all authored tests stay UNRUN, all57 earlier tests and protected fourteen input bytes remain unchanged.

Retain F1-F10/full original143 scope, all14 inputs/183roles/35families/9callers/18provider premises/6catalogue groups, R1-R7/K2/W1-W4/B4/source-binding contracts. All selected profiles/catalogues/typed IR/CFG/proof DAG/caller migrations remain unfinished. Original32pins/13fails/73-before-TAP/05-07/compiler-length NO_GO, 5326closure/249ranges/59supports/seven discrepancies/exact4signature failures/private/author18 recovery remain. Current managed source681340 versus recorded2f79 is a distinct UNQUALIFIED provenance mismatch; no binaries/manifests/assertions are rewritten or compiled. Old1.10 tooling1727 conditional SOURCE_GO with13fails/87skip/WindowsEBUSY8 and cancelled ConPTY remain separate failures, never acceptance.

No target Node/npm/import/parser/helper/compiler/build/test/native/XML/MSI/ENV/ACL/crypto/extractor effects before NEW complete actual-input ROOT, DIFFERENT ENTIRE SOURCE_GO and parent admission. No CI dispatch/rerun/cancel/settings/gate weakening/main/force/rebase/reset/signing bypass/cleanup/publication/promotion/deployment. Immediately push each intentional commit, freeze COMPLETE cumulative source/base/physical/index/current provider handles with all25 associations, then STOP for parent audit and DIFFERENT entire review. sourceGo/execution/GA false; SupportSafety UNPROVED, runtime UNQUALIFIED, Mac DEFERRED_NOT_APPLICABLE. Full CLI/TUI/native/operator/publication/identical-byte integration remains unfinished. After accepted foundation, managed/acquisition C# profiles and complete symbolic CLR48 closure (modern separate) are the next actual unit, not another inventory loop.
## #1681 review26 coherent F12/F13/F14 contract (2026-10-07)

SPEC-002 AC-4DI.4 / R3 / C3; Development SOURCE ONLY / in_progress. Sole author27 accepts retained PR1681 recovery checkout at clean pushed60f818a76c0e9873e0cb87c5ad42ba1c99f51eb3/tree d2c5838ad286b9a8e9d1be5df0efaa359d9ece8f, develop/base ce56f59245821eefd2232cdec05e2cb42bd044e4. Parent adopted ENTIRE review26 SOURCE_NO_GO ROOT d0aa30c527b7838de9bf1ac6668f56addc9f97c4f4da6b6c4e1f27b6ecfd0cbe / REPORT 3e62195aa380438e76689a808791bfd8b352b67ae63be7eae14421d51aa3be8f. Existing branch/PR ownership is the explicit GOV-10 recovery exception; prior authors/reviewers STOPPED.

F12 requires finite language-specific operators, unary forms, precedence and associativity: C# ?? right association, JS ?? left association, separate conditional/assignment/group boundaries; C# statement_expression categories; complete unescaped reserved keyword gates at supported binding/value/type positions with contextual identifiers preserved. Genuine unimplemented C# typeof/type and escaped identifiers explicitly deny. F13 requires nonempty unique get/set declarations before storage/initializer derivation, preserving supported auto/explicit forms, setter value owner, backing and initializer order. F14 requires finite declaration-category/owner/context modifiers before synthesized metadata, including type/field/method/property combinations, access, static/abstract/extern/virtual/override/sealed relations and body restrictions; preserve F7 constructor rules. All meaningful parser/binder/shared-checker AST/ownership regressions are authored UNRUN; earlier62 test bytes remain an unchanged prefix. Shared checker is not an independent typed kernel.

Retain F1-F11, full original143scope/all14protected inputs/183roles/35families/9callers/18providers/6catalogue groups/R1-R7/R6/K2/W1-W4/B4/K-bindings/readable H/CD/six literal W4 adapters. All selected profiles/catalogues/typedIR/CFG/proofDAG/sourceDeclOcc/SCC/substitution/ownership/caller migrations remain unfinished. Next after accepted foundation is actual managed/acquisition C# profiles plus complete symbolic CLR48 closure, modern separately conditional. Preserve original32pins/13fails/73beforeTAP/05-07/compiler-length NO_GO/5326closure249ranges59supports7discrepancies/exact4signature failures/private/unknown/author18 recovery; managed681340 vs recorded2f79 remains UNQUALIFIED compiler provenance, ancestry is not compilation. Tooling1727 13fails/87skip/WindowsEBUSY8 remains failed history. macOS DEFERRED_NOT_APPLICABLE never PASS.

No target Node/npm/import/parser/helper/compiler/build/test/native/XML/MSI/ENV/ACL/crypto/extractor effects before NEW complete actual-input ROOT, DIFFERENT ENTIRE SOURCE_GO and parent admission. No CI dispatch/rerun/cancel/settings/gate weakening/main/force/reset/rebase/cleanup/signing bypass/publication/promotion/deployment. Immediately push each intentional commit to retained branch; freeze complete cumulative packet with current/base/physical bytes, genuine blob hashes, all tracked/index/stage/patch/25associations/protected14/earlier62 preservation/provider heads/naturalCI handles. Author STOP for parent whole adoption and fresh different ENTIRE reviewer28. sourceGo/execution/native/GA false; full CLI/TUI delivery remains incomplete. Parent alone owns tracking/admission/landing.
Primary grammar for this finite repair: [C# expressions 12.4.2/12.17/12.19](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/expressions), [C# statements 13.7](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/statements), [C# lexical keywords 6.4.3](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/lexical-structure), [C# separate declaration/accessor modifier productions 15](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/classes), [ECMAScript expression productions](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html). These are grammar authorities, not execution evidence. Supported modifier sets are explicitly finite; partial/unsafe, combined accessibility and interface fields/explicit modern interface members/default method bodies remain honest unsupported denials. Bodyless abstract/extern/interface accessors have no concrete backing; concrete auto properties retain storage, set-only source shape and initializer associations. Type/expression/call validity remains separately unproved.
## #1681 review28 coherent F15-F19 and reviewed #1726 receiving integration (2026-10-08)

SPEC-002 AC-4DI.4 / R3 / C3 and native C1-C3 / R1-R4; Development SOURCE ONLY / in_progress. Sole author29 accepts the clean pushed040b9e6853bacd8858219e24f6320adb1bfe2262/tree334fe7bb532550bd77d0115fd0c49710f57bd2f2 retained PR1681 recovery owner checkout; develop/basece56f59245821eefd2232cdec05e2cb42bd044e4. Parent adopted ENTIRE review28 SOURCE_NO_GO ROOT3f9e9083ec08d63c07698276cc17b2bb9e32dc846361d2c1995ba14ace65a152. Prior authors/reviewer stopped. This requirement amendment precedes product edits.

F15 rejects concrete setter-only AUTOMATIC properties before backing/value/initializer metadata. Correct only the invalid S positive to get/set; preserve every ownership/initializer assertion and earlier regression. Keep valid explicit-body and abstract/extern/interface bodyless setter-only forms. F16 implicit constructors have DECLARED public accessibility except abstract protected; enclosing effective accessibility remains separate. F17 reject namespace type members, generic enums and using directives after members in the actual compilation/namespace owner, preserving legitimate nested types/nongeneric enums in generic owners/initial using. F18 C# CR/LF/NEL/LS/PS terminate comments and forbid raw ordinary quoted-literal newlines; retain JS dialect rules and exact original ranges. Existing C# dollar rejection is not a new defect.

F19 preserves original failed effect/result and exception separately from unresolved child issuance/closure and retirement/release failures. Known original FALSE CreateProcess means no issued child; an interop throw or TRUE with missing/invalid child evidence retains SAME invocation. Genuinely observed WAIT_OBJECT0 plus failed exit query may return SAME original failure only after all required safe original releases succeed. Unknown/failed wait, pending I/O, failed/unknown retirement/release retains SAME owner without retry or success laundering. Original observations/errors and every independently safe cleanup survive. Production selected managed .cs, actual owning guard and native prospective cases are in scope; revised original14 source associations must record intentional deltas. All32 binary/provenance pins unchanged; no compilation/repin.

SPEC-007 AC-7G also maps receiving integration of exact independently reviewed PR1727/issue1726 head0b258e16bd86b2ae4f0fd13885e6565d6460af7d, entire review03 ROOTffeda489a5b4a7ea8cc1a999752d8530dea28bfbb6fc3f639d5692ae56cfdb7a. Merge only this named source contribution normally, retain BOTH append-only governance contributions and the entire1602 lock graph except the sole official shell-quote1.11 version/resolved/integrity tuple. package.json/observer/policy/thresholds unchanged. Full qualification13fails/87skip/Windows EBUSY8 remains failed; source GO is not compatibility/native acceptance.

ALL new regressions UNRUN. Complete cumulative source/native/foundation/dependency/base/caller/gate freeze, DIFFERENT ENTIRE review and NEW complete actual-input ROOT plus parent admission precede target effects. No Node/npm/import/parser/helper/compiler/test/build/native/XML/MSI/ENV/ACL/crypto/extractor effects, CI dispatch/rerun/cancel, provider settings, force/rebase/reset/cleanup or release/publication/deployment. Push every intentional commit immediately. Parent alone owns provider tracking/review/admission/landing. Original143/all14/183roles/35families/9callers/18providers/6catalogues/R1-R7/R6K2/W1-W4B4/K-BIND/CALL/SUBSTITUTE/OWNER/readableHCD/sixW4 adapters and historical failures remain required. Full profiles/symbolic CLR48/conditional modern closure/typedIRCFGproofDAG/SCC/caller migrations remain unfinished; Mac Deferred/N/A never PASS. SourceGO/execution/native/GA false.
## #1681 review32 complete F23-F25 repair (2026-10-08)

SPEC-002 AC-4DI.4 / R3 / C3 / G1, native C1-C3 / R1-R4 and SPEC-007 AC-7G; Development SOURCE ONLY / in_progress. Sole fresh author33 accepts clean pushed7b2b08083d38605e3ea13a30a31dd5a52435943a/treeee7129e5eb048f3a487c089a8bf64533246d0b35, develop/basece56f59245821eefd2232cdec05e2cb42bd044e4 at the retained PR1681 recovery branch/worktree. ENTIRE adopted review32 ROOTdf11017e64d643567d007e97e8afc4c728746b165cfd5f3d5b567ff125c1e6aa / REPORT5bec25fd6ced43824c02ff18a03ef4c15c6d538997790b7a8d205655aed83a2e is SOURCE_NO_GO. Prior author/reviewer STOPPED; parent owns tracking/admission/landing.

F23 denies void recursively in every storage/formal/array-element/nullable-underlying/generic-argument category, reached or unused, with original source span; only legitimate bare method/accessor/constructor returns survive. F24 validates the entire fixed-parameter list and single final one-dimensional CLR48 params array: no direction/default on params, no ref/out default, no required fixed parameter after an optional fixed parameter. Selected C# in-default behavior remains admitted; modern collection-params needs a separate complete selected profile. Preserve lexical declaration/formal order, spans and legal arrays/value-nullables/generic arguments.

F25 covers ALL original managed/acquisition/MSI/trust/PowerShell owners and reached recording/publication/allocation/observer/catch/finally helpers. Set primitive unresolved/failure state BEFORE fallible recording; ordinary diagnostic allocation/Add/observer failure never replaces original primary or exits SAME nonreturning live invocation. Reserve and publish MSI handle slots BEFORE native acquisition, bind authentic returned handles immediately and retain pending original call without finally releasing dependents. Prepare retention state BEFORE unresolved ownership; retention interruptions and callbacks remain guarded once-only, no retry or observer-derived proof. Gate MSI held/database closure on actual pending state. Managed ledger allocation failure retains its unissued resource while allowing every later independently safe once-only release; original wait status/pending/result, known-false CreateProcess failure and directory WAIT_OBJECT0/failed-query SAME123 with safe closure remain. PowerShell globally rooted references AND SAME active invocation remain mandatory; errors retain original Exception objects even diagnostic formatting fails. Native pre-HeapAlloc pending result/kind/site/ordinal and nonreturning allocation-failure barrier remain unchanged. No synthetic native observer or production fault injector.

Guard changes are explicitly requirement-bound protected evidence strengthening for the actual new transitive helper shapes; retain every original assertion/test body and add mutation/positive/native-prospective obligations, all locally UNRUN. Transparent intentional selected14 deltas (managed/acquisition/MSI/trust/compiler/guard) require fresh current raw-byte/source-version associations; never claim old identities remain current. Preserve32native pins/39936 declaration, full1602lockgraph/exact shell-quote1.11 tuple/receiving both-parent and five conflict contributions, all original failures and archives. Exact7b2b source/conformance/full2072suite FAIL and Windows CANCELLED retain UNPROVEN native closure/UNATTRIBUTED cause.

Full143/all14/183roles/35families/9callers/18providers/6catalogues/R1-R7/R6K2/W1-W4B4/K-BIND/CALL/SUBSTITUTE/OWNER/HCD/sixW4 remain required; this repair is not full profiles/symbolic CLR48/typedIRCFGproofDAG/sourceDeclOcc/SCC/caller migration/native/operator/publication/identical-byte delivery. Mac Deferred/N A never PASS; B0/B2UNKNOWN, SupportSafetyUNPROVED, G1LOCAL_MINIMUM/runtimeUNQUALIFIED. NEW complete actual-input ROOT + DIFFERENT ENTIRE SOURCEGO + parent admission precede ANY target Node/npm/import/parser/helper/compiler/build/test/native/XML/MSI/ENV/ACL/crypto/extractor effect. Generic own IO/JSON/ZIP/TAR/hashes/Git/provider reads only; natural push CI only, no dispatch/rerun/cancel/settings/main/force/rebase/reset/cleanup/signing bypass/deploy/GA. Push EVERY intentional commit immediately. Freeze complete cumulative packet then STOP for different reviewer34.
### Author33 complete F23-F25 authored disposition (2026-10-08; SOURCE_UNRUN)

The coherent source bundle implements recursive bare-void-only return categories, nonnullable value-type nullable underlyings and static-class constituent exclusion; exact nested generic closing spans and mixed nullable/array suffixes; whole CLR48 fixed/final-one-dimensional-params lists with legal in-default behavior. Modern collection params still require their separately selected complete profile. Original declarations and all inherited test bodies remain required.

Managed recording stores primitive failure state before allocation, retains original primary wait/result, and shields each independently safe once-only release and environment retirement from ledger allocation failure. MSI allocates and roots output slots before actual native acquisition, binds genuine original handle/result before collection publication, retains the SAME invocation on publication or unknown-call recording failure, and gates actual finally closure on original pending ownership. Extended-error field-list allocation is inside its original acquired-resource finally. Trust/MSI prepare retention state before native ownership; shared interruption recording cannot unwind retention. PowerShell shields catch, custody, copy observation and final result observers while preserving first primary exception, original registry roots and the nonreturning original invocation. No new production fault injector, API shim, global control authority or synthetic handle is supplied.

H-current now checks these actual managed and acquisition/MSI/trust owning statement trees, pre-effect slots, callback once/completed semantics, finally enclosure and original observers. A continue statement is retained as an explicit leaf for the original MSI summary owner's finite flow; unchanged exact managed role checks still reject any unassigned ownership flow. Supplementary PowerShell assertions are textual source witnesses, not a full PowerShell frontend or native acceptance. All additive source mutations, legal positives and separately observed original native recording/publication obligations are UNRUN. Genuine external original allocation/throw fixture remains absent.

Intentional selected14 deltas are L-managed/L-acquisition/L-msi/L-trust/CE-compiler/H-current. Other eight selected inputs, protected native pins/39936 declaration, original foundation75 bodies, three F21/F22 guard bodies, both F19 settlement bodies and MCP protected acceptance remain preserved. Frozen raw cumulative/current/base/inherited/physical/index/associations/dependency/history custody and a DIFFERENT ENTIRE review plus NEW complete-input ROOT and parent admission remain prerequisites. This author does not grant SOURCE_GO, execution, native closure, publication, promotion or GA; the complete original delivery programme remains unfinished.

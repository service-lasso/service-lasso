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
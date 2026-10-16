import test from 'node:test';
import assert from 'node:assert/strict';
import { SelectedSyntax } from './helpers/core1681-selected-syntax.mjs';
import { enumerateSelectedDeclarations } from './helpers/core1681-selected-declarations.mjs';
import { SelectedTypeIndex } from './helpers/core1681-selected-type-index.mjs';
import { SelectedCSharpImports } from './helpers/core1681-selected-imports.mjs';
import { bindSelectedCsharpCompilation, rebindSelectedCompilationForProof, borrowSelectedCompilationSource } from './helpers/core1681-selected-compilation.mjs';
import { bindSelectedCsharpScalarBody } from './helpers/core1681-selected-body.mjs';
import { checkSelectedScalarBody } from './helpers/core1681-selected-body-checker.mjs';
import { SelectedMemberIndex } from './helpers/core1681-selected-members.mjs';
import { bindSelectedInvocation } from './helpers/core1681-selected-invocation.mjs';
import { bindSelectedPredefinedOperator } from './helpers/core1681-selected-predefined-operators.mjs';
import { selectCsharpOverload, csharpInvocationForm, selectCsharpInvocationForms } from './helpers/core1681-selected-overloads.mjs';
import { createProofCounter, canonicalData, foldBitvectorComparison, K2_LIMITS } from './helpers/core1681-proof-terms.mjs';
import { checkedOriginalLiteral } from './helpers/core1681-selected-literals.mjs';
import { SelectedCScanner } from './helpers/core1681-selected-c-preprocessor.mjs';
import { SelectedCSyntax } from './helpers/core1681-selected-c-syntax.mjs';
import { isSourceDenialCode } from './helpers/core1681-source-input.mjs';
import { copySelectedCTypeObservation, resolveSelectedCSourceHead } from './helpers/core1681-selected-c-types.mjs';

const symbolicFixture = `namespace System {
 public class Object { public bool Equals(object value) { return false; } }
 public class ValueType : Object {} public class Enum : ValueType {}
 public class MulticastDelegate : Object {}
 public struct Int32 {} public struct Double {} public struct Void {}
 public struct Boolean {} public struct UInt32 {} public struct Int64 {} public struct UInt64 {}
 public struct SByte {} public struct Byte {} public struct Int16 {} public struct UInt16 {} public struct Char {}
 public struct Single {} public struct Decimal {} public class String : Object {}
}`;

test('finite proof counters keep their once-acquired limits after public mutation', () => {
  const limits = { ...K2_LIMITS, maxInvariantSteps: 1 };
  const counter = createProofCounter(limits);
  limits.maxInvariantSteps = K2_LIMITS.maxInvariantSteps;
  counter.charge('maxInvariantSteps', 'first');
  assert.throws(() => counter.charge('maxInvariantSteps', 'second'), /EXHAUSTED/);
  assert.equal(counter.snapshot().maxInvariantSteps, 1);
  const reads = new Map(), original = { ...K2_LIMITS, maxTokens: 0 };
  const proxied = new Proxy(original, {
    get() { throw 'unexpected public limit get'; },
    getOwnPropertyDescriptor(target, key) {
      reads.set(key, (reads.get(key) ?? 0) + 1);
      assert.equal(reads.get(key), 1);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const zero = createProofCounter(proxied);
  original.maxTokens = K2_LIMITS.maxTokens;
  assert.throws(() => zero.charge('maxTokens', 'zero-cap'), /EXHAUSTED/);
  assert.equal(zero.snapshot().maxTokens, 0);
  assert.equal(reads.size, Object.keys(K2_LIMITS).length);
});

test('private proof rebind reuses only its same-counter snapshot while public aliases stay independent', () => {
  const raw = Buffer.from('class C { int F() { return 1; } }', 'utf8');
  const extent = raw.length + Buffer.byteLength(symbolicFixture), counter = createProofCounter();
  const compilation = bindSelectedCsharpCompilation([
    { unit: 'private-rebind.cs', compilation: 'private-rebind', role: 'source', rawBytes: raw },
    { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture) },
  ], counter);
  raw.fill(0);
  compilation.decodedUnits.get('private-rebind.cs').raw.fill(0);
  compilation.enumeration.find(row => row.syntax.kind === 'method').syntax.name.spelling = 'public-mutated-F';
  const before = counter.snapshot().maxInvariantSteps;
  const rebound = rebindSelectedCompilationForProof(compilation, counter);
  const borrowSteps = counter.snapshot().maxInvariantSteps - before;
  assert.ok(rebound.enumeration.some(row => row.syntax.kind === 'method' && row.syntax.name.spelling === 'F'));
  const independentCounter = createProofCounter();
  const copied = rebindSelectedCompilationForProof(compilation, independentCounter);
  assert.equal(independentCounter.snapshot().maxInvariantSteps - borrowSteps, extent);
  assert.notEqual(copied.decodedUnits.get('private-rebind.cs').raw, rebound.decodedUnits.get('private-rebind.cs').raw);
  rebound.decodedUnits.get('private-rebind.cs').raw.fill(0);
  rebound.enumeration.find(row => row.syntax.kind === 'method').syntax.name.spelling = 'public-mutated-again';
  const again = rebindSelectedCompilationForProof(rebound, counter);
  assert.ok(again.enumeration.some(row => row.syntax.kind === 'method' && row.syntax.name.spelling === 'F'));
  assert.throws(() => borrowSelectedCompilationSource({}, counter), /INVALID_BINDING/);
});

test('actual compilation consumes each own-data source value once without Proxy get or iterator substitution', () => {
  const descriptors = new Map();
  const opaque = { actual: 'unexpected public get' };
  const original = { unit: 'once.cs', compilation: 'actual-once', role: 'source', rawBytes: Buffer.from('class C { int F() { return 1; } }') };
  const source = new Proxy(original, {
    get() { throw opaque; },
    getOwnPropertyDescriptor(target, key) {
      descriptors.set(key, (descriptors.get(key) ?? 0) + 1);
      assert.equal(descriptors.get(key), 1);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const roster = new Proxy([source,
    { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture) }], { get() { throw opaque; } });
  const compilation = bindSelectedCsharpCompilation(roster, createProofCounter());
  assert.equal(compilation.originals[0].unit, 'once.cs');
  assert.deepEqual([...descriptors.keys()], ['unit', 'compilation', 'role', 'rawBytes']);
  assert.equal(compilation.sourceAdmission, false);
  for (const thrown of [undefined, 17, opaque]) {
    const failing = new Proxy(original, { getOwnPropertyDescriptor() { throw thrown; } });
    let caught = false;
    try { bindSelectedCsharpCompilation([failing], createProofCounter()); }
    catch (actual) { caught = true; assert.equal(actual, thrown); }
    assert.equal(caught, true);
  }
});

test('actual compilation frontend borrow keeps public decoded and original input mutations outside proof bytes', () => {
  const rawBytes = Buffer.from('class C { int F() { return 1; } }');
  const counter = createProofCounter();
  const compilation = bindSelectedCsharpCompilation([
    { unit: 'private.cs', compilation: 'actual-private-copy', role: 'source', rawBytes },
    { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture) },
  ], counter);
  rawBytes.fill(0);
  compilation.originals[0].parser.scanner.decoded.raw.fill(0);
  compilation.originals[0].root.declarations.length = 0;
  const rebound = rebindSelectedCompilationForProof(compilation, counter);
  assert.equal(rebound.enumeration.some(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F'), true);
  assert.equal(rebound.sourceAdmission, false);
  assert.throws(() => borrowSelectedCompilationSource(Object.freeze({}), counter), /INVALID_BINDING/);
});

test('actual C tag references retain lexical identities and partial completion originals', () => {
  const parser = new SelectedCSyntax(Buffer.from('struct S; struct S { struct S *next; }; struct S *root; int f(void) { struct S; struct S *local; } struct S *after;'), createProofCounter(), new Set());
  const unit = parser.cUnit(), outer = unit.declarations[0].specifiers.aggregates[0].tagOriginal;
  const definition = unit.declarations[1].specifiers.aggregates[0];
  assert.equal(definition.tagOriginal, outer); assert.equal(outer.definition, definition); assert.equal(outer.complete, true);
  assert.equal(definition.members[0].declarations[0].sourceType.element.tagOriginal, outer);
  assert.equal(unit.declarations[2].declarations[0].sourceType.element.tagOriginal, outer);
  const body = unit.declarations[3].body, inner = body.statements[0].specifiers.aggregates[0].tagOriginal;
  assert.notEqual(inner, outer); assert.equal(body.statements[1].declarations[0].sourceType.element.tagOriginal, inner);
  assert.equal(unit.declarations[4].declarations[0].sourceType.element.tagOriginal, outer);
  assert.equal(outer.nativeAuthority, false);
  const prototype = new SelectedCSyntax(Buffer.from('int f(struct P *p); struct P *q;'), createProofCounter(), new Set()).cUnit();
  assert.notEqual(prototype.declarations[0].declarations[0].sourceType.parameters[0].sourceType.element.tagOriginal,
    prototype.declarations[1].declarations[0].sourceType.element.tagOriginal);
  const definitionScope = new SelectedCSyntax(Buffer.from('struct S { int outer; }; int f(struct S { int inner; } p, int (*cb)(struct N *n)) { struct S q; struct N *local; return 0; }'), createProofCounter(), new Set()).cUnit();
  const fn = definitionScope.declarations[1], parameterTag = fn.sourceType.parameters[0].sourceType.tagOriginal;
  assert.notEqual(parameterTag, definitionScope.declarations[0].specifiers.aggregates[0].tagOriginal);
  assert.equal(fn.body.statements[0].declarations[0].sourceType.tagOriginal, parameterTag);
  assert.notEqual(fn.sourceType.parameters[1].sourceType.element.parameters[0].sourceType.element.tagOriginal,
    fn.body.statements[1].declarations[0].sourceType.element.tagOriginal);
  for (const source of ['struct S {}; struct S {};', 'union S {}; struct S *p;', 'struct S { int broken( ; };']) {
    const failed = new SelectedCSyntax(Buffer.from(source), createProofCounter(), new Set());
    assert.throws(() => failed.cUnit());
    assert.ok(failed.tagOriginals.length > 0);
  }
});

test('actual C aggregate bit-fields retain original width syntax without native layout', () => {
  const parser = new SelectedCSyntax(Buffer.from('struct Flags { unsigned a:1, :0, b:(2+1); int plain; };'), createProofCounter(), new Set());
  const aggregate = parser.cUnit().declarations[0].specifiers.aggregates[0];
  const fields = aggregate.members[0].declarations;
  assert.equal(fields.length, 3); assert.equal(fields[0].name.spelling, 'a'); assert.equal(fields[1].name, null);
  assert.equal(fields[0].bitWidth.kind, 'literal'); assert.equal(fields[1].bitWidth.kind, 'literal');
  assert.equal(fields[2].bitWidth.kind, 'group');
  assert.equal(aggregate.members[1].declarations[0].bitWidth, null);
  assert.equal(fields[0].sourceType.nativeTypeOriginal, null);
  for (const source of ['int a:1;', 'struct S { unsigned a:1=0; };', 'struct S { unsigned :; };']) {
    const failed = new SelectedCSyntax(Buffer.from(source), createProofCounter(), new Set());
    assert.throws(() => failed.cUnit());
    if (failed.tagOriginals.length) assert.equal(failed.tagOriginals[0].failed, true);
  }
});

test('actual C enumerator names retain declaration order and original initializer references', () => {
  const parser = new SelectedCSyntax(Buffer.from('enum E { A=1, B=A+2, C }; int f(void) { int A=7; enum Inner { A=A+1, D=A }; return D; }'), createProofCounter(), new Set());
  // Same-scope ordinary A conflicts even though its original is visible while
  // parsing the defining enumerator's initializer.
  assert.throws(() => parser.cUnit());
  assert.equal(parser.tagOriginals[1].pendingEnumeratorOriginal.valueOriginal.left.bindingOriginal.name.spelling, 'A');
  const accepted = new SelectedCSyntax(Buffer.from('int A; int f(void) { enum E { A=A+1, B=A, C }; return C; }'), createProofCounter(), new Set()).cUnit();
  const fn = accepted.declarations[1], members = fn.body.statements[0].specifiers.aggregates[0].members;
  assert.equal(members[0].value.left.bindingOriginal, accepted.declarations[0].declarations[0].bindingOriginal);
  assert.equal(members[1].value.bindingOriginal, members[0].bindingOriginal);
  assert.equal(members[2].bindingOriginal.previousOriginal, members[1].bindingOriginal);
  assert.equal(fn.body.statements[1].value.bindingOriginal, members[2].bindingOriginal);
});

test('actual C source object completeness preserves pointers and forward prototypes', () => {
  for (const source of ['typedef void V; V value;', 'struct S { void value; };', 'struct S { int fn(void); };',
    'struct S { struct S value; };', 'struct S; struct S values[2];', 'struct S; int f(struct S value) { return 0; }',
    'struct S; struct S f(void) { return 0; }']) {
    const parser = new SelectedCSyntax(Buffer.from(source), createProofCounter(), new Set());
    assert.throws(() => parser.cUnit(), error => error.code === 'INVALID_SYNTAX');
  }
  const parser = new SelectedCSyntax(Buffer.from('struct S; struct S f(struct S value); struct S tentative; struct S { struct S *next; }; void good(struct S *p) {}'), createProofCounter(), new Set());
  const unit = parser.cUnit();
  assert.equal(unit.declarations.at(-1).definitionCompletenessOriginal.returned, true);
  assert.deepEqual(unit.declarations.at(-1).definitionCompletenessOriginal.parameterResults, [true]);
  assert.equal(unit.declarations[2].declarations[0].sourceType.tagOriginal.complete, true);
});

test('actual C declarations retain canonical scalar source forms without target authority', () => {
  const cases = [['unsigned long long int', 'longLong', 'unsigned'], ['long unsigned', 'long', 'unsigned'],
    ['short signed int', 'short', 'signed'], ['char', 'char', 'targetChar'], ['signed char', 'char', 'signed'],
    ['float', 'float', null], ['long double', 'longDouble', null], ['unsigned __int64', 'longLong', 'unsigned'],
    ['__int8', 'char', 'targetChar'], ['_int16', 'short', 'signed']];
  for (const [spelling, base, signedness] of cases) {
    const parser = new SelectedCSyntax(Buffer.from(`${spelling} value;`), createProofCounter(), new Set());
    const unit = parser.cUnit(), scalar = unit.declarations[0].specifiers.scalar;
    assert.equal(scalar.base, base); assert.equal(scalar.signedness, signedness);
    assert.deepEqual(scalar.originalSpecifiers, spelling.split(' '));
    assert.equal(scalar.nativeTypeOriginal, null); assert.equal(scalar.sourceAdmission, false);
    assert.equal(scalar.requiresExtensions, spelling.includes('_int'));
  }
  for (const spelling of ['signed unsigned int', 'long short', 'int int', 'long long long', 'unsigned float',
    'long long double', 'char int', '__int64 long', 'unsigned unsigned', 'wchar_t int', 'struct S int']) {
    assert.throws(() => new SelectedCSyntax(Buffer.from(`${spelling} value;`), createProofCounter(), new Set()).cUnit());
  }
});

test('actual C function declarators distinguish prototypes, void and variadic originals', () => {
  for (const [source, prototype, count, voidMarker, variadic] of [
    ['int f();', 'unspecified', 0, false, false], ['int f(void);', 'prototype', 0, true, false],
    ['int f(int);', 'prototype', 1, false, false], ['int f(int value, ...);', 'prototype', 1, false, true],
    ['int f(void *value);', 'prototype', 1, false, false],
    ['int f(const void (*value));', 'prototype', 1, false, false],
    ['int f(void (*callback)(void));', 'prototype', 1, false, false]]) {
    const parser = new SelectedCSyntax(Buffer.from(source), createProofCounter(), new Set()), root = parser.cUnit();
    const layer = root.declarations[0].declarations[0].declarator.suffixes[0];
    assert.equal(layer.prototype, prototype); assert.equal(layer.parameters.length, count);
    assert.equal(layer.voidMarker !== null, voidMarker); assert.equal(layer.ellipsis !== null, variadic);
    if (layer.ellipsis) assert.equal(source.slice(...layer.ellipsis.origin.utf16), '...');
    if (layer.voidMarker) assert.equal(source.slice(...layer.voidMarker.origin.utf16), 'void');
  }
  for (const source of ['int f(...);', 'int f(int x ...);', 'int f(int x, ..., int y);', 'int f(void, ...);',
    'int f(void value);', 'int f(void (x));', 'int f(const void (x));',
    'int f(int) { return 1; }', 'int f(int x, int x) { return x; }'])
    assert.throws(() => new SelectedCSyntax(Buffer.from(source), createProofCounter(), new Set()).cUnit());
  const parser = new SelectedCSyntax(Buffer.from('int f(int x, ...) { return x; }'), createProofCounter(), new Set());
  assert.equal(parser.cUnit().declarations[0].kind, 'cFunction');
});

test('actual C control edges bind nearest switch and loop original targets', () => {
  const counter = createProofCounter();
  const parser = new SelectedCSyntax(Buffer.from('int f(int x) { while(x) { switch(x) { case 1: continue; default: break; } break; } return x; }'), counter, new Set());
  const root = parser.cUnit(), loop = root.declarations[0].body.statements[0], branch = loop.body.statements[0];
  const caseNode = branch.body.statements[0], defaultNode = branch.body.statements[1];
  assert.equal(caseNode.targetOriginal, branch.targetOriginal);
  assert.equal(defaultNode.targetOriginal, branch.targetOriginal);
  assert.equal(caseNode.statement.targetOriginal, loop.targetOriginal);
  assert.equal(defaultNode.statement.targetOriginal, branch.targetOriginal);
  assert.equal(loop.body.statements[1].targetOriginal, loop.targetOriginal);
  assert.equal(loop.targetOriginal.body, loop.body);
  assert.equal(branch.targetOriginal.body, branch.body);
  assert.equal(parser.controls.length, 0);
  enumerateSelectedDeclarations(root, 'actual-C-controls', 'c', counter);
  const broken = new SelectedCSyntax(Buffer.from('int f(int x) { while(x) { continue } }'), createProofCounter(), new Set());
  let original; try { broken.cUnit(); } catch (failure) { original = failure; }
  assert.notEqual(original, undefined);
  assert.equal(broken.pendingControlTarget.originalFailure, original);
  assert.equal(broken.pendingControlTarget.failed, true);
  assert.equal(broken.controls.length, 0);
});

test('actual C body references retain nearest original parameter, storage and function bindings', () => {
  const parser = new SelectedCSyntax(Buffer.from('int x; int f(int x) { int y=x; { int x=y; y=x; } return f(y); }'), createProofCounter(), new Set());
  const root = parser.cUnit(), global = root.declarations[0].declarations[0], fn = root.declarations[1];
  const parameter = fn.sourceType.parameters[0], local = fn.body.statements[0].declarations[0];
  assert.equal(local.initializer.bindingOriginal, parameter.bindingOriginal);
  assert.notEqual(local.initializer.bindingOriginal, global.bindingOriginal);
  const nested = fn.body.statements[1], shadow = nested.statements[0].declarations[0];
  assert.equal(shadow.initializer.bindingOriginal, local.bindingOriginal);
  assert.equal(nested.statements[1].expression.right.bindingOriginal, shadow.bindingOriginal);
  assert.equal(fn.body.statements[2].value.target.bindingOriginal, fn.bindingOriginal);
  assert.equal(fn.body.statements[2].value.arguments[0].bindingOriginal, local.bindingOriginal);
  assert.equal(parameter.bindingOriginal.parameterType, parameter.parameterType);
  assert.equal(parser.typedefScopes.length, 1);
  const external = new SelectedCSyntax(Buffer.from('int f(void) { return External(); }'), createProofCounter(), new Set());
  assert.equal(external.cUnit().declarations[0].body.statements[0].value.target.bindingOriginal, null);
});

test('actual C source aliases participate in declarator constraints and parameter adjustment', () => {
  for (const source of ['typedef void V; int f(V x);', 'typedef int A[3]; A f(void);',
    'typedef int F(void); F a[2];', 'typedef int F(void); const F value;']) {
    assert.throws(() => new SelectedCSyntax(Buffer.from(source), createProofCounter(), new Set()).cUnit());
  }
  const counter = createProofCounter();
  const parser = new SelectedCSyntax(Buffer.from('typedef int A[3]; typedef A B; int f(const B a);'), counter, new Set());
  const root = parser.cUnit(), parameter = root.declarations[2].declarations[0].sourceType.parameters[0];
  assert.equal(parameter.sourceType.kind, 'cTypedefSourceType');
  assert.equal(parameter.parameterType.kind, 'cPointerSourceType');
  assert.equal(parameter.parameterType.element.kind, 'cQualifiedSourceType');
  assert.equal(parameter.parameterType.element.qualifiers[0].spelling, 'const');
  assert.equal(resolveSelectedCSourceHead(parameter.parameterType.element, counter).base, 'int');
  assert.equal(resolveSelectedCSourceHead(parameter.sourceType, counter).boundOriginal,
    root.declarations[0].declarations[0].sourceType.boundOriginal);
  assert.equal(parameter.parameterType.nativeTypeOriginal, null);
});

test('actual C prototype names shadow typedefs and nested prototypes do not leak', () => {
  for (const source of ['typedef int T; int f(int T, T x);',
    'typedef int T; int f(int (*callback)(int T, T x));', 'int f(int x, int x);']) {
    const parser = new SelectedCSyntax(Buffer.from(source), createProofCounter(), new Set());
    let original; try { parser.cUnit(); } catch (failure) { original = failure; }
    assert.notEqual(original, undefined);
    assert.equal(parser.typedefScopes.length, 1);
    assert.ok(parser.parameterScopeOriginals.some(scope => scope.failed && scope.originalFailure === original));
  }
  const parser = new SelectedCSyntax(Buffer.from('typedef int T; int f(int (*callback)(int T), T x); T after;'), createProofCounter(), new Set());
  const root = parser.cUnit(), original = root.declarations[0].declarations[0].typedefBinding;
  const functionType = root.declarations[1].declarations[0].sourceType;
  assert.equal(functionType.parameters[1].specifiers.typedefOriginal, original);
  assert.equal(root.declarations[2].declarations[0].specifiers.typedefOriginal, original);
  assert.equal(parser.typedefScopes.length, 1);
  const grouped = new SelectedCSyntax(Buffer.from('typedef int T; int (*f(int T))[sizeof(T)]; T after;'), createProofCounter(), new Set());
  const groupedRoot = grouped.cUnit();
  const bound = groupedRoot.declarations[1].declarations[0].sourceType.result.element.boundOriginal;
  assert.equal(bound.kind, 'cSizeofExpression');
  assert.equal(groupedRoot.declarations[2].declarations[0].specifiers.typedefOriginal,
    groupedRoot.declarations[0].declarations[0].typedefBinding);
});

test('actual C function label graph binds forward and nested statement targets', () => {
  const counter = createProofCounter();
  const parser = new SelectedCSyntax(Buffer.from('int f(int x) { goto done; while(x) { inner: x--; } done: return x; }'), counter, new Set());
  const root = parser.cUnit(), graph = root.declarations[0].labelGraph;
  assert.equal(graph.returned, true); assert.equal(graph.labels.size, 2);
  assert.equal(graph.gotos[0].target, graph.labels.get('done'));
  const enumeration = enumerateSelectedDeclarations(root, 'actual-C-labels', 'c', counter);
  assert.equal(enumeration.entries.filter(entry => entry.syntax.kind === 'cLabel').length, 2);
  const separate = new SelectedCSyntax(Buffer.from('typedef int T; int f(void) { goto T; T: return 0; } T after;'), createProofCounter(), new Set());
  const separateRoot = separate.cUnit(), separateGraph = separateRoot.declarations[1].labelGraph;
  assert.equal(separateGraph.gotos[0].target, separateGraph.labels.get('T'));
  assert.equal(separateRoot.declarations[2].declarations[0].specifiers.typedefOriginal,
    separateRoot.declarations[0].declarations[0].typedefBinding);
  const switched = new SelectedCSyntax(Buffer.from('int f(int x) { switch(x) { default: goto done; } done: return x; }'), createProofCounter(), new Set());
  const switchedGraph = switched.cUnit().declarations[0].labelGraph;
  assert.equal(switchedGraph.gotos[0].target, switchedGraph.labels.get('done'));
  for (const source of ['int f(void) { goto missing; }', 'int f(void) { same: ; same: return 0; }',
    'int f(void) { goto other; } int g(void) { other: return 0; }']) {
    const broken = new SelectedCSyntax(Buffer.from(source), createProofCounter(), new Set());
    let original; try { broken.cUnit(); } catch (failure) { original = failure; }
    assert.notEqual(original, undefined);
    assert.equal(broken.pendingLabelGraph.failed, true);
    assert.equal(broken.pendingLabelGraph.original, original);
  }
});

test('actual C typedef references retain lexical originals while supplied names stay unresolved', () => {
  const parser = new SelectedCSyntax(Buffer.from('typedef unsigned long T; T value; int f(int T) { return T; }'), createProofCounter(), new Set());
  const root = parser.cUnit(), definition = root.declarations[0].declarations[0];
  const reference = root.declarations[1].declarations[0];
  assert.equal(reference.specifiers.typedefOriginal.sourceType, definition.sourceType);
  assert.equal(reference.specifiers.typedefOriginal, definition.typedefBinding);
  assert.equal(Object.isFrozen(definition.typedefBinding), true);
  assert.equal(reference.specifiers.typedefOriginal.declarator, definition.declarator);
  assert.equal(reference.sourceType.typedefOriginal, reference.specifiers.typedefOriginal);
  assert.equal(reference.sourceType.nativeTypeOriginal, null);
  assert.equal(root.declarations[2].body.statements[0].value.kind, 'name');
  const supplied = new SelectedCSyntax(Buffer.from('External value;'), createProofCounter(), new Set(['External']));
  const unresolved = supplied.cUnit().declarations[0].declarations[0];
  assert.equal(unresolved.specifiers.typedefOriginal, null);
  assert.equal(unresolved.sourceType.typedefOriginal, null);
});

test('actual C body type names retain composed original types before operand parsing', () => {
  const parser = new SelectedCSyntax(Buffer.from('int f(int x) { return sizeof(int (*)[3]) + (unsigned long)x; }'), createProofCounter(), new Set());
  const expression = parser.cUnit().declarations[0].body.statements[0].value;
  assert.equal(expression.left.kind, 'cSizeofType');
  assert.equal(expression.left.sourceType.kind, 'cPointerSourceType');
  assert.equal(expression.left.sourceType.element.kind, 'cArraySourceType');
  assert.equal(expression.right.kind, 'cCast');
  assert.equal(expression.right.sourceType.base, 'long');
  assert.equal(expression.right.sourceType.signedness, 'unsigned');
  assert.equal(expression.right.sourceType.nativeTypeOriginal, null);
  const broken = new SelectedCSyntax(Buffer.from('int f(int x) { return (int ()[3])x; }'), createProofCounter(), new Set());
  let original;
  try { broken.cUnit(); } catch (failure) { original = failure; }
  assert.notEqual(original, undefined);
  const retained = copySelectedCTypeObservation(broken.pendingSourceTypeDerivation);
  assert.equal(retained.failed, true); assert.equal(retained.original, original);
});

test('actual C parameters retain declared types and adjust only outer arrays or functions', () => {
  for (const [source, declaredKind, elementKind, adjustment] of [
    ['int f(int a[3][4]);', 'cArraySourceType', 'cArraySourceType', 'arrayParameter'],
    ['int f(int callback(void));', 'cFunctionSourceType', 'cFunctionSourceType', 'functionParameter'],
    ['int f(int *a[3]);', 'cArraySourceType', 'cPointerSourceType', 'arrayParameter']]) {
    const parser = new SelectedCSyntax(Buffer.from(source), createProofCounter(), new Set());
    const parameter = parser.cUnit().declarations[0].declarations[0].sourceType.parameters[0];
    assert.equal(parameter.sourceType.kind, declaredKind);
    assert.equal(parameter.parameterType.kind, 'cPointerSourceType');
    assert.equal(parameter.parameterType.element.kind, elementKind);
    assert.equal(parameter.parameterType.declaredType, parameter.sourceType);
    assert.equal(parameter.parameterType.adjustment, adjustment);
    assert.equal(parameter.parameterType.nativeTypeOriginal, null);
    assert.equal(parameter.parameterType.sourceAdmission, false);
    if (adjustment === 'arrayParameter') assert.equal(parameter.parameterType.element, parameter.sourceType.element);
    else assert.equal(parameter.parameterType.element, parameter.sourceType);
  }
  const parser = new SelectedCSyntax(Buffer.from('int f(char c, int (*a)[4]);'), createProofCounter(), new Set());
  const parameters = parser.cUnit().declarations[0].declarations[0].sourceType.parameters;
  for (const parameter of parameters) assert.equal(parameter.parameterType, parameter.sourceType);
  assert.equal(parameters[0].parameterType.base, 'char');
});

test('actual C declarator precedence composes source types without native layout claims', () => {
  const cases = [['int *f(void);', ['cFunctionSourceType', 'cPointerSourceType', 'cScalarSourceType']],
    ['int (*f)(void);', ['cPointerSourceType', 'cFunctionSourceType', 'cScalarSourceType']],
    ['int *a[3];', ['cArraySourceType', 'cPointerSourceType', 'cScalarSourceType']],
    ['int (*a)[3];', ['cPointerSourceType', 'cArraySourceType', 'cScalarSourceType']],
    ['int (*a[3])(void);', ['cArraySourceType', 'cPointerSourceType', 'cFunctionSourceType', 'cScalarSourceType']]];
  for (const [source, expected] of cases) {
    const parser = new SelectedCSyntax(Buffer.from(source), createProofCounter(), new Set());
    let type = parser.cUnit().declarations[0].declarations[0].sourceType;
    for (const kind of expected) {
      assert.equal(type.kind, kind); assert.equal(type.nativeTypeOriginal, null); assert.equal(type.sourceAdmission, false);
      type = type.element ?? type.result;
    }
    assert.equal(type, undefined);
  }
  for (const source of ['int f(void)[3];', 'int f(void)(void);', 'int a[3](void);', 'void a[3];', 'int x { return 1; }'])
    assert.throws(() => new SelectedCSyntax(Buffer.from(source), createProofCounter(), new Set()).cUnit());
  const parser = new SelectedCSyntax(Buffer.from('int ((f(int x))) { return x; }'), createProofCounter(), new Set());
  assert.equal(parser.cUnit().declarations[0].sourceType.parameters[0].declarator.direct.name.spelling, 'x');
  const broken = new SelectedCSyntax(Buffer.from('int *f(void)[3];'), createProofCounter(), new Set());
  let failure;
  try { broken.cUnit(); } catch (original) { failure = original; }
  assert.notEqual(failure, undefined);
  const retained = copySelectedCTypeObservation(broken.pendingSourceTypeDerivation);
  assert.equal(retained.failed, true); assert.equal(retained.original, failure);
  assert.equal(retained.nodes.filter(row => row.returned).length >= 2, true);
});

test('actual C abstract function declarators preserve suffix binding and original prototypes', () => {
  for (const [source, path] of [
    ['int f(int *());', ['cFunctionSourceType', 'cPointerSourceType', 'cScalarSourceType']],
    ['int f(int (*)(void));', ['cPointerSourceType', 'cFunctionSourceType', 'cScalarSourceType']],
    ['int f(int (int));', ['cFunctionSourceType', 'cScalarSourceType']],
    ['int f(int (*)[3]);', ['cPointerSourceType', 'cArraySourceType', 'cScalarSourceType']]]) {
    const parser = new SelectedCSyntax(Buffer.from(source), createProofCounter(), new Set());
    const fn = parser.cUnit().declarations[0].declarations[0].sourceType;
    let type = fn.parameters[0].sourceType;
    for (const kind of path) {
      assert.equal(type.kind, kind); assert.equal(type.nativeTypeOriginal, null);
      type = type.element ?? type.result;
    }
    assert.equal(type, undefined);
  }
});
import { implicitCsharpConversion } from './helpers/core1681-selected-conversions.mjs';
import { exactKeys } from './helpers/core1681-source-input.mjs';

// Source-only language fixtures, not admitted product CLR/native catalogues.
// Every declaration identity is enumerated from these original fixture bytes.
test('closed source/proof record keys reject accessors and hidden or symbol members before value reads', () => {
  let reads = 0;
  const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { reads++; return 0; } });
  assert.throws(() => exactKeys(accessor, ['value'], 'fixture'));
  assert.equal(reads, 0);
  const hidden = Object.defineProperty({ value: 0 }, 'extra', { value: 1 });
  assert.throws(() => exactKeys(hidden, ['value'], 'fixture'));
  const symbol = { value: 0, [Symbol('extra')]: 1 };
  assert.throws(() => exactKeys(symbol, ['value'], 'fixture'));
  const counter = createProofCounter();
  assert.throws(() => counter.charge('toString', 'foreign-key'));
  let keyReads = 0;
  assert.throws(() => counter.charge({ toString() { keyReads++; return 'maxProofNodes'; } }, 'foreign-key'));
  assert.equal(keyReads, 0);
});



test('original cast disambiguation follows grammar before identifier type lookup', () => {
  for (const [expression, expected] of [
    ['(Unknown)value', 'cast'], ['(IntPtr)value', 'cast'],
    ['(x)-y', 'binary'], ['(int)-y', 'cast'], ['(x)(-y)', 'cast'],
    ['(Unknown<int>)-y', 'cast'],
    ["(System.Int32)'a'", 'cast'], ["(I)'a'", 'cast'],
    ['(value)+y', 'binary'], ['(value)', 'group'],
  ]) {
    const counter = createProofCounter();
    const original = new SelectedSyntax(Buffer.from(
      `class x {} class C { int F(int value, int y) { return ${expression}; } }`, 'utf8'),
    'csharp', counter).csharpUnit();
    const entries = enumerateSelectedDeclarations(original, 'cast-grammar.cs', 'csharp', counter).entries;
    const method = entries.find(entry => entry.syntax.kind === 'method');
    const value = method.syntax.body.statements[0].value;
    assert.equal(value.kind, expected);
    if (expression === '(x)-y') assert.equal(value.left.kind, 'group');
    if (expression === '(int)-y') assert.equal(value.operand.kind, 'unary');
  }
});

test('qualified and imported Int32 casts bind actual char literals through existing scalar integral transfer', () => {
  for (const [prefix, target] of [['', 'System.Int32'], ['using I = System.Int32; ', 'I']]) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'char-cast.cs', compilation: 'original-char-cast', role: 'source', rawBytes: Buffer.from(
        `${prefix}class C { int F() { unchecked { return (${target})'a'; } } }`, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    const casts = body.nodes.filter(node => node.operation === 'explicitCast');
    assert.equal(casts.length, 1);
    assert.deepEqual(casts[0].conversion, { kind: 'explicitIntegral', source: 'char', target: 'int', checkedContext: false });
    assert.equal(checkSelectedScalarBody(compilation, body, counter).sourceAdmission, false);
  }
});

test('escaped primitive spelling retains original identifier identity', () => {
  const fixture = bindFixture('class @int {} class C { @int escaped; int primitive; }');
  const fields = fixture.enumeration.filter(entry => entry.syntax.kind === 'field');
  const escaped = fields.find(entry => entry.syntax.name.spelling === 'escaped');
  const primitive = fields.find(entry => entry.syntax.name.spelling === 'primitive');
  assert.equal(escaped.syntax.type.segments[0].name.escapedIdentifier, true);
  assert.equal(primitive.syntax.type.segments[0].name.escapedIdentifier, undefined);
  const rows = fixture.bound.storageMetadata;
  assert.deepEqual(rows.get(canonicalData(escaped.declId)).type.declaration, fixture.type('int').declaration);
  assert.equal(rows.get(canonicalData(primitive.declId)).type.category, 'primitive');
});

test('original uninitialized scalar declarations allocate locations without inventing assigned values', () => {
  const bind = statements => {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'declaration.cs', compilation: 'original-declaration', role: 'source', rawBytes: Buffer.from(
        `class C { int F(int input) { unchecked { ${statements} } } }`, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const environment = { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] };
    return { compilation, counter, body: () => bindSelectedCsharpScalarBody(compilation, method.declId, environment) };
  };
  const fixture = bind('int first; int second = input; first = second; int unused; return first;');
  const body = fixture.body();
  assert.equal(body.nodes.filter(node => node.operation === 'declare').length, 2);
  assert.equal(body.locations.at(-1).defined, false);
  assert.equal(Object.hasOwn(body.locations.at(-1), 'term'), false);
  assert.equal(checkSelectedScalarBody(fixture.compilation, body, fixture.counter).sourceAdmission, false);
  const invented = structuredClone(body);
  const declaration = invented.nodes.find(node => node.operation === 'declare');
  declaration.term = { kind: 'Constant', sort: { kind: 'BV', width: 32, signed: true }, value: '0' };
  assert.throws(() => checkSelectedScalarBody(fixture.compilation, invented, fixture.counter));
  const omitted = structuredClone(body);
  omitted.nodes.splice(omitted.nodes.findIndex(node => node.operation === 'declare'), 1);
  assert.throws(() => checkSelectedScalarBody(fixture.compilation, omitted, fixture.counter));
  assert.throws(() => bind('int first; return first;').body());
});

test('only original integral constant locals supply constant-expression conversions', () => {
  const bind = statements => {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'constant-local.cs', compilation: 'original-constant-local', role: 'source', rawBytes: Buffer.from(
        `class C { uint F(uint input) { unchecked { ${statements} } } }`, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const environment = { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] };
    return { compilation, counter, body: () => bindSelectedCsharpScalarBody(compilation, method.declId, environment) };
  };
  const original = bind('const int first = 1; const int second = first + 1; return input + second;');
  const body = original.body();
  assert.equal(body.nodes.findLast(node => node.operation === 'numeric').type.name, 'uint');
  assert.equal(checkSelectedScalarBody(original.compilation, body, original.counter).sourceAdmission, false);
  assert.throws(() => bind('const int first = 1; first = 2; return input;').body());
  assert.throws(() => bind('int first = 1; const int second = first; return input;').body());
});

test('C LLP64 header integer literals retain MSVC i64 suffix semantics and source provenance', () => {
  for (const [spelling, type, value, signed] of [
    ['9223372036854775807i64', 'CLongLong', '9223372036854775807', true],
    ['0xffffffffffffffffui64', 'CUnsignedLongLong', '18446744073709551615', false],
    ['04444000000000000002I64', 'CLongLong', BigInt('0o4444000000000000002').toString(), true],
    ['127Ui64', 'CUnsignedLongLong', '127', false],
  ]) {
    const counter = createProofCounter(), scanner = new SelectedCScanner(Buffer.from(spelling), counter);
    const token = scanner.next(), literal = checkedOriginalLiteral(scanner.decoded, token, 'c', counter);
    assert.equal(literal.type, type);
    assert.deepEqual(literal.term.sort, { kind: 'BV', width: 64, signed });
    assert.equal(literal.term.value, value);
    assert.throws(() => checkedOriginalLiteral(scanner.decoded, { ...token, spelling: '0i64' }, 'c', counter));
    assert.throws(() => checkedOriginalLiteral(scanner.decoded, token, 'csharp', counter));
  }
  for (const spelling of ['9223372036854775808i64', '18446744073709551616ui64', '1i64u', '1lL', '08i64']) {
    const counter = createProofCounter(), scanner = new SelectedCScanner(Buffer.from(spelling), counter);
    assert.throws(() => checkedOriginalLiteral(scanner.decoded, scanner.next(), 'c', counter));
  }
});

test('bitvector comparison meaning uses explicit signed and unsigned mathematical domains', () => {
  const signed = { kind: 'BV', width: 32, signed: true }, unsigned = { ...signed, signed: false };
  assert.equal(foldBitvectorComparison('bvLt', signed, ['-1', '0']), true);
  assert.equal(foldBitvectorComparison('bvLt', unsigned, ['4294967295', '0']), false);
  assert.equal(foldBitvectorComparison('bvGe', signed, ['-2147483648', '2147483647']), false);
  assert.equal(foldBitvectorComparison('bvGe', unsigned, ['4294967295', '2147483647']), true);
  assert.throws(() => foldBitvectorComparison('bvLt', unsigned, ['-1', '0']));
  assert.throws(() => foldBitvectorComparison('bvLt', signed, ['4294967295', '0']));
  assert.throws(() => foldBitvectorComparison('bvEq', signed, ['-0', '0']));
});

test('integral comparisons preserve source order, actual promotion and exact Boolean equations', () => {
  for (const [formals, promoted] of [['int left, int right', 'int'], ['uint left, uint right', 'uint'],
    ['long left, int right', 'long'], ['uint left, int right', 'long'], ['ulong left, uint right', 'ulong'],
    ['byte left, short right', 'int']]) {
    for (const [operator, opcode] of [['==', 'bvEq'], ['!=', 'bvNe'], ['<', 'bvLt'], ['<=', 'bvLe'], ['>', 'bvGt'], ['>=', 'bvGe']]) {
      for (const arithmetic of ['checked', 'unchecked']) {
        const counter = createProofCounter();
        const compilation = bindSelectedCsharpCompilation([
          { unit: 'comparison.cs', compilation: 'original-comparison', role: 'source', rawBytes: Buffer.from(
            `class C { bool F(${formals}) { ${arithmetic} { return left ${operator} right; } } }`, 'utf8') },
          { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
        ], counter);
        const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
        const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
          declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
          typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
        const comparison = body.nodes.find(node => node.operation === 'integralComparison');
        assert.equal(comparison.term.opcode, opcode);
        assert.equal(comparison.term.sort, 'Bool');
        assert.deepEqual(comparison.inputs.map(id => body.nodes[id].type.name), [promoted, promoted]);
        assert.equal(checkSelectedScalarBody(compilation, body, counter).sourceAdmission, false);
        for (const mutate of [node => { node.term.opcode = opcode === 'bvEq' ? 'bvNe' : 'bvEq'; },
          node => { node.inputs.reverse(); }, node => { node.term.args.reverse(); },
          node => { node.term.sort = { kind: 'BV', width: 32, signed: true }; }]) {
          const forged = structuredClone(body); mutate(forged.nodes[comparison.id]);
          assert.throws(() => checkSelectedScalarBody(compilation, forged, counter));
        }
      }
    }
  }
});

test('original integral predicates compose through Boolean short circuit and complete branch stores', () => {
  for (const statements of ['return (left < right) && (left != right);',
    'return !((left >= right) | (left == right));',
    'if (left < right) { return true; } else { return left == right; }',
    'const bool ordered = -1 < 0; return ordered && (left <= right);']) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'predicates.cs', compilation: 'original-predicates', role: 'source', rawBytes: Buffer.from(
        `class C { bool F(int left, int right) { unchecked { ${statements} } } }`, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    assert.equal(checkSelectedScalarBody(compilation, body, counter).sourceAdmission, false);
    const comparison = body.nodes.find(node => node.operation === 'integralComparison');
    const forged = structuredClone(body);
    forged.nodes[comparison.id].term.opcode = 'bvGt';
    assert.throws(() => checkSelectedScalarBody(compilation, forged, counter));
  }
});

test('original void return and normal fallthrough carry no forged scalar value', () => {
  for (const explicitReturn of [false, true]) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'void.cs', compilation: 'original-void', role: 'source', rawBytes: Buffer.from(
        `class C { void F(int input) { int local; local = input; ${explicitReturn ? 'return;' : ''} } }`, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    assert.equal(body.nodes.at(-2).operation, explicitReturn ? 'returnVoid' : 'fallthrough');
    assert.equal(body.edges.at(-1).completion, explicitReturn ? 'return' : 'normal');
    assert.equal(body.returnNode, explicitReturn ? body.nodes.length - 2 : null);
    assert.equal(checkSelectedScalarBody(compilation, body, counter).sourceAdmission, false);
    const invented = structuredClone(body);
    invented.nodes.at(-2).term = { kind: 'Constant', sort: { kind: 'BV', width: 32, signed: true }, value: '0' };
    assert.throws(() => checkSelectedScalarBody(compilation, invented, counter));
    const changedEdge = structuredClone(body);
    changedEdge.edges.at(-1).completion = explicitReturn ? 'normal' : 'return';
    assert.throws(() => checkSelectedScalarBody(compilation, changedEdge, counter));
    const wrongControlType = structuredClone(body);
    wrongControlType.nodes[0].type = wrongControlType.nodes.find(node => node.operation === 'write').type;
    assert.throws(() => checkSelectedScalarBody(compilation, wrongControlType, counter));
  }
});

test('checked integral bitwise transfers retain promoted widths and independently checked equations', () => {
  for (const [formals, type] of [['int left, int right', 'int'], ['uint left, uint right', 'uint'],
    ['long left, int right', 'long'], ['ulong left, uint right', 'ulong'], ['byte left, short right', 'int']]) {
    for (const operation of ['&', '|', '^']) {
      for (const arithmetic of ['checked', 'unchecked']) {
        const counter = createProofCounter();
        const compilation = bindSelectedCsharpCompilation([
          { unit: 'bitwise.cs', compilation: 'original-bitwise', role: 'source', rawBytes: Buffer.from(
            `class C { ${type} F(${formals}) { ${arithmetic} { return ~(left ${operation} right); } } }`, 'utf8') },
          { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
        ], counter);
        const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
        const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
          declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
          typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
        const numeric = body.nodes.filter(node => node.operation === 'numeric');
        assert.deepEqual(numeric.map(node => node.term.opcode), [{ '&': 'bitand', '|': 'bitor', '^': 'bitxor' }[operation], 'bitnot']);
        assert.deepEqual(numeric[0].inputs.map(id => body.nodes[id].type.name), [type, type]);
        assert.equal(checkSelectedScalarBody(compilation, body, counter).completeBodyProof, false);
        for (const mutate of [node => { node.term.opcode = 'add'; },
          node => { node.term.sort.signed = !node.term.sort.signed; },
          node => { node.inputs.reverse(); }]) {
          const forged = structuredClone(body); mutate(forged.nodes[numeric[0].id]);
          assert.throws(() => checkSelectedScalarBody(compilation, forged, counter));
        }
      }
    }
  }
});

test('checked bitwise constant locals retain independently derived initializer equations', () => {
  for (const arithmetic of ['checked', 'unchecked']) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'bitwise-constant.cs', compilation: 'original-bitwise-constant', role: 'source', rawBytes: Buffer.from(
        `class C { int F(int input) { const int mask = ${arithmetic}(~(15 & 3)); return ${arithmetic}(mask | input); } }`, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    assert.deepEqual(body.nodes.filter(node => node.operation === 'numeric').map(node => node.term.opcode), ['bitand', 'bitnot', 'bitor']);
    assert.equal(checkSelectedScalarBody(compilation, body, counter).completeBodyProof, false);
    const forged = structuredClone(body);
    forged.nodes.find(node => node.operation === 'numeric' && node.term.opcode === 'bitand').term.opcode = 'bitxor';
    assert.throws(() => checkSelectedScalarBody(compilation, forged, counter));
  }
});

test('original unchecked equal-width UInt32 Int64 and UInt64 transfers retain their actual signed sorts', () => {
  for (const type of ['uint', 'long', 'ulong']) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'integral.cs', compilation: 'original-integral', role: 'source', rawBytes: Buffer.from(
        `class C { ${type} F(${type} left, ${type} right) { unchecked { return ~(left + right); } } }`, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    const expectedSort = { kind: 'BV', width: type === 'uint' ? 32 : 64, signed: type === 'long' };
    assert.deepEqual(body.nodes.find(node => node.operation === 'numeric').term.sort, expectedSort);
    assert.equal(checkSelectedScalarBody(compilation, body, counter).sourceAdmission, false);
    const forged = structuredClone(body);
    forged.nodes.find(node => node.operation === 'numeric').term.sort.signed = !expectedSort.signed;
    assert.throws(() => checkSelectedScalarBody(compilation, forged, counter));
  }
});

test('original suffixed integral literals bind width and signedness before storage and return', () => {
  for (const [type, spelling, width, signed] of [
    ['uint', '4294967295U', 32, false], ['long', '9223372036854775807L', 64, true],
    ['ulong', '18446744073709551615UL', 64, false],
  ]) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'literal-body.cs', compilation: 'original-literal-body', role: 'source', rawBytes: Buffer.from(
        `class C { ${type} F() { ${type} local = ${spelling}; return local; } }`, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    const literal = body.nodes.find(node => node.operation === 'literal');
    assert.deepEqual(literal.term.sort, { kind: 'BV', width, signed });
    assert.equal(checkSelectedScalarBody(compilation, body, counter).completeBodyProof, false);
    const forged = structuredClone(body);
    forged.nodes.find(node => node.operation === 'literal').term.value = '0';
    assert.throws(() => checkSelectedScalarBody(compilation, forged, counter));
  }
});

test('original lossless integral conversions are required at local assignment and return positions', () => {
  for (const [result, source] of [['long', 'int'], ['long', 'uint'], ['ulong', 'uint']]) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'conversion-body.cs', compilation: 'original-conversion-body', role: 'source', rawBytes: Buffer.from(
        `class C { ${result} F(${source} value) { ${result} local = (value); local = (value); return (value); } }`, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    assert.equal(body.nodes.filter(node => node.operation === 'convert').length, 3);
    assert.equal(checkSelectedScalarBody(compilation, body, counter).completeBodyProof, false);
    const forged = structuredClone(body);
    forged.nodes.find(node => node.operation === 'convert').conversion.source = 'ulong';
    assert.throws(() => checkSelectedScalarBody(compilation, forged, counter));
    const omitted = structuredClone(body);
    omitted.nodes.splice(omitted.nodes.findIndex(node => node.operation === 'convert'), 1);
    assert.throws(() => checkSelectedScalarBody(compilation, omitted, counter));
  }
});

test('original UInt32 unary minus requires Int64 promotion before the signed equation', () => {
  const counter = createProofCounter();
  const compilation = bindSelectedCsharpCompilation([
    { unit: 'uint-negation.cs', compilation: 'original-uint-negation', role: 'source', rawBytes: Buffer.from(
      'class C { long F(uint value) { unchecked { return -(value); } } }', 'utf8') },
    { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
  ], counter);
  const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
  const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
    declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
    typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
  assert.deepEqual(body.nodes.map(node => node.operation), ['entry', 'read', 'convert', 'numeric', 'endParameter', 'return', 'exit']);
  assert.deepEqual(body.nodes[2].conversion, { kind: 'numeric', source: 'uint', target: 'long' });
  assert.deepEqual(body.nodes[3].term.sort, { kind: 'BV', width: 64, signed: true });
  assert.equal(checkSelectedScalarBody(compilation, body, counter).sourceAdmission, false);
  const forged = structuredClone(body);
  forged.nodes[3].inputs = [1];
  forged.nodes[3].term.args = [forged.nodes[1].term];
  assert.throws(() => checkSelectedScalarBody(compilation, forged, counter));
});

test('original mixed integral operator promotion distinguishes constant expressions from mutable local values', () => {
  for (const [result, statements] of [
    ['uint', 'return value + (+1);'], ['long', 'int local = 1; return value + local;'],
    ['uint', 'return value + (2147483647 + 1 - 2147483647);'],
  ]) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'mixed-integral.cs', compilation: 'original-mixed-integral', role: 'source', rawBytes: Buffer.from(
        `class C { ${result} F(uint value) { unchecked { ${statements} } } }`, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    const operation = body.nodes.filter(node => node.operation === 'numeric').at(-1);
    assert.equal(operation.type.name, result);
    assert.equal(checkSelectedScalarBody(compilation, body, counter).sourceAdmission, false);
    const forged = structuredClone(body);
    const conversion = forged.nodes.find(node => node.operation === 'convert');
    assert.ok(conversion);
    conversion.conversion.kind = conversion.conversion.kind === 'numeric' ? 'constantNumeric' : 'numeric';
    assert.throws(() => checkSelectedScalarBody(compilation, forged, counter));
  }
});

test('original narrow integral operands use their actual promoted operator sorts', () => {
  for (const [result, left, right] of [['int', 'byte', 'short'], ['long', 'uint', 'short'], ['ulong', 'ulong', 'char']]) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'narrow-integral.cs', compilation: 'original-narrow-integral', role: 'source', rawBytes: Buffer.from(
        `class C { ${result} F(${left} left, ${right} right) { unchecked { return left + right; } } }`, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    assert.equal(body.nodes.find(node => node.operation === 'numeric').type.name, result);
    assert.equal(checkSelectedScalarBody(compilation, body, counter).sourceAdmission, false);
    const forged = structuredClone(body);
    forged.nodes.find(node => node.operation === 'convert').conversion.target = 'uint';
    assert.throws(() => checkSelectedScalarBody(compilation, forged, counter));
  }
});

test('original Char literal and ranged Int32-to-Byte constant storage retain distinct sorts', () => {
  for (const [type, initializer] of [['char', "'\\u0041'"], ['byte', '255']]) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'narrow-storage.cs', compilation: 'original-narrow-storage', role: 'source', rawBytes: Buffer.from(
        `class C { ${type} F() { ${type} local = ${initializer}; return local; } }`, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    assert.equal(checkSelectedScalarBody(compilation, body, counter).completeBodyProof, false);
    assert.deepEqual(body.nodes.find(node => node.operation === 'write').term.sort,
      { kind: 'BV', width: type === 'char' ? 16 : 8, signed: false });
  }
});

test('scalar proof rebinds privately retained original bytes rather than mutable producer AST and index maps', () => {
  const source = 'class C { int F(int value) { unchecked { return value + 2; } } }';
  const originalBytes = Buffer.from(source, 'utf8');
  let byteLengthReads = 0, iteratorReads = 0;
  Object.defineProperty(originalBytes, 'byteLength', { get() { byteLengthReads++; throw new Error('foreign byteLength'); } });
  Object.defineProperty(originalBytes, Symbol.iterator, { value() { iteratorReads++; throw new Error('foreign iterator'); } });
  const make = bytes => {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'retained-source.cs', compilation: 'original-retained-source', role: 'source', rawBytes: bytes },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    return { compilation, body, counter };
  };
  const original = make(originalBytes);
  assert.equal(byteLengthReads, 0);
  assert.equal(iteratorReads, 0);
  // External Buffer and every exposed producer binding can be replaced; the
  // original source association remains the captured module-private bytes.
  originalBytes[source.indexOf('2')] = 57;
  const replacement = make(Buffer.from(source.replace('2', '9'), 'utf8'));
  Object.assign(original.compilation, replacement.compilation);
  assert.throws(() => checkSelectedScalarBody(original.compilation, replacement.body, original.counter));
  assert.equal(checkSelectedScalarBody(original.compilation, original.body, original.counter).sourceAdmission, false);
  let compilationReads = 0;
  const foreign = Object.defineProperty({}, 'originals', { get() { compilationReads++; return replacement.compilation.originals; } });
  assert.throws(() => checkSelectedScalarBody(foreign, original.body, original.counter));
  assert.equal(compilationReads, 0);
});

test('original explicit integral casts bind arithmetic context target range and source scope', () => {
  for (const [target, source] of [['int', 'uint'], ['byte', 'long'], ['short', 'ulong'], ['char', 'int'],
    ['sbyte', 'uint'], ['ushort', 'long'], ['uint', 'int'], ['long', 'ulong'], ['ulong', 'long']])
    for (const checked of [false, true]) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'unchecked-cast.cs', compilation: 'original-unchecked-cast', role: 'source', rawBytes: Buffer.from(
        `class C { ${target} F(${source} value) { return ${checked ? 'checked' : 'unchecked'}((${target})value); } }`, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    const cast = body.nodes.find(node => node.operation === 'explicitCast');
    assert.deepEqual(cast.conversion, { kind: 'explicitIntegral', source, target, checkedContext: checked });
    assert.equal(checkSelectedScalarBody(compilation, body, counter).completeBodyProof, false);
    const forged = structuredClone(body);
    forged.nodes.find(node => node.operation === 'explicitCast').conversion.checkedContext = !checked;
    assert.throws(() => checkSelectedScalarBody(compilation, forged, counter));
    if (checked) {
      assert.equal(body.exceptionalCompletions[0].instruction, cast.id);
      assert.deepEqual(body.exceptionalCompletions[0].store, cast.preStore);
      const wrongRange = structuredClone(body);
      wrongRange.nodes[cast.id].overflow.args[2].args[1].value = '1';
      assert.throws(() => checkSelectedScalarBody(compilation, wrongRange, counter));
    }
  }
  for (const [expression, valid] of [['checked((byte)255)', true], ['checked((byte)256)', false],
    ['checked((byte)-1)', false], ['unchecked((byte)256)', true]]) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'constant-cast.cs', compilation: 'constant-cast', role: 'source', rawBytes: Buffer.from(
        `class C { byte F() { return ${expression}; } }`, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const produce = () => bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    if (valid) assert.equal(checkSelectedScalarBody(compilation, produce(), counter).sourceAdmission, false);
    else assert.throws(produce, error => error.code === 'INVALID_BINDING');
  }
});

test('original explicit unchecked body connects formal reads, local storage, arithmetic and return CFG', () => {
  const counter = createProofCounter();
  const compilation = bindSelectedCsharpCompilation([
    { unit: 'body.cs', compilation: 'original-body', role: 'source', rawBytes: Buffer.from(
      'class C { int F(int value) { unchecked { int local = value + 2; return local; } } }', 'utf8') },
    { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
  ], counter);
  const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
  const environment = { counter, typeIndex: compilation.index, declarationMetadata: compilation.bound.declarationMetadata,
    parameterConstraints: compilation.bound.parameterConstraints, typeGraph: compilation.typeGraph, languageVersion: [5, 0] };
  const body = bindSelectedCsharpScalarBody(compilation, method.declId, environment);
  assert.deepEqual(body.nodes.map(node => node.operation), ['entry', 'read', 'literal', 'numeric', 'write', 'read', 'endLocal', 'endParameter', 'return', 'exit']);
  assert.equal(body.nodes[3].term.opcode, 'add');
  assert.deepEqual(body.nodes[4].location, body.nodes[5].location);
  assert.deepEqual(body.nodes[3].term, body.nodes[8].term);
  assert.equal(body.edges.at(-1).completion, 'return');
  assert.equal(body.completeBodyBinding, false);
  assert.equal(body.sourceAdmission, false);
  assert.equal(checkSelectedScalarBody(compilation, body, counter).completeBodyProof, false);
  let forgedCounterCalls = 0;
  assert.throws(() => checkSelectedScalarBody(compilation, body, { charge() { forgedCounterCalls++; }, snapshot() { return {}; } }));
  assert.equal(forgedCounterCalls, 0);
  const altered = structuredClone(body);
  altered.nodes[3].term.opcode = 'sub';
  assert.throws(() => checkSelectedScalarBody(compilation, altered, counter));
  const wrongStorage = structuredClone(body);
  wrongStorage.nodes[5].location.declaration = method.declId;
  assert.throws(() => checkSelectedScalarBody(compilation, wrongStorage, counter));
  const relabelled = structuredClone(body);
  relabelled.nodes[3].operation = 'empty';
  assert.throws(() => checkSelectedScalarBody(compilation, relabelled, counter));
  const forgedEntry = structuredClone(body);
  forgedEntry.nodes[3].operation = 'entry';
  assert.throws(() => checkSelectedScalarBody(compilation, forgedEntry, counter));
  const forgedEndpoint = structuredClone(body);
  forgedEndpoint.nodes[0].sourceKind = forgedEndpoint.nodes[1].sourceKind;
  forgedEndpoint.nodes[0].occurrence.span = forgedEndpoint.nodes[1].occurrence.span;
  forgedEndpoint.nodes[0].occurrence.syntacticParent = forgedEndpoint.nodes[1].occurrence.syntacticParent;
  forgedEndpoint.nodes[0].term = forgedEndpoint.nodes[1].term;
  assert.throws(() => checkSelectedScalarBody(compilation, forgedEndpoint, counter));
  const omitted = structuredClone(body);
  omitted.nodes.splice(2, 1);
  assert.throws(() => checkSelectedScalarBody(compilation, omitted, counter));
  const changedFrame = structuredClone(body);
  changedFrame.nodes[4].postStore[0].value = changedFrame.nodes[2].term;
  assert.throws(() => checkSelectedScalarBody(compilation, changedFrame, counter));
  const inventedLocation = structuredClone(body);
  inventedLocation.nodes[3].postStore.push({ ...inventedLocation.nodes[3].postStore[0],
    location: { binder: body.binder, declaration: method.declId } });
  assert.throws(() => checkSelectedScalarBody(compilation, inventedLocation, counter));
  let proofGetterReads = 0;
  const accessorProof = structuredClone(body);
  Object.defineProperty(accessorProof.nodes[3], 'operation', { enumerable: true,
    get() { proofGetterReads++; return 'numeric'; } });
  assert.throws(() => checkSelectedScalarBody(compilation, accessorProof, counter));
  assert.equal(proofGetterReads, 0);
  const extraEffect = structuredClone(body);
  extraEffect.nodes[3].writes = [extraEffect.nodes[4].location];
  assert.throws(() => checkSelectedScalarBody(compilation, extraEffect, counter));
  const replacedIntrinsic = structuredClone(body);
  replacedIntrinsic.nodes[3].selected.operation = '-';
  assert.throws(() => checkSelectedScalarBody(compilation, replacedIntrinsic, counter));
  const sparseProof = structuredClone(body);
  delete sparseProof.nodes[2];
  assert.throws(() => checkSelectedScalarBody(compilation, sparseProof, counter));
  const original = compilation.decodedUnits.get('body.cs');
  for (const node of body.nodes) {
    assert.equal(node.occurrence.unit, 'body.cs');
    const [start, end] = node.occurrence.span.utf16;
    assert.ok(end > start && end <= original.text.length);
    assert.ok(node.occurrence.syntacticParent.span.utf16[0] <= start);
    assert.ok(node.occurrence.syntacticParent.span.utf16[1] >= end);
  }
});

test('original unchecked unary Int32 operations retain ordered source operands and equations', () => {
  const counter = createProofCounter();
  const compilation = bindSelectedCsharpCompilation([
    { unit: 'unary.cs', compilation: 'original-unary', role: 'source', rawBytes: Buffer.from(
      'class C { int F(int value) { unchecked { return ~(-(+value)); } } }', 'utf8') },
    { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
  ], counter);
  const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
  const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
    declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
    typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
  assert.deepEqual(body.nodes.filter(node => node.operation === 'numeric').map(node => node.term.opcode), ['cast', 'neg', 'bitnot']);
  assert.equal(checkSelectedScalarBody(compilation, body, counter).sourceAdmission, false);
  const altered = structuredClone(body);
  altered.nodes.find(node => node.operation === 'numeric' && node.term.opcode === 'neg').term.opcode = 'bitnot';
  assert.throws(() => checkSelectedScalarBody(compilation, altered, counter));
});

test('original simple scalar assignments update the same formal and local locations once', () => {
  const counter = createProofCounter();
  const compilation = bindSelectedCsharpCompilation([
    { unit: 'assign.cs', compilation: 'original-assign', role: 'source', rawBytes: Buffer.from(
      'class C { int F(int value) { unchecked { int local = 0; value = 1; local = value + 2; return local; } } }', 'utf8') },
    { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
  ], counter);
  const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
  const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
    declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
    typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
  assert.equal(checkSelectedScalarBody(compilation, body, counter).completeBodyProof, false);
  const writes = body.nodes.filter(node => node.operation === 'write');
  assert.equal(writes.length, 3);
  assert.deepEqual(writes[0].location, writes[2].location);
  assert.deepEqual(writes[1].location.declaration, body.slots[0].declaration);
  const forgedTarget = structuredClone(body);
  forgedTarget.nodes[writes[1].id].location = writes[0].location;
  assert.throws(() => checkSelectedScalarBody(compilation, forgedTarget, counter));
});

test('original Boolean scalar body retains eager operand order and independently checked truth equations', () => {
  const counter = createProofCounter();
  const compilation = bindSelectedCsharpCompilation([
    { unit: 'boolean.cs', compilation: 'original-boolean', role: 'source', rawBytes: Buffer.from(
      'class C { bool F(bool left, bool right) { unchecked { bool result = left & !right; result = result ^ true; return result; } } }', 'utf8') },
    { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
  ], counter);
  const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
  const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
    declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
    typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
  assert.equal(body.nodes.filter(node => node.operation === 'boolean').length, 3);
  const checked = checkSelectedScalarBody(compilation, body, counter);
  assert.equal(checked.sourceAdmission, false);
  assert.equal(checked.checkedBooleanLeaves, 10);
  const altered = structuredClone(body);
  const boolean = altered.nodes.find(node => node.operation === 'boolean');
  boolean.term.args[1] = boolean.term.args[2];
  assert.throws(() => checkSelectedScalarBody(compilation, altered, counter));
  const relabelled = structuredClone(body);
  relabelled.nodes.find(node => node.operation === 'boolean').operation = 'numeric';
  assert.throws(() => checkSelectedScalarBody(compilation, relabelled, counter));
});

test('original Boolean equality and inequality bind both eager operands and all consistent truth leaves', () => {
  for (const operation of ['==', '!=']) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'boolean-equality.cs', compilation: 'original-boolean-equality', role: 'source', rawBytes: Buffer.from(
        `class C { bool F(bool left, bool right) { return left ${operation} right; } }`, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    assert.equal(checkSelectedScalarBody(compilation, body, counter).checkedBooleanLeaves, 4);
    const altered = structuredClone(body), equality = altered.nodes.find(node => node.operation === 'boolean');
    [equality.term.args[1], equality.term.args[2]] = [equality.term.args[2], equality.term.args[1]];
    altered.nodes.find(node => node.operation === 'return').term = equality.term;
    assert.throws(() => checkSelectedScalarBody(compilation, altered, counter));
  }
});

test('original pure conditional values have two reached alternatives and an independently checked typed join', () => {
  const counter = createProofCounter();
  const compilation = bindSelectedCsharpCompilation([
    { unit: 'conditional.cs', compilation: 'original-conditional', role: 'source', rawBytes: Buffer.from(
      'class C { int F(bool choice, bool nested, int left, int right) { return choice ? (nested ? left : right) : right; } }', 'utf8') },
    { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
  ], counter);
  const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
  const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
    declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
    typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
  assert.equal(body.nodes.filter(node => node.operation === 'conditionalBranch').length, 2);
  assert.equal(body.nodes.filter(node => node.operation === 'conditionalJoin').length, 2);
  assert.equal(body.edges.filter(edge => edge.branch !== null).length, 4);
  assert.equal(checkSelectedScalarBody(compilation, body, counter).sourceAdmission, false);
  const wrongEdge = structuredClone(body);
  wrongEdge.edges.find(edge => edge.branch?.outcome === false).branch.outcome = true;
  assert.throws(() => checkSelectedScalarBody(compilation, wrongEdge, counter));
  const forgedValue = structuredClone(body), join = forgedValue.nodes.findLast(node => node.operation === 'conditionalJoin');
  [join.term.args[1], join.term.args[2]] = [join.term.args[2], join.term.args[1]];
  forgedValue.nodes.find(node => node.operation === 'return').term = join.term;
  assert.throws(() => checkSelectedScalarBody(compilation, forgedValue, counter));
  const omitted = structuredClone(body);
  omitted.nodes.splice(omitted.nodes.findIndex(node => node.operation === 'conditionalArm' && node.outcome === false), 1);
  assert.throws(() => checkSelectedScalarBody(compilation, omitted, counter));
});

test('original Boolean short-circuit CFG reaches its right child on exactly the selected alternative', () => {
  const counter = createProofCounter();
  const compilation = bindSelectedCsharpCompilation([
    { unit: 'short-circuit.cs', compilation: 'original-short-circuit', role: 'source', rawBytes: Buffer.from(
      'class C { bool F(bool left, bool middle, bool right) { return left && (middle || right); } }', 'utf8') },
    { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
  ], counter);
  const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
  const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
    declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
    typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
  assert.equal(body.nodes.filter(node => node.operation === 'shortCircuitBranch').length, 2);
  assert.equal(body.nodes.filter(node => node.operation === 'shortCircuitJoin').length, 2);
  assert.equal(body.edges.filter(edge => edge.branch !== null).length, 4);
  const checked = checkSelectedScalarBody(compilation, body, counter);
  assert.equal(checked.sourceAdmission, false);
  assert.equal(checked.checkedBooleanLeaves, 12);
  const wrongAlternative = structuredClone(body);
  wrongAlternative.edges.find(edge => edge.branch?.outcome === false).branch.outcome = true;
  assert.throws(() => checkSelectedScalarBody(compilation, wrongAlternative, counter));
  const eager = structuredClone(body);
  const outerBranch = eager.nodes.find(node => node.operation === 'shortCircuitBranch');
  const rightRead = eager.nodes.find(node => node.operation === 'read' && node.id > outerBranch.id);
  eager.edges.push({ from: outerBranch.id, to: rightRead.id, completion: 'normal', branch: null });
  assert.throws(() => checkSelectedScalarBody(compilation, eager, counter));
  const forged = structuredClone(body), join = forged.nodes.findLast(node => node.operation === 'shortCircuitJoin');
  [join.term.args[1], join.term.args[2]] = [join.term.args[2], join.term.args[1]];
  forged.nodes.find(node => node.operation === 'return').term = join.term;
  assert.throws(() => checkSelectedScalarBody(compilation, forged, counter));
});

test('mixed original return and normal if paths retain terminal exits and only the live continuation store', () => {
  // UNRUN source regression: execution remains separately admitted.
  for (const source of [
    'class C { int F(bool choice, int left, int right) { if (choice) return left; return right; } }',
    'class C { int F(bool choice, int left, int right) { int x; if (choice) x = left; else return right; return x; } }',
    'class C { int F(bool first, bool second, int left, int right) { if (first) { if (second) return left; } else return right; return left; } }',
    'class C { void F(bool choice) { if (choice) return; int x = 1; } }',
  ]) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'mixed-return.cs', compilation: 'original-mixed-return', role: 'source', rawBytes: Buffer.from(source, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    const continuations = body.nodes.filter(node => node.operation === 'statementContinuation');
    assert.ok(continuations.length);
    for (const node of continuations) {
      assert.ok(body.edges.some(edge => edge.from === node.normalTail && edge.to === node.id && edge.completion === 'normal'));
      assert.ok(body.edges.some(edge => edge.from === node.returnedTail && edge.to === body.exit && edge.completion === 'return'));
      assert.ok(!body.edges.some(edge => edge.from === node.returnedTail && edge.to === node.id));
    }
    assert.equal(checkSelectedScalarBody(compilation, body, counter).sourceAdmission, false);
    const substituted = structuredClone(body);
    const changed = substituted.nodes.find(node => node.operation === 'statementContinuation');
    [changed.normalTail, changed.returnedTail] = [changed.returnedTail, changed.normalTail];
    assert.throws(() => checkSelectedScalarBody(compilation, substituted, counter));
    const lostReturn = structuredClone(body);
    lostReturn.edges.splice(lostReturn.edges.findIndex(edge => edge.from === continuations[0].returnedTail && edge.to === body.exit), 1);
    assert.throws(() => checkSelectedScalarBody(compilation, lostReturn, counter));
    const deadPath = structuredClone(body);
    deadPath.edges.push({ from: continuations[0].returnedTail, to: continuations[0].id, completion: 'normal', branch: null });
    assert.throws(() => checkSelectedScalarBody(compilation, deadPath, counter));
    const lostStore = structuredClone(body);
    lostStore.nodes.find(node => node.operation === 'statementContinuation').postStore = [];
    if (continuations[0].postStore.length) assert.throws(() => checkSelectedScalarBody(compilation, lostStore, counter));
  }
});

test('original conditional and short-circuit stores join values and definite assignment across reached paths', () => {
  const make = source => {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'branch-store.cs', compilation: 'original-branch-store', role: 'source', rawBytes: Buffer.from(source, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const environment = { counter, typeIndex: compilation.index, declarationMetadata: compilation.bound.declarationMetadata,
      parameterConstraints: compilation.bound.parameterConstraints, typeGraph: compilation.typeGraph, languageVersion: [5, 0] };
    return { counter, compilation, body: () => bindSelectedCsharpScalarBody(compilation, method.declId, environment) };
  };
  const conditional = make('class C { int F(bool choice, int left, int right) { int x; int sink = choice ? (x = left) : (x = right); return x; } }');
  const body = conditional.body();
  assert.equal(checkSelectedScalarBody(conditional.compilation, body, conditional.counter).sourceAdmission, false);
  const declaration = body.nodes.find(node => node.operation === 'declare');
  const location = body.locations.find(row => canonicalData(row.location) === canonicalData(declaration.location));
  assert.equal(location.defined, false);
  assert.equal(Object.hasOwn(location, 'term'), false);
  const join = body.nodes.find(node => node.operation === 'conditionalJoin');
  const joinedValue = join.postStore.find(row => canonicalData(row.location) === canonicalData(declaration.location));
  assert.equal(joinedValue.value.opcode, 'ite');
  const forged = structuredClone(body);
  const forgedJoin = forged.nodes.find(node => node.id === join.id);
  const joinedX = forgedJoin.postStore.find(row => canonicalData(row.location) === canonicalData(declaration.location));
  joinedX.value = joinedX.value.args[1];
  assert.throws(() => checkSelectedScalarBody(conditional.compilation, forged, conditional.counter));
  const skipped = make('class C { bool F(bool choice, bool other) { bool x = false; bool sink = choice && (x = other); return x; } }');
  const skippedBody = skipped.body();
  assert.equal(checkSelectedScalarBody(skipped.compilation, skippedBody, skipped.counter).sourceAdmission, false);
  const skippedReturn = skippedBody.nodes.find(node => node.operation === 'return');
  assert.equal(skippedReturn.term.opcode, 'ite');
  assert.equal(skippedReturn.term.args[2].value, false);
  const unassigned = make('class C { int F(bool choice) { int x; int sink = choice ? (x = 1) : 2; return x; } }');
  assert.throws(() => unassigned.body());
  const statement = make('class C { int F(bool first, bool second, int left, int right) { int x; if (first) { if (second) x = left; else x = right; } else x = right; return x; } }');
  const statementBody = statement.body();
  assert.equal(statementBody.nodes.filter(node => node.operation === 'statementJoin').length, 2);
  assert.equal(checkSelectedScalarBody(statement.compilation, statementBody, statement.counter).sourceAdmission, false);
  const missingAlternative = structuredClone(statementBody);
  missingAlternative.edges.splice(missingAlternative.edges.findIndex(edge => edge.branch?.outcome === false), 1);
  assert.throws(() => checkSelectedScalarBody(statement.compilation, missingAlternative, statement.counter));
  const noElse = make('class C { int F(bool choice) { int x; if (choice) x = 1; return x; } }');
  assert.throws(() => noElse.body());
  const branchLocal = make('class C { void F(bool choice) { if (choice) { int x = 1; } } }');
  const branchBody = branchLocal.body();
  assert.equal(checkSelectedScalarBody(branchLocal.compilation, branchBody, branchLocal.counter).sourceAdmission, false);
  const end = branchBody.nodes.find(node => node.operation === 'endLocal');
  assert.ok(end);
  assert.equal(branchBody.locations.find(row => canonicalData(row.location) === canonicalData(end.location)).defined, false);
  const forgedLifetime = structuredClone(branchBody);
  forgedLifetime.nodes[end.id].scopeOccurrence = structuredClone(branchBody.nodes[0].occurrence.span);
  assert.throws(() => checkSelectedScalarBody(branchLocal.compilation, forgedLifetime, branchLocal.counter));
  const omittedLifetime = structuredClone(branchBody);
  omittedLifetime.nodes.splice(end.id, 1);
  assert.throws(() => checkSelectedScalarBody(branchLocal.compilation, omittedLifetime, branchLocal.counter));
  const siblings = make('class C { int F(bool choice, int original) { int result; if (choice) { int x = original; result = x; } else { int x = 1; result = x; } return result; } }');
  const siblingBody = siblings.body();
  assert.equal(siblingBody.nodes.filter(node => node.operation === 'endLocal').length, 3);
  assert.equal(checkSelectedScalarBody(siblings.compilation, siblingBody, siblings.counter).sourceAdmission, false);
});

test('original two-return alternatives retain their terminal edges and result equation', () => {
  for (const source of [
    'class C { int F(bool c, int l, int r) { if (c) return l; else return r; } }',
    'class C { void F(bool c) { if (c) return; else return; } }',
    'class C { int F(bool a, bool b, int l, int r) { if (a) { if (b) return l; else return r; } else return r; } }',
    'class C { int F(bool c, int l, int r) { { int x = l; if (c) { int y = x; return y; } else { int z = r; return z; } } } }',
  ]) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'terminal-branches.cs', compilation: 'original-terminal-branches', role: 'source', rawBytes: Buffer.from(source, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const environment = { counter, typeIndex: compilation.index, declarationMetadata: compilation.bound.declarationMetadata,
      parameterConstraints: compilation.bound.parameterConstraints, typeGraph: compilation.typeGraph, languageVersion: [5, 0] };
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, environment);
    assert.equal(checkSelectedScalarBody(compilation, body, counter).completeBodyProof, false);
    const merge = body.nodes.find(node => ['returnMerge', 'returnMergeVoid'].includes(node.operation));
    assert.ok(merge);
    assert.equal(body.edges.filter(edge => edge.to === merge.id && edge.completion === 'return').length, 2);
    const wrongEdge = structuredClone(body);
    wrongEdge.edges.find(edge => edge.to === merge.id).completion = 'normal';
    assert.throws(() => checkSelectedScalarBody(compilation, wrongEdge, counter));
    const wrongOwner = structuredClone(body);
    wrongOwner.nodes[merge.id].whenTrue = merge.whenFalse;
    assert.throws(() => checkSelectedScalarBody(compilation, wrongOwner, counter));
    const omitted = structuredClone(body);
    omitted.nodes.splice(merge.id, 1);
    assert.throws(() => checkSelectedScalarBody(compilation, omitted, counter));
    if (merge.operation === 'returnMerge') {
      const forged = structuredClone(body);
      forged.nodes[merge.id].term = forged.nodes[merge.id].term.args[1];
      assert.throws(() => checkSelectedScalarBody(compilation, forged, counter));
    }
    const scopeEnds = body.nodes.filter(node => node.operation === 'endLocal');
    if (scopeEnds.length) {
      assert.equal(scopeEnds.length, 4); // Each arm ends its own local and the shared enclosing local.
      for (const end of scopeEnds)
        assert.equal(end.postStore.some(row => canonicalData(row.location) === canonicalData(end.location)), false);
      const omittedEnd = structuredClone(body);
      omittedEnd.nodes.splice(scopeEnds[0].id, 1);
      assert.throws(() => checkSelectedScalarBody(compilation, omittedEnd, counter));
      const wrongScope = structuredClone(body);
      wrongScope.nodes[scopeEnds[0].id].scopeOccurrence = method.syntax.body.origin;
      assert.throws(() => checkSelectedScalarBody(compilation, wrongScope, counter));
    }
  }
});

test('original method-block scalar locals end after copied return evaluation or before void fallthrough', () => {
  for (const source of [
    'class C { int F(int input) { int local = input; return local; } }',
    'class C { void F() { int local = 1; } }',
  ]) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'method-locals.cs', compilation: 'original-method-locals', role: 'source', rawBytes: Buffer.from(source, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const environment = { counter, typeIndex: compilation.index, declarationMetadata: compilation.bound.declarationMetadata,
      parameterConstraints: compilation.bound.parameterConstraints, typeGraph: compilation.typeGraph, languageVersion: [5, 0] };
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, environment);
    assert.equal(checkSelectedScalarBody(compilation, body, counter).completeBodyProof, false);
    const end = body.nodes.find(node => node.operation === 'endLocal');
    assert.deepEqual(end.scopeOccurrence, method.syntax.body.origin);
    const terminal = body.nodes.find(node => ['return', 'fallthrough'].includes(node.operation));
    assert.ok(terminal.id > end.id);
    const formalEnds = body.nodes.filter(node => node.operation === 'endParameter');
    assert.equal(formalEnds.length, method.syntax.parameters.length);
    for (const formalEnd of formalEnds) {
      assert.ok(formalEnd.id > end.id && formalEnd.id < terminal.id);
      assert.deepEqual(formalEnd.scopeOccurrence, method.syntax.body.origin);
    }
    if (terminal.operation === 'return') assert.ok(terminal.input < end.id);
    const local = body.locations.find(row => canonicalData(row.location) === canonicalData(end.location));
    assert.equal(local.defined, false);
    const omitted = structuredClone(body);
    omitted.nodes.splice(end.id, 1);
    assert.throws(() => checkSelectedScalarBody(compilation, omitted, counter));
    if (formalEnds.length) {
      const wrongFormal = structuredClone(body);
      wrongFormal.nodes[formalEnds[0].id].location = end.location;
      assert.throws(() => checkSelectedScalarBody(compilation, wrongFormal, counter));
      const omittedFormal = structuredClone(body);
      omittedFormal.nodes.splice(formalEnds[0].id, 1);
      assert.throws(() => checkSelectedScalarBody(compilation, omittedFormal, counter));
    }
  }
});

test('original floating and decimal literals preserve checked bit-pattern/scale values through scalar storage and return', () => {
  for (const [type, literal, sort] of [['float', '1.25f', 'F32'], ['double', '1.25', 'F64'], ['decimal', '2.900m', 'Decimal']]) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'real-values.cs', compilation: 'original-real-values', role: 'source', rawBytes: Buffer.from(
        `class C { ${type} F() { ${type} value = ${literal}; return value; } }`, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    assert.equal(checkSelectedScalarBody(compilation, body, counter).completeBodyProof, false);
    const value = body.nodes.find(node => node.operation === 'literal');
    assert.equal(value.term.sort, sort);
    if (sort === 'Decimal') assert.deepEqual(value.term.value, { coefficient: '2900', scale: 3, negative: false });
    const forged = structuredClone(body);
    forged.nodes[value.id].term.value = sort === 'Decimal' ? { coefficient: '29', scale: 1, negative: false } :
      (sort === 'F32' ? '00000000' : '0000000000000000');
    assert.throws(() => checkSelectedScalarBody(compilation, forged, counter));
  }
});

test('original integral shifts bind masked Int32 counts and width/signedness in both explicit contexts', () => {
  for (const [type, operation, mode, mask] of [
    ['int', '<<', 'unchecked', '31'], ['uint', '>>', 'checked', '31'],
    ['long', '>>', 'checked', '63'], ['ulong', '<<', 'unchecked', '63'],
  ]) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'shift.cs', compilation: 'original-shift', role: 'source', rawBytes: Buffer.from(
        `class C { ${type} F(${type} left, int count) { return ${mode}(left ${operation} count); } }`, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    assert.equal(checkSelectedScalarBody(compilation, body, counter).sourceAdmission, false);
    const instruction = body.nodes.find(node => node.operation === 'numeric');
    assert.equal(instruction.term.args[1].sort, 'Z');
    assert.equal(instruction.term.args[1].args[0].args[1].value, mask);
    const wrongMask = structuredClone(body), forged = wrongMask.nodes.find(node => node.operation === 'numeric');
    forged.term.args[1].args[0].args[1].value = mask === '31' ? '63' : '31';
    wrongMask.nodes.find(node => node.operation === 'return').term = forged.term;
    assert.throws(() => checkSelectedScalarBody(compilation, wrongMask, counter));
  }
  for (const expression of ['checked(1 << 31)', 'unchecked(1 << -1)']) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'constant-shift.cs', compilation: 'original-constant-shift', role: 'source', rawBytes: Buffer.from(
        `class C { int F() { const int value = ${expression}; return value; } }`, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    assert.equal(checkSelectedScalarBody(compilation, body, counter).sourceAdmission, false);
    const shift = body.nodes.find(node => node.operation === 'numeric' && node.term.opcode === 'shl');
    assert.equal(shift.term.args[1].args[0].args[1].value, '31');
  }
});

test('original Boolean constant locals retain compile-time provenance without treating mutable known values as constants', () => {
  const make = source => {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'boolean-constant.cs', compilation: 'original-boolean-constant', role: 'source', rawBytes: Buffer.from(source, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    return { counter, compilation, body: () => bindSelectedCsharpScalarBody(compilation, method.declId, {
      counter, typeIndex: compilation.index, declarationMetadata: compilation.bound.declarationMetadata,
      parameterConstraints: compilation.bound.parameterConstraints, typeGraph: compilation.typeGraph, languageVersion: [5, 0] }) };
  };
  const original = make('class C { bool F() { const bool first = true; const bool second = !first || false; const bool last = second ? false : true; return last; } }');
  const body = original.body();
  assert.equal(checkSelectedScalarBody(original.compilation, body, original.counter).sourceAdmission, false);
  const mutable = make('class C { bool F() { bool mutable = true; const bool value = mutable; return value; } }');
  assert.throws(() => mutable.body());
  const changed = make('class C { bool F() { const bool value = false; value = true; return value; } }');
  assert.throws(() => changed.body());
});

test('compound scalar writes preserve saved left value across RHS writes and independently checked store', () => {
  const make = source => {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'compound.cs', compilation: 'original-compound', role: 'source', rawBytes: Buffer.from(source, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    return { counter, compilation, body: () => bindSelectedCsharpScalarBody(compilation, method.declId, {
      counter, typeIndex: compilation.index, declarationMetadata: compilation.bound.declarationMetadata,
      parameterConstraints: compilation.bound.parameterConstraints, typeGraph: compilation.typeGraph, languageVersion: [5, 0] }) };
  };
  for (const type of ['int', 'uint', 'long', 'ulong']) for (const operation of ['+=', '-=', '*=', '&=', '|=', '^=']) {
    const fixture = make(`class C { ${type} F(${type} left, ${type} right) { unchecked { left ${operation} right; } return left; } }`);
    const body = fixture.body(), write = body.nodes.find(node => node.operation === 'compoundWrite');
    assert.equal(checkSelectedScalarBody(fixture.compilation, body, fixture.counter).sourceAdmission, false);
    assert.equal(body.nodes[write.left].operation, 'read');
    assert.ok(write.left < write.right);
    assert.deepEqual(write.term.args, [body.nodes[write.left].term, body.nodes[write.right].term]);
    const forged = structuredClone(body);
    forged.nodes[write.id].term.args.reverse();
    // Noncommutative '-' makes swapped operands a semantically false equation;
    // other operators still require exact original ordered occurrence evidence.
    assert.throws(() => checkSelectedScalarBody(fixture.compilation, forged, fixture.counter));
  }
  const alias = make('class C { int F(int value) { return unchecked(value += (value = 3)); } }');
  const aliasBody = alias.body(), write = aliasBody.nodes.find(node => node.operation === 'compoundWrite');
  assert.equal(checkSelectedScalarBody(alias.compilation, aliasBody, alias.counter).sourceAdmission, false);
  assert.equal(aliasBody.nodes[write.left].term.kind, 'Bound');
  assert.equal(aliasBody.nodes[write.right].operation, 'write');
  assert.equal(aliasBody.nodes[write.right].term.value, '3');
  assert.deepEqual(write.term.args[0], aliasBody.nodes[write.left].term);
  for (const operation of ['&=', '|=', '^=']) {
    const fixture = make(`class C { bool F(bool left, bool right) { left ${operation} right; return left; } }`);
    const body = fixture.body();
    assert.equal(checkSelectedScalarBody(fixture.compilation, body, fixture.counter).sourceAdmission, false);
    assert.equal(body.nodes.find(node => node.operation === 'compoundWrite').term.sort, 'Bool');
  }
  for (const type of ['int', 'uint', 'long', 'ulong']) for (const operation of ['<<=', '>>=']) {
    const fixture = make(`class C { ${type} F(${type} left, int count) { checked { left ${operation} count; } return left; } }`);
    const body = fixture.body(), shift = body.nodes.find(node => node.operation === 'compoundWrite');
    assert.equal(checkSelectedScalarBody(fixture.compilation, body, fixture.counter).sourceAdmission, false);
    assert.equal(body.nodes[shift.right].type.name, 'int');
    assert.equal(shift.term.args[1].args[0].args[1].value, ['long', 'ulong'].includes(type) ? '63' : '31');
    const wrongMask = structuredClone(body);
    wrongMask.nodes[shift.id].term.args[1].args[0].args[1].value = '1';
    assert.throws(() => checkSelectedScalarBody(fixture.compilation, wrongMask, fixture.counter));
  }
  for (const type of ['sbyte', 'byte', 'short', 'ushort', 'char']) {
    const fixture = make(`class C { ${type} F(${type} left, ${type} right) { unchecked { left += right; } return left; } }`);
    const body = fixture.body(), write = body.nodes.find(node => node.operation === 'compoundWrite');
    assert.equal(checkSelectedScalarBody(fixture.compilation, body, fixture.counter).sourceAdmission, false);
    assert.equal(write.resultType.name, 'int');
    assert.equal(write.resultConversion.kind, 'explicitIntegral');
    assert.equal(write.term.opcode, 'cast');
    assert.equal(body.nodes[write.savedLeft].operation, 'read');
    assert.equal(body.nodes[write.left].input, write.savedLeft);
    const forged = structuredClone(body);
    forged.nodes[write.id].resultConversion.target = 'int';
    assert.throws(() => checkSelectedScalarBody(fixture.compilation, forged, fixture.counter));
    const omitted = structuredClone(body);
    omitted.nodes[write.id].term = write.term.args[0];
    assert.throws(() => checkSelectedScalarBody(fixture.compilation, omitted, fixture.counter));
  }
  for (const source of [
    'class C { long F(long left, int right) { unchecked { left += right; } return left; } }',
    'class C { byte F(byte left) { unchecked { left += 1; } return left; } }',
    'class C { byte F(byte left, int count) { unchecked { left <<= count; } return left; } }',
  ]) {
    const fixture = make(source), body = fixture.body();
    assert.equal(checkSelectedScalarBody(fixture.compilation, body, fixture.counter).sourceAdmission, false);
  }
  const constant = make('class C { byte F(byte left) { unchecked { left += 1; } return left; } }');
  const constantBody = constant.body(), constantWrite = constantBody.nodes.find(node => node.operation === 'compoundWrite');
  const forgedConstant = structuredClone(constantBody);
  forgedConstant.nodes[constantWrite.right].term.value = '256';
  assert.throws(() => checkSelectedScalarBody(constant.compilation, forgedConstant, constant.counter));
  assert.throws(() => make('class C { byte F(byte left, int right) { unchecked { left += right; } return left; } }').body());
  for (const type of ['sbyte', 'byte', 'short', 'ushort', 'char', 'int', 'uint', 'long', 'ulong']) {
    const narrow = ['sbyte', 'byte', 'short', 'ushort', 'char'].includes(type);
    for (const operation of ['+=', '-=', '*=', '&=', '|=', '^=']) {
      const fixture = make(`class C { ${type} F(${type} left, ${type} right) { try { checked { left ${operation} right; } } finally { unchecked { right++; } } return left; } }`);
      const body = fixture.body(), write = body.nodes.find(node => node.operation === 'compoundWrite');
      assert.equal(checkSelectedScalarBody(fixture.compilation, body, fixture.counter).sourceAdmission, false);
      const arithmetic = ['+=', '-=', '*='].includes(operation);
      const failures = body.exceptionalCompletions.filter(row => row.instruction === write.id);
      assert.equal(failures.length, Number(arithmetic) + Number(narrow));
      if (arithmetic) assert.deepEqual(failures[0].condition, write.arithmeticOverflow);
      if (narrow) {
        assert.deepEqual(failures.at(-1).condition, write.narrowingOverflow);
        assert.equal(write.resultConversion.checkedContext, true);
        if (arithmetic) {
          assert.deepEqual(write.narrowingOverflow.args[0], write.arithmeticOverflow);
          assert.deepEqual(write.narrowingOverflow.args[1], { kind: 'Constant', sort: 'Bool', value: false });
          assert.deepEqual(failures[0].store, failures[1].store);
        }
      }
      for (const field of ['arithmeticOverflow', 'narrowingOverflow']) {
        if (!write[field]) continue;
        const forged = structuredClone(body);
        forged.nodes[write.id][field] = { kind: 'Constant', sort: 'Bool', value: false };
        assert.throws(() => checkSelectedScalarBody(fixture.compilation, forged, fixture.counter));
      }
    }
    for (const operation of ['<<=', '>>=']) {
      const fixture = make(`class C { ${type} F(${type} left, int count) { checked { left ${operation} count; } return left; } }`);
      const body = fixture.body(), write = body.nodes.find(node => node.operation === 'compoundWrite');
      assert.equal(checkSelectedScalarBody(fixture.compilation, body, fixture.counter).sourceAdmission, false);
      assert.equal(body.exceptionalCompletions.filter(row => row.instruction === write.id).length, Number(narrow));
      assert.equal(Object.hasOwn(write, 'arithmeticOverflow'), false);
    }
  }
  const called = make('class C { static byte G(byte left, byte right) { checked { left += right; } return left; } byte F(byte left, byte right) { return G(left, right); } }');
  const calledBody = called.body(), call = calledBody.nodes.find(node => node.operation === 'sourceCall');
  assert.equal(checkSelectedScalarBody(called.compilation, calledBody, called.counter).sourceAdmission, false);
  assert.equal(call.exceptions.length, 2);
  const swapped = structuredClone(calledBody);
  swapped.nodes[call.id].calleeBody.exceptionalCompletions.reverse();
  assert.throws(() => checkSelectedScalarBody(called.compilation, swapped, called.counter));
});

test('same-source scalar call derives result from checked callee and source-ordered arguments', () => {
  const make = (source, otherSource = null) => {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'call.cs', compilation: 'original-call', role: 'source', rawBytes: Buffer.from(source, 'utf8') },
      ...(otherSource === null ? [] : [{ unit: 'provider.cs', compilation: 'original-call', role: 'source', rawBytes: Buffer.from(otherSource, 'utf8') }]),
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const body = () => bindSelectedCsharpScalarBody(compilation, method.declId, {
      counter, typeIndex: compilation.index, declarationMetadata: compilation.bound.declarationMetadata,
      parameterConstraints: compilation.bound.parameterConstraints, typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    return { counter, compilation, body };
  };
  const fixture = make('class C { static int G(int first, int second) { return unchecked(first - second); } int F(int value) { return unchecked(G(value += 1, value += 2)); } }');
  const body = fixture.body(), call = body.nodes.find(node => node.operation === 'sourceCall');
  assert.equal(checkSelectedScalarBody(fixture.compilation, body, fixture.counter).sourceAdmission, false);
  assert.equal(call.term.opcode, 'sub');
  assert.deepEqual(call.term.args, call.inputs.map(id => body.nodes[id].term));
  assert.ok(call.inputs[0] < call.inputs[1]);
  assert.equal(call.calleeBody.nodes[call.calleeBody.returnNode].operation, 'return');
  const forged = structuredClone(body);
  forged.nodes[call.id].term.opcode = 'add';
  assert.throws(() => checkSelectedScalarBody(fixture.compilation, forged, fixture.counter));
  const forgedCallee = structuredClone(body);
  forgedCallee.nodes[call.id].calleeBody.nodes[call.calleeBody.returnNode].term.opcode = 'add';
  assert.throws(() => checkSelectedScalarBody(fixture.compilation, forgedCallee, fixture.counter));
  const named = make('class C { static int G(int first, int second) { return unchecked(first - second); } int F(int value) { return unchecked(G(second: value += 1, first: value += 2)); } }');
  const namedBody = named.body(), namedCall = namedBody.nodes.find(node => node.operation === 'sourceCall');
  assert.equal(checkSelectedScalarBody(named.compilation, namedBody, named.counter).sourceAdmission, false);
  assert.deepEqual(namedCall.formalOrder, [1, 0]);
  assert.ok(namedCall.inputs[0] < namedCall.inputs[1]);
  assert.deepEqual(namedCall.term.args, [namedBody.nodes[namedCall.inputs[1]].term, namedBody.nodes[namedCall.inputs[0]].term]);
  const reordered = structuredClone(namedBody);
  reordered.nodes[namedCall.id].formalOrder = [0, 1];
  assert.throws(() => checkSelectedScalarBody(named.compilation, reordered, named.counter));
  assert.throws(() => make('class C { static int G(int first, int second) { return first; } int F(int x) { return G(first: x, x); } }').body());
  assert.throws(() => make('class C { static int G(int first, int second) { return first; } int F(int x) { return G(first: x, first: x); } }').body());
  const optional = make('class C { static int G(int first = 9, int second = 2) { return unchecked(first - second); } int F(int value) { return unchecked(G(second: value += 1)); } }');
  const optionalBody = optional.body(), optionalCall = optionalBody.nodes.find(node => node.operation === 'sourceCall');
  assert.equal(checkSelectedScalarBody(optional.compilation, optionalBody, optional.counter).sourceAdmission, false);
  assert.deepEqual(optionalCall.formalOrder, [1]);
  assert.equal(optionalCall.defaults[0].formal, 0);
  assert.equal(optionalCall.defaults[0].term.value, '9');
  assert.deepEqual(optionalCall.term.args, [optionalCall.defaults[0].term, optionalBody.nodes[optionalCall.inputs[0]].term]);
  const changedDefault = structuredClone(optionalBody);
  changedDefault.nodes[optionalCall.id].defaults[0].term.value = '10';
  assert.throws(() => checkSelectedScalarBody(optional.compilation, changedDefault, optional.counter));
  for (const source of [
    'class C { static int G(int first = 9, int second = 2) { return unchecked(first - second); } int F() { return G(); } }',
    'class C { static byte G(byte first = 9) { return first; } byte F() { return G(); } }',
  ]) {
    const omitted = make(source);
    assert.equal(checkSelectedScalarBody(omitted.compilation, omitted.body(), omitted.counter).sourceAdmission, false);
  }
  const providerSource = 'class P { public static int G(int value = 9) { return value; } }';
  for (const type of ['int', 'uint', 'long', 'ulong']) for (const operation of ['+', '-', '*']) {
    const guarded = make(`class C { ${type} F(${type} left, ${type} right) { return checked(left ${operation} right); } }`);
    const guardedBody = guarded.body(), failure = guardedBody.exceptionalCompletions[0];
    assert.equal(checkSelectedScalarBody(guarded.compilation, guardedBody, guarded.counter).sourceAdmission, false);
    assert.equal(failure.category, 'System.OverflowException');
    assert.equal(failure.condition.opcode, 'ite');
    assert.deepEqual(failure.store, guardedBody.nodes[failure.instruction].preStore);
    assert.equal(guardedBody.edges.at(-1).completion, 'throw');
    const exceptionalEntry = guardedBody.edges.find(edge => edge.from === failure.instruction && edge.completion === 'throw');
    assert.equal(guardedBody.nodes[exceptionalEntry.to].operation, 'pendingException');
    const terminal = guardedBody.finalFrontiers.find(row => row.kind === 'throw');
    assert.equal(guardedBody.nodes[terminal.instruction].operation, 'resumeException');
    assert.equal(terminal.sourceInstruction, failure.instruction);
    assert.deepEqual(terminal.store, []);
    assert.deepEqual(guardedBody.nodes.slice(exceptionalEntry.to + 1, terminal.instruction).map(node => node.operation),
      ['endParameter', 'endParameter']);
    assert.deepEqual(guardedBody.edges.find(edge => edge.from === failure.instruction && edge.completion === 'normal').branch,
      { source: failure.instruction, outcome: 'normal' });
    const forged = structuredClone(guardedBody);
    forged.exceptionalCompletions[0].store = [];
    assert.throws(() => checkSelectedScalarBody(guarded.compilation, forged, guarded.counter));
    const omitted = structuredClone(guardedBody); omitted.exceptionalCompletions = [];
    assert.throws(() => checkSelectedScalarBody(guarded.compilation, omitted, guarded.counter));
    const changedRange = structuredClone(guardedBody);
    changedRange.nodes[failure.instruction].overflow.args[0].args[1].value = '1';
    changedRange.exceptionalCompletions[0].condition = structuredClone(changedRange.nodes[failure.instruction].overflow);
    assert.throws(() => checkSelectedScalarBody(guarded.compilation, changedRange, guarded.counter));
  }
  assert.throws(() => make('class C { int F() { return checked(2147483647 + 1); } }').body());
  const rhsFailure = make('class C { int F(int value) { return checked(value + (value = 3)); } }');
  const rhsBody = rhsFailure.body(), rhsExit = rhsBody.exceptionalCompletions[0];
  assert.equal(checkSelectedScalarBody(rhsFailure.compilation, rhsBody, rhsFailure.counter).sourceAdmission, false);
  assert.equal(rhsExit.store[0].value.value, '3');
  const guardedWrite = make('class C { int F(int value, int delta) { value = checked(value + delta); return value; } }');
  const writeBody = guardedWrite.body(), writeExit = writeBody.exceptionalCompletions[0];
  assert.equal(checkSelectedScalarBody(guardedWrite.compilation, writeBody, guardedWrite.counter).sourceAdmission, false);
  assert.equal(writeExit.store[0].value.kind, 'Bound');
  const normalWrite = writeBody.nodes.find(node => node.operation === 'write');
  assert.equal(normalWrite.term.opcode, 'add');
  assert.equal(writeBody.edges.find(edge => edge.from === writeExit.instruction && edge.completion === 'normal').to, normalWrite.id);
  for (const type of ['int', 'long']) {
    const negated = make(`class C { ${type} F(${type} value) { return checked(-value); } }`);
    assert.equal(checkSelectedScalarBody(negated.compilation, negated.body(), negated.counter).sourceAdmission, false);
  }
  for (const source of [
    'class C { static int G(int value) { return checked(value + 1); } int F(int value) { return G(value); } }',
    'class C { static int G(int value) { if (unchecked(value > 0)) { return checked(value + 1); } return value; } int F(int value) { return G(value); } }',
    'class C { static int G(int value) { return checked(checked(value + 1) * 2); } static int H(int value) { return G(value); } int F(int value) { return H(value); } }',
    'class C { static void G(int value) { value = checked(value + 1); } int F(int value) { G(value); return value; } }',
    'class C { static int G(int value) { return checked(value + 1); } int F(int value) { return G(unchecked(value += 1)); } }',
  ]) {
    const propagated = make(source), propagatedBody = propagated.body();
    assert.equal(checkSelectedScalarBody(propagated.compilation, propagatedBody, propagated.counter).sourceAdmission, false);
    const call = propagatedBody.nodes.find(node => ['sourceCall', 'sourceCallVoid'].includes(node.operation));
    assert.ok(call.exceptions.length > 0);
    assert.equal(propagatedBody.exceptionalCompletions.length, call.exceptions.length);
    assert.deepEqual(propagatedBody.exceptionalCompletions[0].store, call.preStore);
    const dropped = structuredClone(propagatedBody); dropped.nodes[call.id].exceptions = [];
    assert.throws(() => checkSelectedScalarBody(propagated.compilation, dropped, propagated.counter));
    const guard = structuredClone(propagatedBody);
    guard.nodes[call.id].exceptions[0].condition = { kind: 'Constant', sort: 'Bool', value: false };
    guard.exceptionalCompletions[0].condition = structuredClone(guard.nodes[call.id].exceptions[0].condition);
    assert.throws(() => checkSelectedScalarBody(propagated.compilation, guard, propagated.counter));
  }
  for (const [type, spelling, expected] of [
    ['int', '-1', '-1'], ['int', '+7', '7'], ['int', '-2147483648', '-2147483648'],
    ['long', '-9223372036854775808L', '-9223372036854775808'],
  ]) {
    const unaryDefault = make(`class C { static ${type} G(${type} value = ${spelling}) { return value; } ${type} F() { return G(); } }`);
    const unaryBody = unaryDefault.body(), call = unaryBody.nodes.find(node => node.operation === 'sourceCall');
    assert.equal(checkSelectedScalarBody(unaryDefault.compilation, unaryBody, unaryDefault.counter).sourceAdmission, false);
    assert.equal(call.defaults[0].term.value, expected);
    const forged = structuredClone(unaryBody);
    forged.nodes[call.id].defaults[0].term.value = '0';
    assert.throws(() => checkSelectedScalarBody(unaryDefault.compilation, forged, unaryDefault.counter));
  }
  assert.throws(() => make('class C { static ulong G(ulong value = -1UL) { return value; } ulong F() { return G(); } }').body());
  const callerSource = 'class C { public static int G(int value = 1) { return value; } int F() { return P.G(); } }';
  assert.equal(providerSource.indexOf('9'), callerSource.indexOf('1'));
  // Actual member dispatch across these units is still unsupported. Different
  // original bytes at the same literal offset must never become default proof.
  const crossUnit = make(callerSource, providerSource);
  assert.throws(() => crossUnit.body());
  const nested = make('class C { static int G(int x) { return unchecked(x + 1); } static int H(int x) { return G(x); } int F(int x) { return H(x); } }');
  assert.equal(checkSelectedScalarBody(nested.compilation, nested.body(), nested.counter).sourceAdmission, false);
  assert.throws(() => make('class C { static int G(int x) { return x; } int F(int G) { return G(1); } }').body());
  assert.throws(() => make('class C { static int G(int x) { return G(x); } int F(int x) { return G(x); } }').body());
  const early = make('class C { static int G(int x) { if (unchecked(x > 0)) { return 1; } return 2; } int F(int x) { return G(x); } }');
  const earlyBody = early.body(), earlyCall = earlyBody.nodes.find(node => node.operation === 'sourceCall');
  assert.equal(checkSelectedScalarBody(early.compilation, earlyBody, early.counter).sourceAdmission, false);
  assert.equal(earlyCall.term.opcode, 'ite');
  assert.equal(earlyCall.term.args[1].value, '1');
  assert.equal(earlyCall.term.args[2].value, '2');
  const droppedEarly = structuredClone(earlyBody);
  droppedEarly.nodes[earlyCall.id].term = structuredClone(earlyCall.term.args[2]);
  assert.throws(() => checkSelectedScalarBody(early.compilation, droppedEarly, early.counter));
  const linear = make(`class C { static int G(int x) { ${';'.repeat(300)} return x; } int F(int x) { return G(x); } }`);
  assert.equal(checkSelectedScalarBody(linear.compilation, linear.body(), linear.counter).sourceAdmission, false);
  for (const source of [
    'class C { static int G(int x) { if (unchecked(x > 0)) { if (unchecked(x > 1)) { return 3; } } return 4; } int F(int x) { return G(x); } }',
    'class C { static int G(int x) { if (unchecked(x > 0)) { return 3; } unchecked { x += 2; } if (unchecked(x > 1)) { return x; } return 4; } int F(int x) { return G(x); } }',
    'class C { static int G(int x) { if (unchecked(x > 0)) { unchecked { x += 1; } } else { return 3; } return x; } int F(int x) { return G(x); } }',
  ]) {
    const paths = make(source);
    assert.equal(checkSelectedScalarBody(paths.compilation, paths.body(), paths.counter).sourceAdmission, false);
  }
  const merged = make('class C { static int G(int x) { if (unchecked(x > 0)) { return 1; } else { return 2; } } int F(int x) { return G(x); } }');
  const mergedBody = merged.body(), mergedCall = mergedBody.nodes.find(node => node.operation === 'sourceCall');
  assert.equal(checkSelectedScalarBody(merged.compilation, mergedBody, merged.counter).sourceAdmission, false);
  assert.equal(mergedCall.calleeBody.nodes[mergedCall.calleeBody.returnNode].operation, 'returnMerge');
  assert.equal(mergedCall.term.opcode, 'ite');
  const voidCall = make('class C { static void G(int value) { unchecked { value += 9; } } int F(int value) { unchecked { G(value += 1); } return value; } }');
  const voidBody = voidCall.body(), voidNode = voidBody.nodes.find(node => node.operation === 'sourceCallVoid');
  assert.equal(checkSelectedScalarBody(voidCall.compilation, voidBody, voidCall.counter).sourceAdmission, false);
  assert.equal(Object.hasOwn(voidNode, 'term'), false);
  assert.deepEqual(voidNode.preStore, voidNode.postStore);
  assert.equal(voidNode.calleeBody.returnNode, null);
  const voidFallthrough = make('class C { static void G(int value) { } void F(int value) { G(value); } }');
  assert.equal(checkSelectedScalarBody(voidFallthrough.compilation, voidFallthrough.body(), voidFallthrough.counter).sourceAdmission, false);
  assert.throws(() => make('class C { static void G() { } void F() { return G(); } }').body());
  assert.throws(() => make('class C { static int state = 1; static int G(int x) { return x; } int F(int x) { return G(x); } }').body());
  assert.throws(() => make('class C { static C() { } static int G(int x) { return x; } int F(int x) { return G(x); } }').body());
});

test('original integral updates bind single storage read and distinct prefix/postfix result', () => {
  const make = source => {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'updates.cs', compilation: 'original-updates', role: 'source', rawBytes: Buffer.from(source, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    return { counter, compilation, body: () => bindSelectedCsharpScalarBody(compilation, method.declId, {
      counter, typeIndex: compilation.index, declarationMetadata: compilation.bound.declarationMetadata,
      parameterConstraints: compilation.bound.parameterConstraints, typeGraph: compilation.typeGraph, languageVersion: [5, 0] }) };
  };
  for (const type of ['sbyte', 'byte', 'short', 'ushort', 'char', 'int', 'uint', 'long', 'ulong']) {
    for (const expression of ['++value', 'value++', '--value', 'value--']) for (const arithmetic of ['unchecked', 'checked']) {
      const fixture = make(`class C { ${type} F(${type} value) { return ${arithmetic}(${expression}); } }`);
      const body = fixture.body(), update = body.nodes.find(node => node.operation === 'update');
      assert.ok(update);
      assert.equal(checkSelectedScalarBody(fixture.compilation, body, fixture.counter).sourceAdmission, false);
      const read = body.nodes[update.input];
      assert.equal(read.operation, 'read');
      assert.deepEqual(update.location, read.location);
      assert.deepEqual(update.term, expression.startsWith('value') ? read.term : update.written);
      if (arithmetic === 'checked') {
        const failure = body.exceptionalCompletions[0];
        assert.equal(failure.instruction, update.id);
        assert.deepEqual(failure.store, update.preStore);
        assert.deepEqual(failure.condition, update.overflow);
        assert.equal(body.nodes[body.finalFrontiers.find(row => row.kind === 'throw').instruction].operation, 'resumeException');
        const wrongGuard = structuredClone(body);
        wrongGuard.nodes[update.id].overflow.args[0].args[1].value = '1';
        assert.throws(() => checkSelectedScalarBody(fixture.compilation, wrongGuard, fixture.counter));
      }
      const forged = structuredClone(body), changed = forged.nodes[update.id];
      changed.written.args[1].value = '2';
      assert.throws(() => checkSelectedScalarBody(fixture.compilation, forged, fixture.counter));
      const wrongResult = structuredClone(body);
      wrongResult.nodes[update.id].term = structuredClone(expression.startsWith('value') ? update.written : read.term);
      assert.throws(() => checkSelectedScalarBody(fixture.compilation, wrongResult, fixture.counter));
    }
  }
  const statement = make('class C { int F(int value) { unchecked { value++; --value; } return value; } }');
  const statementBody = statement.body();
  assert.equal(statementBody.nodes.filter(node => node.operation === 'update').length, 2);
  assert.equal(checkSelectedScalarBody(statement.compilation, statementBody, statement.counter).sourceAdmission, false);
  const conditional = make('class C { int F(bool choice, int value) { return choice ? unchecked(value++) : unchecked(++value); } }');
  const conditionalBody = conditional.body();
  assert.equal(checkSelectedScalarBody(conditional.compilation, conditionalBody, conditional.counter).sourceAdmission, false);
  const updates = conditionalBody.nodes.filter(node => node.operation === 'update');
  assert.equal(updates.length, 2);
  assert.equal(conditionalBody.nodes.filter(node => node.operation === 'read' &&
    canonicalData(node.location) === canonicalData(updates[0].location)).length, 2);
  const join = conditionalBody.nodes.find(node => node.operation === 'conditionalJoin');
  assert.deepEqual(join.term.args[1], updates[0].term);
  assert.deepEqual(join.term.args[2], updates[1].term);
  const changedSignature = structuredClone(conditionalBody);
  changedSignature.nodes[updates[0].id].selected.operation = '--';
  assert.throws(() => checkSelectedScalarBody(conditional.compilation, changedSignature, conditional.counter));
  for (const source of [
    'class C { int F() { int value; return unchecked(value++); } }',
    'class C { int F() { const int value = 1; return unchecked(++value); } }',
    'class C { int F(int value) { return ++value; } }',
  ]) assert.throws(() => make(source).body());
});

test('original decimal signed-minimum tokens bind their combined constant independently of overflow context', () => {
  for (const [type, token, value] of [
    ['int', '2147483648', '-2147483648'], ['int', '02147483648', '-2147483648'],
    ['long', '9223372036854775808', '-9223372036854775808'],
    ['long', '9223372036854775808L', '-9223372036854775808'],
  ]) for (const wrap of [text => text, text => `checked(${text})`, text => `unchecked(${text})`]) {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'minimum.cs', compilation: 'original-minimum', role: 'source',
        rawBytes: Buffer.from(`class C { ${type} F() { const ${type} value = ${wrap('- /* original trivia */ ' + token)}; return value; } }`, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    const body = bindSelectedCsharpScalarBody(compilation, method.declId, { counter, typeIndex: compilation.index,
      declarationMetadata: compilation.bound.declarationMetadata, parameterConstraints: compilation.bound.parameterConstraints,
      typeGraph: compilation.typeGraph, languageVersion: [5, 0] });
    assert.equal(checkSelectedScalarBody(compilation, body, counter).sourceAdmission, false);
    const literal = body.nodes.find(node => node.operation === 'unaryLiteral');
    assert.equal(literal.term.value, value);
    const changed = structuredClone(body);
    changed.nodes[literal.id].term.value = '0';
    assert.throws(() => checkSelectedScalarBody(compilation, changed, counter));
    const missedOperand = structuredClone(body);
    missedOperand.nodes[literal.id].operandOccurrence = structuredClone(literal.operatorOccurrence);
    assert.throws(() => checkSelectedScalarBody(compilation, missedOperand, counter));
  }
});

test('explicit unsigned suffix does not masquerade as the signed minimum literal exception', () => {
  const make = source => {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'unsigned-minus.cs', compilation: 'original-unsigned-minus', role: 'source', rawBytes: Buffer.from(source, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') },
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    return { counter, compilation, body: () => bindSelectedCsharpScalarBody(compilation, method.declId, {
      counter, typeIndex: compilation.index, declarationMetadata: compilation.bound.declarationMetadata,
      parameterConstraints: compilation.bound.parameterConstraints, typeGraph: compilation.typeGraph, languageVersion: [5, 0] }) };
  };
  for (const token of ['2147483648U', '0x80000000U']) {
    const fixture = make(`class C { long F() { const long value = unchecked(-${token}); return value; } }`);
    const body = fixture.body();
    assert.equal(checkSelectedScalarBody(fixture.compilation, body, fixture.counter).sourceAdmission, false);
    assert.equal(body.nodes.some(node => node.operation === 'unaryLiteral'), false);
    const operator = body.nodes.find(node => node.operation === 'numeric');
    assert.equal(operator.type.name, 'long');
    assert.equal(operator.term.opcode, 'neg');
  }
  const invalid = make('class C { long F(ulong value) { return unchecked(-value); } }');
  assert.throws(() => invalid.body());
});

test('original compilation grouping admits sibling source units and excludes foreign source units', () => {
  const counter = createProofCounter();
  const originalUnits = new Map();
  const enumerate = (text, unit) => {
    const root = new SelectedSyntax(Buffer.from(text, 'utf8'), 'csharp', counter).csharpUnit();
    originalUnits.set(unit, { root, role: 'source' });
    return enumerateSelectedDeclarations(root, unit, 'csharp', counter).entries;
  };
  const a = enumerate('class A { B member; Foreign foreign; }', 'A.cs');
  const b = enumerate('class B {}', 'B.cs');
  const foreign = enumerate('class B {} class Foreign {}', 'foreign.cs');
  const groups = new Map([['A.cs', 'original-compilation'], ['B.cs', 'original-compilation'],
    ['foreign.cs', 'independent-compilation']]);
  const index = new SelectedTypeIndex([...a, ...b, ...foreign], [], counter, groups, originalUnits);
  const field = a.find(entry => entry.syntax.kind === 'field');
  assert.ok(field);
  const candidates = index.lookup([], [], 'B', 0, { unit: 'A.cs' });
  assert.deepEqual(index.unique(candidates, field.origin).declId, b.find(entry => entry.syntax.kind === 'type').declId);
  const context = { unit: 'A.cs', owner: field.declId, namespace: [], typeParents: field.declId.parent.types,
    parameterConstraints: new Map(), usingTiers: [], namespacePaths: new Set([canonicalData([])]) };
  assert.deepEqual(index.resolve(field.syntax.type, context).declaration,
    b.find(entry => entry.syntax.kind === 'type').declId);
  assert.deepEqual(index.lookup([], [], 'Foreign', 0, { unit: 'A.cs' }), []);
  const foreignField = a.find(entry => entry.syntax.kind === 'field' && entry.syntax.name.spelling === 'foreign');
  assert.throws(() => index.resolve(foreignField.syntax.type, { ...context, owner: foreignField.declId }));
  assert.throws(() => index.lookup([], [], 'B', 0, { unit: 'unbound.cs' }));
  // Mutating the caller's map cannot relabel original units after index construction.
  groups.set('foreign.cs', 'original-compilation');
  assert.equal(index.lookup([], [], 'B', 0, { unit: 'A.cs' }).length, 1);
  const ambiguous = new SelectedTypeIndex([...a, ...b, ...foreign], [], counter, groups, originalUnits);
  assert.throws(() => ambiguous.unique(ambiguous.lookup([], [], 'B', 0, { unit: 'A.cs' }), field.origin));
  assert.throws(() => ambiguous.resolve(field.syntax.type, context));
});

test('original sibling namespace participates in using binding without importing a foreign compilation namespace', () => {
  const counter = createProofCounter();
  const parse = (text, unit) => {
    const root = new SelectedSyntax(Buffer.from(text, 'utf8'), 'csharp', counter).csharpUnit();
    return { root, enumeration: enumerateSelectedDeclarations(root, unit, 'csharp', counter) };
  };
  const a = parse('using Shared; class A { B member; }', 'A.cs');
  const b = parse('namespace Shared { class B {} } namespace Empty {}', 'B.cs');
  const foreign = parse('namespace Hidden { class Foreign {} }', 'foreign.cs');
  const index = new SelectedTypeIndex([...a.enumeration.entries, ...b.enumeration.entries, ...foreign.enumeration.entries], [], counter,
    new Map([['A.cs', 'same-original-compilation'], ['B.cs', 'same-original-compilation'], ['foreign.cs', 'foreign-compilation']]),
    new Map([['A.cs', { root: a.root, role: 'source' }], ['B.cs', { root: b.root, role: 'source' }],
      ['foreign.cs', { root: foreign.root, role: 'source' }]]));
  const base = { unit: 'A.cs', owner: null, namespace: [], typeParents: [], parameterConstraints: new Map(),
    usingNamespaces: [], usingAliases: new Map(), usingTiers: [] };
  const imports = new SelectedCSharpImports(a.root, a.enumeration, index, base, counter);
  const field = a.enumeration.entries.find(entry => entry.syntax.kind === 'field');
  const context = imports.forOccurrence(field.syntax, { ...base, owner: field.declId, typeParents: field.declId.parent.types });
  assert.deepEqual(index.resolve(field.syntax.type, context).declaration,
    b.enumeration.entries.find(entry => entry.syntax.kind === 'type').declId);
  assert.equal(context.namespacePaths.has(canonicalData(['Hidden'])), false);
  assert.equal(context.namespacePaths.has(canonicalData(['Empty'])), true);
});

function bindFixture(source, csharpLanguageVersion = [5, 0]) {
  const counter = createProofCounter();
  const { originals, enumeration, byDeclaration, index, compilationGroups, bound, types, context, typeGraph, decodedUnits } =
    bindSelectedCsharpCompilation([
      { unit: 'original-test-source', compilation: 'original-test-compilation', role: 'source', rawBytes: Buffer.from(source, 'utf8') },
      { unit: 'original-test-symbolic-fixture', compilation: 'original-test-symbolic-catalogue', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') }
    ], counter);
  const sample = enumeration.find(entry => entry.declId.unit === originals[0].unit && entry.syntax.kind === 'type');
  const environment = { counter, typeIndex: index, decodedUnits, declarationMetadata: bound.declarationMetadata,
    parameterConstraints: bound.parameterConstraints,
    typeGraph,
    compilationGroups,
    objectType: index.primitive('object', context(sample), sample.origin),
    valueTypeRoot: index.catalogueType(['System'], 'ValueType', context(sample), sample.origin),
    enumTypeRoot: index.catalogueType(['System'], 'Enum', context(sample), sample.origin),
    csharpLanguageVersion: [...csharpLanguageVersion], resolveOriginalDefaults: row => {
      const original = originals.find(unit => unit.unit === row.declaration.unit);
      assert.ok(original);
      return { ...row, parameters: row.parameters.map(parameter => {
        if (parameter.defaultSyntax === null) return parameter;
        const expression = parameter.defaultSyntax;
        assert.equal(expression.kind, 'literal', 'fixture default is an original literal production');
        const literal = checkedOriginalLiteral(original.parser.scanner.decoded, expression.token, 'csharp', counter);
        assert.equal(literal.type, 'Int32', 'fixture default uses independently decoded Int32');
        const type = index.primitive('int', context(sample), expression.origin);
        assert.ok(implicitCsharpConversion(type, parameter.type, environment, BigInt(literal.term.value)));
        return { ...parameter, defaultValue: { kind: 'constant', type: parameter.type, value: literal.term,
          originalOccurrence: expression.origin } };
      }) };
    }, delegateSignature: () => null,
    openSourceType: (declaration, actualContext) => index.construct(byDeclaration.get(canonicalData(declaration)), [], actualContext) };
  const members = new SelectedMemberIndex(enumeration, bound, environment);
  const type = name => types.find(value => value.declaration && byDeclaration.get(canonicalData(value.declaration))?.syntax.name?.spelling === name);
  const entry = name => enumeration.find(value => value.syntax.kind === 'method' && value.syntax.name.spelling === name &&
    value.declId.unit === originals[0].unit);
  const group = (receiver, call, caller) => members.lookup(receiver, call.target.name,
    { ...context(caller), currentType: bound.declarationMetadata.get(canonicalData(caller.declId)).declaringType }).candidates;
  const invoke = (group_, call, caller) => {
    const actuals = call.arguments.map(argument => ({ direction: argument.direction, name: argument.name,
      type: index.primitive('int', context(caller), argument.origin), constant: BigInt(argument.expression.token.spelling),
      origin: argument.expression.origin }));
    return bindSelectedInvocation(group_, actuals, null, environment, call).candidate;
  };
  return { types, type, entry, group, invoke, bound, environment, byDeclaration, enumeration };
}

test('generic params infers each original form and retains normal-array preference and return substitution', () => {
  const bind = (expression, { fallback = false, constraint = '', version = [5, 0] } = {}) => {
    const fixture = bindFixture(`class C {
      public T M<T>(params T[] xs) ${constraint} { return xs[0]; }
      ${fallback ? 'public object M(object value) { return value; }' : ''}
    } class Caller { public object Invoke(C receiver, int scalar, int[] values) { return ${expression}; } }`, version);
    const caller = fixture.entry('Invoke'), call = caller.syntax.body.statements[0].value;
    const originalTarget = call.target.kind === 'genericMember' ? call.target.target : call.target;
    const group = fixture.group(fixture.type('C'), { ...call, target: originalTarget }, caller);
    const signature = fixture.bound.declarationMetadata.get(canonicalData(caller.declId));
    const actuals = call.arguments.map(argument => {
      const node = argument.expression;
      if (node.kind === 'name') {
        assert.equal(node.name.spelling, 'values');
        return { direction: argument.direction, name: argument.name, type: signature.parameters[2].type, origin: node.origin };
      }
      assert.equal(node.kind, 'literal');
      return { direction: argument.direction, name: argument.name, type: signature.parameters[1].type,
        constant: BigInt(node.token.spelling), origin: node.origin };
    });
    let explicit = null;
    if (call.target.kind === 'genericMember') {
      assert.equal(call.target.typeArguments.length, 1);
      assert.equal(call.target.typeArguments[0].segments[0].name.spelling, 'int');
      explicit = [signature.parameters[1].type];
    }
    return { fixture, group, actuals, call, bind: () => bindSelectedInvocation(group, actuals, explicit, fixture.environment, call) };
  };
  for (const [expression, expanded, count] of [
    ['receiver.M(1)', true, 1], ['receiver.M(1, 2)', true, 2],
    ['receiver.M(values)', false, null], ['receiver.M<int>()', true, 0],
  ]) {
    for (const fallback of [false, true]) {
      const row = bind(expression, { fallback }), selected = row.bind();
      const original = row.group.find(candidate => candidate.genericArity === 1);
      assert.deepEqual(selected.candidate.declaration, original.declaration);
      assert.equal(selected.expanded, expanded);
      assert.equal(selected.candidate.genericArguments[0].name, 'int');
      assert.equal(selected.candidate.returnType.name, 'int');
      assert.equal(selected.candidate.parameters[0].type.category, 'array');
      assert.equal(selected.candidate.parameters[0].type.element.name, 'int');
      if (expanded) {
        assert.equal(selected.paramsArray.allocation, 'freshArray'); assert.equal(selected.paramsArray.count, count);
        assert.equal(selected.paramsArray.elementType.name, 'int'); assert.equal(selected.paramsArray.sourceIndices.length, count);
      } else assert.equal(selected.paramsArray, null, 'Actual array must stay normal; do not add both forms of one original.');
      const token = csharpInvocationForm(selected.candidate, row.actuals, row.fixture.environment, expanded);
      assert.ok(token);
      assert.strictEqual(selectCsharpInvocationForms([token], row.actuals, row.fixture.environment, row.call.origin).candidate, selected.candidate);
      for (const fake of [{}, structuredClone(token)])
        assert.throws(() => selectCsharpInvocationForms([fake], row.actuals, row.fixture.environment, row.call.origin), error => isSourceDenialCode(error, 'INVALID_BINDING'));
      assert.throws(() => selectCsharpInvocationForms([token], [...row.actuals], row.fixture.environment, row.call.origin), error => isSourceDenialCode(error, 'INVALID_BINDING'));
      assert.throws(() => selectCsharpInvocationForms([token], row.actuals, { ...row.fixture.environment }, row.call.origin), error => isSourceDenialCode(error, 'INVALID_BINDING'));
    }
  }
  assert.throws(() => bind('receiver.M()').bind(), error => isSourceDenialCode(error, 'INVALID_BINDING'));
  for (const version of [[5, 0], [7, 2], [7, 3], [8, 0]]) {
    const row = bind('receiver.M(1)', { fallback: true, constraint: 'where T : class', version });
    if (version[0] < 7 || version[0] === 7 && version[1] < 3)
      assert.throws(row.bind, error => isSourceDenialCode(error, 'CONSTRAINT_MISMATCH'));
    else {
      const selected = row.bind();
      assert.deepEqual(selected.candidate.declaration, row.group.find(candidate => candidate.genericArity === 0).declaration);
      assert.equal(selected.expanded, false); assert.equal(selected.candidate.returnType.name, 'object');
    }
  }
});

test('own generic constraints use actual pre7.3 selection and7.3+ candidate pruning', () => {
  const program = `class C {
    public int F<T>(T value) where T : class { return 1; }
    public int F(object value) { return 2; }
  } class Caller { public int Invoke(C receiver) { return receiver.F(1); } }`;
  for (const version of [[5, 0], [7, 2], [7, 3], [8, 0]]) {
    const fixture = bindFixture(program, version);
    const caller = fixture.entry('Invoke'), call = caller.syntax.body.statements[0].value;
    const group = fixture.group(fixture.type('C'), call, caller);
    assert.equal(group.length, 2);
    if (version[0] < 7 || version[0] === 7 && version[1] < 3) {
      assert.throws(() => fixture.invoke(group, call, caller), error => isSourceDenialCode(error, 'CONSTRAINT_MISMATCH'));
    } else {
      const selected = fixture.invoke(group, call, caller);
      const originalFallback = group.find(candidate => candidate.genericArity === 0);
      assert.deepEqual(selected.declaration, originalFallback.declaration);
      assert.equal(selected.parameters[0].type.name, 'object');
    }
    assert.deepEqual(fixture.environment.csharpLanguageVersion, version);
  }
});

test('old-profile own constraint failure matters only for the chosen original member', () => {
  for (const version of [[5, 0], [7, 2], [7, 3], [8, 0]]) {
    const fixture = bindFixture(`class C {
      public int F<T>(T value) where T : class { return 1; }
      public int F(int value) { return 2; }
    } class Caller { public int Invoke(C receiver) { return receiver.F(1); } }`, version);
    const caller = fixture.entry('Invoke'), call = caller.syntax.body.statements[0].value;
    const group = fixture.group(fixture.type('C'), call, caller);
    const selected = fixture.invoke(group, call, caller);
    assert.deepEqual(selected.declaration, group.find(candidate => candidate.genericArity === 0).declaration);
    assert.equal(selected.parameters[0].type.name, 'int');
  }
});

test('deferred own constraints preserve the actual enclosing generic substitutions', () => {
  for (const version of [[5, 0], [7, 3]]) {
    const fixture = bindFixture(`class C<U> {
      public int F<T>(T value, U second) where T : class { return 1; }
      public int F(object value, U second) { return 2; }
    } class Caller { public int Invoke(C<int> receiver) { return receiver.F(1, 2); } }`, version);
    const caller = fixture.entry('Invoke'), call = caller.syntax.body.statements[0].value;
    const receiver = fixture.bound.declarationMetadata.get(canonicalData(caller.declId)).parameters[0].type;
    const group = fixture.group(receiver, call, caller);
    if (version[0] === 5) {
      assert.throws(() => fixture.invoke(group, call, caller), error => isSourceDenialCode(error, 'CONSTRAINT_MISMATCH'));
    } else {
      const selected = fixture.invoke(group, call, caller);
      assert.deepEqual(selected.declaration, group.find(candidate => candidate.genericArity === 0).declaration);
      assert.equal(selected.parameters[1].type.name, 'int');
      const enclosing = fixture.bound.declarationMetadata.get(canonicalData(receiver.declaration)).typeParameters[0];
      assert.equal(selected.substitutions.get(canonicalData(enclosing.declId)).name, 'int');
    }
  }
});

test('valid generic constraints retain the better original generic candidate across versions', () => {
  for (const version of [[5, 0], [7, 3]]) {
    const fixture = bindFixture(`class C {
      public int F<T>(T value) where T : struct { return 1; }
      public int F(object value) { return 2; }
    } class Caller { public int Invoke(C receiver) { return receiver.F(1); } }`, version);
    const caller = fixture.entry('Invoke'), call = caller.syntax.body.statements[0].value;
    const group = fixture.group(fixture.type('C'), call, caller);
    const selected = fixture.invoke(group, call, caller);
    assert.deepEqual(selected.declaration, group.find(candidate => candidate.genericArity === 1).declaration);
    assert.equal(selected.parameters[0].type.name, 'int');
  }
});

test('no generic fallback and missing profile or constraint evidence remain hard failures', () => {
  const program = `class C { public int F<T>(T value) where T : class { return 1; } }
    class Caller { public int Invoke(C receiver) { return receiver.F(1); } }`;
  for (const [version, expected] of [[[5, 0], 'CONSTRAINT_MISMATCH'], [[7, 3], 'INVALID_BINDING']]) {
    const fixture = bindFixture(program, version);
    const caller = fixture.entry('Invoke'), call = caller.syntax.body.statements[0].value;
    const group = fixture.group(fixture.type('C'), call, caller);
    assert.throws(() => fixture.invoke(group, call, caller), error => isSourceDenialCode(error, expected));
  }
  for (const missing of ['csharpLanguageVersion', 'parameterConstraints']) {
    const fixture = bindFixture(program, [7, 3]);
    const caller = fixture.entry('Invoke'), call = caller.syntax.body.statements[0].value;
    const group = fixture.group(fixture.type('C'), call, caller);
    fixture.environment[missing] = missing === 'parameterConstraints' ? new Map() : undefined;
    assert.throws(() => fixture.invoke(group, call, caller), error => isSourceDenialCode(error, 'INVALID_BINDING'));
  }
  const inheritedVersion = new Array(2);
  Object.setPrototypeOf(inheritedVersion, { 0: 5, 1: 0 });
  for (const invalid of [new Array(2), [, 0], [5, ,], inheritedVersion, [NaN, 0], [Infinity, 0], [5, -1], [5, 0.5]]) {
    const fixture = bindFixture(program);
    const caller = fixture.entry('Invoke'), call = caller.syntax.body.statements[0].value;
    const group = fixture.group(fixture.type('C'), call, caller);
    fixture.environment.csharpLanguageVersion = invalid;
    assert.throws(() => fixture.invoke(group, call, caller), error => isSourceDenialCode(error, 'INVALID_BINDING'));
  }
});

test('applicable derived declaration suppresses exact base conversion only after applicability', () => {
  const fixture = bindFixture(`class Base { public int F(int value) { return 0; } }
    class Derived : Base { public int F(double value) { return 0; } }
    class Caller { public int Invoke(Derived receiver) { return receiver.F(1); } }`);
  const caller = fixture.entry('Invoke'), call = caller.syntax.body.statements[0].value;
  const selected = fixture.invoke(fixture.group(fixture.type('Derived'), call, caller), call, caller);
  assert.deepEqual(selected.declaringType.declaration, fixture.type('Derived').declaration);
  assert.equal(selected.parameters[0].type.name, 'double');
});

test('inapplicable derived declaration retains applicable original base method', () => {
  const fixture = bindFixture(`class Base { public int F(int value) { return 0; } }
    class Derived : Base { public int F(string value) { return 0; } }
    class Caller { public int Invoke(Derived receiver) { return receiver.F(1); } }`);
  const caller = fixture.entry('Invoke'), call = caller.syntax.body.statements[0].value;
  const selected = fixture.invoke(fixture.group(fixture.type('Derived'), call, caller), call, caller);
  assert.deepEqual(selected.declaringType.declaration, fixture.type('Base').declaration);
});

test('same-signature derived required formal does not hide an applicable original optional base formal', () => {
  const fixture = bindFixture(`class Base { public int F(int value = 0) { return 0; } }
    class Derived : Base { public int F(int value) { return 0; } }
    class Caller { public int Invoke(Derived receiver) { return receiver.F(); } }`);
  const caller = fixture.entry('Invoke'), call = caller.syntax.body.statements[0].value;
  const group = fixture.group(fixture.type('Derived'), call, caller);
  assert.equal(group.length, 2);
  const selected = fixture.invoke(group, call, caller);
  assert.deepEqual(selected.declaringType.declaration, fixture.type('Base').declaration);
  assert.deepEqual(selected.parameters[0].defaultValue.originalOccurrence,
    selected.parameters[0].defaultSyntax.origin);
});
test('applicable class other than original Object suppresses an interface candidate', () => {
  const fixture = bindFixture(`class C { public int F(double value) { return 0; } }
    interface I { int F(int value); }
    class Caller { public int Invoke<T>(T receiver) where T : C, I { return receiver.F(1); } }`);
  const caller = fixture.entry('Invoke'), call = caller.syntax.body.statements[0].value;
  const receiver = fixture.bound.declarationMetadata.get(canonicalData(caller.declId)).parameters[0].type;
  const group = fixture.group(receiver, call, caller);
  const selected = fixture.invoke(group, call, caller);
  assert.deepEqual(selected.declaringType.declaration, fixture.type('C').declaration);
});

test('original Object is exempt from class/interface suppression', () => {
  const fixture = bindFixture(`interface I { bool Equals(int value); }
    class Caller { public bool Invoke<T>(T receiver) where T : I { return receiver.Equals(1); } }`);
  const caller = fixture.entry('Invoke'), call = caller.syntax.body.statements[0].value;
  const receiver = fixture.bound.declarationMetadata.get(canonicalData(caller.declId)).parameters[0].type;
  const group = fixture.group(receiver, call, caller);
  const selected = fixture.invoke(group, call, caller);
  assert.deepEqual(selected.declaringType.declaration, fixture.type('I').declaration);
});

test('most-derived reduction distinguishes actual constructed generic base arguments', () => {
  const fixture = bindFixture(`class Base<T> { public int F(T value) { return 0; } }
    class Derived : Base<int> { public int F(object value) { return 0; } }
    class Caller { Base<double> other; public int Invoke(Derived receiver) { return receiver.F(1); } }`);
  const caller = fixture.entry('Invoke'), call = caller.syntax.body.statements[0].value;
  const doubleBase = [...fixture.bound.storageMetadata.values()].map(row => row.type).find(type =>
    type.arguments?.length === 1 && type.arguments[0].name === 'double');
  assert.ok(doubleBase);
  const group = [...fixture.group(fixture.type('Derived'), call, caller), ...fixture.group(doubleBase, call, caller)];
  const selected = fixture.invoke(group, call, caller);
  assert.deepEqual(selected.declaringType.declaration, doubleBase.declaration);
  assert.equal(selected.declaringType.arguments[0].name, 'double');
});
test('predefined signatures and original implicit constructor keep their own catalogue/declaration identities', () => {
  const fixture = bindFixture(`class Caller { public int Invoke() { return 1 + 2; } }`);
  const caller = fixture.entry('Invoke'), expression = caller.syntax.body.statements[0].value;
  const int = fixture.environment.typeIndex.primitive('int', { unit: caller.declId.unit }, expression.origin);
  const selected = bindSelectedPredefinedOperator(expression, [expression.left, expression.right].map(node =>
    ({ direction: 'value', name: null, type: int, constant: BigInt(node.token.spelling), origin: node.origin })),
    { ...fixture.environment, checkedArithmeticContext: false }, { unit: caller.declId.unit });
  assert.deepEqual(selected.candidate.parameters[0].type.declaration, int.declaration);
  assert.deepEqual(selected.resultType.declaration, int.declaration);
  assert.equal(fixture.environment.decodedUnits.get(caller.declId.unit).text.slice(...selected.operatorOccurrence.utf16), '+');
  assert.throws(() => bindSelectedPredefinedOperator({ ...expression, operation: '-' },
    [expression.left, expression.right].map(node => ({ direction: 'value', name: null, type: int,
      constant: BigInt(node.token.spelling), origin: node.origin })),
    { ...fixture.environment, checkedArithmeticContext: false }, { unit: caller.declId.unit }));
  assert.equal(selected.candidate.declaration, undefined);
  const objectRow = fixture.bound.declarationMetadata.get(canonicalData(fixture.environment.objectType.declaration));
  const constructor = objectRow.constructors[0];
  assert.ok(constructor);
  const constructed = selectCsharpOverload([constructor], [], fixture.environment, expression.origin).candidate;
  assert.deepEqual(constructed.declaration, constructor.declaration);
  assert.equal(constructed.category, 'constructor');
});

test('compound operator signature binds its authentic complete token without claiming location conversion', () => {
  const fixture = bindFixture(`class Caller { public int Invoke(int left, int right) { left += right; return left; } }`);
  const caller = fixture.entry('Invoke'), expression = caller.syntax.body.statements[0].expression;
  const row = fixture.bound.declarationMetadata.get(canonicalData(caller.declId));
  const operands = row.parameters.map((parameter, index) => ({ type: parameter.type,
    direction: 'value', name: null, origin: [expression.left, expression.right][index].origin }));
  const environment = { ...fixture.environment, checkedArithmeticContext: false };
  const selected = bindSelectedPredefinedOperator(expression, operands, environment, { unit: caller.declId.unit });
  assert.equal(selected.intrinsic.operation, '+');
  assert.equal(fixture.environment.decodedUnits.get(caller.declId.unit).text.slice(...selected.operatorOccurrence.utf16), '+=');
  assert.equal(selected.compoundAssignment.resultConversion, 'UNBOUND');
  assert.deepEqual(selected.compoundAssignment.locationOccurrence, expression.left.origin);
  assert.throws(() => bindSelectedPredefinedOperator({ ...expression, kind: 'binary', operation: '+' },
    operands, environment, { unit: caller.declId.unit }));
  assert.throws(() => bindSelectedPredefinedOperator({ ...expression, operation: '-=' },
    operands, environment, { unit: caller.declId.unit }));
});

test('enum addition binds original underlying declaration and lifted nullable result', () => {
  const fixture = bindFixture(`enum E { A } class Caller {
    public E? Invoke(E? left, int? right) { return left + right; }
  }`);
  const caller = fixture.entry('Invoke'), expression = caller.syntax.body.statements[0].value;
  const row = fixture.bound.declarationMetadata.get(canonicalData(caller.declId));
  const selected = bindSelectedPredefinedOperator(expression, row.parameters.map((parameter, index) => ({
    type: parameter.type, direction: 'value', name: null, origin: [expression.left, expression.right][index].origin
  })), { ...fixture.environment, checkedArithmeticContext: false }, { unit: caller.declId.unit });
  assert.equal(selected.resultType.category, 'nullable');
  assert.deepEqual(selected.resultType.element.declaration, fixture.type('E').declaration);
  assert.equal(selected.semantics.kind, 'nullableArithmetic');
  assert.equal(selected.semantics.underlying.underlyingType.name, 'int');
  assert.deepEqual(selected.semantics.underlying.declarationOccurrence,
    fixture.bound.declarationMetadata.get(canonicalData(fixture.type('E').declaration)).origin);
});

test('normal try finally preserves ordered store effects and independently requires every finalizer instruction', () => {
  const make = source => {
    const counter = createProofCounter();
    const compilation = bindSelectedCsharpCompilation([
      { unit: 'finally.cs', compilation: 'original-finally', role: 'source', rawBytes: Buffer.from(source, 'utf8') },
      { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture, 'utf8') }
    ], counter);
    const method = compilation.enumeration.find(entry => entry.syntax.kind === 'method' && entry.syntax.name.spelling === 'F');
    return { compilation, counter, body: () => bindSelectedCsharpScalarBody(compilation, method.declId, {
      counter, typeIndex: compilation.index, declarationMetadata: compilation.bound.declarationMetadata,
      parameterConstraints: compilation.bound.parameterConstraints, typeGraph: compilation.typeGraph, languageVersion: [5, 0] }) };
  };
  const fixture = make('class C { int F(int value) { try { value = unchecked(value + 1); } finally { value = unchecked(value * 2); } return value; } }');
  const body = fixture.body();
  assert.equal(checkSelectedScalarBody(fixture.compilation, body, fixture.counter).sourceAdmission, false);
  const markers = body.nodes.filter(node => ['tryEnter', 'finallyEnter', 'finallyLeave'].includes(node.operation));
  assert.deepEqual(markers.map(node => node.operation), ['tryEnter', 'finallyEnter', 'finallyLeave']);
  assert.equal(body.nodes[body.returnNode].term.opcode, 'mul');
  assert.equal(body.nodes[body.returnNode].term.args[0].opcode, 'add');
  const forged = structuredClone(body);
  forged.nodes[markers[1].id].operation = 'empty';
  assert.throws(() => checkSelectedScalarBody(fixture.compilation, forged, fixture.counter));
  const bypass = structuredClone(body);
  bypass.edges.find(edge => edge.from === markers[0].id).to = markers[2].id;
  assert.throws(() => checkSelectedScalarBody(fixture.compilation, bypass, fixture.counter));
  const contextual = make('class C { int F(int value) { int outer = 3; try { return value; } finally { int local = outer; try { local = unchecked(local + 1); } finally { int nested = local; outer = nested; } value = local; } } }');
  const contextualBody = contextual.body();
  assert.equal(checkSelectedScalarBody(contextual.compilation, contextualBody, contextual.counter).sourceAdmission, false);
  const contextualPending = contextualBody.nodes.find(node => node.operation === 'pendingReturn');
  assert.equal(contextualBody.nodes[contextualBody.returnNode].input, contextualPending.input);
  assert.deepEqual(contextualBody.nodes[contextualBody.returnNode].term, contextualPending.term);
  const contextualEntries = contextualBody.nodes.filter(node => node.operation === 'finallyEnter');
  const contextualWrites = contextualBody.nodes.filter(node => node.sourceKind === 'local' && node.operation === 'write');
  assert.equal(contextualEntries.length, 2);
  assert.equal(contextualWrites.length, 3);
  assert.equal(Object.hasOwn(contextualWrites[0].location, 'finalizer'), false);
  assert.deepEqual(contextualWrites[1].location.finalizer, {
    entry: contextualEntries[0].id, incoming: contextualEntries[0].incoming, outer: null
  });
  assert.deepEqual(contextualWrites[2].location.finalizer, {
    entry: contextualEntries[1].id, incoming: contextualEntries[1].incoming,
    outer: contextualWrites[1].location.finalizer
  });
  for (const local of contextualWrites) {
    const end = contextualBody.nodes.find(node => node.operation === 'endLocal' &&
      canonicalData(node.location.declaration) === canonicalData(local.location.declaration));
    assert.deepEqual(end.location, local.location);
    for (const use of contextualBody.nodes.filter(node => node.location &&
        canonicalData(node.location.declaration) === canonicalData(local.location.declaration)))
      assert.deepEqual(use.location, local.location);
  }
  const wrongIncoming = structuredClone(contextualBody);
  wrongIncoming.nodes[contextualEntries[0].id].incoming = 0;
  assert.throws(() => checkSelectedScalarBody(contextual.compilation, wrongIncoming, contextual.counter));
  const lostContext = structuredClone(contextualBody);
  delete lostContext.nodes[contextualWrites[1].id].location.finalizer;
  assert.throws(() => checkSelectedScalarBody(contextual.compilation, lostContext, contextual.counter));
  const wrongEnclosing = structuredClone(contextualBody);
  wrongEnclosing.nodes[contextualEntries[1].id].outerFinalizer = null;
  assert.throws(() => checkSelectedScalarBody(contextual.compilation, wrongEnclosing, contextual.counter));
  const saved = make('class C { int F(int value) { int outer = 3; try { int inner = 1; return unchecked(value += inner); } finally { value = outer; outer = 9; } } }');
  const savedBody = saved.body(), pending = savedBody.nodes.find(node => node.operation === 'pendingReturn');
  assert.equal(checkSelectedScalarBody(saved.compilation, savedBody, saved.counter).sourceAdmission, false);
  assert.ok(pending);
  assert.equal(savedBody.nodes[savedBody.returnNode].input, pending.input);
  assert.deepEqual(savedBody.nodes[savedBody.returnNode].term, pending.term);
  assert.ok(savedBody.nodes.find(node => node.operation === 'finallyLeave').id < savedBody.returnNode);
  const changedReturn = structuredClone(savedBody);
  changedReturn.nodes[changedReturn.returnNode].input = savedBody.nodes.findLast(node => node.operation === 'write').id;
  changedReturn.nodes[changedReturn.returnNode].term = savedBody.nodes[changedReturn.nodes[changedReturn.returnNode].input].term;
  assert.throws(() => checkSelectedScalarBody(saved.compilation, changedReturn, saved.counter));
  const emptyReturn = make('class C { void F(int value) { try { return; } finally { value = 9; } } }');
  const emptyBody = emptyReturn.body();
  assert.ok(emptyBody.nodes.some(node => node.operation === 'pendingReturnVoid'));
  assert.equal(checkSelectedScalarBody(emptyReturn.compilation, emptyBody, emptyReturn.counter).sourceAdmission, false);
  const nested = make('class C { int F(int value) { try { try { return unchecked(value += 1); } finally { value = unchecked(value * 2); } } finally { value = unchecked(value + 3); } } }');
  const nestedBody = nested.body(), pendingRows = nestedBody.nodes.filter(node => node.operation === 'pendingReturn');
  assert.equal(pendingRows.length, 2);
  assert.equal(checkSelectedScalarBody(nested.compilation, nestedBody, nested.counter).sourceAdmission, false);
  assert.deepEqual(pendingRows.map(node => node.input), [pendingRows[0].input, pendingRows[0].input]);
  assert.equal(pendingRows[0].term.opcode, 'add');
  const finalizerOperators = nestedBody.nodes.filter(node => node.operation === 'numeric');
  assert.deepEqual(finalizerOperators.map(node => node.selected.operation), ['*', '+']);
  assert.deepEqual(finalizerOperators.map(node => nested.compilation.originals.find(unit => unit.unit === 'finally.cs')
    .parser.scanner.decoded.text.slice(...node.operatorOccurrence.utf16)), ['*', '+']);
  assert.equal(nestedBody.nodes[nestedBody.returnNode].input, pendingRows[0].input);
  const called = make('class C { static int G(int value) { try { return unchecked(value + 1); } finally { value = 9; } } int F(int value) { return G(value); } }');
  const calledBody = called.body(), call = calledBody.nodes.find(node => node.operation === 'sourceCall');
  assert.equal(checkSelectedScalarBody(called.compilation, calledBody, called.counter).sourceAdmission, false);
  assert.equal(call.term.opcode, 'add');
  assert.ok(call.calleeBody.nodes.some(node => node.operation === 'pendingReturn'));
  assert.ok(call.calleeBody.nodes.find(node => node.operation === 'finallyLeave').id < call.calleeBody.returnNode);
  for (const source of [
    'class C { int F(int value) { try { if (unchecked(value > 0)) return value; } finally { int local = value; value = unchecked(local + 2); } return value; } }',
    'class C { int F(int value) { try { if (unchecked(value > 0)) return value; else return unchecked(value + 1); } finally { int local = value; value = unchecked(local + 2); } } }',
    'class C { int F(int value) { try { try { if (unchecked(value > 0)) return value; else return unchecked(value + 1); } finally { int local = value; value = local; } } finally { int outer = value; value = outer; } } }',
    'class C { void F(int value) { try { if (unchecked(value > 0)) return; } finally { int local = value; value = local; } } }'
  ]) {
    const mixed = make(source), mixedBody = mixed.body();
    assert.equal(checkSelectedScalarBody(mixed.compilation, mixedBody, mixed.counter).sourceAdmission, false);
    assert.deepEqual(mixedBody.finalFrontiers.filter(row => row.kind === 'return' || row.kind === 'returnVoid').map(row => row.instruction),
      mixedBody.nodes.filter(node => node.operation === 'return' || node.operation === 'returnVoid').map(node => node.id));
    assert.ok(mixedBody.finalFrontiers.every(row => !mixedBody.nodes[row.instruction].operation.startsWith('pending')));
    const entries = mixedBody.nodes.filter(node => node.operation === 'finallyEnter');
    assert.ok(entries.length >= 2);
    const allocations = mixedBody.locations.filter(row => row.location.finalizer);
    assert.equal(new Set(allocations.map(row => canonicalData(row.location))).size, allocations.length);
    assert.equal(allocations.length, entries.length);
    assert.ok(allocations.length > new Set(allocations.map(row => canonicalData(row.location.declaration))).size);
    for (const entry of entries) {
      assert.equal(mixedBody.edges.filter(edge => edge.to === entry.id).length, 1);
      assert.equal(mixedBody.edges.find(edge => edge.to === entry.id).from, entry.incoming);
    }
    const omitClone = structuredClone(mixedBody);
    omitClone.nodes[entries[1].id].operation = 'empty';
    assert.throws(() => checkSelectedScalarBody(mixed.compilation, omitClone, mixed.counter));
    const reuseAllocation = structuredClone(mixedBody);
    const writes = reuseAllocation.nodes.filter(node => node.operation === 'write' && node.sourceKind === 'local');
    writes[1].location = structuredClone(writes[0].location);
    assert.throws(() => checkSelectedScalarBody(mixed.compilation, reuseAllocation, mixed.counter));
    const omitFinal = structuredClone(mixedBody);
    omitFinal.finalFrontiers.pop();
    assert.throws(() => checkSelectedScalarBody(mixed.compilation, omitFinal, mixed.counter));
    const pendingAsFinal = structuredClone(mixedBody);
    pendingAsFinal.finalFrontiers[0].instruction = mixedBody.nodes.find(node => node.operation.startsWith('pendingReturn')).id;
    assert.throws(() => checkSelectedScalarBody(mixed.compilation, pendingAsFinal, mixed.counter));
  }
  const mixedCalled = make('class C { static int G(int value) { try { if (unchecked(value > 0)) return value; else return unchecked(value + 1); } finally { int local = value; value = local; } } int F(int value) { return G(value); } }');
  const mixedCalledBody = mixedCalled.body(), mixedCall = mixedCalledBody.nodes.find(node => node.operation === 'sourceCall');
  assert.equal(checkSelectedScalarBody(mixedCalled.compilation, mixedCalledBody, mixedCalled.counter).sourceAdmission, false);
  assert.equal(mixedCall.calleeBody.nodes.filter(node => node.operation === 'finallyEnter').length, 2);
  assert.equal(mixedCall.term.opcode, 'ite');
  for (const source of [
    'class C { int F(int value) { try { return value; } finally { int local = checked(value + 1); value = local; } } }',
    'class C { int F(int value) { try { if (unchecked(value > 0)) return value; else return unchecked(value + 1); } finally { int local = checked(value + 1); value = local; } } }'
  ]) {
    const replacement = make(source), replacementBody = replacement.body();
    assert.equal(checkSelectedScalarBody(replacement.compilation, replacementBody, replacement.counter).sourceAdmission, false);
    const pendingReturns = replacementBody.nodes.filter(node => node.operation === 'pendingReturn');
    const finalReturns = replacementBody.finalFrontiers.filter(row => row.kind === 'return');
    const escapes = replacementBody.finalFrontiers.filter(row => row.kind === 'throw');
    assert.equal(escapes.length, pendingReturns.length);
    assert.deepEqual(finalReturns.map(row => row.input), pendingReturns.map(node => node.input));
    for (const escape of escapes) {
      const originalFailure = replacementBody.exceptionalCompletions[escape.exception];
      const edge = replacementBody.edges.find(row => row.from === escape.instruction && row.completion === 'throw');
      assert.equal(edge.to, replacementBody.exit);
      assert.equal(edge.branch, null);
      const entryEdge = replacementBody.edges.find(row => row.from === originalFailure.instruction && row.completion === 'throw');
      assert.deepEqual(entryEdge.branch.outcome, { exception: originalFailure.ordinal });
      assert.equal(replacementBody.nodes[entryEdge.to].operation, 'pendingException');
      assert.deepEqual(escape.store, []);
      assert.equal(escape.sourceInstruction, originalFailure.instruction);
      assert.deepEqual(escape.condition, { kind: 'Constant', sort: 'Bool', value: true });
      assert.equal(replacementBody.nodes[escape.instruction].operation, 'resumeException');
      assert.equal(replacementBody.nodes[escape.sourceInstruction].operation, 'numeric');
      assert.equal(originalFailure.category, 'System.OverflowException');
      const laterAllocation = replacementBody.nodes.find(node => node.operation === 'write' &&
        node.sourceKind === 'local' && node.input === escape.sourceInstruction);
      assert.ok(laterAllocation);
      assert.ok(originalFailure.store.every(row => canonicalData(row.location) !== canonicalData(laterAllocation.location)));
    }
    const wrongReplacement = structuredClone(replacementBody);
    wrongReplacement.finalFrontiers.find(row => row.kind === 'throw').instruction = pendingReturns[0].id;
    assert.throws(() => checkSelectedScalarBody(replacement.compilation, wrongReplacement, replacement.counter));
    const wrongOriginal = structuredClone(replacementBody);
    wrongOriginal.finalFrontiers.find(row => row.kind === 'throw').sourceInstruction = pendingReturns[0].id;
    assert.throws(() => checkSelectedScalarBody(replacement.compilation, wrongOriginal, replacement.counter));
    const missingGuard = structuredClone(replacementBody);
    missingGuard.finalFrontiers.find(row => row.kind === 'throw').condition = { kind: 'Constant', sort: 'Bool', value: false };
    assert.throws(() => checkSelectedScalarBody(replacement.compilation, missingGuard, replacement.counter));
  }
  for (const source of [
    'class C { int F(int value) { try { value = checked(value + 1); } finally { value = 2; } return value; } }',
    'class C { int F(int value) { try { try { return value; } finally { value = checked(value + 1); } } finally { value = 2; } } }',
    'class C { int F(int value) { int outer = value; try { int inner = checked(value + 1); return inner; } finally { int local = outer; value = local; } } }',
    'class C { int F(int value) { try { value = checked(value + 1); } finally { value = checked(value + 2); } return value; } }',
    'class C { static int G(int value) { return checked(value + 1); } int F(int value) { try { return G(value); } finally { int local = value; value = local; } } }',
    'class C { static int G(int value) { try { value = checked(value + 1); } finally { value = checked(value + 2); } return value; } int F(int value) { return G(value); } }',
    'class C { int F(int value) { if (unchecked(value > 0)) { try { return checked(value + 1); } finally { int local = value; value = local; } } else return value; } }',
    'class C { int F(int value) { try { if (unchecked(value > 0)) return checked(value + 1); else return checked(value + 2); } finally { int local = value; value = checked(local + 3); } } }',
    'class C { int F(int value) { try { return checked(value++); } finally { int local = checked(--value); value = local; } } }',
    'class C { int F(int value) { try { return checked((byte)value); } finally { byte local = checked((byte)value); value = local; } } }'
  ]) {
    const routed = make(source), routedBody = routed.body();
    assert.equal(checkSelectedScalarBody(routed.compilation, routedBody, routed.counter).sourceAdmission, false);
    const throws = routedBody.finalFrontiers.filter(row => row.kind === 'throw');
    assert.ok(throws.length);
    for (const failure of routedBody.exceptionalCompletions) {
      const siblings = routedBody.edges.filter(edge => edge.from === failure.instruction && edge.completion === 'throw');
      const originals = routedBody.exceptionalCompletions.filter(row => row.instruction === failure.instruction);
      assert.equal(siblings.length, originals.length);
      const ordinals = siblings.map(edge => edge.branch?.outcome?.exception);
      assert.equal(new Set(ordinals).size, originals.length);
      assert.deepEqual([...ordinals].sort((a, b) => a - b), originals.map(row => row.ordinal).sort((a, b) => a - b));
      const entries = siblings.filter(edge => edge.branch?.outcome?.exception === failure.ordinal);
      assert.equal(entries.length, 1);
      assert.equal(routedBody.nodes[entries[0].to].operation, 'pendingException');
      assert.equal(routedBody.nodes[entries[0].to].exception, failure.ordinal);
      assert.equal(routedBody.nodes[entries[0].to].sourceInstruction, failure.instruction);
      assert.notEqual(entries[0].to, routedBody.exit);
      for (const mutation of ['duplicate', 'drop', 'relabel']) {
        const changed = structuredClone(routedBody);
        const edgeIndex = routedBody.edges.indexOf(entries[0]);
        if (mutation === 'duplicate') changed.edges.push(structuredClone(changed.edges[edgeIndex]));
        else if (mutation === 'drop') changed.edges.splice(edgeIndex, 1);
        else changed.edges[edgeIndex].branch.outcome.exception = routedBody.exceptionalCompletions.length;
        assert.throws(() => checkSelectedScalarBody(routed.compilation, changed, createProofCounter()),
          original => isSourceDenialCode(original, 'INVALID_PROOF'));
      }
    }
    for (const terminal of throws) {
      assert.equal(routedBody.nodes[terminal.instruction].operation, 'resumeException');
      assert.deepEqual(terminal.store, []);
      assert.equal(terminal.sourceInstruction, routedBody.exceptionalCompletions[terminal.exception].instruction);
    }
    const changed = structuredClone(routedBody);
    const entry = changed.nodes.find(node => node.operation === 'pendingException');
    entry.exception = changed.exceptionalCompletions.length;
    assert.throws(() => checkSelectedScalarBody(routed.compilation, changed, routed.counter));
    const omittedEnd = structuredClone(routedBody);
    const terminal = throws[0];
    omittedEnd.nodes[terminal.instruction].postStore = structuredClone(routedBody.exceptionalCompletions[terminal.exception].store);
    assert.throws(() => checkSelectedScalarBody(routed.compilation, omittedEnd, routed.counter));
  }
  const exceptionalCalled = make('class C { static int G(int value) { try { return value; } finally { int local = checked(value + 1); value = local; } } int F(int value) { return G(value); } }');
  const exceptionalCalledBody = exceptionalCalled.body(), exceptionalCall = exceptionalCalledBody.nodes.find(node => node.operation === 'sourceCall');
  assert.equal(checkSelectedScalarBody(exceptionalCalled.compilation, exceptionalCalledBody, exceptionalCalled.counter).sourceAdmission, false);
  assert.equal(exceptionalCall.calleeBody.finalFrontiers.filter(row => row.kind === 'throw').length, 1);
  assert.equal(exceptionalCall.exceptions.length, 1);
  assert.equal(exceptionalCalledBody.finalFrontiers.filter(row => row.kind === 'throw').length, 1);
  assert.equal(exceptionalCall.calleeBody.nodes[exceptionalCall.calleeBody.returnNode].term.kind, 'Bound');
  assert.deepEqual(exceptionalCall.term, exceptionalCalledBody.nodes[exceptionalCall.inputs[0]].term);
});

test('finally rejects control leaving its boundary and unwinds the original boundary on failure', () => {
  for (const body of [
    'try { } finally { return; }',
    'try { } finally { switch (1) { case 1: return; } }',
    'while (true) { try { } finally { break; } }',
    'while (true) { try { } finally { continue; } }'
  ]) {
    const parser = new SelectedSyntax(Buffer.from(`class C { void F() { ${body} } }`, 'utf8'),
      'csharp', createProofCounter());
    assert.throws(() => parser.csharpUnit(), error => error.code === 'INVALID_BINDING');
    assert.equal(parser.controlStack.includes('finally'), false);
    assert.equal(parser.catchDepth, 0);
  }
});

test('malformed nested switch preserves actual failure and unwinds finally and catch state', () => {
  const parser = new SelectedSyntax(Buffer.from(
    'class C { void F() { try { } catch { try { } finally { switch (1) { case 1 return; } } } } }', 'utf8'),
  'csharp', createProofCounter());
  assert.throws(() => parser.csharpUnit(), error => error.code === 'INVALID_SYNTAX');
  assert.deepEqual(parser.controlStack, []);
  assert.equal(parser.catchDepth, 0);
});

test('finally permits local loop and switch targets and independently scoped lambda returns', () => {
  for (const body of [
    'try { } finally { while (true) { break; } }',
    'try { } finally { while (true) { continue; } }',
    'try { } finally { switch (1) { case 1: break; } }',
    'try { } finally { var f = () => { return 1; }; }'
  ]) {
    const parser = new SelectedSyntax(Buffer.from(`class C { void F() { ${body} } }`, 'utf8'),
      'csharp', createProofCounter());
    assert.ok(parser.csharpUnit());
    assert.deepEqual(parser.controlStack, []);
    assert.equal(parser.catchDepth, 0);
  }
});

test('string concatenation retains required virtual call binding rather than declaring object conversion pure', () => {
  const fixture = bindFixture(`class Caller { public string Invoke(string left, object right) { return left + right; } }`);
  const caller = fixture.entry('Invoke'), expression = caller.syntax.body.statements[0].value;
  const row = fixture.bound.declarationMetadata.get(canonicalData(caller.declId));
  const selected = bindSelectedPredefinedOperator(expression, row.parameters.map((parameter, index) => ({
    type: parameter.type, direction: 'value', name: null, origin: [expression.left, expression.right][index].origin
  })), { ...fixture.environment, checkedArithmeticContext: false }, { unit: caller.declId.unit });
  assert.equal(selected.resultType.name, 'string');
  assert.equal(selected.semantics.requiresOriginalVirtualCallBinding, true);
  assert.deepEqual(selected.semantics.virtualObjectToStringOperands, [1]);
  assert.equal(selected.semantics.resultNonNull, true);
});

test('optional conversion roots preserve actual catalogue identities without rejecting unrelated scalar candidates', () => {
  const counter = createProofCounter();
  const compilation = bindSelectedCsharpCompilation([
    { unit: 'optional-roots.cs', compilation: 'optional-roots', role: 'source', rawBytes: Buffer.from('enum E { A } class C { int F(int value) { return value; } }') },
    { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture) },
  ], counter);
  const method = compilation.enumeration.find(row => row.syntax.kind === 'method' && row.syntax.name.spelling === 'F');
  const context = compilation.context(method), origin = method.origin;
  const primitive = name => compilation.index.primitive(name, context, origin);
  const integer = primitive('int'), boolean = primitive('bool'), object = primitive('object');
  const valueType = compilation.index.catalogueType(['System'], 'ValueType', context, origin);
  const enumType = compilation.index.catalogueType(['System'], 'Enum', context, origin);
  const enumeration = compilation.types.find(type => type.category === 'enum');
  assert.ok(enumeration);
  const environment = { counter, typeGraph: compilation.typeGraph, parameterConstraints: compilation.bound.parameterConstraints };
  for (const roots of [{}, { objectType: object }, { valueTypeRoot: valueType, enumTypeRoot: enumType },
    { objectType: object, valueTypeRoot: valueType, enumTypeRoot: enumType },
    { objectType: primitive('long'), valueTypeRoot: primitive('long'), enumTypeRoot: primitive('long') }]) {
    assert.equal(implicitCsharpConversion(integer, boolean, { ...environment, ...roots }), null);
    assert.equal(implicitCsharpConversion(boolean, integer, { ...environment, ...roots }), null);
    assert.equal(implicitCsharpConversion(integer, primitive('long'), { ...environment, ...roots }).kind, 'numeric');
    assert.equal(implicitCsharpConversion(boolean, boolean, { ...environment, ...roots }).kind, 'identity');
  }
  const array = { category: 'array', rank: 1, element: integer };
  assert.equal(implicitCsharpConversion(array, boolean, environment), null);
  for (const root of [null, {}]) assert.throws(() => implicitCsharpConversion(array, boolean, { ...environment, arrayTypeRoot: root }), original => isSourceDenialCode(original, 'INVALID_BINDING'));
  assert.equal(implicitCsharpConversion(enumeration, enumType, { ...environment, enumTypeRoot: enumType }).kind, 'boxing');
  for (const root of [null, {}]) assert.throws(() => implicitCsharpConversion(enumeration, boolean, { ...environment, enumTypeRoot: root }), original => isSourceDenialCode(original, 'INVALID_BINDING'));
  assert.equal(implicitCsharpConversion(integer, object, { ...environment, objectType: object }).kind, 'boxing');
  assert.equal(implicitCsharpConversion(integer, valueType, { ...environment, valueTypeRoot: valueType }).kind, 'boxing');
  for (const roots of [{ objectType: null }, { valueTypeRoot: null }, { objectType: {} }, { valueTypeRoot: {} }]) {
    let caught = false;
    try { implicitCsharpConversion(integer, boolean, { ...environment, ...roots }); }
    catch (original) { caught = true; assert.equal(isSourceDenialCode(original, 'INVALID_BINDING'), true); }
    assert.equal(caught, true, 'Present malformed roots cannot become absent roots.');
  }
});

test('scalar source-call bridge derives mandatory Object and inheritance from actual compilation catalogue', () => {
  const source = 'class Object {} class C { static int G(int value) { return value; } int F(int input) { return G(input); } }';
  const counter = createProofCounter();
  const units = [{ unit: 'call-root.cs', compilation: 'actual-call-root', role: 'source', rawBytes: Buffer.from(source) },
    { unit: 'symbolic.cs', compilation: 'fixture-symbolic', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture) }];
  const compilation = bindSelectedCsharpCompilation(units, counter);
  const method = compilation.enumeration.find(row => row.syntax.kind === 'method' && row.syntax.name.spelling === 'F');
  const object = compilation.index.primitive('object', compilation.context(method), method.origin);
  assert.equal(object.declaration.unit, 'symbolic.cs');
  const environment = { counter, typeIndex: compilation.index, declarationMetadata: compilation.bound.declarationMetadata,
    parameterConstraints: compilation.bound.parameterConstraints, typeGraph: compilation.typeGraph, languageVersion: [5, 0] };
  assert.equal(Object.hasOwn(environment, 'objectType'), false);
  const body = bindSelectedCsharpScalarBody(compilation, method.declId, environment);
  const call = body.nodes.find(node => node.operation === 'sourceCall'); assert.ok(call);
  assert.equal(call.calleeBody.nodes[call.calleeBody.returnNode].operation, 'return');
  assert.equal(checkSelectedScalarBody(compilation, body, counter).sourceAdmission, false);
  const badCatalogue = symbolicFixture.replace('public class Object ', 'public class MissingObject ');
  for (const selected of [[units[0]], [units[0], { ...units[1], rawBytes: Buffer.from(badCatalogue) }]])
    assert.throws(() => bindSelectedCsharpCompilation(selected, createProofCounter()), original => isSourceDenialCode(original, 'INVALID_BINDING'));
});

test('actual catalogue compilation retains category gates before constructor and initializer slots', () => {
  const compile = source => bindSelectedCsharpCompilation([
    { unit: 'category-source.cs', compilation: 'category-fixture', role: 'source', rawBytes: Buffer.from(source) },
    { unit: 'category-catalogue.cs', compilation: 'category-fixture', role: 'catalogue', rawBytes: Buffer.from(symbolicFixture) },
  ], createProofCounter());
  for (const source of ['class C { public static C() {} }', 'class C { abstract int f; }',
    'static class C { int M(){return 1;} }', 'class C { public static C(){} static int f=1; }'])
    assert.throws(() => compile(source), original => isSourceDenialCode(original, 'INVALID_SYNTAX'));
  const compilation = compile('class C { static C(){} static int f=1; public C(int x){} int P {get;set;} }');
  const entries = compilation.enumeration.filter(entry => entry.declId.unit === 'category-source.cs');
  assert.equal(entries.filter(entry => entry.syntax.kind === 'constructor' && !entry.generated).length, 2);
  assert.equal(entries.filter(entry => entry.generated?.role === 'instanceConstructor').length, 0);
  assert.equal(entries.filter(entry => entry.generated?.role === 'typeInitializer').length, 0);
  assert.equal(entries.filter(entry => entry.generated?.role === 'backingStorage').length, 1);
  const implicit = compile('class C { static int f=1; }');
  const implicitEntries = implicit.enumeration.filter(entry => entry.declId.unit === 'category-source.cs');
  assert.equal(implicitEntries.filter(entry => entry.generated?.role === 'instanceConstructor').length, 1);
  assert.equal(implicitEntries.filter(entry => entry.generated?.role === 'typeInitializer').length, 1);
});

test('volatile catalogue-bound field storage preserves acquire-release and non-atomic compound semantics', () => {
  const fixture = bindFixture('class C { internal volatile bool CallbackCompleted; public static volatile int Count; readonly int immutable; const int Fixed=1; }');
  for (const name of ['CallbackCompleted', 'Count']) {
    const entry = fixture.enumeration.find(row => row.syntax.kind === 'field' && row.syntax.name.spelling === name);
    assert.ok(entry); const storage = fixture.bound.storageMetadata.get(canonicalData(entry.declId));
    assert.equal(storage.volatile, true); assert.equal(storage.readOrdering, 'acquire');
    assert.equal(storage.writeOrdering, 'release'); assert.equal(storage.compoundAtomic, false);
  }
  const immutable = fixture.enumeration.find(row => row.syntax.kind === 'field' && row.syntax.name.spelling === 'immutable');
  const ordinary = fixture.bound.storageMetadata.get(canonicalData(immutable.declId));
  assert.equal(ordinary.volatile, false); assert.equal(ordinary.readOrdering, 'ordinary'); assert.equal(ordinary.writeOrdering, 'ordinary');
  for (const source of ['class C { volatile long f; }', 'class C { volatile double f; }'])
    assert.throws(() => bindFixture(source), original => isSourceDenialCode(original, 'INVALID_BINDING'));
});

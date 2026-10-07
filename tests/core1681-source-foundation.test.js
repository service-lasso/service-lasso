// SPEC-002 AC-4DI.4/R3/C3. Authored UNRUN. These regressions are foundation
// claims only; protected original comparisons/native/product assertions survive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeOriginal, lexOriginal, SourceDenial } from './helpers/core1681-source-input.mjs';
import { parseSourceForest, enumerateForest } from './helpers/core1681-source-forest.mjs';
import { admitBundle, bindSource, checkFoundationBindings, produceFoundation, validateCatalogue, SELECTED_INPUTS,
  ADAPTERS, CONDITION_VERSION, DECLARATION_VERSION } from './helpers/core1681-source-binding.mjs';
import { FIXED_FOUNDATION_CATALOGUES } from './helpers/core1681-source-catalogues.mjs';

const bytes = text => new TextEncoder().encode(text);
const identity = (language = 'javascript', version = 'fixture-original-1') => ({ id: 'fixture', inventoryOrdinal: 0,
  inventoryClass: 'language', language, profile: language === 'csharp' ? 'CS-FINITE-2/CLR48' : 'CE-JS-2', version,
  conditions: [], conditionVersion: CONDITION_VERSION, declarationIdentityVersion: DECLARATION_VERSION });
const clr = () => structuredClone(FIXED_FOUNDATION_CATALOGUES[0]);
const js = text => bindSource(bytes(text), identity());
const cs = text => bindSource(bytes(text), identity('csharp'), [clr()]);
const denies = (action, code) => assert.throws(action, error => error instanceof SourceDenial && (!code || error.code === code));
const binding = (result, name, kind) => result.bindings.find(row => row.name === name && (!kind || row.kind === kind));

test('retained BOM, supplementary scalar and CRLF preserve original half-open endpoints', () => {
  const source = '\ufeffconst a = "🙂";\r\nconst b = 2;\r\n';
  const decoded = decodeOriginal(bytes(source));
  assert.equal(decoded.text, source); assert.equal(decoded.bom, true);
  const start = source.indexOf('🙂'), end = start + 2;
  assert.deepEqual(decoded.origin(start, end), { kind: 'source', byte: [bytes(source.slice(0, start)).length, bytes(source.slice(0, end)).length],
    utf16: [start, end], rawRanges: [[bytes(source.slice(0, start)).length, bytes(source.slice(0, end)).length]], mapped: false });
  denies(() => decoded.origin(start + 1, end), 'INVALID_ORIGIN');
  const result = js(source);
  assert.deepEqual(binding(result, 'b').origin.utf16, [source.indexOf('b ='), source.indexOf('b =') + 5]);
  assert.equal(binding(result, 'b').origin.byte[0], bytes(source.slice(0, source.indexOf('b ='))).length);
});

test('strict UTF8 rejects overlong, surrogate, incomplete and out-of-range source', () => {
  for (const raw of [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xe2, 0x82], [0xf4, 0x90, 0x80, 0x80], [0x80]]) {
    denies(() => decodeOriginal(Uint8Array.from(raw)), 'INVALID_ENCODING');
  }
});

test('raw input is copied before forest production', () => {
  const raw = bytes('const a = 1;'); const decoded = decodeOriginal(raw); raw[0] = 0;
  assert.equal(decoded.text, 'const a = 1;'); assert.equal(decoded.raw[0], 99);
});

test('trivia and EOF coverage includes trailing comment and original bytes', () => {
  const raw = bytes('\ufeffconst a = 1; /* complete */\r\n// trailing');
  const parsed = parseSourceForest(raw, 'javascript');
  assert.equal(parsed.consumedBytes, raw.length);
  assert.deepEqual(parsed.tokens.at(-1).origin.byte, [raw.length, raw.length]);
  assert.equal(parsed.trivia.at(-1).kind, 'comment');
});

test('trailing input is parsed or denied, never ignored after a valid declaration', () => {
  denies(() => js('const a = 1; garbage'), 'INVALID_SYNTAX');
  denies(() => js('const a = 1; }'), 'UNSUPPORTED_SYNTAX');
  denies(() => cs('class A { int a; } garbage'), 'UNSUPPORTED_SYNTAX');
});

test('unfinished bodies, strings and comments deny complete source admission', () => {
  for (const source of ['function f(a) { return a;', 'const a = "unfinished', 'const a = 1; /* unfinished']) {
    denies(() => js(source), 'INCOMPLETE_INPUT');
  }
});

test('enumeration refuses an incomplete parser result', () => {
  const parsed = parseSourceForest(bytes('const a = 1;'), 'javascript');
  parsed.completeSyntax = false;
  denies(() => enumerateForest(parsed, identity()), 'INCOMPLETE_FOREST');
});

test('enumeration rebuilds owned original bytes and refuses a fabricated parser forest', () => {
  const parsed = parseSourceForest(bytes('const a = 1; const b = 2;'), 'javascript');
  parsed.root.children.pop();
  assert.deepEqual(enumerateForest(parsed, identity()).entries.map(row => row.name), ['a', 'b']);
  denies(() => enumerateForest({ ...parsed }, identity()), 'INCOMPLETE_FOREST');
});

test('JS multiple declarators, function formals and lexical storage get distinct counters', () => {
  const result = js('const a = 1, b = 2; function f(x, y) { const z = x + y; return z; }');
  assert.deepEqual(result.bindings.map(row => [row.name, row.declId.index]), [['a', 0], ['b', 1], ['f', 2], ['x', 3], ['y', 4], ['z', 5]]);
  assert.deepEqual(binding(result, 'f').parameters.map(row => row.declaration), [binding(result, 'x').declId, binding(result, 'y').declId]);
  assert.equal(binding(result, 'z').semanticOwner.kind, 'block');
  assert.equal(result.completeEnumeration, true); assert.equal(result.sourceGo, false);
});

test('adding an earlier declaration shifts later canonical counters without name identity', () => {
  const old = js('const a = 1; const b = 2;'); const changed = js('const added = 0; const a = 1; const b = 2;');
  assert.equal(binding(old, 'b').declId.index, 1); assert.equal(binding(changed, 'b').declId.index, 2);
  assert.notDeepEqual(binding(old, 'b').declId, binding(changed, 'b').declId);
  const nextVersion = bindSource(bytes('const a = 1; const b = 2;'), identity('javascript', 'fixture-next-2'));
  assert.notDeepEqual(binding(old, 'b').declId, binding(nextVersion, 'b').declId);
});

test('the checker reconstructs all declarations and denies missing/extra/rich metadata substitutions', () => {
  const raw = bytes('class C { public int P { get; set; } int a, b; }'), id = identity('csharp');
  const good = bindSource(raw, id, [clr()]);
  assert.equal(checkFoundationBindings(raw, id, [clr()], good).checkedDeclarations, good.bindings.length);
  const missing = structuredClone(good); missing.bindings.pop();
  denies(() => checkFoundationBindings(raw, id, [clr()], missing), 'BINDING_MISMATCH');
  const rich = structuredClone(good); delete rich.bindings[0].semanticOwner;
  denies(() => checkFoundationBindings(raw, id, [clr()], rich), 'BINDING_MISMATCH');
  const synthetic = structuredClone(good); synthetic.bindings.find(row => row.origin.kind === 'synthetic').origin.anchor.index++;
  denies(() => checkFoundationBindings(raw, id, [clr()], synthetic), 'BINDING_MISMATCH');
  const counter = structuredClone(good); binding(counter, 'b').declId.index--;
  denies(() => checkFoundationBindings(raw, id, [clr()], counter), 'BINDING_MISMATCH');
});

test('candidate capture metadata cannot be accepted by matching the callback name', () => {
  const raw = bytes('const a = 1; const callback = x => a + x;'), id = identity();
  const result = bindSource(raw, id); binding(result, '<lambda>').captures = [];
  denies(() => checkFoundationBindings(raw, id, [], result), 'BINDING_MISMATCH');
});

test('lambda captures the same enclosing lexical declaration and not its own formal', () => {
  const result = js('function outer(a) { const b = 2; const callback = x => a + b + x; return callback; }');
  const lambda = binding(result, '<lambda>');
  assert.deepEqual(lambda.captures.map(row => row.declaration), [binding(result, 'a').declId, binding(result, 'b').declId]);
  assert.equal(lambda.captures.every(row => row.storage === 'sameLexicalLocation'), true);
  assert.equal(lambda.captures.some(row => row.declaration.index === binding(result, 'x').declId.index), false);
});

test('shadowed JS locals in separate nested lexical scope bind their own storage', () => {
  const result = js('const a = 1; function f() { const a = 2; return a; }');
  const locals = result.bindings.filter(row => row.name === 'a');
  assert.equal(locals.length, 2); assert.notDeepEqual(locals[0].declId, locals[1].declId);
  const f = binding(result, 'f');
  assert.deepEqual(result.bindings.find(row => row.name === 'a' && row.semanticOwner.kind === 'block').semanticOwner.owner.declaration, f.declId);
  assert.deepEqual(f.captures, []);
});

test('source formal/local conflicts and unbound references deny binding', () => {
  denies(() => js('function f(a, a) { return a; }'), 'AMBIGUOUS_BINDING');
  denies(() => js('function f(a) { const a = 1; return a; }'), 'AMBIGUOUS_BINDING');
  denies(() => cs('class C { int F(int a) { int a = 1; return a; } }'), 'AMBIGUOUS_BINDING');
  denies(() => js('function f() { return external; }'), 'INCOMPLETE_BINDING');
});

test('C# field declarators, explicit method/formals and implicit constructor are enumerated', () => {
  const result = cs('namespace N { public class C { int a, b; public int F(ref int x, out int y) { y = x; return y; } } }');
  const type = binding(result, 'C');
  assert.equal(type.declId.index, 0); assert.deepEqual(type.declId.parent.namespace, ['N']);
  const children = result.bindings.filter(row => row.declId.parent.types.length === 1);
  assert.deepEqual(children.map(row => [row.name, row.declId.index]), [['<instanceConstructor>', 0], ['a', 1], ['b', 2], ['F', 3], ['x', 4], ['y', 5]]);
  assert.equal(binding(result, 'F').parameters[0].direction, 'ref'); assert.equal(binding(result, 'F').parameters[1].direction, 'out');
  assert.equal(binding(result, 'a').type.kind, 'imported');
});

test('repeated namespace blocks join the same counter without merging declarations', () => {
  const result = cs('namespace N { class A { } } namespace N { class B { } }');
  assert.equal(binding(result, 'A').declId.index, 0); assert.equal(binding(result, 'B').declId.index, 1);
  assert.deepEqual(binding(result, 'A').declId.parent, binding(result, 'B').declId.parent);
});

test('explicit constructor suppresses only implicit instance constructor', () => {
  const result = cs('class C { static int count = 1; public C() { } }');
  assert.equal(result.bindings.some(row => row.origin.kind === 'synthetic' && row.origin.role === 'instanceConstructor'), false);
  assert.equal(result.bindings.some(row => row.origin.kind === 'synthetic' && row.origin.role === 'typeInitializer'), true);
});

test('auto properties bind backing/accessor/value slots with tagged noSpan origins', () => {
  const result = cs('class C { public int P { get; set; } }');
  const property = binding(result, 'P'); const backing = result.bindings.find(row => row.origin.role === 'backingStorage');
  assert.deepEqual(property.backing, [backing.declId]); assert.deepEqual(backing.origin.anchor, property.declId);
  assert.equal(backing.origin.noSpan, true); assert.equal(Object.hasOwn(backing.origin, 'byte'), false);
  const setter = binding(result, 'set'); const value = binding(result, 'value');
  assert.deepEqual(setter.parameters[0].declaration, value.declId);
  assert.equal(value.origin.role, 'valueStorage');
  assert.equal(property.accessors.length, 2);
});

test('enum implicit successive values derive from exact previous member', () => {
  const result = cs('enum E { A, B = 4, C }');
  assert.deepEqual(result.bindings.filter(row => row.kind === 'enumMember').map(row => row.enumConstant.value), ['0', '4', '5']);
  assert.deepEqual(binding(result, 'C').enumConstant.previous, binding(result, 'B').declId);
  denies(() => cs('enum E { A = 2147483647, B }'), 'INCOMPLETE_BINDING');
});

test('source declaration cannot shadow a protected imported type by qualified spelling', () => {
  denies(() => cs('namespace System { class String { } }'), 'SOURCE_SHADOW');
});

test('unknown C# source type cannot borrow a trusted type by name', () => {
  denies(() => cs('class C { Missing a; }'), 'INCOMPLETE_BINDING');
});

test('F1 same-name nested types bind nearest enclosing owner and exact qualified path', () => {
  const result = cs('namespace N { class A { public class X {} X a; class Inner { X inherited; } } class B { public class X {} X b; A.X qualified; } }');
  const xs = result.bindings.filter(row => row.kind === 'type' && row.name === 'X');
  assert.equal(xs.length, 2); assert.notDeepEqual(xs[0].declId, xs[1].declId);
  assert.deepEqual(binding(result, 'a').type.declaration, xs[0].declId);
  assert.deepEqual(binding(result, 'inherited').type.declaration, xs[0].declId);
  assert.deepEqual(binding(result, 'b').type.declaration, xs[1].declId);
  assert.deepEqual(binding(result, 'qualified').type.declaration, xs[0].declId);
  const full = cs('namespace N { class A { public class X {} } } class B { N.A.X x; }');
  assert.deepEqual(binding(full, 'x').type.declaration, binding(full, 'X', 'type').declId);
});

test('F1 foreign unqualified and inaccessible qualified nested types deny', () => {
  denies(() => cs('class A { public class X {} } class B { X field; }'), 'INCOMPLETE_BINDING');
  denies(() => cs('class A { class X {} } class B { A.X field; }'), 'INCOMPLETE_BINDING');
  denies(() => cs('class A { private class Hidden { public class X {} } } class B { A.Hidden.X field; }'), 'INCOMPLETE_BINDING');
  denies(() => cs('class A { protected class X {} } class B { A.X field; }'), 'INCOMPLETE_BINDING');
});

test('F1 type parameters precede source types and generic arity is exact', () => {
  const result = cs('class T {} class C<T> { T field; T F<U>(U x) { return field; } }');
  const parameter = result.bindings.find(row => row.kind === 'typeParameter' && row.name === 'T');
  assert.deepEqual(binding(result, 'field').type, { kind: 'parameter', declaration: parameter.declId });
  assert.deepEqual(binding(result, 'x').type.declaration, binding(result, 'U', 'typeParameter').declId);
  const generic = cs('class Box<T> {} class C { Box<int> value; }');
  assert.deepEqual(binding(generic, 'value').type.declaration, binding(generic, 'Box').declId);
  assert.equal(binding(generic, 'value').type.arguments[0].kind, 'imported');
  denies(() => cs('class Box<T> {} class C { Box value; }'), 'INCOMPLETE_BINDING');
  denies(() => cs('class C<T> { T<int> value; }'), 'INCOMPLETE_BINDING');
  denies(() => cs('class T { public class X {} } class C<T> { T.X value; }'), 'INCOMPLETE_BINDING');
  denies(() => cs('class A<T> { public class X {} } class B { A.X value; }'), 'INCOMPLETE_BINDING');
});

test('F2 explicit instance and static constructors retain ordered applicable initializers', () => {
  const result = cs('class C { int a = 1, b = 2; public int P { get; set; } = 3; const int K = 4; static int s = 5, t = 6; public static int Q { get; set; } = 7; public C() {} static C() {} }');
  const instance = result.bindings.find(row => row.kind === 'constructor' && !row.static);
  const statik = result.bindings.find(row => row.kind === 'constructor' && row.static);
  assert.deepEqual(instance.generatedInitializerOrder.map(row => row.declaration), ['a', 'b', 'P'].map(name => binding(result, name).declId));
  assert.deepEqual(statik.generatedInitializerOrder.map(row => row.declaration), ['s', 't', 'Q'].map(name => binding(result, name).declId));
  assert.deepEqual(instance.generatedInitializerOrder.map(row => row.originalExpression.spelling), ['1', '2', '3']);
  assert.equal(instance.initializerTiming, 'instance-before-base-constructor');
  assert.equal(statik.initializerTiming, 'explicit-static-constructor-unproved-trigger');
  assert.equal(binding(result, 'C', 'type').initializerTiming, statik.initializerTiming);
  assert.equal(instance.baseConstructorPrerequisite.declarationStatus, 'boundExactCatalogueDeclaration');
  assert.deepEqual(instance.baseConstructorPrerequisite.target, instance.generatedBaseConstructor);
  assert.equal(instance.baseConstructorPrerequisite.transferProof, 'deferred');
  assert.equal(statik.baseConstructorPrerequisite, null);
  assert.equal(result.bindings.some(row => ['instanceConstructor', 'typeInitializer'].includes(row.origin.role)), false);
});

test('F2 implicit constructors retain field/property order and exclude const', () => {
  const result = cs('class C { int a = 1, b = 2; int P { get; set; } = 3; static int s = 4, t = 5; static int Q { get; set; } = 6; const int K = 7; }');
  const instance = result.bindings.find(row => row.origin.role === 'instanceConstructor');
  const statik = result.bindings.find(row => row.origin.role === 'typeInitializer');
  assert.deepEqual(instance.generatedInitializerOrder.map(row => row.declaration), ['a', 'b', 'P'].map(name => binding(result, name).declId));
  assert.deepEqual(statik.generatedInitializerOrder.map(row => row.declaration), ['s', 't', 'Q'].map(name => binding(result, name).declId));
  assert.equal(statik.initializerTiming, 'beforefieldinit-unproved-trigger');
  assert.equal(instance.baseConstructorPrerequisite.order, 'afterInstanceInitializers-beforeConstructorBody');
  assert.equal(cs('class C { const int K = 1; }').bindings.some(row => row.origin.role === 'typeInitializer'), false);
  // An absent catalogue cannot supply even the implicit Object base TypeId.
  denies(() => bindSource(bytes('class C { public C() {} }'), identity('csharp')), 'INCOMPLETE_BINDING');
});

test('F3 default function and arrow formals deny until separate initialization scope lowering', () => {
  for (const source of ['function f(x = 1) { return x; }', 'const f = function(x = 1) { return x; };',
    'const f = (x = 1) => x;', 'const f = (x, y = x) => y;']) denies(() => js(source));
});

test('F3 all strict-module reserved binding contexts deny including parenthesized arrows', () => {
  const names = ['delete', 'debugger', 'do', 'extends', 'instanceof', 'super', 'this', 'with', 'enum',
    'implements', 'interface', 'package', 'private', 'protected', 'public', 'static', 'await', 'yield', 'true', 'null', 'eval', 'arguments'];
  for (const name of names) {
    denies(() => js(`const ${name} = 1;`));
    denies(() => js(`function f(${name}) { return 1; }`));
    denies(() => js(`const f = (${name}) => 1;`));
  }
  denies(() => parseSourceForest(bytes('import { x as delete } from "./module.mjs";'), 'javascript'), 'INVALID_SYNTAX');
});

test('F3 contextual identifiers are permitted and property IdentifierNames may be keywords', () => {
  const result = js('function f(async, of, as, from, get, set) { const callback = (async, of) => async + of; return callback; }');
  assert.deepEqual(binding(result, 'f').parameters.map(row => result.bindings.find(item => assertIdentity(item.declId, row.declaration)).name),
    ['async', 'of', 'as', 'from', 'get', 'set']);
  const properties = js('const value = { delete: 1, true: 2 }; const selected = value.delete;');
  assert.equal(binding(properties, 'selected').initializer.member, 'delete');
});
function assertIdentity(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

test('F6 return requires an enclosing function through nested lexical statements', () => {
  for (const source of ['return 1;', '{ return 1; }', 'if (true) { return 1; }', 'while (true) { return 1; }',
    'function f() { return 1; } return 2;', 'const f = () => { return 1; }; { return 2; }'])
    denies(() => js(source), 'INVALID_SYNTAX');
  const source = 'function f(x) { if (true) { return x; } } const a = function(x) { { return x; } }; const b = (x) => { return x; };';
  const result = js(source);
  assert.deepEqual(result.bindings.filter(row => ['function', 'functionExpression', 'lambda'].includes(row.kind)).map(row => row.kind),
    ['function', 'functionExpression', 'lambda']);
  assert.equal(result.completeEnumeration, true); assert.equal(result.sourceGo, false);
  const parsed = parseSourceForest(bytes(source), 'javascript');
  assert.equal(parsed.root.statements[0].declaration.body.statements[0].body.statements[0].kind, 'return');
});

test('F6 every arrow boundary denies all four line terminators in plain and comment trivia', () => {
  for (const newline of ['\r', '\n', '\u2028', '\u2029']) {
    for (const gap of [newline, `/*${newline}*/`, `// comment${newline}`]) {
      for (const formal of ['x', '(x)', '()'])
        denies(() => js(`const f = ${formal}${gap}=> 1;`), 'INVALID_SYNTAX');
    }
  }
  const result = js('const a = x /*same line*/ => x; const b = (x) /*same line*/ => x; const c = () /*same line*/ => 1;');
  assert.deepEqual(result.bindings.filter(row => row.kind === 'lambda').map(row => row.parameters.length), [1, 1, 0]);
  // A newline inside parenthesized formals and after => is legal. Only the
  // restricted closing-formal => gap must stay on the same original line.
  const multiline = js('const f = (\nx\n) =>\n x;');
  assert.equal(binding(multiline, '<lambda>').parameters.length, 1);
});

test('F6 return and throw restricted trivia denies every line terminator', () => {
  for (const newline of ['\r', '\n', '\u2028', '\u2029']) {
    for (const gap of [newline, `/*${newline}*/`, `// comment${newline}`]) {
      for (const keyword of ['return', 'throw'])
        denies(() => js(`function f() { ${keyword}${gap}1; }`), 'UNSUPPORTED_SYNTAX');
    }
  }
  const parsed = parseSourceForest(bytes('function f() { return /*same line*/ 1; } function g() { throw /*same line*/ 2; }'), 'javascript');
  assert.deepEqual(parsed.root.statements.map(row => [row.declaration.body.statements[0].kind,
    row.declaration.body.statements[0].value.spelling]), [['return', '1'], ['throw', '2']]);
  const empty = parseSourceForest(bytes('function f() { return; }'), 'javascript');
  assert.equal(empty.root.statements[0].declaration.body.statements[0].value, null);
});

test('F6 JS line comments end at Unicode line terminators without hiding later source', () => {
  for (const newline of ['\r', '\n', '\u2028', '\u2029']) {
    const source = `const a = 1; //comment${newline}const b = 2;`, result = js(source);
    assert.deepEqual(result.bindings.map(row => row.name), ['a', 'b']);
    const parsed = parseSourceForest(bytes(source), 'javascript');
    const comment = parsed.trivia.find(row => row.kind === 'comment');
    assert.equal(parsed.decoded.text.slice(...comment.origin.utf16), '//comment');
    assert.equal(parsed.consumedBytes, bytes(source).length);
    denies(() => js(`const a = 1; //comment${newline}return 2;`), 'INVALID_SYNTAX');
  }
});

test('F6 contextual async expression statements remain ordinary names while async syntax denies', () => {
  const result = js('const async = 1; async; async + 2; async = 3; const f = async => async; f(async);');
  assert.equal(binding(result, 'async', 'local').name, 'async');
  assert.equal(binding(result, '<lambda>').parameters.length, 1);
  assert.equal(binding(result, '<lambda>').captures.length, 0);
  for (const source of ['async function f() { return 1; }', 'const f = async function() { return 1; };',
    'const f = async x => x;', 'const f = async (x) => x;', 'const f = async () => 1;']) denies(() => js(source));
});

test('F7 malformed static constructor formals/access deny before binding or slot effects', () => {
  for (const declaration of ['static C(int x) {}', 'public static C() {}', 'private static C() {}',
    'protected static C() {}', 'internal static C() {}', 'static C() {} static C() {}']) {
    const raw = bytes(`class C { static int s = 1; ${declaration} }`);
    denies(() => parseSourceForest(raw, 'csharp'));
    denies(() => bindSource(raw, identity('csharp'), [clr()]));
    denies(() => checkFoundationBindings(raw, identity('csharp'), [clr()], { bindings: [] }));
  }
});

test('F7 unsupported constructor modifiers and categories deny complete source', () => {
  for (const modifier of ['readonly', 'const', 'sealed', 'abstract', 'virtual', 'override', 'extern', 'new']) {
    for (const prefix of [modifier, `${modifier} static`]) denies(() => cs(`class C { ${prefix} C() {} }`));
  }
  denies(() => parseSourceForest(bytes('interface C { C() {} }'), 'csharp'), 'INVALID_SYNTAX');
  denies(() => parseSourceForest(bytes('interface C { static C() {} }'), 'csharp'), 'INVALID_SYNTAX');
  denies(() => parseSourceForest(bytes('static class C { public C() {} }'), 'csharp'), 'INVALID_SYNTAX');
  denies(() => cs('class C { static C(); }'), 'INVALID_SYNTAX');
  denies(() => parseSourceForest(bytes('struct C { protected C(int x) {} }'), 'csharp'), 'INVALID_SYNTAX');
  denies(() => parseSourceForest(bytes('struct C { private C() {} }'), 'csharp'), 'INVALID_SYNTAX');
  denies(() => parseSourceForest(bytes('struct C { C() {} }'), 'csharp'), 'INVALID_SYNTAX');
  const structure = parseSourceForest(bytes('struct C { public C(int x) {} static C() {} }'), 'csharp');
  assert.deepEqual(structure.root.children[0].children.map(row => [row.kind, row.static, row.parameters.length]),
    [['constructor', false, 1], ['constructor', true, 0]]);
});

test('F7 valid constructors preserve ordered initializers and separate base prerequisite', () => {
  const result = cs('class C { int a = 1; int P { get; set; } = 2; static int s = 3; static int Q { get; set; } = 4; const int K = 5; public C(int x) {} static C() {} }');
  const instance = result.bindings.find(row => row.kind === 'constructor' && !row.static);
  const statik = result.bindings.find(row => row.kind === 'constructor' && row.static);
  assert.equal(instance.parameters.length, 1); assert.equal(statik.parameters.length, 0);
  assert.deepEqual(instance.generatedInitializerOrder.map(row => row.declaration), ['a', 'P'].map(name => binding(result, name).declId));
  assert.deepEqual(statik.generatedInitializerOrder.map(row => row.declaration), ['s', 'Q'].map(name => binding(result, name).declId));
  assert.deepEqual(instance.generatedInitializerOrder.map(row => row.originalExpression.spelling), ['1', '2']);
  assert.deepEqual(statik.generatedInitializerOrder.map(row => row.originalExpression.spelling), ['3', '4']);
  assert.equal(instance.baseConstructorPrerequisite.order, 'afterInstanceInitializers-beforeConstructorBody');
  assert.equal(instance.baseConstructorPrerequisite.declarationStatus, 'boundExactCatalogueDeclaration');
  assert.equal(instance.baseConstructorPrerequisite.transferProof, 'deferred');
  assert.equal(statik.baseConstructorPrerequisite, null);
  assert.equal(statik.initializerTiming, 'explicit-static-constructor-unproved-trigger');
  assert.equal(result.bindings.some(row => ['instanceConstructor', 'typeInitializer'].includes(row.origin.role)), false);
  const ordinary = cs('class C { int a = 1; public C() {} }');
  assert.equal(binding(ordinary, 'C', 'constructor').parameters.length, 0);
  assert.equal(ordinary.bindings.some(row => row.origin.role === 'instanceConstructor'), false);
  const staticOnly = cs('static class C { static int a = 1; static C() {} }');
  assert.equal(staticOnly.bindings.some(row => row.origin.role === 'instanceConstructor'), false);
  assert.equal(binding(staticOnly, 'C', 'constructor').generatedInitializerOrder.length, 1);
});

test('full fixed catalogue metadata is required, not names, hashes or effect booleans', () => {
  const missing = clr(); delete missing.members[0].effects.ordinaryThrow;
  denies(() => validateCatalogue(missing), 'INVALID_INPUT');
  const bool = clr(); bool.members[0].effects.normal = [true];
  denies(() => validateCatalogue(bool), 'CATALOGUE_MISMATCH');
  const changed = clr(); changed.members[0].effects.writes = [{ kind: 'foreignWrite', owner: 'foreign' }];
  denies(() => bindSource(bytes('class C { int x; }'), identity('csharp'), [changed]), 'CATALOGUE_MISMATCH');
});

test('duplicate descriptors, unknown targets and incomplete catalogue deny', () => {
  const duplicate = clr(); duplicate.types.push(structuredClone(duplicate.types[0]));
  denies(() => validateCatalogue(duplicate), 'CATALOGUE_MISMATCH');
  const unknown = clr(); unknown.members[0].returnType = { kind: 'named', path: ['Missing'], arguments: [] };
  denies(() => validateCatalogue(unknown), 'CATALOGUE_MISMATCH');
  const incomplete = clr(); incomplete.complete = false;
  denies(() => validateCatalogue(incomplete), 'INCOMPLETE_CATALOGUE');
});

test('catalogue counters depend on structured ordinal order, not input insertion', () => {
  const original = clr(), reordered = clr(); reordered.types.reverse(); reordered.members.reverse();
  assert.deepEqual(validateCatalogue(original).entries.map(row => row.declId), validateCatalogue(reordered).entries.map(row => row.declId));
  assert.equal(validateCatalogue(original).entries.every(row => row.origin.noSpan === true), true);
});

test('F4 closed effect sorts reject foreign/unknown tags and missing operation payload', () => {
  for (const [sort, alternative] of [['normal', { kind: 'foreignWrite' }], ['normal', { kind: 'ordinaryThrow', exception: 'freshOrdinaryExn' }],
    ['writes', { kind: 'returnVoid', receiver: 'sameFreshReceiver' }], ['status', { kind: 'unknownStatus' }],
    ['normal', { kind: 'returnVoid' }], ['ordinaryThrow', { kind: 'ordinaryThrow' }], ['writes', { kind: 'receiverField' }]]) {
    const catalogue = clr(); catalogue.members[0].effects[sort] = [alternative]; denies(() => validateCatalogue(catalogue));
  }
  const formal = clr(); formal.members[1].effects.writes[0].value.index = 99;
  denies(() => validateCatalogue(formal), 'CATALOGUE_MISMATCH');
  const duplicate = clr(); duplicate.members[0].effects.normal.push(structuredClone(duplicate.members[0].effects.normal[0]));
  denies(() => validateCatalogue(duplicate), 'CATALOGUE_MISMATCH');
});

test('F4 Truth and Nullish retain distinct complete consistent value partitions', () => {
  const catalogue = structuredClone(FIXED_FOUNDATION_CATALOGUES[2]);
  assert.equal(validateCatalogue(catalogue).closedFoundationEffectSubset, true);
  assert.equal(validateCatalogue(catalogue).completeSelectedEffectCatalogue, false);
  for (const mutate of [value => value.members[0].effects.normal[0].trueCases.push('null'),
    value => value.members[1].effects.normal[0].falseCases = ['undefined', 'null'],
    value => value.members[0].effects.normal[0].operation = 'Nullish',
    value => delete value.members[1].effects.normal[0].coercion,
    value => value.members[0].effects.writes.push({ kind: 'receiverField' }),
    value => value.members[1].parameters = []]) {
    const changed = structuredClone(catalogue); mutate(changed); denies(() => validateCatalogue(changed));
  }
});

test('CLR48 and conditional modern profiles cannot substitute for each other', () => {
  denies(() => bindSource(bytes('class C { int x; }'), identity('csharp'), [structuredClone(FIXED_FOUNDATION_CATALOGUES[1])]), 'CATALOGUE_MISMATCH');
});

test('actual import syntax retains alias/module initialization but unsupplied export denies binding', () => {
  const parsed = parseSourceForest(bytes('import { original as alias } from "./module.mjs"; const x = alias;'), 'javascript');
  const entry = parsed.root.children.find(row => row.kind === 'import');
  assert.equal(entry.name, 'alias'); assert.equal(entry.import.exported, 'original'); assert.equal(entry.import.module, '"./module.mjs"');
  denies(() => js('import { original as alias } from "./module.mjs"; const x = alias;'), 'INCOMPLETE_BINDING');
});

test('unsupported lowerings deny rather than fabricate accepted declaration rows', () => {
  for (const source of ['function f() { for (;;) { } }', 'function f() { try { } finally { } }',
    'const x = `template`;', 'const r = /regex/;', 'var x = 1;', 'class C { }']) denies(() => js(source), 'UNSUPPORTED_SYNTAX');
  denies(() => parseSourceForest(bytes('#define A 1\nint a;'), 'c'), 'UNSUPPORTED_FRONTEND');
  denies(() => parseSourceForest(bytes('param([int]$x)\n$x'), 'powershell'), 'UNSUPPORTED_FRONTEND');
  denies(() => cs('class C { int F() { foreach (int x in xs) { } return 0; } }'), 'UNSUPPORTED_SYNTAX');
});

test('language-specific numeric/char literals and ASI cannot cross profile boundaries', () => {
  denies(() => js('const a = 1u;'), 'UNSUPPORTED_SYNTAX');
  denies(() => lexOriginal(decodeOriginal(bytes("'ab'")), 'csharp'), 'INVALID_SYNTAX');
  denies(() => lexOriginal(decodeOriginal(bytes("'🙂'")), 'csharp'), 'INVALID_SYNTAX');
  assert.equal(lexOriginal(decodeOriginal(bytes("'\\u0041'")), 'csharp').tokens[0].kind, 'string');
  denies(() => js('function f() { return\n1; }'), 'UNSUPPORTED_SYNTAX');
});

function fixtureBundle() {
  return { schema: 'core1681.foundationInput.v1', conditionVersion: CONDITION_VERSION, declarationIdentityVersion: DECLARATION_VERSION,
    adapters: [...ADAPTERS], units: SELECTED_INPUTS.map(([id, inventoryClass, language, profile]) => ({ id, inventoryClass, language, profile,
      version: 'fixture-v1', conditions: [], rawBytes: bytes(language === 'csharp' ? 'class C { int x; }' : language === 'javascript' ? 'const x = 1;' : 'unsupported source') })) };
}

test('whole bundle denies omissions, extra members, reordered classes and missing versions', () => {
  const missing = fixtureBundle(); missing.units.pop(); denies(() => admitBundle(missing), 'INVALID_INPUT');
  const extra = fixtureBundle(); extra.units.push(extra.units[0]); denies(() => admitBundle(extra), 'INVALID_INPUT');
  const reordered = fixtureBundle(); [reordered.units[0], reordered.units[1]] = [reordered.units[1], reordered.units[0]];
  denies(() => admitBundle(reordered), 'INVALID_INPUT');
  const version = fixtureBundle(); version.units[0].version = ''; denies(() => admitBundle(version), 'INVALID_INPUT');
  const hashOnly = fixtureBundle(); hashOnly.units[0].rawBytes = 'sha256:claimed'; denies(() => admitBundle(hashOnly), 'INVALID_INPUT');
});

test('all six W4 adapters are retained and omission/rename is an admission denial', () => {
  const result = produceFoundation(fixtureBundle()); assert.deepEqual(result.adapters, ADAPTERS);
  const missing = fixtureBundle(); missing.adapters.pop(); denies(() => admitBundle(missing), 'INVALID_INPUT');
  const changed = fixtureBundle(); changed.adapters[0] = 'invented'; denies(() => admitBundle(changed), 'INVALID_INPUT');
});

test('foundation whole-scope disposition keeps unsupported inputs and every unfinished gate visible', () => {
  const result = produceFoundation(fixtureBundle());
  assert.equal(result.outcomes.length, 14); assert.equal(result.outcomes.filter(row => row.status === 'DENIED').length, 3);
  assert.deepEqual(result.selectedScope, { inputUnits: 14, roles: 183, orderedFamilies: 35, callerComparisons: 9 });
  assert.equal(result.completeSelectedForest, false); assert.equal(result.actualSourceGo, false); assert.equal(result.executionAuthorized, false);
  assert.equal(result.catalogueGroups.length, 6); assert.equal(result.catalogueGroups.every(row => !row.completeSelectedProfile), true);
});

test('the actual fourteen readable source bodies enter the whole API, with honest current denials', async () => {
  const paths = ['src/runtime/execution/windows-managed-launcher-native.cs', 'scripts/native/core1681-acquisition.cs',
    'scripts/native/core1681-msi.cs', 'scripts/native/core1681-trust.cs', 'scripts/native/core1681-opc.cs',
    'scripts/native/core1681-vsix-bytes.cs', 'src/runtime/execution/windows-managed-launcher-native-bootstrap.c',
    'scripts/windows-compiler-process-budget.ps1', 'tests/mcp-product-artifact.test.js', 'scripts/verify-mcp-packaged.mjs',
    'scripts/verify-windows-process-inspector.ps1', 'tests/helpers/core1681-managed-closure-source-contract.mjs',
    'scripts/copy-runtime-assets.mjs', 'scripts/mcp-product-acceptance-lib.mjs'];
  const bundle = fixtureBundle();
  for (let index = 0; index < paths.length; index++) bundle.units[index].rawBytes = await readFile(new URL(`../${paths[index]}`, import.meta.url));
  const result = produceFoundation(bundle);
  assert.deepEqual(result.outcomes.map(row => row.id), SELECTED_INPUTS.map(row => row[0]));
  assert.equal(result.actualSourceGo, false); assert.equal(result.completeSelectedForest, false);
  assert.equal(result.outcomes.some(row => row.id === 'CD-mcp' && row.status === 'DENIED'), true);
  assert.equal(result.outcomes.every(row => row.status !== 'OPAQUE_NATIVE_PROVIDER'), true);
});

// Whole review22 bundle. Every denial enters parser, binder and shared checker;
// shared checking is not an independent typed proof kernel. Authored UNRUN.
function denyJsSyntax(source) {
  const raw = bytes(source);
  denies(() => parseSourceForest(raw, 'javascript'));
  denies(() => bindSource(raw, identity()));
  denies(() => checkFoundationBindings(raw, identity(), [], { bindings: [] }));
}
function checkedJsSyntax(source) {
  const raw = bytes(source), result = bindSource(raw, identity());
  const checked = checkFoundationBindings(raw, identity(), [], result);
  assert.equal(checked.checkedDeclarations, result.bindings.length);
  assert.equal(checked.actualSourceGo, false);
  return { parsed: parseSourceForest(raw, 'javascript'), result };
}

test('F8 postfix original gaps include every terminator and plain/block/line comments', () => {
  for (const newline of ['\r', '\n', '\u2028', '\u2029'])
    for (const gap of [newline, `/*${newline}*/`, `// comment${newline}`])
      for (const op of ['++', '--']) denyJsSyntax(`let x = 1; x${gap}${op};`);
  for (const op of ['++', '--']) {
    const { parsed } = checkedJsSyntax(`let x = 1; x /*same line*/ ${op};`);
    assert.equal(parsed.root.statements[1].expression.kind, 'postfix');
    assert.equal(parsed.root.statements[1].expression.op, op);
    assert.equal(parsed.root.statements[1].expression.operand.name, 'x');
  }
});

test('F8 assignment and update require closed targets and one ungrouped update suffix', () => {
  for (const op of ['++', '--'])
    for (const target of ['1', '(1)', '(x + 1)', '(x = 1)', '(x++)', '(++x)', 'f()']) {
      const prefix = 'let x = 1; function f() { return x; } ';
      denyJsSyntax(`${prefix}${target}${op};`);
      denyJsSyntax(`${prefix}${op}${target};`);
    }
  for (const source of ['1 = 2;', '(1) += 2;', 'let x = 1; (x + 1) = 2;',
    'let x = 1; x++ = 2;', 'let x = 1; (++x) -= 2;', 'let x = 1; (x = 2) = 3;',
    'eval = 1;', 'arguments++;', '++eval;', '(arguments) -= 1;']) denyJsSyntax(source);
  for (const first of ['++', '--']) for (const second of ['++', '--'])
    for (const tail of [second, '.value', '[0]', '()']) denyJsSyntax(`let x = 1; x${first}${tail};`);
  const source = 'let x = 1; const o = { value: 1 }; const a = [1]; x = 2; (x) += 1; o.value--; a[0]++; ++x; --o.value; ++(a[0]); (x)++; x = x + 1;';
  const { parsed } = checkedJsSyntax(source);
  const expressions = parsed.root.statements.slice(3).map(row => row.expression);
  assert.deepEqual(expressions.map(row => row.kind), ['assignment', 'assignment', 'postfix', 'postfix', 'prefix', 'prefix', 'prefix', 'postfix', 'assignment']);
  assert.deepEqual(expressions.slice(2, 4).map(row => row.operand.kind), ['member', 'index']);
  // A group re-enters a primary context, so a member target on a grouped
  // expression is legal syntax even when its runtime value is untyped here.
  assert.equal(checkedJsSyntax('let x = 1; (x++).value = 2;').parsed.root.statements[1].expression.left.kind, 'member');
});

test('F9 ungrouped arrow heads deny in binary and unary operand grammar', () => {
  for (const head of ['x', '(x)', '()']) {
    for (const op of ['+', '-', '*', '/', '==', '<', '>', '&&', '||', '??'])
      denyJsSyntax(`const f = 1 ${op} ${head} => 1;`);
    for (const op of ['!', '~', '+', '-', 'typeof ', 'void '])
      denyJsSyntax(`const f = ${op}${head} => 1;`);
  }
});

test('F9 grouped arrows, nested closures and assignment-capable contexts keep ownership', () => {
  const source = 'const captured = 1; const f = x => y => x + y + captured; function use(a) { return a; } const g = 1 + (x => x); const h = use(x => x); const a = [x => x]; const o = { value: x => x }; const c = true ? x => x : y => y; let slot = 1; const assigned = slot = x => x; const writes = x => slot = x;';
  const { parsed, result } = checkedJsSyntax(source);
  const f = parsed.root.statements[1].declarations[0].initializer.declaration;
  assert.equal(f.body.kind, 'lambda');
  const inner = f.body.declaration;
  assert.equal(inner.owner, f);
  assert.equal(inner.parameters[0].owner, inner);
  assert.equal(f.parameters[0].owner, f);
  const g = parsed.root.statements[3].declarations[0].initializer;
  assert.equal(g.kind, 'binary'); assert.equal(g.right.kind, 'group'); assert.equal(g.right.expression.kind, 'lambda');
  assert.equal(parsed.root.statements[4].declarations[0].initializer.arguments[0].expression.kind, 'lambda');
  assert.equal(parsed.root.statements[5].declarations[0].initializer.items[0].kind, 'lambda');
  assert.equal(parsed.root.statements[6].declarations[0].initializer.properties[0].value.kind, 'lambda');
  assert.equal(parsed.root.statements[7].declarations[0].initializer.whenFalse.kind, 'lambda');
  assert.equal(parsed.root.statements[9].declarations[0].initializer.kind, 'assignment');
  assert.equal(parsed.root.statements[10].declarations[0].initializer.declaration.body.kind, 'assignment');
  const lambdas = result.bindings.filter(row => row.kind === 'lambda');
  assert.ok(lambdas[1].captures.some(row => assertIdentity(row.declaration, binding(result, 'x', 'parameter').declId)));
  assert.ok(lambdas[1].captures.some(row => assertIdentity(row.declaration, binding(result, 'captured').declId)));
  // Grouped arrows are valid operands for every previously denied context.
  for (const op of ['+', '*', '<', '&&', '||', '??']) checkedJsSyntax(`const f = 1 ${op} (x => x);`);
  for (const op of ['!', '~', '+', '-', 'typeof ', 'void ']) checkedJsSyntax(`const f = ${op}(x => x);`);
  checkedJsSyntax('let x = 1; function use(a) { return a; } const f = use(x = y => y); const a = [x = y => y]; const o = { value: x = y => y };');
});

test('F10 JS coalescing/logical families deny all ungrouped sides and longer chains', () => {
  for (const op of ['||', '&&']) for (const expression of [
    `1 ?? 2 ${op} 3`, `1 ${op} 2 ?? 3`, `1 ?? 2 ?? 3 ${op} 4`,
    `1 ${op} 2 ${op} 3 ?? 4`, `1 ?? 2 ${op} 3 ?? 4`, `1 ${op} 2 ?? 3 ${op} 4`])
    denyJsSyntax(`const value = ${expression};`);
  denyJsSyntax('const value = 1 ?? 2 || 3 && 4;');
  denyJsSyntax('const value = 1 && 2 || 3 ?? 4;');
});

test('F10 pure chains and explicit groups preserve AST families and Csharp separation', () => {
  for (const op of ['??', '||', '&&']) {
    const { parsed } = checkedJsSyntax(`const value = 1 ${op} 2 ${op} 3;`);
    const tree = parsed.root.statements[0].declarations[0].initializer;
    assert.equal(tree.op, op); assert.equal(tree.left.op, op); assert.equal(tree.right.spelling, '3');
  }
  for (const op of ['||', '&&']) {
    const right = checkedJsSyntax(`const value = 1 ?? (2 ${op} 3);`).parsed.root.statements[0].declarations[0].initializer;
    assert.equal(right.op, '??'); assert.equal(right.right.kind, 'group'); assert.equal(right.right.expression.op, op);
    const left = checkedJsSyntax(`const value = (1 ?? 2) ${op} 3;`).parsed.root.statements[0].declarations[0].initializer;
    assert.equal(left.op, op); assert.equal(left.left.kind, 'group'); assert.equal(left.left.expression.op, '??');
    checkedJsSyntax(`const value = (1 ${op} 2) ?? 3;`);
    checkedJsSyntax(`const value = 1 ${op} (2 ?? 3);`);
  }
  checkedJsSyntax('const value = 1 || 2 && 3;');
  checkedJsSyntax('const value = 1 ?? (2 || 3 && 4) ?? 5;');
  checkedJsSyntax('const value = (1 ?? 2) || (3 ?? 4);');
  checkedJsSyntax('const value = 1 ?? 2 ? 3 || 4 : 5 && 6;');
  checkedJsSyntax('const value = 1 ?? (true ? 2 || 3 : 4 && 5);');
  const raw = bytes('class C { object Value = null ?? true || false; }');
  const result = bindSource(raw, identity('csharp'), [clr()]);
  assert.equal(checkFoundationBindings(raw, identity('csharp'), [clr()], result).checkedDeclarations, result.bindings.length);
  assert.equal(binding(result, 'Value').initializer.op, '??');
  assert.equal(binding(result, 'Value').initializer.right.op, '||');
});

// F11 is an AssignmentExpression production boundary, not an operator denylist.
// Matrix literals deliberately enumerate every supported binary operator.
const arrowHeadsF11 = ['x', '(x)', '()'];
const binaryOperatorsF11 = ['+', '-', '*', '/', '%', '<<', '>>', '<', '>', '<=', '>=', 'in',
  '==', '!=', '===', '!==', '&', '^', '|', '&&', '||', '??'];

test('F11 every block arrow head denies every ungrouped binary and conditional continuation', () => {
  for (const head of arrowHeadsF11) {
    for (const op of binaryOperatorsF11) denyJsSyntax(`const f = ${head} => {} ${op} 1;`);
    denyJsSyntax(`const f = ${head} => {} ? 1 : 2;`);
    for (const suffix of ['= 1', '+= 1', '-= 1', '.value', '[0]', '()', '++', '--'])
      denyJsSyntax(`const f = ${head} => {} ${suffix};`);
  }
});

test('F11 grouped block arrows are primary operands for every binary and conditional continuation', () => {
  for (const head of arrowHeadsF11) {
    for (const op of binaryOperatorsF11) {
      const { parsed } = checkedJsSyntax(`const f = (${head} => {}) ${op} 1;`);
      const tree = parsed.root.statements[0].declarations[0].initializer;
      assert.equal(tree.kind, 'binary'); assert.equal(tree.op, op);
      assert.equal(tree.left.kind, 'group'); assert.equal(tree.left.expression.kind, 'lambda');
      assert.equal(tree.left.expression.declaration.body.kind, 'block');
      assert.equal(tree.right.spelling, '1');
      const right = checkedJsSyntax(`const f = 1 ${op} (${head} => {});`).parsed.root.statements[0].declarations[0].initializer;
      assert.equal(right.op, op); assert.equal(right.right.kind, 'group');
      assert.equal(right.right.expression.kind, 'lambda');
    }
    const tree = checkedJsSyntax(`const f = (${head} => {}) ? 1 : 2;`).parsed.root.statements[0].declarations[0].initializer;
    assert.equal(tree.kind, 'conditional'); assert.equal(tree.test.kind, 'group');
    assert.equal(tree.test.expression.kind, 'lambda'); assert.equal(tree.whenTrue.spelling, '1');
    assert.equal(tree.whenFalse.spelling, '2');
  }
});

test('F11 expression arrow bodies retain all binary and conditional trees inside the closure', () => {
  for (const head of arrowHeadsF11) {
    const value = head === '()' ? '1' : 'x';
    for (const op of binaryOperatorsF11) {
      const { parsed } = checkedJsSyntax(`const f = ${head} => ${value} ${op} 1;`);
      const tree = parsed.root.statements[0].declarations[0].initializer;
      assert.equal(tree.kind, 'lambda'); assert.equal(tree.declaration.body.kind, 'binary');
      assert.equal(tree.declaration.body.op, op); assert.equal(tree.declaration.body.right.spelling, '1');
    }
    const tree = checkedJsSyntax(`const f = ${head} => true ? 1 : 2;`).parsed.root.statements[0].declarations[0].initializer;
    assert.equal(tree.kind, 'lambda'); assert.equal(tree.declaration.body.kind, 'conditional');
  }
});

test('F11 block arrows complete caller arguments, containers, conditional arms and assignment RHS', () => {
  for (const head of arrowHeadsF11) {
    const source = `function use(a) { return a; } const call = use(${head} => {}); const array = [${head} => {}]; const object = { value: ${head} => {} }; const conditional = true ? ${head} => {} : ${head} => {}; let slot = 1; const assigned = slot = ${head} => {}; const nested = outer => ${head} => {};`;
    const { parsed } = checkedJsSyntax(source), statements = parsed.root.statements;
    assert.equal(statements[1].declarations[0].initializer.arguments[0].expression.kind, 'lambda');
    assert.equal(statements[2].declarations[0].initializer.items[0].kind, 'lambda');
    assert.equal(statements[3].declarations[0].initializer.properties[0].value.kind, 'lambda');
    const conditional = statements[4].declarations[0].initializer;
    assert.equal(conditional.test.spelling, 'true'); assert.equal(conditional.whenTrue.kind, 'lambda');
    assert.equal(conditional.whenFalse.kind, 'lambda');
    const assigned = statements[6].declarations[0].initializer;
    assert.equal(assigned.kind, 'assignment'); assert.equal(assigned.right.kind, 'lambda');
    const outer = statements[7].declarations[0].initializer.declaration;
    assert.equal(outer.body.kind, 'lambda'); assert.equal(outer.body.declaration.owner, outer);
  }
});

test('F11 grouped block arrows preserve actual formal, lexical block and capture owners', () => {
  for (const head of arrowHeadsF11) {
    const value = head === '()' ? 'captured' : 'x + captured';
    const { parsed, result } = checkedJsSyntax(`const captured = 1; const f = (${head} => { return ${value}; }) + 1;`);
    const group = parsed.root.statements[1].declarations[0].initializer.left;
    assert.equal(group.kind, 'group'); const lambda = group.expression.declaration;
    assert.equal(lambda.body.scope.owner, lambda); assert.equal(lambda.body.statements[0].kind, 'return');
    assert.equal(lambda.parameters.length, head === '()' ? 0 : 1);
    for (const formal of lambda.parameters) assert.equal(formal.owner, lambda);
    const boundLambda = result.bindings.find(row => row.kind === 'lambda');
    assert.ok(boundLambda.captures.some(row => assertIdentity(row.declaration, binding(result, 'captured').declId)));
    if (head !== '()') assert.equal(boundLambda.captures.some(row => assertIdentity(row.declaration, binding(result, 'x', 'parameter').declId)), false);
  }
});
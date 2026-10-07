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

import test from 'node:test';
import assert from 'node:assert/strict';
import { SelectedSyntax } from './helpers/core1681-selected-syntax.mjs';
import { SelectedJavaScriptSyntax } from './helpers/core1681-selected-javascript.mjs';
import { SelectedCSyntax } from './helpers/core1681-selected-c-syntax.mjs';
import { createSelectedFrontendOccurrence, parseSelectedSourceForest } from './helpers/core1681-selected-forest.mjs';
import { createProofCounter } from './helpers/core1681-proof-terms.mjs';
import { SourceDenial, isSourceDenialCode } from './helpers/core1681-source-input.mjs';

const parser = (text, language = 'csharp') => language === 'javascript'
  ? new SelectedJavaScriptSyntax(Buffer.from(text), createProofCounter())
  : new SelectedSyntax(Buffer.from(text), language, createProofCounter());
const forest = (text, language) => {
  const counter = createProofCounter();
  return parseSelectedSourceForest(Buffer.from(text), language, counter, createSelectedFrontendOccurrence(counter));
};
const sites = [
  ['lambda type', () => { const p = parser('(x)'); return [p, 'typeRef', () => p.primary()]; }],
  ['lambda declaration', () => { const p = parser('(x)'); return [p, 'declaration', () => p.primary()]; }],
  ['cast type', () => { const p = parser('(x)'); const original = p.typeRef; let calls = 0;
    p.typeRef = function (...args) { if (++calls === 1) throw new SourceDenial('INVALID_SYNTAX', 'lambda probe'); return original.apply(this, args); };
    return [p, 'typeRef', () => p.primary(), 2]; }],
  ['generic member', () => { const p = parser('f<T>()'); return [p, 'typeRef', () => p.expression()]; }],
  ['local clause', () => { const p = parser('T x;'); return [p, 'typeRef', () => p.localClause()]; }],
  ['async arrow', () => { const p = parser('async (x) => x', 'javascript'); return [p, 'jsParameters', () => p.jsPrimary()]; }],
  ['parenthesized arrow', () => { const p = parser('(x) => x', 'javascript'); return [p, 'jsParameters', () => p.jsPrimary()]; }],
];
for (const [label, setup] of sites) {
  test(`speculative ${label} preserves opaque original throws without code observation`, () => {
    let getterReads = 0;
    const getter = Object.defineProperty({}, 'code', { get() { getterReads++; throw new Error('secondary getter'); } });
    for (const original of [null, undefined, getter, { code: 'INVALID_SYNTAX' }, { code: 'UNSUPPORTED_FORM' }, new SourceDenial('EXHAUSTED', 'original finite limit')]) {
      const [p, method, invoke, selectedCall = 1] = setup();
      const before = p[method]; let calls = 0, caught = false;
      p[method] = function (...args) { if (++calls === selectedCall) throw original; return before.apply(this, args); };
      try { invoke(); } catch (actual) { caught = true; assert.equal(actual, original); }
      assert.equal(caught, true);
      assert.equal(calls, selectedCall);
    }
    assert.equal(getterReads, 0);
  });
}

test('selected Csharp refuses generic storage/property syntax instead of dropping declared parameters', () => {
  for (const member of ['int f<T>;', 'int f<T> = 1;', 'int f<T>, g;', 'int P<T> { get; set; }',
    'int P<T> { get { return 1; } }', 'int P<T> { get; set; } = 1;']) {
    const source = `\ufeffclass C { ${member} }\r\n`;
    assert.throws(() => parser(source).csharpUnit(), error => isSourceDenialCode(error, 'INVALID_SYNTAX') &&
      error.origin.kind === 'source' && error.origin.byte[0] === Buffer.byteLength(source.slice(0, error.origin.utf16[0])));
  }
  const source = 'class C { int f; int P { get; set; } T F<T>(T value) { return value; } }';
  const members = parser(source).csharpUnit().declarations[0].members;
  assert.equal(members[0].fields[0].name.spelling, 'f');
  assert.equal(members[1].kind, 'property'); assert.equal(members[1].name.spelling, 'P');
  assert.equal(members[2].kind, 'method'); assert.equal(members[2].name.spelling, 'F');
  assert.deepEqual(members[2].typeParameters.map(parameter => parameter.name.spelling), ['T']);
});

test('selected JavaScript const requires initializer in statement/export/block and ordinary for contexts', () => {
  for (const source of ['const x;', 'const x', 'const x, y = 1;', 'const x = 1, y;', '{ const x; }',
    'export const x;', 'for (const x;;) {}', 'for (const x, y = 1;;) {}',
    'for (const x = 1 of xs) {}', 'for (const x = 1 in xs) {}', 'for (const x, y of xs) {}'])
    assert.throws(() => parser(source, 'javascript').javascriptUnit(), error => isSourceDenialCode(error, 'INVALID_SYNTAX'));
  for (const source of ['const x = 1;', 'export const x = 1;', '{ const x = 1; }', 'let x;',
    'for (const x = 1; x < 2;) {}', 'for (const x of xs) {}', 'for (const x in xs) {}',
    'for (const [x] of xs) {}', 'for (const {x} in xs) {}', 'for await (const x of xs) {}']) {
    const unit = parser(source, 'javascript').javascriptUnit();
    assert.equal(unit.kind, 'unit'); assert.equal(unit.statements.length, 1);
    if (unit.statements[0].kind === 'jsForEach') {
      const head = unit.statements[0].initializer;
      assert.equal(head.category, 'const'); assert.equal(head.declarations.length, 1);
      assert.equal(head.declarations[0].initializer, null);
    }
  }
});
test('genuine selected syntax denials retain intended speculation fallback', () => {
  for (const code of ['INVALID_SYNTAX', 'UNSUPPORTED_FORM']) {
    const p = parser('(x)');
    p.typeRef = () => { throw new SourceDenial(code, 'actual typed speculation denial'); };
    assert.equal(p.primary().kind, 'group');
    const local = parser('x;');
    local.typeRef = () => { throw new SourceDenial(code, 'actual local speculation denial'); };
    assert.equal(local.localClause(), null);
    for (const text of ['async (x)', '(x)']) {
      const js = parser(text, 'javascript');
      js.jsParameters = () => { throw new SourceDenial(code, 'actual arrow speculation denial'); };
      assert.doesNotThrow(() => js.jsPrimary());
    }
  }
});

test('selected strict module JavaScript enforces declaration and await grammar contexts', () => {
  const invalid = ['let [x];', 'let {x};', 'for (let [x];;) {}', 'for (let {x};;) {}',
    'export let [x];', 'if (true) const x = 1;', 'if (true) {} else let x;',
    'while (false) let x;', 'for (;;) const x = 1;', 'for (const x of xs) let y;',
    'if (true) function f() {}', 'while (false) async function f() {}',
    'function f() { for await (const x of xs) {} }',
    'async function f() { function g() { for await (const x of xs) {} } }',
    'function f(x = await y) {}', 'async function f(x = await y) {}',
    'const f = (x = await y) => x;', 'const f = async (x = await y) => x;'];
  for (const source of invalid) {
    const p = parser(source, 'javascript');
    assert.throws(() => p.javascriptUnit(), error => isSourceDenialCode(error, 'INVALID_SYNTAX'));
    assert.deepEqual(p.awaitContexts, []); assert.deepEqual(p.functionStack, []);
  }
  for (const source of ['let x;', 'let [x] = xs;', 'let {x} = xs;',
    'for (let [x] of xs) {}', 'for (let {x} in xs) {}',
    'if (true) { const x = 1; } else { let y; }',
    'while (false) { function f() {} }', 'for (;;) { async function f() {} }',
    'await x;', 'for await (const x of xs) {}',
    'async function f() { await x; for await (let [x] of xs) {} }',
    'function f(x = async () => await y) {}',
    'async function f(x = async () => { for await (const y of ys) {} }) {}']) {
    const p = parser(source, 'javascript');
    assert.equal(p.javascriptUnit().kind, 'unit');
    assert.deepEqual(p.awaitContexts, []); assert.deepEqual(p.functionStack, []);
  }
  for (const source of ['if (true) class C {}', 'class C {}', 'var x;'])
    assert.throws(() => parser(source, 'javascript').javascriptUnit(), error => isSourceDenialCode(error, 'UNSUPPORTED_FORM'));
});

test('selected CSharp expression grammar excludes foreign operators and incomplete creation', () => {
  for (const expression of ['a === b', 'a !== b', 'a ** b', 'a >>> b', 'a &&= b', 'a ||= b', 'a ??= b',
    'a **= b', 'a >>>= b', 'a instanceof b', 'a in b', 'a?.b', 'delete a', 'typeof a', 'void a', 'new C', 'new int[]', 'new[]'])
    assert.throws(() => parser(`class C { object F() { return ${expression}; } }`).csharpUnit(),
      error => isSourceDenialCode(error, 'INVALID_SYNTAX') || isSourceDenialCode(error, 'UNSUPPORTED_FORM'));
  for (const expression of ['a == b', 'a != b', 'a <= b', 'a >= b', 'a << b', 'a >> b',
    'a + b', 'a - b', 'a * b', 'a / b', 'a % b', 'a & b', 'a | b', 'a ^ b', 'a && b', 'a || b', 'a ?? b',
    'new C()', 'new C {}', 'new C() {}', 'new int[n]', 'new int[] {}', 'new int[] { 1, 2 }']) {
    const unit = parser(`class C { object F() { return ${expression}; } }`).csharpUnit();
    assert.equal(unit.kind, 'unit');
    const value = unit.declarations[0].members[0].body.statements[0].value;
    if (expression.startsWith('new C')) assert.equal(value.kind, 'newObject');
    else if (expression.startsWith('new int')) assert.equal(value.kind, 'newArray');
    else assert.equal(value.kind, 'binary');
  }
  for (const operation of ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']) {
    const value = parser(`class C { int F() { return a ${operation} b; } }`).csharpUnit().declarations[0].members[0].body.statements[0].value;
    assert.equal(value.kind, 'assignment'); assert.equal(value.operation, operation);
  }
  for (const expression of ['+a', '-a', '!a', '~a', '++a', '--a', 'a++', 'a--', 'a is C', 'a as C', 'a ? b : c', 'new[] { 1 }'])
    assert.equal(parser(`class C { object F() { return ${expression}; } }`).csharpUnit().kind, 'unit');
});

test('selected JavaScript for-of RHS uses AssignmentExpression while in and grouped commas remain valid', () => {
  for (const prefix of ['for', 'for await']) for (const head of ['const x', 'let [x]', 'x', 'obj.x', '[x]']) {
    const invalid = `${prefix} (${head} of xs, ys) {}`;
    for (const parse of [() => parser(invalid, 'javascript').javascriptUnit(), () => forest(invalid, 'javascript')])
      assert.throws(parse, error => isSourceDenialCode(error, 'INVALID_SYNTAX'));
    const source = `${prefix} (${head} of (xs, ys)) {}`;
    for (const unit of [parser(source, 'javascript').javascriptUnit(), forest(source, 'javascript').root]) {
      assert.equal(unit.statements[0].sequence.kind, 'group');
      assert.equal(unit.statements[0].sequence.expression.kind, 'jsSequence');
    }
  }
  for (const head of ['const x', 'let [x]', 'obj.x', '[x]']) {
    const source = `for (${head} in xs, ys) {}`;
    assert.equal(parser(source, 'javascript').javascriptUnit().statements[0].sequence.kind, 'jsSequence');
    assert.equal(forest(source, 'javascript').root.statements[0].sequence.kind, 'jsSequence');
  }
  for (const source of ['for (let x = (a in b);;) {}', 'for (let [x = a in b] of xs) {}',
    'for (obj[a in b] of xs) {}', 'for ({[a in b]: x} of xs) {}',
    'for (let x = f(a in b);;) {}', 'for (let x = [a in b];;) {}',
    'for (let x = {a: a in b};;) {}', 'for (let x = `${a in b}`;;) {}',
    'for (let f = function() { return a in b; };;) {}', 'for (let f = (x => x in xs);;) {}',
    'for (let x = c ? a in b : d;;) {}']) {
    assert.equal(parser(source, 'javascript').javascriptUnit().kind, 'unit');
    assert.equal(forest(source, 'javascript').root.kind, 'unit');
  }
});

test('selected JavaScript all for-in/of forms require actual simple or destructuring assignment heads', () => {
  const invalidHeads = ['1', '"x"', 'true', 'null', 'this', 'f()', 'new C()', 'x + y', 'x = y',
    'x += y', 'x, y', '(x, y)', 'x ? y : z', '++x', 'x++', 'obj?.x', 'obj?.x.y', 'obj?.[x]',
    '[1]', '[x + y]', '[...x, y]', '[...x,]', '[...x = y]', '{a: 1}', '{a() {}}',
    '{...x, a}', '{...x,}', '{...[x]}', '{...{x}}', '([x])', '({x})'];
  for (const clause of ['in', 'of', 'await-of']) for (const head of invalidHeads) {
    const source = `${clause === 'await-of' ? 'for await' : 'for'} (${head} ${clause === 'in' ? 'in' : 'of'} xs) {}`;
    for (const parse of [() => parser(source, 'javascript').javascriptUnit(), () => forest(source, 'javascript')])
      assert.throws(parse, error => isSourceDenialCode(error, 'INVALID_SYNTAX'));
  }
  const validHeads = ['x', '(x)', '((obj.x))', 'obj[x]', 'f().x', '(obj?.x).y',
    '[x]', '[,x,]', '[x = 1, {a: obj.x}, ...rest]', '[...[x]]',
    '{x}', '{a: obj[x] = 1, ...rest}', '{[key]: [x]}'];
  for (const clause of ['in', 'of', 'await-of']) for (const head of validHeads) {
    const source = `${clause === 'await-of' ? 'for await' : 'for'} (${head} ${clause === 'in' ? 'in' : 'of'} xs) {}`;
    const unit = parser(source, 'javascript').javascriptUnit(); assert.equal(unit.statements[0].kind, 'jsForEach');
    assert.equal(forest(source, 'javascript').root.statements[0].kind, 'jsForEach');
  }
});

test('selected C11 distinguishes compound block-item declarations from every embedded Statement', () => {
  for (const statement of ['if (1) int x;', 'if (1) ; else int x;', 'while (1) int x;', 'do int x; while (1);',
    'for (;;) int x;', 'switch (1) int x;', 'label: int x;', 'switch (1) { case 1: int x; }',
    'switch (1) { default: typedef int T; }']) {
    const source = `int f(void) { ${statement} return 0; }`;
    const p = new SelectedCSyntax(Buffer.from(source), createProofCounter(), new Set());
    assert.throws(() => p.cUnit(), error => isSourceDenialCode(error, 'INVALID_SYNTAX'));
    assert.equal(p.typedefScopes.length, 1); assert.deepEqual(p.controls, []);
    assert.throws(() => forest(source, 'c'), error => isSourceDenialCode(error, 'INVALID_SYNTAX'));
  }
  for (const statement of ['int x;', 'typedef int T; T x;', 'if (1) { int x; } else { int y; }',
    'while (1) { int x; break; }', 'do { int x; } while (0);', 'for (int x = 0; x < 1; x++) { int y; }',
    'switch (1) { case 1: { int x; break; } default: ; }', 'label: { int x; }',
    'typedef int T; T: ;', 'label: ; int x;']) {
    const source = `int f(void) { ${statement} return 0; }`;
    const p = new SelectedCSyntax(Buffer.from(source), createProofCounter(), new Set());
    assert.equal(p.cUnit().kind, 'unit'); assert.equal(p.typedefScopes.length, 1); assert.deepEqual(p.controls, []);
    assert.equal(forest(source, 'c').root.kind, 'unit');
  }
  const loop = new SelectedCSyntax(Buffer.from('int f(void) { for (int x = 0; x < 1; x++) { int y; } return 0; }'), createProofCounter(), new Set()).cUnit().declarations[0].body.statements[0];
  assert.equal(loop.initializer.kind, 'cDeclarationGroup'); assert.equal(loop.initializer.declarations[0].storageCategory, 'local');
  assert.equal(loop.body.kind, 'block'); assert.equal(loop.body.statements[0].kind, 'cDeclarationGroup');
  assert.throws(() => forest('int f() { if (true) int x; }', 'cpp'), error => isSourceDenialCode(error, 'UNBOUND_PROFILE'));
});
for (const [label, setup] of sites) {
  test(`speculative ${label} consumes only authentic allowed denials`, () => {
    for (const code of ['INVALID_SYNTAX', 'UNSUPPORTED_FORM']) {
      const original = new SourceDenial(code, 'actual speculative original');
      const [p, method, invoke, selectedCall = 1] = setup();
      const before = p[method]; let calls = 0;
      p[method] = function (...args) { if (++calls === selectedCall) throw original; return before.apply(this, args); };
      try { invoke(); } catch (actual) { assert.notEqual(actual, original); }
      assert.ok(calls >= selectedCall);
    }
  });
}

test('ordinary for-of async lookahead differs from awaited, in, grouped and member targets', () => {
  for (const source of ['for (async of rows) {}', 'for (async\nof rows) {}'])
    for (const parse of [() => parser(source, 'javascript').javascriptUnit(), () => forest(source, 'javascript')])
      assert.throws(parse, original => isSourceDenialCode(original, 'INVALID_SYNTAX'));
  for (const source of ['for await (async of rows) {}', 'for (async in rows) {}',
    'for ((async) of rows) {}', 'for (async.value of rows) {}', 'for (async[key] of rows) {}',
    'for (let async of rows) {}', 'for (const async of rows) {}',
    'async function f() { for await (async of rows) {} }']) {
    assert.equal(parser(source, 'javascript').javascriptUnit().kind, 'unit');
    assert.equal(forest(source, 'javascript').root.kind, 'unit');
  }
});

test('for-head shorthand defaults belong only to validated actual assignment-pattern paths', () => {
  for (const clause of ['in', 'of', 'await-of']) for (const head of [
    '{a = 1}', '{async = 1, get = 2, set = 3}', '{a = key in table}',
    '{a: {b = 1}}', '[{a = 1}]', '{a = 1, ...rest}', '{a: [x = 1, {b = key in table}]}',
  ]) {
    const source = `${clause === 'await-of' ? 'for await' : 'for'} (${head} ${clause === 'in' ? 'in' : 'of'} rows) {}`;
    for (const root of [parser(source, 'javascript').javascriptUnit(), forest(source, 'javascript').root])
      assert.equal(root.statements[0].kind, 'jsForEach');
  }
  const actual = parser('for ({a = 1} of rows) {}', 'javascript').javascriptUnit().statements[0];
  assert.equal(actual.initializer.properties[0].value.kind, 'assignment');
  assert.equal(actual.initializer.properties[0].value.left.name.spelling, 'a');
  assert.equal(actual.initializer.properties[0].value.right.kind, 'literal');
  for (const source of ['({a = 1});', 'const x = {a = 1};', 'for ({a = 1};;) {}',
    'for (let x = {a = 1};;) {}', 'for ({a: x = {b = 1}} of rows) {}',
    'for ([{a = 1}].field of rows) {}', 'for (f({a = 1}).field of rows) {}',
    'for ({a: function() { return {b = 1}; }} of rows) {}',
    'for ({eval = 1} of rows) {}', 'for ({arguments = 1} of rows) {}',
    'for ({eval} of rows) {}', 'for ([arguments] of rows) {}',
    'for ({a = 1} of [{b = 1}]) {}', 'for ({a = 1} in {b = 1}) {}',
    'for ({a: ({b = 1})} of rows) {}']) {
    const p = parser(source, 'javascript');
    assert.throws(() => p.javascriptUnit(), original => isSourceDenialCode(original, 'INVALID_SYNTAX'));
    assert.equal(p.forHeadCoverNames, null);
    assert.throws(() => forest(source, 'javascript'), original => isSourceDenialCode(original, 'INVALID_SYNTAX'));
  }
  for (const source of ['for ({a = 1} of rows) { ({b: 1}); }',
    'for (let {a = 1} of rows) {}', 'for ({a = 1} of rows) { for ({b = 2} of other) {} }']) {
    const p = parser(source, 'javascript'); assert.equal(p.javascriptUnit().kind, 'unit');
    assert.equal(p.forHeadCoverNames, null); assert.equal(forest(source, 'javascript').root.kind, 'unit');
  }
});

test('ordinary JavaScript assignment and update require actual targets and one postfix operation', () => {
  for (const source of ['1 = 2;', 'f() = 2;', 'x + y = 2;', '++1;', '--f();', '1++;',
    'x++++;', 'x++--;', 'x++.field;', 'x++();', '++x++;', 'obj?.x = 1;', 'obj?.x++;',
    '++obj?.x;', 'obj?.x[y] += 1;', '(obj?.x) = 1;', '[x] += rows;', '({x}) += row;',
    '({x: f()} = row);', '({x = {y = 1}} = row);', '([x, ...rest,] = rows);',
    '({x(){}} = row);', '({eval} = row);', '([arguments] = rows);']) {
    const p = parser(source, 'javascript');
    assert.throws(() => p.javascriptUnit(), original => isSourceDenialCode(original, 'INVALID_SYNTAX'));
    assert.equal(p.forHeadCoverNames, null);
    assert.throws(() => forest(source, 'javascript'), original => isSourceDenialCode(original, 'INVALID_SYNTAX'));
  }
  for (const source of ['x = 1;', '(x) += 1;', 'obj.x++;', '--obj[index];', '(obj.x)++;',
    '(obj?.x).field = 1;', 'obj.x = y = 2;', '[x, {y = 1}, ...rest] = rows;',
    '({x = 1, y: [z = 2], ...rest} = row);', 'x++\n++y;', 'x++; obj.x = 2;']) {
    const p = parser(source.replaceAll('\\n', '\n'), 'javascript');
    assert.equal(p.javascriptUnit().kind, 'unit', source); assert.equal(p.forHeadCoverNames, null);
    assert.equal(forest(source.replaceAll('\\n', '\n'), 'javascript').root.kind, 'unit', source);
  }
  const root = parser('obj[index] += 1; x++;', 'javascript').javascriptUnit();
  assert.equal(root.statements[0].expression.kind, 'assignment');
  assert.equal(root.statements[0].expression.left.kind, 'jsIndex');
  assert.equal(root.statements[1].expression.kind, 'postfix');
});

test('selected CSharp declaration categories are checked before enumeration or synthetic suppression', () => {
  for (const source of ['class C { public static C() {} }', 'class C { abstract int f; }',
    'static class C { int M() { return 1; } }', 'static class C { C() {} }',
    'class C { static C(int x) {} }', 'class C { static C():base() {} }',
    'class C { static C() {} static C() {} }', 'interface C { C() {} }',
    'class C { static abstract int M(); }', 'class C { private virtual int M() {return 1;} }',
    'class C { public sealed int M() { return 1; } }', 'class C { public abstract int M(); }',
    'sealed class C { public virtual int M() {return 1;} }', 'struct C { protected int f; }',
    'readonly struct C { int f; }', 'class C { const static int f = 1; }',
    'abstract class C { public abstract int P {get {return 1;}} }',
    'class C { int P {set;} }', 'class C { int P {get; set {}} }',
    'class C { void f; }', 'class C { int P {static get;set;} }',
    'class C { int P {private private get;set;} }', 'static enum C { A }', 'abstract delegate int D();']) {
    assert.throws(() => parser(source).csharpUnit(), original => isSourceDenialCode(original, 'INVALID_SYNTAX'), source);
    assert.throws(() => forest(source, 'csharp'), original => isSourceDenialCode(original, 'INVALID_SYNTAX'), source);
  }
  for (const source of ['class C { static C() {} public C(int x) {} }',
    'abstract class C { protected C() {} public abstract int M(); public abstract int P {get;set;} }',
    'static class C { static int f; public static int M(){return 1;} class Nested {int f;} }',
    'readonly struct C { readonly int f; static int x; }', 'interface I { int M(); int P {get;set;} }',
    'class C { int P {get;set;} = 1; int Q {get {return 1;} set {}} }',
    'public delegate int D(int x);', 'class C { protected internal int f; public class Nested {} }']) {
    assert.equal(parser(source).csharpUnit().kind, 'unit', source);
    assert.equal(forest(source, 'csharp').root.kind, 'unit', source);
  }
});

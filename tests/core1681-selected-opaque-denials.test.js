import test from 'node:test';
import assert from 'node:assert/strict';
import { SelectedSyntax } from './helpers/core1681-selected-syntax.mjs';
import { SelectedJavaScriptSyntax } from './helpers/core1681-selected-javascript.mjs';
import { createProofCounter } from './helpers/core1681-proof-terms.mjs';
import { SourceDenial, isSourceDenialCode } from './helpers/core1681-source-input.mjs';

const parser = (text, language = 'csharp') => language === 'javascript'
  ? new SelectedJavaScriptSyntax(Buffer.from(text), createProofCounter())
  : new SelectedSyntax(Buffer.from(text), language, createProofCounter());
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

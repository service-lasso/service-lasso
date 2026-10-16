import test from 'node:test';
import assert from 'node:assert/strict';
import { SelectedSyntax } from './helpers/core1681-selected-syntax.mjs';
import { SelectedJavaScriptSyntax } from './helpers/core1681-selected-javascript.mjs';
import { createProofCounter } from './helpers/core1681-proof-terms.mjs';
import { SourceDenial } from './helpers/core1681-source-input.mjs';

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
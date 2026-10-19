import { deny } from './core1681-source-input.mjs';
import { canonicalData, K2_LIMITS } from './core1681-proof-terms.mjs';

const localKinds = new Set(['local', 'parameter', 'lambdaParameter', 'iterationVariable', 'catchParameter']);
const overloadKinds = new Set(['method', 'constructor']);
const namedKinds = new Set(['type', 'delegate', 'field', 'property', 'method', 'parameter', 'local',
  'lambdaParameter', 'iterationVariable', 'catchParameter', 'typeParameter', 'enumMember']);
const fail = (message, origin) => deny('INVALID_BINDING', message, origin);
const localDeclaration = entry => localKinds.has(entry.syntax.kind) || entry.generated?.role === 'valueStorage';

// C# lexical declaration spaces only. Imported names, member lookup, overload
// resolution and definite assignment remain separate checked phases; a lexical
// result cannot establish method effects, value initialization or accessibility.
export class SelectedCSharpNameIndex {
  constructor(enumeration, counter) {
    this.counter = counter;
    this.scopes = enumeration.scopes;
    this.nodeScopes = enumeration.nodeScopes;
    this.byScope = new Map();
    this.byDeclaration = new Map();
    if (!Array.isArray(this.scopes) || this.scopes.length > K2_LIMITS.maxDeclarations)
      fail('actual bounded lexical scope enumeration required');
    for (let ordinal = 0; ordinal < this.scopes.length; ordinal++) {
      const scope = this.scopes[ordinal];
      if (scope.ordinal !== ordinal || scope.parent !== null &&
          (!Number.isSafeInteger(scope.parent) || scope.parent < 0 || scope.parent >= ordinal))
        fail('lexical scope parent is not an earlier actual scope', scope.origin);
    }
    for (const entry of enumeration.entries) {
      counter.charge('maxInvariantSteps', 'lexical-declaration-index');
      const key = canonicalData(entry.declId);
      if (this.byDeclaration.has(key)) fail('duplicate canonical source declaration', entry.origin);
      this.byDeclaration.set(key, entry);
      if (!namedKinds.has(entry.syntax.kind) && entry.generated?.role !== 'valueStorage') continue;
      const name = entry.generated?.role === 'valueStorage' ? entry.syntax.name : entry.syntax.name?.spelling;
      if (typeof name !== 'string' || !name || !Number.isSafeInteger(entry.lexicalScope) ||
          entry.lexicalScope < 0 || entry.lexicalScope >= this.scopes.length)
        fail('named declaration lacks its actual lexical name/scope', entry.origin);
      const names = this.byScope.get(entry.lexicalScope) ?? new Map();
      this.byScope.set(entry.lexicalScope, names);
      const existing = names.get(name) ?? [];
      // Distinct arities form different type declaration spaces. Actual method
      // signature collisions are checked after parameter metadata is resolved.
      const legalTypeArity = existing.every(other => ['type', 'delegate'].includes(other.syntax.kind) &&
        ['type', 'delegate'].includes(entry.syntax.kind) &&
        other.syntax.typeParameters.length !== entry.syntax.typeParameters.length);
      const legalOverload = existing.every(other => overloadKinds.has(other.syntax.kind) && overloadKinds.has(entry.syntax.kind));
      if (existing.length && !legalTypeArity && !legalOverload)
        fail('duplicate name in the same C# declaration space', entry.origin);
      names.set(name, [...existing, entry]);
    }
    this.checkLocalDeclarationSpaces();
  }
  chain(scopeOrdinal) {
    if (!Number.isSafeInteger(scopeOrdinal) || scopeOrdinal < 0 || scopeOrdinal >= this.scopes.length)
      fail('reference has no actual lexical scope');
    const chain = [];
    for (let scope = scopeOrdinal; scope !== null; scope = this.scopes[scope].parent) {
      this.counter.charge('maxInvariantSteps', 'lexical-scope-parent');
      if (chain.length >= K2_LIMITS.maxTermDepth) fail('lexical scope chain exceeds finite depth');
      chain.push(scope);
    }
    return chain;
  }
  checkLocalDeclarationSpaces() {
    for (const [ordinal, names] of this.byScope) {
      for (const [name, entries] of names) {
        for (const entry of entries) {
          if (!localDeclaration(entry)) continue;
          for (const enclosing of this.chain(ordinal).slice(1)) {
            if (this.scopes[enclosing].kind === 'type' || this.scopes[enclosing].kind === 'namespace' ||
                this.scopes[enclosing].kind === 'unit') break;
            const conflicts = this.byScope.get(enclosing)?.get(name) ?? [];
            if (conflicts.some(localDeclaration))
              fail('local declaration shadows an enclosing local declaration space', entry.origin);
            // Nested functions retain enclosing names. Crossing a function
            // boundary does not erase the outer captured parameter/local space.
          }
        }
      }
    }
  }
  lookup(nameSyntax, occurrenceNode, { typeArity = null } = {}) {
    const spelling = nameSyntax?.spelling;
    if (typeof spelling !== 'string' || !nameSyntax.origin || !occurrenceNode?.origin)
      fail('lexical lookup requires the original identifier occurrence');
    const start = this.nodeScopes.get(occurrenceNode);
    const searched = [];
    for (const ordinal of this.chain(start)) {
      searched.push(ordinal);
      let matches = this.byScope.get(ordinal)?.get(spelling) ?? [];
      if (typeArity !== null) matches = matches.filter(entry => ['type', 'delegate'].includes(entry.syntax.kind) &&
        entry.syntax.typeParameters.length === typeArity);
      if (!matches.length) continue;
      return { kind: matches.length === 1 ? 'declaration' : 'declarationGroup',
        declarations: matches.map(entry => structuredClone(entry.declId)),
        sourceOccurrence: structuredClone(nameSyntax.origin), searchedScopes: searched,
        selectedScope: ordinal };
    }
    return { kind: 'unresolvedLexical', sourceOccurrence: structuredClone(nameSyntax.origin), searchedScopes: searched };
  }
}

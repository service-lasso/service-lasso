import { deny } from './core1681-source-input.mjs';
import { preprocessSelectedC } from './core1681-selected-c-preprocessor.mjs';
import { installSelectedRecursionBounds } from './core1681-selected-syntax.mjs';
import { C_SCALAR_SPECIFIERS, classifySelectedCScalar, composeSelectedCSourceType, createSelectedCTypeOccurrence, resolveSelectedCSourceHead, checkSelectedCSourceObjectCompleteness } from './core1681-selected-c-types.mjs';

const specifierWords = new Set(['static', 'extern', 'const', 'volatile', ...C_SCALAR_SPECIFIERS, 'wchar_t']);
const scalarWords = new Set([...C_SCALAR_SPECIFIERS, 'wchar_t']);
const keywords = new Set(('auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Bool _Complex _Imaginary').split(' '));
const levels = new Map([['=', 1], ['+=', 1], ['-=', 1], ['*=', 1], ['/=', 1], ['%=', 1],
  ['<<=', 1], ['>>=', 1], ['&=', 1], ['|=', 1], ['^=', 1], ['||', 3], ['&&', 4],
  ['|', 5], ['^', 6], ['&', 7], ['==', 8], ['!=', 8], ['<', 9], ['>', 9], ['<=', 9], ['>=', 9],
  ['<<', 10], ['>>', 10], ['+', 11], ['-', 11], ['*', 12], ['/', 12], ['%', 12]]);

export class SelectedCSyntax {
  constructor(rawBytes, counter, selectedTypedefNames, preprocessingOccurrence, decoderOccurrence) {
    this.source = preprocessSelectedC(rawBytes, counter, preprocessingOccurrence, decoderOccurrence); this.counter = counter; this.at = 0; this.last = null;
    this.source.tokens.forEach((token, ordinal) => { token.effectiveOrdinal = ordinal; });
    this.typedefScopes = [new Map([...selectedTypedefNames].map(name => [name, true]))]; this.controls = []; this.declarations = [];
    this.sourceTypeDerivations = [];
    this.parameterScopeOriginals = [];
    this.controlTargetOriginals = [];
    this.tagScopes = new WeakMap(); this.tagOriginals = [];
    installSelectedRecursionBounds(this);
  }
  peek(offset = 0) { return this.source.tokens[this.at + offset]; }
  composeSourceType(specifiers, declarator, parameter = false) {
    const occurrence = createSelectedCTypeOccurrence(this.counter);
    this.pendingSourceTypeDerivation = occurrence;
    this.sourceTypeDerivations.push(occurrence);
    return composeSelectedCSourceType(specifiers, declarator, this.counter, occurrence, parameter);
  }
  word() { return this.peek().spelling; }
  consume() { const token = this.peek(); if (token.kind === 'eof') deny('INVALID_SYNTAX', 'unexpected C EOF', token.origin); this.at++; this.last = token; return token; }
  take(word) { return this.word() === word ? this.consume() : null; }
  need(word) { const token = this.take(word); if (!token) deny('INVALID_SYNTAX', `C token ${word} required`, this.peek().origin); return token; }
  name() { const token = this.consume(); if (token.kind !== 'identifier' || keywords.has(token.spelling)) deny('INVALID_SYNTAX', 'C identifier required', token.origin); return { spelling: token.spelling, origin: token.origin }; }
  lexicalOriginal(word) { for (let index = this.typedefScopes.length - 1; index >= 0; index--) if (this.typedefScopes[index].has(word)) return this.typedefScopes[index].get(word); return false; }
  isTypedef(word) { const binding = this.lexicalOriginal(word); return typeof binding === 'object' ? binding.typedef : binding; }
  typedefOriginal(word) { const binding = this.lexicalOriginal(word); return binding && typeof binding === 'object' && binding.typedef ? binding : null; }
  tagScope(scope = this.typedefScopes.at(-1)) {
    let tags = this.tagScopes.get(scope);
    if (!tags) { tags = new Map(); this.tagScopes.set(scope, tags); }
    return tags;
  }
  tagOriginal(name) {
    for (let index = this.typedefScopes.length - 1; index >= 0; index--) {
      this.counter.charge('maxInvariantSteps', 'original-C-tag-lookup');
      const original = this.tagScopes.get(this.typedefScopes[index])?.get(name);
      if (original) return original;
    }
    return null;
  }
  declareTag(category, name, origin) {
    const tags = this.tagScope(), previous = name ? tags.get(name.spelling) : null;
    if (previous) {
      if (previous.category !== category) deny('INVALID_SYNTAX', 'C tag categories conflict in one scope', origin);
      return previous;
    }
    this.counter.charge('maxOccurrences', 'original-C-tag-declaration');
    const original = { category, name, origin, scopeOriginal: this.typedefScopes.at(-1), definition: null,
      defining: false, complete: false, failed: false, exception: undefined, nativeAuthority: false };
    this.pendingTagOriginal = original; this.tagOriginals.push(original);
    if (name) tags.set(name.spelling, original);
    return original;
  }
  isTypeStart(word = this.word()) { return specifierWords.has(word) || ['struct', 'union', 'enum', 'typedef'].includes(word) || this.isTypedef(word); }
  node(kind, first, fields = {}) {
    this.counter.charge('maxOccurrences', `c:${kind}:${first.origin.byte[0]}`);
    const end = this.last?.origin.utf16[1] ?? first.origin.utf16[1];
    if (end < first.origin.utf16[0]) deny('INVALID_ORIGIN', 'C source node endpoints reverse', first.origin);
    const origin = this.source.decoded.origin(first.origin.utf16[0], end);
    const effectiveRange = Number.isSafeInteger(first.effectiveOrdinal) && Number.isSafeInteger(this.last?.effectiveOrdinal)
      ? [first.effectiveOrdinal, this.last.effectiveOrdinal + 1] : null;
    return { kind, origin, effectiveRange, ...fields };
  }
  declaration(kind, first, fields) { this.counter.charge('maxDeclarations', `c:${kind}:${first.origin.byte[0]}`); const node = this.node(kind, first, fields); this.declarations.push(node); return node; }
  cSpecifiers() {
    const first = this.peek(), words = [], aggregates = []; let hasType = false, typedef = false, typedefOriginal = null;
    if (this.take('typedef')) typedef = true;
    while (true) {
      const word = this.word();
      if (specifierWords.has(word)) { words.push(this.consume()); hasType ||= scalarWords.has(word); continue; }
      if (['struct', 'union', 'enum'].includes(word)) { aggregates.push(this.cAggregate()); hasType = true; continue; }
      if (!hasType && this.isTypedef(word)) { typedefOriginal = this.typedefOriginal(word); words.push(this.consume()); hasType = true; continue; }
      break;
    }
    if (!hasType) deny('INVALID_SYNTAX', 'C declaration type is missing', first.origin);
    const scalar = classifySelectedCScalar(words, this.counter, first.origin);
    if (scalar && aggregates.length) deny('INVALID_SYNTAX', 'C aggregate and scalar specifiers conflict', first.origin);
    if (aggregates.length > 1) deny('INVALID_SYNTAX', 'C declaration has multiple aggregate specifiers', first.origin);
    return this.node('cSpecifiers', first, { words, aggregates, typedef, scalar, typedefOriginal });
  }
  cAggregate() {
    const first = this.consume(), category = first.spelling, name = this.peek().kind === 'identifier' && this.word() !== '{' ? this.name() : null;
    if (!this.take('{')) {
      if (!name) deny('INVALID_SYNTAX', 'C aggregate reference needs a tag', first.origin);
      const tagOriginal = this.tagOriginal(name.spelling) ?? this.declareTag(category, name, first.origin);
      return this.node('cAggregateReference', first, { category, name, tagOriginal });
    }
    const tagOriginal = this.declareTag(category, name, first.origin);
    if (tagOriginal.complete || tagOriginal.defining) deny('INVALID_SYNTAX', 'C tag content is defined more than once', first.origin);
    tagOriginal.defining = true;
    const members = [];
    tagOriginal.membersOriginal = members;
    try {
    if (category === 'enum') {
      while (this.word() !== '}') {
        const start = this.peek(), memberName = this.name();
        const bindingOriginal = { typedef: false, enumerationConstant: true, name: memberName, tagOriginal,
          previousOriginal: members.at(-1)?.bindingOriginal ?? null, valueOriginal: null, declaration: null, returned: false };
        tagOriginal.pendingEnumeratorOriginal = bindingOriginal;
        const value = this.take('=') ? this.cExpression(2) : null;
        bindingOriginal.valueOriginal = value;
        const names = this.typedefScopes.at(-1);
        if (names.has(memberName.spelling)) deny('INVALID_SYNTAX', 'C enumerator conflicts with an ordinary name in the same scope', memberName.origin);
        this.counter.charge('maxOccurrences', 'original-C-enumerator-binding');
        names.set(memberName.spelling, bindingOriginal);
        const declaration = this.declaration('cEnumMember', start, { name: memberName, value, bindingOriginal });
        bindingOriginal.declaration = declaration; members.push(declaration); bindingOriginal.returned = true;
        if (!this.take(',')) break;
      }
    } else while (this.word() !== '}') members.push(this.cDeclaration('field'));
    this.need('}');
    const definition = this.declaration('cAggregate', first, { category, name, members, tagOriginal });
    tagOriginal.definition = definition; tagOriginal.complete = true; tagOriginal.defining = false;
    return definition;
    } catch (original) { tagOriginal.exception = original; tagOriginal.failed = true; throw original; }
  }
  cDeclarator(abstract = false, scopeOwner = true) {
    const scopeDepth = this.typedefScopes.length;
    try {
    const first = this.peek(), pointers = []; let callingConvention = null;
    if (this.word() === 'WINAPI') callingConvention = this.consume();
    while (this.take('*')) {
      const start = this.last, qualifiers = [];
      while (['const', 'volatile'].includes(this.word())) qualifiers.push(this.consume());
      pointers.push(this.node('cPointerLayer', start, { qualifiers }));
    }
    let direct;
    const abstractFunction = abstract && this.word() === '(' &&
      (this.peek(1)?.spelling === ')' || this.isTypeStart(this.peek(1)?.spelling));
    if (!abstractFunction && this.take('(')) { direct = this.cDeclarator(abstract, false); this.need(')'); direct = this.node('cParenthesizedDeclarator', first, { declarator: direct }); }
    else if (this.peek().kind === 'identifier') direct = this.node('cDeclaredName', this.peek(), { name: this.name() });
    else if (abstract) {
      const savedLast = this.last, origin = this.source.decoded.origin(first.origin.utf16[0], first.origin.utf16[0]);
      this.last = { origin }; direct = this.node('cAbstractDeclarator', { origin }); this.last = savedLast;
    }
    else deny('INVALID_SYNTAX', 'C declarator name is missing', first.origin);
    const suffixes = [];
    while (true) {
      if (this.take('[')) {
        const start = this.last, length = this.word() === ']' ? null : this.cExpression(1); this.need(']');
        suffixes.push(this.node('cArrayLayer', start, { length })); continue;
      }
      if (this.take('(')) {
        const start = this.last, parameters = []; let prototype = 'unspecified', voidMarker = null, ellipsis = null;
        this.counter.charge('maxOccurrences', 'original-C-function-parameter-scope');
        const parameterScope = { original: start, names: new Map(), bindings: [], returned: false, failed: false };
        this.pendingParameterScope = parameterScope; this.parameterScopeOriginals.push(parameterScope);
        this.typedefScopes.push(parameterScope.names);
        try {
        if (this.word() === 'void' && this.peek(1)?.spelling === ')') { prototype = 'prototype'; voidMarker = this.consume(); }
        else if (this.word() !== ')') {
        prototype = 'prototype';
        do {
          if (this.word() === '...') {
            if (!parameters.length) deny('INVALID_SYNTAX', 'C ellipsis requires an earlier parameter', this.peek().origin);
            ellipsis = this.consume(); break;
          }
          const parameterFirst = this.peek(), specifiers = this.cSpecifiers(), declarator = this.word() === ',' || this.word() === ')' ? null : this.cDeclarator(true);
          const name = declarator ? this.declaratorName(declarator) : null;
          let bindingOriginal = null;
          if (name) {
            this.counter.charge('maxOccurrences', 'original-C-parameter-name-binding');
            const binding = { name, declarator, specifiers, typedef: false, returned: false }; parameterScope.pending = binding;
            bindingOriginal = binding;
            parameterScope.bindings.push(binding);
            if (parameterScope.names.has(name.spelling)) deny('INVALID_SYNTAX', 'duplicate C parameter name', name.origin);
            parameterScope.names.set(name.spelling, binding); binding.returned = true;
          }
          const { declaredType: sourceType, adjustedType: parameterType } = this.composeSourceType(specifiers, declarator, true);
          if (bindingOriginal) Object.defineProperties(bindingOriginal, {
            sourceType: { value: sourceType }, parameterType: { value: parameterType } });
          const unqualifiedType = resolveSelectedCSourceHead(sourceType, this.counter);
          if (unqualifiedType.kind === 'cScalarSourceType' && unqualifiedType.base === 'void')
            deny('INVALID_SYNTAX', 'C void parameter must be the sole unnamed void marker', parameterFirst.origin);
          parameters.push(this.declaration('cParameter', parameterFirst, { specifiers, declarator, sourceType, parameterType, bindingOriginal }));
        } while (this.take(','));
        }
        this.need(')'); suffixes.push(this.node('cFunctionLayer', start, { parameters, prototype, voidMarker, ellipsis, parameterScope }));
        parameterScope.returned = true;
        } catch (original) { parameterScope.originalFailure = original; parameterScope.failed = true; throw original; }
        continue;
      }
      break;
    }
    return this.node('cDeclarator', first, { pointers, direct, suffixes, callingConvention });
    } finally { if (scopeOwner) while (this.typedefScopes.length > scopeDepth) this.typedefScopes.pop(); }
  }
  declaratorName(declarator) {
    if (declarator.kind === 'cDeclaredName') return declarator.name;
    return declarator.direct ? this.declaratorName(declarator.direct) : declarator.declarator ? this.declaratorName(declarator.declarator) : null;
  }
  cInitializer() {
    const first = this.peek();
    if (!this.take('{')) return this.cExpression(1);
    const elements = [];
    while (this.word() !== '}') { elements.push(this.cInitializer()); if (!this.take(',')) break; }
    this.need('}'); return this.node('cInitializer', first, { elements });
  }
  cDeclaration(category = 'storage') {
    const first = this.peek(), specifiers = this.cSpecifiers(), declarations = [];
    if (this.take(';')) {
      if (specifiers.aggregates.length === 1 && specifiers.aggregates[0].kind === 'cAggregateReference') {
        const aggregate = specifiers.aggregates[0];
        if (aggregate.category !== 'enum') aggregate.tagOriginal = this.declareTag(aggregate.category, aggregate.name, aggregate.origin);
      }
      return this.node('cDeclarationGroup', first, { specifiers, declarations });
    }
    do {
      const start = this.peek(), declarator = category === 'field' && this.word() === ':' ? null : this.cDeclarator();
      const name = declarator ? this.declaratorName(declarator) : null;
      const sourceType = this.composeSourceType(specifiers, declarator);
      const sourceHead = resolveSelectedCSourceHead(sourceType, this.counter);
      if (!specifiers.typedef && sourceHead.kind === 'cScalarSourceType' && sourceHead.base === 'void')
        deny('INVALID_SYNTAX', 'C object cannot have plain void source type', start.origin);
      const sourceObjectCompleteKnown = category === 'field' ? checkSelectedCSourceObjectCompleteness(sourceType, this.counter, start.origin) : null;
      const bitFieldToken = this.take(':');
      if (bitFieldToken && category !== 'field') deny('INVALID_SYNTAX', 'C bit-field occurs outside an aggregate member', bitFieldToken.origin);
      const bitWidth = bitFieldToken ? this.cExpression(2) : null;
      let typedefBinding = null, bindingOriginal = null;
      if (name && category !== 'field') {
        this.counter.charge('maxOccurrences', 'original-C-lexical-type-binding');
        bindingOriginal = Object.freeze({ typedef: specifiers.typedef, sourceType, declarator, name, specifiers });
        this.pendingLexicalBinding = bindingOriginal;
        if (specifiers.typedef) { typedefBinding = bindingOriginal; this.pendingTypedefBinding = typedefBinding; }
        this.typedefScopes.at(-1).set(name.spelling, bindingOriginal);
      }
      if (this.word() === '{') {
        if (category !== 'storage' || specifiers.typedef || declarations.length) deny('INVALID_SYNTAX', 'C function definition placement differs', first.origin);
        if (sourceType.kind !== 'cFunctionSourceType') deny('INVALID_SYNTAX', 'C definition requires an actual function declarator', first.origin);
        const parameters = sourceType.parameters;
        const definitionCompletenessOriginal = { sourceType, parameters, resultKnown: null, parameterResults: [], parameterChecks: [], returned: false, failed: false };
        this.pendingDefinitionCompletenessOriginal = definitionCompletenessOriginal;
        try {
          const resultHead = resolveSelectedCSourceHead(sourceType.result, this.counter);
          definitionCompletenessOriginal.resultKnown = resultHead.kind === 'cScalarSourceType' && resultHead.base === 'void' ? true :
            checkSelectedCSourceObjectCompleteness(sourceType.result, this.counter, first.origin);
          for (const parameter of parameters) {
            const check = { parameterOriginal: parameter, value: undefined, returned: false };
            definitionCompletenessOriginal.pendingParameterOriginal = check;
            definitionCompletenessOriginal.parameterChecks.push(check);
            check.value = checkSelectedCSourceObjectCompleteness(parameter.parameterType, this.counter, parameter.origin);
            check.returned = true;
            definitionCompletenessOriginal.parameterResults.push(check.value);
          }
          definitionCompletenessOriginal.returned = true;
        } catch (original) { definitionCompletenessOriginal.original = original; definitionCompletenessOriginal.failed = true; throw original; }
        const parameterNames = parameters.map(parameter => parameter.declarator ? this.declaratorName(parameter.declarator)?.spelling : null);
        if (parameterNames.some(name => !name) || new Set(parameterNames).size !== parameterNames.length)
          deny('INVALID_SYNTAX', 'C function definition requires unique named parameters', first.origin);
        const body = this.cBlock(parameterNames, parameters, sourceType.original.parameterScope), labelGraph = this.bindCLabels(body);
        return this.declaration('cFunction', first, { specifiers, declarator, name, body, sourceType, labelGraph, bindingOriginal, definitionCompletenessOriginal });
      }
      const initializer = this.take('=') ? this.cInitializer() : null;
      if (bitFieldToken && initializer) deny('INVALID_SYNTAX', 'C bit-field declaration has an initializer', bitFieldToken.origin);
      declarations.push(this.declaration(specifiers.typedef ? 'cTypedef' : category === 'field' ? 'cField' : 'cStorage', start, { specifiers, declarator, name, initializer, storageCategory: category, sourceType, typedefBinding, bindingOriginal, bitFieldToken, bitWidth, sourceObjectCompleteKnown }));
      if (specifiers.typedef && (!name || initializer)) deny('INVALID_SYNTAX', 'typedef needs a named uninitialized declarator', start.origin);
    } while (this.take(','));
    this.need(';'); return this.node('cDeclarationGroup', first, { specifiers, declarations });
  }
  bindCLabels(body) {
    this.counter.charge('maxOccurrences', 'original-C-function-label-graph');
    const owner = { body, labels: new Map(), gotos: [], pending: null, returned: false, failed: false };
    this.pendingLabelGraph = owner;
    try {
      owner.work = [body];
      while (owner.work.length) {
        this.counter.charge('maxInvariantSteps', 'original-C-label-statement');
        const statement = owner.work.pop(); owner.current = statement;
        if (statement.kind === 'cLabel') {
          const row = { statement, name: statement.name, returned: false }; owner.pending = row;
          this.counter.charge('maxOccurrences', 'original-C-label-binding');
          if (owner.labels.has(row.name.spelling)) deny('INVALID_SYNTAX', 'duplicate C function label', row.name.origin);
          owner.labels.set(row.name.spelling, row); row.returned = true;
        } else if (statement.kind === 'goto') {
          const row = { statement, name: statement.target, target: null, returned: false }; owner.pending = row;
          this.counter.charge('maxOccurrences', 'original-C-goto-binding'); owner.gotos.push(row);
        }
        const append = child => { if (child) { this.counter.charge('maxInvariantSteps', 'original-C-label-statement-edge'); owner.work.push(child); } };
        if (statement.kind === 'block') for (let index = statement.statements.length - 1; index >= 0; index--) append(statement.statements[index]);
        else if (statement.kind === 'if') { append(statement.alternative); append(statement.body); }
        else if (['while', 'do', 'for', 'switch'].includes(statement.kind)) append(statement.body);
        else if (['cLabel', 'cCase', 'cDefault'].includes(statement.kind)) append(statement.statement);
      }
      for (const row of owner.gotos) {
        owner.pending = row; this.counter.charge('maxInvariantSteps', 'original-C-goto-target');
        row.target = owner.labels.get(row.name.spelling) ?? null;
        if (!row.target) deny('INVALID_SYNTAX', 'C goto target is missing from its function', row.name.origin);
        row.returned = true;
      }
      owner.returned = true; return owner;
    } catch (original) { owner.original = original; owner.failed = true; throw original; }
  }
  cPrimary() {
    const first = this.peek();
    if (['number', 'string', 'char'].includes(first.kind)) {
      this.consume();
      if (first.kind !== 'string') return this.node('literal', first, { token: first });
      const tokens = [first], wide = first.spelling.startsWith('L');
      while (this.peek().kind === 'string') { const token = this.consume(); if (token.spelling.startsWith('L') !== wide) deny('UNSUPPORTED_FORM', 'C adjacent literal widths differ', token.origin); tokens.push(token); }
      return this.node('cString', first, { tokens, wide });
    }
    if (this.take('(')) { const expression = this.cExpression(0); this.need(')'); return this.node('group', first, { expression }); }
    if (first.kind === 'identifier') {
      const name = this.name(), original = this.lexicalOriginal(name.spelling);
      return this.node('name', first, { name, bindingOriginal: original && typeof original === 'object' && !original.typedef ? original : null });
    }
    deny('UNSUPPORTED_FORM', 'unbound C primary', first.origin);
  }
  cExpression(minimum = 1) {
    const first = this.peek(); let left;
    if (['&', '*', '+', '-', '!', '~', '++', '--'].includes(this.word())) { const operation = this.consume().spelling; left = this.node('unary', first, { operation, operand: this.cExpression(13) }); }
    else if (this.take('sizeof')) {
      if (this.word() === '(' && (specifierWords.has(this.peek(1)?.spelling) || ['struct', 'union', 'enum'].includes(this.peek(1)?.spelling) || this.isTypedef(this.peek(1)?.spelling))) {
        this.consume(); const specifiers = this.cSpecifiers(), declarator = this.word() === ')' ? null : this.cDeclarator(true); this.need(')');
        const sourceType = this.composeSourceType(specifiers, declarator);
        left = this.node('cSizeofType', first, { specifiers, declarator, sourceType });
      } else left = this.node('cSizeofExpression', first, { expression: this.cExpression(13) });
    } else if (this.word() === '(' && (specifierWords.has(this.peek(1)?.spelling) || ['struct', 'union', 'enum'].includes(this.peek(1)?.spelling) || this.isTypedef(this.peek(1)?.spelling))) {
      this.consume(); const specifiers = this.cSpecifiers(), declarator = this.word() === ')' ? null : this.cDeclarator(true); this.need(')');
      const sourceType = this.composeSourceType(specifiers, declarator);
      left = this.node('cCast', first, { specifiers, declarator, sourceType, operand: this.cExpression(13) });
    } else left = this.cPrimary();
    while (true) {
      if (['.', '->'].includes(this.word())) { const operation = this.consume().spelling; left = this.node('cMember', first, { target: left, operation, name: this.name() }); continue; }
      if (this.take('[')) { const index = this.cExpression(0); this.need(']'); left = this.node('index', first, { target: left, index }); continue; }
      if (this.take('(')) {
        const arguments_ = [];
        if (this.word() !== ')') do { arguments_.push(this.cExpression(1)); } while (this.take(','));
        this.need(')'); left = this.node('cCall', first, { target: left, arguments: arguments_ }); continue;
      }
      if (['++', '--'].includes(this.word())) { left = this.node('postfix', first, { operation: this.consume().spelling, operand: left }); continue; }
      if (minimum <= 2 && this.take('?')) { const whenTrue = this.cExpression(0); this.need(':'); const whenFalse = this.cExpression(2); left = this.node('conditional', first, { test: left, whenTrue, whenFalse }); continue; }
      if (minimum === 0 && this.take(',')) { left = this.node('cComma', first, { left, right: this.cExpression(1) }); continue; }
      const operation = this.word(), level = levels.get(operation);
      if (level === undefined || level < minimum) break;
      this.consume(); left = this.node(level === 1 ? 'assignment' : 'binary', first, { operation, left, right: this.cExpression(level === 1 ? level : level + 1) });
    }
    return left;
  }
  cBlock(parameterNames = [], parameters = [], parameterScope = null) {
    const first = this.need('{'), statements = [];
    this.typedefScopes.push(parameterScope?.names ?? new Map(parameterNames.map((name, ordinal) => [name, parameters[ordinal]?.bindingOriginal ?? false])));
    try { while (this.word() !== '}') { if (this.peek().kind === 'eof') deny('INVALID_SYNTAX', 'unterminated C block', first.origin); statements.push(this.cStatement(true)); } this.need('}'); }
    finally { this.typedefScopes.pop(); }
    return this.node('block', first, { statements });
  }
  cControlTarget(kind, original) {
    this.counter.charge('maxOccurrences', 'original-C-control-target');
    const target = { kind, original, body: undefined, returned: false, failed: false };
    this.pendingControlTarget = target; this.controlTargetOriginals.push(target); return target;
  }
  cControl(target) {
    this.controls.push(target);
    try { target.body = this.cStatement(); target.returned = true; return target.body; }
    catch (original) { target.originalFailure = original; target.failed = true; throw original; }
    finally { this.controls.pop(); }
  }
  cControlOriginal(kind) {
    for (let index = this.controls.length - 1; index >= 0; index--) {
      this.counter.charge('maxInvariantSteps', 'original-C-control-target-lookup');
      if (kind === 'break' || this.controls[index].kind === kind) return this.controls[index];
    }
    return null;
  }
  cStatement(blockItem = false) {
    const first = this.peek(), word = this.word();
    if (word === '{') return this.cBlock();
    if (this.take(';')) return this.node('empty', first);
    if (this.peek().kind === 'identifier' && !keywords.has(word) && this.peek(1)?.spelling === ':') { const name = this.name(); this.need(':'); return this.declaration('cLabel', first, { name, statement: this.cStatement() }); }
    if (this.isTypeStart()) {
      if (!blockItem) deny('INVALID_SYNTAX', 'C declaration requires compound block-item context', first.origin);
      return this.cDeclaration('local');
    }
    if (this.take('if')) { this.need('('); const test = this.cExpression(0); this.need(')'); const body = this.cStatement(), alternative = this.take('else') ? this.cStatement() : null; return this.node('if', first, { test, body, alternative }); }
    if (this.take('while')) { this.need('('); const test = this.cExpression(0); this.need(')'); const targetOriginal = this.cControlTarget('loop', first); return this.node('while', first, { test, targetOriginal, body: this.cControl(targetOriginal) }); }
    if (this.take('do')) { const targetOriginal = this.cControlTarget('loop', first), body = this.cControl(targetOriginal); this.need('while'); this.need('('); const test = this.cExpression(0); this.need(')'); this.need(';'); return this.node('do', first, { body, test, targetOriginal }); }
    if (this.take('for')) {
      this.need('('); this.typedefScopes.push(new Map());
      try {
        const initializer = this.take(';') ? null : this.isTypeStart() ? this.cDeclaration('local') : (() => { const expression = this.cExpression(0); this.need(';'); return expression; })();
        const test = this.word() === ';' ? null : this.cExpression(0); this.need(';'); const increment = this.word() === ')' ? null : this.cExpression(0); this.need(')');
        const targetOriginal = this.cControlTarget('loop', first);
        return this.node('for', first, { initializer, test, increment, targetOriginal, body: this.cControl(targetOriginal) });
      } finally { this.typedefScopes.pop(); }
    }
    if (this.take('switch')) { this.need('('); const test = this.cExpression(0); this.need(')'); const targetOriginal = this.cControlTarget('switch', first); return this.node('switch', first, { test, targetOriginal, body: this.cControl(targetOriginal) }); }
    if (this.take('case')) { const targetOriginal = this.cControlOriginal('switch'); if (!targetOriginal) deny('INVALID_SYNTAX', 'case lacks switch target', first.origin); const value = this.cExpression(2); this.need(':'); return this.node('cCase', first, { value, targetOriginal, statement: this.cStatement() }); }
    if (this.take('default')) { const targetOriginal = this.cControlOriginal('switch'); if (!targetOriginal) deny('INVALID_SYNTAX', 'default lacks switch target', first.origin); this.need(':'); return this.node('cDefault', first, { targetOriginal, statement: this.cStatement() }); }
    if (this.take('goto')) { const target = this.name(); this.need(';'); return this.node('goto', first, { target }); }
    if (['return', 'break', 'continue'].includes(word)) {
      this.consume();
      const targetOriginal = word === 'return' ? null : this.cControlOriginal(word === 'continue' ? 'loop' : 'break');
      if (word !== 'return' && !targetOriginal) deny('INVALID_SYNTAX', 'C completion has no control target', first.origin);
      const value = word === 'return' && this.word() !== ';' ? this.cExpression(0) : null; this.need(';'); return this.node(word, first, { value, targetOriginal });
    }
    const expression = this.cExpression(0); this.need(';'); return this.node('expressionStatement', first, { expression });
  }
  cUnit() {
    const first = this.peek(), declarations = [];
    while (this.peek().kind !== 'eof') declarations.push(this.cDeclaration());
    const eof = this.peek(); this.last = eof;
    if (eof.origin.byte[1] !== this.source.decoded.raw.length) deny('INCOMPLETE_INPUT', 'C complete original EOF differs', eof.origin);
    return this.node('unit', first, { directives: this.source.directives, declarations });
  }
}

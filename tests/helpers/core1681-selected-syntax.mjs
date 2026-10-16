import { deny, isSourceDenialCode } from './core1681-source-input.mjs';
import { SelectedScanner } from './core1681-selected-scanner.mjs';
import { K2_LIMITS } from './core1681-proof-terms.mjs';

const recursiveProductions = ['typeRef', 'initializer', 'knownType', 'primary', 'expression', 'block', 'statement', 'csharpDeclaration',
  'psPrimary', 'psExpression', 'psCommandArgument', 'psBlock', 'psStatement',
  'jsPattern', 'jsPrimary', 'jsExpression', 'jsBlock', 'jsStatement', 'jsExport',
  'cSpecifiers', 'cAggregate', 'cDeclarator', 'declaratorName', 'cInitializer', 'cDeclaration', 'cPrimary', 'cExpression', 'cBlock', 'cStatement'];

export function installSelectedRecursionBounds(parser) {
  let depth = 0;
  for (const name of recursiveProductions) {
    const production = parser[name]; if (typeof production !== 'function') continue;
    parser[name] = function (...arguments_) {
      if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', `selected grammar depth exhausted at ${name}`);
      depth++;
      try { return production.apply(this, arguments_); } finally { depth--; }
    };
  }
}

const modifiers = new Set(['public', 'private', 'protected', 'internal', 'static', 'readonly', 'const',
  'extern', 'sealed', 'abstract', 'virtual', 'override', 'new', 'partial', 'volatile']);
const csKeywords = new Set(('abstract as base bool break byte case catch char checked class const continue decimal default '
  + 'delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int '
  + 'interface internal is lock long namespace new null object operator out override params private protected public '
  + 'readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof '
  + 'uint ulong unchecked unsafe ushort using virtual void volatile while').split(' '));
const builtinTypes = new Set('bool byte char decimal double float int long object sbyte short string uint ulong ushort void'.split(' '));
const precedence = new Map([['=', 1], ['+=', 1], ['-=', 1], ['*=', 1], ['/=', 1], ['%=', 1],
  ['&=', 1], ['|=', 1], ['^=', 1], ['<<=', 1], ['>>=', 1], ['??', 3], ['||', 4], ['&&', 5],
  ['|', 6], ['^', 7], ['&', 8], ['==', 9], ['!=', 9], ['===', 9], ['!==', 9],
  ['<', 10], ['>', 10], ['<=', 10], ['>=', 10], ['is', 10], ['as', 10],
  ['<<', 11], ['>>', 11], ['+', 12], ['-', 12], ['*', 13], ['/', 13], ['%', 13]]);

// Actual syntax trees precede binding and transfer construction. This module
// installs no role-name/body-hash acceptance rule and no semantic purity claim.
export class SelectedSyntax {
  constructor(rawBytes, language, counter, typeNames = new Set(), decoderOccurrence) {
    this.scanner = new SelectedScanner(rawBytes, language, counter, decoderOccurrence);
    this.language = language; this.counter = counter; this.current = null;
    this.last = null; this.typeStack = []; this.controlStack = []; this.catchDepth = 0;
    this.declarations = [];
    this.typeNames = new Set([...builtinTypes, ...typeNames]);
    installSelectedRecursionBounds(this);
  }
  peek(goal = 'division') {
    if (this.language === 'javascript' && goal === 'regexp' && this.current?.kind === 'punctuation' && this.current.spelling.startsWith('/')) {
      this.scanner.at = this.current.origin.utf16[0]; this.current = null;
    }
    if (!this.current) this.current = this.scanner.next(goal);
    return this.current;
  }
  word(goal) { return this.peek(goal).spelling; }
  consume(goal) { const token = this.peek(goal); this.current = null; this.last = token; return token; }
  take(spelling) { return this.word() === spelling ? this.consume() : null; }
  need(spelling) {
    const token = this.take(spelling);
    if (!token) deny('INVALID_SYNTAX', `expected ${spelling}, found ${this.word()}`, this.peek().origin);
    return token;
  }
  name(typePosition = false, property = false) {
    const token = this.consume();
    if (token.kind !== 'identifier' || this.language === 'csharp' && csKeywords.has(token.spelling) &&
        !token.escapedIdentifier && !(typePosition && builtinTypes.has(token.spelling)))
      deny('INVALID_SYNTAX', 'selected identifier required', token.origin);
    return { spelling: token.spelling.replace(/^@/u, ''), origin: token.origin,
      ...(token.escapedIdentifier ? { escapedIdentifier: true } : {}) };
  }
  mark() { return { at: this.scanner.at, current: this.current, last: this.last, trivia: this.scanner.trivia.length, declarations: this.declarations.length }; }
  restore(mark) { this.scanner.at = mark.at; this.current = mark.current; this.last = mark.last; this.scanner.trivia.length = mark.trivia; this.declarations.length = mark.declarations; }
  node(kind, first, fields = {}) {
    this.counter.charge('maxOccurrences', `${kind}:${first.origin.utf16[0]}`);
    const end = this.last?.origin.utf16[1] ?? first.origin.utf16[1];
    return { kind, origin: this.scanner.origin(first.origin.utf16[0], end), ...fields };
  }
  declaration(kind, first, fields) {
    this.counter.charge('maxDeclarations', `${kind}:${first.origin.utf16[0]}`);
    const declaration = this.node(kind, first, fields); this.declarations.push(declaration); return declaration;
  }
  greater() {
    if (this.take('>')) return;
    const token = this.peek();
    if (!['>>', '>>>'].includes(token.spelling)) this.need('>');
    const start = token.origin.utf16[0];
    this.last = { ...token, spelling: '>', origin: this.scanner.origin(start, start + 1) };
    this.current = { ...token, spelling: token.spelling.slice(1), origin: this.scanner.origin(start + 1, token.origin.utf16[1]) };
  }
  typeRef(array = true) {
    const first = this.peek(), segments = [];
    do {
      const name = this.name(true), arguments_ = [];
      if (this.take('<')) { do { arguments_.push(this.typeRef()); } while (this.take(',')); this.greater(); }
      segments.push({ name, arguments: arguments_ });
    } while (this.take('.'));
    let type = this.node('namedType', first, { segments });
    if (this.take('?')) type = this.node('nullableType', first, { element: type });
    if (array) while (this.word() === '[') {
      const mark = this.mark(); this.consume();
      let rank = 1;
      while (this.take(',')) {
        this.counter.charge('maxInvariantSteps', 'array-rank-specifier');
        if (++rank > 32) deny('INVALID_SYNTAX', 'array rank exceeds selected CLR extent', this.last.origin);
      }
      if (!this.take(']')) { this.restore(mark); break; }
      type = this.node('arrayType', first, { element: type, rank });
    }
    return type;
  }
  attributes() {
    const attributes = [];
    while (this.take('[')) {
      const first = this.last;
      do {
        const type = this.typeRef(), arguments_ = this.word() === '(' ? this.arguments() : [];
        attributes.push(this.node('attribute', first, { type, arguments: arguments_ }));
      } while (this.take(','));
      this.need(']');
    }
    return attributes;
  }
  genericParameters() {
    const parameters = [];
    if (!this.take('<')) return parameters;
    do {
      const first = this.peek(), variance = ['in', 'out'].includes(this.word()) ? this.consume().spelling : null;
      const name = this.name(); parameters.push(this.declaration('typeParameter', first, { name, variance }));
    } while (this.take(',')); this.greater(); return parameters;
  }
  constraints() {
    const constraints = [];
    while (this.take('where')) {
      const first = this.last, parameter = this.name(), alternatives = []; this.need(':');
      do {
        if (['class', 'struct'].includes(this.word())) alternatives.push(this.node('typeConstraint', this.consume(), { category: this.last.spelling }));
        else if (this.take('new')) { this.need('('); this.need(')'); alternatives.push(this.node('constructorConstraint', this.last)); }
        else alternatives.push(this.typeRef());
      } while (this.take(','));
      constraints.push(this.node('constraintClause', first, { parameter, alternatives }));
    }
    return constraints;
  }
  parameters() {
    const parameters = []; this.need('(');
    if (this.word() !== ')') do {
      const first = this.peek(), attributes = this.attributes();
      const direction = ['ref', 'out', 'in'].includes(this.word()) ? this.consume().spelling : 'value';
      const variadic = Boolean(this.take('params')), type = this.typeRef(), name = this.name();
      const defaultValue = this.take('=') ? this.expression() : null;
      parameters.push(this.declaration('parameter', first, { attributes, direction, variadic, type, name, defaultValue }));
    } while (this.take(','));
    this.need(')'); return parameters;
  }
  arguments() {
    const arguments_ = []; this.need('(');
    if (this.word() !== ')') do {
      const first = this.peek(), mark = this.mark(); let name = null;
      if (first.kind === 'identifier' && (!csKeywords.has(first.spelling) || first.escapedIdentifier)) {
        const candidate = this.name();
        if (this.take(':')) name = candidate;
        else this.restore(mark);
      }
      const direction = ['ref', 'out', 'in'].includes(this.word()) ? this.consume().spelling : 'value';
      arguments_.push(this.node('argument', first, { name, direction, expression: this.expression() }));
    } while (this.take(','));
    this.need(')'); return arguments_;
  }
  initializer() {
    const first = this.need('{'), elements = [];
    while (this.word() !== '}') {
      elements.push(this.word() === '{' ? this.initializer() : this.expression());
      if (!this.take(',')) break;
    }
    this.need('}'); return this.node('initializer', first, { elements });
  }
  lambda(first, parameters) {
    const previousControl = this.controlStack, previousCatch = this.catchDepth;
    this.controlStack = []; this.catchDepth = 0;
    let body;
    try { body = this.word() === '{' ? this.block() : this.expression(); }
    finally { this.controlStack = previousControl; this.catchDepth = previousCatch; }
    return this.declaration('lambda', first, { parameters, body });
  }
  knownType(type) {
    if (['arrayType', 'nullableType'].includes(type.kind)) return this.knownType(type.element);
    return type.kind === 'namedType' && this.typeNames.has(type.segments.map(segment => segment.name.spelling).join('.'));
  }
  castStart(type) {
    // C# cast disambiguation is grammatical, not lookup of identifier meaning.
    // Array/nullable productions cannot be the enclosed complete expression;
    // a bare predefined type keyword cannot be an expression either.
    if (['arrayType', 'nullableType'].includes(type.kind)) return true;
    if (type.kind !== 'namedType') return false;
    const segments = type.segments;
      // A completed type-argument list ends in '>'; those same enclosed
      // tokens cannot be a complete relational expression with no right side.
      if (segments.some(segment => segment.arguments.length)) return true;
    if (segments.length === 1 && !segments[0].arguments.length &&
        !segments[0].name.escapedIdentifier && builtinTypes.has(segments[0].name.spelling)) return true;
    const following = this.peek();
    return ['~', '!', '('].includes(following.spelling) ||
      ['number', 'string', 'character', 'interpolatedStart'].includes(following.kind) ||
      following.kind === 'identifier' && !['as', 'is'].includes(following.spelling);
  }
  primary(allowLambda = true) {
    const first = this.peek('regexp'), spelling = first.spelling;
    if (first.kind === 'interpolatedStart') {
      this.consume(); const parts = [];
      while (true) {
        const part = this.scanner.csharpInterpolatedPart(); this.last = part;
        parts.push({ kind: 'interpolatedText', origin: this.scanner.origin(part.origin.utf16[0], part.textEnd),
          raw: this.scanner.text.slice(part.origin.utf16[0], part.textEnd) });
        if (part.kind === 'interpolatedTail') break;
        const expression = this.expression();
        const alignment = this.take(',') ? this.expression() : null;
        let format = null;
        if (this.take(':')) {
          const formatPart = this.scanner.csharpInterpolatedPart(true); this.last = formatPart;
          format = { kind: 'interpolatedFormatText', origin: this.scanner.origin(formatPart.origin.utf16[0], formatPart.textEnd),
            raw: this.scanner.text.slice(formatPart.origin.utf16[0], formatPart.textEnd) };
        } else this.need('}');
        parts.push({ kind: 'interpolatedHole', origin: this.scanner.origin(part.origin.utf16[1] - 1, this.last.origin.utf16[1]),
          expression, alignment, format });
      }
      return this.node('interpolatedString', first, { parts });
    }
    if (['string', 'char', 'number', 'regexp'].includes(first.kind) || ['true', 'false', 'null'].includes(spelling)) {
      this.consume(); return this.node('literal', first, { token: first });
    }
    if (this.take('new')) {
      if (this.take('[')) { this.need(']'); return this.node('newImplicitArray', first, { initializer: this.initializer() }); }
      const type = this.typeRef(false);
      if (this.take('[')) {
        const length = this.word() === ']' ? null : this.expression(); this.need(']');
        const initializer = this.word() === '{' ? this.initializer() : null;
        return this.node('newArray', first, { type, length, initializer });
      }
      const arguments_ = this.word() === '(' ? this.arguments() : [];
      const initializer = this.word() === '{' ? this.initializer() : null;
      return this.node('newObject', first, { type, arguments: arguments_, initializer });
    }
    if (['typeof', 'sizeof', 'default'].includes(spelling)) {
      this.consume(); this.need('('); const type = this.typeRef(); this.need(')');
      return this.node('typeExpression', first, { operation: spelling, type });
    }
    if (['checked', 'unchecked'].includes(spelling)) {
      this.consume(); this.need('('); const expression = this.expression(); this.need(')');
      return this.node('arithmeticContext', first, { checked: spelling === 'checked', expression });
    }
    if (this.take('(')) {
      const start = this.mark(), parameters = []; let lambdaParameters = true;
      try {
        if (this.word() !== ')') do {
          const parameterStart = this.peek(), parameterMark = this.mark(); let type = null, name;
          const direction = ['ref', 'out', 'in'].includes(this.word()) ? this.consume().spelling : 'value';
          const typeMark = this.mark();
          try { type = this.typeRef(); name = this.name(); }
          catch (error) {
            if (!isSourceDenialCode(error, 'INVALID_SYNTAX') && !isSourceDenialCode(error, 'UNSUPPORTED_FORM')) throw error;
            this.restore(typeMark); type = null; name = this.name();
          }
          if (!type && direction !== 'value') { this.restore(parameterMark); lambdaParameters = false; break; }
          parameters.push(this.declaration('lambdaParameter', parameterStart, { type, name, direction }));
        } while (this.take(','));
        if (lambdaParameters && this.take(')') && this.take('=>')) {
          if (!allowLambda) deny('INVALID_SYNTAX', 'ungrouped lambda requires assignment-expression context', first.origin);
          return this.lambda(first, parameters);
        }
      } catch (error) { if (!isSourceDenialCode(error, 'INVALID_SYNTAX') && !isSourceDenialCode(error, 'UNSUPPORTED_FORM')) throw error; }
      this.restore(start);
      const castMark = this.mark(); let castType = null;
      try { castType = this.typeRef(); if (!this.take(')') || !this.castStart(castType)) castType = null; }
      catch (error) { if (!isSourceDenialCode(error, 'INVALID_SYNTAX') && !isSourceDenialCode(error, 'UNSUPPORTED_FORM')) throw error; }
      if (castType) return this.node('cast', first, { type: castType, operand: this.expression(14) });
      this.restore(castMark);
      const expression = this.expression(); this.need(')');
      return this.node('group', first, { expression });
    }
    if (['this', 'base'].includes(spelling)) { this.consume(); return this.node('receiver', first, { category: spelling }); }
    if (this.language === 'csharp' && builtinTypes.has(spelling) && spelling !== 'void') {
      this.consume(); return this.node('typeNameExpression', first, { type: this.node('namedType', first, { segments: [{ name: { spelling, origin: first.origin }, arguments: [] }] }) });
    }
    if (first.kind === 'identifier') {
      const name = this.name();
      if (this.take('=>')) {
        if (!allowLambda) deny('INVALID_SYNTAX', 'ungrouped lambda requires assignment-expression context', first.origin);
        return this.lambda(first, [this.declaration('lambdaParameter', first, { name, type: null, direction: 'value' })]);
      }
      return this.node('name', first, { name });
    }
    deny('UNSUPPORTED_FORM', `unbound selected primary ${spelling}`, first.origin);
  }
  expression(minimum = 1) {
    const first = this.peek('regexp'); let left;
    if (['+', '-', '!', '~', '++', '--'].includes(first.spelling)) {
      const operatorToken = this.consume();
      left = this.node('unary', first, { operation: first.spelling, operatorToken, operand: this.expression(14) });
    } else left = this.primary(minimum <= 2);
    if (left.kind === 'lambda') return left;
    while (true) {
      if (this.take('.')) { left = this.node('member', first, { target: left, name: this.name(false, true) }); continue; }
      if (this.word() === '(') { left = this.node('call', first, { target: left, arguments: this.arguments() }); continue; }
      if (this.language === 'csharp' && this.word() === '<' && ['name', 'member'].includes(left.kind)) {
        const mark = this.mark(), typeArguments = [];
        try {
          this.consume(); do { typeArguments.push(this.typeRef()); } while (this.take(',')); this.greater();
          if (this.word() === '(') { left = this.node('genericMember', first, { target: left, typeArguments }); continue; }
        } catch (error) { if (!isSourceDenialCode(error, 'INVALID_SYNTAX') && !isSourceDenialCode(error, 'UNSUPPORTED_FORM')) throw error; }
        this.restore(mark);
      }
      if (this.take('[')) { const index = this.expression(); this.need(']'); left = this.node('index', first, { target: left, index }); continue; }
      if (['++', '--'].includes(this.word())) {
        const operatorToken = this.consume();
        left = this.node('postfix', first, { operation: operatorToken.spelling, operatorToken, operand: left }); continue;
      }
      if (this.word() === '?' && minimum <= 2) {
        this.consume(); const whenTrue = this.expression(); this.need(':'); const whenFalse = this.expression(2);
        left = this.node('conditional', first, { test: left, whenTrue, whenFalse }); continue;
      }
      const operation = this.word(), level = precedence.get(operation);
      if (level === undefined || level < minimum) break;
      const operatorToken = this.consume();
      const right = ['is', 'as'].includes(operation) ? this.typeRef() : this.expression(level === 1 || operation === '??' ? level : level + 1);
      left = this.node(level === 1 ? 'assignment' : 'binary', first, { operation, operatorToken, left, right });
    }
    return left;
  }
  block() {
    const first = this.need('{'), statements = [];
    while (this.word() !== '}') {
      if (this.peek().kind === 'eof') deny('INVALID_SYNTAX', 'unterminated selected block', first.origin);
      statements.push(this.statement());
    }
    this.need('}'); return this.node('block', first, { statements });
  }
  embeddedStatement() {
    const statement = this.statement();
    if (statement.kind === 'localDeclaration') deny('INVALID_SYNTAX', 'local declaration requires an owning block', statement.origin);
    return statement;
  }
  expressionList(end) {
    const expressions = [];
    if (this.word() !== end) do { expressions.push(this.expression()); } while (this.take(','));
    return expressions;
  }
  localClause() {
    const first = this.peek(), mark = this.mark(); let type, name;
    const constant = Boolean(this.take('const'));
    try { type = this.typeRef(); name = this.name(); }
    catch (error) {
      if (!isSourceDenialCode(error, 'INVALID_SYNTAX') && !isSourceDenialCode(error, 'UNSUPPORTED_FORM')) throw error;
      this.restore(mark); return null;
    }
    if (!['=', ',', ';', ')', 'in'].includes(this.word())) { this.restore(mark); return null; }
    const declarations = [];
    do {
      const initializer = this.take('=') ? this.expression() : null;
      declarations.push(this.declaration('local', { origin: name.origin }, { type, name, constant, initializer }));
      if (!this.take(',')) break;
      name = this.name();
    } while (true);
    return this.node('localDeclaration', first, { declarations });
  }
  controlBody(kind) {
    this.controlStack.push(kind);
    try { return this.embeddedStatement(); } finally { this.controlStack.pop(); }
  }
  statement() {
    const first = this.peek(), word = first.spelling;
    if (word === '{') return this.block();
    if (this.take(';')) return this.node('empty', first);
    if (this.take('if')) {
      this.need('('); const test = this.expression(); this.need(')');
      const body = this.embeddedStatement(), alternative = this.take('else') ? this.embeddedStatement() : null;
      return this.node('if', first, { test, body, alternative });
    }
    if (this.take('while')) {
      this.need('('); const test = this.expression(); this.need(')');
      return this.node('while', first, { test, body: this.controlBody('loop') });
    }
    if (this.take('do')) {
      const body = this.controlBody('loop'); this.need('while'); this.need('(');
      const test = this.expression(); this.need(')'); this.need(';'); return this.node('do', first, { test, body });
    }
    if (this.take('for')) {
      this.need('('); const initializer = this.word() === ';' ? [] : this.localClause() ?? this.expressionList(';');
      this.need(';'); const test = this.word() === ';' ? null : this.expression(); this.need(';');
      const update = this.expressionList(')'); this.need(')');
      return this.node('for', first, { initializer, test, update, body: this.controlBody('loop') });
    }
    if (this.take('foreach')) {
      this.need('('); const type = this.typeRef(), name = this.name();
      const variable = this.declaration('iterationVariable', { origin: name.origin }, { type, name }); this.need('in');
      const sequence = this.expression(); this.need(')'); const body = this.controlBody('loop');
      return this.node('foreach', first, { variable, sequence, body });
    }
    if (this.take('switch')) {
      this.need('('); const value = this.expression(); this.need(')'); this.need('{');
      const sections = []; this.controlStack.push('switch');
      try {
        while (this.word() !== '}') {
          const start = this.peek(), labels = [], statements = [];
          while (['case', 'default'].includes(this.word())) {
            const label = this.consume(), expression = label.spelling === 'case' ? this.expression() : null;
            this.need(':'); labels.push(this.node('switchLabel', label, { expression }));
          }
          if (!labels.length) deny('INVALID_SYNTAX', 'switch section requires a label', start.origin);
          while (!['case', 'default', '}'].includes(this.word())) statements.push(this.statement());
          sections.push(this.node('switchSection', start, { labels, statements }));
        }
        this.need('}'); return this.node('switch', first, { value, sections });
      } finally { this.controlStack.pop(); }
    }
    if (this.take('try')) {
      const body = this.block(), catches = [];
      while (this.take('catch')) {
        const start = this.last; let type = null, parameter = null;
        if (this.take('(')) {
          type = this.typeRef();
          if (this.word() !== ')') { const name = this.name(); parameter = this.declaration('catchParameter', { origin: name.origin }, { type, name }); }
          this.need(')');
        }
        this.catchDepth++; let handler;
        try { handler = this.block(); } finally { this.catchDepth--; }
        catches.push(this.node('catch', start, { type, parameter, body: handler }));
      }
      let finalizer = null;
      if (this.take('finally')) {
        this.controlStack.push('finally');
        try { finalizer = this.block(); } finally { this.controlStack.pop(); }
      }
      if (!catches.length && !finalizer) deny('INVALID_SYNTAX', 'try requires catch or finally', first.origin);
      return this.node('try', first, { body, catches, finalizer });
    }
    if (this.take('using')) {
      this.need('('); const resource = this.localClause() ?? this.expression(); this.need(')');
      return this.node('using', first, { resource, body: this.embeddedStatement() });
    }
    if (['checked', 'unchecked'].includes(word)) {
      this.consume(); return this.node('arithmeticBlock', first, { checked: word === 'checked', body: this.block() });
    }
    if (['return', 'throw', 'break', 'continue'].includes(word)) {
      this.consume(); const value = ['return', 'throw'].includes(word) && this.word() !== ';' ? this.expression() : null;
      this.need(';');
      if (word === 'throw' && !value && this.catchDepth === 0) deny('INVALID_SYNTAX', 'rethrow requires the actual enclosing catch', first.origin);
      if (['return', 'break', 'continue'].includes(word)) {
        let crossedFinally = false, foundTarget = false;
        for (let index = this.controlStack.length - 1; index >= 0; index--) {
          this.counter.charge('maxInvariantSteps', 'original-abrupt-control-target');
          const target = this.controlStack[index];
          if (target === 'finally') crossedFinally = true;
          if (word === 'return' && crossedFinally)
            deny('INVALID_BINDING', 'return cannot leave the original finally block', first.origin);
          if (word !== 'return' && (target === 'loop' || word === 'break' && target === 'switch')) {
            if (crossedFinally) deny('INVALID_BINDING', `${word} cannot leave the original finally block`, first.origin);
            foundTarget = true;
            break;
          }
        }
        if (word !== 'return' && !foundTarget)
          deny('INVALID_SYNTAX', `${word} has no actual control target`, first.origin);
      }
      return this.node(word, first, { value });
    }
    const declaration = this.localClause();
    if (declaration) { this.need(';'); return declaration; }
    const expression = this.expression(); this.need(';'); return this.node('expressionStatement', first, { expression });
  }
  csharpDeclaration(owner = null) {
    const first = this.peek(), attributes = this.attributes(), flags = [];
    while (modifiers.has(this.word())) flags.push(this.consume().spelling);
    if (new Set(flags).size !== flags.length) deny('INVALID_SYNTAX', 'duplicate declaration modifier', first.origin);
    if (!owner && this.take('using')) {
      const name = this.name(), path = [name]; let alias = null;
      if (this.take('=')) { alias = name; path.length = 0; path.push(this.name()); }
      while (this.take('.')) path.push(this.name()); this.need(';');
      if (attributes.length || flags.length) deny('INVALID_SYNTAX', 'using directive has declaration modifiers', first.origin);
      return this.node('usingDirective', first, { alias, path });
    }
    if (!owner && this.take('namespace')) {
      const path = [this.name()]; while (this.take('.')) path.push(this.name());
      this.need('{'); const declarations = []; let memberSeen = false;
      while (this.word() !== '}') {
        const declaration = this.csharpDeclaration();
        if (declaration.kind === 'usingDirective' && memberSeen)
          deny('INVALID_SYNTAX', 'using directive follows a namespace member', declaration.origin);
        memberSeen ||= declaration.kind !== 'usingDirective'; declarations.push(declaration);
      }
      this.need('}'); this.take(';');
      return this.node('namespace', first, { path, declarations });
    }
    if (['class', 'struct', 'interface', 'enum'].includes(this.word())) {
      const category = this.consume().spelling, name = this.name(), typeParameters = this.genericParameters(), bases = [];
      this.typeNames.add(name.spelling); for (const parameter of typeParameters) this.typeNames.add(parameter.name.spelling);
      if (this.take(':')) do { bases.push(this.typeRef()); } while (this.take(','));
      const constraints = this.constraints(); this.need('{'); const members = [];
      this.typeStack.push(name.spelling);
      if (category === 'enum') {
        while (this.word() !== '}') {
          const start = this.peek(), entryAttributes = this.attributes(), entryName = this.name();
          const value = this.take('=') ? this.expression() : null;
          members.push(this.declaration('enumMember', start, { attributes: entryAttributes, name: entryName, value }));
          if (!this.take(',')) break;
        }
      } else while (this.word() !== '}') members.push(this.csharpDeclaration({ category, name }));
      this.need('}'); this.typeStack.pop(); this.take(';');
      return this.declaration('type', first, { category, name, attributes, modifiers: flags, typeParameters, bases, constraints, members });
    }
    if (this.take('delegate')) {
      const returnType = this.typeRef(), name = this.name(), typeParameters = this.genericParameters();
      const parameters = this.parameters(), constraints = this.constraints(); this.need(';');
      return this.declaration('delegate', first, { attributes, modifiers: flags, name, typeParameters, parameters, constraints, returnType });
    }
    if (!owner) deny('INVALID_SYNTAX', 'namespace cannot contain a storage or method declaration', first.origin);
    if (this.word() === this.typeStack.at(-1)) {
      const mark = this.mark(), name = this.name();
      if (this.word() === '(') {
        const parameters = this.parameters(); let initializer = null;
        if (this.take(':')) {
          const target = this.consume();
          if (!['base', 'this'].includes(target.spelling)) deny('INVALID_SYNTAX', 'constructor initializer target differs', target.origin);
          initializer = this.node('constructorInitializer', target, { target: target.spelling, arguments: this.arguments() });
        }
        const body = this.block();
        return this.declaration('constructor', first, { name, attributes, modifiers: flags, parameters, initializer, body });
      }
      this.restore(mark);
    }
    const type = this.typeRef(), name = this.name(), typeParameters = this.genericParameters();
    for (const parameter of typeParameters) this.typeNames.add(parameter.name.spelling);
    if (this.word() === '(') {
      const parameters = this.parameters(), constraints = this.constraints();
      const body = this.take(';') ? null : this.block();
      return this.declaration('method', first, { name, attributes, modifiers: flags, returnType: type, typeParameters, parameters, constraints, body });
    }
    if (this.take('{')) {
      const accessors = [];
      while (this.word() !== '}') {
        const start = this.peek(), accessorAttributes = this.attributes(), accessorModifiers = [];
        while (modifiers.has(this.word())) accessorModifiers.push(this.consume().spelling);
        const operation = this.consume();
        if (!['get', 'set'].includes(operation.spelling)) deny('INVALID_SYNTAX', 'selected property accessor required', operation.origin);
        const body = this.take(';') ? null : this.block();
        accessors.push(this.declaration('accessor', start, { operation: operation.spelling, attributes: accessorAttributes, modifiers: accessorModifiers, body }));
      }
      this.need('}'); const initializer = this.take('=') ? this.expression() : null;
      if (initializer) this.need(';');
      return this.declaration('property', first, { name, attributes, modifiers: flags, type, accessors, initializer });
    }
    const fields = [];
    let fieldName = name;
    do {
      const initializer = this.take('=') ? this.expression() : null;
      fields.push(this.declaration('field', { origin: fieldName.origin }, { name: fieldName, type, modifiers: flags, attributes, initializer }));
      if (!this.take(',')) break;
      fieldName = this.name();
    } while (true);
    this.need(';'); return this.node('fieldGroup', first, { fields });
  }
  csharpUnit() {
    const first = this.peek(), declarations = []; let memberSeen = false;
    while (this.peek().kind !== 'eof') {
      const declaration = this.csharpDeclaration();
      if (declaration.kind === 'usingDirective' && memberSeen) deny('INVALID_SYNTAX', 'using directive follows a namespace member', declaration.origin);
      memberSeen ||= declaration.kind !== 'usingDirective'; declarations.push(declaration);
    }
    const eof = this.consume();
    if (eof.origin.byte[1] !== this.scanner.decoded.raw.length) deny('INCOMPLETE_INPUT', 'selected source EOF differs', eof.origin);
    return this.node('unit', first, { declarations });
  }
}

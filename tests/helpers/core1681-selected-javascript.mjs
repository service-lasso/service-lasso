import { deny, isSourceDenialCode } from './core1681-source-input.mjs';
import { SelectedSyntax } from './core1681-selected-syntax.mjs';

const reserved = new Set(('await break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with implements interface let package private protected public static yield').split(' '));
const levels = new Map([['=', 1], ['+=', 1], ['-=', 1], ['*=', 1], ['/=', 1], ['%=', 1], ['**=', 1],
  ['<<=', 1], ['>>=', 1], ['>>>=', 1], ['&=', 1], ['|=', 1], ['^=', 1], ['&&=', 1], ['||=', 1], ['??=', 1],
  ['??', 3], ['||', 3], ['&&', 4], ['|', 5], ['^', 6], ['&', 7], ['==', 8], ['!=', 8], ['===', 8], ['!==', 8],
  ['<', 9], ['>', 9], ['<=', 9], ['>=', 9], ['in', 9], ['instanceof', 9], ['<<', 10], ['>>', 10], ['>>>', 10],
  ['+', 11], ['-', 11], ['*', 12], ['/', 12], ['%', 12], ['**', 13]]);

export class SelectedJavaScriptSyntax extends SelectedSyntax {
  constructor(rawBytes, counter, decoderOccurrence) {
    super(rawBytes, 'javascript', counter, undefined, decoderOccurrence); this.functionStack = []; this.allowIn = true;
  }
  jsName(property = false) {
    const token = this.consume();
    if (token.kind !== 'identifier' || !property && (reserved.has(token.spelling) || ['eval', 'arguments'].includes(token.spelling)))
      deny('INVALID_SYNTAX', 'strict selected JavaScript identifier required', token.origin);
    return { spelling: token.spelling, origin: token.origin };
  }
  lineBefore() {
    return this.last && /[\r\n\u2028\u2029]/u.test(this.scanner.text.slice(this.last.origin.utf16[1], this.peek().origin.utf16[0]));
  }
  semicolon() {
    if (this.take(';')) return;
    if (this.word() === '}' || this.peek().kind === 'eof' || this.lineBefore()) return;
    deny('INVALID_SYNTAX', 'JavaScript statement separator required', this.peek().origin);
  }
  jsPattern(defaults = true) {
    const first = this.peek(); let pattern;
    if (this.take('[')) {
      const elements = []; let restSeen = false;
      while (this.word() !== ']') {
        if (this.take(',')) { if (restSeen) deny('INVALID_SYNTAX', 'rest pattern must be last', first.origin); elements.push(null); continue; }
        const rest = Boolean(this.take('...'));
        const element = this.jsPattern(!rest); elements.push({ rest, element }); restSeen ||= rest;
        if (!this.take(',')) break;
        if (restSeen) deny('INVALID_SYNTAX', 'rest pattern cannot have trailing comma', first.origin);
      }
      this.need(']'); pattern = this.node('jsArrayPattern', first, { elements });
    } else if (this.take('{')) {
      const properties = [];
      while (this.word() !== '}') {
        const start = this.peek(), rest = Boolean(this.take('...'));
        if (rest) {
          const binding = this.declaration('jsBinding', this.peek(), { name: this.jsName() });
          properties.push(this.node('jsRestPattern', start, { binding }));
          if (this.word() !== '}') deny('INVALID_SYNTAX', 'object rest binding must be last', start.origin);
          break;
        }
        const key = this.jsPropertyKey(); let value;
        if (this.take(':')) value = this.jsPattern();
        else {
          if (key.kind !== 'jsPropertyName' || reserved.has(key.name.spelling) || ['eval', 'arguments'].includes(key.name.spelling)) deny('INVALID_SYNTAX', 'shorthand binding required', key.origin);
          const binding = this.declaration('jsBinding', { origin: key.name.origin }, { name: key.name });
          value = this.take('=') ? this.node('jsDefaultPattern', start, { binding, initializer: this.jsExpression(1) }) : binding;
        }
        properties.push(this.node('jsPropertyPattern', start, { key, value }));
        if (!this.take(',')) break;
      }
      this.need('}'); pattern = this.node('jsObjectPattern', first, { properties });
    } else pattern = this.declaration('jsBinding', first, { name: this.jsName() });
    if (defaults && this.take('=')) pattern = this.node('jsDefaultPattern', first, { binding: pattern, initializer: this.jsExpression(1) });
    return pattern;
  }
  jsPropertyKey() {
    const first = this.peek();
    if (this.take('[')) { const expression = this.jsExpression(); this.need(']'); return this.node('jsComputedProperty', first, { expression }); }
    if (['number', 'string'].includes(first.kind)) { this.consume(); return this.node('literal', first, { token: first }); }
    return this.node('jsPropertyName', first, { name: this.jsName(true) });
  }
  jsParameters() {
    this.need('('); const parameters = []; let restSeen = false;
    if (this.word() !== ')') do {
      const first = this.peek(), rest = Boolean(this.take('...')), pattern = this.jsPattern(!rest);
      parameters.push(this.node('jsParameter', first, { pattern, rest })); restSeen ||= rest;
      if (restSeen && this.word() !== ')') deny('INVALID_SYNTAX', 'rest formal must be last', first.origin);
    } while (this.take(',') && this.word() !== ')');
    this.need(')'); return parameters;
  }
  jsFunctionBody(async, arrow = false) {
    const controls = this.controlStack; this.controlStack = []; this.functionStack.push({ async, arrow });
    try { return this.word() === '{' ? this.jsBlock() : arrow ? this.jsExpression(1) : (this.need('{'), null); }
    finally { this.functionStack.pop(); this.controlStack = controls; }
  }
  jsFunction(first, async, declaration = false) {
    this.need('function');
    if (this.word() === '*') deny('UNSUPPORTED_FORM', 'generator is outside CE-JS-2', this.peek().origin);
    const name = this.word() === '(' ? null : this.jsName();
    if (declaration && !name) deny('INVALID_SYNTAX', 'function declaration name required', first.origin);
    const parameters = this.jsParameters(), body = this.jsFunctionBody(async);
    return this.declaration(declaration ? 'jsFunction' : 'jsFunctionExpression', first, { name, async, parameters, body });
  }
  jsArguments() {
    this.need('('); const arguments_ = [];
    if (this.word() !== ')') do {
      const first = this.peek(), spread = Boolean(this.take('...')), expression = this.jsExpression(1);
      arguments_.push(this.node('jsArgument', first, { spread, expression }));
    } while (this.take(',') && this.word() !== ')');
    this.need(')'); return arguments_;
  }
  jsTemplate(first) {
    const parts = [];
    while (true) {
      if (this.current) deny('INVALID_SYNTAX', 'template lexical goal has a primed token', first.origin);
      const part = this.scanner.templatePart(); this.last = part;
      parts.push(this.node('jsTemplateText', part, { token: part }));
      if (part.kind === 'templateTail') break;
      parts.push(this.jsExpression(0)); this.need('}');
    }
    return this.node('jsTemplate', first, { parts });
  }
  jsPrimary(allowArrow = true) {
    const first = this.peek('regexp'), word = first.spelling;
    if (['number', 'string', 'regexp'].includes(first.kind) || ['true', 'false', 'null'].includes(word)) {
      this.consume(); return this.node('literal', first, { token: first });
    }
    if (first.kind === 'templateStart') { this.consume(); return this.jsTemplate(first); }
    if (this.take('this')) return this.node('receiver', first, { category: 'this' });
    if (word === 'function') return this.jsFunction(first, false);
    if (word === 'async') {
      const mark = this.mark(); this.consume();
      if (!this.lineBefore() && this.word() === 'function') return this.jsFunction(first, true);
      if (!this.lineBefore()) {
        try {
          const parameters = this.word() === '(' ? this.jsParameters() : [this.node('jsParameter', this.peek(), { pattern: this.jsPattern(false), rest: false })];
          if (!this.lineBefore() && this.take('=>')) {
            if (!allowArrow) deny('INVALID_SYNTAX', 'ungrouped arrow requires assignment-expression context', first.origin);
            return this.declaration('jsArrow', first, { async: true, parameters, body: this.jsFunctionBody(true, true) });
          }
        } catch (error) { if (!isSourceDenialCode(error, 'INVALID_SYNTAX') && !isSourceDenialCode(error, 'UNSUPPORTED_FORM')) throw error; }
      }
      this.restore(mark);
    }
    if (this.take('(')) {
      const mark = this.mark();
      try {
        this.restore({ ...mark, current: first, at: first.origin.utf16[1], last: null });
        const parameters = this.jsParameters();
        if (!this.lineBefore() && this.take('=>')) {
          if (!allowArrow) deny('INVALID_SYNTAX', 'ungrouped arrow requires assignment-expression context', first.origin);
          return this.declaration('jsArrow', first, { async: false, parameters, body: this.jsFunctionBody(false, true) });
        }
      } catch (error) { if (!isSourceDenialCode(error, 'INVALID_SYNTAX') && !isSourceDenialCode(error, 'UNSUPPORTED_FORM')) throw error; }
      this.restore(mark); const expression = this.jsExpression(0); this.need(')');
      return this.node('group', first, { expression });
    }
    if (this.take('[')) {
      const elements = [];
      while (this.word() !== ']') {
        if (this.take(',')) { elements.push(null); continue; }
        const start = this.peek(), spread = Boolean(this.take('...'));
        elements.push(this.node('jsArrayElement', start, { spread, expression: this.jsExpression(1) }));
        if (!this.take(',')) break;
      }
      this.need(']'); return this.node('jsArray', first, { elements });
    }
    if (this.take('{')) {
      const properties = [];
      while (this.word() !== '}') {
        const start = this.peek();
        if (this.take('...')) properties.push(this.node('jsObjectSpread', start, { expression: this.jsExpression(1) }));
        else {
          let async = false, accessor = null;
          if (['async', 'get', 'set'].includes(this.word())) {
            const mark = this.mark(), modifier = this.consume();
            if ((modifier.spelling !== 'async' || !this.lineBefore()) && ![':', ',', '}', '('].includes(this.word())) {
              if (modifier.spelling === 'async') async = true;
              else accessor = modifier.spelling;
            } else this.restore(mark);
          }
          const key = this.jsPropertyKey(); let value, method = false;
          if (this.take(':')) value = this.jsExpression(1);
          else if (this.word() === '(') {
            const parameters = this.jsParameters();
            if (accessor === 'get' && parameters.length !== 0 || accessor === 'set' && (parameters.length !== 1 || parameters[0].rest || parameters[0].pattern.kind === 'jsDefaultPattern'))
              deny('INVALID_SYNTAX', 'object accessor formal count differs', start.origin);
            value = this.declaration('jsMethod', start, { key, parameters, async, accessor, body: this.jsFunctionBody(async) }); method = true;
          }
          else { if (async || accessor || key.kind !== 'jsPropertyName' || reserved.has(key.name.spelling)) deny('INVALID_SYNTAX', 'object shorthand name required', key.origin); value = this.node('name', { origin: key.name.origin }, { name: key.name }); }
          if ((async || accessor) && !method) deny('INVALID_SYNTAX', 'object method modifier requires method body', start.origin);
          properties.push(this.node('jsObjectProperty', start, { key, value, method }));
        }
        if (!this.take(',')) break;
      }
      this.need('}'); return this.node('jsObject', first, { properties });
    }
    if (this.take('import')) {
      if (this.take('.')) { const name = this.jsName(true); if (name.spelling !== 'meta') deny('INVALID_SYNTAX', 'import.meta required', name.origin); return this.node('jsImportMeta', first); }
      if (this.word() === '(') return this.node('jsDynamicImport', first, { arguments: this.jsArguments() });
      deny('INVALID_SYNTAX', 'import expression requires meta or call', first.origin);
    }
    if (first.kind === 'identifier') {
      const name = this.jsName();
      if (!this.lineBefore() && this.take('=>')) {
        if (!allowArrow) deny('INVALID_SYNTAX', 'ungrouped arrow requires assignment-expression context', first.origin);
        const pattern = this.declaration('jsBinding', first, { name });
        return this.declaration('jsArrow', first, { async: false, parameters: [this.node('jsParameter', first, { pattern, rest: false })], body: this.jsFunctionBody(false, true) });
      }
      return this.node('name', first, { name });
    }
    deny('UNSUPPORTED_FORM', 'unbound CE-JS-2 primary', first.origin);
  }
  jsPostfix(left, first, calls = true) {
    while (true) {
      let optional = false;
      if (this.take('?.')) optional = true;
      if (optional && !calls) deny('INVALID_SYNTAX', 'new constructor target cannot be an optional chain', this.last.origin);
      if (optional && this.word() === '(' || calls && this.word() === '(') {
        left = this.node('jsCall', first, { target: left, optional, arguments: this.jsArguments() }); continue;
      }
      if (this.take('[')) { const index = this.jsExpression(0); this.need(']'); left = this.node('jsIndex', first, { target: left, optional, index }); continue; }
      if (optional || this.take('.')) { left = this.node('jsMember', first, { target: left, optional, name: this.jsName(true) }); continue; }
      if (this.peek().kind === 'templateStart') deny('UNSUPPORTED_FORM', 'tagged template is outside selected expression production', this.peek().origin);
      if (calls && !this.lineBefore() && ['++', '--'].includes(this.word())) { left = this.node('postfix', first, { operation: this.consume().spelling, operand: left }); continue; }
      return left;
    }
  }
  jsExpression(minimum = 1) {
    const first = this.peek('regexp'); let left;
    if (['+', '-', '!', '~', 'typeof', 'void', 'delete', '++', '--', 'await'].includes(first.spelling)) {
      const operation = this.consume().spelling;
      if (operation === 'await' && this.functionStack.length && !this.functionStack.at(-1).async) deny('INVALID_SYNTAX', 'await in ordinary function', first.origin);
      left = this.node('unary', first, { operation, operand: this.jsExpression(14) });
    } else if (this.take('new')) {
      const calleeFirst = this.peek(), target = this.jsPostfix(this.jsPrimary(false), calleeFirst, false);
      const arguments_ = this.word() === '(' ? this.jsArguments() : [];
      left = this.node('jsNew', first, { target, arguments: arguments_ });
    } else left = this.jsPrimary(minimum <= 1);
    if (left.kind === 'jsArrow') return left;
    left = this.jsPostfix(left, first);
    while (true) {
      if (minimum <= 2 && this.take('?')) {
        const whenTrue = this.jsExpression(1); this.need(':'); const whenFalse = this.jsExpression(1);
        left = this.node('conditional', first, { test: left, whenTrue, whenFalse }); continue;
      }
      if (minimum === 0 && this.take(',')) { left = this.node('jsSequence', first, { left, right: this.jsExpression(1) }); continue; }
      const operation = this.word(), level = levels.get(operation);
      if (level === undefined || level < minimum || operation === 'in' && !this.allowIn) break;
      if (operation === '**' && left.kind === 'unary') deny('INVALID_SYNTAX', 'exponentiation requires grouped unary left operand', first.origin);
      this.consume(); const right = this.jsExpression(level === 1 || operation === '**' ? level : level + 1);
      if ((operation === '??' && [left, right].some(node => node.kind === 'binary' && ['&&', '||'].includes(node.operation))) ||
          (['&&', '||'].includes(operation) && [left, right].some(node => node.kind === 'binary' && node.operation === '??')))
        deny('INVALID_SYNTAX', 'nullish and logical operators require explicit grouping', first.origin);
      left = this.node(level === 1 ? 'assignment' : 'binary', first, { operation, left, right });
    }
    return left;
  }
  jsBlock() {
    const first = this.need('{'), statements = [];
    while (this.word() !== '}') { if (this.peek().kind === 'eof') deny('INVALID_SYNTAX', 'unterminated JavaScript block', first.origin); statements.push(this.jsStatement()); }
    this.need('}'); return this.node('block', first, { statements });
  }
  jsVariables(terminate = true) {
    const first = this.consume(), declarations = [];
    do {
      const start = this.peek(), pattern = this.jsPattern(false), initializer = this.take('=') ? this.jsExpression(1) : null;
      declarations.push(this.node('jsVariableDeclarator', start, { pattern, initializer }));
    } while (this.take(','));
    if (terminate && first.spelling === 'const' && declarations.some(declaration => declaration.initializer === null))
      deny('INVALID_SYNTAX', 'const declaration requires initializer', first.origin);
    if (terminate) this.semicolon();
    return this.node('jsVariableDeclaration', first, { category: first.spelling, declarations });
  }
  jsControl(kind, operation) {
    this.controlStack.push(kind); try { return operation(); } finally { this.controlStack.pop(); }
  }
  jsStatement() {
    const first = this.peek(), word = first.spelling;
    if (word === '{') return this.jsBlock();
    if (this.take(';')) return this.node('empty', first);
    if (['const', 'let'].includes(word)) return this.jsVariables();
    if (word === 'function') return this.jsFunction(first, false, true);
    if (word === 'async') {
      const mark = this.mark(); this.consume();
      if (!this.lineBefore() && this.word() === 'function') return this.jsFunction(first, true, true);
      this.restore(mark);
    }
    if (this.take('if')) {
      this.need('('); const test = this.jsExpression(0); this.need(')'); const body = this.jsStatement(), alternative = this.take('else') ? this.jsStatement() : null;
      return this.node('if', first, { test, body, alternative });
    }
    if (this.take('while')) { this.need('('); const test = this.jsExpression(0); this.need(')'); return this.node('while', first, { test, body: this.jsControl('loop', () => this.jsStatement()) }); }
    if (this.take('for')) {
      const async = Boolean(this.take('await')); this.need('('); const oldAllowIn = this.allowIn; this.allowIn = false;
      let initializer;
      try { initializer = this.word() === ';' ? null : ['const', 'let'].includes(this.word()) ? this.jsVariables(false) : this.jsExpression(0); }
      finally { this.allowIn = oldAllowIn; }
      if (['of', 'in'].includes(this.word())) {
        if (initializer?.kind === 'jsVariableDeclaration' && (initializer.declarations.length !== 1 || initializer.declarations[0].initializer !== null))
          deny('INVALID_SYNTAX', 'for-in/of lexical head requires one uninitialized binding', first.origin);
        const operation = this.consume().spelling, sequence = this.jsExpression(0); this.need(')');
        if (async && operation !== 'of') deny('INVALID_SYNTAX', 'for await requires of', first.origin);
        return this.node('jsForEach', first, { async, operation, initializer, sequence, body: this.jsControl('loop', () => this.jsStatement()) });
      }
      if (async) deny('INVALID_SYNTAX', 'for await requires of', first.origin);
      if (initializer?.kind === 'jsVariableDeclaration' && initializer.category === 'const' && initializer.declarations.some(declaration => declaration.initializer === null))
        deny('INVALID_SYNTAX', 'const declaration requires initializer', first.origin);
      this.need(';'); const test = this.word() === ';' ? null : this.jsExpression(0); this.need(';');
      const increment = this.word() === ')' ? null : this.jsExpression(0); this.need(')');
      return this.node('for', first, { initializer, test, increment, body: this.jsControl('loop', () => this.jsStatement()) });
    }
    if (this.take('try')) {
      const body = this.jsBlock(); let handler = null;
      if (this.take('catch')) { const start = this.last, parameter = this.take('(') ? (() => { const pattern = this.jsPattern(false); this.need(')'); return pattern; })() : null; handler = this.node('jsCatch', start, { parameter, body: this.jsBlock() }); }
      const finalizer = this.take('finally') ? this.jsBlock() : null;
      if (!handler && !finalizer) deny('INVALID_SYNTAX', 'try requires catch or finally', first.origin);
      return this.node('try', first, { body, handler, finalizer });
    }
    if (['return', 'throw', 'break', 'continue'].includes(word)) {
      this.consume(); const newline = this.lineBefore();
      if (word === 'throw' && newline) deny('INVALID_SYNTAX', 'throw cannot cross line terminator', first.origin);
      if (word === 'return' && !this.functionStack.length) deny('INVALID_SYNTAX', 'module return is forbidden', first.origin);
      if (['break', 'continue'].includes(word) && !this.controlStack.includes('loop')) deny('INVALID_SYNTAX', 'loop completion lacks actual target', first.origin);
      const value = ['return', 'throw'].includes(word) && !newline && ![';', '}'].includes(this.word()) && this.peek().kind !== 'eof' ? this.jsExpression(0) : null;
      if (word === 'throw' && !value) deny('INVALID_SYNTAX', 'throw expression required', first.origin);
      this.semicolon(); return this.node(word, first, { value });
    }
    if (['class', 'var', 'with', 'switch', 'do', 'debugger'].includes(word)) deny('UNSUPPORTED_FORM', 'statement outside CE-JS-2', first.origin);
    const expression = this.jsExpression(0); this.semicolon(); return this.node('expressionStatement', first, { expression });
  }
  jsModuleString() {
    const token = this.consume();
    if (token.kind !== 'string') deny('INVALID_SYNTAX', 'literal module specifier required', token.origin);
    return this.node('jsModuleSpecifier', token, { token });
  }
  jsImport() {
    const first = this.need('import'), specifiers = [];
    if (this.peek().kind === 'string') {
      const source = this.jsModuleString(); this.semicolon(); return this.node('jsImport', first, { source, specifiers });
    }
    if (this.word() !== '*' && this.word() !== '{') {
      const start = this.peek(), local = this.jsName();
      specifiers.push(this.declaration('jsImportBinding', start, { category: 'default', local, imported: null }));
      if (!this.take(',')) { this.need('from'); const source = this.jsModuleString(); this.semicolon(); return this.node('jsImport', first, { source, specifiers }); }
    }
    if (this.take('*')) {
      const start = this.last; this.need('as'); const local = this.jsName();
      specifiers.push(this.declaration('jsImportBinding', start, { category: 'namespace', local, imported: null }));
    } else {
      this.need('{');
      while (this.word() !== '}') {
        const start = this.peek(), imported = this.jsName(true), local = this.take('as') ? this.jsName() : imported;
        if (reserved.has(local.spelling) || ['eval', 'arguments'].includes(local.spelling)) deny('INVALID_SYNTAX', 'invalid local import name', local.origin);
        specifiers.push(this.declaration('jsImportBinding', start, { category: 'named', local, imported }));
        if (!this.take(',')) break;
      }
      this.need('}');
    }
    this.need('from'); const source = this.jsModuleString(); this.semicolon();
    return this.node('jsImport', first, { source, specifiers });
  }
  jsExport() {
    const first = this.need('export');
    if (this.take('default')) {
      let value;
      if (this.word() === 'function') value = this.jsFunction(this.peek(), false);
      else {
        const mark = this.mark(), start = this.peek();
        if (this.take('async') && !this.lineBefore() && this.word() === 'function') value = this.jsFunction(start, true);
        else { this.restore(mark); value = this.jsExpression(1); this.semicolon(); }
      }
      return this.declaration('jsDefaultExport', first, { value });
    }
    if (this.take('*')) {
      const alias = this.take('as') ? this.jsName(true) : null; this.need('from'); const source = this.jsModuleString(); this.semicolon();
      return this.node('jsExportAll', first, { alias, source });
    }
    if (this.take('{')) {
      const specifiers = [];
      while (this.word() !== '}') {
        const start = this.peek(), local = this.jsName(true), exported = this.take('as') ? this.jsName(true) : local;
        specifiers.push(this.declaration('jsExportBinding', start, { local, exported }));
        if (!this.take(',')) break;
      }
      this.need('}'); const source = this.take('from') ? this.jsModuleString() : null; this.semicolon();
      return this.node('jsExport', first, { specifiers, source, declaration: null });
    }
    if (!['const', 'let', 'function', 'async'].includes(this.word())) deny('INVALID_SYNTAX', 'selected exported declaration required', this.peek().origin);
    const declaration = this.jsStatement();
    if (!['jsVariableDeclaration', 'jsFunction'].includes(declaration.kind)) deny('INVALID_SYNTAX', 'export requires a declaration', declaration.origin);
    return this.node('jsExport', first, { specifiers: [], source: null, declaration });
  }
  javascriptUnit() {
    const first = this.peek(), statements = [];
    while (this.peek().kind !== 'eof') {
      if (this.word() === 'export') statements.push(this.jsExport());
      else if (this.word() === 'import') {
        const mark = this.mark(); this.consume(); const expression = ['(', '.'].includes(this.word()); this.restore(mark);
        statements.push(expression ? this.jsStatement() : this.jsImport());
      } else statements.push(this.jsStatement());
    }
    const eof = this.consume();
    if (eof.origin.byte[1] !== this.scanner.decoded.raw.length) deny('INCOMPLETE_INPUT', 'JavaScript EOF differs', eof.origin);
    return this.node('unit', first, { statements });
  }
}

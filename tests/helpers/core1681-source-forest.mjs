import { decodeOriginal, lexOriginal, deny } from './core1681-source-input.mjs';

const modifiers = new Set(['public', 'private', 'internal', 'protected', 'static', 'readonly',
  'const', 'sealed', 'abstract', 'virtual', 'override', 'extern', 'new', 'partial', 'unsafe']);
const precedence = new Map([['=', 1], ['+=', 1], ['-=', 1], ['??', 2], ['||', 3], ['&&', 4],
  ['|', 5], ['^', 6], ['&', 7], ['==', 8], ['!=', 8], ['===', 8], ['!==', 8],
  ['<', 9], ['>', 9], ['<=', 9], ['>=', 9], ['in', 9], ['<<', 10], ['>>', 10],
  ['+', 11], ['-', 11], ['*', 12], ['/', 12], ['%', 12]]);
const dynamicType = () => ({ kind: 'dynamic', profile: 'CE-JS-2', sort: 'Any' });
const reserved = new Set(['return', 'throw', 'new', 'if', 'else', 'while', 'for', 'foreach', 'switch',
  'case', 'break', 'continue', 'try', 'catch', 'finally', 'class', 'struct', 'enum', 'interface',
  'namespace', 'using', 'function', 'const', 'let', 'var', 'import', 'export', 'default', 'true',
  'false', 'null', 'await', 'yield', 'static', 'public', 'private', 'protected']);
const csReserved = new Set(['void', 'bool', 'int', 'string', 'object', 'uint', 'long', 'ulong',
  'short', 'ushort', 'byte', 'sbyte', 'char', 'float', 'double', 'decimal', 'ref', 'out', 'in', 'params']);
// The supported JS Unit uses strict/module identifier rules, including await and
// strict future-reserved words. Contextual async/of/as/from/get/set remain names.
const jsReserved = new Set(['await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
  'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with',
  'implements', 'interface', 'let', 'package', 'private', 'protected', 'public', 'static', 'yield']);
const ownedParseInputs = new WeakMap();

// Recursive descent over a deliberately closed subgrammar, NOT an anchor scan.
// Every accepted expression and statement has a tree and original location.
// Constructs outside this implemented subgrammar deny the entire unit.
class Parser {
  constructor(decoded, language) {
    this.decoded = decoded; this.language = language;
    this.lexed = lexOriginal(decoded, language); this.tokens = this.lexed.tokens; this.at = 0;
    this.root = { kind: 'unit', children: [], namespace: [], owner: null, references: [], scopes: [] };
    this.scope = this.root; this.structural = this.root; this.types = []; this.scopeOrdinal = 0;
  }
  current() { return this.tokens[this.at]; }
  value() { return this.current().value; }
  take(value) { if (this.value() === value) { return this.tokens[this.at++]; } return null; }
  need(value) { const token = this.take(value); if (!token) deny('INVALID_SYNTAX', `expected ${value}, found ${this.value()}`, this.current().origin); return token; }
  identifier(token, binding = true, property = false) {
    const forbidden = this.language === 'javascript'
      ? !property && (jsReserved.has(token.value) || binding && ['eval', 'arguments'].includes(token.value))
      : reserved.has(token.value) || csReserved.has(token.value);
    if (token.kind !== 'identifier' || forbidden) deny('INVALID_SYNTAX', 'identifier forbidden in selected language/context', token.origin);
    return token;
  }
  id(typePosition = false, property = false) {
    const token = this.current();
    if (this.language === 'csharp' && typePosition) { if (token.kind !== 'identifier') deny('INVALID_SYNTAX', 'type identifier required', token.origin); }
    else this.identifier(token, !property, property);
    this.at++; return token;
  }
  span(start, end = this.tokens[this.at - 1]) { return this.decoded.origin(start.origin.utf16[0], end.origin.utf16[1]); }
  hasLineTerminator(left, right) {
    return /[\r\n\u2028\u2029]/.test(this.decoded.text.slice(left.origin.utf16[1], right.origin.utf16[0]));
  }
  hasFunctionContext() {
    for (let owner = this.scope; owner; owner = owner.owner) {
      if (['function', 'functionExpression', 'lambda'].includes(owner.kind)) return true;
    }
    return false;
  }
  node(kind, name, start, extra = {}) {
    const node = { kind, name, start, origin: null, children: [], synthetics: [], references: [], scopes: [],
      owner: this.scope, structural: this.structural, namespace: [...this.structural.namespace],
      type: this.language === 'javascript' ? dynamicType() : null, returnType: null,
      modifiers: [], attributes: [], parameters: [], typeParameters: [], constraints: [],
      bases: [], interfaces: [], receiver: 'none', static: false, direction: 'value',
      params: false, defaultValue: null, initializer: null, accessor: null, backing: null,
      captures: [], import: null, explicitInterface: null, ...extra };
    this.scope.children.push(node); return node;
  }
  inScope(node, action) {
    const prior = this.scope; this.scope = node;
    try { return action(); } finally { this.scope = prior; }
  }
  block() {
    const start = this.need('{'), owner = this.scope;
    const scope = { kind: 'block', owner, children: [], references: [], scopes: [],
      namespace: [...this.structural.namespace], ordinal: this.scopeOrdinal++ };
    owner.scopes.push(scope);
    const statements = this.inScope(scope, () => {
      const rows = [];
      while (this.value() !== '}') { if (this.current().kind === 'eof') deny('INCOMPLETE_INPUT', 'unclosed block', start.origin); rows.push(this.statement()); }
      return rows;
    });
    this.need('}'); scope.origin = this.span(start);
    // Preserve lexical interleaving using original positions during enumeration.
    owner.children.push(scope);
    return { kind: 'block', statements, scope, origin: scope.origin };
  }
  typeRef() {
    const first = this.id(true); const path = [first.value];
    while (this.take('.')) path.push(this.id().value);
    const args = [];
    if (this.take('<')) { do { args.push(this.typeRef()); } while (this.take(',')); this.need('>'); }
    let type = { kind: 'named', path, arguments: args };
    while (this.take('[')) { this.need(']'); type = { kind: 'array', element: type, rank: 1 }; }
    if (this.take('?')) type = { kind: 'nullable', element: type };
    return type;
  }
  genericParameters(node) {
    if (!this.take('<')) return;
    this.inScope(node, () => {
      do { const token = this.id(), param = this.node('typeParameter', token.value, token, { type: { kind: 'typeParameter', declaration: null } });
        param.origin = this.span(token); node.typeParameters.push(param); } while (this.take(','));
    });
    this.need('>');
  }
  formals(node) {
    this.need('(');
    this.inScope(node, () => {
      if (this.value() !== ')') do {
        const start = this.current(), attributes = this.attributes();
        let direction = 'value', variadic = false;
        if (this.language === 'csharp' && ['ref', 'out', 'in'].includes(this.value())) direction = this.tokens[this.at++].value;
        if (this.language === 'csharp' && this.take('params')) variadic = true;
        if (this.language === 'javascript' && this.take('...')) deny('UNSUPPORTED_SYNTAX', 'rest formal lowering', start.origin);
        const type = this.language === 'javascript' ? dynamicType() : this.typeRef();
        const name = this.id(), param = this.node('parameter', name.value, start, { type, attributes, direction, params: variadic });
        if (this.take('=')) {
          if (this.language === 'javascript') deny('UNSUPPORTED_SYNTAX', 'default formal initialization scope/lowering', name.origin);
          param.defaultValue = this.expression(2);
        }
        param.origin = this.span(start); node.parameters.push(param);
      } while (this.take(','));
    });
    this.need(')');
  }
  attributes() {
    const rows = [];
    if (this.language !== 'csharp') return rows;
    while (this.take('[')) {
      const start = this.tokens[this.at - 1];
      do { const type = this.typeRef(), args = [];
        if (this.take('(')) { if (this.value() !== ')') do { args.push(this.expression(2)); } while (this.take(',')); this.need(')'); }
        rows.push({ type, arguments: args, direction: 'declaration', origin: this.span(start) });
      } while (this.take(','));
      this.need(']');
    }
    return rows;
  }
  expression(minimum = 1) {
    const start = this.current(); let left;
    if (this.value() === 'await') deny('UNSUPPORTED_SYNTAX', 'async/module-await context typing', start.origin);
    if (['!', '~', '+', '-', 'typeof', 'void'].includes(this.value())) {
      const op = this.tokens[this.at++].value; left = { kind: 'unary', op, operand: this.expression(13) };
    } else if (this.take('new')) {
      if (this.language === 'javascript') {
        const name = this.id(); this.scope.references.push({ name: name.value, origin: name.origin, role: 'value' });
        let target = { kind: 'name', name: name.value, origin: name.origin };
        while (this.take('.')) target = { kind: 'member', target, member: this.id(false, true).value };
        const args = this.arguments(); left = { kind: 'new', target, arguments: args };
      } else {
        const type = this.typeRef(); left = { kind: 'new', type, arguments: this.arguments() };
      }
    } else if (this.language === 'javascript' && this.value() === 'function') {
      this.at++; const name = '<anonymous>';
      if (this.current().kind === 'identifier') deny('UNSUPPORTED_SYNTAX', 'named function expression local name scope', this.current().origin);
      const node = this.node('functionExpression', name, start, { returnType: dynamicType() }); this.formals(node);
      node.body = this.inScope(node, () => this.block()); node.origin = this.span(start);
      left = { kind: 'function', declaration: node };
    } else if (this.take('(')) {
      if (this.value() === ')') {
        this.at++; this.need('=>'); left = this.arrow(start, []);
      } else {
        const saved = this.at; const names = [];
        while (this.current().kind === 'identifier') {
          names.push(this.current()); this.at++;
          if (!this.take(',')) break;
        }
        if (this.take(')') && this.take('=>')) left = this.arrow(start, names);
        else { this.at = saved; left = { kind: 'group', expression: this.expression() }; this.need(')'); }
      }
    } else if (this.take('[')) {
      if (this.language !== 'javascript') deny('UNSUPPORTED_SYNTAX', 'array expression', start.origin);
      const items = []; if (this.value() !== ']') do { items.push(this.expression(2)); } while (this.take(','));
      this.need(']'); left = { kind: 'array', items };
    } else if (this.take('{')) {
      if (this.language !== 'javascript') deny('UNSUPPORTED_SYNTAX', 'object expression', start.origin);
      const properties = [];
      if (this.value() !== '}') do {
        const key = this.current(); if (!['identifier', 'string', 'number'].includes(key.kind)) deny('UNSUPPORTED_SYNTAX', 'object property/spread', key.origin);
        this.at++; let value;
        if (this.take(':')) value = this.expression(2);
        else { if (key.kind !== 'identifier') deny('INVALID_SYNTAX', 'shorthand property requires identifier', key.origin);
          this.identifier(key, false);
          value = { kind: 'name', name: key.value, origin: key.origin }; this.scope.references.push({ name: key.value, origin: key.origin, role: 'value' }); }
        properties.push({ key: key.value, value, origin: key.origin });
      } while (this.take(','));
      this.need('}'); left = { kind: 'object', properties };
    } else if (['string', 'number'].includes(start.kind) || ['true', 'false', 'null'].includes(start.value)) {
      this.at++; left = { kind: 'literal', spelling: start.value, literalKind: start.kind };
    } else if (start.kind === 'identifier' && !(this.language === 'javascript' ? jsReserved : reserved).has(start.value)) {
      this.identifier(start, false);
      this.at++;
      if (this.take('=>')) left = this.arrow(start, [start]);
      else { left = { kind: 'name', name: start.value }; this.scope.references.push({ name: start.value, origin: start.origin, role: 'value' }); }
    } else deny('UNSUPPORTED_SYNTAX', `expression ${this.value()}`, start.origin);
    left.origin = this.span(start);
    while (true) {
      if (this.take('.')) { left = { kind: 'member', target: left, member: this.id(false, this.language === 'javascript').value, origin: this.span(start) }; continue; }
      if (this.value() === '(') { left = { kind: 'call', target: left, arguments: this.arguments(), origin: this.span(start) }; continue; }
      if (this.take('[')) { const index = this.expression(); this.need(']'); left = { kind: 'index', target: left, index, origin: this.span(start) }; continue; }
      if (['++', '--'].includes(this.value())) { left = { kind: 'postfix', op: this.tokens[this.at++].value, operand: left, origin: this.span(start) }; continue; }
      if (this.value() === '?' && minimum <= 2) {
        this.at++; const whenTrue = this.expression(); this.need(':'); const whenFalse = this.expression(2);
        left = { kind: 'conditional', test: left, whenTrue, whenFalse, origin: this.span(start) }; continue;
      }
      const level = precedence.get(this.value()); if (level === undefined || level < minimum) break;
      const op = this.tokens[this.at++].value, right = this.expression(level === 1 ? level : level + 1);
      left = { kind: level === 1 ? 'assignment' : 'binary', op, left, right, origin: this.span(start) };
    }
    return left;
  }
  arrow(start, names) {
    // The original gap includes both whitespace and comment trivia. Check the
    // last formal token (identifier or closing parenthesis), never its spelling.
    if (this.language === 'javascript' && this.hasLineTerminator(this.tokens[this.at - 2], this.tokens[this.at - 1]))
      deny('INVALID_SYNTAX', 'line terminator before arrow', this.tokens[this.at - 1].origin);
    const node = this.node('lambda', '<lambda>', start, { returnType: this.language === 'javascript' ? dynamicType() : null });
    // C# contextual lambda parameter types require typed-expression inference,
    // deliberately denied rather than silently installing JS Any types.
    if (this.language !== 'javascript') deny('UNSUPPORTED_SYNTAX', 'C# contextual lambda typing', start.origin);
    this.inScope(node, () => { for (const token of names) { this.identifier(token); const param = this.node('parameter', token.value, token);
      param.origin = token.origin; node.parameters.push(param); } });
    node.body = this.inScope(node, () => this.value() === '{' ? this.block() : this.expression(2));
    node.origin = this.span(start); return { kind: 'lambda', declaration: node, origin: node.origin };
  }
  arguments() {
    this.need('('); const args = [];
    if (this.value() !== ')') do {
      let direction = 'value'; if (this.language === 'csharp' && ['ref', 'out', 'in'].includes(this.value())) direction = this.tokens[this.at++].value;
      args.push({ direction, expression: this.expression(2) });
    } while (this.take(','));
    this.need(')'); return args;
  }
  variable(kind, type, start, metadata = {}) {
    const declarations = [];
    do {
      const name = this.id(), node = this.node(kind, name.value, name, { type, ...metadata });
      if (this.take('=')) node.initializer = this.expression(2);
      if (metadata.modifiers?.includes('const') && !node.initializer) deny('INVALID_SYNTAX', 'const initializer required', name.origin);
      node.origin = this.span(name); declarations.push(node);
    } while (this.take(','));
    this.need(';'); return { kind: 'declarations', declarations, origin: this.span(start) };
  }
  statement() {
    const start = this.current(), word = this.value();
    if (word === '{') return this.block();
    if (this.take(';')) return { kind: 'empty', origin: start.origin };
    if (this.language === 'javascript' && ['const', 'let', 'var'].includes(word)) {
      if (word === 'var') deny('UNSUPPORTED_SYNTAX', 'JS var hoisting/duplicate semantics', start.origin);
      this.at++; return this.variable('local', dynamicType(), start, { modifiers: [word] });
    }
    if (this.language === 'javascript' && word === 'function') return this.jsFunction();
    if (['if', 'while'].includes(word)) {
      this.at++; this.need('('); const test = this.expression(); this.need(')');
      const body = this.statement(), alternative = word === 'if' && this.take('else') ? this.statement() : null;
      if ([body, alternative].some(statement => statement && ['declarations', 'functionDeclaration'].includes(statement.kind))) deny('INVALID_SYNTAX', 'declaration requires a block in conditional/loop statement body', start.origin);
      return { kind: word, test, body, alternative, origin: this.span(start) };
    }
    if (['return', 'throw'].includes(word)) {
      if (this.language === 'javascript' && word === 'return' && !this.hasFunctionContext())
        deny('INVALID_SYNTAX', 'return requires enclosing function', start.origin);
      this.at++;
      if (this.language === 'javascript' && this.hasLineTerminator(start, this.current())) deny('UNSUPPORTED_SYNTAX', 'automatic semicolon insertion after return/throw', start.origin);
      const value = this.value() === ';' ? null : this.expression(); this.need(';');
      if (word === 'throw' && !value) deny('UNSUPPORTED_SYNTAX', 'rethrow requires exception binding', start.origin);
      return { kind: word, value, origin: this.span(start) };
    }
    if (['for', 'foreach', 'switch', 'try', 'using', 'lock', 'yield', 'break', 'continue', 'class', 'export'].includes(word) ||
        this.language === 'csharp' && word === 'async') {
      deny('UNSUPPORTED_SYNTAX', `${word} lowering is not implemented in foundation subgrammar`, start.origin);
    }
    if (this.language === 'csharp') {
      const saved = this.at; let type;
      try { type = this.typeRef(); } catch { this.at = saved; }
      if (type && this.current().kind === 'identifier') return this.variable('local', type, start);
      this.at = saved;
    }
    const expression = this.expression(); this.need(';');
    return { kind: 'expression', expression, origin: this.span(start) };
  }
  jsFunction() {
    const start = this.need('function'), name = this.id(), node = this.node('function', name.value, start);
    this.formals(node); node.returnType = dynamicType(); node.body = this.inScope(node, () => this.block());
    node.origin = this.span(start); return { kind: 'functionDeclaration', declaration: node, origin: node.origin };
  }
  jsImport() {
    const start = this.need('import'), entries = [];
    if (this.current().kind === 'string') {
      const module = this.current(); this.at++; this.need(';');
      return { kind: 'moduleInitialization', module: module.value, origin: this.span(start) };
    }
    if (this.value() !== '{') deny('UNSUPPORTED_SYNTAX', 'only named imports implemented', this.current().origin);
    this.at++; do { const imported = this.id(false, true); const local = this.take('as') ? this.id() : this.identifier(imported);
      entries.push(this.node('import', local.value, imported, { import: { exported: imported.value, module: null, target: null } }));
      entries.at(-1).origin = this.span(imported);
    } while (this.take(','));
    this.need('}'); this.need('from'); const module = this.current();
    if (module.kind !== 'string') deny('INVALID_SYNTAX', 'literal module target required', module.origin);
    this.at++; this.need(';'); for (const node of entries) node.import.module = module.value;
    return { kind: 'importDeclaration', declarations: entries, module: module.value, origin: this.span(start) };
  }
  csNamespace() {
    const start = this.need('namespace'), parts = [this.id().value];
    while (this.take('.')) parts.push(this.id().value);
    this.need('{'); const prior = this.structural;
    const namespace = { kind: 'namespace', namespace: [...prior.namespace, ...parts], owner: this.scope,
      children: [], references: [], scopes: [] };
    this.scope.children.push(namespace); this.structural = namespace;
    this.inScope(namespace, () => { while (this.value() !== '}') { if (this.current().kind === 'eof') deny('INCOMPLETE_INPUT', 'unclosed namespace'); this.csDeclaration(); } });
    this.need('}'); namespace.origin = this.span(start); this.structural = prior;
  }
  csDeclaration() {
    const start = this.current();
    if (this.value() === 'namespace') { this.csNamespace(); return; }
    if (this.take('using')) {
      if (this.types.length) deny('INVALID_SYNTAX', 'using inside type', start.origin);
      const target = this.typeRef(); this.need(';');
      const node = this.node('namespaceImport', target.path?.at(-1) ?? '<import>', start, { import: { target, module: null, exported: null } }); node.origin = this.span(start); return;
    }
    const attributes = this.attributes(), mods = [];
    while (modifiers.has(this.value())) mods.push(this.tokens[this.at++].value);
    if (new Set(mods).size !== mods.length) deny('INVALID_SYNTAX', 'duplicate declaration modifier', start.origin);
    if (mods.filter(modifier => ['public', 'private', 'internal', 'protected'].includes(modifier)).length > 1) deny('UNSUPPORTED_SYNTAX', 'combined accessibility checking', start.origin);
    if (mods.includes('partial') || mods.includes('unsafe')) deny('UNSUPPORTED_SYNTAX', 'partial/unsafe declarations', start.origin);
    if (['class', 'struct', 'interface', 'enum'].includes(this.value())) {
      const category = this.tokens[this.at++].value, name = this.id();
      const node = this.node('type', name.value, start, { type: { kind: 'sourceType', declaration: null }, category, modifiers: mods, attributes });
      this.genericParameters(node);
      if (this.take(':')) { do { node.bases.push(this.typeRef()); } while (this.take(',')); }
      if (this.value() === 'where') deny('UNSUPPORTED_SYNTAX', 'generic constraint parsing', this.current().origin);
      this.need('{'); const prior = this.structural; this.structural = node; this.types.push(node);
      this.inScope(node, () => {
        if (category === 'enum') {
          if (this.value() !== '}') do { const token = this.id(), member = this.node('enumMember', token.value, token, { type: node.type });
            if (this.take('=')) member.initializer = this.expression(2); member.origin = this.span(token);
          } while (this.take(',') && this.value() !== '}');
        } else while (this.value() !== '}') { if (this.current().kind === 'eof') deny('INCOMPLETE_INPUT', 'unclosed type', start.origin); this.csDeclaration(); }
      });
      this.need('}'); this.take(';'); this.types.pop(); this.structural = prior; node.origin = this.span(start);
      this.requiredSlots(node); return;
    }
    if (!this.types.length) deny('UNSUPPORTED_SYNTAX', 'C# root declaration', start.origin);
    const ownerType = this.types.at(-1), constructor = this.value() === ownerType.name && this.tokens[this.at + 1].value === '(';
    if (constructor) {
      if (!['class', 'struct'].includes(ownerType.category)) deny('INVALID_SYNTAX', 'constructor requires class or struct', start.origin);
      const statik = mods.includes('static');
      const allowed = statik ? ['static'] : ['public', 'private', 'internal', 'protected'];
      if (statik && mods.some(modifier => ['public', 'private', 'internal', 'protected'].includes(modifier)))
        deny('INVALID_SYNTAX', 'static constructor has no access modifier', start.origin);
      if (mods.some(modifier => !allowed.includes(modifier))) deny('UNSUPPORTED_SYNTAX', 'unsupported constructor modifiers', start.origin);
      if (!statik && ownerType.modifiers.includes('static')) deny('INVALID_SYNTAX', 'static type cannot have instance constructor', start.origin);
      if (!statik && ownerType.category === 'struct' && mods.includes('protected'))
        deny('INVALID_SYNTAX', 'struct constructor cannot have protected accessibility', start.origin);
      if (statik && ownerType.children.some(child => child.kind === 'constructor' && child.static))
        deny('INVALID_SYNTAX', 'duplicate static constructor', start.origin);
    }
    const type = constructor ? { kind: 'sourceType', declaration: ownerType } : this.typeRef();
    const name = constructor ? this.id() : this.id();
    if (this.value() === '(' || this.value() === '<') {
      const node = this.node(constructor ? 'constructor' : 'method', name.value, start,
        { type: null, returnType: constructor ? { kind: 'void' } : type, attributes, modifiers: mods, static: mods.includes('static'), receiver: mods.includes('static') ? 'none' : 'instance' });
      this.genericParameters(node); this.formals(node);
      if (constructor && node.static && node.parameters.length) deny('INVALID_SYNTAX', 'static constructor requires zero formals', start.origin);
      if (constructor && !node.static && ownerType.category === 'struct' && !node.parameters.length && !mods.includes('public'))
        deny('INVALID_SYNTAX', 'parameterless struct constructor requires public accessibility', start.origin);
      if (this.value() === ':' || this.value() === 'where') deny('UNSUPPORTED_SYNTAX', 'constructor chain/generic constraints', this.current().origin);
      if (this.take(';')) { if (!mods.includes('extern') && ownerType.category !== 'interface' && !mods.includes('abstract')) deny('INVALID_SYNTAX', 'body required', start.origin); }
      else node.body = this.inScope(node, () => this.block());
      node.origin = this.span(start); return;
    }
    if (this.value() === '{') {
      const node = this.node('property', name.value, start, { type, attributes, modifiers: mods, static: mods.includes('static'), receiver: mods.includes('static') ? 'none' : 'instance' });
      this.at++; this.inScope(node, () => {
        while (this.value() !== '}') {
          const token = this.current(); if (!['get', 'set'].includes(token.value)) deny('UNSUPPORTED_SYNTAX', 'property accessor', token.origin);
          this.at++; const accessor = this.node('accessor', token.value, token, { returnType: token.value === 'get' ? type : { kind: 'void' }, accessor: token.value,
            static: node.static, receiver: node.receiver });
          if (this.take(';')) accessor.auto = true;
          else accessor.body = this.inScope(accessor, () => this.block());
          accessor.origin = this.span(token);
          if (token.value === 'set') {
            const value = this.synthetic('valueStorage', accessor, 0, { type, name: 'value' });
            accessor.synthetics.push(value); accessor.parameters.push(value);
          }
        }
      });
      this.need('}'); if (this.take('=')) { node.initializer = this.expression(2); this.need(';'); }
      node.origin = this.span(start);
      if (node.children.some(child => child.auto)) {
        if (ownerType.category !== 'interface') node.synthetics.unshift(this.synthetic('backingStorage', node, 0, { type, static: node.static }));
        if (node.children.some(child => !child.auto)) deny('INVALID_SYNTAX', 'mixed auto/explicit property accessors', node.origin);
      }
      return;
    }
    // The name was already read; rewind only that token, then parse each actual
    // declarator separately. No comma field is collapsed into one declaration.
    this.at--;
    this.variable('field', type, start, { attributes, modifiers: mods, static: mods.includes('static') || mods.includes('const'), receiver: mods.includes('static') || mods.includes('const') ? 'none' : 'instance' });
  }
  synthetic(role, anchor, ordinal, extra = {}) {
    return { kind: 'synthetic', name: `<${role}>`, slot: { role, ordinal, anchor },
      children: [], synthetics: [], references: [], scopes: [], owner: anchor,
      structural: anchor.kind === 'type' ? anchor : anchor.structural, namespace: [...anchor.namespace],
      type: null, returnType: null, modifiers: [], attributes: [], parameters: [], typeParameters: [],
      constraints: [], bases: [], interfaces: [], receiver: 'none', static: false, direction: 'value', params: false,
      defaultValue: null, initializer: null, accessor: null, backing: null, captures: [], import: null, explicitInterface: null, ...extra };
  }
  requiredSlots(type) {
    if (['class', 'struct'].includes(type.category))
      type.beforeFieldInit = !type.children.some(child => child.kind === 'constructor' && child.static);
    if (type.category === 'class' && !type.modifiers.includes('static') && !type.children.some(child => child.kind === 'constructor' && !child.static)) {
      type.synthetics.push(this.synthetic('instanceConstructor', type, 0, { returnType: { kind: 'void' }, receiver: 'instance',
        modifiers: [type.modifiers.includes('abstract') ? 'protected' : type.modifiers.includes('public') ? 'public' : 'internal'] }));
    }
    if (type.children.some(child => ['field', 'property'].includes(child.kind) && child.static && child.initializer && !child.modifiers.includes('const')) &&
        !type.children.some(child => child.kind === 'constructor' && child.static)) {
      type.synthetics.push(this.synthetic('typeInitializer', type, 0, { returnType: { kind: 'void' }, static: true }));
    }
  }
  parse() {
    const statements = [];
    while (this.current().kind !== 'eof') {
      if (this.language === 'csharp') this.csDeclaration();
      else statements.push(this.value() === 'import' ? this.jsImport() : this.statement());
    }
    const eof = this.current();
    if (eof.origin.byte[1] !== this.decoded.raw.length || this.at !== this.tokens.length - 1) deny('INCOMPLETE_INPUT', 'parser EOF mismatch');
    this.root.origin = this.decoded.origin(0, this.decoded.text.length);
    this.root.statements = statements;
    return { root: this.root, decoded: this.decoded, tokens: this.tokens, trivia: this.lexed.trivia,
      completeSyntax: true, consumedBytes: this.lexed.consumedBytes, language: this.language,
      implementedSubprofile: `${this.language}-foundation-1`, selectedProfileComplete: false };
  }
}

export function parseSourceForest(rawBytes, language) {
  const snapshot = Uint8Array.from(rawBytes);
  const parsed = new Parser(decodeOriginal(rawBytes), language).parse();
  ownedParseInputs.set(parsed, { raw: snapshot, language });
  return parsed;
}

export const SYNTHETIC_ORDER = Object.freeze(['instanceConstructor', 'typeInitializer',
  'backingStorage', 'getter', 'setter', 'delegateInvoke', 'valueStorage', 'temporaryStorage']);

// Namespace/block nodes consume no counter. Semantic method/block ownership is
// retained separately; local declarations use the nearest namespace/type parent.
export function enumerateForest(parsed, unitIdentity) {
  if (!parsed.completeSyntax || parsed.consumedBytes !== parsed.decoded.raw.length) deny('INCOMPLETE_FOREST', 'complete parse required');
  const owned = ownedParseInputs.get(parsed);
  if (!owned) deny('INCOMPLETE_FOREST', 'enumeration requires an internally owned parse');
  // Never enumerate producer-supplied/mutated declaration rows. Rebuild the
  // complete forest from the private original bytes and exact frontend selection.
  parsed = parseSourceForest(owned.raw, owned.language);
  const counters = new Map(), entries = [], scopes = new Map();
  const structuralKey = parent => JSON.stringify(parent);
  function visit(node, parent) {
    if (node.kind === 'unit' || node.kind === 'block' || node.kind === 'namespace') {
      if (node.kind === 'namespace') parent = { namespace: node.namespace, types: parent.types };
      if (node.kind === 'block') scopes.set(node, { owner: node.owner, ordinal: node.ordinal, origin: node.origin });
      for (const child of [...node.children].sort((a, b) => (a.start?.origin.byte[0] ?? a.origin.byte[0]) - (b.start?.origin.byte[0] ?? b.origin.byte[0]))) visit(child, parent);
      return;
    }
    const key = structuralKey(parent), index = counters.get(key) ?? 0; counters.set(key, index + 1);
    node.declId = { unit: unitIdentity, parent: structuredClone(parent), index }; entries.push(node);
    const childrenParent = node.kind === 'type' ? { namespace: parent.namespace, types: [...parent.types, node.declId] } : parent;
    const slots = [...node.synthetics].sort((a, b) => SYNTHETIC_ORDER.indexOf(a.slot.role) - SYNTHETIC_ORDER.indexOf(b.slot.role) || a.slot.ordinal - b.slot.ordinal);
    const slotKeys = new Set();
    for (const slot of slots) {
      if (!SYNTHETIC_ORDER.includes(slot.slot.role) || slotKeys.has(`${slot.slot.role}:${slot.slot.ordinal}`)) deny('INCOMPLETE_FOREST', 'unknown or duplicate required slot');
      slotKeys.add(`${slot.slot.role}:${slot.slot.ordinal}`); visit(slot, childrenParent);
    }
    for (const child of [...node.children].sort((a, b) => (a.start?.origin.byte[0] ?? a.origin.byte[0]) - (b.start?.origin.byte[0] ?? b.origin.byte[0]))) visit(child, childrenParent);
  }
  visit(parsed.root, { namespace: [], types: [] });
  return { entries, scopes, root: parsed.root, unitIdentity, completeEnumeration: true };
}

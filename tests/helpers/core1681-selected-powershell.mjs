import { deny } from './core1681-source-input.mjs';
import { SelectedSyntax } from './core1681-selected-syntax.mjs';

const levels = new Map([['=', 1], ['+=', 1], ['-=', 1], [',', 2], ['-or', 3], ['-xor', 3],
  ['-and', 4], ['-eq', 5], ['-ne', 5], ['-lt', 5], ['-le', 5], ['-gt', 5], ['-ge', 5],
  ['-ceq', 5], ['-cne', 5], ['-ieq', 5], ['-ine', 5], ['-like', 5], ['-match', 5],
  ['-contains', 5], ['-in', 5], ['-is', 5], ['-isnot', 5], ['-as', 5], ['-band', 6],
  ['-bor', 6], ['-bxor', 6], ['-shl', 7], ['-shr', 7], ['+', 8], ['-', 8],
  ['*', 9], ['/', 9], ['%', 9], ['-f', 9], ['-join', 9], ['-split', 9]]);

// This parser emits actual syntax and original spans only. Command resolution,
// variable slots, scriptblock captures and CLR overloads belong to the binder.
export class SelectedPowerShellSyntax extends SelectedSyntax {
  constructor(rawBytes, counter, decoderOccurrence) { super(rawBytes, 'powershell', counter, undefined, decoderOccurrence); }
  boundary() {
    const token = this.peek();
    if ([';', '}', ')', ']'].includes(token.spelling) || token.kind === 'eof') return true;
    return this.last && /[\r\n]/u.test(this.scanner.text.slice(this.last.origin.utf16[1], token.origin.utf16[0]).replace(/`(?:\r\n|\r|\n)/gu, ''));
  }
  psType() {
    const first = this.need('['), segments = [];
    do { segments.push(this.name()); } while (this.take('.'));
    let elementArray = false;
    if (this.take('[')) { this.need(']'); elementArray = true; }
    this.need(']'); return this.node('psType', first, { segments, elementArray });
  }
  psVariable() {
    const token = this.consume();
    if (token.kind !== 'variable') deny('INVALID_SYNTAX', 'PowerShell variable required', token.origin);
    return this.node('psVariable', token, { spelling: token.spelling });
  }
  psExpandable(token) {
    const saved = { at: this.scanner.at, current: this.current, last: this.last };
    const parts = [], end = token.origin.utf16[1] - 1;
    let index = token.origin.utf16[0] + 1, fragmentStart = index;
    const fragment = finish => {
      if (finish === fragmentStart) return;
      const origin = this.scanner.origin(fragmentStart, finish);
      this.last = { origin };
      parts.push(this.node('psStringText', { origin }, { spelling: this.scanner.text.slice(fragmentStart, finish) }));
    };
    try {
      while (index < end) {
        this.counter.charge('maxInvariantSteps', `ps-expansion:${index}`);
        if (this.scanner.text[index] === '`') { index += 2; continue; }
        if (this.scanner.text[index] !== '$') { index++; continue; }
        const next = this.scanner.text[index + 1];
        if (next === '(') {
          fragment(index); const first = { origin: this.scanner.origin(index, index + 2) };
          this.scanner.at = index + 2; this.current = null; this.last = first;
          const statements = this.psStatements(')'); this.need(')');
          if (this.scanner.at > end) deny('INVALID_SYNTAX', 'string expansion exceeds original token', token.origin);
          parts.push(this.node('psSubexpression', first, { statements }));
          index = this.scanner.at; fragmentStart = index; continue;
        }
        if (next === '{') {
          fragment(index); let finish = index + 2;
          while (finish < end && this.scanner.text[finish] !== '}') finish++;
          const name = this.scanner.text.slice(index + 2, finish);
          if (finish === end || !/^[A-Za-z_][A-Za-z_0-9:-]*$/u.test(name)) deny('UNSUPPORTED_FORM', 'selected braced variable spelling required', token.origin);
          const origin = this.scanner.origin(index, finish + 1); this.last = { origin };
          parts.push(this.node('psVariable', { origin }, { spelling: `$${name}` }));
          index = finish + 1; fragmentStart = index; continue;
        }
        if (/[A-Za-z_]/u.test(next ?? '')) {
          fragment(index); this.scanner.at = index; this.current = null;
          const variable = this.psVariable();
          if (variable.origin.utf16[1] > end) deny('INVALID_SYNTAX', 'variable exceeds original string token', token.origin);
          parts.push(variable); index = this.scanner.at; fragmentStart = index; continue;
        }
        index++;
      }
      fragment(end);
    } finally { this.scanner.at = saved.at; this.current = saved.current; this.last = saved.last; }
    return this.node('psExpandableString', token, { token, parts });
  }
  psPrimary() {
    const first = this.peek();
    if (first.kind === 'number' || first.kind === 'string') {
      this.consume();
      if (first.kind === 'string' && first.spelling.startsWith('"')) return this.psExpandable(first);
      return this.node('literal', first, { token: first });
    }
    if (first.kind === 'variable') return this.psVariable();
    if (first.kind === 'splatVariable') { this.consume(); return this.node('psSplat', first, { spelling: first.spelling }); }
    if (first.kind === 'subexpressionStart') {
      this.consume(); const statements = this.psStatements(')'); this.need(')');
      return this.node('psSubexpression', first, { statements });
    }
    if (this.word() === '[') {
      const type = this.psType();
      if (this.take('::')) return this.node('psStaticMember', first, { type, name: this.name() });
      if (this.boundary() || levels.has(this.word().toLowerCase()) || this.word() === ',') return this.node('psTypeExpression', first, { type });
      return this.node('psCast', first, { type, operand: this.psExpression(10) });
    }
    if (this.take('(')) { const expression = this.psPipeline(); this.need(')'); return this.node('group', first, { expression }); }
    if (this.word() === '{') return this.psBlock('scriptblock');
    if (this.take('@')) {
      if (this.take('(')) {
        const statements = this.psStatements(')'); this.need(')');
        return this.node('psArraySubexpression', first, { statements });
      }
      this.need('{'); const entries = [];
      while (this.word() !== '}') {
        const keyFirst = this.peek();
        const key = ['identifier', 'string'].includes(keyFirst.kind)
          ? (this.consume(), this.node('psHashtableKey', keyFirst, { token: keyFirst })) : this.psExpression(2);
        this.need('='); const value = this.psPipeline();
        entries.push(this.node('psHashtableEntry', keyFirst, { key, value }));
        if (!this.take(';') && this.word() !== '}' && !this.boundary()) deny('INVALID_SYNTAX', 'hashtable entry separator required', this.peek().origin);
      }
      this.need('}'); return this.node('psHashtable', first, { entries });
    }
    if (first.kind === 'identifier') { this.consume(); return this.node('psBareword', first, { token: first }); }
    deny('UNSUPPORTED_FORM', 'unbound PowerShell primary', first.origin);
  }
  psExpression(minimum = 1) {
    const first = this.peek(); let left;
    if (['+', '-', '!', '-not', '-bnot', '++', '--'].includes(first.spelling.toLowerCase())) {
      this.consume(); left = this.node('unary', first, { operation: first.spelling.toLowerCase(), operand: this.psExpression(10) });
    } else left = this.psPrimary();
    while (true) {
      if (this.take('.')) { left = this.node('member', first, { target: left, name: this.name() }); continue; }
      if (this.take('(')) {
        const arguments_ = [];
        if (this.word() !== ')') do { arguments_.push(this.psExpression(3)); } while (this.take(','));
        this.need(')'); left = this.node('psMethodCall', first, { target: left, arguments: arguments_ }); continue;
      }
      if (this.take('[')) { const index = this.psExpression(); this.need(']'); left = this.node('index', first, { target: left, index }); continue; }
      if (['++', '--'].includes(this.word())) { left = this.node('postfix', first, { operation: this.consume().spelling, operand: left }); continue; }
      const operation = this.word().toLowerCase(), level = levels.get(operation);
      if (level === undefined || level < minimum || this.boundary()) break;
      this.consume(); const right = level === 1 ? this.psPipeline() : this.psExpression(level + 1);
      left = this.node(level === 1 ? 'assignment' : 'binary', first, { operation, left, right });
    }
    return left;
  }
  psCommand() {
    const first = this.peek(), invocation = this.take('&') ? 'call' : this.take('.') ? 'dotSource' : 'normal';
    if (invocation === 'normal' && ['if', 'try', 'switch'].includes(this.word().toLowerCase()))
      return this.node('psStatementValue', first, { statement: this.psStatement() });
    const target = this.psExpression(), arguments_ = [];
    while (!this.boundary() && this.word() !== '|') {
      const start = this.peek();
      if (start.kind === 'parameterOrOperator') {
        this.consume(); arguments_.push(this.node('psCommandParameter', start, { spelling: start.spelling }));
      } else arguments_.push(this.psCommandArgument());
    }
    if (invocation === 'normal' && arguments_.length === 0 && target.kind !== 'psBareword') return target;
    return this.node('psCommand', first, { invocation, target, arguments: arguments_ });
  }
  psCommandArgument() {
    const first = this.peek();
    if (first.kind !== 'identifier') return this.psExpression(3);
    this.consume(); const spellingParts = [first];
    while (this.peek().origin.utf16[0] === this.last.origin.utf16[1]) {
      if (this.take('.')) { spellingParts.push(this.last); const token = this.consume(); if (token.kind !== 'identifier') deny('INVALID_SYNTAX', 'bareword segment required', token.origin); spellingParts.push(token); continue; }
      if (this.take('[')) {
        spellingParts.push(this.last);
        do {
          const token = this.consume();
          if (token.kind !== 'identifier') deny('INVALID_SYNTAX', 'bareword type argument required', token.origin);
          spellingParts.push(token);
          if (!this.take(',')) break;
          spellingParts.push(this.last);
        } while (true);
        this.need(']'); spellingParts.push(this.last); continue;
      }
      break;
    }
    const suffix = this.word() === '(' && this.peek().origin.utf16[0] === this.last.origin.utf16[1] ? this.psPrimary() : null;
    return this.node('psCommandBareword', first, { spellingParts, suffix });
  }
  psPipeline() {
    const first = this.peek(), stages = [this.psCommand()];
    while (this.take('|')) stages.push(this.psCommand());
    return stages.length === 1 ? stages[0] : this.node('psPipeline', first, { stages });
  }
  psParameters() {
    this.need('('); const parameters = [];
    if (this.word() !== ')') do {
      const first = this.peek(), type = this.word() === '[' ? this.psType() : null, variable = this.psVariable();
      const initializer = this.take('=') ? this.psExpression(3) : null;
      parameters.push(this.declaration('psParameter', first, { type, variable, initializer }));
    } while (this.take(','));
    this.need(')'); return parameters;
  }
  psBlock(kind = 'block') {
    const first = this.need('{'), statements = this.psStatements('}'); this.need('}');
    return this.node(kind, first, { statements });
  }
  psStatement() {
    const first = this.peek(), word = first.spelling.toLowerCase();
    if (this.take(';')) return this.node('empty', first);
    if (word === 'function') {
      this.consume(); const name = this.name(), parameters = this.word() === '(' ? this.psParameters() : [];
      return this.declaration('psFunction', first, { name, parameters, body: this.psBlock() });
    }
    if (word === 'param') { this.consume(); return this.node('psParamBlock', first, { parameters: this.psParameters() }); }
    if (word === 'if' || word === 'elseif') {
      this.consume(); this.need('('); const test = this.psPipeline(); this.need(')'); const body = this.psBlock();
      const next = this.word().toLowerCase();
      const alternative = next === 'elseif' ? this.psStatement() : next === 'else' ? (this.consume(), this.psBlock()) : null;
      return this.node('if', first, { test, body, alternative });
    }
    if (word === 'try') {
      this.consume(); const body = this.psBlock(), handlers = [];
      while (this.word().toLowerCase() === 'catch') {
        const handlerFirst = this.consume(), types = [];
        if (this.word() === '[') do { types.push(this.psType()); } while (this.take(','));
        handlers.push(this.node('psCatch', handlerFirst, { types, body: this.psBlock() }));
      }
      const finalizer = this.word().toLowerCase() === 'finally' ? (this.consume(), this.psBlock()) : null;
      if (handlers.length === 0 && !finalizer) deny('INVALID_SYNTAX', 'try requires catch or finally', first.origin);
      return this.node('try', first, { body, handlers, finalizer });
    }
    if (word === 'while' || word === 'until') {
      this.consume(); this.need('('); const test = this.psPipeline(); this.need(')');
      return this.node(word, first, { test, body: this.psBlock() });
    }
    if (word === 'do') {
      this.consume(); const body = this.psBlock(), condition = this.consume();
      if (!['while', 'until'].includes(condition.spelling.toLowerCase())) deny('INVALID_SYNTAX', 'do requires while or until', condition.origin);
      this.need('('); const test = this.psPipeline(); this.need(')');
      return this.node('psDo', first, { body, operation: condition.spelling.toLowerCase(), test });
    }
    if (word === 'foreach') {
      this.consume(); this.need('('); const variable = this.psVariable();
      const slot = this.declaration('psIterationVariable', { origin: variable.origin }, { variable });
      const operation = this.consume();
      if (operation.spelling.toLowerCase() !== 'in') deny('INVALID_SYNTAX', 'foreach requires in', operation.origin);
      const sequence = this.psPipeline(); this.need(')');
      return this.node('foreach', first, { slot, sequence, body: this.psBlock() });
    }
    if (word === 'switch') {
      this.consume(); const flags = [];
      while (this.peek().kind === 'parameterOrOperator') {
        const flag = this.consume();
        if (!['-regex', '-wildcard', '-exact', '-casesensitive', '-file'].includes(flag.spelling.toLowerCase()))
          deny('INVALID_SYNTAX', 'unsupported switch flag', flag.origin);
        flags.push(flag);
      }
      const test = this.take('(') ? (() => { const expression = this.psPipeline(); this.need(')'); return expression; })() : this.psExpression(3);
      this.need('{'); const clauses = [];
      while (this.word() !== '}') {
        if (this.peek().kind === 'eof') deny('INVALID_SYNTAX', 'unterminated switch', first.origin);
        const clauseFirst = this.peek();
        const fallback = this.word().toLowerCase() === 'default';
        const guard = fallback ? (this.consume(), null) : this.psExpression(3);
        clauses.push(this.node('psSwitchClause', clauseFirst, { guard, fallback, body: this.psBlock() }));
        this.take(';');
      }
      this.need('}'); return this.node('psSwitch', first, { flags, test, clauses });
    }
    if (word === 'for') {
      this.consume(); this.need('(');
      const initializer = this.word() === ';' ? null : this.psPipeline(); this.need(';');
      const test = this.word() === ';' ? null : this.psPipeline(); this.need(';');
      const increment = this.word() === ')' ? null : this.psPipeline(); this.need(')');
      return this.node('for', first, { initializer, test, increment, body: this.psBlock() });
    }
    if (['return', 'throw', 'break', 'continue', 'exit'].includes(word)) {
      this.consume(); const expression = this.boundary() ? null : this.psPipeline();
      return this.node(word, first, { expression });
    }
    if (this.word() === '[') {
      const mark = this.mark(), type = this.psType();
      if (this.peek().kind === 'variable') {
        const variable = this.psVariable();
        if (this.word() === '=' || this.boundary()) {
          const initializer = this.take('=') ? this.psPipeline() : null;
          return this.declaration('psTypedVariable', first, { type, variable, initializer });
        }
      }
      this.restore(mark);
    }
    return this.node('expressionStatement', first, { expression: this.psPipeline() });
  }
  psStatements(end) {
    const statements = [];
    while (this.word() !== end && this.peek().kind !== 'eof') {
      statements.push(this.psStatement());
      if (!this.take(';') && this.word() !== end && this.peek().kind !== 'eof' && !this.boundary())
        deny('INVALID_SYNTAX', 'PowerShell statement separator required', this.peek().origin);
    }
    return statements;
  }
  powershellUnit() {
    const first = this.peek(), attributes = [];
    while (this.word() === '[') {
      const mark = this.mark(), attributeFirst = this.consume(), name = this.name();
      if (!this.take('(')) { this.restore(mark); break; }
      const arguments_ = [];
      if (this.word() !== ')') do { arguments_.push(this.psExpression(3)); } while (this.take(','));
      this.need(')'); this.need(']'); attributes.push(this.node('psAttribute', attributeFirst, { name, arguments: arguments_ }));
    }
    const statements = this.psStatements(''); const eof = this.consume();
    if (eof.kind !== 'eof' || eof.origin.byte[1] !== this.scanner.decoded.raw.length) deny('INCOMPLETE_INPUT', 'PowerShell EOF differs', eof.origin);
    return this.node('unit', first, { attributes, statements });
  }
}

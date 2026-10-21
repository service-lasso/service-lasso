import { decodeOriginal, deny } from './core1681-source-input.mjs';

const csSpace = /[\u0009\u000b\u000c\u0020\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/u;
const csNewline = /[\r\n\u0085\u2028\u2029]/u;
const asciiStart = /[A-Za-z_]/u, asciiRest = /[A-Za-z_0-9]/u;
const punctuation = ['>>>=', '===', '!==', '>>>', '<<=', '>>=', '**=', '??=', '&&=', '||=',
  '...', '=>', '==', '!=', '<=', '>=', '++', '--', '&&', '||', '??', '?.', '+=', '-=',
  '*=', '/=', '%=', '<<', '>>', '**', '&=', '|=', '^=', '::', '->', '##'];

// The parser chooses the ECMAScript lexical goal at each token boundary. No
// preceding-token heuristic may reinterpret a regexp as division or vice versa.
// This scanner records spelling and origins; literal typing is a later checked
// judgement and never calls a target parser, regexp, evaluator or compiler.
export class SelectedScanner {
  constructor(rawBytes, language, counter, decoderOccurrence) {
    if (!['csharp', 'c', 'javascript', 'powershell'].includes(language))
      deny('UNBOUND_PROFILE', 'unknown selected source language');
    this.decoded = decodeOriginal(rawBytes, decoderOccurrence); this.text = this.decoded.text;
    this.language = language; this.counter = counter; this.at = 0; this.trivia = []; this.psExpansionDepth = 0;
  }
  origin(start, end = this.at) { return this.decoded.origin(start, end); }
  fail(message, start = this.at) { deny('UNSUPPORTED_FORM', message, this.origin(start, Math.min(this.at + 1, this.text.length))); }
  newline(character) {
    return this.language === 'csharp' ? csNewline.test(character) : this.language === 'javascript' ? /[\r\n\u2028\u2029]/u.test(character) : /[\r\n]/u.test(character);
  }
  triviaToken(kind, start) {
    this.counter.charge('maxTokens', `${this.language}:trivia:${start}`);
    this.trivia.push({ kind, spelling: this.text.slice(start, this.at), origin: this.origin(start) });
  }
  skipTrivia() {
    while (this.at < this.text.length) {
      const start = this.at, character = this.text[this.at];
      if (start === 0 && character === '\ufeff') { this.at++; this.triviaToken('bom', start); continue; }
      const space = this.language === 'csharp' ? csSpace.test(character) || csNewline.test(character)
        : /[\u0009-\u000d\u0020]/u.test(character) || this.language === 'javascript' && /[\u00a0\ufeff\u2028\u2029]/u.test(character);
      if (space) { this.at++; this.triviaToken('whitespace', start); continue; }
      if (this.language === 'powershell' && this.text.startsWith('`\r\n', start)) {
        this.at += 3; this.triviaToken('lineContinuation', start); continue;
      }
      if (this.language === 'powershell' && this.text.startsWith('`\n', start)) {
        this.at += 2; this.triviaToken('lineContinuation', start); continue;
      }
      const lineComment = this.language === 'powershell' ? character === '#' : this.text.startsWith('//', start);
      if (lineComment) {
        this.at += this.language === 'powershell' ? 1 : 2;
        while (this.at < this.text.length && !this.newline(this.text[this.at])) this.at++;
        this.triviaToken('lineComment', start); continue;
      }
      const blockOpen = this.language === 'powershell' ? '<#' : '/*';
      const blockClose = this.language === 'powershell' ? '#>' : '*/';
      if (this.text.startsWith(blockOpen, start)) {
        this.at += 2;
        while (this.at < this.text.length && !this.text.startsWith(blockClose, this.at)) this.at++;
        if (this.at === this.text.length) this.fail('unterminated selected block comment', start);
        this.at += 2; this.triviaToken('blockComment', start); continue;
      }
      break;
    }
  }
  token(kind, start, extras = {}) {
    this.counter.charge('maxTokens', `${this.language}:${kind}:${start}`);
    return { kind, spelling: this.text.slice(start, this.at), origin: this.origin(start), ...extras };
  }
  quoted(start, quote, verbatim = false) {
    this.at++;
    while (this.at < this.text.length) {
      const character = this.text[this.at++];
      if (character === quote) {
        if ((verbatim || this.language === 'powershell' && quote === "'") && this.text[this.at] === quote) { this.at++; continue; }
        return this.token(quote === "'" && this.language !== 'javascript' && this.language !== 'powershell' ? 'char' : 'string', start, { verbatim });
      }
      if (this.newline(character) && !verbatim && this.language !== 'powershell') this.fail('raw newline in selected ordinary literal', start);
      if (this.language === 'powershell' && quote === '"' && character === '$' && this.text[this.at] === '(') {
        this.at++; this.psQuotedSubexpression(start); continue;
      }
      const escape = this.language === 'powershell' ? '`' : '\\';
      if (!verbatim && character === escape && !(this.language === 'powershell' && quote === "'")) {
        if (this.at === this.text.length) this.fail('unfinished selected literal escape', start);
        const escaped = this.text[this.at++];
        if (this.language === 'csharp' && csNewline.test(escaped)) this.fail('C# escaped raw newline', start);
        if (this.language === 'javascript' && escaped === '\r' && this.text[this.at] === '\n') this.at++;
        if (this.language === 'javascript' && escaped === 'u' && this.text[this.at] === '{') {
          this.at++; let count = 0;
          while (/[0-9a-fA-F]/u.test(this.text[this.at] ?? '')) { this.at++; count++; }
          if (!count || count > 6 || this.text[this.at++] !== '}') this.fail('invalid JavaScript braced Unicode escape', start);
        } else if (this.language !== 'powershell' && (['u', 'x'].includes(escaped) || ['c', 'csharp'].includes(this.language) && escaped === 'U')) {
          const minimum = escaped === 'x' ? this.language === 'javascript' ? 2 : 1 : escaped === 'u' ? 4 : 8;
          const maximum = escaped === 'x' ? this.language === 'c' ? Infinity : this.language === 'csharp' ? 4 : 2 : minimum;
          let count = 0;
          while (count < maximum && /[0-9a-fA-F]/u.test(this.text[this.at] ?? '')) { this.at++; count++; }
          if (count < minimum) this.fail('incomplete selected Unicode/hex escape', start);
        }
      }
    }
    this.fail('unterminated selected literal', start);
  }
  psQuotedSubexpression(start) {
    if (++this.psExpansionDepth > 128) this.fail('PowerShell string expansion nesting bound', start);
    try {
    let depth = 1;
    while (this.at < this.text.length) {
      this.counter.charge('maxInvariantSteps', `ps-string-subexpression:${this.at}`);
      const character = this.text[this.at];
      if (character === '"' || character === "'") { this.quoted(this.at, character); continue; }
      if (character === '`') { this.at += 2; if (this.at > this.text.length) this.fail('unfinished PowerShell subexpression escape', start); continue; }
      if (character === '#') { while (this.at < this.text.length && !this.newline(this.text[this.at])) this.at++; continue; }
      if (this.text.startsWith('<#', this.at)) {
        this.at += 2;
        while (this.at < this.text.length && !this.text.startsWith('#>', this.at)) this.at++;
        if (this.at === this.text.length) this.fail('unfinished PowerShell subexpression comment', start);
        this.at += 2; continue;
      }
      this.at++;
      if (character === '(' && ++depth > 128) this.fail('PowerShell subexpression nesting bound', start);
      if (character === ')' && --depth === 0) return;
    }
    this.fail('unfinished PowerShell string subexpression', start);
    } finally { this.psExpansionDepth--; }
  }
  regexp(start) {
    this.at++; let inClass = false;
    while (this.at < this.text.length) {
      const character = this.text[this.at++];
      if (this.newline(character)) this.fail('raw newline in regular expression', start);
      if (character === '\\') {
        if (this.at === this.text.length || this.newline(this.text[this.at])) this.fail('unfinished regular expression escape', start);
        this.at++; continue;
      }
      if (character === '[') inClass = true;
      else if (character === ']') inClass = false;
      else if (character === '/' && !inClass) {
        const flagsStart = this.at;
        while (/[A-Za-z]/u.test(this.text[this.at] ?? '')) this.at++;
        const flags = this.text.slice(flagsStart, this.at);
        if ([...flags].some((flag, index) => !'dgimsuvy'.includes(flag) || flags.indexOf(flag) !== index) || flags.includes('u') && flags.includes('v'))
          this.fail('invalid selected regular expression flags', start);
        return this.token('regexp', start, { flags });
      }
    }
    this.fail('unterminated selected regular expression', start);
  }
  next(goal = 'division') {
    if (!['division', 'regexp'].includes(goal)) deny('INVALID_INPUT', 'unknown lexical goal');
    this.skipTrivia(); const start = this.at, character = this.text[this.at];
    if (this.at === this.text.length) return this.token('eof', start);
    if (this.language === 'csharp' && this.text.startsWith('$"', start)) { this.at += 2; return this.token('interpolatedStart', start); }
    if (this.language === 'csharp' && this.text.startsWith('@"', start)) { this.at++; return this.quoted(start, '"', true); }
    if (this.language === 'c' && character === 'L' && ['"', "'"].includes(this.text[this.at + 1])) {
      this.at++; return this.quoted(start, this.text[this.at]);
    }
    if (character === '"' || character === "'") return this.quoted(start, character);
    if (this.language === 'javascript' && character === '/' && goal === 'regexp') return this.regexp(start);
    if (this.language === 'javascript' && character === '`') { this.at++; return this.token('templateStart', start); }
    if (this.language === 'powershell' && this.text.startsWith('$(', start)) {
      this.at += 2; return this.token('subexpressionStart', start);
    }
    if (this.language === 'powershell' && character === '@' && asciiStart.test(this.text[this.at + 1] ?? '')) {
      this.at += 2;
      while (asciiRest.test(this.text[this.at] ?? '') || this.text[this.at] === ':') this.at++;
      return this.token('splatVariable', start);
    }
    if (this.language === 'powershell' && character === '-' && /[A-Za-z]/u.test(this.text[this.at + 1] ?? '')) {
      this.at += 2;
      while (/[A-Za-z]/u.test(this.text[this.at] ?? '')) this.at++;
      return this.token('parameterOrOperator', start);
    }
    const escapedIdentifier = this.language === 'csharp' && character === '@';
    const variable = this.language === 'powershell' && character === '$';
    if (variable && this.text[this.at + 1] === '{') {
      this.at += 2; const nameStart = this.at;
      while (this.at < this.text.length && this.text[this.at] !== '}') this.at++;
      if (this.at === this.text.length || !/^[A-Za-z_][A-Za-z_0-9:-]*$/u.test(this.text.slice(nameStart, this.at)))
        this.fail('unsupported selected braced variable spelling', start);
      this.at++; return this.token('variable', start, { braced: true });
    }
    if (escapedIdentifier || variable) this.at++;
    if (asciiStart.test(this.text[this.at] ?? '') || this.language === 'javascript' && this.text[this.at] === '$') {
      this.at++;
      while (asciiRest.test(this.text[this.at] ?? '') || this.language === 'javascript' && this.text[this.at] === '$' ||
        this.language === 'powershell' && (this.text[this.at] === ':' || !variable && this.text[this.at] === '-')) this.at++;
      return this.token(variable ? 'variable' : 'identifier', start, { escapedIdentifier });
    }
    if (escapedIdentifier || variable) this.fail('unsupported selected identifier spelling', start);
    if (/[0-9]/u.test(character) || character === '.' && /[0-9]/u.test(this.text[this.at + 1] ?? '')) {
      if (this.text.startsWith('0x', start) || this.text.startsWith('0X', start)) {
        this.at += 2; const digits = this.at;
        while (/[0-9a-fA-F]/u.test(this.text[this.at] ?? '')) this.at++;
        if (this.at === digits) this.fail('empty hexadecimal literal', start);
      } else {
        while (/[0-9]/u.test(this.text[this.at] ?? '')) this.at++;
        if (this.text[this.at] === '.' && this.text[this.at + 1] !== '.' &&
            (this.language !== 'csharp' || /[0-9]/u.test(this.text[this.at + 1] ?? ''))) {
          this.at++; while (/[0-9]/u.test(this.text[this.at] ?? '')) this.at++;
        }
        if (/[eE]/u.test(this.text[this.at] ?? '')) {
          this.at++; if (['+', '-'].includes(this.text[this.at])) this.at++;
          const digits = this.at; while (/[0-9]/u.test(this.text[this.at] ?? '')) this.at++;
          if (this.at === digits) this.fail('empty numeric exponent', start);
        }
      }
      while (/[uUlLfFdDmM]/u.test(this.text[this.at] ?? '')) this.at++;
      return this.token('number', start);
    }
    const multi = punctuation.find(value => this.text.startsWith(value, start));
    if (multi) { this.at += multi.length; return this.token('punctuation', start); }
    if ('{}[]();,.?:+-*/%&|^~!=<>#'.includes(character) || this.language === 'powershell' && character === '@') { this.at++; return this.token('punctuation', start); }
    this.fail('character outside selected finite lexical profile', start);
  }
  templatePart() {
    if (this.language !== 'javascript') deny('UNBOUND_PROFILE', 'template lexical goal requires JavaScript');
    const start = this.at;
    while (this.at < this.text.length) {
      if (this.text[this.at] === '`') { const end = this.at++; return this.token('templateTail', start, { textEnd: end }); }
      if (this.text.startsWith('${', this.at)) { const end = this.at; this.at += 2; return this.token('templateHead', start, { textEnd: end }); }
      if (this.text[this.at++] === '\\') {
        if (this.at === this.text.length) this.fail('unfinished template escape', start);
        this.at++;
      }
    }
    this.fail('unterminated selected template literal', start);
  }
  csharpInterpolatedPart(format = false) {
    if (this.language !== 'csharp') deny('UNBOUND_PROFILE', 'interpolated lexical goal requires C#');
    const start = this.at;
    while (this.at < this.text.length) {
      this.counter.charge('maxInvariantSteps', `cs-interpolated-part:${this.at}`);
      const character = this.text[this.at];
      if (this.newline(character)) this.fail('raw newline in selected interpolated string', start);
      if (character === '"') {
        if (format) this.fail('unterminated interpolation format', start);
        const end = this.at++; return this.token('interpolatedTail', start, { textEnd: end });
      }
      if (character === '{' || character === '}') {
        if (this.text[this.at + 1] === character) { this.at += 2; continue; }
        const end = this.at++;
        if (format && character === '}') return this.token('interpolatedFormat', start, { textEnd: end });
        if (!format && character === '{') return this.token('interpolatedHead', start, { textEnd: end });
        this.fail('unpaired interpolation text brace', start);
      }
      this.at++;
      if (character === '\\') {
        if (this.at === this.text.length) this.fail('unfinished interpolation escape', start);
        const escaped = this.text[this.at++];
        if (this.newline(escaped)) this.fail('escaped raw newline in interpolation', start);
        if (['x', 'u', 'U'].includes(escaped)) {
          const minimum = escaped === 'x' ? 1 : escaped === 'u' ? 4 : 8, maximum = escaped === 'x' ? 4 : minimum;
          let count = 0;
          while (count < maximum && /[0-9a-fA-F]/u.test(this.text[this.at] ?? '')) { this.at++; count++; }
          if (count < minimum) this.fail('unfinished interpolation Unicode escape', start);
        } else if (!"'\"\\0abfnrtv".includes(escaped)) this.fail('invalid interpolation escape', start);
      }
    }
    this.fail('unterminated selected interpolated string', start);
  }
}

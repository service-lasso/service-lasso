import { deny } from './core1681-source-input.mjs';
import { SelectedScanner } from './core1681-selected-scanner.mjs';

const bv = (width, signed) => ({ kind: 'BV', width, signed });
const constant = (sort, value) => ({ kind: 'Constant', sort, value });
const simpleEscapes = Object.freeze({ '0': 0, a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11,
  '\\': 92, "'": 39, '"': 34 });

function roundQuotient(numerator, denominator) {
  const quotient = numerator / denominator, remainder = numerator % denominator;
  return quotient + (remainder * 2n > denominator || remainder * 2n === denominator && quotient % 2n === 1n ? 1n : 0n);
}
function decimalRational(spelling, origin) {
  const normalized = spelling.startsWith('.') ? '0' + spelling : spelling;
  const match = /^(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/u.exec(normalized);
  if (!match) deny('INVALID_LITERAL', 'numeric literal is outside the selected finite grammar', origin);
  const exponent = BigInt(match[3] ?? '0') - BigInt((match[2] ?? '').length);
  // Bound before allocating powers; hostile literal exponents cannot allocate
  // unbounded BigInts inside the pure compiler or independent checker.
  if (exponent < -10000n || exponent > 10000n) deny('EXHAUSTED', 'literal exponent bound exceeded', origin);
  const digits = BigInt(match[1] + (match[2] ?? ''));
  return exponent >= 0n ? [digits * 10n ** exponent, 1n] : [digits, 10n ** -exponent];
}

// Exact rational-to-IEEE conversion. Host Number floating arithmetic is absent:
// ties, subnormals, carry, signed zero and overflow use integer equations.
export function ieeeLiteralBits(numerator, denominator, width, negative = false, overflow = 'deny') {
  if (![32, 64].includes(width) || numerator < 0n || denominator <= 0n)
    deny('INVALID_LITERAL', 'invalid exact IEEE input');
  if (!['deny', 'infinity'].includes(overflow)) deny('INVALID_LITERAL', 'unknown fixed IEEE overflow alternative');
  const fractionBits = width === 32 ? 23 : 52, exponentBits = width === 32 ? 8 : 11;
  const bias = (1 << (exponentBits - 1)) - 1, minimum = 1 - bias, maximum = bias;
  let exponent = 0;
  if (numerator !== 0n) {
    const bitLength = value => value.toString(2).length;
    exponent = bitLength(numerator) - bitLength(denominator);
    const atLeastPower = value => value >= 0 ? numerator >= denominator << BigInt(value)
      : numerator << BigInt(-value) >= denominator;
    if (!atLeastPower(exponent)) exponent--;
  }
  let exponentField = 0n, fraction = 0n;
  if (numerator !== 0n) {
    const quantum = Math.max(exponent, minimum) - fractionBits;
    let significand = quantum >= 0 ? roundQuotient(numerator, denominator << BigInt(quantum))
      : roundQuotient(numerator << BigInt(-quantum), denominator);
    if (exponent < minimum) {
      if (significand >= 1n << BigInt(fractionBits)) exponentField = 1n;
      else fraction = significand;
    } else {
      if (significand === 1n << BigInt(fractionBits + 1)) { significand >>= 1n; exponent++; }
      if (exponent > maximum) {
        if (overflow === 'deny') deny('INVALID_LITERAL', 'IEEE literal is outside finite range');
        exponentField = (1n << BigInt(exponentBits)) - 1n;
      } else { exponentField = BigInt(exponent + bias); fraction = significand - (1n << BigInt(fractionBits)); }
    }
  }
  const sign = negative ? 1n << BigInt(width - 1) : 0n;
  return (sign | exponentField << BigInt(fractionBits) | fraction).toString(16).padStart(width / 4, '0');
}

export function checkedCsharpUnaryLiteral(decoded, unary, counter) {
  if (unary.kind !== 'unary' || !['+', '-'].includes(unary.operation) || unary.operand.kind !== 'literal')
    deny('INVALID_LITERAL', 'direct C# unary numeric literal occurrence required', unary.origin);
  const token = unary.operand.token;
  const scanner = new SelectedScanner(decoded.raw, 'csharp', counter); scanner.at = unary.origin.utf16[0];
  const operator = scanner.next(), actualToken = scanner.next();
  if (operator.spelling !== unary.operation || actualToken.kind !== 'number' ||
      actualToken.origin.utf16[0] !== token.origin.utf16[0] || actualToken.origin.utf16[1] !== token.origin.utf16[1])
    deny('INVALID_LITERAL', 'unary literal is not the immediate original token', unary.origin);
  const literal = checkedOriginalLiteral(decoded, token, 'csharp', counter);
  if (unary.operation === '+') return literal;
  if (literal.term.sort?.kind === 'BV') {
    const value = BigInt(literal.term.value), suffix = /[uUlL]+$/u.exec(token.spelling)?.[0].toLowerCase() ?? '';
    if (value === 2147483648n && !suffix) return { type: 'Int32', term: constant(bv(32, true), '-2147483648') };
    if (value === 9223372036854775808n && ['', 'l'].includes(suffix))
      return { type: 'Int64', term: constant(bv(64, true), '-9223372036854775808') };
    if (!literal.term.sort.signed && literal.term.sort.width === 64)
      deny('INVALID_LITERAL', 'ordinary unary minus has no UInt64 operator', unary.origin);
    const width = literal.term.sort.signed ? literal.term.sort.width : 64;
    return { type: `Int${width}`, term: constant(bv(width, true), (-value).toString()) };
  }
  if (['F32', 'F64'].includes(literal.term.sort)) {
    const width = literal.term.sort === 'F32' ? 32 : 64;
    return { type: literal.type, term: constant(literal.term.sort,
      (BigInt('0x' + literal.term.value) ^ 1n << BigInt(width - 1)).toString(16).padStart(width / 4, '0')) };
  }
  if (literal.term.sort === 'Decimal') return { type: 'Decimal', term: constant('Decimal',
    { ...literal.term.value, negative: !literal.term.value.negative }) };
  deny('INVALID_LITERAL', 'unary numeric literal has incompatible resolved scalar type', unary.origin);
}

function stringUnits(spelling, language, kind, origin, counter) {
  let at = 0, verbatim = false;
  if (language === 'csharp' && spelling.startsWith('@"')) { verbatim = true; at++; }
  if (language === 'c' && spelling.startsWith('L')) at++;
  const quote = spelling[at++], end = spelling.length - 1, units = [];
  const emit = (...values) => { for (const value of values) { counter.charge('maxInvariantSteps', 'literal-unit'); units.push(value); } };
  if (!['"', "'"].includes(quote) || spelling[end] !== quote) deny('INVALID_LITERAL', 'literal delimiter mismatch', origin);
  while (at < end) {
    let character = spelling[at++];
    if (verbatim || language === 'powershell' && quote === "'") {
      if (character === quote) {
        if (spelling[at++] !== quote) deny('INVALID_LITERAL', 'unpaired doubled literal quote', origin);
      }
      emit(character.charCodeAt(0)); continue;
    }
    const escape = language === 'powershell' ? '`' : '\\';
    if (character !== escape) {
      if (language === 'powershell' && quote === '"' && character === '$')
        deny('UNBOUND_OCCURRENCE', 'expandable PowerShell string requires its actual interpolation tree', origin);
      emit(character.charCodeAt(0)); continue;
    }
    if (at >= end) deny('INVALID_LITERAL', 'unfinished original escape', origin);
    character = spelling[at++];
    if (language === 'javascript' && /[\r\n\u2028\u2029]/u.test(character)) {
      if (character === '\r' && spelling[at] === '\n') at++;
      continue;
    }
    if (language === 'powershell') {
      const ps = { '0': 0, a: 7, b: 8, e: 27, f: 12, n: 10, r: 13, t: 9, v: 11 };
      emit(Object.hasOwn(ps, character) ? ps[character] : character.charCodeAt(0)); continue;
    }
    if (language === 'c' && /[0-7]/u.test(character)) {
      let digits = character;
      while (digits.length < 3 && /[0-7]/u.test(spelling[at] ?? '')) digits += spelling[at++];
      emit(Number(BigInt('0o' + digits))); continue;
    }
    if (Object.hasOwn(simpleEscapes, character) && !(language === 'javascript' && character === 'a')) {
      if (language === 'javascript' && character === '0' && /[0-9]/u.test(spelling[at] ?? ''))
        deny('INVALID_LITERAL', 'legacy octal escape is excluded in selected strict JavaScript', origin);
      emit(simpleEscapes[character]); continue;
    }
    if (language === 'javascript' && character === 'u' && spelling[at] === '{') {
      at++; let value = 0, count = 0;
      while (at < end && /[0-9a-fA-F]/u.test(spelling[at])) { value = value * 16 + Number.parseInt(spelling[at++], 16); count++; }
      if (!count || count > 6 || spelling[at++] !== '}' || value > 0x10ffff) deny('INVALID_LITERAL', 'invalid original JavaScript Unicode scalar escape', origin);
      if (value <= 0xffff) emit(value);
      else { const scalar = value - 0x10000; emit(0xd800 + (scalar >> 10), 0xdc00 + (scalar & 1023)); }
      continue;
    }
    if (['x', 'u'].includes(character) || ['c', 'csharp'].includes(language) && character === 'U') {
      const count = character === 'u' ? 4 : character === 'U' ? 8 : null;
      const maximum = count ?? (language === 'csharp' ? 4 : language === 'javascript' ? 2 : Infinity);
      let digits = '';
      while (digits.length < maximum && at < end && /[0-9a-fA-F]/u.test(spelling[at])) digits += spelling[at++];
      if (!digits.length || count !== null && digits.length !== count || language === 'javascript' && character === 'x' && digits.length !== 2)
        deny('INVALID_LITERAL', 'original hex escape extent differs', origin);
      const value = BigInt('0x' + digits);
      if (value > 0x10ffffn || character !== 'U' && value > 0xffffn) deny('INVALID_LITERAL', 'original escape exceeds selected code-unit range', origin);
      if (character === 'U' && value >= 0xd800n && value <= 0xdfffn) deny('INVALID_LITERAL', 'Unicode scalar escape denotes a surrogate', origin);
      if (value <= 0xffffn) emit(Number(value));
      else { const scalar = value - 0x10000n; emit(Number(0xd800n + (scalar >> 10n)), Number(0xdc00n + (scalar & 1023n))); }
      continue;
    }
    if (language === 'javascript' && !/[0-9ux]/u.test(character)) { emit(character.charCodeAt(0)); continue; }
    if (language === 'c' && character === '?') { emit(63); continue; }
    deny('INVALID_LITERAL', 'escape outside selected literal profile', origin);
  }
  if (kind === 'char' && units.length !== 1) deny('INVALID_LITERAL', 'character literal requires one selected UTF16 unit', origin);
  return units;
}

export function checkedOriginalLiteral(decoded, token, language, counter, cCharSigned = true) {
  const start = token.origin?.utf16?.[0], end = token.origin?.utf16?.[1];
  if (JSON.stringify(decoded.origin(start, end)) !== JSON.stringify(token.origin) || decoded.text.slice(start, end) !== token.spelling)
    deny('VALUE_PROVENANCE', 'literal does not denote the actual original source occurrence', token.origin);
  const spelling = token.spelling;
  if (spelling === 'true' || spelling === 'false') return { type: 'Boolean', term: constant('Bool', spelling === 'true') };
  if (spelling === 'null') return { type: 'Null', term: constant('AllocId', null) };
  if (['string', 'char'].includes(token.kind)) {
    const units = stringUnits(spelling, language, token.kind, token.origin, counter);
    if (token.kind === 'string') {
      if (language === 'c' && !spelling.startsWith('L')) {
        if (units.some(unit => unit > 255)) deny('INVALID_LITERAL', 'narrow C string exceeds selected byte encoding', token.origin);
        return { type: 'CNarrowString', term: constant('Bytes', units) };
      }
      let value = '';
      for (let index = 0; index < units.length; index += 1024) value += String.fromCharCode(...units.slice(index, index + 1024));
      return { type: language === 'c' ? 'CWideString' : 'String', term: constant('UTF16', value) };
    }
    if (language === 'c' && !spelling.startsWith('L')) {
      if (units[0] > 255) deny('INVALID_LITERAL', 'narrow C character exceeds selected byte', token.origin);
      return { type: 'CInt', term: constant(bv(32, true), String(cCharSigned && units[0] >= 128 ? units[0] - 256 : units[0])) };
    }
    return { type: 'Char', term: constant(bv(16, false), String(units[0])) };
  }
  if (token.kind !== 'number') deny('INVALID_LITERAL', 'source literal lacks a closed typed alternative', token.origin);
  const hex = /^0[xX]/u.test(spelling);
  // Hex digit F/D are digits, not a floating suffix. Integral suffix extraction
  // therefore has a distinct lexical production.
  const integralSuffix = (language === 'c' ? /(?:[uU]?[iI]64|[uUlL]+)$/u : /[uUlL]+$/u).exec(spelling)?.[0] ?? '';
  const floating = !hex && (/[.eE]/u.test(spelling) || /[fFdDmM]$/u.test(spelling));
  for (let index = 0; index < spelling.length; index++) counter.charge('maxInvariantSteps', `literal-digit:${index}`);
  if (spelling.length > 10000) deny('EXHAUSTED', 'selected literal representation bound exceeded', token.origin);
  if (language === 'javascript') {
    if (integralSuffix || !hex && /[fFdDmM]$/u.test(spelling)) deny('INVALID_LITERAL', 'ECMAScript Number literal has no CLR suffix', token.origin);
    const [numerator, denominator] = hex ? [BigInt(spelling), 1n] : decimalRational(spelling, token.origin);
    return { type: 'Number', term: constant('F64', ieeeLiteralBits(numerator, denominator, 64, false, 'infinity')) };
  }
  if (floating) {
    if (language === 'c') deny('INVALID_LITERAL', 'bootstrap finite C profile excludes floating literal', token.origin);
    const floatSuffix = /[fFdDmM]$/u.exec(spelling)?.[0] ?? '', body = floatSuffix ? spelling.slice(0, -1) : spelling;
    const [numerator, denominator] = decimalRational(body, token.origin);
    if (floatSuffix.toLowerCase() === 'm') {
      if (language !== 'csharp') deny('INVALID_LITERAL', 'Decimal suffix requires selected C# profile', token.origin);
      let coefficient = numerator, scale = 0, divisor = denominator;
      while (divisor > 1n) { divisor /= 10n; scale++; }
      const originalCoefficient = coefficient, originalScale = scale;
      let discarded = Math.max(0, scale - 28);
      coefficient = roundQuotient(originalCoefficient, 10n ** BigInt(discarded)); scale = originalScale - discarded;
      while (coefficient >= 1n << 96n && scale > 0) {
        discarded++; scale = originalScale - discarded;
        coefficient = roundQuotient(originalCoefficient, 10n ** BigInt(discarded));
      }
      if (coefficient >= 1n << 96n || scale < 0) deny('INVALID_LITERAL', 'Decimal literal exceeds CLR extent', token.origin);
      return { type: 'Decimal', term: constant('Decimal', { coefficient: coefficient.toString(), scale, negative: false }) };
    }
    const width = floatSuffix.toLowerCase() === 'f' ? 32 : 64;
    return { type: width === 32 ? 'Single' : 'Double', term: constant(width === 32 ? 'F32' : 'F64', ieeeLiteralBits(numerator, denominator, width)) };
  }
  const body = integralSuffix ? spelling.slice(0, -integralSuffix.length) : spelling;
  if (!/^(?:0[xX][0-9a-fA-F]+|[0-9]+)$/u.test(body)) deny('INVALID_LITERAL', 'invalid selected integer spelling', token.origin);
  const value = language === 'c' && /^0[0-9]+$/u.test(body) ? /^0[0-7]+$/u.test(body) ? BigInt('0o' + body.slice(1))
    : deny('INVALID_LITERAL', 'invalid C octal digit', token.origin) : BigInt(body);
  const suffixLower = integralSuffix.toLowerCase();
  if (language === 'c' && /lL|Ll/u.test(integralSuffix))
    deny('INVALID_LITERAL', 'C long-long suffix must be ll or LL', token.origin);
  if (!(language === 'c' ? /^(?:u|l|ll|ul|ull|lu|llu|i64|ui64)?$/u : /^(?:u|l|ul|lu)?$/u).test(suffixLower))
    deny('INVALID_LITERAL', 'invalid integral suffix', token.origin);
  let candidates;
  if (language === 'c') {
    const unsigned = suffixLower.includes('u'), longLong = suffixLower.includes('ll'), nondecimal = hex || /^0[0-9]+$/u.test(body);
    candidates = suffixLower.includes('i64') ? [[64, !unsigned, 'LongLong']]
      : longLong ? unsigned ? [[64, false, 'LongLong']] : nondecimal ? [[64, true, 'LongLong'], [64, false, 'LongLong']] : [[64, true, 'LongLong']]
      : suffixLower.includes('l') ? unsigned ? [[32, false, 'Long'], [64, false, 'LongLong']]
        : nondecimal ? [[32, true, 'Long'], [32, false, 'Long'], [64, true, 'LongLong'], [64, false, 'LongLong']] : [[32, true, 'Long'], [64, true, 'LongLong']]
      : unsigned ? [[32, false, 'Int'], [32, false, 'Long'], [64, false, 'LongLong']]
        : nondecimal ? [[32, true, 'Int'], [32, false, 'Int'], [32, true, 'Long'], [32, false, 'Long'], [64, true, 'LongLong'], [64, false, 'LongLong']]
        : [[32, true, 'Int'], [32, true, 'Long'], [64, true, 'LongLong']];
  } else if (language === 'powershell') {
    if (!['', 'l'].includes(suffixLower)) deny('INVALID_LITERAL', 'PowerShell numeric profile excludes unsigned suffix', token.origin);
    candidates = suffixLower === 'l' ? [[64, true]] : [[32, true], [64, true]];
  } else candidates = suffixLower.includes('l') ? suffixLower.includes('u') ? [[64, false]] : [[64, true], [64, false]]
    : suffixLower.includes('u') ? [[32, false], [64, false]] : [[32, true], [32, false], [64, true], [64, false]];
  const selected = candidates.find(([width, signed]) => value < 1n << BigInt(width - (signed ? 1 : 0)));
  if (!selected) deny('INVALID_LITERAL', 'integer literal exceeds admitted rank table', token.origin);
  return { type: language === 'c' ? `C${selected[1] ? '' : 'Unsigned'}${selected[2]}` : `${selected[1] ? 'Int' : 'UInt'}${selected[0]}`,
    term: constant(bv(selected[0], selected[1]), value.toString()) };
}

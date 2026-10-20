// SPEC-002 AC-4DI.4/R3/C3. Pure source foundation; no file/process/native effects.
const sourceDenialCodes = new WeakMap();
export class SourceDenial extends Error {
  constructor(code, detail, origin = null) {
    super(`${code}: ${detail}`);
    sourceDenialCodes.set(this, code);
    this.name = 'SourceDenial'; this.code = code; this.origin = origin;
  }
}
// Classification observes only this module's actual constructed denial. It
// neither reads an opaque thrown object's properties nor trusts a copied code.
export function isSourceDenialCode(original, code) {
  return sourceDenialCodes.has(original) && sourceDenialCodes.get(original) === code;
}
export function originalSourceDenialCode(original) { return sourceDenialCodes.get(original); }
export function deny(code, detail, origin) { throw new SourceDenial(code, detail, origin); }
export function exactKeys(value, keys, label) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) {
    deny('INVALID_INPUT', `${label} requires exactly ${keys.join(',')}`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key)))
    deny('INVALID_INPUT', `${label} requires exactly ${keys.join(',')}`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true)
      deny('INVALID_INPUT', `${label} requires own enumerable data members`);
  }
}

// Decode every byte ourselves. Retain BOM and CRLF; reject overlong, surrogate,
// truncated and out-of-range encodings. Interior UTF16 surrogate offsets have no
// byte endpoint and therefore cannot be used as source range boundaries.
const decoderOccurrences = new WeakMap();
export function createOriginalDecoderOccurrence() {
  const token = Object.freeze({});
  decoderOccurrences.set(token, { issued: false, returned: false, failed: false });
  return token;
}
export function copyOriginalDecoderObservation(token) {
  const owner = decoderOccurrences.get(token);
  if (!owner) deny('INVALID_BINDING', 'decoder observation requires original custody');
  return { phase: owner.phase, returned: owner.returned, failed: owner.failed, original: owner.original,
    offset: owner.offset, scalar: owner.scalar, text: owner.text, pendingStart: owner.pendingStart,
    raw: owner.raw ? Uint8Array.from(owner.raw) : undefined,
    byteAt: owner.byteAt?.slice(), scalarAt: owner.scalarAt?.slice() };
}
export function decodeOriginal(bytes, token) {
  const owner = token === undefined ? undefined : decoderOccurrences.get(token);
  if (token !== undefined && (!owner || owner.issued)) deny('INVALID_BINDING', 'decoder occurrence is original and once-only');
  if (owner) { owner.issued = true; owner.input = bytes; owner.phase = 'inputValidation'; }
  try {
  if (!(bytes instanceof Uint8Array)) deny('INVALID_INPUT', 'raw bytes required');
  if (owner) owner.phase = 'rawCopy';
  const raw = Uint8Array.from(bytes);
  if (owner) { owner.raw = raw; owner.phase = 'byteMapAllocation'; }
  const byteAt = [0];
  if (owner) { owner.byteAt = byteAt; owner.phase = 'scalarMapAllocation'; }
  const scalarAt = [0];
  if (owner) { owner.scalarAt = scalarAt; owner.phase = 'decoding'; owner.text = ''; owner.offset = 0; owner.scalar = 0; }
  let text = '', offset = 0, scalar = 0;
  while (offset < raw.length) {
    const start = offset, lead = raw[offset++];
    if (owner) { owner.pendingStart = start; owner.offset = offset; }
    let value, remaining, minimum;
    if (lead < 0x80) { value = lead; remaining = 0; minimum = 0; }
    else if (lead >= 0xc2 && lead <= 0xdf) { value = lead & 31; remaining = 1; minimum = 0x80; }
    else if (lead >= 0xe0 && lead <= 0xef) { value = lead & 15; remaining = 2; minimum = 0x800; }
    else if (lead >= 0xf0 && lead <= 0xf4) { value = lead & 7; remaining = 3; minimum = 0x10000; }
    else deny('INVALID_ENCODING', `invalid UTF8 lead at byte ${start}`);
    for (let n = 0; n < remaining; n++) {
      if (offset === raw.length || (raw[offset] & 0xc0) !== 0x80) deny('INVALID_ENCODING', `invalid continuation at byte ${offset}`);
      value = value * 64 + (raw[offset++] & 63);
      if (owner) owner.offset = offset;
    }
    if (value < minimum || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) deny('INVALID_ENCODING', `invalid scalar at byte ${start}`);
    text += String.fromCodePoint(value); scalar++;
    if (owner) { owner.text = text; owner.offset = offset; owner.scalar = scalar; }
    if (value > 0xffff) { byteAt.push(null); scalarAt.push(null); }
    byteAt.push(offset); scalarAt.push(scalar);
  }
  function origin(start, end) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start ||
        end > text.length || byteAt[start] === null || byteAt[end] === null) deny('INVALID_ORIGIN', 'range splits a scalar or exceeds original input');
    return { kind: 'source', byte: [byteAt[start], byteAt[end]], utf16: [start, end],
      rawRanges: [[byteAt[start], byteAt[end]]], mapped: false };
  }
  const result = { raw, text, byteAt, scalarAt, bom: text.charCodeAt(0) === 0xfeff, origin };
  if (owner) { owner.result = result; owner.returned = true; owner.phase = 'returned'; }
  return result;
  } catch (original) { if (owner) { owner.original = original; owner.failed = true; } throw original; }
}

const multi = ['>>>=', '===', '!==', '>>>', '<<=', '>>=', '**=', '??=', '&&=', '||=',
  '=>', '==', '!=', '<=', '>=', '++', '--', '&&', '||', '??', '?.', '+=', '-=', '*=', '/=', '%=',
  '<<', '>>', '**', '&=', '|=', '^=', '...'];
const first = ch => /[A-Za-z_$]/.test(ch);
const rest = ch => /[A-Za-z0-9_$]/.test(ch);
// ASCII identifiers are the currently supported finite subprofile. Other source
// identifiers, regex/template strings and preprocessing are explicit denials.
const lexerOccurrences = new WeakMap();
export function createOriginalLexerOccurrence() {
  const token = Object.freeze({});
  lexerOccurrences.set(token, { issued: false, returned: false, failed: false });
  return token;
}
export function copyOriginalLexerObservation(token) {
  const owner = lexerOccurrences.get(token);
  if (!owner) deny('INVALID_BINDING', 'lexer observation requires original custody');
  return { returned: owner.returned, failed: owner.failed, original: owner.original,
    tokens: structuredClone(owner.tokens ?? []), trivia: structuredClone(owner.trivia ?? []) };
}
export function lexOriginal(decoded, language, token) {
  const owner = token === undefined ? undefined : lexerOccurrences.get(token);
  if (token !== undefined && (!owner || owner.issued)) deny('INVALID_BINDING', 'lexer occurrence is original and once-only');
  if (owner) { owner.issued = true; owner.decoded = decoded; owner.language = language; }
  try {
  if (!['javascript', 'csharp'].includes(language)) deny('UNSUPPORTED_FRONTEND', language);
  const { text, origin } = decoded, tokens = [], trivia = [];
  if (owner) { owner.tokens = tokens; owner.trivia = trivia; }
  // C# Zs/TAB/VT/FF and its five newline characters are independent from
  // ECMAScript WhiteSpace. In particular interior FEFF is a formatting
  // character, never a keyword/name separator in the supported ASCII profile.
  const whitespace = language === 'csharp'
    ? ch => /[\u0009\u000b\u000c\u0020\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\r\n\u0085\u2028\u2029]/u.test(ch)
    : ch => /\s/u.test(ch);
  let at = decoded.bom ? 1 : 0;
  if (decoded.bom) trivia.push({ kind: 'bom', origin: origin(0, 1) });
  function emit(kind, start) { tokens.push({ kind, value: text.slice(start, at), origin: origin(start, at) }); }
  while (at < text.length) {
    const start = at, ch = text[at];
    if (whitespace(ch)) { while (at < text.length && whitespace(text[at])) at++; trivia.push({ kind: 'space', origin: origin(start, at) }); continue; }
    if (text.startsWith('//', at)) {
      at += 2;
      while (at < text.length && !(language === 'javascript' ? /[\r\n\u2028\u2029]/ : /[\r\n\u0085\u2028\u2029]/).test(text[at])) at++;
      trivia.push({ kind: 'comment', origin: origin(start, at) }); continue;
    }
    if (text.startsWith('/*', at)) { const end = text.indexOf('*/', at + 2); if (end < 0) deny('INCOMPLETE_INPUT', 'unterminated comment', origin(start, text.length)); at = end + 2; trivia.push({ kind: 'comment', origin: origin(start, at) }); continue; }
    if (ch === '#' || ch === '`' || (language === 'csharp' && (ch === '@' || ch === '$'))) deny('UNSUPPORTED_SYNTAX', 'preprocessor/template/verbatim/interpolated source', origin(start, start + 1));
    if (first(ch)) { at++; while (at < text.length && rest(text[at])) at++; emit('identifier', start); continue; }
    if (/[0-9]/.test(ch)) {
      at++; while (at < text.length && /[A-Za-z0-9_.]/.test(text[at])) at++;
      const value = text.slice(start, at);
      const valid = language === 'javascript'
        ? /^(?:0[xX][0-9a-fA-F]+|(?:0|[1-9][0-9]*)(?:\.[0-9]+)?)$/.test(value)
        : /^(?:0[xX][0-9a-fA-F]+(?:[uU][lL]?|[lL][uU]?)?|[0-9]+(?:[uU][lL]?|[lL][uU]?)?|[0-9]+(?:\.[0-9]+)?[fFdDmM]|[0-9]+\.[0-9]+)$/.test(value);
      if (!valid) deny('UNSUPPORTED_SYNTAX', `${language} numeric literal ${value}`, origin(start, at));
      emit('number', start); continue;
    }
    if (ch === '"' || ch === "'") {
      at++; let closed = false, decodedUnits = 0;
      while (at < text.length) {
        const current = text[at++];
        if (current === ch) { closed = true; break; }
        if ((language === 'csharp' ? /[\r\n\u0085\u2028\u2029]/ : /[\r\n]/).test(current)) deny('INVALID_SYNTAX', 'newline in quoted literal', origin(start, at));
        if (current === '\\') {
          if (at === text.length) break;
          const escaped = text[at++];
          const simple = language === 'csharp' ? '\\\'"0abfnrtv' : '\\\'"0bfnrtv';
          if (escaped === '0' && /[0-9]/.test(text[at] ?? '')) deny('UNSUPPORTED_SYNTAX', 'numeric/octal string escape', origin(start, at));
          if (!simple.includes(escaped)) {
            const width = escaped === 'u' ? 4 : escaped === 'x' && language === 'javascript' ? 2 : 0;
            if (!width || !new RegExp(`^[0-9a-fA-F]{${width}}$`).test(text.slice(at, at + width))) deny('UNSUPPORTED_SYNTAX', 'literal escape', origin(start, at));
            at += width;
          }
          decodedUnits++;
        } else decodedUnits++;
      }
      if (!closed) deny('INCOMPLETE_INPUT', 'unterminated literal', origin(start, text.length));
      if (language === 'csharp' && ch === "'" && decodedUnits !== 1) deny('INVALID_SYNTAX', 'C# char literal requires exactly one UTF16 unit', origin(start, at));
      emit('string', start); continue;
    }
    const operator = multi.find(value => text.startsWith(value, at));
    if (operator) { at += operator.length; emit('punctuation', start); continue; }
    if ('{}[]();,.:?+-*/%=!~<>&|^'.includes(ch)) { at++; emit('punctuation', start); continue; }
    deny('UNSUPPORTED_SYNTAX', `unrecognized original character ${ch}`, origin(start, start + 1));
  }
  tokens.push({ kind: 'eof', value: '<eof>', origin: origin(at, at) });
  // Coverage checks trivia as well as tokens: hidden trailing bytes cannot vanish.
  const ranges = [...tokens.slice(0, -1), ...trivia].map(row => row.origin.byte).sort((a, b) => a[0] - b[0]);
  let end = 0;
  for (const range of ranges) { if (range[0] !== end) deny('INCOMPLETE_INPUT', 'lexer coverage gap/overlap'); end = range[1]; }
  if (end !== decoded.raw.length) deny('INCOMPLETE_INPUT', 'lexer did not consume raw EOF');
  const result = { tokens, trivia, consumedBytes: end };
  if (owner) { owner.result = result; owner.returned = true; }
  return result;
  } catch (original) { if (owner) { owner.original = original; owner.failed = true; } throw original; }
}

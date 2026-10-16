import { deny, copyOriginalDecoderObservation, createOriginalDecoderOccurrence } from './core1681-source-input.mjs';
import { SelectedScanner } from './core1681-selected-scanner.mjs';
import { requireProofCounter } from './core1681-proof-terms.mjs';

const preprocessingOccurrences = new WeakMap();
const scannerConstructionOccurrences = new WeakMap();
export function createSelectedCPreprocessingOccurrence(counter) {
  requireProofCounter(counter);
  counter.charge('maxInvariantSteps', 'c-preprocessing-occurrence');
  const token = Object.freeze({});
  preprocessingOccurrences.set(token, { counter, issued: false, directives: [], returned: false, failed: false });
  return token;
}
export function copySelectedCPreprocessingObservation(token) {
  const owner = preprocessingOccurrences.get(token);
  if (!owner) deny('INVALID_BINDING', 'C preprocessing observation requires original custody');
  const pending = item => item ? { kind: item.kind, spelling: item.spelling, origin: structuredClone(item.origin) } : null;
  return { returned: owner.returned, failed: owner.failed, original: owner.original,
    decoder: owner.decoder ? copyOriginalDecoderObservation(owner.decoder) : undefined,
    pendingTokenOriginal: pending(owner.pendingTokenOriginal),
    pendingRunOriginal: owner.pendingRunOriginal?.map(pending) ?? null,
    scanner: owner.scanner ? { cursor: owner.scanner.at, effectiveText: owner.scanner.text,
      phaseTwoCursor: owner.scanner.phaseTwoCursor, phaseTwoPhysicalLine: owner.scanner.phaseTwoPhysicalLine,
      phaseTwoCharacters: scannerConstructionOccurrences.get(owner.scannerConstructionToken)?.characters?.slice(),
      originalAt: owner.scanner.originalAt?.slice(), physicalLineAt: owner.scanner.physicalLineAt?.slice() } : null,
    directives: owner.directives.map(row => ({ name: row.name?.spelling, origin: structuredClone(row.origin),
      returned: row.returned, failed: row.failed, original: row.original })),
    sourceAdmission: false, nativeAuthority: false };
}

const includeNames = new Set(['windows.h', 'bcrypt.h', 'stdio.h', 'wchar.h', 'stdlib.h']);

// C phase two is a source transform with explicit original ranges. It never
// reads include files or invokes a compiler/preprocessor from the environment.
export class SelectedCScanner extends SelectedScanner {
  constructor(rawBytes, counter, decoderOccurrence, constructionToken) {
    const construction = constructionToken === undefined ? undefined : scannerConstructionOccurrences.get(constructionToken);
    if (constructionToken !== undefined && (!construction || construction.entered || construction.counter !== counter ||
        construction.rawBytes !== rawBytes || construction.decoder !== decoderOccurrence))
      deny('INVALID_BINDING', 'C scanner requires original once-only construction custody');
    if (construction) construction.entered = true;
    super(rawBytes, 'c', counter, decoderOccurrence);
    if (construction) construction.owner.scanner = this;
    this.originalAt = []; this.physicalLineAt = []; const characters = [];
    if (construction) construction.characters = characters;
    let physicalLine = 1;
    for (let index = 0; index < this.decoded.text.length;) {
      this.phaseTwoCursor = index; this.phaseTwoPhysicalLine = physicalLine;
      counter.charge('maxInvariantSteps', `c-phase2:${index}`);
      if (this.decoded.text[index] === '\\' && ['\r', '\n'].includes(this.decoded.text[index + 1])) {
        physicalLine++;
        index += this.decoded.text[index + 1] === '\r' && this.decoded.text[index + 2] === '\n' ? 3 : 2;
        continue;
      }
      this.originalAt.push(index); this.physicalLineAt.push(physicalLine);
      const character = this.decoded.text[index];
      if (character === '\r' || character === '\n' && this.decoded.text[index - 1] !== '\r') physicalLine++;
      characters.push(this.decoded.text[index++]);
    }
    this.phaseTwoCursor = this.decoded.text.length; this.phaseTwoPhysicalLine = physicalLine;
    this.text = characters.join(''); this.physicalEndLine = physicalLine;
  }
  origin(start, end = this.at) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > this.text.length)
      deny('INVALID_ORIGIN', 'C logical source range is invalid');
    if (start === end) { const at = this.originalAt[start] ?? this.decoded.text.length; return this.decoded.origin(at, at); }
    const ranges = []; let begin = this.originalAt[start], finish = begin;
    for (let index = start; index < end; index++) {
      const original = this.originalAt[index];
      if (original !== finish) { ranges.push(this.decoded.origin(begin, finish)); begin = original; }
      finish = original + 1;
    }
    ranges.push(this.decoded.origin(begin, finish));
    const result = this.decoded.origin(ranges[0].utf16[0], ranges.at(-1).utf16[1]);
    if (ranges.length === 1) return result;
    return { ...result, rawRanges: ranges.map(range => range.byte), mapped: true,
      transform: 'C-PHASE2', effectiveRange: [start, end] };
  }
  token(kind, start, extras = {}) {
    return { ...super.token(kind, start, extras), logicalRange: [start, this.at] };
  }
  next(goal = 'division') {
    if (!['division', 'regexp'].includes(goal)) deny('INVALID_INPUT', 'unknown lexical goal');
    this.skipTrivia();
    const start = this.at, character = this.text[start] ?? '';
    // Preprocessing numbers deliberately include spellings that are not valid
    // numeric constants. Literal validation belongs to the later judgement.
    if (/[0-9]/u.test(character) || character === '.' && /[0-9]/u.test(this.text[start + 1] ?? '')) {
      while (this.at < this.text.length) {
        const current = this.text[this.at];
        if (!/[A-Za-z_0-9.]/u.test(current) &&
            !(['+', '-'].includes(current) && /[eEpP]/u.test(this.text[this.at - 1] ?? ''))) break;
        this.counter.charge('maxInvariantSteps', `c-preprocessing-number:${this.at}`);
        this.at++;
      }
      return this.token('number', start);
    }
    return super.next(goal);
  }
}

function sameReplacement(left, right) {
  return left.parameters?.join('\0') === right.parameters?.join('\0') &&
    left.tokens.length === right.tokens.length && left.tokens.every((token, index) => token.kind === right.tokens[index].kind && token.spelling === right.tokens[index].spelling);
}

function targetVersion(macro, counter) {
  if (!macro || macro.parameters !== null || macro.tokens.length !== 1 || macro.tokens[0].kind !== 'number') return false;
  const spelling = macro.tokens[0].spelling;
  for (let index = 0; index < spelling.length; index++) counter.charge('maxInvariantSteps', `c-target-literal:${index}`);
  if (spelling.length > 10000) deny('EXHAUSTED', 'C target literal representation bound exceeded', macro.origin);
  const match = /^(0[xX][0-9a-fA-F]+|0[0-7]*|[1-9][0-9]*)([uUlL]*)$/u.exec(spelling);
  if (!match || !/^(?:u|l|ll|ul|ull|lu|llu)?$/u.test(match[2].toLowerCase())) return false;
  const body = match[1], value = /^0[0-7]+$/u.test(body) ? BigInt('0o' + body.slice(1)) : BigInt(body);
  return value === 1537n;
}

export function preprocessSelectedC(rawBytes, counter, token, decoderOccurrence) {
  const owner = token === undefined ? undefined : preprocessingOccurrences.get(token);
  if (token !== undefined && (!owner || owner.issued || owner.counter !== counter))
    deny('INVALID_BINDING', 'C preprocessing requires its once-only original counter occurrence');
  if (owner) { owner.issued = true; owner.rawInput = rawBytes; }
  try {
  const macros = new Map(), undefinedNames = new Map(), macroSaves = new Map(), directives = [], output = [], expansions = [], expansionStreams = [], conditionals = [], conditionalStack = [], skipped = [];
  if (owner) { owner.macros = macros; owner.undefinedNames = undefinedNames; owner.interpreted = directives;
    owner.output = output; owner.expansions = expansions; owner.expansionStreams = expansionStreams; owner.conditionals = conditionals; owner.conditionalStack = conditionalStack; owner.skipped = skipped; owner.macroSaves = macroSaves; }
  if (owner) {
    if (decoderOccurrence === undefined) decoderOccurrence = createOriginalDecoderOccurrence();
    owner.decoder = decoderOccurrence;
  }
  let constructionToken;
  if (owner) {
    owner.scannerConstructionAttempted = true;
    constructionToken = Object.freeze({}); owner.scannerConstructionToken = constructionToken;
    scannerConstructionOccurrences.set(constructionToken, { owner, counter, rawBytes, decoder: decoderOccurrence, entered: false });
  }
  const scanner = new SelectedCScanner(rawBytes, counter, decoderOccurrence, constructionToken);
  if (owner) owner.scannerConstructionReturned = true;
  if (owner) owner.scanner = scanner;
  const sourceLines = [{ effectiveOffset: 0, physicalBase: 1, presumedBase: 1,
    filenameTokenOriginal: null, directiveOriginal: null }];
  if (owner) owner.sourceLines = sourceLines;
  const sourcePosition = item => {
    counter.charge('maxInvariantSteps', 'c-presumed-source-position');
    const position = item.logicalRange[0];
    let segment = sourceLines.at(-1);
    for (let index = sourceLines.length - 1; index >= 0; index--) {
      counter.charge('maxInvariantSteps', 'c-presumed-source-segment');
      if (sourceLines[index].effectiveOffset <= position) { segment = sourceLines[index]; break; }
    }
    const physicalLine = scanner.physicalLineAt[position] ?? scanner.physicalEndLine;
    return { physicalLine, presumedLine: segment.presumedBase + physicalLine - segment.physicalBase,
      filenameTokenOriginal: segment.filenameTokenOriginal, mappingOriginal: segment,
      compilerEmissionOriginal: null, nativeAuthority: false };
  };
  let current = null, prior = null;
  const peek = () => current ??= scanner.next();
  const consume = () => {
    const token = peek();
    if (owner) owner.pendingTokenOriginal = token;
    current = null; token.sourcePositionOriginal = sourcePosition(token);
    if (owner) owner.pendingTokenOriginal = null;
    return token;
  };
  const line = position => Math.max(scanner.text.lastIndexOf('\n', position - 1), scanner.text.lastIndexOf('\r', position - 1));
  const rawToken = token => ({ kind: token.kind, spelling: token.spelling, origin: token.origin,
    logicalRange: token.logicalRange, sourcePositionOriginal: token.sourcePositionOriginal, ...(token.stringizingSpaceBefore !== undefined ? { stringizingSpaceBefore: token.stringizingSpaceBefore } : {}),
    ...(token.disabledMacros ? { disabledMacros: token.disabledMacros } : {}),
    ...(token.expansion ? { expansion: token.expansion } : {}) });
  const expand = (tokens, disabled = new Set(), expansionDepth = 0) => {
    if (expansionDepth > 128) deny('EXHAUSTED', 'C macro expansion depth exceeded');
    const expanded = [];
    const stream = { inputOriginal: tokens, nodes: [], output: expanded, returned: false, failed: false };
    expansionStreams.push(stream);
    const nodeFor = (token, contexts = []) => {
      counter.charge('maxInvariantSteps', 'c-rescan-node');
      const node = { token, contexts: Object.freeze([...contexts]), next: null }; stream.nodes.push(node); return node;
    };
    let cursor = null, lastInput = null;
    try {
    for (const token of tokens) {
      const node = nodeFor(token);
      if (lastInput) lastInput.next = node; else cursor = node;
      lastInput = node;
    }
    stream.headOriginal = cursor;
    while (cursor) {
      counter.charge('maxInvariantSteps', 'c-rescan-step');
      stream.cursorOriginal = cursor;
      const node = cursor, token = node.token, macro = token.kind === 'identifier' ? macros.get(token.spelling) : null;
      cursor = node.next;
      if (macro && (disabled.has(token.spelling) || node.contexts.includes(token.spelling) || token.disabledMacros?.includes(token.spelling))) {
        counter.charge('maxTokens', 'c-disabled-macro-token');
        const disabledMacros = new Set(token.disabledMacros ?? []);
        for (const name of disabled) disabledMacros.add(name);
        for (const name of node.contexts) disabledMacros.add(name);
        disabledMacros.add(token.spelling);
        expanded.push({ ...rawToken(token), disabledMacros: Object.freeze([...disabledMacros]) });
        continue;
      }
      if (!macro) { counter.charge('maxTokens', `c-effective:${token.logicalRange?.[0]}`); expanded.push(rawToken(token)); continue; }
      if (macro.parameters !== null && cursor?.token.spelling !== '(') {
        counter.charge('maxTokens', 'c-uninvoked-function-macro'); expanded.push(rawToken(token)); continue;
      }
      counter.charge('maxMacroExpansions', `c-macro:${token.spelling}`);
      const containing = new Set(disabled);
      // The current token is checked while its replacement context is still
      // active. Function lookahead may cross that context's end before the
      // original opening parenthesis is obtained; those exhausted contexts
      // must not disable original argument tokens during prescan.
      const contexts = macro.parameters === null ? node.contexts : cursor.contexts;
      for (const name of contexts) containing.add(name);
      if (containing.size >= 128) deny('EXHAUSTED', 'C macro expansion depth exceeded', token.origin);
      const expansion = { macro, token, arguments: null, substitutions: new Map(), replacement: [],
        returned: false, failed: false };
      expansions.push(expansion);
      try {
      let arguments_ = null, last = token, consumedLast = node;
      if (macro.parameters !== null) {
        let argumentNode = cursor.next;
        arguments_ = []; let argument = [], depth = 1;
        expansion.arguments = arguments_;
        expansion.pendingArgument = argument;
        for (; argumentNode; argumentNode = argumentNode.next) {
          counter.charge('maxInvariantSteps', 'c-macro-argument-token');
          const item = argumentNode.token;
          if (item.spelling === '(') depth++;
          if (item.spelling === ')' && --depth === 0) {
            if (argument.length || arguments_.length || macro.parameters.length) arguments_.push(argument);
            last = item; consumedLast = argumentNode; break;
          }
          if (item.spelling !== ')' && item.spelling === ',' && depth === 1) { arguments_.push(argument); argument = []; expansion.pendingArgument = argument; }
          else argument.push(item);
        }
        if (depth !== 0 || arguments_.length !== macro.parameters.length) deny('INVALID_SYNTAX', 'C macro argument count or delimiters differ', token.origin);
      }
      const substitutions = expansion.substitutions;
      const useOrigin = scanner.origin(token.logicalRange[0], last.logicalRange[1]);
      const replacement = expansion.replacement;
      for (let replacementIndex = 0; replacementIndex < macro.tokens.length; replacementIndex++) {
        const item = macro.tokens[replacementIndex];
        const spaceBefore = replacementIndex > 0 && macro.tokens[replacementIndex - 1].logicalRange[1] < item.logicalRange[0];
        if (item.spelling === '#') {
          const formal = macro.tokens[++replacementIndex];
          const argument = arguments_[macro.parameters.indexOf(formal.spelling)];
          let spelling = '"';
          for (let ordinal = 0; ordinal < argument.length; ordinal++) {
            const part = argument[ordinal];
            counter.charge('maxInvariantSteps', 'c-stringize-token');
            if (ordinal > 0 && (part.stringizingSpaceBefore || argument[ordinal - 1].logicalRange[1] < part.logicalRange[0])) spelling += ' ';
            for (const character of part.spelling) {
              counter.charge('maxInvariantSteps', 'c-stringize-character');
              if (['string', 'char'].includes(part.kind) && (character === '\\' || character === '"')) spelling += '\\';
              spelling += character;
            }
          }
          spelling += '"'; counter.charge('maxTokens', 'c-stringized-token');
          replacement.push({ kind: 'string', spelling, origin: useOrigin, sourcePositionOriginal: token.sourcePositionOriginal,
            logicalRange: [token.logicalRange[0], last.logicalRange[1]], stringizingSpaceBefore: spaceBefore,
            expansion: { macro: macro.name, definition: item.origin, use: useOrigin, stringizedArguments: argument } });
          continue;
        }
        const formalIndex = macro.parameters?.indexOf(item.spelling) ?? -1;
        if (formalIndex >= 0 && !substitutions.has(item.spelling))
          substitutions.set(item.spelling, expand(arguments_[formalIndex], containing, expansionDepth + 1));
        const selected = substitutions.get(item.spelling);
        if (selected) {
          for (let ordinal = 0; ordinal < selected.length; ordinal++) {
            const argument = selected[ordinal];
            replacement.push({ ...argument, stringizingSpaceBefore: ordinal === 0 ? spaceBefore : argument.stringizingSpaceBefore,
              expansion: { macro: macro.name, definition: macro.origin, use: useOrigin, argument: argument.origin, parent: argument.expansion ?? null } });
          }
        } else replacement.push({ ...rawToken(item), origin: useOrigin, sourcePositionOriginal: token.sourcePositionOriginal, logicalRange: [token.logicalRange[0], last.logicalRange[1]], stringizingSpaceBefore: spaceBefore,
          expansion: { macro: macro.name, definition: item.origin, use: useOrigin, argument: null, parent: item.expansion ?? null } });
      }
      const active = new Set(containing); active.add(macro.name);
      let replacementHead = null, replacementLast = null;
      expansion.replacementNodes = [];
      for (const item of replacement) {
        for (const name of active) counter.charge('maxInvariantSteps', 'c-rescan-disabled-context');
        const replacementNode = nodeFor(item, active);
        expansion.replacementNodes.push(replacementNode);
        if (replacementLast) replacementLast.next = replacementNode; else replacementHead = replacementNode;
        replacementLast = replacementNode;
      }
      const tail = consumedLast.next;
      if (replacementLast) replacementLast.next = tail;
      cursor = replacementHead ?? tail;
      expansion.rescanHeadOriginal = cursor; expansion.tailOriginal = tail; expansion.returned = true;
      } catch (original) { expansion.original = original; expansion.failed = true; throw original; }
    }
    stream.returned = true; return expanded;
    } catch (original) { stream.original = original; stream.failed = true; throw original; }
  };
  const isActive = () => conditionalStack.length === 0 || conditionalStack.at(-1).active;
  const definedOriginal = identifier => {
    counter.charge('maxInvariantSteps', 'c-defined-original');
    if (identifier?.kind !== 'identifier') deny('INVALID_SYNTAX', 'defined requires an identifier', identifier?.origin);
    if (macros.has(identifier.spelling)) return { identifier, value: true, original: macros.get(identifier.spelling) };
    if (undefinedNames.has(identifier.spelling)) return { identifier, value: false, original: undefinedNames.get(identifier.spelling) };
    deny('UNBOUND_PROFILE', 'initial compiler macro definedness has no acquired original', identifier.origin);
  };
  const evaluateCondition = (tokens, occurrence) => {
    let at = 0;
    const atoms = []; occurrence.conditionAtoms = atoms;
    const atom = (depth = 0) => {
      counter.charge('maxInvariantSteps', 'c-condition-atom');
      if (depth > 128) deny('EXHAUSTED', 'C conditional expression depth exceeded', tokens[at]?.origin);
      const token = tokens[at++];
      if (token?.spelling === '!') return !atom(depth + 1);
      if (token?.spelling === '(') {
        const value = disjunction(depth + 1);
        if (tokens[at++]?.spelling !== ')') deny('INVALID_SYNTAX', 'C conditional parenthesis required', token.origin);
        return value;
      }
      if (token?.spelling === 'defined') {
        const parenthesized = tokens[at]?.spelling === '(';
        if (parenthesized) at++;
        const original = definedOriginal(tokens[at++]); atoms.push(original);
        if (parenthesized && tokens[at++]?.spelling !== ')') deny('INVALID_SYNTAX', 'defined parenthesis required', token.origin);
        return original.value;
      }
      if (token?.kind === 'number' && ['0', '1'].includes(token.spelling)) {
        const value = token.spelling === '1'; atoms.push({ token, value }); return value;
      }
      deny('UNSUPPORTED_FORM', 'C conditional arithmetic or unbound macro expression is not implemented', token?.origin);
    };
    const conjunction = depth => {
      let value = atom(depth);
      while (tokens[at]?.spelling === '&&') { at++; const right = atom(depth); value = value && right; }
      return value;
    };
    const disjunction = depth => {
      let value = conjunction(depth);
      while (tokens[at]?.spelling === '||') { at++; const right = conjunction(depth); value = value || right; }
      return value;
    };
    const result = disjunction(0);
    if (at !== tokens.length) deny('UNSUPPORTED_FORM', 'unimplemented C conditional expression operator', tokens[at].origin);
    occurrence.conditionResult = result; return result;
  };
  while (peek().kind !== 'eof') {
    const token = consume();
    if (token.spelling !== '#') {
      const run = [token];
      if (owner) owner.pendingRunOriginal = run;
      while (peek().kind !== 'eof' && peek().spelling !== '#') run.push(consume());
      if (isActive()) { for (const item of expand(run)) output.push(item); }
      else skipped.push({ tokens: run, frame: conditionalStack.at(-1) });
      prior = run.at(-1);
      if (owner) owner.pendingRunOriginal = null;
      continue;
    }
    const tokens = [];
    const occurrence = { marker: token, name: undefined, tokens, origin: token.origin, returned: false, failed: false };
    if (owner) owner.directives.push(occurrence);
    try {
    const directiveLine = line(token.logicalRange[0]);
    if (prior && line(prior.logicalRange[1] - 1) === directiveLine) deny('INVALID_SYNTAX', 'C directive is not at logical line start', token.origin);
    const name = consume();
    if (occurrence) occurrence.name = name;
    while (peek().kind !== 'eof' && line(peek().logicalRange[0]) === directiveLine) tokens.push(consume());
    const origin = scanner.origin(token.logicalRange[0], (tokens.at(-1) ?? name).logicalRange[1]);
    if (occurrence) { occurrence.origin = origin; occurrence.originalTokens = [...tokens]; }
    if (name.kind !== 'identifier') deny('INVALID_SYNTAX', 'C directive name required', origin);
    if (['if', 'ifdef', 'ifndef'].includes(name.spelling)) {
      if (conditionalStack.length >= 128) deny('EXHAUSTED', 'C conditional nesting exceeded', origin);
      const frame = { opener: occurrence, parentActive: isActive(), active: false, taken: false, elseSeen: false, branches: [occurrence], closed: false };
      conditionals.push(frame); conditionalStack.push(frame); occurrence.frame = frame;
      if (frame.parentActive) {
        if (name.spelling === 'if') frame.active = evaluateCondition(tokens, occurrence);
        else {
          if (tokens.length !== 1) deny('INVALID_SYNTAX', 'C conditional identifier required', origin);
          const original = definedOriginal(tokens[0]); occurrence.conditionAtoms = [original];
          frame.active = name.spelling === 'ifdef' ? original.value : !original.value;
          occurrence.conditionResult = frame.active;
        }
      }
      frame.taken = frame.active;
      directives.push({ kind: 'cConditional', origin, conditionalOriginal: occurrence });
    } else if (['elif', 'else', 'endif'].includes(name.spelling)) {
      const frame = conditionalStack.at(-1);
      if (!frame) deny('INVALID_SYNTAX', 'C conditional has no opener', origin);
      occurrence.frame = frame; frame.branches.push(occurrence);
      if (name.spelling !== 'elif' && tokens.length !== 0) deny('INVALID_SYNTAX', 'C conditional terminator has trailing tokens', origin);
      if (name.spelling === 'endif') { frame.closed = true; frame.closer = occurrence; conditionalStack.pop(); }
      else {
        if (frame.elseSeen) deny('INVALID_SYNTAX', 'C conditional branch follows else', origin);
        if (name.spelling === 'else') frame.elseSeen = true;
        const eligible = frame.parentActive && !frame.taken;
        frame.active = eligible && (name.spelling === 'else' || evaluateCondition(tokens, occurrence));
        frame.taken = frame.taken || frame.active;
      }
      directives.push({ kind: 'cConditional', origin, conditionalOriginal: occurrence });
    } else if (!isActive()) {
      occurrence.skipped = true; occurrence.frame = conditionalStack.at(-1);
      skipped.push(occurrence);
    } else if (name.spelling === 'define') {
      const identifier = tokens.shift();
      if (identifier?.kind !== 'identifier') deny('INVALID_SYNTAX', 'C macro name required', origin);
      let parameters = null;
      if (tokens[0]?.spelling === '(' && tokens[0].logicalRange[0] === identifier.logicalRange[1]) {
        tokens.shift(); parameters = [];
        while (tokens[0]?.spelling !== ')') {
          const parameter = tokens.shift();
          if (parameter?.kind !== 'identifier' || parameters.includes(parameter.spelling)) deny('INVALID_SYNTAX', 'unique C macro formal required', origin);
          parameters.push(parameter.spelling);
          if (tokens[0]?.spelling !== ',') break;
          tokens.shift();
        }
        if (tokens.shift()?.spelling !== ')') deny('INVALID_SYNTAX', 'C macro formal terminator required', origin);
      }
      for (let ordinal = 0; ordinal < tokens.length; ordinal++) {
        if (['##', '...'].includes(tokens[ordinal].spelling)) deny('UNSUPPORTED_FORM', 'C macro paste/variadic form is excluded', origin);
        if (tokens[ordinal].spelling === '#' && (parameters === null || !parameters.includes(tokens[ordinal + 1]?.spelling)))
          deny('INVALID_SYNTAX', 'C stringizing requires its following formal parameter', tokens[ordinal].origin);
      }
      const macro = { name: identifier.spelling, parameters, tokens, origin };
      if (['_UNICODE', 'UNICODE'].includes(macro.name) && (parameters !== null || tokens.length !== 0) ||
          macro.name === '_WIN32_WINNT' && !targetVersion(macro, counter))
        deny('UNBOUND_PROFILE', 'C target profile define differs', origin);
      if (macros.has(macro.name) && !sameReplacement(macros.get(macro.name), macro)) deny('INVALID_SYNTAX', 'incompatible C macro redefinition', origin);
      macros.set(macro.name, macro); undefinedNames.delete(macro.name); directives.push({ kind: 'cDefine', origin, macro });
    } else if (name.spelling === 'undef') {
      if (tokens.length !== 1 || tokens[0].kind !== 'identifier') deny('INVALID_SYNTAX', 'C undef identifier required', origin);
      macros.delete(tokens[0].spelling);
      const undefinedOriginal = { kind: 'cUndef', origin, name: tokens[0].spelling };
      undefinedNames.set(tokens[0].spelling, undefinedOriginal); directives.push(undefinedOriginal);
    } else if (name.spelling === 'include') {
      if (!macros.has('UNICODE') || !macros.has('_UNICODE') || !targetVersion(macros.get('_WIN32_WINNT'), counter))
        deny('UNBOUND_PROFILE', 'C include lacks its exact selected target defines', origin);
      let included;
      if (tokens.length === 1 && tokens[0].kind === 'string') included = tokens[0].spelling.slice(1, -1);
      else if (tokens[0]?.spelling === '<' && tokens.at(-1)?.spelling === '>') included = tokens.slice(1, -1).map(item => item.spelling).join('');
      if (!includeNames.has(included)) deny('UNBOUND_PROFILE', 'C include is outside the fixed symbolic catalogue', origin);
      directives.push({ kind: 'cInclude', origin, name: included });
    } else if (name.spelling === 'line') {
      const mapping = { kind: 'cLine', origin, directiveOriginal: occurrence,
        expandedOriginal: null, effectiveOffset: null, physicalBase: null,
        presumedBase: null, filenameTokenOriginal: sourceLines.at(-1).filenameTokenOriginal,
        returned: false, nativeAuthority: false };
      directives.push(mapping); occurrence.sourceLineOriginal = mapping;
      const expanded = expand(tokens); mapping.expandedOriginal = expanded;
      if (expanded.length < 1 || expanded.length > 2 || expanded[0].kind !== 'number' ||
          !/^[0-9]+$/u.test(expanded[0].spelling) || expanded.length === 2 &&
          (expanded[1].kind !== 'string' || expanded[1].spelling[0] !== '"'))
        deny('INVALID_SYNTAX', 'MSVC line requires decimal digits and an optional ordinary filename string', origin);
      let value = 0;
      for (const digit of expanded[0].spelling) {
        counter.charge('maxInvariantSteps', 'c-line-number-digit');
        value = value * 10 + digit.charCodeAt(0) - 48;
        if (value > 2147483647) deny('INVALID_SYNTAX', 'MSVC line number exceeds its source contract', expanded[0].origin);
      }
      let next = token.logicalRange[0];
      while (next < scanner.text.length && !['\r', '\n'].includes(scanner.text[next])) {
        counter.charge('maxInvariantSteps', 'c-line-directive-end'); next++;
      }
      if (scanner.text[next] === '\r' && scanner.text[next + 1] === '\n') next += 2;
      else if (next < scanner.text.length) next++;
      mapping.effectiveOffset = next;
      mapping.physicalBase = scanner.physicalLineAt[next] ?? scanner.physicalEndLine;
      mapping.presumedBase = value;
      if (expanded.length === 2) mapping.filenameTokenOriginal = expanded[1];
      sourceLines.push(mapping); mapping.returned = true;
    } else if (name.spelling === 'pragma') {
      const pragma = { kind: 'cPragma', origin, tokens, operation: tokens[0]?.spelling,
        returned: false, compilerEmissionOriginal: null, nativeAuthority: false };
      directives.push(pragma); occurrence.pragma = pragma;
      if (['push_macro', 'pop_macro'].includes(pragma.operation)) {
        if (tokens.length !== 4 || tokens[1].spelling !== '(' || tokens[3].spelling !== ')' ||
            tokens[2].kind !== 'string' || !/^"[A-Za-z_][A-Za-z_0-9]*"$/u.test(tokens[2].spelling))
          deny('UNSUPPORTED_FORM', 'C macro save pragma requires a fixed literal identifier', origin);
        const macroName = tokens[2].spelling.slice(1, -1);
        let saves = macroSaves.get(macroName);
        if (!saves) { saves = []; macroSaves.set(macroName, saves); }
        pragma.name = macroName; pragma.macroSaveStackOriginal = saves;
        if (pragma.operation === 'push_macro') {
          if (saves.length >= 128) deny('EXHAUSTED', 'C macro save nesting exceeded', origin);
          const binding = definedOriginal({ kind: 'identifier', spelling: macroName, origin: tokens[2].origin });
          // Undefined push/pop behavior is not established by the selected
          // compiler contract. The actual TU instead explicitly cleans it up.
          if (!binding.value) deny('UNBOUND_PROFILE', 'undefined C macro save needs selected compiler semantics', origin);
          const save = { pragma, binding, restored: false };
          pragma.macroSaveOriginal = save; saves.push(save);
        } else {
          const save = saves.at(-1);
          if (!save) deny('INVALID_SYNTAX', 'C macro restore has no preceding save', origin);
          pragma.macroSaveOriginal = save;
          macros.set(macroName, save.binding.original); undefinedNames.delete(macroName);
          save.restored = true; save.restoreOriginal = pragma; saves.pop();
        }
      } else if (pragma.operation === 'message') {
        if (tokens[1]?.spelling !== '(' || tokens.at(-1)?.spelling !== ')')
          deny('UNSUPPORTED_FORM', 'C message pragma requires selected parenthesized strings', origin);
        const arguments_ = tokens.slice(2, -1); pragma.argumentsOriginal = arguments_;
        const strings = expand(arguments_); pragma.expandedStrings = strings;
        if (strings.length === 0 || strings.some(item => item.kind !== 'string'))
          deny('UNSUPPORTED_FORM', 'C message pragma requires expanded string literals', origin);
        pragma.diagnosticValueOriginal = null;
        pragma.diagnosticEncodingOriginal = null;
      } else if (tokens.map(item => item.spelling).join('') !== 'comment(lib,"bcrypt.lib")')
        deny('UNSUPPORTED_FORM', 'unselected C pragma', origin);
      pragma.returned = true;
    } else deny('UNSUPPORTED_FORM', 'unselected C directive', origin);
    if (occurrence) occurrence.returned = true;
    } catch (original) { if (occurrence) { occurrence.original = original; occurrence.failed = true; } throw original; }
    prior = null;
  }
  if (conditionalStack.length) deny('INVALID_SYNTAX', 'C conditional is unterminated', conditionalStack.at(-1).opener.origin);
  const eof = consume(); output.push(rawToken(eof));
  const result = { decoded: scanner.decoded, effectiveText: scanner.text, originalAt: scanner.originalAt,
    directives, sourceLines, tokens: output, trivia: scanner.trivia };
  if (owner) { owner.result = result; owner.returned = true; }
  return result;
  } catch (original) { if (owner) { owner.original = original; owner.failed = true; } throw original; }
}

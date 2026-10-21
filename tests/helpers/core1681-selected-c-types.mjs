import { deny } from './core1681-source-input.mjs';
import { requireProofCounter, K2_LIMITS } from './core1681-proof-terms.mjs';

export const C_SCALAR_SPECIFIERS = Object.freeze(['signed', 'unsigned', 'short', 'long', 'void', 'char', 'int',
  'float', 'double', '__int8', '__int16', '__int32', '__int64', '_int8', '_int16', '_int32', '_int64']);

// Source type formation only. Target widths, plain-char sign, extension options
// and native/provider identities require their actual compiler input originals.
export function classifySelectedCScalar(tokens, counter, origin) {
  requireProofCounter(counter);
  counter.charge('maxInvariantSteps', 'original-C-type-formation');
  const counts = new Map(), spelling = [];
  for (const token of tokens) {
    counter.charge('maxInvariantSteps', 'original-C-type-specifier');
    if (!C_SCALAR_SPECIFIERS.includes(token.spelling)) continue;
    spelling.push(token.spelling);
    counts.set(token.spelling, (counts.get(token.spelling) ?? 0) + 1);
  }
  if (!spelling.length) return null;
  const invalid = () => deny('INVALID_SYNTAX', 'incompatible original C scalar type specifiers', origin);
  if (tokens.some(token => !C_SCALAR_SPECIFIERS.includes(token.spelling) &&
      !['static', 'extern', 'const', 'volatile'].includes(token.spelling))) invalid();
  for (const [word, count] of counts) if (count > (word === 'long' ? 2 : 1)) invalid();
  const has = word => counts.has(word);
  if (has('signed') && has('unsigned')) invalid();
  const sign = has('unsigned') ? 'unsigned' : 'signed';
  const aliases = spelling.filter(word => /^_?_int(?:8|16|32|64)$/u.test(word));
  let base, signedness = null, requiresExtensions = false;
  if (aliases.length) {
    if (aliases.length !== 1 || spelling.some(word => !['signed', 'unsigned', aliases[0]].includes(word))) invalid();
    const alias = aliases[0], width = Number(/(?:8|16|32|64)$/u.exec(alias)[0]);
    base = ({ 8: 'char', 16: 'short', 32: 'int', 64: 'longLong' })[width];
    signedness = width === 8 && !has('signed') && !has('unsigned') ? 'targetChar' : sign;
    requiresExtensions = true;
  } else if (has('void') || has('float')) {
    if (spelling.length !== 1) invalid();
    base = spelling[0];
  } else if (has('double')) {
    if (spelling.some(word => !['double', 'long'].includes(word)) || (counts.get('long') ?? 0) > 1) invalid();
    base = has('long') ? 'longDouble' : 'double';
  } else if (has('char')) {
    if (spelling.some(word => !['char', 'signed', 'unsigned'].includes(word))) invalid();
    base = 'char'; signedness = has('signed') || has('unsigned') ? sign : 'targetChar';
  } else {
    if (has('short') && has('long')) invalid();
    base = has('short') ? 'short' : has('long') ? counts.get('long') === 2 ? 'longLong' : 'long' : 'int';
    signedness = sign;
  }
  counter.charge('maxOccurrences', 'original-C-scalar-source-type');
  return Object.freeze({ kind: 'cScalarSourceType', base, signedness, requiresExtensions,
    originalSpecifiers: Object.freeze(spelling), nativeTypeOriginal: null, sourceAdmission: false });
}

const typeOccurrences = new WeakMap();
export function resolveSelectedCSourceHead(type, counter) {
  requireProofCounter(counter);
  let depth = 0;
  while (['cQualifiedSourceType', 'cTypedefSourceType'].includes(type.kind)) {
    counter.charge('maxInvariantSteps', 'original-C-source-type-head');
    if (++depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'C source alias depth exhausted', type.original.origin);
    type = type.element;
  }
  return type;
}
export function createSelectedCTypeOccurrence(counter) {
  requireProofCounter(counter);
  counter.charge('maxInvariantSteps', 'original-C-type-occurrence');
  const token = Object.freeze({});
  typeOccurrences.set(token, { counter, issued: false, nodes: [], returned: false, failed: false });
  return token;
}
export function checkSelectedCSourceObjectCompleteness(type, counter, origin, depth = 0) {
  requireProofCounter(counter);
  counter.charge('maxInvariantSteps', 'original-C-object-completeness');
  if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'C object completeness depth exhausted', origin);
  const head = resolveSelectedCSourceHead(type, counter);
  if (head.kind === 'cScalarSourceType' && head.base === 'void' || head.kind === 'cFunctionSourceType')
    deny('INVALID_SYNTAX', 'C object requires a nonvoid nonfunction source type', origin);
  if (head.kind === 'cAggregateSourceType' && !head.tagOriginal.complete) {
    if (head.category === 'enum') return false; // Selected enum extensions remain unqualified.
    deny('INVALID_SYNTAX', 'C object requires its already completed aggregate source type', origin);
  }
  if (head.kind === 'cArraySourceType') return checkSelectedCSourceObjectCompleteness(head.element, counter, origin, depth + 1);
  return !['cUnresolvedNamedSourceType', 'cUnresolvedAggregateSourceType'].includes(head.kind);
}
export function copySelectedCTypeObservation(token) {
  const owner = typeOccurrences.get(token);
  if (!owner) deny('INVALID_BINDING', 'C type observation requires original custody');
  return { returned: owner.returned, failed: owner.failed, original: owner.original,
    nodes: owner.nodes.map(row => ({ kind: row.kind, returned: row.returned })),
    pendingKind: owner.pending?.kind, sourceAdmission: false };
}

export function composeSelectedCSourceType(specifiers, declarator, counter, token, parameter = false) {
  const owner = typeOccurrences.get(token);
  if (!owner || owner.issued || owner.counter !== counter) deny('INVALID_BINDING', 'C source type requires its once-only caller occurrence');
  owner.issued = true; owner.specifiers = specifiers; owner.declarator = declarator; owner.parameter = parameter;
  try {
  requireProofCounter(counter);
  const make = (kind, original, fields) => {
    counter.charge('maxOccurrences', 'original-C-declarator-source-type');
    const row = { kind, original, fields, returned: false, result: undefined };
    owner.pending = row; owner.nodes.push(row);
    let sourceDepth = 1 + Math.max(fields.element?.sourceDepth ?? 0, fields.result?.sourceDepth ?? 0);
    if (fields.parameters) for (const parameter of fields.parameters) {
      counter.charge('maxInvariantSteps', 'original-C-parameter-type-depth');
      sourceDepth = Math.max(sourceDepth, 1 + Math.max(parameter.sourceType?.sourceDepth ?? 0, parameter.parameterType?.sourceDepth ?? 0));
    }
    if (sourceDepth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'C source type depth exhausted', original.origin);
    row.result = Object.freeze({ kind, original, ...fields, sourceDepth, nativeTypeOriginal: null, sourceAdmission: false });
    row.returned = true;
    return row.result;
  };
  let base = specifiers.scalar;
  if (!base && specifiers.typedefOriginal) base = make('cTypedefSourceType', specifiers,
    { element: specifiers.typedefOriginal.sourceType, typedefOriginal: specifiers.typedefOriginal });
  if (!base && specifiers.aggregates.length === 1) {
    const aggregate = specifiers.aggregates[0], tagOriginal = aggregate.tagOriginal;
    if (!tagOriginal || tagOriginal.category !== aggregate.category)
      deny('INVALID_SYNTAX', 'C aggregate reference differs from the visible tag category', aggregate.origin);
    base = make('cAggregateSourceType', specifiers, { category: aggregate.category, tagOriginal });
  }
  if (!base) base = make('cUnresolvedNamedSourceType', specifiers, { typedefOriginal: null });
  const qualifiers = specifiers.words.filter(token => ['const', 'volatile'].includes(token.spelling));
  const qualify = (type, depth = 0) => {
    counter.charge('maxInvariantSteps', 'original-C-alias-qualification');
    if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'C qualifier type depth exhausted', specifiers.origin);
    if (type.kind === 'cTypedefSourceType') return make(type.kind, specifiers,
      { element: qualify(type.element, depth + 1), typedefOriginal: type.typedefOriginal });
    if (type.kind === 'cArraySourceType') return make(type.kind, specifiers,
      { element: qualify(type.element, depth + 1), boundOriginal: type.boundOriginal, declaredType: type });
    if (resolveSelectedCSourceHead(type, counter).kind === 'cFunctionSourceType')
      deny('UNSUPPORTED_FORM', 'qualified C function type has no admitted semantics', specifiers.origin);
    return make('cQualifiedSourceType', specifiers, { element: type, qualifiers });
  };
  if (qualifiers.length) base = qualify(base);
  const unqualified = type => resolveSelectedCSourceHead(type, counter);
  const compose = (syntax, type, depth) => {
    counter.charge('maxInvariantSteps', 'original-C-declarator-composition');
    if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'C source type composition depth exhausted', syntax.origin);
    for (const pointer of syntax.pointers) type = make('cPointerSourceType', pointer, { element: type, qualifiers: pointer.qualifiers });
    for (let index = syntax.suffixes.length - 1; index >= 0; index--) {
      const layer = syntax.suffixes[index], result = unqualified(type);
      if (layer.kind === 'cArrayLayer') {
        if (result.kind === 'cFunctionSourceType' || result.kind === 'cScalarSourceType' && result.base === 'void')
          deny('INVALID_SYNTAX', 'C array element cannot be a function or void', layer.origin);
        const elementCompletenessKnown = checkSelectedCSourceObjectCompleteness(type, counter, layer.origin);
        type = make('cArraySourceType', layer, { element: type, boundOriginal: layer.length, elementCompletenessKnown });
      } else if (layer.kind === 'cFunctionLayer') {
        if (['cFunctionSourceType', 'cArraySourceType'].includes(result.kind))
          deny('INVALID_SYNTAX', 'C function cannot return a function or array', layer.origin);
        type = make('cFunctionSourceType', layer, { result: type, parameters: layer.parameters,
          prototype: layer.prototype, voidMarker: layer.voidMarker, ellipsis: layer.ellipsis });
      } else deny('INVALID_BINDING', 'unbound original C declarator layer', layer.origin);
    }
    if (syntax.direct.kind === 'cParenthesizedDeclarator') return compose(syntax.direct.declarator, type, depth + 1);
    return type;
  };
  owner.declaredResult = declarator ? compose(declarator, base, 0) : base;
  let adjustedType = owner.declaredResult;
  const parameterHead = parameter ? unqualified(adjustedType) : null;
  if (parameterHead?.kind === 'cArraySourceType')
    adjustedType = make('cPointerSourceType', parameterHead.original, { element: parameterHead.element, qualifiers: [], adjustment: 'arrayParameter', declaredType: owner.declaredResult });
  else if (parameterHead?.kind === 'cFunctionSourceType')
    adjustedType = make('cPointerSourceType', parameterHead.original, { element: parameterHead, qualifiers: [], adjustment: 'functionParameter', declaredType: owner.declaredResult });
  owner.result = parameter ? Object.freeze({ declaredType: owner.declaredResult, adjustedType }) : owner.declaredResult;
  owner.returned = true;
  return owner.result;
  } catch (original) { owner.original = original; owner.failed = true; throw original; }
}

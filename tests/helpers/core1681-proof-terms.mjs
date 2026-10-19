import { deny, exactKeys } from './core1681-source-input.mjs';

const scalarSorts = new Set(['Bool', 'Z', 'F32', 'F64', 'Decimal', 'UTF16', 'Bytes',
  'TypeId', 'DeclId', 'OccId', 'LocId', 'AllocId', 'OwnerId', 'ExnId', 'StateId', 'EdgeId', 'Trace']);
const opcodes = new Set(['bvToZ', 'zLt', 'zGt', 'add', 'sub', 'mul', 'div', 'rem', 'neg', 'bitand', 'bitor',
  'bitxor', 'bitnot', 'shl', 'shr', 'cast', 'ite', 'length', 'at', 'slice', 'append',
  'concat', 'contains', 'setInsert', 'mapInsert', 'mapLookup', 'tag', 'default',
  'encodeUTF16', 'decodeUTF8', 'roundIEEE', 'roundEven', 'reverseBits', 'crcBit',
  'bvEq', 'bvNe', 'bvLt', 'bvLe', 'bvGt', 'bvGe']);

export const K2_LIMITS = Object.freeze({ maxTokens: 250000, maxDeclarations: 10000,
  maxOccurrences: 200000, maxProofNodes: 2000000, maxTermDepth: 128,
  maxBranchLeaves: 100000, maxMacroExpansions: 10000, maxInvariantSteps: 1000000,
  maxDiagnostics: 10000 });

const originalProofCounters = new WeakSet();
export function requireProofCounter(counter) {
  if (!originalProofCounters.has(counter)) deny('INVALID_LIMIT', 'proof receiver requires its original finite counter');
}

export function createProofCounter(limits = K2_LIMITS) {
  const keys = Object.keys(K2_LIMITS), admittedLimits = {}, counts = {};
  if (!limits || Object.getPrototypeOf(limits) !== Object.prototype)
    deny('INVALID_INPUT', 'K2 resource limits require a closed own-data record');
  const ownKeys = Reflect.ownKeys(limits);
  if (ownKeys.length !== keys.length || ownKeys.some(key => !keys.includes(key)))
    deny('INVALID_INPUT', 'K2 resource limits require the closed finite resource roster');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(limits, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true)
      deny('INVALID_INPUT', 'K2 resource limits require own enumerable data members');
    const value = descriptor.value;
    if (!Number.isSafeInteger(value) || value < 0 || value > K2_LIMITS[key])
      deny('INVALID_LIMIT', `K2 limit ${key} is outside the admitted bound`);
    admittedLimits[key] = value; counts[key] = 0;
  }
  Object.freeze(admittedLimits);
  const counter = Object.freeze({
    charge(key, outstandingId) {
      if (typeof key !== 'string' || !Object.hasOwn(counts, key)) deny('INVALID_LIMIT', 'unknown K2 resource counter');
      // Charge before the caller allocates the next object.
      if (counts[key] >= admittedLimits[key]) deny('EXHAUSTED', `K2 ${key} exhausted; outstanding ${outstandingId}`);
      counts[key]++;
    },
    snapshot() { return Object.freeze({ ...counts }); },
  });
  originalProofCounters.add(counter);
  return counter;
}

// Direct proof receivers must validate data descriptors before reading any
// discriminator/value. This is a structural guard, not semantic term checking
// or proof admission. Proxy/host-object acquisition belongs to the input owner.
export function checkProofData(value, counter, active = new WeakSet(), depth = 0) {
  requireProofCounter(counter);
  counter.charge('maxProofNodes', 'own-data-proof-input');
  if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'proof input data depth exhausted');
  if (value === null || ['string', 'boolean', 'bigint'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object') deny('INVALID_TERM', 'proof input requires finite own data');
  if (active.has(value)) deny('INVALID_TERM', 'cyclic proof input');
  active.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > K2_LIMITS.maxProofNodes ||
        Reflect.ownKeys(value).length !== value.length + 1) deny('INVALID_TERM', 'proof collection requires dense original array data');
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true)
        deny('INVALID_TERM', 'proof collection cannot contain accessor, hidden or sparse elements');
      checkProofData(descriptor.value, counter, active, depth + 1);
    }
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) deny('INVALID_TERM', 'proof record requires a plain original data object');
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') deny('INVALID_TERM', 'proof record cannot contain symbol members');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true)
        deny('INVALID_TERM', 'proof record cannot contain accessor or hidden members');
      checkProofData(descriptor.value, counter, active, depth + 1);
    }
  }
  active.delete(value);
}

export function checkSort(sort, depth = 0) {
  if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'K2 sort depth exhausted');
  if (typeof sort === 'string' && scalarSorts.has(sort)) return;
  if (!sort || typeof sort !== 'object') deny('INVALID_TERM', 'unknown K2 sort');
  if (sort.kind === 'BV') {
    exactKeys(sort, ['kind', 'width', 'signed'], 'bitvector sort');
    if (![8, 16, 32, 64].includes(sort.width) || typeof sort.signed !== 'boolean')
      deny('INVALID_TERM', 'invalid K2 bitvector width or sign');
  } else if (['Seq', 'Set'].includes(sort.kind)) {
    exactKeys(sort, ['kind', 'element'], 'collection sort'); checkSort(sort.element, depth + 1);
  } else if (sort.kind === 'Map') {
    exactKeys(sort, ['kind', 'key', 'value'], 'map sort'); checkSort(sort.key, depth + 1); checkSort(sort.value, depth + 1);
  } else deny('INVALID_TERM', 'unknown K2 composite sort');
}

export function canonicalData(value) {
  const parts = [], active = new Set(); let extent = 0;
  const emit = text => {
    if (text.length > K2_LIMITS.maxProofNodes - extent) deny('EXHAUSTED', 'K2 canonical data extent exhausted');
    extent += text.length; parts.push(text);
  };
  const quoted = text => {
    if (text.length > K2_LIMITS.maxProofNodes - extent) deny('EXHAUSTED', 'K2 canonical string extent exhausted');
    let size = 2;
    for (let index = 0; index < text.length; index++) {
      const unit = text.charCodeAt(index);
      if (unit === 34 || unit === 92 || [8, 9, 10, 12, 13].includes(unit)) size += 2;
      else if (unit < 32) size += 6;
      else if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { size += 2; index++; } else size += 6;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) size += 6;
      else size++;
      if (size > K2_LIMITS.maxProofNodes - extent) deny('EXHAUSTED', 'K2 escaped canonical string extent exhausted');
    }
    emit(JSON.stringify(text));
  };
  const visit = (item, depth) => {
    if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'K2 canonical data depth exhausted');
    if (item === null) { emit('null'); return; }
    if (typeof item === 'string') { quoted(item); return; }
    if (typeof item === 'boolean') { emit(item ? 'true' : 'false'); return; }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) deny('INVALID_TERM', 'nonfinite untyped canonical number');
      emit(Object.is(item, -0) ? '-0' : JSON.stringify(item)); return;
    }
    // Internal exact arithmetic remains distinct from a transport string.
    // Logical Constant Z/BV payloads still require their checked string schema.
    if (typeof item === 'bigint') { emit(`bigint(${item.toString()})`); return; }
    if (!item || typeof item !== 'object') deny('INVALID_TERM', 'unsupported canonical data value');
    if (active.has(item)) deny('INVALID_TERM', 'cyclic canonical data');
    active.add(item);
    if (Array.isArray(item)) {
      if (item.length > K2_LIMITS.maxProofNodes - extent) deny('EXHAUSTED', 'K2 canonical collection extent exhausted');
      emit('[');
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) deny('INVALID_TERM', 'sparse or accessor canonical collection');
        if (index) emit(','); visit(descriptor.value, depth + 1);
      }
      emit(']');
    } else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) deny('INVALID_TERM', 'canonical data requires a plain record');
      const keys = Object.keys(item).sort();
      if (keys.length > K2_LIMITS.maxProofNodes - extent) deny('EXHAUSTED', 'K2 canonical record extent exhausted');
      emit('{');
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index], descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) deny('INVALID_TERM', 'accessor canonical record');
        if (index) emit(','); quoted(key); emit(':'); visit(descriptor.value, depth + 1);
      }
      emit('}');
    }
    active.delete(item);
  };
  visit(value, 0); return parts.join('');
}

export function checkTerm(term, identities, depth = 0) {
  if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'K2 term depth exhausted');
  if (!term || typeof term !== 'object' || Array.isArray(term)) deny('INVALID_TERM', 'typed term object required');
  const nested = value => checkTerm(value, identities, depth + 1);
  const identity = (kind, value) => {
    if (!identities[kind]?.has(canonicalData(value))) deny('INVALID_TERM', `unbound original ${kind}`);
  };
  switch (term.kind) {
    case 'Constant':
      exactKeys(term, ['kind', 'sort', 'value'], 'constant term'); checkSort(term.sort);
      if (term.sort === 'Bool' && typeof term.value !== 'boolean') deny('INVALID_TERM', 'Boolean constant tag differs');
      if (term.sort === 'Z' && (typeof term.value !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(term.value) || term.value === '-0'))
        deny('INVALID_TERM', 'integer constant is not canonical');
      if (term.sort === 'UTF16' && (typeof term.value !== 'string')) deny('INVALID_TERM', 'UTF16 units required');
      if (term.sort === 'Bytes' && (!Array.isArray(term.value) || term.value.some(value => !Number.isInteger(value) || value < 0 || value > 255)))
        deny('INVALID_TERM', 'byte constant extent differs');
      if (term.sort?.kind === 'BV') {
        if (typeof term.value !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(term.value) || term.value === '-0')
          deny('INVALID_TERM', 'bitvector constant is not canonical');
        const modulus = 1n << BigInt(term.sort.width), value = BigInt(term.value);
        const lower = term.sort.signed ? -modulus / 2n : 0n;
        const upper = term.sort.signed ? modulus / 2n - 1n : modulus - 1n;
        if (value < lower || value > upper) deny('INVALID_TERM', 'bitvector constant exceeds its typed extent');
      }
      // Floats retain exact IEEE bits, including signed zero and NaN payload;
      // JavaScript Number is never a source float identity or rounding oracle.
      if (['F32', 'F64'].includes(term.sort) &&
          (typeof term.value !== 'string' || !(term.sort === 'F32' ? /^[0-9a-f]{8}$/ : /^[0-9a-f]{16}$/).test(term.value)))
        deny('INVALID_TERM', 'IEEE constant requires its exact lowercase bit representation');
      if (term.sort === 'Decimal') {
        exactKeys(term.value, ['coefficient', 'scale', 'negative'], 'decimal constant');
        if (typeof term.value.coefficient !== 'string' || !/^(0|[1-9][0-9]*)$/.test(term.value.coefficient) ||
            BigInt(term.value.coefficient) >= (1n << 96n) || !Number.isInteger(term.value.scale) ||
            term.value.scale < 0 || term.value.scale > 28 || typeof term.value.negative !== 'boolean')
          deny('INVALID_TERM', 'decimal coefficient/scale/sign differs from CLR representation');
      }
      if (typeof term.sort === 'string' && term.sort.endsWith('Id')) {
        const nullableIdentity = ['AllocId', 'LocId', 'OwnerId', 'ExnId', 'EdgeId'].includes(term.sort);
        if (!(term.value === null && nullableIdentity)) identity(term.sort, term.value);
      }
      break;
    case 'Bound':
      exactKeys(term, ['kind', 'sort', 'binder', 'index'], 'bound term'); checkSort(term.sort);
      if (!Number.isSafeInteger(term.index) || term.index < 0) deny('INVALID_TERM', 'invalid bound variable index');
      identity('BinderId', term.binder);
      break;
    case 'Projection':
      exactKeys(term, ['kind', 'base', 'fieldDecl'], 'projection term'); nested(term.base); identity('DeclId', term.fieldDecl);
      break;
    case 'Index':
      exactKeys(term, ['kind', 'base', 'index', 'elementSort'], 'index term'); nested(term.base); nested(term.index); checkSort(term.elementSort);
      break;
    case 'Op':
      exactKeys(term, ['kind', 'opcode', 'sort', 'args'], 'operation term'); checkSort(term.sort);
      if (!opcodes.has(term.opcode) || !Array.isArray(term.args)) deny('INVALID_TERM', 'unknown closed opcode or operands');
      term.args.forEach(nested);
      break;
    case 'Fresh':
      exactKeys(term, ['kind', 'occurrence', 'iteration', 'sort'], 'fresh term'); identity('OccId', term.occurrence); nested(term.iteration); checkSort(term.sort);
      break;
    case 'RefTarget':
      exactKeys(term, ['kind', 'formalLoc'], 'ref target'); identity('LocId', term.formalLoc);
      break;
    case 'Observation':
      exactKeys(term, ['kind', 'occurrence', 'receiver', 'thread', 'outputIndex', 'sort'], 'observation term');
      identity('OccId', term.occurrence); nested(term.receiver); nested(term.thread); checkSort(term.sort);
      if (!Number.isSafeInteger(term.outputIndex) || term.outputIndex < 0) deny('INVALID_TERM', 'invalid observation output index');
      break;
    case 'StoreAt':
      exactKeys(term, ['kind', 'state', 'location'], 'store term'); identity('StateId', term.state); identity('LocId', term.location);
      break;
    case 'TraceAt':
      exactKeys(term, ['kind', 'state'], 'trace term'); identity('StateId', term.state);
      break;
    case 'ExceptionAt':
      exactKeys(term, ['kind', 'edge'], 'exception term'); identity('EdgeId', term.edge);
      break;
    default: deny('INVALID_TERM', 'unknown closed K2 term');
  }
}

export function checkFact(fact, identities, depth = 0) {
  if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'K2 fact depth exhausted');
  if (!fact || typeof fact !== 'object' || Array.isArray(fact)) deny('INVALID_TERM', 'closed fact object required');
  const term = value => checkTerm(value, identities, depth + 1);
  const child = value => checkFact(value, identities, depth + 1);
  if (['Equal', 'NotEqual', 'LessEqual', 'TraceEqual'].includes(fact.kind)) {
    exactKeys(fact, ['kind', 'left', 'right'], 'binary fact'); term(fact.left); term(fact.right);
  } else if (['And', 'Or'].includes(fact.kind)) {
    exactKeys(fact, ['kind', 'facts'], 'compound fact');
    if (!Array.isArray(fact.facts)) deny('INVALID_TERM', 'fact conjunction/disjunction children required');
    fact.facts.forEach(child);
  } else if (fact.kind === 'Not') {
    exactKeys(fact, ['kind', 'fact'], 'negated fact'); child(fact.fact);
  } else if (fact.kind === 'Implies') {
    exactKeys(fact, ['kind', 'premise', 'conclusion'], 'implication fact'); child(fact.premise); child(fact.conclusion);
  } else {
    const fields = {
      TypeTag: ['value', 'type'], HasValue: ['value'], DefinedOn: ['value', 'edge'],
      SameLocation: ['left', 'right'], SameAllocation: ['left', 'right'], SameOwner: ['left', 'right'],
      Footprint: ['before', 'after', 'locations'], Rooted: ['owner', 'state'],
      Attempted: ['owner', 'declaration', 'ordinal', 'state'], Closed: ['owner', 'state'],
      Pending: ['owner', 'occurrence', 'state'], Completion: ['completion', 'target', 'value', 'exception'],
    }[fact.kind];
    if (!fields) deny('INVALID_TERM', 'unknown closed K2 fact');
    exactKeys(fact, ['kind', ...fields], 'typed relation fact');
    for (const field of fields) {
      if (fact.kind === 'Completion' && field === 'completion') {
        if (!['normal', 'return', 'throw', 'break', 'continue', 'goto', 'nonreturn'].includes(fact[field]))
          deny('INVALID_TERM', 'unknown completion');
      } else term(fact[field]);
    }
  }
}

export function termSort(term, metadata, depth = 0) {
  if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'K2 sort derivation depth exhausted');
  if (!term || typeof term !== 'object' || Array.isArray(term)) deny('INVALID_TERM', 'sort derivation requires a term');
  const derived = value => termSort(value, metadata, depth + 1);
  const lookup = (table, identity) => {
    const entry = metadata[table]?.get(canonicalData(identity));
    if (!entry) deny('INVALID_TERM', `original ${table} association missing`);
    return entry;
  };
  const selectedSort = sort => {
    checkSort(sort);
    if (canonicalData(sort) !== canonicalData(term.sort)) deny('INVALID_TERM', 'claimed sort differs from independently bound metadata');
    return sort;
  };
  if (term.kind === 'Constant') { checkSort(term.sort); return term.sort; }
  if (term.kind === 'Bound') {
    const binder = lookup('binders', term.binder), slot = binder.slots?.[term.index];
    if (!Number.isSafeInteger(term.index) || term.index < 0 || !slot) deny('INVALID_TERM', 'bound formal slot is absent');
    return selectedSort(slot.sort);
  }
  if (term.kind === 'Fresh') {
    const occurrence = lookup('fresh', term.occurrence);
    if (canonicalData(derived(term.iteration)) !== canonicalData(occurrence.iterationSort)) deny('INVALID_TERM', 'fresh iteration sort differs from actual allocation plan');
    return selectedSort(occurrence.sort);
  }
  if (term.kind === 'Observation') {
    const observation = lookup('observations', term.occurrence), output = observation.outputs?.[term.outputIndex];
    if (!Number.isSafeInteger(term.outputIndex) || term.outputIndex < 0 || !output ||
        canonicalData(derived(term.receiver)) !== canonicalData(observation.receiverSort) ||
        canonicalData(derived(term.thread)) !== canonicalData(observation.threadSort))
      deny('INVALID_TERM', 'observation receiver/thread/output differs from original selected call');
    return selectedSort(output.sort);
  }
  if (term.kind === 'Projection') {
    const field = lookup('fields', term.fieldDecl);
    if (canonicalData(derived(term.base)) !== canonicalData(field.receiverSort))
      deny('INVALID_TERM', 'projection receiver differs from original field type');
    return field.sort;
  }
  if (term.kind === 'Index') {
    const base = derived(term.base), index = derived(term.index);
    if (base.kind !== 'Seq' || index !== 'Z' || canonicalData(base.element) !== canonicalData(term.elementSort))
      deny('INVALID_TERM', 'index element or offset sort differs');
    return term.elementSort;
  }
  if (term.kind === 'RefTarget') return 'LocId';
  if (term.kind === 'TraceAt') return 'Trace';
  if (term.kind === 'ExceptionAt') return 'ExnId';
  if (term.kind === 'StoreAt') return lookup('locations', term.location).sort;
  if (term.kind !== 'Op') deny('INVALID_TERM', 'untyped closed term');
  const args = term.args.map(derived);
  const same = (left, right) => canonicalData(left) === canonicalData(right);
  const require = condition => { if (!condition) deny('INVALID_TERM', `operand sorts differ for ${term.opcode}`); };
  if (['add', 'sub', 'mul', 'div', 'rem'].includes(term.opcode)) {
    require(args.length === 2 && args.every(sort => same(sort, term.sort)) &&
      (['Z', 'F32', 'F64', 'Decimal'].includes(term.sort) || term.sort.kind === 'BV'));
  } else if (['neg', 'bitnot'].includes(term.opcode)) {
    require(args.length === 1 && same(args[0], term.sort) &&
      (term.opcode === 'neg' && ['Z', 'F32', 'F64', 'Decimal'].includes(term.sort) || term.sort.kind === 'BV'));
  } else if (['bitand', 'bitor', 'bitxor'].includes(term.opcode)) {
    require(args.length === 2 && term.sort.kind === 'BV' && args.every(sort => same(sort, term.sort)));
  } else if (['shl', 'shr'].includes(term.opcode)) {
    require(args.length === 2 && term.sort.kind === 'BV' && same(args[0], term.sort) && args[1] === 'Z');
  } else if (term.opcode === 'bvToZ') {
    // Interpret the operand in its declared signed/unsigned mathematical
    // domain; this is not an unsigned reinterpretation or wrapping cast.
    require(args.length === 1 && args[0]?.kind === 'BV' && term.sort === 'Z');
  } else if (['zLt', 'zGt'].includes(term.opcode)) {
    require(args.length === 2 && args.every(sort => sort === 'Z') && term.sort === 'Bool');
  } else if (['bvEq', 'bvNe', 'bvLt', 'bvLe', 'bvGt', 'bvGe'].includes(term.opcode)) {
    require(args.length === 2 && term.sort === 'Bool' && args[0]?.kind === 'BV' && same(args[0], args[1]));
  } else if (term.opcode === 'ite') {
    require(args.length === 3 && args[0] === 'Bool' && same(args[1], term.sort) && same(args[2], term.sort));
  } else if (term.opcode === 'length') {
    require(args.length === 1 && term.sort === 'Z' &&
      (['UTF16', 'Bytes'].includes(args[0]) || args[0].kind === 'Seq'));
  } else if (term.opcode === 'append') {
    require(args.length === 2 && term.sort.kind === 'Seq' && same(args[0], term.sort) && same(args[1], term.sort.element));
  } else if (term.opcode === 'concat') {
    require(args.length === 2 && args.every(sort => same(sort, term.sort)) &&
      (['UTF16', 'Bytes'].includes(term.sort) || term.sort.kind === 'Seq'));
  } else if (term.opcode === 'contains') {
    require(args.length === 2 && term.sort === 'Bool' && ['Seq', 'Set'].includes(args[0].kind) && same(args[0].element, args[1]));
  } else if (term.opcode === 'setInsert') {
    require(args.length === 2 && term.sort.kind === 'Set' && same(args[0], term.sort) && same(args[1], term.sort.element));
  } else if (term.opcode === 'mapInsert') {
    require(args.length === 3 && term.sort.kind === 'Map' && same(args[0], term.sort) &&
      same(args[1], term.sort.key) && same(args[2], term.sort.value));
  } else if (term.opcode === 'mapLookup') {
    require(args.length === 2 && args[0].kind === 'Map' && same(args[0].key, args[1]) && same(args[0].value, term.sort));
  } else if (term.opcode === 'at') {
    require(args.length === 2 && args[1] === 'Z' &&
      (args[0] === 'UTF16' && same(term.sort, { kind: 'BV', width: 16, signed: false }) ||
       args[0] === 'Bytes' && same(term.sort, { kind: 'BV', width: 8, signed: false }) ||
       args[0]?.kind === 'Seq' && same(term.sort, args[0].element)));
  } else if (term.opcode === 'slice') {
    require(args.length === 3 && args[1] === 'Z' && args[2] === 'Z' &&
      same(args[0], term.sort) && (['UTF16', 'Bytes'].includes(term.sort) || term.sort?.kind === 'Seq'));
  } else if (term.opcode === 'cast') {
    const numeric = sort => ['Z', 'F32', 'F64', 'Decimal'].includes(sort) || sort?.kind === 'BV';
    require(args.length === 1 && numeric(args[0]) && numeric(term.sort));
  } else if (term.opcode === 'tag') {
    require(args.length === 1 && term.sort === 'TypeId');
  } else if (term.opcode === 'default') {
    require(args.length === 0);
  } else if (term.opcode === 'encodeUTF16') {
    require(args.length === 1 && args[0] === 'UTF16' && term.sort === 'Bytes');
  } else if (term.opcode === 'decodeUTF8') {
    require(args.length === 1 && args[0] === 'Bytes' && term.sort === 'UTF16');
  } else if (term.opcode === 'roundIEEE') {
    require(args.length === 1 && ['Z', 'F32', 'F64', 'Decimal'].includes(args[0]) &&
      ['F32', 'F64'].includes(term.sort));
  } else if (term.opcode === 'roundEven') {
    require(args.length === 1 && ['F32', 'F64', 'Decimal'].includes(args[0]) && term.sort === 'Z');
  } else if (term.opcode === 'reverseBits') {
    require(args.length === 2 && args[0]?.kind === 'BV' && !args[0].signed &&
      same(args[0], term.sort) && args[1] === 'Z');
  } else if (term.opcode === 'crcBit') {
    const u32 = { kind: 'BV', width: 32, signed: false };
    require(args.length === 2 && same(args[0], u32) && same(args[1], u32) && same(term.sort, u32));
  } else {
    deny('INVALID_TERM', `unknown closed opcode ${term.opcode}`);
  }
  return term.sort;
}

// Syntax and identity validation is separate from this metadata-derived sort
// judgement. In particular, an Op's claimed result tag is never its proof of
// operand typing, and a same-value equality cannot establish an owner relation.
export function checkTypedFact(fact, identities, metadata, depth = 0) {
  checkFact(fact, identities, depth);
  const sort = value => termSort(value, metadata);
  const same = (left, right) => canonicalData(left) === canonicalData(right);
  const needSort = (value, expected) => {
    if (!same(sort(value), expected)) deny('INVALID_TERM', `${fact.kind} requires ${canonicalData(expected)}`);
  };
  if (['And', 'Or'].includes(fact.kind)) {
    fact.facts.forEach(child => checkTypedFact(child, identities, metadata, depth + 1));
  } else if (fact.kind === 'Not') {
    checkTypedFact(fact.fact, identities, metadata, depth + 1);
  } else if (fact.kind === 'Implies') {
    checkTypedFact(fact.premise, identities, metadata, depth + 1);
    checkTypedFact(fact.conclusion, identities, metadata, depth + 1);
  } else if (['Equal', 'NotEqual', 'LessEqual'].includes(fact.kind)) {
    const left = sort(fact.left), right = sort(fact.right);
    if (!same(left, right)) deny('INVALID_TERM', 'relation operands have different sorts');
    if (fact.kind === 'LessEqual' && !(['Z', 'F32', 'F64', 'Decimal'].includes(left) || left?.kind === 'BV'))
      deny('INVALID_TERM', 'ordering requires a numeric sort');
  } else if (fact.kind === 'TraceEqual') {
    needSort(fact.left, 'Trace'); needSort(fact.right, 'Trace');
  } else if (fact.kind === 'TypeTag') {
    sort(fact.value); needSort(fact.type, 'TypeId');
  } else if (fact.kind === 'HasValue') {
    sort(fact.value);
  } else if (fact.kind === 'DefinedOn') {
    sort(fact.value); needSort(fact.edge, 'EdgeId');
  } else if (['SameLocation', 'SameAllocation', 'SameOwner'].includes(fact.kind)) {
    const expected = { SameLocation: 'LocId', SameAllocation: 'AllocId', SameOwner: 'OwnerId' }[fact.kind];
    needSort(fact.left, expected); needSort(fact.right, expected);
  } else if (fact.kind === 'Footprint') {
    needSort(fact.before, 'StateId'); needSort(fact.after, 'StateId');
    needSort(fact.locations, { kind: 'Seq', element: 'LocId' });
  } else if (['Rooted', 'Closed'].includes(fact.kind)) {
    needSort(fact.owner, 'OwnerId'); needSort(fact.state, 'StateId');
  } else if (fact.kind === 'Attempted') {
    needSort(fact.owner, 'OwnerId'); needSort(fact.declaration, 'DeclId');
    needSort(fact.ordinal, 'Z'); needSort(fact.state, 'StateId');
  } else if (fact.kind === 'Pending') {
    needSort(fact.owner, 'OwnerId'); needSort(fact.occurrence, 'OccId'); needSort(fact.state, 'StateId');
  } else if (fact.kind === 'Completion') {
    needSort(fact.target, 'EdgeId'); sort(fact.value); needSort(fact.exception, 'ExnId');
  } else deny('INVALID_TERM', 'unknown typed fact judgement');
}

export function normalizeAffine(term) {
  const coefficients = new Map();
  let constant = 0n;
  function add(value, scale) {
    if (value.sort !== 'Z') deny('INVALID_TERM', 'affine arithmetic requires exact Z terms');
    if (value.kind === 'Constant') {
      if (typeof value.value !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(value.value))
        deny('INVALID_TERM', 'Z constant must be a canonical integer');
      constant += BigInt(value.value) * scale;
    } else if (value.kind === 'Bound') {
      const key = canonicalData(value);
      coefficients.set(key, (coefficients.get(key) ?? 0n) + scale);
    } else if (value.kind === 'Op' && value.opcode === 'add' && value.args.length === 2) {
      add(value.args[0], scale); add(value.args[1], scale);
    } else if (value.kind === 'Op' && value.opcode === 'sub' && value.args.length === 2) {
      add(value.args[0], scale); add(value.args[1], -scale);
    } else if (value.kind === 'Op' && value.opcode === 'neg' && value.args.length === 1) {
      add(value.args[0], -scale);
    } else if (value.kind === 'Op' && value.opcode === 'mul' && value.args.length === 2 &&
      value.args.some(argument => argument.kind === 'Constant' && argument.sort === 'Z')) {
      const constantIndex = value.args[0].kind === 'Constant' ? 0 : 1;
      const factor = normalizeAffine(value.args[constantIndex]);
      if (factor.coefficients.length) deny('UNPROVED', 'nonconstant affine multiplier');
      add(value.args[1 - constantIndex], scale * BigInt(factor.constant));
    } else deny('UNPROVED', 'nonlinear or unsupported affine term');
  }
  add(term, 1n);
  return { constant: constant.toString(), coefficients: [...coefficients]
    .filter(([, value]) => value !== 0n).sort(([a], [b]) => a.localeCompare(b))
    .map(([atom, coefficient]) => ({ atom, coefficient: coefficient.toString() })) };
}

export function foldBitvectorComparison(opcode, sort, operands) {
  checkSort(sort);
  if (sort.kind !== 'BV' || !['bvEq', 'bvNe', 'bvLt', 'bvLe', 'bvGt', 'bvGe'].includes(opcode) ||
      !Array.isArray(operands) || operands.length !== 2)
    deny('INVALID_TERM', 'exact binary bitvector comparison required');
  const modulus = 1n << BigInt(sort.width), lower = sort.signed ? -modulus / 2n : 0n;
  const upper = sort.signed ? modulus / 2n - 1n : modulus - 1n;
  const values = operands.map(value => {
    if (typeof value !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(value) || value === '-0')
      deny('INVALID_TERM', 'noncanonical comparison operand');
    const original = BigInt(value);
    if (original < lower || original > upper) deny('INVALID_TERM', 'comparison operand differs from its signed or unsigned BV domain');
    return original;
  });
  const [left, right] = values;
  return opcode === 'bvEq' ? left === right : opcode === 'bvNe' ? left !== right :
    opcode === 'bvLt' ? left < right : opcode === 'bvLe' ? left <= right :
      opcode === 'bvGt' ? left > right : left >= right;
}

export function foldBitvector(opcode, sort, operands) {
  checkSort(sort);
  if (sort.kind !== 'BV' || !opcodes.has(opcode)) deny('INVALID_TERM', 'bitvector operation or sort required');
  const width = BigInt(sort.width), modulus = 1n << width, mask = modulus - 1n;
  const raw = operands.map(value => {
    if (typeof value !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(value)) deny('INVALID_TERM', 'noncanonical bitvector operand');
    return BigInt(value);
  });
  const unary = ['neg', 'bitnot'].includes(opcode);
  if (raw.length !== (unary ? 1 : 2)) deny('INVALID_TERM', 'bitvector operand arity differs');
  let result;
  switch (opcode) {
    case 'add': result = raw[0] + raw[1]; break;
    case 'sub': result = raw[0] - raw[1]; break;
    case 'mul': result = raw[0] * raw[1]; break;
    case 'neg': result = -raw[0]; break;
    case 'bitand': result = raw[0] & raw[1]; break;
    case 'bitor': result = raw[0] | raw[1]; break;
    case 'bitxor': result = raw[0] ^ raw[1]; break;
    case 'bitnot': result = ~raw[0]; break;
    case 'shl': case 'shr':
      if (raw[1] < 0n || raw[1] >= width) deny('UNPROVED', 'unproved shift domain');
      result = opcode === 'shl' ? raw[0] << raw[1] : raw[0] >> raw[1]; break;
    case 'div': case 'rem':
      if (raw[1] === 0n) return { alternative: 'divideByZero' };
      result = opcode === 'div' ? raw[0] / raw[1] : raw[0] % raw[1]; break;
    default: deny('UNPROVED', 'unsupported constant bitvector equation');
  }
  const unsigned = result & mask;
  const value = sort.signed && unsigned >= modulus / 2n ? unsigned - modulus : unsigned;
  const lower = sort.signed ? -modulus / 2n : 0n;
  const upper = sort.signed ? modulus / 2n - 1n : mask;
  return { alternative: 'normal', value: value.toString(), overflow: result < lower || result > upper };
}

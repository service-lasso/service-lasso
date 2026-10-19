import { deny, exactKeys } from './core1681-source-input.mjs';
import { enumerateForest, parseSourceForest } from './core1681-source-forest.mjs';
import { FIXED_FOUNDATION_CATALOGUES, CATALOGUE_GROUP_DISPOSITION } from './core1681-source-catalogues.mjs';

export const CONDITION_VERSION = 'R23456-1';
export const DECLARATION_VERSION = 'R6-DECLID-1';
export const ADAPTERS = Object.freeze(['CA-INIT-TOKEN-1', 'CA-INIT-NPM-1', 'CA-SDK-INIT-1',
  'CA-RESOURCE-1', 'CA-COMMAND-1', 'CA-STDERR-1']);
export const SELECTED_INPUTS = Object.freeze([
  ['L-managed', 'language', 'csharp', 'CS-FINITE-2/CLR48'],
  ['L-acquisition', 'language', 'csharp', 'CS-FINITE-2/CLR48'],
  ['L-msi', 'language', 'csharp', 'CS-FINITE-2/CLR48'],
  ['L-trust', 'language', 'csharp', 'CS-FINITE-2/CLR48'],
  ['L-opc', 'language', 'csharp', 'CS-FINITE-2/CLR48'],
  ['L-vsix', 'language', 'csharp', 'CS-FINITE-2/CLR-MODERN-VSIX'],
  ['L-bootstrap', 'language', 'c', 'C-WIN-FINITE-2/C-SDK2/CRT/LLP64'],
  ['L-budget', 'language', 'powershell', 'PS-BUDGET-FINITE-2/PS-NUM2'],
  ['CE-tests', 'callerEvidence', 'javascript', 'CE-JS-2'],
  ['CE-packaged', 'callerEvidence', 'javascript', 'CE-JS-2'],
  ['CE-compiler', 'callerEvidence', 'powershell', 'CE-PS-2'],
  ['H-current', 'originalHelper', 'javascript', 'CE-JS-2'],
  ['CE-assets', 'callerEvidence', 'javascript', 'CE-JS-2'],
  ['CD-mcp', 'callerDependency', 'javascript', 'CE-JS-2'],
]);

function ordinal(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(ordinal).map(key => [key, canonical(value[key])]));
  return value;
}
function same(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }
function compareStructure(a, b) {
  if (a === b) return 0;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let index = 0; index < Math.min(a.length, b.length); index++) { const result = compareStructure(a[index], b[index]); if (result) return result; }
    return a.length - b.length;
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return ordinal(a, b);
  if (a && b && typeof a === 'object' && typeof b === 'object') return compareStructure(Object.entries(canonical(a)), Object.entries(canonical(b)));
  return ordinal(JSON.stringify(a), JSON.stringify(b));
}
function nonempty(value, label) { if (typeof value !== 'string' || !value.length) deny('INVALID_INPUT', `${label} must be a nonempty string`); }

// No digest/name whitelist is an admission proof: bytes are mandatory and copied
// before parsing. Source version is a selected immutable identity, not a claim
// that a supplied hash proves syntax, ownership, native ABI or runtime effects.
export function admitBundle(input) {
  exactKeys(input, ['schema', 'conditionVersion', 'declarationIdentityVersion', 'adapters', 'units'], 'bundle');
  if (input.schema !== 'core1681.foundationInput.v1' || input.conditionVersion !== CONDITION_VERSION ||
      input.declarationIdentityVersion !== DECLARATION_VERSION || !same(input.adapters, ADAPTERS) ||
      !Array.isArray(input.units) || input.units.length !== SELECTED_INPUTS.length) deny('INVALID_INPUT', 'whole fourteen-member selection/version/adapters mismatch');
  return input.units.map((unit, ordinal) => {
    exactKeys(unit, ['id', 'inventoryClass', 'language', 'profile', 'version', 'conditions', 'rawBytes'], `unit ${ordinal}`);
    const [id, inventoryClass, language, profile] = SELECTED_INPUTS[ordinal];
    if (unit.id !== id || unit.inventoryClass !== inventoryClass || unit.language !== language || unit.profile !== profile) deny('INVALID_INPUT', `unit selection at ${ordinal}`);
    nonempty(unit.version, 'source version');
    if (!Array.isArray(unit.conditions) || unit.conditions.some(condition => typeof condition !== 'string') ||
        new Set(unit.conditions).size !== unit.conditions.length || !(unit.rawBytes instanceof Uint8Array)) deny('INVALID_INPUT', `${id} conditions/raw bytes`);
    return { identity: { id, inventoryOrdinal: ordinal, inventoryClass, language, profile,
      version: unit.version, conditions: [...unit.conditions], conditionVersion: CONDITION_VERSION,
      declarationIdentityVersion: DECLARATION_VERSION }, rawBytes: Uint8Array.from(unit.rawBytes) };
  });
}

const catalogueKeys = ['unit', 'inventoryOrdinal', 'profile', 'version', 'conditions', 'complete', 'types', 'members'];
const typeKeys = ['namespace', 'name', 'arity', 'kind', 'typeParameters', 'constraints', 'modifiers',
  'attributes', 'bases', 'interfaces', 'implicitSlots', 'initializer'];
const memberKeys = ['parent', 'kind', 'name', 'arity', 'type', 'returnType', 'receiver', 'static',
  'typeParameters', 'constraints', 'parameters', 'modifiers', 'attributes', 'explicitInterface',
  'implicitSlots', 'initializer', 'effects'];
const effectKeys = ['normal', 'status', 'ordinaryThrow', 'nonreturn', 'callbacks', 'writes',
  'aliases', 'iteration', 'initializerTrigger', 'ownerPremises'];
const parameterKeys = ['name', 'type', 'direction', 'params', 'defaultValue', 'attributes'];

function referenceKey(ref) { return JSON.stringify(canonical(ref)); }
function checkTypeReference(ref, paths, parameters = []) {
  if (ref === null) return;
  if (!ref || typeof ref !== 'object') deny('CATALOGUE_MISMATCH', 'type descriptor missing');
  if (ref.kind === 'void') { exactKeys(ref, ['kind'], 'void type'); return; }
  if (ref.kind === 'dynamic') {
    exactKeys(ref, ['kind', 'profile', 'sort'], 'dynamic type');
    if (ref.profile !== 'CE-JS-2' || ref.sort !== 'Any') deny('CATALOGUE_MISMATCH', 'dynamic sort'); return;
  }
  if (ref.kind === 'parameter') {
    exactKeys(ref, ['kind', 'index'], 'parameter type');
    if (!Number.isSafeInteger(ref.index) || ref.index < 0 || ref.index >= parameters.length) deny('CATALOGUE_MISMATCH', 'generic parameter reference'); return;
  }
  if (['array', 'pointer', 'nullable'].includes(ref.kind)) {
    exactKeys(ref, ref.kind === 'array' ? ['kind', 'element', 'rank'] : ['kind', 'element'], 'constructed type');
    if (ref.kind === 'array' && (!Number.isSafeInteger(ref.rank) || ref.rank < 1)) deny('CATALOGUE_MISMATCH', 'array rank');
    checkTypeReference(ref.element, paths, parameters); return;
  }
  exactKeys(ref, ['kind', 'path', 'arguments'], 'catalogue named type');
  if (ref.kind !== 'named' || !Array.isArray(ref.path) || !Array.isArray(ref.arguments)) deny('CATALOGUE_MISMATCH', 'named type shape');
  const target = paths.get(referenceKey(ref.path));
  if (!target || ref.arguments.length !== target.arity) deny('CATALOGUE_MISMATCH', 'unknown type or generic arity');
  for (const argument of ref.arguments) checkTypeReference(argument, paths, parameters);
}
function checkFiniteData(value, label) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (Array.isArray(value)) { for (const item of value) checkFiniteData(item, label); return; }
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    for (const item of Object.values(value)) checkFiniteData(item, label); return;
  }
  deny('CATALOGUE_MISMATCH', `${label} contains non-finite/non-data metadata`);
}
function checkEffects(member, catalogue) {
  exactKeys(member.effects, effectKeys, 'catalogue effects');
  for (const sort of effectKeys) if (!Array.isArray(member.effects[sort])) deny('CATALOGUE_MISMATCH', `effects ${sort}`);
  const tags = { normal: ['returnVoid', 'finiteValuePartition'], ordinaryThrow: ['ordinaryThrow'], writes: ['receiverField'] };
  for (const sort of effectKeys) {
    const alternatives = member.effects[sort], seen = new Set();
    if (!Array.isArray(alternatives)) deny('CATALOGUE_MISMATCH', `effects ${sort}`);
    for (const alternative of alternatives) {
      if (!alternative || Object.getPrototypeOf(alternative) !== Object.prototype || !(tags[sort] ?? []).includes(alternative.kind))
        deny('CATALOGUE_MISMATCH', `unknown/wrong-sort ${sort} effect tag`);
      const key = referenceKey(alternative);
      if (seen.has(key)) deny('CATALOGUE_MISMATCH', 'duplicate effect alternative'); seen.add(key);
      if (alternative.kind === 'returnVoid') {
        exactKeys(alternative, ['kind', 'receiver'], 'returnVoid effect');
        if (member.kind !== 'constructor' || member.returnType?.kind !== 'void' || member.receiver !== 'instance' ||
            alternative.receiver !== 'sameFreshReceiver') deny('CATALOGUE_MISMATCH', 'constructor return/receiver relation');
      } else if (alternative.kind === 'ordinaryThrow') {
        exactKeys(alternative, ['kind', 'exception', 'origin', 'sameExceptionPropagates'], 'ordinaryThrow effect');
        if (member.kind !== 'constructor' || alternative.exception !== 'freshOrdinaryExn' ||
            alternative.origin !== 'constructor-allocation-or-runtime' || alternative.sameExceptionPropagates !== true)
          deny('CATALOGUE_MISMATCH', 'ordinary exception identity/origin relation');
      } else if (alternative.kind === 'receiverField') {
        exactKeys(alternative, ['kind', 'path', 'value', 'frame'], 'receiverField effect');
        exactKeys(alternative.value, ['kind', 'index'], 'receiverField value');
        if (member.receiver !== 'instance' || member.static || member.kind !== 'constructor' ||
            !same(alternative.path, ['Message']) || alternative.frame !== 'receiverExceptionState' ||
            alternative.value.kind !== 'formal' || !Number.isSafeInteger(alternative.value.index) || alternative.value.index < 0 ||
            !same(member.parameters[alternative.value.index]?.type, { kind: 'named', path: ['System', 'String'], arguments: [] }) ||
            ![ ['System', 'SystemException'], ['System', 'IO', 'InvalidDataException'] ].some(path => same(path, member.parent)))
          deny('CATALOGUE_MISMATCH', 'receiver field/frame/formal relation');
      } else {
        exactKeys(alternative, ['kind', 'operation', 'falseCases', 'trueCases', 'coercion', 'nativeOwnerConsequence'], 'finiteValuePartition effect');
        const operation = alternative.operation, any = { kind: 'dynamic', profile: 'CE-JS-2', sort: 'Any' };
        const falsy = ['undefined', 'null', 'false', 'positiveZero', 'negativeZero', 'NaN', 'emptyString', 'zeroBigInt'];
        if (!['Truth', 'Nullish'].includes(operation) || catalogue.profile !== 'CE-JS-foundation-1' ||
            member.kind !== 'method' || member.name !== operation || !same(member.parent, ['JS', 'ValueOperations']) ||
            !member.static || member.receiver !== 'none' || member.parameters.length !== 1 ||
            !same(member.parameters[0].type, any) || !same(member.returnType, any) ||
            !same(alternative.falseCases, operation === 'Truth' ? falsy : ['allOtherValues']) ||
            !same(alternative.trueCases, operation === 'Truth' ? ['allOtherValues'] : ['undefined', 'null']) ||
            alternative.coercion !== 'none' || alternative.nativeOwnerConsequence !== 'none')
          deny('CATALOGUE_MISMATCH', 'contradictory/incomplete Truth/Nullish partition relation');
        if (member.effects.normal.length !== 1 || effectKeys.some(sort => sort !== 'normal' && member.effects[sort].length))
          deny('CATALOGUE_MISMATCH', 'finite value partition cannot have conflicting effects');
      }
    }
  }
}

// A catalogue is a finite structured forest. Full row metadata/effect partitions
// are mandatory; missing rows/targets/alternatives do not become free primitives.
// Completeness against a selected installed profile is deliberately separate.
export function validateCatalogue(catalogue) {
  checkFiniteData(catalogue, 'catalogue');
  exactKeys(catalogue, catalogueKeys, 'catalogue');
  for (const key of ['unit', 'profile', 'version']) nonempty(catalogue[key], key);
  if (catalogue.complete !== true || !Array.isArray(catalogue.conditions) ||
      !Array.isArray(catalogue.types) || !Array.isArray(catalogue.members) || !Number.isSafeInteger(catalogue.inventoryOrdinal) ||
      catalogue.inventoryOrdinal < 0 || catalogue.conditions.some(value => typeof value !== 'string') ||
      new Set(catalogue.conditions).size !== catalogue.conditions.length) deny('INCOMPLETE_CATALOGUE', 'complete finite descriptors/selection required');
  const paths = new Map(), definitions = new Set();
  for (const type of catalogue.types) {
    exactKeys(type, typeKeys, 'catalogue type');
    if (!Array.isArray(type.namespace) || type.namespace.some(segment => typeof segment !== 'string' || !segment.length) ||
        typeof type.name !== 'string' || !type.name || !Number.isSafeInteger(type.arity) || type.arity < 0 ||
        !['class', 'struct', 'interface', 'enum', 'delegate', 'primitive'].includes(type.kind) ||
        !Array.isArray(type.typeParameters) || type.typeParameters.length !== type.arity) deny('CATALOGUE_MISMATCH', 'type identity/arity');
    const key = referenceKey([...type.namespace, type.name]);
    // This subprofile explicitly denies same-path generic overloads rather than
    // resolving one by dictionary insertion order.
    if (paths.has(key)) deny('CATALOGUE_MISMATCH', 'duplicate or ambiguous type path'); paths.set(key, type);
    if (type.arity) deny('UNSUPPORTED_CATALOGUE', 'generic catalogue TypeId/constraint closure is not implemented');
    for (const key of ['constraints', 'modifiers', 'attributes', 'bases', 'interfaces', 'implicitSlots']) if (!Array.isArray(type[key])) deny('CATALOGUE_MISMATCH', `type ${key}`);
    if (type.implicitSlots.length || type.constraints.length || type.attributes.length) deny('UNSUPPORTED_CATALOGUE', 'catalogue implicit/constraint/attribute metadata lowering not implemented');
    if (type.modifiers.some(value => typeof value !== 'string') || new Set(type.modifiers).size !== type.modifiers.length) deny('CATALOGUE_MISMATCH', 'type modifiers');
  }
  for (const type of catalogue.types) {
    for (const base of [...type.bases, ...type.interfaces]) checkTypeReference(base, paths, type.typeParameters);
    if (type.initializer !== null) deny('UNSUPPORTED_CATALOGUE', 'catalogue type initializer requires explicit checked transfer');
  }
  for (const member of catalogue.members) {
    exactKeys(member, memberKeys, 'catalogue member');
    if (!paths.has(referenceKey(member.parent)) || !['constructor', 'method', 'property', 'field', 'export'].includes(member.kind) ||
        typeof member.name !== 'string' || !member.name || !Number.isSafeInteger(member.arity) || member.arity < 0 ||
        !['none', 'instance'].includes(member.receiver) || typeof member.static !== 'boolean' ||
        !Array.isArray(member.typeParameters) || member.typeParameters.length !== member.arity || !Array.isArray(member.parameters)) deny('CATALOGUE_MISMATCH', 'member identity/signature');
    for (const key of ['constraints', 'modifiers', 'attributes', 'implicitSlots']) if (!Array.isArray(member[key])) deny('CATALOGUE_MISMATCH', `member ${key}`);
    if (member.arity) deny('UNSUPPORTED_CATALOGUE', 'generic catalogue formal substitution is not implemented');
    if (member.implicitSlots.length || member.constraints.length || member.attributes.length || member.initializer !== null || member.explicitInterface !== null) deny('UNSUPPORTED_CATALOGUE', 'unimplemented implicit/constraint/attribute/initializer/interface descriptor');
    if (member.modifiers.some(value => typeof value !== 'string') || new Set(member.modifiers).size !== member.modifiers.length) deny('CATALOGUE_MISMATCH', 'member modifiers');
    checkTypeReference(member.type, paths, member.typeParameters); checkTypeReference(member.returnType, paths, member.typeParameters);
    for (const parameter of member.parameters) {
      exactKeys(parameter, parameterKeys, 'catalogue formal');
      if (typeof parameter.name !== 'string' || !['value', 'ref', 'out', 'in'].includes(parameter.direction) ||
          typeof parameter.params !== 'boolean' || !Array.isArray(parameter.attributes) || parameter.attributes.length) deny('CATALOGUE_MISMATCH', 'formal direction/attributes');
      if (parameter.defaultValue?.kind !== 'absent') deny('UNSUPPORTED_CATALOGUE', 'catalogue optional default constant checking not implemented');
      checkTypeReference(parameter.type, paths, member.typeParameters);
    }
    checkEffects(member, catalogue);
    if ((member.static && member.receiver !== 'none') || (!member.static && member.receiver !== 'instance')) deny('CATALOGUE_MISMATCH', 'receiver/static mismatch');
    if (!member.effects.normal.length && !member.effects.ordinaryThrow.length && !member.effects.nonreturn.length) deny('INCOMPLETE_CATALOGUE', 'member has no completion alternatives');
    const identity = referenceKey([member.parent, member.kind, member.name, member.arity,
      member.parameters.map(parameter => [parameter.direction, parameter.type]), member.returnType, member.modifiers, member.attributes]);
    if (definitions.has(identity)) deny('CATALOGUE_MISMATCH', 'duplicate member definition'); definitions.add(identity);
  }
  const identity = { id: catalogue.unit, inventoryOrdinal: catalogue.inventoryOrdinal, inventoryClass: 'importedCatalogue', language: 'catalogue', profile: catalogue.profile,
    version: catalogue.version, conditions: [...catalogue.conditions], conditionVersion: CONDITION_VERSION, declarationIdentityVersion: DECLARATION_VERSION };
  const counters = new Map(), entries = [], typeIds = new Map();
  function allocate(parent, descriptor, kind) {
    const key = referenceKey(parent), index = counters.get(key) ?? 0; counters.set(key, index + 1);
    const declId = { unit: identity, parent, index };
    entries.push({ declId, kind, descriptor, origin: { kind: 'importedCatalogue', noSpan: true,
      profile: catalogue.profile, version: catalogue.version, descriptor: structuredClone(descriptor) } }); return declId;
  }
  const sortedTypes = [...catalogue.types].sort((a, b) => compareStructure([a.namespace, a.name, a.arity, a.kind], [b.namespace, b.name, b.arity, b.kind]));
  for (const type of sortedTypes) {
    const typeId = allocate({ namespace: type.namespace, types: [] }, type, 'type');
    typeIds.set(referenceKey([...type.namespace, type.name]), typeId);
    for (const [index, name] of type.typeParameters.entries()) {
      if (typeof name !== 'string' || !name.length || type.typeParameters.indexOf(name) !== index) deny('CATALOGUE_MISMATCH', 'type parameter identity');
      allocate({ namespace: type.namespace, types: [typeId] }, { name, ordinal: index, semanticOwner: typeId }, 'typeParameter');
    }
  }
  const sortedMembers = [...catalogue.members].sort((a, b) => compareStructure([a.parent, a.kind, a.name, a.arity,
    a.parameters.map(parameter => [parameter.direction, parameter.type]), a.returnType, a.modifiers, a.attributes], [b.parent, b.kind, b.name, b.arity,
    b.parameters.map(parameter => [parameter.direction, parameter.type]), b.returnType, b.modifiers, b.attributes]));
  for (const member of sortedMembers) {
    const parentType = typeIds.get(referenceKey(member.parent)), parent = { namespace: parentType.parent.namespace, types: [parentType] };
    const memberId = allocate(parent, member, member.kind);
    for (const [index, name] of member.typeParameters.entries()) {
      if (typeof name !== 'string' || !name.length || member.typeParameters.indexOf(name) !== index) deny('CATALOGUE_MISMATCH', 'method type parameter identity');
      allocate(parent, { name, ordinal: index, semanticOwner: memberId }, 'typeParameter');
    }
    for (const parameter of member.parameters) allocate(parent, { ...parameter, semanticOwner: memberId }, 'parameter');
  }
  function resolved(type) {
    if (type === null || ['void', 'dynamic', 'parameter'].includes(type.kind)) return structuredClone(type);
    if (['array', 'pointer', 'nullable'].includes(type.kind)) return { ...type, element: resolved(type.element) };
    return { kind: 'imported', declaration: typeIds.get(referenceKey(type.path)), arguments: type.arguments.map(resolved) };
  }
  const bindings = entries.map(entry => {
    const row = entry.descriptor, parent = entry.declId.parent;
    return { declId: entry.declId, kind: entry.kind, name: row.name, origin: entry.origin,
      semanticOwner: row.semanticOwner ? { kind: 'declaration', declaration: row.semanticOwner }
        : parent.types.length ? { kind: 'declaration', declaration: parent.types.at(-1) } : { kind: 'namespace', segments: parent.namespace },
      type: entry.kind === 'type' ? { kind: 'imported', declaration: entry.declId, arguments: [] } : resolved(row.type ?? null),
      returnType: resolved(row.returnType ?? null), receiver: row.receiver ?? 'none', static: row.static ?? false,
      category: row.kind ?? entry.kind, typeParameters: entries.filter(child => child.kind === 'typeParameter' && same(child.descriptor.semanticOwner, entry.declId)).map(child => child.declId),
      constraints: structuredClone(row.constraints ?? []), parameters: entries.filter(child => child.kind === 'parameter' && same(child.descriptor.semanticOwner, entry.declId)).map(child => ({ declaration: child.declId,
        type: resolved(child.descriptor.type), direction: child.descriptor.direction, params: child.descriptor.params, defaultValue: child.descriptor.defaultValue, attributes: child.descriptor.attributes })),
      modifiers: structuredClone(row.modifiers ?? []), attributes: structuredClone(row.attributes ?? []), direction: row.direction ?? 'value',
      params: row.params ?? false, defaultValue: row.defaultValue ?? null, bases: (row.bases ?? []).map(resolved), interfaces: (row.interfaces ?? []).map(resolved),
      explicitInterface: row.explicitInterface ?? null, initializer: row.initializer ?? null, initializerTiming: null,
      accessors: [], backing: [], captures: [], import: null, referenceBindings: [], implicitSlots: [], enumConstant: null,
      effects: structuredClone(row.effects ?? null) };
  });
  return { catalogue: structuredClone(catalogue), identity, paths, typeIds, entries, bindings,
    structurallyComplete: true, closedFoundationEffectSubset: true, completeSelectedEffectCatalogue: false, authenticInstalledProfile: false };
}

const csAliases = new Map([['bool', ['System', 'Boolean']], ['int', ['System', 'Int32']],
  ['string', ['System', 'String']], ['object', ['System', 'Object']]]);
function sourceTypeChain(node) {
  const chain = [];
  for (let owner = node; owner; owner = owner.owner) if (owner.kind === 'type') chain.unshift(owner);
  return chain;
}
function sourceTypePath(node) { return [...node.namespace, ...sourceTypeChain(node).map(owner => owner.name)]; }
function accessibleSourceType(target, node) {
  const lexical = sourceTypeChain(node);
  for (const component of sourceTypeChain(target)) {
    const enclosing = sourceTypeChain(component).slice(0, -1).at(-1);
    const access = component.modifiers.find(value => ['public', 'private', 'internal', 'protected'].includes(value))
      ?? (enclosing?.category === 'interface' ? 'public' : enclosing ? 'private' : 'internal');
    if (access === 'public' || access === 'internal') continue; // Same source Unit/assembly subset.
    // Derived-type accessibility is outside this no-explicit-bases subprofile.
    if (!enclosing || !lexical.includes(enclosing)) return false;
  }
  return true;
}
function resolveType(type, node, forest, catalogues, allowBareVoid = false) {
  if (type === null) return null;
  if (type.kind === 'void' || type.kind === 'named' && type.path.length === 1 && type.path[0] === 'void') {
    if (!allowBareVoid) deny('INCOMPLETE_BINDING', 'void is only a bare return category', node.origin);
    return { kind: 'void' };
  }
  if (type.kind === 'dynamic') return structuredClone(type);
  if (type.kind === 'sourceType') {
    const declaration = type.declaration ?? node;
    if (!declaration.declId || declaration.kind !== 'type') deny('INCOMPLETE_BINDING', 'source TypeId missing');
    return { kind: 'source', declaration: declaration.declId, arguments: declaration.typeParameters.map(parameter => ({ kind: 'parameter', declaration: parameter.declId })) };
  }
  if (type.kind === 'typeParameter') return { kind: 'parameter', declaration: node.declId };
  if (['array', 'nullable'].includes(type.kind)) {
    const element = resolveType(type.element, node, forest, catalogues);
    if (type.kind === 'nullable') {
      const source = element.kind === 'source' ? forest.entries.find(row => same(row.declId, element.declaration)) : null;
      const imported = element.kind === 'imported' ? catalogues.flatMap(catalogue => [...catalogue.paths.entries()]
        .filter(([key]) => same(catalogue.typeIds.get(key), element.declaration)).map(([, row]) => row)) : [];
      if (!(source && ['struct', 'enum'].includes(source.category)) &&
          !(imported.length === 1 && ['struct', 'enum'].includes(imported[0].kind)))
        deny('INCOMPLETE_BINDING', 'nullable requires an admitted nonnullable value type', node.origin);
    }
    return { ...type, element };
  }
  if (type.kind !== 'named') deny('INCOMPLETE_BINDING', 'unsupported type descriptor');
  let owner = node;
  while (owner) {
    const parameter = owner.typeParameters?.find(row => row.name === type.path[0]);
    if (parameter) {
      if (type.path.length !== 1 || type.arguments.length) deny('INCOMPLETE_BINDING', 'type parameter cannot have nested path or generic arguments');
      return { kind: 'parameter', declaration: parameter.declId };
    }
    owner = owner.owner;
  }
  const alias = type.path.length === 1 ? csAliases.get(type.path[0]) : null;
  const path = alias ?? type.path;
  const sourceTypes = forest.entries.filter(row => row.kind === 'type');
  const tiers = alias ? [path] : sourceTypeChain(node).reverse().map(owner => [...sourceTypePath(owner), ...path]);
  if (!alias) for (let length = node.namespace.length; length >= 0; length--) tiers.push([...node.namespace.slice(0, length), ...path]);
  let matches = [];
  for (const tier of tiers) {
    matches = sourceTypes.filter(row => same(sourceTypePath(row), tier));
    if (matches.length) break; // Nearest lexical owner wins; never flatten foreign nested types.
  }
  const imports = catalogues.flatMap(catalogue => [...catalogue.paths.entries()].filter(([key]) => key === referenceKey(path)).map(([key, row]) => ({ catalogue, key, row })));
  if (matches.length && imports.length) deny('SOURCE_SHADOW', `source declaration shadows protected ${path.join('.')}`);
  if (matches.length === 1 && !imports.length) {
    if (matches[0].category === 'class' && matches[0].modifiers.includes('static'))
      deny('INCOMPLETE_BINDING', 'static class cannot be a constituent type', node.origin);
    if (!accessibleSourceType(matches[0], node)) deny('INCOMPLETE_BINDING', 'inaccessible source TypeId');
    if (type.arguments.length !== matches[0].typeParameters.length) deny('INCOMPLETE_BINDING', 'source generic arity mismatch');
    const enclosing = sourceTypeChain(matches[0]).slice(0, -1);
    if (enclosing.some(owner => owner.typeParameters.length && !sourceTypeChain(node).includes(owner)))
      deny('INCOMPLETE_BINDING', 'qualified constructed enclosing generic type is outside foundation syntax');
    return { kind: 'source', declaration: matches[0].declId, arguments: type.arguments.map(argument => resolveType(argument, node, forest, catalogues)) };
  }
  if (imports.length === 1 && !matches.length) {
    if (type.arguments.length !== imports[0].row.arity) deny('INCOMPLETE_BINDING', 'catalogue generic arity mismatch');
    return { kind: 'imported', declaration: imports[0].catalogue.typeIds.get(imports[0].key), arguments: type.arguments.map(argument => resolveType(argument, node, forest, catalogues)) };
  }
  deny('INCOMPLETE_BINDING', `missing/ambiguous exact TypeId ${path.join('.')}`);
}

function scopeId(scope) {
  if (scope?.declId) return { kind: 'declaration', declaration: scope.declId };
  if (scope?.kind === 'block') return { kind: 'block', ordinal: scope.ordinal, origin: scope.origin, owner: scopeId(scope.owner) };
  if (scope?.kind === 'namespace') return { kind: 'namespace', segments: scope.namespace };
  return { kind: 'unitRoot' };
}
function lookup(scope, name) {
  while (scope) {
    const matches = [...scope.children, ...(scope.synthetics ?? [])].filter(row => row.kind !== 'block' && row.kind !== 'namespace' && row.name === name);
    if (matches.length > 1) deny('AMBIGUOUS_BINDING', `lexical ${name}`);
    if (matches.length) return matches[0];
    scope = scope.owner;
  }
  return null;
}

// This is declaration binding, not expression typing/CFG/proof discharge. Every
// record below is recomputed from an owned parse; caller-supplied rows never enter.
export function bindSource(rawBytes, identity, catalogueInputs = []) {
  exactKeys(identity, ['id', 'inventoryOrdinal', 'inventoryClass', 'language', 'profile', 'version', 'conditions', 'conditionVersion', 'declarationIdentityVersion'], 'source Unit identity');
  if (identity.conditionVersion !== CONDITION_VERSION || identity.declarationIdentityVersion !== DECLARATION_VERSION ||
      !Number.isSafeInteger(identity.inventoryOrdinal) || identity.inventoryOrdinal < 0 || !Array.isArray(identity.conditions)) deny('INVALID_INPUT', 'source Unit versions/ordinal/conditions');
  for (const key of ['id', 'inventoryClass', 'language', 'profile', 'version']) nonempty(identity[key], key);
  if (!SELECTED_INPUTS.some(row => row[2] === identity.language && row[3] === identity.profile) ||
      identity.conditions.some(condition => typeof condition !== 'string') || new Set(identity.conditions).size !== identity.conditions.length) deny('INVALID_INPUT', 'exact frontend profile/condition selection required');
  const parsed = parseSourceForest(rawBytes, identity.language), forest = enumerateForest(parsed, structuredClone(identity));
  const catalogues = catalogueInputs.map(input => {
    const fixed = FIXED_FOUNDATION_CATALOGUES.find(row => row.unit === input.unit);
    if (!fixed || !same(input, fixed)) deny('CATALOGUE_MISMATCH', 'only exact fixed foundation catalogue descriptors may bind');
    return validateCatalogue(input);
  });
  if (new Set(catalogues.map(row => row.identity.id)).size !== catalogues.length) deny('CATALOGUE_MISMATCH', 'duplicate catalogue selection');
  for (const catalogue of catalogues) {
    const applicable = identity.language === 'javascript' ? catalogue.identity.profile === 'CE-JS-foundation-1'
      : identity.profile.includes('CLR-MODERN-VSIX') ? catalogue.identity.profile === 'CLR-MODERN-VSIX-foundation-1'
        : catalogue.identity.profile === 'CLR48-foundation-1';
    if (!applicable) deny('CATALOGUE_MISMATCH', 'catalogue/source selected profile mismatch');
  }
  const typePaths = new Set();
  for (const entry of forest.entries) {
    if (entry.kind === 'type') {
      const path = referenceKey(sourceTypePath(entry)), sourcePath = referenceKey([entry.declId.parent, entry.name]);
      if (typePaths.has(sourcePath)) deny('AMBIGUOUS_BINDING', 'duplicate C# type declaration requires unsupported partial semantics', entry.origin);
      typePaths.add(sourcePath);
      if (catalogues.some(catalogue => catalogue.paths.has(path))) deny('SOURCE_SHADOW', `source type ${entry.name} shadows imported primitive`);
    }
  }
  function collectReferences(scope) {
    const names = new Set();
    for (const child of scope.children ?? []) {
      if (['block', 'namespace', 'synthetic', 'lambda', 'functionExpression', 'namespaceImport'].includes(child.kind)) continue;
      const nameKey = child.kind === 'constructor' ? `${child.name}:constructor:${child.static ? 'static' : 'instance'}` : child.name;
      if (names.has(nameKey)) deny('AMBIGUOUS_BINDING', `duplicate declaration ${child.name}`, child.origin);
      names.add(nameKey);
      if (['local', 'parameter'].includes(child.kind)) {
        const parent = scope.owner;
        const outer = parent ? lookup(parent, child.name) : null;
        if (outer && (identity.language === 'csharp' && ['local', 'parameter'].includes(outer.kind) ||
            identity.language === 'javascript' && scope.kind === 'block' && ['function', 'functionExpression', 'lambda'].includes(parent?.kind) && outer.kind === 'parameter')) {
          deny('AMBIGUOUS_BINDING', `illegal formal/local redeclaration ${child.name}`, child.origin);
        }
      }
    }
    for (const reference of scope.references ?? []) {
      const target = lookup(scope, reference.name);
      if (!target) deny('INCOMPLETE_BINDING', `unbound source value ${reference.name}`, reference.origin);
      reference.target = target.declId;
      let closure = scope; while (closure && !['lambda', 'functionExpression', 'function'].includes(closure.kind)) closure = closure.owner;
      if (closure) {
        let targetScope = target.owner, contained = false;
        while (targetScope) { if (targetScope === closure) { contained = true; break; } targetScope = targetScope.owner; }
        if (!contained && !closure.captures.some(capture => same(capture.declaration, target.declId))) closure.captures.push({ declaration: target.declId, storage: 'sameLexicalLocation', origin: reference.origin });
      }
    }
    for (const child of scope.children ?? []) collectReferences(child);
  }
  collectReferences(forest.root);
  for (const type of forest.entries.filter(row => row.kind === 'type' && row.category === 'enum')) {
    let next = 0n;
    for (const member of type.children) {
      if (member.initializer) {
        let expr = member.initializer, sign = 1n;
        if (expr.kind === 'unary' && ['+', '-'].includes(expr.op)) { sign = expr.op === '-' ? -1n : 1n; expr = expr.operand; }
        if (expr.kind !== 'literal' || !/^(?:[0-9]+|0[xX][0-9a-fA-F]+)$/.test(expr.spelling)) deny('INCOMPLETE_BINDING', 'enum initializer requires supported exact Int32 constant', member.origin);
        next = sign * BigInt(expr.spelling);
      }
      if (next < -2147483648n || next > 2147483647n) deny('INCOMPLETE_BINDING', 'enum Int32 constant overflow', member.origin);
      member.enumConstant = { kind: 'Int32', value: next.toString(), derivation: member.initializer ? 'explicitConstant' : 'previousPlusOne',
        previous: member === type.children[0] ? null : type.children[type.children.indexOf(member) - 1].declId };
      next++;
    }
  }
  const bindings = forest.entries.map(node => {
    if (node.import && node.kind === 'import') deny('INCOMPLETE_BINDING', `selected module/export definition required for ${node.import.module}`, node.origin);
    if (node.kind === 'namespaceImport') {
      const target = node.import.target;
      if (target.kind !== 'named' || target.arguments.length || !forest.entries.some(entry => entry.namespace.length >= target.path.length && target.path.every((part, index) => entry.namespace[index] === part)) &&
          !catalogues.some(catalogue => [...catalogue.paths.values()].some(type => target.path.every((part, index) => type.namespace[index] === part)))) deny('INCOMPLETE_BINDING', 'unsupplied source/catalogue namespace import', node.origin);
    }
    const typeNode = node.kind === 'enumMember' ? node.owner : node;
    if (node.constraints.length || node.bases.length || node.interfaces.length) deny('INCOMPLETE_BINDING', 'base/interface/constraint resolution is not implemented in foundation subprofile', node.origin);
    if (node.attributes.length) deny('INCOMPLETE_BINDING', 'attribute constructor/argument resolution is not implemented in foundation subprofile', node.origin);
    if (identity.language === 'csharp' && node.defaultValue && !['literal', 'unary'].includes(node.defaultValue.kind)) deny('INCOMPLETE_BINDING', 'nonliteral default requires constant typing', node.origin);
    const resolvedType = resolveType(node.type, typeNode, forest, catalogues);
    if (resolvedType?.kind === 'void') deny('INCOMPLETE_BINDING', 'void cannot be a field/formal/storage type', node.origin);
    const implicitBase = node.kind === 'type' && ['class', 'struct', 'enum'].includes(node.category)
      ? { kind: 'named', path: ['System', node.category === 'class' ? 'Object' : node.category === 'struct' ? 'ValueType' : 'Enum'], arguments: [] } : null;
    const constructorType = node.kind === 'constructor' ? node.owner
      : ['instanceConstructor', 'typeInitializer'].includes(node.slot?.role) ? node.slot.anchor : null;
    const generatedInitializers = constructorType ? constructorType.children
      .filter(child => (child.kind === 'field' || child.kind === 'property' && child.children.length > 0 && child.children.every(accessor => accessor.auto)) &&
        child.initializer && child.static === node.static && !child.modifiers.includes('const'))
      .map(child => ({ declaration: child.declId, originalExpression: cleanSyntax(child.initializer) })) : [];
    const baseConstructor = constructorType?.category === 'class' && !node.static
      ? catalogues.flatMap(catalogue => catalogue.entries).find(entry => entry.kind === 'constructor' &&
        same(entry.descriptor.parent, ['System', 'Object']) && entry.descriptor.parameters.length === 0)?.declId ?? null : null;
    const initializerTiming = constructorType ? node.static
      ? constructorType.beforeFieldInit ? 'beforefieldinit-unproved-trigger' : 'explicit-static-constructor-unproved-trigger'
      : 'instance-before-base-constructor' : node.kind === 'type' && ['class', 'struct'].includes(node.category)
        ? node.beforeFieldInit ? 'beforefieldinit-unproved-trigger' : 'explicit-static-constructor-unproved-trigger' : null;
    return { declId: node.declId, kind: node.kind, name: node.name,
      semanticOwner: scopeId(node.owner), category: node.category ?? node.kind,
      origin: node.slot ? { kind: 'synthetic', noSpan: true, anchor: node.slot.anchor.declId,
        role: node.slot.role, ordinal: node.slot.ordinal } : structuredClone(node.origin),
      type: resolvedType, returnType: resolveType(node.returnType, node, forest, catalogues, true),
      receiver: node.receiver, static: node.static,
      typeParameters: node.typeParameters.map(parameter => parameter.declId), constraints: structuredClone(node.constraints),
      parameters: node.parameters.map(parameter => ({ declaration: parameter.declId,
        type: resolveType(parameter.type, parameter, forest, catalogues), direction: parameter.direction,
        params: parameter.params, defaultValue: cleanSyntax(parameter.defaultValue), attributes: cleanSyntax(parameter.attributes) })),
      modifiers: [...node.modifiers], attributes: cleanSyntax(node.attributes), direction: node.direction,
      params: node.params, defaultValue: cleanSyntax(node.defaultValue), bases: implicitBase ? [resolveType(implicitBase, node, forest, catalogues)] : [],
      interfaces: node.interfaces.map(base => resolveType(base, node, forest, catalogues)), explicitInterface: node.explicitInterface,
      initializer: cleanSyntax(node.initializer), initializerTiming,
      accessors: node.children.filter(child => child.kind === 'accessor').map(child => child.declId),
      backing: node.synthetics.filter(slot => slot.slot.role === 'backingStorage').map(slot => slot.declId),
      captures: structuredClone(node.captures), import: cleanSyntax(node.import),
      referenceBindings: (node.references ?? []).map(reference => ({ ...reference })),
      implicitSlots: node.synthetics.map(slot => slot.declId),
      enumConstant: structuredClone(node.enumConstant ?? null),
      generatedInitializerOrder: generatedInitializers,
      generatedBaseConstructor: baseConstructor,
      baseConstructorPrerequisite: constructorType?.category === 'class' && !node.static
        ? { target: baseConstructor, declarationStatus: baseConstructor ? 'boundExactCatalogueDeclaration' : 'deferredMissingCatalogueConstructor',
          order: 'afterInstanceInitializers-beforeConstructorBody', transferProof: 'deferred' } : null,
    };
  });
  if (parsed.root.statements.some(statement => statement.kind === 'moduleInitialization')) deny('INCOMPLETE_BINDING', 'module initialization requires an exact selected W4 conditional adapter or supplied dependency definition');
  return { schema: 'core1681.declarationFoundation.v1', identity: structuredClone(identity), bindings,
    catalogueConditions: catalogues.map(catalogue => ({ identity: catalogue.identity, conditions: catalogue.catalogue.conditions,
      structurallyCompleteSubset: true, completeSelectedProfile: false, authenticInstalledProfile: false })),
    lexicalScopes: [...forest.scopes.entries()].map(([scope]) => ({ identity: scopeId(scope),
      declarations: scope.children.filter(child => child.declId).map(child => child.declId),
      referenceBindings: scope.references.map(reference => ({ ...reference })) })),
    moduleInitializers: parsed.root.statements.filter(statement => ['moduleInitialization', 'importDeclaration'].includes(statement.kind))
      .map(statement => ({ kind: 'ExternalModuleInitialization', module: statement.module, origin: statement.origin,
        authenticModuleAuthority: false, completionAlternatives: ['normalConditionalInitialization', 'ordinaryImportThrow', 'nonreturn'] })),
    completeSyntax: true, completeEnumeration: true, declarationBindingsProduced: bindings.length,
    implementedSubprofile: parsed.implementedSubprofile, selectedProfileComplete: false,
    typedExpressionBindingsComplete: false, typedIR: null, cfg: null, proofDAG: null,
    sourceGo: false, executionAuthorized: false };
}

export function checkFoundationBindings(rawBytes, identity, catalogueInputs, candidate) {
  // Reparse and resolve ORIGINAL complete bytes, independently of candidate IDs,
  // names, spans, declared counts or hashes. Check every generated metadata field.
  const recomputed = bindSource(rawBytes, identity, catalogueInputs);
  if (!same(candidate, recomputed)) deny('BINDING_MISMATCH', 'entire declaration/metadata/scope/initializer table differs from fresh source derivation');
  return { schema: 'core1681.checkedFoundationSubset.v1', checkedDeclarations: recomputed.bindings.length,
    completeSelectedProfile: false, typedExpressionBindingsComplete: false, actualSourceGo: false, executionAuthorized: false };
}

function cleanSyntax(value) {
  if (value === null || value === undefined || typeof value !== 'object') return value ?? null;
  if (Array.isArray(value)) return value.map(cleanSyntax);
  if (value.declId) return { declaration: value.declId };
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (['owner', 'structural', 'start', 'scope'].includes(key)) continue;
    out[key] = cleanSyntax(item);
  }
  return out;
}

export function produceFoundation(input) {
  const units = admitBundle(input);
  const outcomes = units.map(unit => {
    const catalogue = FIXED_FOUNDATION_CATALOGUES.filter(row => unit.identity.language === 'javascript' ? row.profile === 'CE-JS-foundation-1'
      : unit.identity.profile.includes('CLR-MODERN-VSIX') ? row.profile === 'CLR-MODERN-VSIX-foundation-1' : row.profile === 'CLR48-foundation-1');
    try { return { id: unit.identity.id, status: 'FOUNDATION_SUBPROFILE_ONLY', result: bindSource(unit.rawBytes, unit.identity, catalogue) }; }
    catch (error) {
      if (error?.name !== 'SourceDenial') throw error;
      return { id: unit.identity.id, status: 'DENIED', code: error.code, detail: error.message, origin: error.origin };
    }
  });
  return { schema: 'core1681.wholeFoundationDisposition.v1', conditionVersion: CONDITION_VERSION,
    declarationIdentityVersion: DECLARATION_VERSION, adapters: [...ADAPTERS], outcomes,
    selectedScope: { inputUnits: 14, roles: 183, orderedFamilies: 35, callerComparisons: 9 },
    completeSelectedForest: false, actualSourceGo: false, executionAuthorized: false,
    catalogueGroups: structuredClone(CATALOGUE_GROUP_DISPOSITION),
    remaining: ['complete selected frontend profiles', 'six complete catalogue groups', '18 concrete provider premises',
      'typed expressions/IR/CFG/proof DAG', 'all nine protected caller migrations', 'different entire review and NEW input admission'] };
}

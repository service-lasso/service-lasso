// Fixed finite symbolic descriptor data for the IMPLEMENTED foundation subset.
// This is not the complete selected CLR48/modern/C/PS/Node/SDK catalogue and is
// not evidence about installed assemblies, binders, actors or native ownership.
const named = name => ({ kind: 'named', path: ['System', name], arguments: [] });
const type = (name, kind, bases = []) => ({ namespace: ['System'], name, arity: 0, kind,
  typeParameters: [], constraints: [], modifiers: ['public'], attributes: [], bases,
  interfaces: [], implicitSlots: [], initializer: null });
const completion = (normal, ordinaryThrow = []) => ({ normal, status: [], ordinaryThrow,
  nonreturn: [], callbacks: [], writes: [], aliases: [], iteration: [], initializerTrigger: [], ownerPremises: [] });
const formal = (name, valueType) => ({ name, type: valueType, direction: 'value', params: false,
  defaultValue: { kind: 'absent' }, attributes: [] });
const ctor = (name, parameters, effects) => ({ parent: ['System', name], kind: 'constructor', name: '.ctor', arity: 0,
  type: null, returnType: { kind: 'void' }, receiver: 'instance', static: false, typeParameters: [], constraints: [],
  parameters, modifiers: ['public'], attributes: [], explicitInterface: null, implicitSlots: [], initializer: null, effects });
const ordinary = [{ kind: 'ordinaryThrow', exception: 'freshOrdinaryExn', origin: 'constructor-allocation-or-runtime', sameExceptionPropagates: true }];
const clr48 = { unit: 'CAT-foundation-CLR48', inventoryOrdinal: 0, profile: 'CLR48-foundation-1', version: 'symbolic-fixed-1',
  conditions: ['SYMBOLIC_CLR48_DECLARATIONS_ONLY'], complete: true,
  types: [type('Object', 'class'), type('ValueType', 'class', [named('Object')]), type('Enum', 'class', [named('ValueType')]),
    type('Boolean', 'struct', [named('ValueType')]), type('Int32', 'struct', [named('ValueType')]), type('String', 'class', [named('Object')]),
    type('Exception', 'class', [named('Object')]), type('SystemException', 'class', [named('Exception')]),
    { ...type('InvalidDataException', 'class', [named('SystemException')]), namespace: ['System', 'IO'] }],
  members: [ctor('Object', [], completion([{ kind: 'returnVoid', receiver: 'sameFreshReceiver' }], ordinary)),
    ctor('SystemException', [formal('message', named('String'))], { ...completion([{ kind: 'returnVoid', receiver: 'sameFreshReceiver' }], ordinary),
      writes: [{ kind: 'receiverField', path: ['Message'], value: { kind: 'formal', index: 0 }, frame: 'receiverExceptionState' }] }),
    { ...ctor('InvalidDataException', [formal('message', named('String'))], { ...completion([{ kind: 'returnVoid', receiver: 'sameFreshReceiver' }], ordinary),
      writes: [{ kind: 'receiverField', path: ['Message'], value: { kind: 'formal', index: 0 }, frame: 'receiverExceptionState' }] }), parent: ['System', 'IO', 'InvalidDataException'] }],
};
const modern = { ...structuredClone(clr48), unit: 'CAT-foundation-modern', inventoryOrdinal: 1, profile: 'CLR-MODERN-VSIX-foundation-1',
  conditions: ['NET8-INVALIDDATA-1', 'SYMBOLIC_MODERN_DECLARATIONS_ONLY'] };
const jsAny = { kind: 'dynamic', profile: 'CE-JS-2', sort: 'Any' };
const js = { unit: 'CAT-foundation-JS', inventoryOrdinal: 2, profile: 'CE-JS-foundation-1', version: 'symbolic-fixed-1',
  conditions: ['JS-ANY-TRUTHINESS-1', 'SYMBOLIC_JS_VALUE_OPERATIONS_ONLY'], complete: true,
  types: [{ namespace: ['JS'], name: 'ValueOperations', arity: 0, kind: 'primitive', typeParameters: [],
    constraints: [], modifiers: [], attributes: [], bases: [], interfaces: [], implicitSlots: [], initializer: null }],
  members: ['Truth', 'Nullish'].map(name => ({ parent: ['JS', 'ValueOperations'], kind: 'method', name, arity: 0,
    type: null, returnType: jsAny, receiver: 'none', static: true, typeParameters: [], constraints: [],
    parameters: [formal('value', jsAny)], modifiers: [], attributes: [], explicitInterface: null,
    implicitSlots: [], initializer: null,
    effects: completion([{ kind: 'finiteValuePartition', operation: name,
      falseCases: name === 'Truth' ? ['undefined', 'null', 'false', 'positiveZero', 'negativeZero', 'NaN', 'emptyString', 'zeroBigInt'] : ['allOtherValues'],
      trueCases: name === 'Truth' ? ['allOtherValues'] : ['undefined', 'null'],
      coercion: 'none', nativeOwnerConsequence: 'none' }]) })),
};
function freeze(value) { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }
export const FIXED_FOUNDATION_CATALOGUES = freeze([clr48, modern, js]);
export const CATALOGUE_GROUP_DISPOSITION = freeze([
  { group: 'CLR48', implemented: 'finite declaration subset', completeSelectedProfile: false },
  { group: 'CLR-MODERN-VSIX NET8-INVALIDDATA-1', implemented: 'separate finite conditional declaration subset', completeSelectedProfile: false },
  { group: 'C-SDK2/CRT/ABI', implemented: null, completeSelectedProfile: false },
  { group: 'PS-NUM2/CE-PS', implemented: null, completeSelectedProfile: false },
  { group: 'CE-JS Node events/Promise/buffer/fs/path', implemented: 'Truth/Nullish finite value descriptors only', completeSelectedProfile: false },
  { group: 'SDK import', implemented: null, completeSelectedProfile: false },
]);

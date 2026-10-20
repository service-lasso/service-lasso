import { deny } from './core1681-source-input.mjs';
import { canonicalData, K2_LIMITS } from './core1681-proof-terms.mjs';

// Type identity excludes derived constraint/storage annotations. Declaration
// identities remain the actual enumerated unit/parent/index tuples.
export function selectedTypeIdentity(type, depth = 0) {
  if (depth >= K2_LIMITS.maxTermDepth || !type || typeof type !== 'object')
    deny('INVALID_BINDING', 'selected type identity is missing or exceeds its finite depth');
  const nested = value => selectedTypeIdentity(value, depth + 1);
  switch (type.category) {
    case 'null': return ['null'];
    case 'array':
      if (!Number.isSafeInteger(type.rank) || type.rank < 1 || type.rank > 32)
        deny('INVALID_BINDING', 'selected array rank is outside CLR limits');
      return ['array', type.rank, nested(type.element)];
    case 'nullable': return ['nullable', nested(type.element)];
    case 'typeParameter':
      if (!type.declaration || !type.owner || !Number.isSafeInteger(type.ordinal) || type.ordinal < 0)
        deny('INVALID_BINDING', 'type parameter lacks its canonical declaration owner');
      return ['parameter', type.declaration, type.owner, type.ordinal];
    case 'primitive': case 'reference': case 'enum': case 'struct': case 'delegate': {
      if (!type.declaration) deny('INVALID_BINDING', 'selected named type lacks a declaration identity');
      const arguments_ = type.arguments ?? [];
      if (!Array.isArray(arguments_) || arguments_.length > K2_LIMITS.maxDeclarations)
        deny('INVALID_BINDING', 'selected type arguments are not finite');
      return ['named', type.declaration, arguments_.map(nested),
        type.enclosingType ? nested(type.enclosingType) : null];
    }
    default: deny('INVALID_BINDING', 'selected type identity uses an unbound category');
  }
}

export function selectedTypeKey(type) { return canonicalData(selectedTypeIdentity(type)); }
export function equalSelectedTypes(left, right) { return selectedTypeKey(left) === selectedTypeKey(right); }

// Substitution is simultaneous: an actual argument is not recursively subjected
// to the same substitution. This preserves caller-owned generic parameters.
export function substituteSelectedType(type, substitutions, counter, depth = 0) {
  counter.charge('maxInvariantSteps', 'selected-type-substitution');
  if (depth >= K2_LIMITS.maxTermDepth) deny('INVALID_BINDING', 'selected substitution depth exhausted');
  selectedTypeIdentity(type, depth);
  if (type.category === 'typeParameter') return substitutions.get(canonicalData(type.declaration)) ?? type;
  const substitute = value => substituteSelectedType(value, substitutions, counter, depth + 1);
  if (type.category === 'array' || type.category === 'nullable') return { ...type, element: substitute(type.element) };
  if (type.category === 'null') return type;
  return { ...type, arguments: (type.arguments ?? []).map(substitute),
    ...(type.enclosingType ? { enclosingType: substitute(type.enclosingType) } : {}) };
}

export function genericSubstitution(parameters, actualTypes, counter) {
  if (!Array.isArray(parameters) || !Array.isArray(actualTypes) || parameters.length !== actualTypes.length ||
      parameters.length > K2_LIMITS.maxDeclarations)
    deny('INVALID_BINDING', 'generic construction requires the exact finite parameter arity');
  const substitutions = new Map();
  for (let ordinal = 0; ordinal < parameters.length; ordinal++) {
    counter.charge('maxInvariantSteps', 'selected-generic-argument');
    const parameter = parameters[ordinal];
    if (!parameter.declId) deny('INVALID_BINDING', 'generic parameter is not an actual enumerated declaration');
    const key = canonicalData(parameter.declId);
    if (substitutions.has(key)) deny('INVALID_BINDING', 'generic parameter identity is repeated');
    selectedTypeIdentity(actualTypes[ordinal]);
    substitutions.set(key, actualTypes[ordinal]);
  }
  return substitutions;
}

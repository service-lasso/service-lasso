import { deny } from './core1681-source-input.mjs';
import { equalSelectedTypes, selectedTypeKey } from './core1681-selected-types.mjs';
import { canonicalData } from './core1681-proof-terms.mjs';

const numericTargets = new Map([
  ['sbyte', ['short', 'int', 'long', 'float', 'double', 'decimal']],
  ['byte', ['short', 'ushort', 'int', 'uint', 'long', 'ulong', 'float', 'double', 'decimal']],
  ['short', ['int', 'long', 'float', 'double', 'decimal']],
  ['ushort', ['int', 'uint', 'long', 'ulong', 'float', 'double', 'decimal']],
  ['int', ['long', 'float', 'double', 'decimal']],
  ['uint', ['long', 'ulong', 'float', 'double', 'decimal']],
  ['long', ['float', 'double', 'decimal']], ['ulong', ['float', 'double', 'decimal']],
  ['char', ['ushort', 'int', 'uint', 'long', 'ulong', 'float', 'double', 'decimal']],
  ['float', ['double']], ['double', []], ['decimal', []],
]);
const integerRanges = new Map([
  ['sbyte', [-128n, 127n]], ['byte', [0n, 255n]], ['short', [-32768n, 32767n]], ['ushort', [0n, 65535n]],
  ['int', [-2147483648n, 2147483647n]], ['uint', [0n, 4294967295n]],
  ['long', [-9223372036854775808n, 9223372036854775807n]], ['ulong', [0n, 18446744073709551615n]],
  ['char', [0n, 65535n]],
]);
export const sameSelectedType = equalSelectedTypes;
// An absent optional environment root supplies no conversion. Present malformed
// roots still reach strict identity validation; no catalogue identity is invented.
const optionalRootMatches = (target, root) => root === undefined ? false : sameSelectedType(target, root);

function nullable(type) { return type.category === 'nullable'; }
function valueType(type) { return ['primitive', 'enum', 'struct', 'nullable'].includes(type.category) && type.name !== 'void'; }
function referenceType(type) { return type.category === 'reference' || type.category === 'array' || type.category === 'delegate'; }
function resolvedReferenceType(type, environment) {
  if (referenceType(type)) return true;
  if (type.category !== 'typeParameter') return false;
  const row = environment.parameterConstraints?.get(canonicalData(type.declaration));
  if (!row) deny('INVALID_BINDING', 'array covariance requires independently resolved element parameter constraints');
  return row.effectiveReferenceType === true || row.referenceType === true;
}
function nonnullableValueType(type, environment) {
  if (['primitive', 'enum', 'struct'].includes(type.category)) return type.name !== 'void';
  if (type.category !== 'typeParameter') return false;
  const row = environment.parameterConstraints?.get(canonicalData(type.declaration));
  if (!row) deny('INVALID_BINDING', 'nullable parameter conversion lacks actual resolved constraints');
  return row.valueType === true;
}

function parameterConversion(source, target, environment) {
  const { parameterConstraints, counter, typeGraph, objectType, valueTypeRoot } = environment;
  const row = parameterConstraints?.get(canonicalData(source.declaration));
  if (!row) deny('INVALID_BINDING', 'type parameter conversion lacks independently resolved constraints');
  const result = () => ({ kind: 'typeParameter', representation: row.effectiveReferenceType ? 'reference' : 'boxIfValue',
    allocation: row.effectiveReferenceType ? 'none' : 'freshBoxOnlyForActualValueType', source, target });
  if (optionalRootMatches(target, objectType) || row.valueType && optionalRootMatches(target, valueTypeRoot)) return result();
  const pending = [source], seen = new Set();
  while (pending.length) {
    counter.charge('maxInvariantSteps', 'selected-parameter-conversion');
    const current = pending.pop(), key = selectedTypeKey(current);
    if (seen.has(key)) continue;
    seen.add(key);
    if (sameSelectedType(current, target)) return result();
    if (current.category === 'typeParameter') {
      const constraints = parameterConstraints.get(canonicalData(current.declaration));
      if (!constraints || !Array.isArray(constraints.types)) deny('INVALID_BINDING', 'parameter conversion dependency has no resolved row');
      for (const constraint of constraints.types) pending.push(constraint);
    } else if (derivedFrom(current, target, typeGraph, counter)) return result();
  }
  return null;
}

// Graph edges are the resolver's actual base/interface declaration bindings.
// Caller supplied names, runtime object tags and owner bits cannot create an edge.
function derivedFrom(source, target, graph, counter) {
  const targetKey = selectedTypeKey(target), todo = [source], seen = new Set();
  while (todo.length) {
    counter.charge('maxInvariantSteps', 'reference-conversion');
    const current = todo.pop(), key = selectedTypeKey(current);
    if (seen.has(key)) continue;
    seen.add(key); if (key === targetKey) return true;
    const bases = graph.get(key);
    if (!Array.isArray(bases)) deny('INVALID_BINDING', 'reference conversion requires the complete independently bound type graph');
    for (const base of bases) todo.push(base);
  }
  return false;
}

export function implicitCsharpConversion(source, target, environment, constant = null) {
  const { typeGraph, counter, objectType, valueTypeRoot, enumTypeRoot } = environment;
  if (sameSelectedType(source, target)) return { kind: 'identity' };
  if (source.category === 'typeParameter') {
    const conversion = parameterConversion(source, target, environment);
    if (conversion) return conversion;
  }
  if (source.category === 'null') {
    if (referenceType(target) || nullable(target)) return { kind: 'null' };
    if (target.category === 'typeParameter') {
      const row = environment.parameterConstraints?.get(canonicalData(target.declaration));
      if (!row) deny('INVALID_BINDING', 'null conversion requires independently resolved target parameter constraints');
      if (row.effectiveReferenceType === true || row.referenceType === true) return { kind: 'null' };
    }
  }
  if (source.category === 'primitive' && target.category === 'primitive') {
    if (numericTargets.get(source.name)?.includes(target.name)) return { kind: 'numeric', source: source.name, target: target.name };
    if (constant !== null && (source.name === 'int' && ['sbyte', 'byte', 'short', 'ushort', 'uint', 'ulong'].includes(target.name) || source.name === 'long' && target.name === 'ulong')) {
      if (typeof constant !== 'bigint') deny('INVALID_BINDING', 'integral constant conversion requires exact evaluated integer');
      const [lower, upper] = integerRanges.get(target.name);
      if (constant >= lower && constant <= upper) return { kind: 'constantNumeric', value: constant.toString(), target: target.name };
    }
  }
  if (target.category === 'enum' && source.category === 'primitive' &&
      ['sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong'].includes(source.name) && constant === 0n)
    return { kind: 'zeroEnum', target };
  if (nullable(target)) {
    const underlying = nullable(source) ? source.element : source;
    if (nonnullableValueType(underlying, environment)) {
      const conversion = implicitCsharpConversion(underlying, target.element, environment, constant);
      if (conversion && ['identity', 'numeric', 'constantNumeric', 'zeroEnum'].includes(conversion.kind))
        return { kind: nullable(source) ? 'liftedNullable' : 'nullable', underlying: conversion };
    }
  }
  if (referenceType(source) && optionalRootMatches(target, objectType))
    return { kind: 'reference', originalIdentity: 'sameReference' };
  if (source.category === 'array' && optionalRootMatches(target, environment.arrayTypeRoot))
    return { kind: 'reference', originalIdentity: 'sameArray' };
  if (source.category === 'array' && target.category === 'array') {
    if (source.rank !== target.rank || !resolvedReferenceType(source.element, environment) ||
        !resolvedReferenceType(target.element, environment)) return null;
    const element = implicitCsharpConversion(source.element, target.element, environment);
    if (element && (['identity', 'reference', 'arrayCovariance'].includes(element.kind) ||
        element.kind === 'typeParameter' && element.representation === 'reference'))
      return { kind: 'arrayCovariance', elementConversion: element, runtimeStoreCheck: true };
    return null;
  }
  if (referenceType(source) && referenceType(target) && derivedFrom(source, target, typeGraph, counter)) return { kind: 'reference' };
  if (valueType(source)) {
    const unwrapped = nullable(source) ? source.element : source;
    if (optionalRootMatches(target, objectType) || optionalRootMatches(target, valueTypeRoot) ||
        unwrapped.category === 'enum' && optionalRootMatches(target, enumTypeRoot) ||
        target.category === 'reference' && derivedFrom(unwrapped, target, typeGraph, counter))
      return { kind: nullable(source) ? 'nullableBoxing' : 'boxing', allocation: 'freshBox', source };
  }
  return null;
}

export function csharpFormalTransfer(actual, formal, environment) {
  if (formal.direction === 'ref' || formal.direction === 'out') {
    if (actual.direction !== formal.direction || !actual.location || actual.location.writable !== true ||
        !sameSelectedType(actual.type, formal.type)) return null;
    return { kind: formal.direction, location: actual.location, aliasIdentity: actual.location.identity,
      readBeforeCall: formal.direction === 'ref', copyBack: 'sameLocationOnEachCompletion' };
  }
  if (actual.direction !== 'value') return null;
  const conversion = implicitCsharpConversion(actual.type, formal.type, environment, actual.constant ?? null);
  if (!conversion) return null;
  return { kind: 'value', conversion, copy: formal.type.category === 'typeParameter' ? 'actualTypeValueCopyOrReferenceIdentity' :
    valueType(formal.type) ? 'structOrPrimitiveValue' : 'referenceIdentity' };
}

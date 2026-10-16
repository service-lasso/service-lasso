import { deny } from './core1681-source-input.mjs';
import { canonicalData, K2_LIMITS, requireProofCounter } from './core1681-proof-terms.mjs';
import { parseSelectedSourceForest, createSelectedFrontendOccurrence } from './core1681-selected-forest.mjs';
import { enumerateSelectedDeclarations } from './core1681-selected-declarations.mjs';
import { SelectedCSharpNameIndex } from './core1681-selected-names.mjs';
import { SelectedTypeIndex } from './core1681-selected-type-index.mjs';
import { SelectedCSharpImports } from './core1681-selected-imports.mjs';
import { bindSelectedCsharpDeclarations, instantiateSelectedBaseGraph } from './core1681-selected-metadata.mjs';
import { selectedTypeKey } from './core1681-selected-types.mjs';

const originalCompilationInputs = new WeakMap();
const originalCompilationAttempts = new WeakMap();
const originalCompilationFrontendBorrows = new WeakMap();
const originalCompilationCopiedUnits = new WeakMap();
// Only the actual binder below can mint a source borrow. Public source values,
// observations and parser products never carry this private capability.
export function borrowSelectedCompilationSource(token, counter) {
  const original = originalCompilationFrontendBorrows.get(token);
  if (!original || original.used || original.fields.counter !== counter || !original.fields.copyCompleted)
    deny('INVALID_BINDING', 'frontend requires its genuine once-only completed compilation copy');
  original.used = true;
  return original.fields.rawBytes;
}
const originalByteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get;
const originalByteSet = Uint8Array.prototype.set;
function copyOriginalUnitBytes(bytes, counter, occurrence) {
  occurrence.phase = 'inputAcquisition';
  occurrence.rawInput = bytes;
  try {
    if (!ArrayBuffer.isView(bytes) || !(bytes instanceof Uint8Array))
      deny('INVALID_BINDING', 'original compiler bytes must have a genuine byte-array brand');
    counter.charge('maxInvariantSteps', 'original-compilation-byte-copy');
    const extent = originalByteLength.call(bytes);
    occurrence.extent = extent;
    for (let offset = 0; offset < extent; offset++)
      counter.charge('maxInvariantSteps', `original-compilation-byte:${offset}`);
    occurrence.phase = 'rawAllocation';
    const copy = new Uint8Array(extent);
    occurrence.rawBytes = copy;
    occurrence.phase = 'rawCopy';
    originalByteSet.call(copy, bytes);
    occurrence.copyCompleted = true;
    occurrence.returnOriginal = copy;
    occurrence.returnPresent = true;
    return copy;
  } catch (failure) {
    occurrence.throwOriginal = failure;
    occurrence.throwPresent = true;
    throw failure;
  }
}
// The proof receiver does not trust producer-exposed AST/index/map mutations.
// Retained byte copies are module-private; each check rebuilds fresh source
// bindings. This still requires full frontend certification and input-root /
// profile association before any whole source admission.
export function rebindSelectedCompilationForProof(compilation, counter) {
  requireProofCounter(counter);
  const input = originalCompilationInputs.get(compilation);
  if (!input) deny('INVALID_BINDING', 'proof requires a genuine original-byte compilation');
  return bindSelectedCsharpCompilationInternal(input.units, counter, input.counter === counter);
}

// Original-byte declaration phase of the selected compiler. Compilation/role
// inputs must subsequently be independently bound to the actual input root and
// compiler profile. This phase does not admit a body, proof, native provider or
// executable. No installed compiler/parser or source callback is invoked.
export function bindSelectedCsharpCompilation(units, counter) {
  return bindSelectedCsharpCompilationInternal(units, counter, false);
}
function bindSelectedCsharpCompilationInternal(units, counter, borrowPrivateCopies) {
  requireProofCounter(counter);
  if (!Array.isArray(units))
    deny('INVALID_BINDING', 'selected compilation requires a finite original unit roster');
  const extentDescriptor = Object.getOwnPropertyDescriptor(units, 'length');
  const extent = extentDescriptor?.value;
  if (!Number.isSafeInteger(extent) || extent < 1 || extent > K2_LIMITS.maxDeclarations)
    deny('INVALID_BINDING', 'selected compilation requires a finite original unit roster');
  if (Object.getPrototypeOf(units) !== Array.prototype || Reflect.ownKeys(units).length !== extent + 1)
    deny('INVALID_BINDING', 'original unit roster must be a dense own-data array');
  const unitOriginals = [];
  for (let ordinal = 0; ordinal < extent; ordinal++) {
    counter.charge('maxInvariantSteps', 'original-compilation-roster-slot');
    const descriptor = Object.getOwnPropertyDescriptor(units, String(ordinal));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true)
      deny('INVALID_BINDING', 'original unit roster slot must be own enumerable data');
    unitOriginals.push(descriptor.value);
  }
  counter.charge('maxInvariantSteps', 'original-compilation-attempt');
  const attempt = { previous: originalCompilationAttempts.get(units), retainedInputs: [], sourceOccurrences: [] };
  originalCompilationAttempts.set(units, attempt);
  const originals = [], originalUnits = new Map(), compilationGroups = new Map(), retainedInputs = attempt.retainedInputs;
  for (const unitOriginal of unitOriginals) attempt.sourceOccurrences.push({ unitOriginal,
    descriptorsOriginal: [], phase: 'pending', returned: false, failed: false, throwOriginal: undefined,
    copyOriginal: { phase: undefined, rawInput: undefined, extent: undefined, rawBytes: undefined,
      copyCompleted: false, returnOriginal: undefined, returnPresent: false, throwOriginal: undefined, throwPresent: false },
    frontendOriginal: undefined });
  for (const sourceOccurrence of attempt.sourceOccurrences) {
    try {
    counter.charge('maxInvariantSteps', 'original-compilation-source');
    sourceOccurrence.phase = 'sourceDescriptors';
    const unit = {}, source = sourceOccurrence.unitOriginal, keys = ['unit', 'compilation', 'role', 'rawBytes'];
    if (!source || Object.getPrototypeOf(source) !== Object.prototype)
      deny('INVALID_INPUT', 'original compilation unit requires an own-data record');
    sourceOccurrence.keysOriginal = Reflect.ownKeys(source);
    if (sourceOccurrence.keysOriginal.length !== keys.length || sourceOccurrence.keysOriginal.some(key => !keys.includes(key)))
      deny('INVALID_INPUT', 'original compilation unit requires exactly unit,compilation,role,rawBytes');
    for (const key of keys) {
      const row = { key, attempted: true, descriptorOriginal: undefined, returned: false };
      sourceOccurrence.descriptorsOriginal.push(row);
      row.descriptorOriginal = Object.getOwnPropertyDescriptor(source, key); row.returned = true;
      if (!row.descriptorOriginal || !Object.hasOwn(row.descriptorOriginal, 'value') || row.descriptorOriginal.enumerable !== true)
        deny('INVALID_INPUT', 'original compilation unit requires own enumerable data members');
      unit[key] = row.descriptorOriginal.value;
    }
    if (typeof unit.unit !== 'string' || !unit.unit.length || typeof unit.compilation !== 'string' || !unit.compilation.length ||
        !['source', 'catalogue'].includes(unit.role) || !(unit.rawBytes instanceof Uint8Array) || originalUnits.has(unit.unit))
      deny('INVALID_BINDING', 'original compilation unit identity/role/bytes are invalid or repeated');
    counter.charge('maxInvariantSteps', 'original-compilation-source-occurrence');
    sourceOccurrence.frontendOriginal = createSelectedFrontendOccurrence(counter);
    let rawBytes;
    const privateCopy = borrowPrivateCopies ? originalCompilationCopiedUnits.get(source) : undefined;
    if (privateCopy) {
      counter.charge('maxInvariantSteps', 'original-compilation-private-snapshot-borrow');
      if (privateCopy.counter !== counter || !privateCopy.copyCompleted || privateCopy.rawBytes !== unit.rawBytes ||
          !Object.isFrozen(source))
        deny('INVALID_BINDING', 'proof rebind requires its same-counter immutable original copied unit');
      rawBytes = privateCopy.rawBytes;
      Object.assign(sourceOccurrence.copyOriginal, { phase: 'privateSnapshotBorrow', rawInput: rawBytes,
        extent: originalByteLength.call(rawBytes), rawBytes, copyCompleted: true,
        returnOriginal: rawBytes, returnPresent: true, borrowedPrivateSnapshot: true });
    } else {
      if (borrowPrivateCopies) deny('INVALID_BINDING', 'proof rebind lost its genuine private copied unit');
      rawBytes = copyOriginalUnitBytes(unit.rawBytes, counter, sourceOccurrence.copyOriginal);
    }
    const retained = Object.freeze({ unit: unit.unit, compilation: unit.compilation, role: unit.role, rawBytes });
    originalCompilationCopiedUnits.set(retained, Object.freeze({ counter, rawBytes, copyCompleted: true }));
    retainedInputs.push(retained);
    const occurrence = sourceOccurrence.frontendOriginal;
    const borrow = Object.freeze({});
    originalCompilationFrontendBorrows.set(borrow, { used: false,
      fields: Object.freeze({ counter, rawBytes: retained.rawBytes, copyCompleted: sourceOccurrence.copyOriginal.copyCompleted }) });
    sourceOccurrence.frontendBorrowOriginal = borrow;
    const forest = parseSelectedSourceForest(undefined, 'csharp', counter, occurrence, undefined, borrow);
    const { parser, root } = forest;
    const enumeration = enumerateSelectedDeclarations(root, unit.unit, 'csharp', counter);
    const original = { unit: unit.unit, role: unit.role, parser, root, enumeration };
    originals.push(original); originalUnits.set(unit.unit, { root, role: unit.role });
    compilationGroups.set(unit.unit, unit.compilation);
    sourceOccurrence.returned = true; sourceOccurrence.phase = 'sourceReturned';
    } catch (original) { sourceOccurrence.throwOriginal = original; sourceOccurrence.failed = true; throw original; }
  }
  if (!originals.some(original => original.role === 'source'))
    deny('INVALID_BINDING', 'selected compilation has no original source unit');
  const enumeration = originals.flatMap(original => original.enumeration.entries);
  const byDeclaration = new Map(enumeration.map(entry => [canonicalData(entry.declId), entry]));
  const index = new SelectedTypeIndex(originals.filter(original => original.role === 'source').flatMap(original => original.enumeration.entries),
    originals.filter(original => original.role === 'catalogue').flatMap(original => original.enumeration.entries),
    counter, compilationGroups, originalUnits);
  const base = unit => ({ unit, owner: null, namespace: [], typeParents: [], parameterConstraints: new Map(),
    usingNamespaces: [], usingAliases: new Map(), usingTiers: [], namespacePaths: new Set([canonicalData([])]) });
  const imports = new Map(), names = new Map();
  for (const original of originals) {
    imports.set(original.unit, new SelectedCSharpImports(original.root, original.enumeration, index, base(original.unit), counter));
    names.set(original.unit, new SelectedCSharpNameIndex(original.enumeration, counter));
  }
  const contextFor = entry => {
    const anchor = entry.generated ? byDeclaration.get(canonicalData(entry.generated.anchor)) : entry;
    if (!anchor || !imports.has(entry.declId.unit)) deny('INVALID_BINDING', 'declaration lacks its original unit/anchor');
    return imports.get(entry.declId.unit).forOccurrence(anchor.syntax,
      { ...base(entry.declId.unit), owner: entry.declId, typeParents: entry.declId.parent.types });
  };
  const bound = bindSelectedCsharpDeclarations(enumeration, index, contextFor, counter);
  const context = entry => ({ ...contextFor(entry), parameterConstraints: bound.parameterConstraints });
  const types = new Map();
  const addType = type => {
    if (!type) return;
    const pending = [type];
    while (pending.length) {
      counter.charge('maxInvariantSteps', 'original-compilation-type-roster');
      const current = pending.pop(), key = selectedTypeKey(current);
      if (types.has(key)) continue;
      types.set(key, current);
      if (current.element) pending.push(current.element);
      if (current.enclosingType) pending.push(current.enclosingType);
      pending.push(...(current.arguments ?? []));
    }
  };
  for (const entry of enumeration) if (['type', 'delegate'].includes(entry.syntax.kind)) {
    const actualContext = context(entry);
    addType(entry.syntax.typeParameters.length || entry.declId.parent.types.length
      ? index.openEnclosingType(entry.declId, { ...actualContext, typeParents: [...entry.declId.parent.types, entry.declId] })
      : index.construct(entry, [], actualContext));
  }
  for (const row of bound.declarationMetadata.values()) {
    addType(row.declaringType); addType(row.returnType); addType(row.type);
    for (const parameter of row.parameters ?? []) addType(parameter.type);
  }
  for (const row of bound.storageMetadata.values()) addType(row.type);
  for (const row of bound.parameterConstraints.values()) for (const type of row.types) addType(type);
  const typeGraph = instantiateSelectedBaseGraph([...types.values()], bound.declarationMetadata, counter);
  const sourceParents = new WeakMap();
  for (const original of originals) {
    const seen = new WeakSet(), pending = [{ value: original.root, parent: null, depth: 0 }];
    while (pending.length) {
      counter.charge('maxInvariantSteps', 'original-syntactic-parent');
      const { value, parent, depth } = pending.pop();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'original syntactic parent depth exhausted');
      seen.add(value);
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index--) pending.push({ value: value[index], parent, depth: depth + 1 });
        continue;
      }
      const actualNode = value.kind && value.origin;
      if (actualNode) sourceParents.set(value, parent);
      for (const key of Object.keys(value).reverse()) {
        if (['origin', 'declId', 'semanticOwner', 'owner', 'metadata'].includes(key)) continue;
        pending.push({ value: value[key], parent: actualNode ? value : parent, depth: depth + 1 });
      }
    }
  }
  const result = { phase: 'originalDeclarations', sourceAdmission: false, executionAdmission: false,
    completeBodyBinding: false, originals, enumeration, byDeclaration, index, imports, names,
    decodedUnits: new Map(originals.map(original => [original.unit, original.parser.scanner.decoded])),
    sourceParents, compilationGroups, context, contextFor, bound, types: [...types.values()], typeGraph };
  originalCompilationInputs.set(result, Object.freeze({ units: retainedInputs, counter }));
  return result;
}

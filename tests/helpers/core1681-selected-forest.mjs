import { deny, createOriginalDecoderOccurrence, copyOriginalDecoderObservation } from './core1681-source-input.mjs';
import { requireProofCounter } from './core1681-proof-terms.mjs';
import { SelectedSyntax } from './core1681-selected-syntax.mjs';
import { SelectedJavaScriptSyntax } from './core1681-selected-javascript.mjs';
import { SelectedPowerShellSyntax } from './core1681-selected-powershell.mjs';
import { SelectedCSyntax } from './core1681-selected-c-syntax.mjs';
import { createSelectedCPreprocessingOccurrence, copySelectedCPreprocessingObservation } from './core1681-selected-c-preprocessor.mjs';
import { enumerateSelectedDeclarations } from './core1681-selected-declarations.mjs';
import { borrowSelectedEnvelopeSource } from './core1681-source-binding.mjs';
import { borrowSelectedCompilationSource } from './core1681-selected-compilation.mjs';
import { copySelectedCTypeObservation } from './core1681-selected-c-types.mjs';

const originalInputs = new WeakMap();
const frontendOccurrences = new WeakMap();
export function createSelectedFrontendOccurrence(counter) {
  requireProofCounter(counter);
  counter.charge('maxInvariantSteps', 'selected-frontend-occurrence');
  const token = Object.freeze({});
  frontendOccurrences.set(token, { counter, issued: false, phase: undefined,
    rawInput: undefined, language: undefined, extent: undefined, rawBytes: undefined,
    copyCompleted: false, returnOriginal: undefined, returnPresent: false,
    throwOriginal: undefined, throwPresent: false, reparseOriginal: undefined,
    previous: undefined });
  return token;
}

const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get;
const byteSet = Uint8Array.prototype.set;

// Syntax custody is useful independently of missing profile/catalogue authority.
// A complete parsed unit is not a typed/effect/proof or native admission result.
export function parseSelectedSourceForest(rawBytes, language, counter, token, privateEnvelopeRow, privateCompilationBorrow) {
  const occurrence = frontendOccurrences.get(token);
  if (!occurrence)
    deny('INVALID_BINDING', 'selected frontend requires its caller-owned occurrence');
  if (occurrence.issued) deny('INVALID_BINDING', 'frontend occurrence is once-only');
  occurrence.issued = true;
  // This synchronous original record is owned before acquisition, allocation,
  // partial copy or parser construction. It is never source/root authority.
  occurrence.phase = 'inputAcquisition';
  occurrence.rawInput = rawBytes;
  occurrence.language = language;
  try {
    requireProofCounter(counter);
    if (occurrence.counter !== counter) deny('INVALID_BINDING', 'frontend counter differs from caller occurrence');
    if (!['csharp', 'javascript', 'powershell', 'c'].includes(language))
      deny('UNBOUND_PROFILE', 'unknown selected source language');
    if (privateEnvelopeRow !== undefined && privateCompilationBorrow !== undefined)
      deny('INVALID_BINDING', 'frontend source has more than one private owner');
    const borrowed = privateEnvelopeRow !== undefined ? borrowSelectedEnvelopeSource(privateEnvelopeRow, counter)
      : privateCompilationBorrow !== undefined ? borrowSelectedCompilationSource(privateCompilationBorrow, counter) : undefined;
    if (borrowed !== undefined) occurrence.rawInput = borrowed;
    if (borrowed === undefined && (!ArrayBuffer.isView(rawBytes) || !(rawBytes instanceof Uint8Array)))
      deny('INVALID_INPUT', 'selected forest requires original byte-array input');
    const extent = byteLength.call(borrowed ?? rawBytes);
    occurrence.extent = extent;
    let retained = borrowed;
    if (borrowed === undefined) {
    counter.charge('maxInvariantSteps', 'selected-forest-original-copy');
    for (let offset = 0; offset < extent; offset++)
      counter.charge('maxInvariantSteps', `selected-forest-original-byte:${offset}`);
    // Provisional source-step charging is not complete containing allocation
    // charge. Preserve the actual allocation and partially copied backing.
    occurrence.phase = 'rawAllocation';
    retained = new Uint8Array(extent);
    occurrence.rawBytes = retained;
    occurrence.phase = 'rawCopy';
    byteSet.call(retained, rawBytes);
    } else {
      occurrence.phase = 'privateSourceBorrow';
      occurrence.rawBytes = retained;
      occurrence.sourceOwner = privateEnvelopeRow ?? privateCompilationBorrow;
    }
    occurrence.copyCompleted = true;
    occurrence.phase = 'frontendConstruction';
    occurrence.decoder = createOriginalDecoderOccurrence();
    if (language === 'c') occurrence.preprocessing = createSelectedCPreprocessingOccurrence(counter);
    const parser = language === 'csharp' ? new SelectedSyntax(retained, language, counter, undefined, occurrence.decoder)
      : language === 'javascript' ? new SelectedJavaScriptSyntax(retained, counter, occurrence.decoder)
      : language === 'powershell' ? new SelectedPowerShellSyntax(retained, counter, occurrence.decoder)
      : new SelectedCSyntax(retained, counter, new Set(), occurrence.preprocessing, occurrence.decoder);
    occurrence.parser = parser;
    occurrence.phase = 'syntaxParsing';
    const root = language === 'csharp' ? parser.csharpUnit()
      : language === 'javascript' ? parser.javascriptUnit()
      : language === 'powershell' ? parser.powershellUnit() : parser.cUnit();
    const decoded = language === 'c' ? parser.source.decoded : parser.scanner.decoded;
    const result = { root, decoded, language, parser, phase: 'originalSyntax',
      sourceAdmission: false, executionAdmission: false, completeBodyBinding: false };
    originalInputs.set(result, { rawBytes: retained, language, occurrence });
    occurrence.returnOriginal = result;
    occurrence.returnPresent = true;
    return result;
  } catch (failure) {
    occurrence.throwOriginal = failure;
    occurrence.throwPresent = true;
    throw failure;
  }
}
// Never enumerate producer-mutated ASTs as original-source evidence. Reparse
// module-private original bytes under the receiver's genuine finite counter.
export function enumerateSelectedSourceForest(forest, unit, counter) {
  requireProofCounter(counter);
  const original = originalInputs.get(forest);
  if (!original || typeof unit !== 'string' || !unit.length)
    deny('INVALID_BINDING', 'selected forest requires genuine original custody and unit identity');
  counter.charge('maxInvariantSteps', 'selected-reparse-occurrence');
  const occurrence = createSelectedFrontendOccurrence(counter);
  frontendOccurrences.get(occurrence).previous = original.occurrence.reparseOriginal;
  original.occurrence.reparseOriginal = occurrence;
  const rebound = parseSelectedSourceForest(original.rawBytes, original.language, counter, occurrence);
  return { ...rebound, unit,
    enumeration: enumerateSelectedDeclarations(rebound.root, unit, rebound.language, counter) };
}


export function copySelectedFrontendObservation(token) {
  const original = frontendOccurrences.get(token);
  if (!original) deny('INVALID_BINDING', 'frontend observation needs original caller custody');
  const snapshot = { phase: original.phase, language: original.language,
    parserPresent: original.parser !== undefined,
    returnPresent: original.returnPresent === true, throwPresent: original.throwPresent === true,
    throwOriginal: original.throwOriginal, copyCompleted: original.copyCompleted === true,
    sourceAdmission: false, executionAdmission: false };
  if (original.preprocessing) snapshot.preprocessing = copySelectedCPreprocessingObservation(original.preprocessing);
  if (original.decoder) snapshot.decoder = copyOriginalDecoderObservation(original.decoder);
  if (original.parser?.sourceTypeDerivations)
    snapshot.sourceTypes = original.parser.sourceTypeDerivations.map(copySelectedCTypeObservation);
  if (original.rawBytes) {
    const extent = byteLength.call(original.rawBytes);
    original.counter.charge('maxInvariantSteps', 'selected-observation-copy');
    for (let offset = 0; offset < extent; offset++)
      original.counter.charge('maxInvariantSteps', `selected-observation-byte:${offset}`);
    snapshot.rawBytes = new Uint8Array(extent);
    byteSet.call(snapshot.rawBytes, original.rawBytes);
  }
  return snapshot;
}

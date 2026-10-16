import { deny } from './core1681-source-input.mjs';

// Correspondence is independent of evaluation order. The body binder retains
// the original source argument order and supplies its independently bound
// language version from the actual compiler-input profile, never the proof.
export function mapSelectedArguments(candidate, actuals, environment, expanded) {
  const formals = candidate.parameters, lastIndex = formals.length - 1;
  const variadic = formals[lastIndex]?.variadic === true;
  if (expanded && (!variadic || formals[lastIndex].type.category !== 'array' || formals[lastIndex].type.rank !== 1)) return null;
  const mapping = [], used = new Set(); let namedSeen = false, outOfPositionSeen = false;
  for (let sourceIndex = 0; sourceIndex < actuals.length; sourceIndex++) {
    environment.counter.charge('maxInvariantSteps', 'original-argument-correspondence');
    const actual = actuals[sourceIndex]; let formalIndex, element = false;
    if (actual.name !== null && actual.name !== undefined) {
      const version = environment.csharpLanguageVersion;
      if (!Array.isArray(version) || version.length !== 2 || version.some(value => !Number.isSafeInteger(value) || value < 0))
        deny('INVALID_BINDING', 'named argument requires actual compiler-input language version', actual.origin);
      if (version[0] < 4) return null;
      if (!actual.name.origin || typeof actual.name.spelling !== 'string')
        deny('INVALID_BINDING', 'named argument lost its original identifier occurrence', actual.origin);
      formalIndex = formals.findIndex(formal => formal.name === actual.name.spelling);
      if (formalIndex < 0) return null;
      // A named params argument addresses the original array. It cannot name
      // one of the replacement element parameters in expanded form.
      if (expanded && formalIndex === lastIndex) return null;
      namedSeen = true; outOfPositionSeen ||= formalIndex !== sourceIndex;
    } else {
      if (namedSeen) {
        const version = environment.csharpLanguageVersion;
        if (outOfPositionSeen || version[0] < 7 || version[0] === 7 && version[1] < 2) return null;
      }
      formalIndex = expanded && sourceIndex >= lastIndex ? lastIndex : sourceIndex;
      element = expanded && sourceIndex >= lastIndex;
      if (formalIndex < 0 || formalIndex >= formals.length) return null;
    }
    if (!element && used.has(formalIndex)) return null;
    if (element && used.has(lastIndex)) return null;
    if (!element) used.add(formalIndex);
    mapping.push({ sourceIndex, formalIndex, element,
      formal: element ? { ...formals[lastIndex], type: formals[lastIndex].type.element, direction: 'value', variadic: false } : formals[formalIndex],
      originalNameOccurrence: actual.name?.origin ?? null });
  }
  const omitted = [];
  for (let index = 0; index < formals.length; index++) {
    environment.counter.charge('maxInvariantSteps', 'original-omitted-argument');
    if (used.has(index) || expanded && index === lastIndex) continue;
    if (formals[index].direction !== 'value' || formals[index].defaultValue?.kind !== 'constant') return null;
    omitted.push(index);
  }
  return { mapping, omitted, paramsElements: mapping.filter(row => row.element).length };
}

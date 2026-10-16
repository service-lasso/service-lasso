import { deny } from './core1681-source-input.mjs';
import { csharpFormalTransfer, implicitCsharpConversion, sameSelectedType } from './core1681-selected-conversions.mjs';
import { K2_LIMITS, canonicalData } from './core1681-proof-terms.mjs';
import { selectedTypeKey } from './core1681-selected-types.mjs';
import { mapSelectedArguments } from './core1681-selected-arguments.mjs';

function specificity(left, right, counter, depth = 0) {
  counter.charge('maxInvariantSteps', 'selected-formal-specificity');
  if (depth >= K2_LIMITS.maxTermDepth) deny('INVALID_BINDING', 'formal specificity depth exhausted');
  if (left.category === 'typeParameter' || right.category === 'typeParameter')
    return left.category === right.category ? [false, false] :
      left.category === 'typeParameter' ? [false, true] : [true, false];
  if (left.category === 'array' && right.category === 'array' && left.rank === right.rank ||
      left.category === 'nullable' && right.category === 'nullable')
    return specificity(left.element, right.element, counter, depth + 1);
  if (!left.declaration || !right.declaration || canonicalData(left.declaration) !== canonicalData(right.declaration))
    return [false, false];
  const a = left.arguments ?? [], b = right.arguments ?? [];
  if (a.length !== b.length) deny('INVALID_BINDING', 'equal generic declaration has unequal actual arity');
  let more = false, less = false;
  for (let index = 0; index < a.length; index++) {
    const [nextMore, nextLess] = specificity(a[index], b[index], counter, depth + 1);
    more ||= nextMore; less ||= nextLess;
  }
  if (left.enclosingType && right.enclosingType) {
    const [nextMore, nextLess] = specificity(left.enclosingType, right.enclosingType, counter, depth + 1);
    more ||= nextMore; less ||= nextLess;
  }
  return [more, less];
}

function applicable(candidate, actuals, environment, expanded) {
  const formals = candidate.parameters, last = formals.at(-1);
  const correspondence = mapSelectedArguments(candidate, actuals, environment, expanded);
  if (!correspondence) return null;
  const transfers = [], targets = [], defaults = [];
  for (let index = 0; index < actuals.length; index++) {
    const source = actuals[index];
    const formal = correspondence.mapping[index].formal;
    if (!formal) return null;
    const transfer = csharpFormalTransfer(source, formal, environment);
    if (!transfer) return null;
    transfers.push(transfer); targets.push(formal.type);
  }
  for (const index of correspondence.omitted) {
    const formal = formals[index];
    if (formal.defaultValue?.kind !== 'constant' || formal.direction !== 'value') return null;
    defaults.push({ formal: index, value: formal.defaultValue });
  }
  return { candidate, expanded, transfers, targets, defaults, argumentMapping: correspondence.mapping,
    evaluationOrder: correspondence.mapping.map(row => row.sourceIndex),
    paramsArray: expanded ? { allocation: 'freshArray', elementType: last.type.element,
      sourceIndices: correspondence.mapping.filter(row => row.element).map(row => row.sourceIndex),
      count: correspondence.paramsElements } : null };
}

function conversionOrder(actualType, left, right, environment) {
  if (sameSelectedType(left, right)) return 0;
  if (sameSelectedType(actualType, left)) return -1;
  if (sameSelectedType(actualType, right)) return 1;
  const toRight = implicitCsharpConversion(left, right, environment), toLeft = implicitCsharpConversion(right, left, environment);
  if (toRight && !toLeft) return -1;
  if (toLeft && !toRight) return 1;
  const a = left.category === 'nullable' ? left.element : left;
  const b = right.category === 'nullable' ? right.element : right;
  // Fixed predefined signed-versus-unsigned better-target rules apply after
  // identity/one-way conversion. They include corresponding nullable targets.
  const signedTargets = new Map([
    ['sbyte', ['byte', 'ushort', 'uint', 'ulong']], ['short', ['ushort', 'uint', 'ulong']],
    ['int', ['uint', 'ulong']], ['long', ['ulong']],
  ]);
  if (a.category === 'primitive' && b.category === 'primitive') {
    if (signedTargets.get(a.name)?.includes(b.name)) return -1;
    if (signedTargets.get(b.name)?.includes(a.name)) return 1;
  }
  return 0;
}

function better(left, right, actuals, environment) {
  environment.counter.charge('maxInvariantSteps', 'selected-overload-comparison');
  let leftWins = false, rightWins = false;
  for (let index = 0; index < actuals.length; index++) {
    if (actuals[index].direction === 'ref' || actuals[index].direction === 'out') continue;
    const order = conversionOrder(actuals[index].type, left.targets[index], right.targets[index], environment);
    leftWins ||= order < 0; rightWins ||= order > 0;
  }
  if (leftWins || rightWins) return leftWins && !rightWins;
  // Tie rules apply only to equivalent corresponding parameter sequences;
  // an indeterminate conversion ordering is not an identity conversion.
  if (actuals.some((actual, index) => actual.direction !== 'ref' && actual.direction !== 'out' &&
      !sameSelectedType(left.targets[index], right.targets[index]))) return false;
  const a = left.candidate, b = right.candidate;
  if (a.genericArity !== b.genericArity && (!a.genericArity || !b.genericArity)) return !a.genericArity;
  if (left.expanded !== right.expanded) return !left.expanded;
  if (left.expanded && right.expanded && left.paramsArray.count !== right.paramsArray.count)
    return left.paramsArray.count < right.paramsArray.count;
  // The independently resolved generic binding retains each original formal's
  // type-parameter position; specificity never follows a producer rank number.
  let moreSpecific = false, lessSpecific = false;
  const originalLeft = a.originalParameterTypes, originalRight = b.originalParameterTypes;
  if (!Array.isArray(originalLeft) || !Array.isArray(originalRight) ||
      originalLeft.length !== a.parameters.length || originalRight.length !== b.parameters.length)
    deny('INVALID_BINDING', 'overload specificity requires complete original unexpanded formal signatures');
  // Specificity uses the complete uninstantiated, unexpanded declarations,
  // including optional formals omitted at this call and the original params
  // array. Argument correspondence is only for conversion comparison above.
  if (originalLeft.length === originalRight.length) for (let index = 0; index < originalLeft.length; index++) {
    const [more, less] = specificity(originalLeft[index], originalRight[index], environment.counter);
    moreSpecific ||= more; lessSpecific ||= less;
  }
  if (moreSpecific || lessSpecific) return moreSpecific && !lessSpecific;
  // Substituting fewer defaults is not a ranking rule. Only a candidate with
  // every parameter supplied beats one requiring an omitted default here.
  if (!left.defaults.length && right.defaults.length) return true;
  return false;
}

function mostDerivedApplicableForms(forms, environment) {
  const methods = forms.filter(form => form.candidate.category === 'method' && !form.candidate.intrinsic);
  if (!methods.length) return forms;
  if (!(environment.typeGraph instanceof Map) || !(environment.declarationMetadata instanceof Map) || !environment.objectType)
    deny('INVALID_BINDING', 'method invocation requires complete original inheritance metadata before better-member selection');
  const metadata = type => {
    const row = environment.declarationMetadata.get(canonicalData(type?.declaration));
    if (!row) deny('INVALID_BINDING', 'applicable method declaring type is absent from original metadata');
    return row;
  };
  const derived = (source, target) => {
    const wanted = selectedTypeKey(target), pending = [source], seen = new Set();
    while (pending.length) {
      environment.counter.charge('maxInvariantSteps', 'most-derived-applicable-method');
      const current = pending.pop(), id = selectedTypeKey(current);
      if (seen.has(id)) continue;
      seen.add(id);
      if (id === wanted) return true;
      const bases = environment.typeGraph.get(id);
      if (!Array.isArray(bases)) deny('INVALID_BINDING', 'most-derived method reduction requires the complete instantiated base graph');
      pending.push(...bases);
    }
    return false;
  };
  for (const form of methods) metadata(form.candidate.declaringType);
  return forms.filter(base => !methods.some(more => {
    if (base === more || base.candidate.category !== 'method' || base.candidate.intrinsic) return false;
    const source = more.candidate.declaringType, target = base.candidate.declaringType;
    if (sameSelectedType(source, target)) return false;
    if (derived(source, target)) return true;
    return metadata(source).category === 'class' && !sameSelectedType(source, environment.objectType) &&
      metadata(target).category === 'interface';
  }));
}
// Candidate collection, generic unification, accessibility and constraints are
// independent resolver steps. These inputs are its private resolved rows, not
// accepted annotations in a producer proof. Extension candidate lookup is a
// separate source lookup stage and runs only after ordinary lookup permits it.
export function selectCsharpOverload(candidates, actuals, environment, occurrence) {
  const forms = [];
  for (const candidate of candidates) {
    environment.counter.charge('maxInvariantSteps', 'selected-overload-candidate');
    const normal = applicable(candidate, actuals, environment, false);
    const form = normal ?? applicable(candidate, actuals, environment, true);
    if (form) forms.push(form);
  }
  if (!forms.length) deny('INVALID_BINDING', 'no applicable selected overload', occurrence);
  // Applicability is established first. Only then do the actual most-derived
  // declaring types suppress applicable base/interface candidates (§12.8.10.2).
  const reduced = mostDerivedApplicableForms(forms, environment);
  const winners = reduced.filter(left => reduced.every(right => left === right || better(left, right, actuals, environment)));
  if (winners.length !== 1) deny('AMBIGUOUS_BINDING', 'selected overload has no unique better member', occurrence);
  return winners[0];
}

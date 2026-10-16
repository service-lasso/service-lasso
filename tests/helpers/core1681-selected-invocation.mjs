import { deny, isSourceDenialCode } from './core1681-source-input.mjs';
import { K2_LIMITS, canonicalData } from './core1681-proof-terms.mjs';
import { SelectedMethodInference } from './core1681-selected-inference.mjs';
import { mapSelectedArguments } from './core1681-selected-arguments.mjs';
import { checkSelectedGenericConstraints } from './core1681-selected-constraints.mjs';
import { genericSubstitution, substituteSelectedType } from './core1681-selected-types.mjs';
import { selectCsharpOverload } from './core1681-selected-overloads.mjs';
import { selectedDeclaringSubstitutions } from './core1681-selected-metadata.mjs';

// This bridge receives the body resolver's private actual argument rows. Lambda
// input/output bindings must be rebuilt from the original lambda declaration;
// they are not proof data or precomputed producer return-type annotations.
export function bindSelectedInvocation(methodGroup, actuals, explicitTypes, environment, originalCall) {
  if (!originalCall?.origin || !Array.isArray(methodGroup) || !Array.isArray(actuals) ||
      methodGroup.length > K2_LIMITS.maxDeclarations || actuals.length > K2_LIMITS.maxOccurrences ||
      explicitTypes !== null && !Array.isArray(explicitTypes))
    deny('INVALID_BINDING', 'invocation requires its original finite call/candidate/type-argument occurrences');
  if (typeof environment.resolveOriginalDefaults !== 'function' || typeof environment.delegateSignature !== 'function')
    deny('INVALID_BINDING', 'invocation requires the independent default and delegate signature binders');
  const version = environment.csharpLanguageVersion;
  if (!Array.isArray(version) || version.length !== 2 || version.some(value => !Number.isSafeInteger(value) || value < 0))
    deny('INVALID_BINDING', 'invocation requires its actual compiler-input language version', originalCall.origin);
  const pruneOwnConstraintMismatch = version[0] > 7 || version[0] === 7 && version[1] >= 3;
  const candidates = [];
  const deferredOwnConstraints = new Map();
  for (const original of methodGroup) {
    environment.counter.charge('maxInvariantSteps', 'original-method-invocation');
    const candidate = environment.resolveOriginalDefaults(original);
    if (!candidate || canonicalData(candidate.declaration) !== canonicalData(original.declaration) ||
        candidate.parameters.length !== original.parameters.length)
      deny('INVALID_BINDING', 'default binding changed original candidate identity');
    const parameters = candidate.typeParameters ?? [];
    if (candidate.genericArity !== parameters.length)
      deny('INVALID_BINDING', 'method generic arity differs from original parameter declarations');
    if (explicitTypes !== null && parameters.length !== explicitTypes.length) continue;
    let substitutions;
    if (explicitTypes !== null) substitutions = genericSubstitution(parameters, explicitTypes, environment.counter);
    else if (!parameters.length) substitutions = new Map();
    else {
      const correspondence = mapSelectedArguments(candidate, actuals, environment, false) ??
        mapSelectedArguments(candidate, actuals, environment, true);
      if (!correspondence) continue;
      const inference = new SelectedMethodInference(parameters, environment), outputs = [];
      let failed = false;
      for (const mapped of correspondence.mapping) {
        const actual = actuals[mapped.sourceIndex], formal = mapped.formal;
        if (actual.anonymousFunction) {
          if (!actual.anonymousFunction.origin || typeof actual.bindOriginalLambda !== 'function')
            deny('INVALID_BINDING', 'anonymous argument lost its original syntax/body binder');
          const signature = environment.delegateSignature(formal.type);
          if (!signature || !Array.isArray(signature.parameters) || !signature.returnType) { failed = true; break; }
          const lambda = actual.anonymousFunction;
          if (lambda.parameters.length !== signature.parameters.length) { failed = true; break; }
          if (lambda.explicitParameterTypes !== null) {
            if (!Array.isArray(lambda.explicitParameterTypes) || lambda.explicitParameterTypes.length !== signature.parameters.length)
              deny('INVALID_BINDING', 'original explicit lambda parameter roster differs');
            for (let index = 0; index < signature.parameters.length; index++)
              inference.bound(lambda.explicitParameterTypes[index], signature.parameters[index].type, 'exact');
          }
          outputs.push({ inputTypes: signature.parameters.map(parameter => parameter.type), outputType: signature.returnType,
            bindOriginalOutput: inputTypes => actual.bindOriginalLambda(inputTypes, signature)?.inferredReturnType ?? null });
        } else {
          if (!actual.type) { failed = true; break; }
          inference.bound(actual.type, formal.type, formal.direction === 'value' ? 'lower' : 'exact');
        }
      }
      if (failed) continue;
      const inferred = inference.solve(outputs);
      if (!inferred) continue;
      substitutions = inferred.substitutions;
    }
    const actualTypes = parameters.map(parameter => substitutions.get(canonicalData(parameter.declId)));
    // C#7.3 introduced pruning for a method's own constraint mismatch. Earlier
    // profiles choose the better member first, then fail that member's original
    // constraint; they must not silently bind a worse fallback overload.
    const enclosing = selectedDeclaringSubstitutions(candidate.declaringType, environment.declarationMetadata, environment.counter);
    for (const [declaration, actual] of enclosing) {
      environment.counter.charge('maxInvariantSteps', 'original-invocation-enclosing-substitution');
      if (substitutions.has(declaration)) deny('INVALID_BINDING', 'method and enclosing generic declarations overlap');
      substitutions.set(declaration, actual);
    }
    let ownConstraintMismatch;
    try { substitutions = checkSelectedGenericConstraints(parameters, actualTypes, environment, originalCall.origin, enclosing); }
    catch (error) {
      if (!isSourceDenialCode(error, 'CONSTRAINT_MISMATCH')) throw error;
      if (pruneOwnConstraintMismatch) continue;
      ownConstraintMismatch = error;
    }
    const substitute = type => substituteSelectedType(type, substitutions, environment.counter);
    const constructed = { ...candidate, genericArguments: actualTypes, substitutions,
      parameters: candidate.parameters.map(parameter => ({ ...parameter, type: substitute(parameter.type) })),
      returnType: candidate.returnType ? substitute(candidate.returnType) : null };
    // Anonymous conversion remains a separate body-binding obligation after
    // inference; this bridge does not turn an inferred return type into a
    // delegate conversion or fabricate a typed argument. Until the original
    // body/conversion binder supplies that argument, applicability denies it.
    candidates.push(constructed);
    if (ownConstraintMismatch) deferredOwnConstraints.set(constructed, ownConstraintMismatch);
  }
  const selected = selectCsharpOverload(candidates, actuals, environment, originalCall.origin);
  if (deferredOwnConstraints.has(selected.candidate)) throw deferredOwnConstraints.get(selected.candidate);
  return selected;
}

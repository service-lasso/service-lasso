import { deny } from './core1681-source-input.mjs';
import { canonicalData } from './core1681-proof-terms.mjs';
import { genericSubstitution, substituteSelectedType, selectedTypeKey } from './core1681-selected-types.mjs';
import { implicitCsharpConversion } from './core1681-selected-conversions.mjs';

function parameterConstraint(type, resolvedConstraints) {
  const row = resolvedConstraints.get(canonicalData(type.declaration));
  if (!row) deny('INVALID_BINDING', 'generic actual parameter constraints are not independently bound');
  return row;
}

function definitelyReference(type, resolvedConstraints, seen, counter) {
  const pending = [type];
  while (pending.length) {
    counter.charge('maxInvariantSteps', 'selected-reference-constraint');
    const current = pending.pop();
    if (['reference', 'array', 'delegate'].includes(current.category)) return true;
    if (current.category !== 'typeParameter') continue;
    const key = canonicalData(current.declaration);
    if (seen.has(key)) continue;
    seen.add(key);
    const row = parameterConstraint(current, resolvedConstraints);
    if (row.referenceType) return true;
    if (!Array.isArray(row.types) || !(row.classConstraintKeys instanceof Set))
      deny('INVALID_BINDING', 'reference constraint row lacks resolved class/interface distinction');
    // An interface constraint alone permits value-type implementations.
    for (const constraint of row.types) {
      if (constraint.category === 'typeParameter') pending.push(constraint);
      if (constraint.category === 'reference' && row.classConstraintKeys.has(selectedTypeKey(constraint))) return true;
    }
  }
  return false;
}

function definitelyValue(type, resolvedConstraints) {
  if (['primitive', 'enum', 'struct'].includes(type.category)) return type.name !== 'void';
  return type.category === 'typeParameter' && parameterConstraint(type, resolvedConstraints).valueType === true;
}

function publicDefaultConstructor(type, metadata, constraints) {
  if (definitelyValue(type, constraints)) return true;
  if (type.category === 'typeParameter') return parameterConstraint(type, constraints).defaultConstructor === true;
  const row = metadata.get(canonicalData(type.declaration));
  if (!row) deny('INVALID_BINDING', 'constructor constraint requires actual resolved type metadata');
  return row.category === 'class' && row.abstract === false && row.constructors.some(constructor =>
    constructor.accessibility === 'public' && !constructor.static && constructor.parameters.length === 0);
}

// The caller rebuilds these rows from original constraint/type/constructor
// declarations. A serialized producer assertion is never a metadata row.
export function checkSelectedGenericConstraints(parameters, actuals, environment, occurrence, enclosingSubstitutions = new Map()) {
  const { counter, parameterConstraints, declarationMetadata } = environment;
  const substitutions = genericSubstitution(parameters, actuals, counter);
  if (!(enclosingSubstitutions instanceof Map)) deny('INVALID_BINDING', 'constraint enclosing substitutions are not independently resolved');
  for (const [declaration, actual] of enclosingSubstitutions) {
    counter.charge('maxInvariantSteps', 'selected-enclosing-constraint-substitution');
    if (substitutions.has(declaration)) deny('INVALID_BINDING', 'constraint substitution repeats an original generic declaration');
    selectedTypeKey(actual); substitutions.set(declaration, actual);
  }
  for (let index = 0; index < parameters.length; index++) {
    counter.charge('maxInvariantSteps', 'selected-generic-constraint');
    const constraints = parameterConstraints.get(canonicalData(parameters[index].declId));
    if (!constraints || !Array.isArray(constraints.types))
      deny('INVALID_BINDING', 'generic formal constraints have not been independently resolved', occurrence);
    const actual = actuals[index];
    if (!actual || actual.category === 'null' || actual.name === 'void')
      deny('INVALID_BINDING', 'generic argument cannot be the null type or void', occurrence);
    if (constraints.referenceType && !definitelyReference(actual, parameterConstraints, new Set(), counter))
      deny('CONSTRAINT_MISMATCH', 'generic actual fails the reference-type constraint', occurrence);
    if (constraints.valueType && !definitelyValue(actual, parameterConstraints))
      deny('CONSTRAINT_MISMATCH', 'generic actual fails the nonnullable value-type constraint', occurrence);
    if (constraints.defaultConstructor && !publicDefaultConstructor(actual, declarationMetadata, parameterConstraints))
      deny('CONSTRAINT_MISMATCH', 'generic actual fails the public parameterless constructor constraint', occurrence);
    for (const unresolved of constraints.types) {
      const required = substituteSelectedType(unresolved, substitutions, counter);
      const conversion = implicitCsharpConversion(actual, required, environment);
      if (!conversion || !['identity', 'reference', 'boxing', 'typeParameter'].includes(conversion.kind))
        deny('CONSTRAINT_MISMATCH', 'generic actual fails its substituted base/interface constraint', occurrence);
    }
  }
  return substitutions;
}

export function resolveSelectedParameterConstraints(enumeration, typeIndex, contextFor, declarationMetadata, counter) {
  const rows = new Map(), owners = [];
  for (const entry of enumeration) {
    if (!entry.syntax.typeParameters?.length) continue;
    owners.push(entry);
    const names = new Set();
    for (const parameter of entry.syntax.typeParameters) {
      counter.charge('maxInvariantSteps', 'selected-constraint-enumeration');
      if (!parameter.declId || names.has(parameter.name.spelling))
        deny('INVALID_BINDING', 'generic parameters require unique actual names and identities', entry.origin);
      names.add(parameter.name.spelling);
      const key = canonicalData(parameter.declId);
      if (rows.has(key)) deny('INVALID_BINDING', 'generic parameter identity is repeated', parameter.origin);
      rows.set(key, { referenceType: false, valueType: false, defaultConstructor: false,
        types: [], classConstraintKeys: new Set(), parameter: parameter.declId, owner: entry.declId });
    }
  }
  for (const entry of owners) {
    const context = { ...contextFor(entry), owner: entry.declId, parameterConstraints: rows }, clauses = new Set();
    for (const clause of entry.syntax.constraints ?? []) {
      counter.charge('maxInvariantSteps', 'selected-constraint-clause');
      const parameter = entry.syntax.typeParameters.find(value => value.name.spelling === clause.parameter.spelling);
      if (!parameter || clauses.has(clause.parameter.spelling))
        deny('INVALID_BINDING', 'constraint clause must uniquely name an actual generic parameter', clause.origin);
      clauses.add(clause.parameter.spelling);
      const row = rows.get(canonicalData(parameter.declId)), seenTypes = new Set();
      let primary = false, constructor = false, classType = false;
      for (let ordinal = 0; ordinal < clause.alternatives.length; ordinal++) {
        const alternative = clause.alternatives[ordinal];
        if (alternative.kind === 'typeConstraint') {
          if (ordinal !== 0 || primary || !['class', 'struct'].includes(alternative.category))
            deny('INVALID_BINDING', 'class/struct constraint must occur once and first', alternative.origin);
          primary = true; row.referenceType = alternative.category === 'class'; row.valueType = alternative.category === 'struct';
        } else if (alternative.kind === 'constructorConstraint') {
          if (constructor || row.valueType || ordinal !== clause.alternatives.length - 1)
            deny('INVALID_BINDING', 'new constraint must occur once and last without struct', alternative.origin);
          constructor = true; row.defaultConstructor = true;
        } else {
          const resolved = typeIndex.resolve(alternative, context), key = selectedTypeKey(resolved);
          if (seenTypes.has(key) || resolved.category === 'typeParameter' && canonicalData(resolved.declaration) === canonicalData(parameter.declId))
            deny('INVALID_BINDING', 'constraint type is duplicated or directly self-dependent', alternative.origin);
          seenTypes.add(key);
          if (resolved.category === 'typeParameter') row.types.push(resolved);
          else {
            const metadata = declarationMetadata.get(canonicalData(resolved.declaration));
            if (!metadata || !['class', 'interface'].includes(metadata.category))
              deny('INVALID_BINDING', 'constraint must name an independently bound class/interface/parameter', alternative.origin);
            if (metadata.category === 'class') {
              if (primary || classType || ordinal !== 0 || metadata.sealed || metadata.static ||
                  ['object', 'string'].includes(resolved.name))
                deny('INVALID_BINDING', 'class constraint is sealed, conflicting, repeated or misplaced', alternative.origin);
              classType = true; row.classConstraintKeys.add(key);
            }
            row.types.push(resolved);
          }
        }
      }
    }
  }
  // This check follows resolution of every clause, so a later source clause
  // cannot conceal the referenced parameter's struct constraint.
  for (const row of rows.values()) for (const type of row.types) {
    counter.charge('maxInvariantSteps', 'selected-parameter-constraint-legality');
    if (type.category === 'typeParameter' && parameterConstraint(type, rows).valueType)
      deny('INVALID_BINDING', 'a struct-constrained parameter cannot itself be a parameter constraint');
  }
  // Reject parameter dependency cycles with an explicit stack. Generic class
  // arguments may refer to the parameter (F-bounds); only direct parameter
  // constraint dependencies are edges in this graph.
  const complete = new Set();
  for (const root of rows.keys()) {
    if (complete.has(root)) continue;
    const active = new Set(), pending = [{ key: root, leaving: false }];
    while (pending.length) {
      counter.charge('maxInvariantSteps', 'selected-constraint-dependency');
      const frame = pending.pop();
      if (frame.leaving) { active.delete(frame.key); complete.add(frame.key); continue; }
      if (active.has(frame.key)) deny('INVALID_BINDING', 'generic parameter constraints contain a dependency cycle');
      if (complete.has(frame.key)) continue;
      const row = rows.get(frame.key);
      if (!row) deny('INVALID_BINDING', 'parameter constraint dependency is outside actual enumeration');
      active.add(frame.key); pending.push({ key: frame.key, leaving: true });
      for (const type of row.types) if (type.category === 'typeParameter')
        pending.push({ key: canonicalData(type.declaration), leaving: false });
    }
  }
  for (const [key, row] of rows) {
    row.effectiveReferenceType = definitelyReference({ category: 'typeParameter', declaration: row.parameter }, rows, new Set(), counter);
    if (row.valueType && row.effectiveReferenceType)
      deny('INVALID_BINDING', 'generic parameter has incompatible effective class and struct constraints', { declaration: key });
  }
  return rows;
}

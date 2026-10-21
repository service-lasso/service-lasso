import { deny } from './core1681-source-input.mjs';
import { canonicalData, K2_LIMITS } from './core1681-proof-terms.mjs';
import { selectedTypeKey, equalSelectedTypes, substituteSelectedType, genericSubstitution } from './core1681-selected-types.mjs';
import { implicitCsharpConversion } from './core1681-selected-conversions.mjs';

// This engine consumes the resolver's private bound source types. A proof
// annotation cannot supply a bound, variance row, base edge or lambda result.
export class SelectedMethodInference {
  constructor(parameters, environment) {
    if (!Array.isArray(parameters) || parameters.length > K2_LIMITS.maxDeclarations)
      deny('INVALID_BINDING', 'generic inference parameter roster is not finite');
    this.environment = environment; this.counter = environment.counter;
    this.parameters = parameters; this.rows = new Map(); this.fixed = new Map();
    for (const parameter of parameters) {
      this.counter.charge('maxInvariantSteps', 'method-inference-parameter');
      const id = canonicalData(parameter.declId);
      if (!parameter.declId || this.rows.has(id)) deny('INVALID_BINDING', 'inference repeats an original type parameter');
      this.rows.set(id, { exact: new Map(), lower: new Map(), upper: new Map() });
    }
  }
  reference(type) {
    if (['reference', 'array', 'delegate'].includes(type.category)) return true;
    if (type.category !== 'typeParameter') return false;
    const row = this.environment.parameterConstraints.get(canonicalData(type.declaration));
    if (!row) deny('INVALID_BINDING', 'inference parameter lacks resolved constraint metadata');
    return row.effectiveReferenceType === true || row.referenceType === true;
  }
  variables(type, result = new Set(), depth = 0) {
    this.counter.charge('maxInvariantSteps', 'method-inference-variable-occurrence');
    if (depth >= K2_LIMITS.maxTermDepth) deny('INVALID_BINDING', 'inference type nesting exhausted');
    if (type.category === 'typeParameter') {
      const id = canonicalData(type.declaration);
      if (this.rows.has(id) && !this.fixed.has(id)) result.add(id);
      return result;
    }
    if (type.element) this.variables(type.element, result, depth + 1);
    for (const argument of type.arguments ?? []) this.variables(argument, result, depth + 1);
    if (type.enclosingType) this.variables(type.enclosingType, result, depth + 1);
    return result;
  }
  matchingConstructed(type, declaration) {
    const matches = new Map(), pending = [type], visited = new Set();
    while (pending.length) {
      this.counter.charge('maxInvariantSteps', 'method-inference-base-search');
      const current = pending.pop(), id = selectedTypeKey(current);
      if (visited.has(id)) continue;
      visited.add(id);
      if (current.declaration && canonicalData(current.declaration) === canonicalData(declaration))
        matches.set(id, current);
      if (current.category === 'typeParameter') {
        const row = this.environment.parameterConstraints.get(canonicalData(current.declaration));
        if (!row || !Array.isArray(row.types)) deny('INVALID_BINDING', 'inference effective parameter bases are missing');
        pending.push(...row.types);
      } else if (!['null', 'nullable'].includes(current.category)) {
        const bases = this.environment.typeGraph.get(id);
        if (!Array.isArray(bases)) deny('INVALID_BINDING', 'inference requires the complete original instantiated base graph');
        pending.push(...bases);
      }
    }
    return matches.size === 1 ? [...matches.values()][0] : null;
  }
  bound(source, target, kind, depth = 0) {
    this.counter.charge('maxInvariantSteps', `method-inference-${kind}`);
    if (!['exact', 'lower', 'upper'].includes(kind) || depth >= K2_LIMITS.maxTermDepth)
      deny('INVALID_BINDING', 'inference bound sort or depth is invalid');
    source = substituteSelectedType(source, this.fixed, this.counter);
    target = substituteSelectedType(target, this.fixed, this.counter);
    if (source.category === 'null' || source.name === 'void') return;
    if (target.category === 'typeParameter') {
      const row = this.rows.get(canonicalData(target.declaration));
      if (row && !this.fixed.has(canonicalData(target.declaration))) row[kind].set(selectedTypeKey(source), source);
      return;
    }
    let sources = null, targets = null, varianceOwner = null, array = false;
    if (source.category === 'array' && target.category === 'array' && source.rank === target.rank) {
      sources = [source.element]; targets = [target.element]; array = true;
    } else if (target.category === 'nullable' && (kind === 'exact' || source.category === 'nullable')) {
      sources = [source.category === 'nullable' ? source.element : source]; targets = [target.element];
    } else if (kind !== 'exact' && (source.category === 'array' && source.rank === 1 || target.category === 'array' && target.rank === 1)) {
      const named = kind === 'lower' ? target : source;
      const arrayType = kind === 'lower' ? source : target;
      if (arrayType.category !== 'array' || arrayType.rank !== 1 || !named.declaration) return;
      const interfaces = this.environment.arrayInferenceInterfaces;
      if (!(interfaces instanceof Set)) deny('INVALID_BINDING', 'array inference requires the fixed selected interface declaration roster');
      if (!interfaces.has(canonicalData(named.declaration)) || named.arguments?.length !== 1) return;
      sources = [kind === 'lower' ? source.element : source.arguments[0]];
      targets = [kind === 'lower' ? target.arguments[0] : target.element]; array = true;
    } else if (source.declaration && target.declaration) {
      let left = source, right = target;
      if (kind === 'exact') {
        if (canonicalData(left.declaration) !== canonicalData(right.declaration)) return;
      } else if (kind === 'lower') {
        left = this.matchingConstructed(source, target.declaration);
        if (!left) return;
      } else {
        right = this.matchingConstructed(target, source.declaration);
        if (!right) return;
      }
      sources = left.arguments ?? []; targets = right.arguments ?? [];
      varianceOwner = kind === 'upper' ? left : right;
      if (Boolean(left.enclosingType) !== Boolean(right.enclosingType))
        deny('INVALID_BINDING', 'inference constructed declaring chains differ');
      if (left.enclosingType) this.bound(left.enclosingType, right.enclosingType, 'exact', depth + 1);
    }
    if (!sources) return;
    if (sources.length !== targets.length) deny('INVALID_BINDING', 'inference constructed actual arity differs');
    const owner = varianceOwner && this.environment.declarationMetadata.get(canonicalData(varianceOwner.declaration));
    if (varianceOwner && (!owner || owner.typeParameters.length !== sources.length))
      deny('INVALID_BINDING', 'inference variance lacks original generic declaration metadata');
    for (let ordinal = 0; ordinal < sources.length; ordinal++) {
      let nestedKind = 'exact';
      if (kind !== 'exact' && this.reference(sources[ordinal])) {
        if (array) nestedKind = kind;
        else {
          const variance = owner?.typeParameters[ordinal].variance ?? null;
          if (![null, 'in', 'out'].includes(variance)) deny('INVALID_BINDING', 'unbound generic variance spelling');
          nestedKind = variance === 'out' ? kind : variance === 'in' ? kind === 'lower' ? 'upper' : 'lower' : 'exact';
        }
      }
      this.bound(sources[ordinal], targets[ordinal], nestedKind, depth + 1);
    }
  }
  fix(id) {
    const row = this.rows.get(id);
    if (!row || this.fixed.has(id)) deny('INVALID_BINDING', 'inference fixes an absent or already fixed parameter');
    const candidates = new Map([...row.exact, ...row.lower, ...row.upper]);
    const converts = (source, target) => Boolean(implicitCsharpConversion(source, target, this.environment));
    for (const [candidateId, candidate] of candidates) {
      this.counter.charge('maxInvariantSteps', 'method-inference-fix-candidate');
      if ([...row.exact.values()].some(bound => !equalSelectedTypes(bound, candidate)) ||
          [...row.lower.values()].some(bound => !converts(bound, candidate)) ||
          [...row.upper.values()].some(bound => !converts(candidate, bound))) candidates.delete(candidateId);
    }
    const winners = [...candidates.values()].filter(candidate => [...candidates.values()].every(other => converts(other, candidate)));
    if (winners.length !== 1) return false;
    this.fixed.set(id, winners[0]); return true;
  }
  solve(outputRelations = []) {
    if (!Array.isArray(outputRelations) || outputRelations.length > K2_LIMITS.maxOccurrences)
      deny('INVALID_BINDING', 'inference output relation roster is not finite');
    const observed = new Set();
    while (this.fixed.size !== this.rows.size) {
      this.counter.charge('maxInvariantSteps', 'method-inference-phase-two');
      for (let ordinal = 0; ordinal < outputRelations.length; ordinal++) {
        const relation = outputRelations[ordinal];
        if (observed.has(ordinal) || !this.variables(relation.outputType).size ||
            relation.inputTypes.some(input => this.variables(input).size)) continue;
        const inputs = relation.inputTypes.map(input => substituteSelectedType(input, this.fixed, this.counter));
        // Output inference precedes fixing. Otherwise an output-only variable
        // (for example Func<T>) would be fixed from an empty bound set before
        // its original lambda return can contribute a bound.
        const output = relation.bindOriginalOutput(inputs);
        if (!output) return null;
        this.bound(output, relation.outputType, 'lower'); observed.add(ordinal);
      }
      const dependencies = new Map([...this.rows.keys()].filter(id => !this.fixed.has(id)).map(id => [id, new Set()]));
      for (const relation of outputRelations) {
        const inputs = new Set();
        for (const input of relation.inputTypes) this.variables(input, inputs);
        for (const output of this.variables(relation.outputType)) for (const input of inputs)
          dependencies.get(output).add(input);
      }
      // Transitive dependency is computed over actual variable occurrences.
      // Cyclic output/input relationships use the specification's bound-bearing
      // fallback; no lexical order or numeric producer rank chooses a type.
      for (const [id, direct] of dependencies) {
        const pending = [...direct];
        while (pending.length) {
          this.counter.charge('maxInvariantSteps', 'method-inference-dependency');
          const next = pending.pop();
          for (const ancestor of dependencies.get(next) ?? []) if (!direct.has(ancestor)) { direct.add(ancestor); pending.push(ancestor); }
        }
      }
      let selected = [...dependencies].filter(([id, dependencies_]) => !dependencies_.size &&
        ['exact', 'lower', 'upper'].some(kind => this.rows.get(id)[kind].size)).map(([id]) => id);
      if (!selected.length) selected = [...dependencies.keys()].filter(id =>
        [...dependencies.values()].some(dependencies_ => dependencies_.has(id)) &&
        ['exact', 'lower', 'upper'].some(kind => this.rows.get(id)[kind].size));
      if (!selected.length) return null;
      for (const id of selected) if (!this.fix(id)) return null;
    }
    const arguments_ = this.parameters.map(parameter => this.fixed.get(canonicalData(parameter.declId)));
    return { arguments: arguments_, substitutions: genericSubstitution(this.parameters, arguments_, this.counter) };
  }
}

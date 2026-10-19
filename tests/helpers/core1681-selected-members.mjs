import { deny } from './core1681-source-input.mjs';
import { canonicalData, K2_LIMITS } from './core1681-proof-terms.mjs';
import { selectedTypeKey, substituteSelectedType, selectedTypeIdentity } from './core1681-selected-types.mjs';
import { selectedDeclaringSubstitutions } from './core1681-selected-metadata.mjs';

const key = canonicalData;

// The index is reconstructed from original declarations and private resolved
// rows. This is nominal member lookup, not overload selection or a primitive
// effect grant. Compilation groups must come from actual compiler inputs.
export class SelectedMemberIndex {
  constructor(enumeration, boundDeclarations, environment) {
    this.environment = environment; this.counter = environment.counter;
    this.metadata = boundDeclarations.declarationMetadata;
    if (!(this.metadata instanceof Map) || !(environment.typeGraph instanceof Map) ||
        !(environment.compilationGroups instanceof Map) || typeof environment.openSourceType !== 'function')
      deny('INVALID_BINDING', 'member lookup requires the private original type graph and compiler-input context');
    this.entries = new Map(); this.members = new Map();
    for (const entry of enumeration) {
      this.counter.charge('maxInvariantSteps', 'original-member-index');
      const id = key(entry.declId);
      if (this.entries.has(id)) deny('INVALID_BINDING', 'member index repeats a declaration', entry.origin);
      this.entries.set(id, entry);
      if (!['field', 'property', 'method', 'type', 'delegate', 'enumMember'].includes(entry.syntax.kind)) continue;
      const owner = entry.declId.parent.types.at(-1);
      if (!owner) continue;
      const spelling = entry.syntax.name?.spelling ?? entry.syntax.name;
      if (typeof spelling !== 'string' || !spelling) deny('INVALID_BINDING', 'original member has no identifier', entry.origin);
      let row = this.metadata.get(id);
      if (entry.syntax.kind === 'field') {
        const storage = boundDeclarations.storageMetadata.get(id);
        if (!storage) deny('INVALID_BINDING', 'original field lacks resolved storage', entry.origin);
        row = { declaration: entry.declId, category: 'field', type: storage.type,
          static: storage.storage === 'static' || storage.constant, accessibility: storage.visibility,
          constant: storage.constant, readonly: storage.readonly, volatile: storage.volatile, origin: entry.origin };
      }
      if (!row) deny('INVALID_BINDING', 'original member lacks independently resolved metadata', entry.origin);
      const ownerMembers = this.members.get(key(owner)) ?? [];
      ownerMembers.push({ entry, row, spelling }); this.members.set(key(owner), ownerMembers);
    }
  }
  bases(type) {
    const bases = this.environment.typeGraph.get(selectedTypeKey(type));
    if (!Array.isArray(bases)) deny('INVALID_BINDING', 'member lookup requires the complete instantiated original base graph');
    return bases;
  }
  lookupRoots(type) {
    if (type.category !== 'typeParameter') return [type];
    const pending = [type], seen = new Set(), roots = new Map();
    while (pending.length) {
      this.counter.charge('maxInvariantSteps', 'original-parameter-member-roots');
      const current = pending.pop(), identity = selectedTypeKey(current);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const row = this.environment.parameterConstraints?.get(key(current.declaration));
      if (!row || !Array.isArray(row.types) || key(row.parameter) !== key(current.declaration))
        deny('INVALID_BINDING', 'parameter member lookup lacks independently bound original constraints');
      if (row.valueType) {
        const valueType = this.environment.valueTypeRoot;
        if (!valueType?.declaration || !this.metadata.has(key(valueType.declaration)))
          deny('INVALID_BINDING', 'value-constrained parameter lacks the original ValueType catalogue identity');
        roots.set(selectedTypeKey(valueType), valueType);
      }
      for (const constraint of row.types) {
        if (constraint.category === 'typeParameter') pending.push(constraint);
        else roots.set(selectedTypeKey(constraint), constraint);
      }
    }
    const object = this.environment.objectType;
    if (!object?.declaration || !this.metadata.has(key(object.declaration)))
      deny('INVALID_BINDING', 'parameter member lookup lacks the original Object catalogue identity');
    roots.set(selectedTypeKey(object), object);
    return [...roots.values()];
  }
  derives(type, declaration) {
    const pending = this.lookupRoots(type), seen = new Set();
    while (pending.length) {
      this.counter.charge('maxInvariantSteps', 'member-access-ancestry');
      const current = pending.pop(), id = selectedTypeKey(current);
      if (seen.has(id)) continue;
      seen.add(id);
      if (current.declaration && key(current.declaration) === key(declaration)) return true;
      pending.push(...this.bases(current));
    }
    return false;
  }
  sameAssembly(leftUnit, rightUnit) {
    const groups = this.environment.compilationGroups;
    if (!(groups instanceof Map) || !groups.has(leftUnit) || !groups.has(rightUnit))
      deny('INVALID_BINDING', 'accessibility requires actual source compilation-group inputs');
    return groups.get(leftUnit) === groups.get(rightUnit);
  }
  enclosingDeclaration(context, owner) {
    const chain = context.currentType?.declaration;
    return Boolean(chain && [chain, ...chain.parent.types].some(declaration => key(declaration) === key(owner)));
  }
  accessible(row, ownerType, context, receiverType, depth = 0) {
    this.counter.charge('maxInvariantSteps', 'original-member-accessibility');
    if (depth >= K2_LIMITS.maxTermDepth) deny('INVALID_BINDING', 'member access nesting exhausted');
    const owner = ownerType.declaration;
    const internal = () => this.sameAssembly(owner.unit, context.unit);
    const protected_ = () => {
      if (!context.currentType) return false;
      const candidateContexts = [context.currentType];
      for (const declaration of context.currentType.declaration.parent.types) {
        const enclosing = this.environment.openSourceType(declaration, context);
        candidateContexts.push(enclosing);
      }
      return candidateContexts.some(current => this.derives(current, owner) &&
        (row.static || receiverType === null || this.derives(receiverType, current.declaration)));
    };
    let allowed;
    switch (row.accessibility) {
      case 'public': allowed = true; break;
      case 'private': allowed = this.enclosingDeclaration(context, owner); break;
      case 'internal': allowed = internal(); break;
      case 'protected': allowed = protected_(); break;
      case 'protectedInternal': allowed = internal() || protected_(); break;
      default: deny('INVALID_BINDING', 'member access domain is not an original resolved visibility');
    }
    if (!allowed) return false;
    const ownerMetadata = this.metadata.get(key(owner));
    if (!ownerMetadata) deny('INVALID_BINDING', 'member declaring type access metadata is absent');
    const parent = owner.parent.types.at(-1);
    if (parent) {
      if (!ownerType.enclosingType || key(ownerType.enclosingType.declaration) !== key(parent))
        deny('INVALID_BINDING', 'member declaring accessibility chain differs from original enclosing type');
      return this.accessible(ownerMetadata, ownerType.enclosingType, context, null, depth + 1);
    }
    return ownerMetadata.accessibility === 'public' || ownerMetadata.accessibility === 'internal' && internal();
  }
  constructedMember(member, declaringType) {
    const substitutions = selectedDeclaringSubstitutions(declaringType, this.metadata, this.counter);
    const substitute = type => substituteSelectedType(type, substitutions, this.counter);
    const row = member.row;
    return { ...row, originalDeclaringType: row.declaringType ?? null, declaringType,
      ...(row.type ? { type: substitute(row.type) } : {}),
      ...(row.returnType ? { returnType: substitute(row.returnType) } : {}),
      ...(row.parameters ? { parameters: row.parameters.map(parameter => ({ ...parameter, type: substitute(parameter.type) })) } : {}),
      ...(row.originalParameterTypes ? { originalParameterTypes: row.originalParameterTypes.slice() } : {}),
      receiverType: row.static ? null : declaringType, sourceEntry: member.entry };
  }
  signature(row) {
    const parameters = new Map((row.typeParameters ?? []).map((parameter, ordinal) => [key(parameter.declId), ordinal]));
    const identity = (type, depth = 0) => {
      this.counter.charge('maxInvariantSteps', 'member-hiding-signature');
      if (depth >= K2_LIMITS.maxTermDepth) deny('INVALID_BINDING', 'member signature depth exhausted');
      if (type.category === 'typeParameter' && parameters.has(key(type.declaration))) return ['methodParameter', parameters.get(key(type.declaration))];
      if (type.element) return [type.category, type.rank ?? null, identity(type.element, depth + 1)];
      if (type.declaration && type.category !== 'typeParameter') return ['named', type.declaration,
        (type.arguments ?? []).map(argument => identity(argument, depth + 1)), type.enclosingType ? identity(type.enclosingType, depth + 1) : null];
      return selectedTypeIdentity(type);
    };
    return key([row.genericArity, row.parameters.map(parameter =>
      [parameter.direction === 'value' ? 'value' : 'byReference', identity(parameter.type)])]);
  }
  lookup(receiverType, originalName, context, { arity = 0, invoked = false } = {}) {
    if (!originalName?.origin || typeof originalName.spelling !== 'string' || !Number.isSafeInteger(arity) || arity < 0)
      deny('INVALID_BINDING', 'member lookup requires its original identifier/arity occurrence');
    const parameterReceiver = receiverType.category === 'typeParameter';
    const rootMetadata = parameterReceiver ? null : this.metadata.get(key(receiverType.declaration));
    if (!parameterReceiver && !rootMetadata) deny('INVALID_BINDING', 'member receiver lacks original named type metadata');
    const candidates = [], pending = this.lookupRoots(receiverType), visited = new Set();
    if (rootMetadata?.category === 'interface') {
      const object = this.environment.objectType;
      if (!object?.declaration || !this.metadata.has(key(object.declaration)))
        deny('INVALID_BINDING', 'interface member lookup lacks the original Object catalogue identity');
      pending.push(object);
    }
    while (pending.length) {
      this.counter.charge('maxInvariantSteps', 'original-member-lookup');
      const current = pending.pop(), id = selectedTypeKey(current);
      if (visited.has(id)) continue;
      visited.add(id);
      for (const member of this.members.get(key(current.declaration)) ?? []) {
        if (member.spelling !== originalName.spelling || member.entry.syntax.modifiers?.includes('override')) continue;
        if (invoked && member.row.category !== 'method' && !(['field', 'property'].includes(member.row.category) &&
            member.row.type?.category === 'delegate')) continue;
        const memberArity = member.row.genericArity ?? member.entry.syntax.typeParameters?.length ?? 0;
        if (arity && memberArity !== arity || !arity && ['type', 'delegate'].includes(member.entry.syntax.kind) && memberArity) continue;
        if (this.accessible(member.row, current, context, receiverType)) candidates.push(this.constructedMember(member, current));
      }
      for (const base of this.bases(current)) {
        const baseMetadata = this.metadata.get(key(base.declaration));
        if (!baseMetadata) deny('INVALID_BINDING', 'member lookup base metadata is absent');
        // Implemented interfaces are not ordinary class/struct members. Their
        // declarations remain in interface/type-parameter lookup and conversions.
        if (parameterReceiver || rootMetadata.category === 'interface' || baseMetadata.category !== 'interface') pending.push(base);
      }
    }
    const surviving = candidates.filter(base => !candidates.some(derived => {
      if (derived === base || selectedTypeKey(derived.declaringType) === selectedTypeKey(base.declaringType)) return false;
      if (parameterReceiver && this.metadata.get(key(derived.declaringType.declaration))?.category === 'class' &&
          selectedTypeKey(derived.declaringType) !== selectedTypeKey(this.environment.objectType) &&
          this.metadata.get(key(base.declaringType.declaration))?.category === 'interface') {
        return derived.category !== 'method' || base.category !== 'method' || this.signature(derived) === this.signature(base);
      }
      if (!this.derives(derived.declaringType, base.declaringType.declaration)) return false;
      // Ordinary method lookup removes hidden non-methods. Applicable method
      // candidates, including equal signatures, are reduced only at invocation.
      return derived.category !== 'method' || base.category !== 'method';
    }));
    if (!surviving.length) return { kind: 'unresolvedMember', originalOccurrence: originalName.origin, candidates: [] };
    if (surviving.every(row => row.category === 'method'))
      return { kind: 'methodGroup', originalOccurrence: originalName.origin, candidates: surviving };
    if (surviving.length !== 1) deny('AMBIGUOUS_BINDING', 'member lookup has incompatible surviving declarations', originalName.origin);
    return { kind: 'member', originalOccurrence: originalName.origin, candidates: surviving };
  }
}

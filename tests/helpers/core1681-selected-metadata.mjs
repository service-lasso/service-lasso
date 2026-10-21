import { deny } from './core1681-source-input.mjs';
import { canonicalData, K2_LIMITS } from './core1681-proof-terms.mjs';
import { csharpVisibility, csharpStorage, checkCsharpInitializerSlots, checkSelectedArrayInitializerShape } from './core1681-selected-storage.mjs';
import { resolveSelectedParameterConstraints } from './core1681-selected-constraints.mjs';
import { selectedTypeKey, selectedTypeIdentity, genericSubstitution, substituteSelectedType } from './core1681-selected-types.mjs';

const key = canonicalData;
const narrowerAccessorAccess = {
  public: new Set(['protectedInternal', 'protected', 'internal', 'private']),
  protectedInternal: new Set(['protected', 'internal', 'private']),
  protected: new Set(['private']), internal: new Set(['private']), private: new Set(),
};

function checkOriginalParameterShape(parameters, syntaxParameters, origin) {
  if (parameters.length !== syntaxParameters.length) deny('INVALID_BINDING', 'formal signature differs from original parameter roster', origin);
  const names = new Set(); let optionalSeen = false;
  for (let ordinal = 0; ordinal < parameters.length; ordinal++) {
    const formal = parameters[ordinal], syntax = syntaxParameters[ordinal];
    const spelling = syntax.name?.spelling;
    if (typeof spelling !== 'string' || !spelling || names.has(spelling))
      deny('INVALID_BINDING', 'original formal names are absent or duplicated', syntax.origin);
    names.add(spelling);
    if (!['value', 'ref', 'out', 'in'].includes(formal.direction) || formal.type.name === 'void')
      deny('INVALID_BINDING', 'formal direction or storage type is invalid', syntax.origin);
    if (formal.variadic && (ordinal !== parameters.length - 1 || formal.direction !== 'value' ||
        formal.type.category !== 'array' || formal.type.rank !== 1 || syntax.defaultValue !== null))
      deny('INVALID_BINDING', 'params requires the final nonoptional value array formal', syntax.origin);
    const optional = syntax.defaultValue !== null;
    if (optional && ['ref', 'out'].includes(formal.direction) || optionalSeen && !optional && !formal.variadic)
      deny('INVALID_BINDING', 'optional formal order or ref/out default is invalid', syntax.origin);
    optionalSeen ||= optional;
  }
}

function checkOriginalMemberSignatures(enumeration, metadata, counter) {
  const signatures = new Map();
  for (const entry of enumeration) {
    if (!['method', 'constructor'].includes(entry.syntax.kind)) continue;
    counter.charge('maxInvariantSteps', 'selected-original-member-signature');
    const row = metadata.get(key(entry.declId));
    if (!row) deny('INVALID_BINDING', 'original callable signature lacks resolved metadata', entry.origin);
    const parameters = new Map((entry.syntax.typeParameters ?? []).map((parameter, ordinal) => [key(parameter.declId), ordinal]));
    const identity = (type, depth = 0) => {
      counter.charge('maxInvariantSteps', 'selected-member-signature-type');
      if (depth >= K2_LIMITS.maxTermDepth) deny('INVALID_BINDING', 'member signature nesting exhausted', entry.origin);
      if (type.category === 'typeParameter' && parameters.has(key(type.declaration)))
        return ['methodParameter', parameters.get(key(type.declaration))];
      if (type.category === 'array') return ['array', type.rank, identity(type.element, depth + 1)];
      if (type.category === 'nullable') return ['nullable', identity(type.element, depth + 1)];
      if (type.declaration && type.category !== 'typeParameter')
        return ['named', type.declaration, (type.arguments ?? []).map(argument => identity(argument, depth + 1)),
          type.enclosingType ? identity(type.enclosingType, depth + 1) : null];
      return selectedTypeIdentity(type);
    };
    // Return types, parameter names, defaults and params spelling never
    // distinguish overloads. Ref/out/in all occupy the same by-reference
    // signature position; a value formal remains a distinct position.
    const signature = key([entry.declId.parent.types.at(-1), row.category,
      row.category === 'constructor' ? row.static : entry.syntax.name.spelling, row.genericArity,
      row.parameters.map(parameter => [parameter.direction === 'value' ? 'value' : 'byReference', identity(parameter.type)])]);
    if (signatures.has(signature)) deny('INVALID_BINDING', 'original members have identical callable signatures', entry.origin);
    signatures.set(signature, entry.declId);
  }
}

// Phases rebuild metadata from private original syntax/enumeration. None of
// these maps is loaded from a producer's proof annotation or native provider.
export function bindSelectedCsharpDeclarations(enumeration, typeIndex, contextFor, counter) {
  const declarations = new Map(enumeration.map(entry => [key(entry.declId), entry]));
  if (declarations.size !== enumeration.length) deny('INVALID_BINDING', 'declaration metadata repeats an actual identity');
  const metadata = new Map(), storage = new Map(), typeGraph = new Map(), initializerPlans = new Map();
  for (const entry of enumeration) {
    counter.charge('maxInvariantSteps', 'selected-declaration-metadata');
    const syntax = entry.syntax;
    if (!['type', 'delegate', 'catalogueType'].includes(syntax.kind)) continue;
    const category = syntax.kind === 'delegate' ? 'delegate' : syntax.category ?? syntax.typeCategory;
    if (!['class', 'struct', 'interface', 'enum', 'delegate'].includes(category))
      deny('INVALID_BINDING', 'selected named declaration has no language category', entry.origin);
    const modifiers = syntax.modifiers ?? [];
    for (const parameter of syntax.typeParameters) {
      if (![null, undefined, 'in', 'out'].includes(parameter.variance) ||
          parameter.variance && !['interface', 'delegate'].includes(category))
        deny('INVALID_BINDING', 'variance is only legal on original interface or delegate parameters', parameter.origin);
    }
    if (modifiers.includes('abstract') && modifiers.includes('sealed') && !modifiers.includes('static'))
      deny('INVALID_BINDING', 'selected class has incompatible abstract/sealed modifiers', entry.origin);
    const ownerId = entry.declId.parent.types.at(-1), owner = ownerId ? declarations.get(key(ownerId))?.syntax : null;
    metadata.set(key(entry.declId), { declaration: entry.declId, category, origin: entry.origin,
      static: modifiers.includes('static'), abstract: category === 'interface' || modifiers.includes('abstract'),
      sealed: ['struct', 'enum', 'delegate'].includes(category) || modifiers.includes('sealed') || modifiers.includes('static'),
      accessibility: csharpVisibility(syntax, owner), constructors: [], bases: [], typeParameters: syntax.typeParameters });
  }
  const parameterConstraints = resolveSelectedParameterConstraints(enumeration, typeIndex, contextFor, metadata, counter);
  const context = entry => ({ ...contextFor(entry), owner: entry.declId, parameterConstraints });
  const containingType = entry => {
    const id = entry.declId.parent.types.at(-1);
    if (!id) return null;
    const owner = declarations.get(key(id));
    if (!owner) deny('INVALID_BINDING', 'member containing type is outside actual enumeration', entry.origin);
    return owner;
  };
  const openInstanceType = (entry, depth = 0) => {
    counter.charge('maxInvariantSteps', 'actual-open-declaring-type');
    if (depth >= K2_LIMITS.maxTermDepth) deny('INVALID_BINDING', 'declaring type nesting exhausted', entry.origin);
    const row = metadata.get(key(entry.declId));
    if (!row || !['class', 'struct', 'interface', 'enum', 'delegate'].includes(row.category))
      deny('INVALID_BINDING', 'declaring receiver lacks actual named type metadata', entry.origin);
    const arguments_ = row.typeParameters.map((parameter, ordinal) => {
      const constraints = parameterConstraints.get(key(parameter.declId));
      if (!constraints) deny('INVALID_BINDING', 'open receiver parameter lacks resolved constraints', parameter.origin);
      return { category: 'typeParameter', declaration: parameter.declId, owner: entry.declId, ordinal,
        referenceConstraint: constraints.effectiveReferenceType === true || constraints.referenceType === true };
    });
    const parent = containingType(entry);
    return { category: ['class', 'interface'].includes(row.category) ? 'reference' : row.category,
      declaration: entry.declId, arguments: arguments_, ...(parent ? { enclosingType: openInstanceType(parent, depth + 1) } : {}) };
  };
  // Enum storage eligibility cannot depend on whether its original declaration
  // appears before the field that uses it.
  for (const entry of enumeration) {
    const row = metadata.get(key(entry.declId));
    if (row?.category !== 'enum') continue;
    if ((entry.syntax.bases ?? []).length > 1) deny('INVALID_BINDING', 'enum has multiple underlying types', entry.origin);
    const underlying = entry.syntax.bases?.length ? typeIndex.resolve(entry.syntax.bases[0], context(entry)) : null;
    row.underlying = underlying?.name ?? 'int';
    if (!['sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong'].includes(row.underlying))
      deny('INVALID_BINDING', 'enum underlying type is not an actual integral CLR type', entry.origin);
  }
  for (const entry of enumeration) {
    counter.charge('maxInvariantSteps', 'selected-declaration-signature');
    const syntax = entry.syntax, owner = containingType(entry), resolve = value => typeIndex.resolve(value, context(entry));
    if (['type', 'delegate', 'catalogueType'].includes(syntax.kind)) {
      const row = metadata.get(key(entry.declId));
      if (row.category === 'enum') {
        if ((syntax.bases ?? []).length > 1) deny('INVALID_BINDING', 'enum has multiple underlying type declarations', entry.origin);
        const underlying = syntax.bases?.length ? resolve(syntax.bases[0]) : null;
        row.underlying = underlying?.name ?? 'int';
        if (!['sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong'].includes(row.underlying))
          deny('INVALID_BINDING', 'enum underlying type is not an actual integral CLR type', entry.origin);
      } else {
        let classBase = false;
        const seen = new Set();
        for (let ordinal = 0; ordinal < (syntax.bases ?? []).length; ordinal++) {
          const base = resolve(syntax.bases[ordinal]), baseKey = selectedTypeKey(base);
          const baseMetadata = metadata.get(key(base.declaration));
          if (!baseMetadata || seen.has(baseKey)) deny('INVALID_BINDING', 'base type is absent or duplicated', entry.origin);
          seen.add(baseKey);
          if (baseMetadata.category === 'class') {
            if (row.category !== 'class' || classBase || ordinal !== 0 || baseMetadata.sealed || baseMetadata.static)
              deny('INVALID_BINDING', 'selected class base is sealed, repeated, misplaced or incompatible', entry.origin);
            classBase = true;
          } else if (baseMetadata.category !== 'interface')
            deny('INVALID_BINDING', 'selected base must be a class or interface', entry.origin);
          row.bases.push(base);
        }
      }
    } else if (syntax.kind === 'enumMember') {
      const enumMetadata = owner && metadata.get(key(owner.declId));
      if (enumMetadata?.category !== 'enum') deny('INVALID_BINDING', 'enum member lacks its original enum owner', entry.origin);
      const type = { ...openInstanceType(owner), underlying: enumMetadata.underlying };
      metadata.set(key(entry.declId), { declaration: entry.declId, category: 'field', enumMember: true,
        declaringType: type, type, static: true, accessibility: 'public', constant: true,
        readonly: false, volatile: false, constantSyntax: syntax.value, origin: entry.origin });
      storage.set(key(entry.declId), { storage: 'constant', constant: true, readonly: false, volatile: false,
        type, visibility: 'public', executableInitializer: false, initializerPhase: null,
        readOrdering: 'ordinary', writeOrdering: 'ordinary', compoundAtomic: false });
    } else if (['field', 'property', 'parameter', 'catchParameter', 'iterationVariable'].includes(syntax.kind)) {
      if (!syntax.type || syntax.type.kind === 'inferredType') continue; // Body binding supplies inferred locals/iteration types.
      const type = resolve(syntax.type);
      if (syntax.kind === 'field') checkSelectedArrayInitializerShape(syntax.initializer, type, counter);
      if (type.category === 'enum') type.underlying = metadata.get(key(type.declaration))?.underlying;
      storage.set(key(entry.declId), csharpStorage(syntax, owner?.syntax ?? null, type));
      if (syntax.kind === 'property') {
        if (!owner || !Array.isArray(syntax.accessors) || !syntax.accessors.length || syntax.accessors.length > 2 ||
            new Set(syntax.accessors.map(accessor => accessor.operation)).size !== syntax.accessors.length)
          deny('INVALID_BINDING', 'property requires distinct actual accessor declarations', entry.origin);
        const propertyAccess = csharpVisibility(syntax, owner.syntax);
        const restricted = syntax.accessors.filter(accessor => accessor.modifiers.some(modifier =>
          ['public', 'private', 'protected', 'internal'].includes(modifier)));
        if (restricted.length > 1 || restricted.length && syntax.accessors.length !== 2 && !syntax.modifiers.includes('override'))
          deny('INVALID_BINDING', 'only one accessor of a get/set property may restrict accessibility', entry.origin);
        for (const accessor of restricted) {
          const access = csharpVisibility(accessor, owner.syntax);
          if (!narrowerAccessorAccess[propertyAccess]?.has(access))
            deny('INVALID_BINDING', 'accessor accessibility is not strictly narrower than its property', accessor.origin);
        }
        metadata.set(key(entry.declId), { declaration: entry.declId, category: 'property', type,
          declaringType: openInstanceType(owner), static: syntax.modifiers.includes('static'),
          accessibility: propertyAccess, origin: entry.origin,
          accessors: syntax.accessors.map(accessor => accessor.declId), attributesSyntax: syntax.attributes });
      }
    } else if (syntax.kind === 'accessor') {
      const property = declarations.get(key(entry.semanticOwner.declaration));
      const propertyMetadata = property && metadata.get(key(property.declId));
      if (!owner || property?.syntax.kind !== 'property' || propertyMetadata?.category !== 'property')
        deny('INVALID_BINDING', 'accessor lacks its original typed property', entry.origin);
      const setter = syntax.operation === 'set';
      if (!setter && syntax.operation !== 'get') deny('INVALID_BINDING', 'unknown source accessor operation', entry.origin);
      const valueSlot = enumeration.find(candidate => candidate.generated?.role === 'valueStorage' &&
        key(candidate.generated.anchor) === key(entry.declId));
      if (setter !== Boolean(valueSlot)) deny('INVALID_BINDING', 'setter formal differs from required implicit value slot', entry.origin);
      const explicitAccess = syntax.modifiers.some(modifier => ['public', 'private', 'protected', 'internal'].includes(modifier));
      const accessibility = explicitAccess ? csharpVisibility(syntax, owner.syntax) : propertyMetadata.accessibility;
      metadata.set(key(entry.declId), { declaration: entry.declId, category: 'accessor', operation: syntax.operation,
        property: property.declId, declaringType: propertyMetadata.declaringType,
        static: propertyMetadata.static, receiverType: propertyMetadata.static ? null : propertyMetadata.declaringType,
        parameters: setter ? [{ declaration: valueSlot.declId, name: 'value', type: propertyMetadata.type, direction: 'value', variadic: false,
          defaultSyntax: null, origin: valueSlot.origin }] : [],
        originalParameterTypes: setter ? [propertyMetadata.type] : [], genericArity: 0, accessibility,
        returnType: setter ? typeIndex.primitive('void', context(entry), entry.origin) : propertyMetadata.type,
        origin: entry.origin, attributesSyntax: syntax.attributes, modifiersSyntax: syntax.modifiers });
    } else if (syntax.kind === 'method' || syntax.kind === 'constructor') {
      if (!owner) deny('INVALID_BINDING', 'selected method/constructor has no containing type', entry.origin);
      if (syntax.typeParameters?.some(parameter => parameter.variance))
        deny('INVALID_BINDING', 'method type parameters cannot declare variance', entry.origin);
      const parameters = syntax.parameters.map(parameter => ({ declaration: parameter.declId, name: parameter.name.spelling,
        type: typeIndex.resolve(parameter.type, context(entry)), direction: parameter.direction,
        variadic: parameter.variadic, defaultSyntax: parameter.defaultValue, origin: parameter.origin }));
      checkOriginalParameterShape(parameters, syntax.parameters, entry.origin);
      const static_ = syntax.modifiers.includes('static');
      if (syntax.kind === 'constructor' && static_ && (parameters.length || syntax.initializer))
        deny('INVALID_BINDING', 'static constructor has parameters or a constructor initializer', entry.origin);
      const row = { declaration: entry.declId, category: syntax.kind, parameters, static: static_,
        accessibility: csharpVisibility(syntax, owner.syntax), origin: entry.origin,
        declaringType: openInstanceType(owner), receiverType: static_ ? null : openInstanceType(owner),
        attributesSyntax: syntax.attributes, modifiersSyntax: syntax.modifiers,
        returnType: syntax.kind === 'method' ? resolve(syntax.returnType) : null,
        genericArity: syntax.typeParameters?.length ?? 0, typeParameters: syntax.typeParameters ?? [],
        originalParameterTypes: parameters.map(parameter => parameter.type) };
      metadata.set(key(entry.declId), row);
      if (syntax.kind === 'constructor') metadata.get(key(owner.declId)).constructors.push(row);
    } else if (entry.generated?.role === 'instanceConstructor') {
      const row = { declaration: entry.declId, category: 'constructor', parameters: [], static: false,
        accessibility: syntax.visibility, origin: entry.origin };
      const anchor = declarations.get(key(entry.generated.anchor));
      if (!anchor) deny('INVALID_BINDING', 'implicit constructor anchor declaration missing', entry.origin);
      row.declaringType = openInstanceType(anchor); row.receiverType = row.declaringType;
      row.originalParameterTypes = []; row.genericArity = 0; row.returnType = null;
      metadata.set(key(entry.declId), row);
      const type = metadata.get(key(entry.generated.anchor));
      if (!type) deny('INVALID_BINDING', 'implicit constructor anchor lacks actual type metadata', entry.origin);
      type.constructors.push(row);
    }
  }
  // Implicit slots precede their explicit children in original declaration
  // enumeration. Resolve them after all explicit signatures exist rather than
  // inferring a type from whichever annotation a proof producer supplies.
  for (const entry of enumeration) {
    if (!entry.generated) continue;
    counter.charge('maxInvariantSteps', 'selected-implicit-slot-signature');
    const anchor = declarations.get(key(entry.generated.anchor));
    const anchorMetadata = anchor && metadata.get(key(anchor.declId));
    if (!anchor) deny('INVALID_BINDING', 'implicit slot has no original anchor', entry.origin);
    if (entry.generated.role === 'valueStorage') {
      if (anchorMetadata?.category !== 'accessor' || anchorMetadata.operation !== 'set' || anchorMetadata.parameters.length !== 1 ||
          key(anchorMetadata.parameters[0].declaration) !== key(entry.declId))
        deny('INVALID_BINDING', 'implicit value storage lacks its original setter formal', entry.origin);
      storage.set(key(entry.declId), { storage: 'formal', constant: false, readonly: false, volatile: false,
        type: anchorMetadata.parameters[0].type, visibility: null, executableInitializer: false, initializerPhase: null,
        readOrdering: 'ordinary', writeOrdering: 'ordinary', compoundAtomic: false });
    } else if (entry.generated.role === 'backingStorage') {
      if (anchorMetadata?.category !== 'property') deny('INVALID_BINDING', 'backing storage anchor is not an original property', entry.origin);
      const propertyStorage = storage.get(key(anchor.declId));
      if (!propertyStorage) deny('INVALID_BINDING', 'backing storage lacks resolved property storage', entry.origin);
      storage.set(key(entry.declId), { ...propertyStorage, visibility: 'private',
        readonly: !anchor.syntax.accessors.some(accessor => accessor.operation === 'set') });
      metadata.set(key(entry.declId), { declaration: entry.declId, category: 'field',
        property: anchor.declId, type: anchorMetadata.type, static: anchorMetadata.static,
        declaringType: anchorMetadata.declaringType, accessibility: 'private', origin: entry.origin });
    } else if (entry.generated.role === 'typeInitializer') {
      if (!anchorMetadata || !['class', 'struct'].includes(anchorMetadata.category))
        deny('INVALID_BINDING', 'implicit type initializer lacks its actual class or struct', entry.origin);
      metadata.set(key(entry.declId), { declaration: entry.declId, category: 'constructor', static: true,
        parameters: [], originalParameterTypes: [], genericArity: 0, returnType: null, receiverType: null,
        declaringType: openInstanceType(anchor), accessibility: 'private', origin: entry.origin,
        initializationTiming: entry.syntax.timing });
    } else if (entry.generated.role === 'delegateInvoke') {
      if (anchorMetadata?.category !== 'delegate') deny('INVALID_BINDING', 'implicit invoke lacks its original delegate', entry.origin);
      const parameters = anchor.syntax.parameters.map(parameter => ({ declaration: parameter.declId, name: parameter.name.spelling,
        type: typeIndex.resolve(parameter.type, context(anchor)), direction: parameter.direction,
        variadic: parameter.variadic, defaultSyntax: parameter.defaultValue, origin: parameter.origin }));
      checkOriginalParameterShape(parameters, anchor.syntax.parameters, entry.origin);
      const declaringType = openInstanceType(anchor);
      metadata.set(key(entry.declId), { declaration: entry.declId, category: 'method', static: false,
        parameters, originalParameterTypes: parameters.map(parameter => parameter.type), genericArity: 0,
        returnType: typeIndex.resolve(anchor.syntax.returnType, context(anchor)), receiverType: declaringType,
        declaringType, accessibility: 'public', origin: entry.origin });
    }
  }
  // Implicit bases are language productions anchored to actual declarations.
  // Their identity comes from the fixed symbolic catalogue, never a guessed
  // System name, reflected assembly or producer-supplied graph edge.
  for (const entry of enumeration) {
    const row = metadata.get(key(entry.declId));
    if (!row || !['class', 'struct', 'enum', 'delegate'].includes(row.category)) continue;
    counter.charge('maxInvariantSteps', 'selected-implicit-base-production');
    const actualContext = context(entry);
    let implicit = null;
    if (row.category === 'class') {
      const object = typeIndex.primitive('object', actualContext, entry.origin);
      if (key(object.declaration) !== key(entry.declId) &&
          !row.bases.some(base => metadata.get(key(base.declaration))?.category === 'class')) implicit = object;
    } else {
      const root = row.category === 'enum' ? 'Enum' : row.category === 'delegate' ? 'MulticastDelegate' : 'ValueType';
      implicit = typeIndex.catalogueType(['System'], root, actualContext, entry.origin);
    }
    if (implicit) {
      if (!metadata.has(key(implicit.declaration))) deny('INVALID_BINDING', 'implicit base catalogue declaration metadata is missing', entry.origin);
      row.bases.unshift(implicit);
      row.implicitBaseProduction = { sourceOccurrence: entry.origin, category: row.category, base: implicit };
    }
  }  checkOriginalMemberSignatures(enumeration, metadata, counter);
  checkSelectedBaseDeclarationCycles(metadata, counter);
  for (const entry of enumeration) if (entry.syntax.kind === 'type')
    initializerPlans.set(key(entry.declId), checkCsharpInitializerSlots(entry, enumeration, storage));
  return { declarations, declarationMetadata: metadata, parameterConstraints, storageMetadata: storage,
    initializerPlans, typeGraph, completeTypeGraph: false, completeBodyBinding: false };
}

export function checkSelectedBaseDeclarationCycles(metadata, counter) {
  const completed = new Set();
  for (const [root, row] of metadata) {
    if (!Array.isArray(row.bases) || completed.has(root)) continue;
    const active = new Set(), pending = [{ key: root, leaving: false }];
    while (pending.length) {
      counter.charge('maxInvariantSteps', 'selected-base-declaration-cycle');
      const frame = pending.pop();
      if (frame.leaving) { active.delete(frame.key); completed.add(frame.key); continue; }
      if (active.has(frame.key)) deny('INVALID_BINDING', 'selected base declarations contain an inheritance cycle');
      if (completed.has(frame.key)) continue;
      const current = metadata.get(frame.key);
      if (!current || !Array.isArray(current.bases)) deny('INVALID_BINDING', 'selected base declaration metadata is absent');
      active.add(frame.key); pending.push({ key: frame.key, leaving: true });
      for (const base of current.bases) pending.push({ key: key(base.declaration), leaving: false });
    }
  }
}

export function selectedDeclaringSubstitutions(type, declarationMetadata, counter) {
    const substitutions = new Map(); let current = type, depth = 0;
    while (current) {
      counter.charge('maxInvariantSteps', 'selected-enclosing-base-substitution');
      if (depth++ >= K2_LIMITS.maxTermDepth) deny('INVALID_BINDING', 'nested base substitution depth exhausted');
      const row = declarationMetadata.get(key(current.declaration));
      if (!row || key(row.declaration) !== key(current.declaration) || !Array.isArray(row.typeParameters) ||
          !Array.isArray(row.declaration.parent?.types))
        deny('INVALID_BINDING', 'nested base substitution lacks original declaration metadata');
      for (const [parameter, actual] of genericSubstitution(row.typeParameters, current.arguments ?? [], counter)) {
        if (substitutions.has(parameter)) deny('INVALID_BINDING', 'nested declaration repeats a generic parameter identity');
        substitutions.set(parameter, actual);
      }
      const enclosingDeclaration = row.declaration.parent.types.at(-1);
      if (Boolean(enclosingDeclaration) !== Boolean(current.enclosingType) ||
          enclosingDeclaration && key(enclosingDeclaration) !== key(current.enclosingType.declaration))
        deny('INVALID_BINDING', 'constructed enclosing type differs from the original declaring chain');
      current = current.enclosingType ?? null;
    }
    return substitutions;
}

export function instantiateSelectedBaseGraph(actualTypes, declarationMetadata, counter) {
  if (!Array.isArray(actualTypes) || actualTypes.length > K2_LIMITS.maxOccurrences)
    deny('INVALID_BINDING', 'base graph actual type roster exceeds its finite extent');
  checkSelectedBaseDeclarationCycles(declarationMetadata, counter);
  const graph = new Map(), pending = [...actualTypes];
  while (pending.length) {
    counter.charge('maxInvariantSteps', 'selected-base-instantiation');
    const type = pending.pop(), typeKey = selectedTypeKey(type);
    if (graph.has(typeKey)) continue;
    if (type.category === 'null' || type.category === 'array' || type.category === 'nullable' || type.category === 'typeParameter') {
      // Array roots, nullable boxing and parameter effective bases are separate
      // selected CLR productions, not invented named-type inheritance rows.
      graph.set(typeKey, []); continue;
    }
    const row = declarationMetadata.get(key(type.declaration));
    if (!row || !Array.isArray(row.bases) || !Array.isArray(row.typeParameters))
      deny('INVALID_BINDING', 'base graph requires original resolved declaration metadata');
    const substitutions = selectedDeclaringSubstitutions(type, declarationMetadata, counter);
    const bases = row.bases.map(base => substituteSelectedType(base, substitutions, counter));
    graph.set(typeKey, bases);
    for (const base of bases) pending.push(base);
  }
  return graph;
}

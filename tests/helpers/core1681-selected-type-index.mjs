import { deny } from './core1681-source-input.mjs';
import { canonicalData, K2_LIMITS } from './core1681-proof-terms.mjs';
import { genericSubstitution } from './core1681-selected-types.mjs';

const aliases = new Map(Object.entries({ bool: 'Boolean', byte: 'Byte', sbyte: 'SByte', short: 'Int16', ushort: 'UInt16',
  int: 'Int32', uint: 'UInt32', long: 'Int64', ulong: 'UInt64', char: 'Char', float: 'Single', double: 'Double',
  decimal: 'Decimal', object: 'Object', string: 'String', void: 'Void' }));
const primitiveNames = new Map([...aliases].map(([alias, name]) => [name, alias]));
const declarationKey = canonicalData;
const pathKey = (unit, namespace, parents, name, arity) => canonicalData([unit, namespace, parents, name, arity]);

// The index contains source declarations and separately enumerated fixed symbolic
// catalogue declarations. It performs no runtime assembly discovery or admission.
export class SelectedTypeIndex {
  constructor(sourceEnumeration, catalogueEnumeration, counter, originalCompilationGroups, originalUnits) {
    if (!(originalCompilationGroups instanceof Map))
      deny('INVALID_BINDING', 'type index requires original compilation-unit grouping');
    this.counter = counter; this.types = new Map(); this.byDeclaration = new Map(); this.resolveDepth = 0;
    this.compilationGroups = new Map(originalCompilationGroups);
    this.catalogueUnits = new Set(); this.sourceUnits = new Set();
    this.originalNamespaces = [];
    if (!(originalUnits instanceof Map)) deny('INVALID_BINDING', 'type index requires complete original unit roots');
    if (this.compilationGroups.size !== originalUnits.size ||
        [...this.compilationGroups.keys()].some(unit => !originalUnits.has(unit)))
      deny('INVALID_BINDING', 'compilation grouping and original unit inventory differ');
    for (const [unit, input] of originalUnits) {
      counter.charge('maxInvariantSteps', 'original-compilation-unit-root');
      if (typeof unit !== 'string' || !unit.length || !['source', 'catalogue'].includes(input?.role) ||
          input.root?.kind !== 'unit' || !input.root.origin || !Array.isArray(input.root.declarations) ||
          typeof this.compilationGroups.get(unit) !== 'string' || !this.compilationGroups.get(unit).length)
        deny('INVALID_BINDING', 'compilation unit root lacks its original role/root/group');
      (input.role === 'source' ? this.sourceUnits : this.catalogueUnits).add(unit);
      const collect = (node, path, depth) => {
        if (depth >= K2_LIMITS.maxTermDepth) deny('INVALID_BINDING', 'original namespace depth exhausted', node.origin);
        this.originalNamespaces.push({ unit, path, origin: node.origin });
        for (const declaration of node.declarations) {
          counter.charge('maxInvariantSteps', 'original-compilation-namespace');
          if (declaration.kind !== 'namespace') continue;
          if (!Array.isArray(declaration.path) || !declaration.path.length || !declaration.origin ||
              declaration.path.some(segment => typeof segment.spelling !== 'string' || !segment.origin))
            deny('INVALID_BINDING', 'namespace root lacks original path occurrences', declaration.origin);
          collect(declaration, [...path, ...declaration.path.map(segment => segment.spelling)], depth + 1);
        }
      };
      collect(input.root, [], 0);
    }
    for (const entry of sourceEnumeration) this.insert(entry, false);
    for (const entry of catalogueEnumeration) this.insert(entry, true);
    for (const unit of this.sourceUnits) if (this.catalogueUnits.has(unit))
      deny('INVALID_BINDING', 'one original unit cannot be both source and imported catalogue');
  }
  insert(entry, imported) {
    if (!entry.declId || !entry.syntax || !entry.origin) deny('INVALID_BINDING', 'type index needs actual enumerated declaration');
    const group = this.compilationGroups.get(entry.declId.unit);
    if (typeof group !== 'string' || !group.length)
      deny('INVALID_BINDING', 'enumerated unit lacks original compilation identity', entry.origin);
    if (!(imported ? this.catalogueUnits : this.sourceUnits).has(entry.declId.unit))
      deny('INVALID_BINDING', 'declaration unit role differs from complete original unit inventory', entry.origin);
    const key = declarationKey(entry.declId);
    if (this.byDeclaration.has(key)) deny('INVALID_BINDING', 'duplicate declaration identity in type index', entry.origin);
    this.byDeclaration.set(key, entry);
    (imported ? this.catalogueUnits : this.sourceUnits).add(entry.declId.unit);
    if (!['type', 'delegate', 'catalogueType'].includes(entry.syntax.kind)) return;
    const syntax = entry.syntax, name = typeof syntax.name === 'string' ? syntax.name : syntax.name.spelling;
    const arity = syntax.typeParameters.length;
    const indexKey = pathKey(entry.declId.unit, entry.declId.parent.namespace, entry.declId.parent.types, name, arity);
    if (this.types.has(indexKey)) deny('INVALID_BINDING', 'duplicate selected type name and arity', entry.origin);
    this.types.set(indexKey, entry);
  }
  visibleUnits(context, importedOnly = false) {
    const group = this.compilationGroups.get(context.unit);
    if (typeof group !== 'string' || !group.length ||
        !this.sourceUnits.has(context.unit) && !this.catalogueUnits.has(context.unit))
      deny('INVALID_BINDING', 'type lookup context lacks original compilation identity');
    const units = new Set(this.catalogueUnits);
    if (!importedOnly) for (const unit of this.sourceUnits) {
      this.counter.charge('maxInvariantSteps', 'selected-compilation-unit');
      if (this.compilationGroups.get(unit) === group) units.add(unit);
    }
    return units;
  }
  lookup(namespace, parents, name, arity, context, importedOnly = false) {
    const units = this.visibleUnits(context, importedOnly);
    const results = [];
    for (const unit of units) {
      this.counter.charge('maxInvariantSteps', 'selected-type-lookup');
      const candidate = this.types.get(pathKey(unit, namespace, parents, name, arity));
      if (candidate) results.push(candidate);
    }
    return results;
  }
  unique(candidates, origin) {
    const values = [...new Map(candidates.map(entry => [declarationKey(entry.declId), entry])).values()];
    if (values.length !== 1) deny('INVALID_BINDING', values.length ? 'ambiguous selected type binding' : 'unresolved selected type binding', origin);
    return values[0];
  }
  catalogueType(namespace, name, context, origin) {
    if (!Array.isArray(namespace) || namespace.some(segment => typeof segment !== 'string') || typeof name !== 'string' || !origin)
      deny('INVALID_BINDING', 'implicit CLR production requires its fixed catalogue name and original anchor', origin);
    return this.construct(this.unique(this.lookup(namespace, [], name, 0, context, true), origin), [], context);
  }  primitive(name, context, origin) {
    if (!aliases.has(name)) deny('INVALID_BINDING', 'unknown selected intrinsic CLR type', origin);
    return this.construct(this.unique(this.lookup(['System'], [], aliases.get(name), 0, context, true), origin), [], context);
  }
  parameter(name, context) {
    let owner = context.owner;
    while (owner) {
      this.counter.charge('maxInvariantSteps', 'selected-type-parameter');
      const entry = this.byDeclaration.get(declarationKey(owner));
      if (!entry) deny('INVALID_BINDING', 'type parameter owner is absent from actual enumeration');
      const parameter = entry.syntax.typeParameters?.find(value => value.name.spelling === name);
      if (parameter) {
        const constraints = context.parameterConstraints.get(declarationKey(parameter.declId));
        if (!constraints) deny('INVALID_BINDING', 'type parameter requires independently resolved constraint metadata', parameter.origin);
        return { category: 'typeParameter', declaration: parameter.declId, owner,
          ordinal: entry.syntax.typeParameters.indexOf(parameter), referenceConstraint: constraints.effectiveReferenceType === true || constraints.referenceType === true };
      }
      owner = entry.semanticOwner.declaration ?? null;
    }
    return null;
  }
  resolve(syntax, context) {
    if (this.resolveDepth >= K2_LIMITS.maxTermDepth) deny('INVALID_BINDING', 'selected type resolution depth exhausted', syntax.origin);
    this.resolveDepth++;
    try { return this.resolveWithinDepth(syntax, context); }
    finally { this.resolveDepth--; }
  }
  resolveNamespaceOrType(syntax, context) {
    if (syntax.kind !== 'namedType' || this.resolveDepth >= K2_LIMITS.maxTermDepth)
      deny('INVALID_BINDING', 'namespace-or-type requires bounded original named syntax', syntax.origin);
    this.resolveDepth++;
    try { return this.resolveWithinDepth(syntax, context, true); }
    finally { this.resolveDepth--; }
  }
  resolveWithinDepth(syntax, context, namespaceOrType = false) {
    this.counter.charge('maxInvariantSteps', 'selected-type-resolve');
    if (syntax.kind === 'arrayType') {
      const element = this.resolve(syntax.element, context);
      if (element.name === 'void') deny('INVALID_BINDING', 'array element cannot be void', syntax.origin);
      return { category: 'array', element, rank: syntax.rank };
    }
    if (syntax.kind === 'nullableType') {
      const element = this.resolve(syntax.element, context);
      if (!['primitive', 'enum', 'struct', 'typeParameter'].includes(element.category) || element.name === 'void' ||
          element.category === 'typeParameter' && context.parameterConstraints.get(declarationKey(element.declaration))?.valueType !== true)
        deny('INVALID_BINDING', 'nullable requires a resolved nonnullable value type', syntax.origin);
      return { category: 'nullable', element };
    }
    if (syntax.kind !== 'namedType') deny('INVALID_BINDING', 'selected type syntax required', syntax.origin);
    const segments = syntax.segments, first = segments[0], spelling = first.name.spelling;
    if (segments.length === 1 && !first.arguments.length) {
      if (aliases.has(spelling) && !first.name.escapedIdentifier) {
        const type = this.primitive(spelling, context, syntax.origin);
        return namespaceOrType ? { kind: 'type', type } : type;
      }
      const parameter = this.parameter(spelling, context); if (parameter) return namespaceOrType ? { kind: 'type', type: parameter } : parameter;
    }
    const tiers = context.usingTiers;
    if (!Array.isArray(tiers) || !(context.namespacePaths instanceof Set))
      deny('INVALID_BINDING', 'type lookup requires original ordered namespace/import tiers', syntax.origin);
    const namespaceExists = path => context.namespacePaths.has(canonicalData(path));
    let receiver = null;
    // First search the actual enclosing type declaration spaces. Inherited
    // nested members still require the separately resolved accessibility graph.
    for (let length = context.typeParents.length; length > 0; length--) {
      const found = this.lookup(context.namespace, context.typeParents.slice(0, length), spelling, first.arguments.length, context);
      if (found.length) {
        const enclosingType = this.openEnclosingType(context.typeParents[length - 1], context);
        receiver = { kind: 'type', type: { ...this.construct(this.unique(found, first.name.origin), first.arguments, context), enclosingType } };
        break;
      }
    }
    for (let length = context.namespace.length; receiver === null && length >= 0; length--) {
      const namespace = context.namespace.slice(0, length);
      const tier = tiers.find(value => canonicalData(value.namespace) === canonicalData(namespace));
      const alias = first.arguments.length === 0 ? tier?.usingAliases.get(spelling) : null;
      const nestedNamespace = [...namespace, spelling];
      const found = this.lookup(namespace, [], spelling, first.arguments.length, context);
      if (first.arguments.length === 0 && namespaceExists(nestedNamespace)) {
        if (alias || found.length) deny('INVALID_BINDING', 'namespace/type/alias declaration collision', first.name.origin);
        receiver = { kind: 'namespace', path: nestedNamespace };
      } else if (found.length) {
        if (alias) deny('INVALID_BINDING', 'type/alias declaration collision', first.name.origin);
        receiver = { kind: 'type', type: this.construct(this.unique(found, first.name.origin), first.arguments, context) };
      } else if (alias) {
        receiver = alias.type ? { kind: 'type', type: alias.type } : { kind: 'namespace', path: alias.path };
      } else if (tier) {
        const imported = [];
        for (const path of tier.usingNamespaces) imported.push(...this.lookup(path, [], spelling, first.arguments.length, context));
        if (imported.length) receiver = { kind: 'type', type: this.construct(this.unique(imported, first.name.origin), first.arguments, context) };
      }
    }
    if (receiver === null) deny('INVALID_BINDING', 'unresolved leading namespace/type component', first.name.origin);
    for (const segment of segments.slice(1)) {
      this.counter.charge('maxInvariantSteps', 'qualified-type-trailing-component');
      if (receiver.kind === 'type') {
        receiver = { kind: 'type', type: this.resolveNested(receiver.type, [segment], context, segment.name.origin) };
      } else {
        const path = [...receiver.path, segment.name.spelling];
        if (!segment.arguments.length && namespaceExists(path)) receiver = { kind: 'namespace', path };
        else {
          const found = this.lookup(receiver.path, [], segment.name.spelling, segment.arguments.length, context);
          receiver = { kind: 'type', type: this.construct(this.unique(found, segment.name.origin), segment.arguments, context) };
        }
      }
    }
    if (namespaceOrType) return receiver;
    if (receiver.kind !== 'type') deny('INVALID_BINDING', 'namespace is not a type', syntax.origin);
    return receiver.type;
  }
  construct(entry, arguments_, context) {
    const syntax = entry.syntax, category = syntax.category ?? syntax.typeCategory;
    if (arguments_.length !== syntax.typeParameters.length)
      deny('INVALID_BINDING', 'selected generic construction has incorrect actual arity', entry.origin);
    const argumentsResolved = arguments_.map(argument => this.resolve(argument, context));
    for (const argument of argumentsResolved) {
      if (argument.category === 'null' || argument.name === 'void')
        deny('INVALID_BINDING', 'selected generic argument is not a permitted CLR type', entry.origin);
    }
    // Actual parameter identities and simultaneous substitution are established
    // here; constraint satisfaction remains a separate bound declaration step.
    genericSubstitution(syntax.typeParameters, argumentsResolved, this.counter);
    const spelling = typeof syntax.name === 'string' ? syntax.name : syntax.name.spelling;
    const primitive = this.catalogueUnits.has(entry.declId.unit) && entry.declId.parent.namespace.length === 1 &&
      entry.declId.parent.namespace[0] === 'System' && !entry.declId.parent.types.length ? primitiveNames.get(spelling) : null;
    if (primitive) return { category: ['object', 'string'].includes(primitive) ? 'reference' : 'primitive', declaration: entry.declId, name: primitive };
    return { category: syntax.kind === 'delegate' ? 'delegate' : ['class', 'interface'].includes(category) ? 'reference' : category,
      declaration: entry.declId, arguments: argumentsResolved };
  }
  openEnclosingType(declaration, context, depth = 0) {
    this.counter.charge('maxInvariantSteps', 'original-open-enclosing-type');
    if (depth >= K2_LIMITS.maxTermDepth) deny('INVALID_BINDING', 'open enclosing type nesting exhausted');
    const entry = this.byDeclaration.get(declarationKey(declaration));
    if (!entry || !['type', 'delegate', 'catalogueType'].includes(entry.syntax.kind) ||
        !context.typeParents.some(parent => declarationKey(parent) === declarationKey(declaration)))
      deny('INVALID_BINDING', 'open enclosing type is outside the original lexical type chain');
    const category = entry.syntax.category ?? entry.syntax.typeCategory;
    const arguments_ = entry.syntax.typeParameters.map((parameter, ordinal) => {
      const constraints = context.parameterConstraints.get(declarationKey(parameter.declId));
      if (!constraints) deny('INVALID_BINDING', 'open enclosing parameter lacks original resolved constraints', parameter.origin);
      return { category: 'typeParameter', declaration: parameter.declId, owner: entry.declId, ordinal,
        referenceConstraint: constraints.effectiveReferenceType === true || constraints.referenceType === true };
    });
    const parent = entry.declId.parent.types.at(-1);
    return { category: entry.syntax.kind === 'delegate' ? 'delegate' : ['class', 'interface'].includes(category) ? 'reference' : category,
      declaration: entry.declId, arguments: arguments_,
      ...(parent ? { enclosingType: this.openEnclosingType(parent, context, depth + 1) } : {}) };
  }
  resolveNested(type, segments, context, origin) {
    let current = type;
    for (const segment of segments) {
      const entry = this.byDeclaration.get(declarationKey(current.declaration));
      if (!entry) deny('INVALID_BINDING', 'nested type receiver has no actual declaration', origin);
      const found = this.lookup(entry.declId.parent.namespace, [...entry.declId.parent.types, entry.declId],
        segment.name.spelling, segment.arguments.length, { ...context, unit: entry.declId.unit });
      current = { ...this.construct(this.unique(found, origin), segment.arguments, context), enclosingType: current };
    }
    return current;
  }
}

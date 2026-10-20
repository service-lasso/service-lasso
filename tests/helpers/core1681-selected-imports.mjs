import { deny } from './core1681-source-input.mjs';
import { canonicalData, K2_LIMITS } from './core1681-proof-terms.mjs';

const key = canonicalData;
const fail = (message, origin) => deny('INVALID_BINDING', message, origin);

// Import contexts are derived from original unit/namespace syntax, not supplied
// names or runtime assembly discovery. Type construction remains in the fixed
// symbolic type index and its independently checked constraint phase.
export class SelectedCSharpImports {
  constructor(root, enumeration, typeIndex, baseContext, counter) {
    if (root?.kind !== 'unit' || !Array.isArray(root.declarations))
      fail('imports require the original complete C# unit', root?.origin);
    if (!Array.isArray(baseContext.usingNamespaces) || !(baseContext.usingAliases instanceof Map))
      fail('import context requires separately bound enclosing directives', root.origin);
    this.contexts = new Map(); this.bindings = []; this.counter = counter;
    this.enumeration = enumeration; this.typeIndex = typeIndex;
    this.namespacePaths = new Set([key([])]);
    const addNamespace = path => {
      for (let length = 0; length <= path.length; length++) this.namespacePaths.add(key(path.slice(0, length)));
    };
    const visibleUnits = typeIndex.visibleUnits(baseContext);
    for (const namespace of typeIndex.originalNamespaces) {
      counter.charge('maxInvariantSteps', 'import-original-namespace-unit');
      if (visibleUnits.has(namespace.unit)) addNamespace(namespace.path);
    }
    for (const entry of typeIndex.byDeclaration.values()) {
      counter.charge('maxInvariantSteps', 'import-namespace-catalogue');
      if (visibleUnits.has(entry.declId.unit))
        addNamespace(entry.declId.parent.namespace);
    }
    const collect = (node, namespace, depth) => {
      if (depth >= K2_LIMITS.maxTermDepth) fail('namespace import depth exhausted', node.origin);
      for (const declaration of node.declarations) {
        counter.charge('maxInvariantSteps', 'original-namespace-path');
        if (declaration.kind !== 'namespace') continue;
        const path = [...namespace, ...declaration.path.map(segment => segment.spelling)];
        addNamespace(path); collect(declaration, path, depth + 1);
      }
    };
    collect(root, [], 0);
    this.build(root, [], baseContext, 0);
  }
  build(node, namespace, inherited, depth) {
    if (depth >= K2_LIMITS.maxTermDepth) fail('import scope depth exhausted', node.origin);
    const scope = this.enumeration.nodeScopes.get(node);
    if (!Number.isSafeInteger(scope) || this.contexts.has(scope)) fail('import scope lacks unique actual enumeration', node.origin);
    const context = { ...inherited, namespace, typeParents: [], namespacePaths: this.namespacePaths,
      usingNamespaces: [], usingAliases: new Map(), usingTiers: [] };
    // Using directives in a namespace body do not see peer using directives.
    // Resolve every target against the enclosing context before publishing the
    // local imports, preserving original occurrences in the binding records.
    const lookupContext = { ...inherited, namespace, typeParents: [], namespacePaths: this.namespacePaths,
      usingAliases: new Map(inherited.usingAliases),
      usingTiers: [{ namespace: [...namespace], scope, origin: structuredClone(node.origin),
        usingNamespaces: [], usingAliases: new Map() }, ...(inherited.usingTiers ?? [])] };
    const localAliases = new Set(), localNamespaces = new Set();
    for (const directive of node.declarations) {
      if (directive.kind !== 'usingDirective') continue;
      this.counter.charge('maxInvariantSteps', 'original-using-directive');
      if (!directive.origin || !Array.isArray(directive.path) || !directive.path.length)
        fail('using target lacks its original syntax', directive.origin);
      const path = directive.path.map(segment => {
        if (typeof segment.spelling !== 'string' || !segment.origin) fail('using component lacks original identifier', directive.origin);
        return segment.spelling;
      });
      const resolved = this.typeIndex.resolveNamespaceOrType({ kind: 'namedType', origin: directive.origin,
        segments: directive.path.map(component => ({ name: component, arguments: [] })) }, lookupContext);
      if (directive.alias === null) {
        if (resolved.kind !== 'namespace') fail('using namespace target is not a genuine selected namespace', directive.origin);
        const selected = resolved.path, identity = key(selected);
        if (!localNamespaces.has(identity)) context.usingNamespaces.push(selected);
        localNamespaces.add(identity);
        this.bindings.push({ kind: 'usingNamespace', scope, occurrence: structuredClone(directive.origin), namespace: selected });
      } else {
        const name = directive.alias.spelling;
        if (typeof name !== 'string' || !directive.alias.origin || localAliases.has(name))
          fail('duplicate or unbound using alias', directive.origin);
        localAliases.add(name);
        const target = resolved.kind === 'namespace' ? { path: resolved.path } : { type: resolved.type };
        context.usingAliases.set(name, target);
        this.bindings.push({ kind: 'usingAlias', scope, occurrence: structuredClone(directive.origin),
          aliasOccurrence: structuredClone(directive.alias.origin), name, target: structuredClone(target) });
      }
    }
    const ownTier = { namespace: [...namespace], scope, origin: structuredClone(node.origin),
      usingNamespaces: context.usingNamespaces, usingAliases: context.usingAliases };
    context.usingTiers = [ownTier, ...(inherited.usingTiers ?? [])];
    this.contexts.set(scope, context);
    for (const declaration of node.declarations) {
      if (declaration.kind === 'namespace') this.build(declaration,
        [...namespace, ...declaration.path.map(component => component.spelling)], context, depth + 1);
    }
  }
  forOccurrence(node, declarationContext) {
    if (!node?.origin) fail('import lookup requires original occurrence');
    let scope = this.enumeration.nodeScopes.get(node), traversed = 0;
    while (scope !== null) {
      this.counter.charge('maxInvariantSteps', 'original-import-scope-parent');
      if (!Number.isSafeInteger(scope) || ++traversed > K2_LIMITS.maxTermDepth)
        fail('import lookup lacks a bounded original scope', node.origin);
      const imports = this.contexts.get(scope);
      if (imports) return { ...declarationContext, namespace: [...imports.namespace],
        namespacePaths: this.namespacePaths, usingTiers: imports.usingTiers.map(tier => ({ ...tier,
          namespace: [...tier.namespace], usingNamespaces: tier.usingNamespaces.map(path => [...path]),
          usingAliases: new Map(tier.usingAliases) })),
        usingNamespaces: imports.usingNamespaces.map(path => [...path]), usingAliases: new Map(imports.usingAliases) };
      scope = this.enumeration.scopes[scope]?.parent;
    }
    fail('original occurrence has no enclosing unit import context', node.origin);
  }
}

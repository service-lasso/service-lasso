import { deny } from './core1681-source-input.mjs';
import { canonicalData, K2_LIMITS } from './core1681-proof-terms.mjs';

const explicitKinds = new Set(['type', 'delegate', 'constructor', 'method', 'property', 'accessor', 'field',
  'parameter', 'typeParameter', 'local', 'iterationVariable', 'catchParameter', 'enumMember', 'lambda', 'lambdaParameter',
  'psFunction', 'psParameter', 'psTypedVariable', 'psIterationVariable', 'cAggregate', 'cEnumMember', 'cParameter',
  'cFunction', 'cTypedef', 'cField', 'cStorage', 'cLabel', 'jsBinding', 'jsFunction', 'jsFunctionExpression', 'jsArrow',
  'jsMethod', 'jsImportBinding', 'jsExportBinding', 'jsDefaultExport']);
const slotOrder = ['instanceConstructor', 'typeInitializer', 'backingStorage', 'getter', 'setter',
  'delegateInvoke', 'valueStorage', 'temporaryStorage'];
const functionKinds = new Set(['constructor', 'method', 'accessor', 'lambda', 'psFunction', 'cFunction',
  'jsFunction', 'jsFunctionExpression', 'jsArrow', 'jsMethod']);

function lexicalChildren(node) {
  const children = [], seen = new Set();
  for (const [field, value] of Object.entries(node)) {
    if (['origin', 'declId', 'parent', 'semanticOwner', 'owner', 'metadata',
      'sourceType', 'parameterType', 'typedefOriginal', 'typedefBinding', 'bindingOriginal',
      'labelGraph', 'targetOriginal', 'tagOriginal', 'parameterScope', 'definitionCompletenessOriginal',
      'conditionalOriginal', 'macroSaveOriginal', 'macroSaveStackOriginal',
      'sourcePositionOriginal', 'sourceLines', 'directiveOriginal', 'sourceLineOriginal', 'mappingOriginal', 'filenameTokenOriginal'].includes(field)) continue;
    const append = item => {
      if (item && typeof item === 'object' && item.kind && item.origin && !seen.has(item)) { seen.add(item); children.push(item); }
      else if (Array.isArray(item)) item.forEach(append);
      else if (item && typeof item === 'object' && !item.kind) Object.values(item).forEach(append);
    };
    append(value);
  }
  // Sorting is ordinal on original token position. Equal anchors preserve the
  // grammar's explicit child order; no locale, digest or supplied ID orders it.
  return children.map((child, ordinal) => ({ child, ordinal })).sort((a, b) =>
    a.child.origin.byte[0] - b.child.origin.byte[0] || a.ordinal - b.ordinal).map(item => item.child);
}

function directMembers(type) {
  return type.members.flatMap(member => member.kind === 'fieldGroup' ? member.fields : [member]);
}

// These are language-required declaration roles. Their resolved metadata and
// initialization/capture/finally transfers remain separately checked by binding
// and lowering; a slot record never grants a primitive effect or purity fact.
function requiredSlots(node, language, enclosingType) {
  const slots = [], add = (role, ordinal, details) => slots.push({ role, ordinal, details });
  if (language === 'csharp') {
    if (node.kind === 'type') {
      const members = directMembers(node), staticType = node.modifiers.includes('static');
      if (node.category === 'class' && !staticType && !members.some(member => member.kind === 'constructor' && !member.modifiers.includes('static')))
        add('instanceConstructor', 0, { category: 'constructor', static: false, visibility: node.modifiers.includes('abstract') ? 'protected' : 'public', baseInitializer: 'defaultBase', instanceInitializers: members.filter(member => ['field', 'property'].includes(member.kind) && !member.modifiers.includes('static') && !member.modifiers.includes('const') && member.initializer).map(member => member.initializer.origin) });
      const staticInitializers = members.filter(member => ['field', 'property'].includes(member.kind) && member.modifiers.includes('static') && !member.modifiers.includes('const') && member.initializer);
      if (staticInitializers.length && !members.some(member => member.kind === 'constructor' && member.modifiers.includes('static')))
        add('typeInitializer', 0, { category: 'constructor', static: true, timing: 'beforefieldinit', initializers: staticInitializers.map(member => member.initializer.origin) });
    }
    if (node.kind === 'property' && node.accessors.length && node.accessors.every(accessor => accessor.body === null) &&
        enclosingType?.category !== 'interface' && !node.modifiers.some(modifier => ['abstract', 'extern'].includes(modifier)))
      add('backingStorage', 0, { category: 'field', typeSyntax: node.type, static: node.modifiers.includes('static'), initializer: node.initializer });
    if (node.kind === 'accessor' && node.operation === 'set') add('valueStorage', 0, { category: 'parameter', name: 'value' });
    if (node.kind === 'delegate') add('delegateInvoke', 0, { category: 'method', static: false, returnTypeSyntax: node.returnType, parameters: node.parameters });
  }
  if (functionKinds.has(node.kind)) {
    let temporaryOrdinal = 0;
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (value !== node && functionKinds.has(value.kind)) return;
      const plans = value.kind === 'using' && value.resource.kind !== 'localDeclaration' ? ['usingResource'] :
        value.kind === 'foreach' && language === 'csharp' ? ['foreachEnumerator'] : [];
      for (const operation of plans) add('temporaryStorage', temporaryOrdinal++, { category: 'loweredStorage', operation, occurrenceOrigin: value.origin });
      for (const child of lexicalChildren(value)) visit(child);
    };
    visit(node.body);
  }
  return slots.sort((left, right) => slotOrder.indexOf(left.role) - slotOrder.indexOf(right.role) || left.ordinal - right.ordinal);
}

export function enumerateSelectedDeclarations(root, unit, language, counter) {
  const counters = new Map(), entries = [], scopes = [], visited = new Set(), declarations = new Set(), nodeScopes = new WeakMap();
  const newScope = (kind, parent, owner, origin) => {
    counter.charge('maxDeclarations', `lexical-scope:${kind}:${origin.byte[0]}`);
    const ordinal = scopes.length;
    scopes.push({ ordinal, kind, parent, semanticOwner: owner, origin });
    return ordinal;
  };
  const allocate = (parent, syntax, owner, generated = null) => {
    counter.charge('maxDeclarations', `enumeration:${syntax.kind}:${syntax.origin?.byte?.[0] ?? generated?.ordinal}`);
    const key = canonicalData(parent), index = counters.get(key) ?? 0; counters.set(key, index + 1);
    const declId = { unit, parent: structuredClone(parent), index };
    const origin = generated ? { kind: 'synthetic', anchor: generated.anchor, role: generated.role, ordinal: generated.ordinal, noSpan: true } : structuredClone(syntax.origin);
    entries.push({ declId, syntax, semanticOwner: owner, lexicalScope: owner.lexicalScope ?? null, origin, generated }); return declId;
  };
  const visit = (node, parent, owner, scope, enclosingType = null, storageScope = null, depth = 0) => {
    if (!node || typeof node !== 'object') return;
    if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'selected declaration traversal depth', node.origin);
    if (visited.has(node)) {
      if (explicitKinds.has(node.kind)) deny('INCOMPLETE_FOREST', 'repeated explicit declaration node', node.origin);
      return;
    }
    visited.add(node);
    if (node.kind === 'namespace') {
      const next = { namespace: [...parent.namespace, ...node.path.map(segment => segment.spelling)], types: [...parent.types] };
      scope = newScope('namespace', scope, owner, node.origin);
      nodeScopes.set(node, scope);
      for (const child of lexicalChildren(node)) visit(child, next, owner, scope, enclosingType, storageScope, depth + 1); return;
    }
    const outsideScope = scope;
    // PowerShell control blocks do not create C#/C/JavaScript lexical scopes.
    if (node.kind === 'block' && language !== 'powershell') scope = newScope('block', scope, owner, node.origin);
    if (language === 'csharp' && ['for', 'foreach', 'using', 'catch'].includes(node.kind) ||
        language === 'c' && node.kind === 'for' ||
        language === 'javascript' && ['for', 'jsForEach', 'jsCatch'].includes(node.kind))
      scope = newScope(node.kind, scope, owner, node.origin);
    nodeScopes.set(node, scope);
    if (language === 'javascript' && node.kind === 'jsVariableDeclaration') {
      storageScope = null;
      if (node.category === 'var') {
        storageScope = scope;
        while (storageScope !== null && !['function', 'unit'].includes(scopes[storageScope].kind))
          storageScope = scopes[storageScope].parent;
      }
    }
    let childrenParent = parent;
    if (explicitKinds.has(node.kind)) {
      if (declarations.has(node)) deny('INCOMPLETE_FOREST', 'repeated explicit declaration node', node.origin);
      declarations.add(node);
      const declarationScope = node.kind === 'jsBinding' && storageScope !== null ? storageScope : scope;
      const id = allocate(parent, node, { ...owner, lexicalScope: declarationScope }); node.declId = id;
      owner = { declaration: id, lexicalScope: scope };
      if (language === 'csharp' && ['type', 'delegate'].includes(node.kind)) {
        scope = newScope('type', scope, owner, node.origin);
        owner = { declaration: id, lexicalScope: scope };
        nodeScopes.set(node, scope);
      }
      if (functionKinds.has(node.kind)) {
        scope = newScope('function', scope, owner, node.origin);
        owner = { declaration: id, lexicalScope: scope };
        nodeScopes.set(node, scope); storageScope = null;
      }
      if (node.kind === 'type' || node.kind === 'delegate' || node.kind === 'cAggregate') childrenParent = { namespace: [...parent.namespace], types: [...parent.types, id] };
      for (const slot of requiredSlots(node, language, enclosingType)) {
        const generated = { anchor: id, role: slot.role, ordinal: slot.ordinal };
        allocate(childrenParent, { kind: 'synthetic', ...slot.details }, owner, generated);
      }
    }
    for (const child of lexicalChildren(node)) {
      // C# foreach sequence is outside the iteration variable's scope.
      // JS for-of/in RHS is in the loop lexical environment (including TDZ).
      const childScope = language === 'csharp' && node.kind === 'foreach' && child === node.sequence ? outsideScope : scope;
      visit(child, childrenParent, owner, childScope, node.kind === 'type' ? node : enclosingType, storageScope, depth + 1);
    }
  };
  const unitScope = newScope('unit', null, { unitRoot: true }, root.origin);
  visit(root, { namespace: [], types: [] }, { unitRoot: true }, unitScope);
  return { entries, scopes, counters, nodeScopes };
}

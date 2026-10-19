import { deny } from './core1681-source-input.mjs';
import { canonicalData, K2_LIMITS } from './core1681-proof-terms.mjs';

const visibilityWords = new Set(['public', 'private', 'protected', 'internal']);
const volatilePrimitives = new Set(['bool', 'byte', 'sbyte', 'short', 'ushort', 'int', 'uint', 'char', 'float']);

function invalid(message, syntax) { deny('INVALID_BINDING', message, syntax.origin); }

export function csharpVisibility(syntax, owner) {
  const words = (syntax.modifiers ?? []).filter(word => visibilityWords.has(word));
  if (new Set(words).size !== words.length) invalid('duplicate access modifier', syntax);
  if (words.length > 2 || words.length === 2 && !(words.includes('protected') && words.includes('internal')))
    invalid('incompatible selected access modifiers', syntax);
  if (words.length === 2) return 'protectedInternal';
  if (words.length === 1) return words[0];
  if (!owner) return 'internal';
  return owner.category === 'interface' || syntax.kind === 'enumMember' ? 'public' : 'private';
}

// A resolved type is built by the selected resolver, never copied from a proof
// producer's annotation. Native memory and managed field locations have distinct
// lowering rules; this routine describes managed declaration storage only.
export function csharpStorage(syntax, owner, resolvedType) {
  if (!['field', 'property', 'local', 'parameter', 'iterationVariable', 'catchParameter'].includes(syntax.kind))
    invalid('managed storage declaration required', syntax);
  const modifiers = syntax.modifiers ?? [];
  if (new Set(modifiers).size !== modifiers.length) invalid('duplicate storage modifier', syntax);
  const constant = modifiers.includes('const') || syntax.kind === 'local' && syntax.constant === true;
  const readonly = modifiers.includes('readonly'), volatile = modifiers.includes('volatile');
  const field = syntax.kind === 'field', member = field || syntax.kind === 'property';
  if (resolvedType.name === 'void') invalid('storage cannot have void type', syntax);
  if (constant && !['field', 'local'].includes(syntax.kind)) invalid('const requires field or local', syntax);
  if (constant && (readonly || volatile || modifiers.includes('static'))) invalid('const has implicit static storage and no mutable field modifier', syntax);
  if (constant && !syntax.initializer) invalid('constant storage requires an actual initializer', syntax);
  if (readonly && !field || volatile && !field) invalid('readonly and volatile require field storage', syntax);
  if (readonly && volatile) invalid('readonly volatile field is not legal', syntax);
  if (!member && modifiers.some(word => ['static', ...visibilityWords].includes(word))) invalid('local or formal storage has no member modifier', syntax);
  if (volatile) {
    const legal = ['reference', 'array', 'delegate'].includes(resolvedType.category) || resolvedType.category === 'typeParameter' && resolvedType.referenceConstraint === true ||
      resolvedType.category === 'primitive' && volatilePrimitives.has(resolvedType.name) ||
      resolvedType.category === 'enum' && ['byte', 'sbyte', 'short', 'ushort', 'int', 'uint'].includes(resolvedType.underlying);
    if (!legal) invalid('resolved type is not a selected volatile field type', syntax);
  }
  const staticStorage = field && constant || member && modifiers.includes('static');
  if (member && owner?.modifiers.includes('static') && !staticStorage) invalid('static type cannot own instance storage', syntax);
  const storage = constant ? 'constant' : member ? staticStorage ? 'static' : 'instance' : syntax.kind === 'parameter' ? 'formal' : 'local';
  return {
    storage, constant, readonly, volatile, type: resolvedType,
    visibility: member ? csharpVisibility(syntax, owner) : null,
    executableInitializer: !constant && Boolean(syntax.initializer),
    initializerPhase: constant || !syntax.initializer ? null : staticStorage ? 'typeInitialization' : member ? 'instanceInitialization' : 'lexicalExecution',
    readOrdering: volatile ? 'acquire' : 'ordinary', writeOrdering: volatile ? 'release' : 'ordinary',
    // Acquire/release constrain eligible reorderings. They neither imply a
    // global total order nor turn compound read-modify-write into an atomic op.
    compoundAtomic: false,
  };
}

export function csharpInitializerPlan(type, resolvedStorageByDeclaration, declarationKey) {
  const members = type.members.flatMap(member => member.kind === 'fieldGroup' ? member.fields : [member]);
  const instance = [], static_ = [];
  for (const member of members) {
    if (!['field', 'property'].includes(member.kind)) continue;
    const metadata = resolvedStorageByDeclaration.get(declarationKey(member.declId));
    if (!metadata) invalid('initializer requires independently resolved storage metadata', member);
    if (!metadata.executableInitializer) continue;
    const transfer = { declaration: member.declId, originalOccurrence: member.initializer.origin, expression: member.initializer };
    if (metadata.initializerPhase === 'instanceInitialization') instance.push(transfer);
    else if (metadata.initializerPhase === 'typeInitialization') static_.push(transfer);
    else invalid('member initializer has invalid resolved execution phase', member);
  }
  const explicitStaticConstructor = members.find(member => member.kind === 'constructor' && member.modifiers.includes('static'));
  return { instance, static: static_, beforeFieldInit: !explicitStaticConstructor, explicitStaticConstructor: explicitStaticConstructor?.declId ?? null };
}

export function checkCsharpInitializerSlots(typeEntry, enumeration, storageMetadata) {
  const key = canonicalData, type = typeEntry.syntax;
  const plan = csharpInitializerPlan(type, storageMetadata, key);
  const generated = enumeration.filter(entry => entry.generated && key(entry.generated.anchor) === key(typeEntry.declId));
  const members = type.members.flatMap(member => member.kind === 'fieldGroup' ? member.fields : [member]);
  const instanceRequired = type.category === 'class' && !type.modifiers.includes('static') &&
    !members.some(member => member.kind === 'constructor' && !member.modifiers.includes('static'));
  const staticRequired = plan.static.length > 0 && !plan.explicitStaticConstructor;
  const instanceSlots = generated.filter(entry => entry.generated.role === 'instanceConstructor');
  const staticSlots = generated.filter(entry => entry.generated.role === 'typeInitializer');
  if (instanceSlots.length !== Number(instanceRequired) || staticSlots.length !== Number(staticRequired))
    invalid('implicit constructor enumeration differs from resolved initializer requirements', type);
  if (instanceRequired && key(instanceSlots[0].syntax.instanceInitializers) !== key(plan.instance.map(transfer => transfer.originalOccurrence)))
    invalid('implicit instance initializer slots differ from effective storage metadata', type);
  if (staticRequired && key(staticSlots[0].syntax.initializers) !== key(plan.static.map(transfer => transfer.originalOccurrence)))
    invalid('implicit static initializer slots differ from effective storage metadata', type);
  return plan;
}

// Structural initializer grammar only. Expression conversion and executable
// array lowering remain separate from this original declarator/type witness.
export function checkSelectedArrayInitializerShape(value, type, counter) {
  if (value?.kind !== 'initializer') return;
  if (type.category !== 'array') deny('INVALID_BINDING', 'brace variable initializer requires resolved array type', value.origin);
  const pending = [{ value, depth: 1 }], lengths = new Map();
  while (pending.length) {
    counter.charge('maxInvariantSteps', 'array-initializer-shape');
    const row = pending.pop();
    if (row.depth > K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'array initializer depth exhausted', row.value.origin);
    const previous = lengths.get(row.depth), length = row.value.elements.length;
    if (previous !== undefined && previous !== length) deny('INVALID_SYNTAX', 'array initializer dimensions differ', row.value.origin);
    lengths.set(row.depth, length);
    for (const element of row.value.elements) {
      counter.charge('maxInvariantSteps', 'array-initializer-element');
      if (row.depth < type.rank) {
        if (element.kind !== 'initializer') deny('INVALID_SYNTAX', 'array initializer requires nested dimension', element.origin);
        pending.push({ value: element, depth: row.depth + 1 });
      } else if (element.kind === 'initializer') deny('INVALID_SYNTAX', 'array initializer leaf requires expression', element.origin);
    }
  }
}
import { deny } from './core1681-source-input.mjs';
import { canonicalData, K2_LIMITS, requireProofCounter, foldBitvector, foldBitvectorComparison } from './core1681-proof-terms.mjs';
import { checkedOriginalLiteral, checkedCsharpUnaryLiteral } from './core1681-selected-literals.mjs';
import { implicitCsharpConversion, sameSelectedType } from './core1681-selected-conversions.mjs';
import { bindSelectedPredefinedOperator } from './core1681-selected-predefined-operators.mjs';
import { bindSelectedInvocation } from './core1681-selected-invocation.mjs';

const aliases = { Int32: 'int', UInt32: 'uint', Int64: 'long', UInt64: 'ulong',
  Int16: 'short', UInt16: 'ushort', SByte: 'sbyte', Byte: 'byte', Char: 'char', Boolean: 'bool',
  Single: 'float', Double: 'double', Decimal: 'decimal', String: 'string' };
export function selectedScalarSort(type) {
  if (type.category !== 'primitive') deny('INCOMPLETE_BODY', 'scalar lowering requires its actual primitive type');
  if (type.name === 'bool') return 'Bool';
  if (type.name === 'float') return 'F32';
  if (type.name === 'double') return 'F64';
  if (type.name === 'decimal') return 'Decimal';
  const width = { sbyte: 8, byte: 8, short: 16, ushort: 16, char: 16, int: 32, uint: 32, long: 64, ulong: 64 }[type.name];
  if (!width) deny('INCOMPLETE_BODY', 'primitive has no scalar value sort');
  return { kind: 'BV', width, signed: ['sbyte', 'short', 'int', 'long'].includes(type.name) };
}

function originalCalleeExceptions(body, substitute, counter) {
  counter.charge('maxInvariantSteps', 'original-call-exception-reach');
  if (body.exceptionalCompletions.length === 0) return [];
  const yes = { kind: 'Constant', sort: 'Bool', value: true }, no = { ...yes, value: false };
  const choose = (test, whenTrue, whenFalse) => {
    counter.charge('maxInvariantSteps', 'original-call-reach-join');
    if (test.kind === 'Constant') return test.value ? whenTrue : whenFalse;
    return { kind: 'Op', opcode: 'ite', sort: 'Bool', args: [test, whenTrue, whenFalse] };
  };
  const outgoing = new Map(), failures = new Map(), reach = new Map([[body.entry, yes]]);
  for (const row of body.exceptionalCompletions) {
    counter.charge('maxInvariantSteps', 'original-call-exception-index');
    if (!failures.has(row.instruction)) failures.set(row.instruction, []);
    failures.get(row.instruction).push(row);
  }
  for (const edge of body.edges) {
    counter.charge('maxInvariantSteps', 'original-call-reach-edge-index');
    if (edge.to <= edge.from) deny('INCOMPLETE_BODY', 'call requires its actual cyclic completion contract');
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    if (edge.completion !== 'throw' || edge.to !== body.exit) outgoing.get(edge.from).push(edge);
  }
  for (const node of body.nodes) {
    counter.charge('maxInvariantSteps', 'original-call-reach-node');
    const reached = reach.get(node.id) ?? no;
    for (const edge of outgoing.get(node.id) ?? []) {
      counter.charge('maxInvariantSteps', 'original-call-reach-edge');
      if (edge.completion === 'throw' && edge.branch === null)
        deny('INVALID_BINDING', 'internal throw edge lacks its original exceptional branch');
      let guard = yes;
      if (edge.branch !== null) {
        if (edge.branch.source !== node.id) deny('INVALID_BINDING', 'call edge lost its actual condition source');
        if (edge.completion === 'throw') {
          const row = body.exceptionalCompletions[edge.branch.outcome?.exception];
          if (!row || row.instruction !== node.id) deny('INVALID_BINDING', 'internal throw edge loses its original failure predicate');
          guard = row.condition;
        } else if (typeof edge.branch.outcome === 'boolean') guard = edge.branch.outcome ? node.term : choose(node.term, no, yes);
        else if (edge.branch.outcome === 'normal' && failures.has(node.id)) {
          let anyFailure = no;
          for (const row of failures.get(node.id)) {
            counter.charge('maxInvariantSteps', 'original-call-normal-failure');
            anyFailure = choose(anyFailure, yes, row.condition);
          }
          guard = choose(anyFailure, no, yes);
        } else deny('INCOMPLETE_BODY', 'call requires another original completion guard');
      }
      const incoming = choose(reached, guard, no);
      reach.set(edge.to, choose(reach.get(edge.to) ?? no, yes, incoming));
    }
  }
  const results = [];
  for (const frontier of body.finalFrontiers) {
    counter.charge('maxInvariantSteps', 'original-call-exception-substitution');
    if (frontier.kind !== 'throw') continue;
    const row = body.exceptionalCompletions[frontier.exception];
    if (!row || row.instruction !== frontier.sourceInstruction)
      deny('INVALID_BINDING', 'callee final frontier loses its original exceptional alternative');
    results.push({ calleeOrdinal: row.ordinal, calleeInstruction: frontier.instruction, category: row.category,
      condition: substitute(choose(reach.get(frontier.instruction) ?? no, frontier.condition, no)) });
  }
  return results;
}

// Connected scalar lowering includes ordered reads/writes/conversions, branch
// store joins, checked arithmetic alternatives, same-source value/void calls,
// and mixed saved-return/normal frontiers through nested normal finalizers.
// Unhandled raw failures pass through original local/formal lifetime ends and
// terminal exception frontiers, including owning try/finally pending/resume paths.
// Guarded scalar finalizer failures replace pending completions on their actual
// exceptional paths. Catch/filter/explicit exception values, general replacement
// identity, loops and ref/out remain required phases.
// These scalar source products never constitute an admitted whole proof.
export function bindSelectedCsharpScalarBody(compilation, declaration, environment) {
  return bindScalarBody(compilation, declaration, environment, new Set());
}
function bindScalarBody(compilation, declaration, environment, ancestors) {
  requireProofCounter(environment.counter);
  const declarationKey = canonicalData(declaration);
  if (ancestors.has(declarationKey)) deny('INCOMPLETE_BODY', 'recursive call requires its original recursive effect contract');
  if (ancestors.size >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'original callee body depth exhausted');
  const descendants = new Set(ancestors); descendants.add(declarationKey);
  const entry = compilation.byDeclaration.get(canonicalData(declaration));
  const signature = compilation.bound.declarationMetadata.get(canonicalData(declaration));
  if (!entry || entry.syntax.kind !== 'method' || entry.syntax.body?.kind !== 'block' || !signature)
    deny('INCOMPLETE_BODY', 'body lowering requires an original method block and bound signature');
  const original = compilation.originals.find(unit => unit.unit === declaration.unit);
  const decoded = original?.parser.scanner.decoded, counter = environment.counter;
  const names = compilation.names.get(declaration.unit), context = compilation.context(entry);
  if (!decoded || !names || !counter) deny('INVALID_BINDING', 'body lacks original unit, lexical index or counter');
  const binder = { declaration, role: 'scalarBody' }, slots = [], locations = new Map(), nodes = [], edges = [], exceptionalCompletions = [];
  const integralConstants = new Map();
  const booleanConstants = new Map();
  const endedLocations = new Set();
  const activeLocations = new Map();
  let finalizerContext = null;
  const locationKey = decl => activeLocations.get(canonicalData(decl)) ?? canonicalData(decl);
  let previous = null, returned = false, occurrenceOrdinal = 0;
  const earlyReturns = [], earlyThrows = [], exceptionTargets = new Map();
  const storageSnapshot = () => {
    const snapshot = [];
    for (const row of locations.values()) {
      counter.charge('maxInvariantSteps', 'original-store-snapshot-location');
      if (row.defined) snapshot.push({ location: row.location, type: row.type, value: row.term });
    }
    return snapshot;
  };
  const captureStore = () => {
    const snapshot = new Map();
    for (const [key, row] of locations) {
      counter.charge('maxInvariantSteps', 'original-branch-store-capture');
      snapshot.set(key, { defined: row.defined, term: row.term, lastWrite: row.lastWrite, ended: endedLocations.has(key),
        active: activeLocations.get(canonicalData(row.location.declaration)) === key });
    }
    return snapshot;
  };
  const restoreStore = snapshot => {
    activeLocations.clear();
    for (const [key, row] of locations) {
      counter.charge('maxInvariantSteps', 'original-branch-store-restore');
      const original = snapshot.get(key);
      if (!original) {
        if (!endedLocations.has(key) || row.defined || row.lastWrite !== undefined)
          deny('INCOMPLETE_BODY', 'branch requires its original location allocation/lifetime transfer');
        continue;
      }
      row.defined = original.defined;
      if (original.active) activeLocations.set(canonicalData(row.location.declaration), key);
      if (original.ended) endedLocations.add(key); else endedLocations.delete(key);
      if (original.defined) row.term = original.term; else delete row.term;
      if (original.lastWrite !== undefined) row.lastWrite = original.lastWrite; else delete row.lastWrite;
    }
  };
  const joinStores = (whenTrue, whenFalse, test, join) => {
    for (const [key, row] of locations) {
      counter.charge('maxInvariantSteps', 'original-branch-store-join');
      const left = whenTrue.get(key), right = whenFalse.get(key);
      if (!left || !right) {
        if (!endedLocations.has(key) || left?.defined || right?.defined)
          deny('INCOMPLETE_BODY', 'branch joins require complete original location rosters');
        row.defined = false; delete row.term; delete row.lastWrite;
        continue;
      }
      row.defined = left.defined && right.defined;
      if (row.defined) row.term = canonicalData(left.term) === canonicalData(right.term) ? left.term :
        { kind: 'Op', opcode: 'ite', sort: selectedScalarSort(row.type), args: [test, left.term, right.term] };
      else delete row.term;
      if (left.lastWrite === right.lastWrite && left.lastWrite !== undefined) row.lastWrite = left.lastWrite;
      else if (row.defined && (left.lastWrite !== undefined || right.lastWrite !== undefined)) row.lastWrite = join.id;
      else delete row.lastWrite;
    }
    join.postStore = storageSnapshot();
  };
  const emit = (operation, syntax, type, data = {}) => {
    counter.charge('maxOccurrences', 'original-scalar-instruction');
    const parent = compilation.sourceParents.get(syntax);
    if (!parent?.origin) deny('INVALID_BINDING', 'body instruction lacks its original syntactic parent', syntax.origin);
    const id = nodes.length, occurrence = { unit: declaration.unit, span: syntax.origin,
      syntacticParent: { kind: parent.kind, span: parent.origin }, ordinal: occurrenceOrdinal++ };
    const node = { id, occurrence, sourceKind: syntax.kind, operation, type,
      preStore: storageSnapshot(), postStore: storageSnapshot(), ...data };
    nodes.push(node);
    if (previous !== null) edges.push({ from: previous, to: id, completion: 'normal', branch: null });
    previous = id; return node;
  };
  const locate = (decl, type) => {
    counter.charge('maxInvariantSteps', 'original-scalar-location');
    const declarationKey = canonicalData(decl);
    const key = finalizerContext ? canonicalData({ declaration: decl, finalizer: finalizerContext }) : declarationKey;
    if (locations.has(key)) deny('INVALID_BINDING', 'original allocation context is reused');
    if (!locations.has(key)) {
      locations.set(key, { location: { binder, declaration: decl,
        ...(finalizerContext ? { finalizer: finalizerContext } : {}) }, type, defined: false });
    }
    activeLocations.set(declarationKey, key);
    const row = locations.get(key);
    if (!sameSelectedType(row.type, type)) deny('INVALID_BINDING', 'original storage changed its resolved type');
    return row;
  };
  const convert = (value, type, syntax) => {
    const conversion = implicitCsharpConversion(value.type, type, environment, value.constant ?? null);
    if (!conversion) deny('INVALID_BINDING', 'body value has no original implicit conversion', syntax.origin);
    if (sameSelectedType(value.type, type)) return value;
    const term = { kind: 'Op', opcode: 'cast', sort: selectedScalarSort(type), args: [value.term] };
    const instruction = emit('convert', syntax, type, { input: value.instruction, conversion, term });
    return { type, term, instruction: instruction.id,
      ...(typeof value.constant === 'bigint' && term.sort.kind === 'BV' &&
          ['numeric', 'constantNumeric'].includes(conversion.kind) ? { constant: value.constant } : {}) };
  };
  for (let ordinal = 0; ordinal < signature.parameters.length; ordinal++) {
    const formal = signature.parameters[ordinal];
    if (formal.direction !== 'value') deny('INCOMPLETE_BODY', 'ref/out requires complete actual-location alias lowering', formal.origin);
    const sort = selectedScalarSort(formal.type), row = locate(formal.declaration, formal.type);
    slots.push({ declaration: formal.declaration, sort });
    row.defined = true; row.term = { kind: 'Bound', sort, binder, index: ordinal };
  }
  emit('entry', entry.syntax.body, signature.returnType, { declaration });
  const expression = (syntax, checkedContext, depth = 0) => {
    if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'scalar body expression depth exhausted', syntax.origin);
    const child = value => expression(value, checkedContext, depth + 1);
    if (syntax.kind === 'call') {
      if (syntax.target.kind !== 'name' || syntax.arguments.some(argument => argument.direction !== 'value'))
        deny('INCOMPLETE_BODY', 'call requires its complete receiver/ref-out transfer', syntax.origin);
      const lookup = names.lookup(syntax.target.name, syntax.target);
      if (!['declaration', 'declarationGroup'].includes(lookup.kind) || lookup.declarations.length !== 1)
        deny('INCOMPLETE_BODY', 'call requires its complete original member/overload dispatch', syntax.origin);
      const candidate = compilation.bound.declarationMetadata.get(canonicalData(lookup.declarations[0]));
      if (!candidate || candidate.category !== 'method' || !candidate.static || candidate.genericArity !== 0 ||
          candidate.parameters.some(formal => formal.direction !== 'value' || formal.variadic))
        deny('INCOMPLETE_BODY', 'call requires its complete original instance/generic/default/params effect', syntax.origin);
      for (const member of compilation.bound.declarationMetadata.values()) {
        counter.charge('maxInvariantSteps', 'original-call-type-initialization');
        if (member.category === 'constructor' && member.static && member.declaringType &&
            sameSelectedType(member.declaringType, candidate.declaringType))
          deny('INCOMPLETE_BODY', 'call requires its actual source type-initialization effects', syntax.origin);
      }
      const values = syntax.arguments.map(argument => child(argument.expression));
      const actuals = values.map((value, ordinal) => ({ ...value, direction: 'value', name: syntax.arguments[ordinal].name,
        origin: syntax.arguments[ordinal].expression.origin }));
      const calleeOriginal = compilation.originals.find(unit => unit.unit === candidate.declaration.unit);
      const calleeEntry = compilation.byDeclaration.get(canonicalData(candidate.declaration));
      if (!calleeOriginal || !calleeEntry) deny('INVALID_BINDING', 'optional values lack their actual callee source unit', syntax.origin);
      const calleeDecoded = calleeOriginal.parser.scanner.decoded, calleeContext = compilation.context(calleeEntry);
      const defaultRows = new Map();
      const selected = bindSelectedInvocation([candidate], actuals, null, { ...environment,
        objectType: compilation.index.primitive('object', context, syntax.origin),
        typeGraph: compilation.typeGraph, declarationMetadata: compilation.bound.declarationMetadata,
        csharpLanguageVersion: environment.languageVersion, resolveOriginalDefaults: row => ({ ...row,
          parameters: row.parameters.map((formal, ordinal) => {
            if (formal.defaultSyntax === null) return formal;
            const source = formal.defaultSyntax;
            const unaryLiteral = source.kind === 'unary' && ['+', '-'].includes(source.operation) && source.operand.kind === 'literal';
            if (!(source.kind === 'literal' || unaryLiteral) || !['bool', 'sbyte', 'byte', 'short', 'ushort', 'char', 'int', 'uint', 'long', 'ulong'].includes(formal.type.name))
              deny('INCOMPLETE_BODY', 'optional value requires its complete original constant expression', source.origin);
            const literal = unaryLiteral ? checkedCsharpUnaryLiteral(calleeDecoded, source, counter) :
              checkedOriginalLiteral(calleeDecoded, source.token, 'csharp', counter);
            const sourceType = compilation.index.primitive(aliases[literal.type], calleeContext, source.origin);
            const constant = typeof literal.term.value === 'string' && literal.term.sort?.kind === 'BV' ? BigInt(literal.term.value) : null;
            const conversion = implicitCsharpConversion(sourceType, formal.type, environment, constant);
            if (!conversion) deny('INVALID_BINDING', 'optional literal lacks original formal conversion', source.origin);
            const term = sameSelectedType(sourceType, formal.type) ? literal.term :
              { kind: 'Op', opcode: 'cast', sort: selectedScalarSort(formal.type), args: [literal.term] };
            const originalDefault = { formal: ordinal, unit: candidate.declaration.unit, occurrence: source.origin, type: formal.type, conversion, term };
            defaultRows.set(ordinal, originalDefault);
            return { ...formal, defaultValue: { kind: 'constant', type: formal.type, value: term, originalOccurrence: source.origin } };
          }) }),
        delegateSignature: () => null }, syntax);
      if (selected.expanded || selected.argumentMapping.some((row, ordinal) => row.sourceIndex !== ordinal || row.element))
        deny('INCOMPLETE_BODY', 'call requires its complete original formal reordering/allocation transfer', syntax.origin);
      const inputs = values.map((value, ordinal) => convert(value, selected.targets[ordinal], syntax.arguments[ordinal].expression));
      const formalOrder = selected.argumentMapping.map(row => row.formalIndex), formalValues = new Array(candidate.parameters.length);
      for (let sourceIndex = 0; sourceIndex < inputs.length; sourceIndex++) {
        counter.charge('maxInvariantSteps', 'original-call-formal-value');
        formalValues[formalOrder[sourceIndex]] = inputs[sourceIndex];
      }
      const defaults = selected.defaults.map(value => defaultRows.get(value.formal));
      for (const value of defaults) {
        counter.charge('maxInvariantSteps', 'original-call-default-value');
        if (!value || formalValues[value.formal]) deny('INVALID_BINDING', 'optional value lost original omitted formal', syntax.origin);
        formalValues[value.formal] = { term: value.term };
      }
      const calleeBody = bindScalarBody(compilation, candidate.declaration, environment, descendants);
      const substitute = (term, level = 0) => {
        counter.charge('maxInvariantSteps', 'original-callee-value-substitution');
        if (level >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'original callee substitution depth exhausted');
        if (term.kind === 'Bound') {
          if (canonicalData(term.binder) !== canonicalData(calleeBody.binder) || !formalValues[term.index])
            deny('INVALID_BINDING', 'callee value contains another original formal binder', syntax.origin);
          return formalValues[term.index].term;
        }
        if (term.kind === 'Constant') return { ...term };
        if (term.kind !== 'Op') deny('INCOMPLETE_BODY', 'callee value requires another original closed constructor', syntax.origin);
        return { ...term, args: term.args.map(argument => substitute(argument, level + 1)) };
      };
      const exceptions = originalCalleeExceptions(calleeBody, substitute, counter);
      const propagate = instruction => {
        for (const failure of exceptions) {
          counter.charge('maxInvariantSteps', 'original-call-exception-completion');
          retainOriginalException({ ordinal: exceptionalCompletions.length, instruction: instruction.id,
            category: failure.category, condition: failure.condition, store: storageSnapshot() }, syntax);
        }
      };
      if (candidate.returnType.category === 'primitive' && candidate.returnType.name === 'void') {
        const instruction = emit('sourceCallVoid', syntax, candidate.returnType, { declaration: candidate.declaration,
          inputs: inputs.map(value => value.instruction), formalOrder, defaults, calleeBody, exceptions });
        propagate(instruction);
        return { type: candidate.returnType, instruction: instruction.id };
      }
      const returnIds = new Set(), coveredReturns = new Set(), outgoing = new Map();
      for (const node of calleeBody.nodes) {
        counter.charge('maxInvariantSteps', 'original-call-return-frontier');
        outgoing.set(node.id, []);
      }
      for (const frontier of calleeBody.finalFrontiers) {
        counter.charge('maxInvariantSteps', 'original-call-final-return-frontier');
        if (['return', 'returnVoid'].includes(frontier.kind)) returnIds.add(frontier.instruction);
      }
      for (const edge of calleeBody.edges) {
        counter.charge('maxInvariantSteps', 'original-call-return-edge');
        if (edge.completion !== 'throw') outgoing.get(edge.from).push(edge);
      }
      const results = new Map(), active = new Set();
      const returnEquation = (id, level = 0) => {
        const chain = []; let term;
        for (;;) {
          counter.charge('maxInvariantSteps', 'original-call-return-path');
          if (level >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'original call return path depth exhausted');
          if (results.has(id)) { term = results.get(id); break; }
          if (active.has(id)) deny('INCOMPLETE_BODY', 'call requires its original cyclic control contract', syntax.origin);
          const node = calleeBody.nodes[id];
          if (!node) deny('INVALID_BINDING', 'call return path lacks its original node', syntax.origin);
          active.add(id); chain.push(id);
          if (node.operation === 'return') { coveredReturns.add(id); term = node.term; }
          else {
            const edges = outgoing.get(id);
            if (edges.length === 1 && (edges[0].branch === null || edges[0].branch.outcome === 'normal')) { id = edges[0].to; continue; }
            else if (edges.length === 2 && edges.every(edge => edge.branch?.source === id) &&
                edges.some(edge => edge.branch.outcome === true) && edges.some(edge => edge.branch.outcome === false) &&
                ['statementBranch', 'conditionalBranch', 'shortCircuitBranch'].includes(node.operation)) {
              const yes = returnEquation(edges.find(edge => edge.branch.outcome === true).to, level + 1);
              const no = returnEquation(edges.find(edge => edge.branch.outcome === false).to, level + 1);
              term = canonicalData(yes) === canonicalData(no) ? yes :
                { kind: 'Op', opcode: 'ite', sort: selectedScalarSort(candidate.returnType), args: [node.term, yes, no] };
            } else deny('INCOMPLETE_BODY', 'call requires its complete original void/exceptional control transfer', syntax.origin);
          }
          break;
        }
        for (const visited of chain) { active.delete(visited); results.set(visited, term); }
        return term;
      };
      const returnedTerm = returnEquation(calleeBody.entry);
      if (returnIds.size !== coveredReturns.size)
        deny('INCOMPLETE_BODY', 'call requires every original return path', syntax.origin);
      for (const id of returnIds) {
        counter.charge('maxInvariantSteps', 'original-call-return-coverage');
        if (!coveredReturns.has(id)) deny('INCOMPLETE_BODY', 'call omits an original final return frontier', syntax.origin);
      }
      const term = substitute(returnedTerm);
      const instruction = emit('sourceCall', syntax, candidate.returnType, { declaration: candidate.declaration,
        inputs: inputs.map(value => value.instruction), formalOrder, defaults, calleeBody, exceptions, term });
      propagate(instruction);
      return { type: candidate.returnType, term, instruction: instruction.id };
    }
    if (syntax.kind === 'group') return child(syntax.expression);
    if (syntax.kind === 'arithmeticContext') {
      const word = syntax.checked ? 'checked' : 'unchecked', start = syntax.origin.utf16[0];
      if (decoded.text.slice(start, start + word.length) !== word) deny('INVALID_BINDING', 'arithmetic scope differs from original bytes');
      return expression(syntax.expression, syntax.checked, depth + 1);
    }
    if (syntax.kind === 'unary' && syntax.operation === '-' && syntax.operand.kind === 'literal' &&
        /^0*(?:2147483648|9223372036854775808[lL]?)$/u.test(syntax.operand.token.spelling)) {
      const literal = checkedCsharpUnaryLiteral(decoded, syntax, counter), type = compilation.index.primitive(aliases[literal.type], context, syntax.origin);
      const instruction = emit('unaryLiteral', syntax, type, { operatorOccurrence: syntax.operatorToken.origin,
        operandOccurrence: syntax.operand.origin, term: literal.term });
      return { type, term: literal.term, instruction: instruction.id, constant: BigInt(literal.term.value) };
    }
    if (syntax.kind === 'binary' && ['&&', '||'].includes(syntax.operation)) {
      const requireBranchExpression = (node, level = 0) => {
        counter.charge('maxInvariantSteps', 'original-short-circuit-effect-roster');
        if (level >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'short-circuit child depth exhausted');
        if (['literal', 'name'].includes(node.kind)) return;
        const children = node.kind === 'assignment' && node.operation === '=' && node.left.kind === 'name' ? [node.right] :
          ['group', 'arithmeticContext'].includes(node.kind) ? [node.expression] :
          ['cast', 'unary', 'postfix'].includes(node.kind) ? [node.operand] : node.kind === 'binary' ? [node.left, node.right] :
          node.kind === 'conditional' ? [node.test, node.whenTrue, node.whenFalse] : null;
        if (!children) deny('INCOMPLETE_BODY', 'short-circuit child requires its effectful store/call transfer', node.origin);
        for (const value of children) requireBranchExpression(value, level + 1);
      };
      requireBranchExpression(syntax);
      const left = child(syntax.left);
      if (left.type.category !== 'primitive' || left.type.name !== 'bool')
        deny('INCOMPLETE_BODY', 'short-circuit requires original user-defined truth/operator transfer', syntax.origin);
      const branch = emit('shortCircuitBranch', syntax, left.type, { input: left.instruction, term: left.term });
      const incomingStore = captureStore();
      emit('shortCircuitArm', syntax, left.type, { branch: branch.id, outcome: true });
      edges.at(-1).branch = { source: branch.id, outcome: true };
      let right;
      if (syntax.operation === '&&') right = child(syntax.right);
      const trueTail = previous, trueStore = captureStore();
      previous = branch.id;
      restoreStore(incomingStore);
      emit('shortCircuitArm', syntax, left.type, { branch: branch.id, outcome: false });
      edges.at(-1).branch = { source: branch.id, outcome: false };
      if (syntax.operation === '||') right = child(syntax.right);
      if (!right || !sameSelectedType(left.type, right.type))
        deny('INCOMPLETE_BODY', 'short-circuit requires original Boolean right operand', syntax.origin);
      const constant = { kind: 'Constant', sort: 'Bool', value: syntax.operation === '||' };
      const term = { kind: 'Op', opcode: 'ite', sort: 'Bool', args: syntax.operation === '&&'
        ? [left.term, right.term, constant] : [left.term, constant, right.term] };
      const instruction = emit('shortCircuitJoin', syntax, left.type, { branch: branch.id,
        left: left.instruction, right: right.instruction, term });
      edges.push({ from: trueTail, to: instruction.id, completion: 'normal', branch: null });
      joinStores(trueStore, captureStore(), left.term, instruction);
      return { type: left.type, term, instruction: instruction.id,
        ...(typeof left.constant === 'boolean' && typeof right.constant === 'boolean'
          ? { constant: syntax.operation === '&&' ? left.constant && right.constant : left.constant || right.constant } : {}) };
    }
    if (syntax.kind === 'conditional') {
      const requireBranchExpression = (node, level = 0) => {
        counter.charge('maxInvariantSteps', 'original-conditional-expression-effects');
        if (level >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'conditional child depth exhausted');
        if (['literal', 'name'].includes(node.kind)) return;
        const children = node.kind === 'assignment' && node.operation === '=' && node.left.kind === 'name' ? [node.right] :
          ['group', 'arithmeticContext'].includes(node.kind) ? [node.expression] :
          ['cast', 'unary', 'postfix'].includes(node.kind) ? [node.operand] :
          node.kind === 'binary' ? [node.left, node.right] :
          node.kind === 'conditional' ? [node.test, node.whenTrue, node.whenFalse] : null;
        if (!children) deny('INCOMPLETE_BODY', 'conditional child requires its effectful state/call transfer', node.origin);
        for (const value of children) requireBranchExpression(value, level + 1);
      };
      requireBranchExpression(syntax);
      const test = child(syntax.test);
      if (test.type.category !== 'primitive' || test.type.name !== 'bool')
        deny('INCOMPLETE_BODY', 'conditional test requires its original Boolean conversion/operator transfer', syntax.origin);
      const branch = emit('conditionalBranch', syntax, test.type, { input: test.instruction, term: test.term });
      const incomingStore = captureStore();
      emit('conditionalArm', syntax, test.type, { branch: branch.id, outcome: true });
      edges.at(-1).branch = { source: branch.id, outcome: true };
      const whenTrue = child(syntax.whenTrue), trueTail = previous, trueStore = captureStore();
      previous = branch.id;
      restoreStore(incomingStore);
      emit('conditionalArm', syntax, test.type, { branch: branch.id, outcome: false });
      edges.at(-1).branch = { source: branch.id, outcome: false };
      const whenFalse = child(syntax.whenFalse);
      if (!sameSelectedType(whenTrue.type, whenFalse.type))
        deny('INCOMPLETE_BODY', 'conditional result requires its complete original common-type conversions', syntax.origin);
      const term = { kind: 'Op', opcode: 'ite', sort: selectedScalarSort(whenTrue.type),
        args: [test.term, whenTrue.term, whenFalse.term] };
      const instruction = emit('conditionalJoin', syntax, whenTrue.type, { branch: branch.id,
        test: test.instruction, whenTrue: whenTrue.instruction, whenFalse: whenFalse.instruction, term });
      edges.push({ from: trueTail, to: instruction.id, completion: 'normal', branch: null });
      joinStores(trueStore, captureStore(), test.term, instruction);
      return { type: whenTrue.type, term, instruction: instruction.id,
        ...(typeof test.constant === 'boolean' && ['bigint', 'boolean'].includes(typeof whenTrue.constant) &&
          typeof whenTrue.constant === typeof whenFalse.constant
          ? { constant: test.constant ? whenTrue.constant : whenFalse.constant } : {}) };
    }
    if (syntax.kind === 'literal') {
      const literal = checkedOriginalLiteral(decoded, syntax.token, 'csharp', counter), alias = aliases[literal.type];
      if (!alias) deny('INCOMPLETE_BODY', 'literal requires reference/null aggregate lowering', syntax.origin);
      const type = compilation.index.primitive(alias, context, syntax.origin);
      if (canonicalData(selectedScalarSort(type)) !== canonicalData(literal.term.sort))
        deny('INVALID_BINDING', 'literal sort differs from actual bound CLR type', syntax.origin);
      const instruction = emit('literal', syntax, type, { term: literal.term });
      return { type, term: literal.term, instruction: instruction.id,
        ...(literal.term.sort?.kind === 'BV' ? { constant: BigInt(literal.term.value) } :
          literal.term.sort === 'Bool' ? { constant: literal.term.value } : {}) };
    }
    if (syntax.kind === 'name') {
      const lookup = names.lookup(syntax.name, syntax);
      if (lookup.kind !== 'declaration') deny('INCOMPLETE_BODY', 'name requires original member/call/namespace lowering', syntax.origin);
      const row = locations.get(locationKey(lookup.declarations[0]));
      if (!row || !row.defined) deny('INVALID_BINDING', 'scalar storage is not definitely assigned on this original edge', syntax.origin);
      const instruction = emit('read', syntax, row.type, { location: row.location, term: row.term });
      const key = canonicalData(lookup.declarations[0]);
      const constant = integralConstants.has(key) ? integralConstants.get(key) : booleanConstants.get(key);
      return { type: row.type, term: row.term, instruction: instruction.id,
        ...(constant === undefined ? {} : { constant }) };
    }
    if (syntax.kind === 'assignment' && ['+=', '-=', '*=', '&=', '|=', '^=', '<<=', '>>='].includes(syntax.operation) && syntax.left.kind === 'name') {
      const lookup = names.lookup(syntax.left.name, syntax.left);
      if (lookup.kind !== 'declaration') deny('INCOMPLETE_BODY', 'compound write requires original lexical storage', syntax.origin);
      const key = canonicalData(lookup.declarations[0]), row = locations.get(locationKey(lookup.declarations[0]));
      if (!row || !row.defined) deny('INVALID_BINDING', 'compound write reads unassigned original storage', syntax.origin);
      if (integralConstants.has(key) || booleanConstants.has(key)) deny('INVALID_BINDING', 'compound write cannot mutate a constant', syntax.origin);
      const boolean = row.type.category === 'primitive' && row.type.name === 'bool';
      const shift = ['<<=', '>>='].includes(syntax.operation);
      if (boolean ? !['&=', '|=', '^='].includes(syntax.operation) :
          row.type.category !== 'primitive' || !['sbyte', 'byte', 'short', 'ushort', 'char', 'int', 'uint', 'long', 'ulong'].includes(row.type.name) ||
          typeof checkedContext !== 'boolean')
        deny('INCOMPLETE_BODY', 'compound write requires complete original checked/promotion/domain transfer', syntax.origin);
      const left = child(syntax.left), right = child(syntax.right);
      const selected = bindSelectedPredefinedOperator(syntax, [left, right].map((value, ordinal) => ({ ...value,
        direction: 'value', name: null, origin: [syntax.left, syntax.right][ordinal].origin })),
        { ...environment, typeIndex: compilation.index, decodedUnits: compilation.decodedUnits,
          checkedArithmeticContext: checkedContext }, context);
      if (boolean ? selected.resultType.name !== 'bool' : selected.semantics.kind !== 'numeric' ||
          !['int', 'uint', 'long', 'ulong'].includes(selected.resultType.name))
        deny('INCOMPLETE_BODY', 'compound write requires complete original operator domain', syntax.origin);
      let resultConversion = implicitCsharpConversion(selected.resultType, row.type, environment);
      if (!resultConversion) {
        if (boolean || !shift &&
            !implicitCsharpConversion(right.type, row.type, environment, right.constant ?? null))
          deny('INVALID_BINDING', 'compound result lacks original permitted back conversion', syntax.origin);
        resultConversion = { kind: 'explicitIntegral', source: selected.resultType.name, target: row.type.name, checkedContext };
      }
      const promoted = [left, right].map((value, ordinal) => convert(value, selected.targets[ordinal], [syntax.left, syntax.right][ordinal]));
      const rightType = promoted[1].type;
      const operation = selected.compoundAssignment.underlyingOperation;
      const choose = (test, yes, no) => ({ kind: 'Op', opcode: 'ite', sort: 'Bool', args: [test, yes, no] });
      const bool = value => ({ kind: 'Constant', sort: 'Bool', value });
      const args = promoted.map(value => value.term);
      if (shift) args[1] = { kind: 'Op', opcode: 'cast', sort: 'Z', args: [
        { kind: 'Op', opcode: 'bitand', sort: selectedScalarSort(rightType), args: [promoted[1].term,
          { kind: 'Constant', sort: selectedScalarSort(rightType), value: ['long', 'ulong'].includes(row.type.name) ? '63' : '31' }] }] };
      const operatorTerm = boolean ? operation === '&' ? choose(left.term, right.term, bool(false)) :
        operation === '|' ? choose(left.term, bool(true), right.term) :
        choose(left.term, choose(right.term, bool(false), bool(true)), right.term) :
        { kind: 'Op', opcode: { '+': 'add', '-': 'sub', '*': 'mul', '&': 'bitand', '|': 'bitor', '^': 'bitxor', '<<': 'shl', '>>': 'shr' }[operation],
          sort: selectedScalarSort(selected.resultType), args };
      const term = sameSelectedType(selected.resultType, row.type) ? operatorTerm :
        { kind: 'Op', opcode: 'cast', sort: selectedScalarSort(row.type), args: [operatorTerm] };
      const overflowRange = (mathematical, type) => {
        const sort = selectedScalarSort(type), modulus = 1n << BigInt(sort.width);
        const lower = sort.signed ? -modulus / 2n : 0n, upper = sort.signed ? modulus / 2n - 1n : modulus - 1n;
        return { kind: 'Op', opcode: 'ite', sort: 'Bool', args: [
          { kind: 'Op', opcode: 'zLt', sort: 'Bool', args: [mathematical, { kind: 'Constant', sort: 'Z', value: lower.toString() }] },
          bool(true), { kind: 'Op', opcode: 'zGt', sort: 'Bool', args: [mathematical, { kind: 'Constant', sort: 'Z', value: upper.toString() }] }] };
      };
      const arithmeticOverflow = checkedContext && !boolean && ['+', '-', '*'].includes(operation)
        ? overflowRange({ kind: 'Op', opcode: operatorTerm.opcode, sort: 'Z', args: promoted.map(value =>
          ({ kind: 'Op', opcode: 'bvToZ', sort: 'Z', args: [value.term] })) }, selected.resultType) : null;
      const conversionRange = checkedContext && resultConversion.kind === 'explicitIntegral'
        ? overflowRange({ kind: 'Op', opcode: 'bvToZ', sort: 'Z', args: [operatorTerm] }, row.type) : null;
      const narrowingOverflow = conversionRange && (arithmeticOverflow
        ? choose(arithmeticOverflow, bool(false), conversionRange) : conversionRange);
      const instruction = emit('compoundWrite', syntax, row.type, { location: row.location,
        savedLeft: left.instruction, left: promoted[0].instruction, right: promoted[1].instruction,
        operatorOccurrence: selected.operatorOccurrence, resultType: selected.resultType,
        resultConversion, selected: selected.intrinsic, term,
        ...(arithmeticOverflow ? { arithmeticOverflow } : {}), ...(narrowingOverflow ? { narrowingOverflow } : {}) });
      for (const condition of [arithmeticOverflow, narrowingOverflow]) {
        counter.charge('maxInvariantSteps', 'original-compound-failure-site');
        if (condition) retainOriginalException({ ordinal: exceptionalCompletions.length, instruction: instruction.id,
          category: 'System.OverflowException', condition, store: storageSnapshot() }, syntax);
      }
      row.term = term; row.lastWrite = instruction.id; instruction.postStore = storageSnapshot();
      return { type: row.type, term, instruction: instruction.id };
    }
    if (syntax.kind === 'assignment' && syntax.operation === '=' && syntax.left.kind === 'name') {
      const lookup = names.lookup(syntax.left.name, syntax.left);
      if (lookup.kind !== 'declaration') deny('INCOMPLETE_BODY', 'assignment requires a genuine scalar local or formal location', syntax.origin);
      const row = locations.get(locationKey(lookup.declarations[0]));
      if (!row) deny('INCOMPLETE_BODY', 'assignment target needs its actual member/alias/lvalue transfer', syntax.origin);
      if (integralConstants.has(canonicalData(lookup.declarations[0])) || booleanConstants.has(canonicalData(lookup.declarations[0])))
        deny('INVALID_BINDING', 'assignment cannot mutate an original constant local', syntax.origin);
      const value = convert(child(syntax.right), row.type, syntax.right);
      const instruction = emit('write', syntax, row.type, { location: row.location, input: value.instruction, term: value.term });
      row.defined = true; row.term = value.term; row.lastWrite = instruction.id;
      instruction.postStore = storageSnapshot();
      return { type: row.type, term: row.term, instruction: instruction.id };
    }
    if (['unary', 'postfix'].includes(syntax.kind) && ['++', '--'].includes(syntax.operation)) {
      if (syntax.operand.kind !== 'name' || typeof checkedContext !== 'boolean')
        deny('INCOMPLETE_BODY', 'update requires its original checked/general lvalue transfer', syntax.origin);
      const lookup = names.lookup(syntax.operand.name, syntax.operand);
      if (lookup.kind !== 'declaration') deny('INCOMPLETE_BODY', 'update requires unique original lexical storage');
      const key = canonicalData(lookup.declarations[0]), row = locations.get(locationKey(lookup.declarations[0]));
      if (!row || !row.defined) deny('INVALID_BINDING', 'update reads an unassigned original location');
      if (integralConstants.has(key) || booleanConstants.has(key)) deny('INVALID_BINDING', 'update cannot mutate a constant');
      const sort = selectedScalarSort(row.type);
      if (sort?.kind !== 'BV') deny('INCOMPLETE_BODY', 'update requires another original operator domain');
      const value = child(syntax.operand);
      const selected = bindSelectedPredefinedOperator(syntax, [{ ...value, direction: 'value', name: null,
        origin: syntax.operand.origin }], { ...environment, typeIndex: compilation.index,
        decodedUnits: compilation.decodedUnits, checkedArithmeticContext: checkedContext }, context);
      if (selected.semantics.kind !== 'numericUpdate' || !sameSelectedType(selected.resultType, row.type) ||
          !sameSelectedType(selected.candidate.parameters[0].type, row.type))
        deny('INVALID_BINDING', 'original integral update selected another storage/operator signature');
      const written = { kind: 'Op', opcode: syntax.operation === '++' ? 'add' : 'sub', sort,
        args: [value.term, { kind: 'Constant', sort, value: '1' }] };
      const term = syntax.kind === 'postfix' ? value.term : written;
      let overflow;
      if (checkedContext) {
        const modulus = 1n << BigInt(sort.width);
        const lower = sort.signed ? -modulus / 2n : 0n, upper = sort.signed ? modulus / 2n - 1n : modulus - 1n;
        const mathematical = { kind: 'Op', opcode: written.opcode, sort: 'Z', args: [
          { kind: 'Op', opcode: 'bvToZ', sort: 'Z', args: [value.term] }, { kind: 'Constant', sort: 'Z', value: '1' }] };
        overflow = { kind: 'Op', opcode: 'ite', sort: 'Bool', args: [
          { kind: 'Op', opcode: 'zLt', sort: 'Bool', args: [mathematical, { kind: 'Constant', sort: 'Z', value: lower.toString() }] },
          { kind: 'Constant', sort: 'Bool', value: true },
          { kind: 'Op', opcode: 'zGt', sort: 'Bool', args: [mathematical, { kind: 'Constant', sort: 'Z', value: upper.toString() }] }] };
      }
      const instruction = emit('update', syntax, row.type, { location: row.location,
        input: value.instruction, operatorOccurrence: syntax.operatorToken.origin, selected: selected.intrinsic, written, term,
        ...(checkedContext ? { overflow } : {}) });
      if (checkedContext) {
        counter.charge('maxInvariantSteps', 'original-checked-update-exception');
        retainOriginalException({ ordinal: exceptionalCompletions.length, instruction: instruction.id,
          category: 'System.OverflowException', condition: overflow, store: storageSnapshot() }, syntax);
      }
      row.term = written; row.lastWrite = instruction.id;
      instruction.postStore = storageSnapshot();
      return { type: row.type, term, instruction: instruction.id };
    }
    if (syntax.kind === 'cast') {
      const value = child(syntax.operand), type = compilation.index.resolve(syntax.type, context);
      const integral = type => type.category === 'primitive' &&
        ['sbyte', 'byte', 'short', 'ushort', 'char', 'int', 'uint', 'long', 'ulong'].includes(type.name);
      if (!integral(value.type) || !integral(type) || typeof checkedContext !== 'boolean')
        deny('INCOMPLETE_BODY', 'cast requires its complete checked/reference/nullable/other numeric transfer', syntax.origin);
      const sort = selectedScalarSort(type), term = { kind: 'Op', opcode: 'cast', sort, args: [value.term] };
      const modulus = 1n << BigInt(sort.width);
      const lower = sort.signed ? -modulus / 2n : 0n, upper = sort.signed ? modulus / 2n - 1n : modulus - 1n;
      let overflow;
      if (checkedContext) {
        if (typeof value.constant === 'bigint' && (value.constant < lower || value.constant > upper))
          deny('INVALID_BINDING', 'checked original constant integral conversion overflows', syntax.origin);
        const mathematical = { kind: 'Op', opcode: 'bvToZ', sort: 'Z', args: [value.term] };
        overflow = { kind: 'Op', opcode: 'ite', sort: 'Bool', args: [
          { kind: 'Op', opcode: 'zLt', sort: 'Bool', args: [mathematical, { kind: 'Constant', sort: 'Z', value: lower.toString() }] },
          { kind: 'Constant', sort: 'Bool', value: true },
          { kind: 'Op', opcode: 'zGt', sort: 'Bool', args: [mathematical, { kind: 'Constant', sort: 'Z', value: upper.toString() }] }] };
      }
      const instruction = emit('explicitCast', syntax, type, { input: value.instruction,
        conversion: { kind: 'explicitIntegral', source: value.type.name, target: type.name, checkedContext }, term,
        ...(checkedContext ? { overflow } : {}) });
      if (checkedContext) {
        counter.charge('maxInvariantSteps', 'original-checked-cast-exception');
        retainOriginalException({ ordinal: exceptionalCompletions.length, instruction: instruction.id,
          category: 'System.OverflowException', condition: overflow, store: storageSnapshot() }, syntax);
      }
      let constant;
      if (typeof value.constant === 'bigint') {
        const unsigned = value.constant & (modulus - 1n);
        constant = sort.signed && unsigned >= modulus / 2n ? unsigned - modulus : unsigned;
      }
      return { type, term, instruction: instruction.id, ...(constant === undefined ? {} : { constant }) };
    }
    if (['unary', 'binary'].includes(syntax.kind)) {
      const actualNodes = syntax.kind === 'unary' ? [syntax.operand] : [syntax.left, syntax.right];
      if (['&&', '||'].includes(syntax.operation)) deny('INCOMPLETE_BODY', 'short-circuit requires reached child CFG partitions', syntax.origin);
      const values = actualNodes.map(child);
      if (syntax.kind === 'unary' && syntax.operation === '-' && syntax.operand.kind === 'literal') {
        const suffix = /[uUlL]+$/u.exec(syntax.operand.token.spelling)?.[0].toLowerCase() ?? '';
        if (values[0].type.name === 'uint' && values[0].constant === 2147483648n && suffix === '' ||
            values[0].type.name === 'ulong' && values[0].constant === 9223372036854775808n && ['', 'l'].includes(suffix))
          deny('INCOMPLETE_BODY', 'nondecimal minimum requires its independently bound literal-prefix profile', syntax.origin);
      }
      const selected = bindSelectedPredefinedOperator(syntax, values.map((value, ordinal) => ({ ...value,
        direction: 'value', name: null, origin: actualNodes[ordinal].origin })),
        { ...environment, typeIndex: compilation.index, decodedUnits: compilation.decodedUnits,
          checkedArithmeticContext: checkedContext }, context);
      if (['booleanNot', 'booleanLogic', 'booleanEquality'].includes(selected.semantics.kind)) {
        const boolean = value => ({ kind: 'Constant', sort: 'Bool', value });
        const choose = (test, whenTrue, whenFalse) => ({ kind: 'Op', opcode: 'ite', sort: 'Bool', args: [test, whenTrue, whenFalse] });
        const [left, right] = values.map(value => value.term);
        const term = syntax.operation === '!' ? choose(left, boolean(false), boolean(true)) :
          syntax.operation === '&' ? choose(left, right, boolean(false)) :
          syntax.operation === '|' ? choose(left, boolean(true), right) :
          ['^', '!='].includes(syntax.operation) ? choose(left, choose(right, boolean(false), boolean(true)), right) :
          syntax.operation === '==' ? choose(left, right, choose(right, boolean(false), boolean(true))) : null;
        if (!term) deny('INCOMPLETE_BODY', 'Boolean operator requires its actual short-circuit/equality transfer', syntax.origin);
        const instruction = emit('boolean', syntax, selected.resultType, { operatorOccurrence: selected.operatorOccurrence,
          selected: selected.intrinsic, inputs: values.map(value => value.instruction), term });
        let constant;
        if (values.every(value => typeof value.constant === 'boolean')) {
          const [left, right] = values.map(value => value.constant);
          constant = syntax.operation === '!' ? !left : syntax.operation === '&' ? left && right :
            syntax.operation === '|' ? left || right : syntax.operation === '==' ? left === right : left !== right;
        }
        return { type: selected.resultType, term, instruction: instruction.id,
          ...(constant === undefined ? {} : { constant }) };
      }
      const shift = ['<<', '>>'].includes(syntax.operation);
      const bitwise = ['&', '|', '^', '~'].includes(syntax.operation);
      const comparisonOpcode = { '==': 'bvEq', '!=': 'bvNe', '<': 'bvLt', '<=': 'bvLe', '>': 'bvGt', '>=': 'bvGe' }[syntax.operation];
      if (comparisonOpcode && selected.semantics.kind === 'numeric' &&
          ['int', 'uint', 'long', 'ulong'].includes(selected.semantics.arithmeticType) && typeof checkedContext === 'boolean') {
        const operands = values.map((value, ordinal) => convert(value, selected.targets[ordinal], actualNodes[ordinal]));
        const term = { kind: 'Op', opcode: comparisonOpcode, sort: 'Bool', args: operands.map(value => value.term) };
        const instruction = emit('integralComparison', syntax, selected.resultType, {
          operatorOccurrence: selected.operatorOccurrence, selected: selected.intrinsic,
          inputs: operands.map(value => value.instruction), term });
        let constant;
        if (operands.every(value => typeof value.constant === 'bigint')) {
          constant = foldBitvectorComparison(comparisonOpcode, selectedScalarSort(operands[0].type),
            operands.map(value => value.constant.toString()));
        }
        return { type: selected.resultType, term, instruction: instruction.id,
          ...(constant === undefined ? {} : { constant }) };
      }
      if (selected.semantics.kind !== 'numeric' || !['int', 'uint', 'long', 'ulong'].includes(selected.semantics.arithmeticType) ||
          typeof checkedContext !== 'boolean' || ['/', '%', '==', '!=', '<', '>', '<=', '>='].includes(syntax.operation))
        deny('INCOMPLETE_BODY', 'operator requires its complete exceptional/nullable/Boolean/domain CFG', syntax.origin);
      const operands = values.map((value, ordinal) => convert(value, selected.targets[ordinal], actualNodes[ordinal]));
      const opcode = { '+': syntax.kind === 'unary' ? 'cast' : 'add', '-': syntax.kind === 'unary' ? 'neg' : 'sub',
        '*': 'mul', '&': 'bitand', '|': 'bitor', '^': 'bitxor', '~': 'bitnot', '<<': 'shl', '>>': 'shr' }[syntax.operation];
      if (!opcode) deny('INCOMPLETE_BODY', 'operator still requires its exact shift/lvalue transfer', syntax.origin);
      const args = operands.map(value => value.term);
      const countMask = ['long', 'ulong'].includes(selected.resultType.name) ? 63n : 31n;
      if (shift) args[1] = { kind: 'Op', opcode: 'cast', sort: 'Z', args: [
        { kind: 'Op', opcode: 'bitand', sort: selectedScalarSort(operands[1].type), args: [args[1],
          { kind: 'Constant', sort: selectedScalarSort(operands[1].type), value: countMask.toString() }] }] };
      const term = { kind: 'Op', opcode, sort: selectedScalarSort(selected.resultType), args };
      const guarded = checkedContext === true && !shift && !bitwise && opcode !== 'cast';
      let overflow;
      if (guarded) {
        const sort = term.sort, modulus = 1n << BigInt(sort.width);
        const lower = sort.signed ? -modulus / 2n : 0n, upper = sort.signed ? modulus / 2n - 1n : modulus - 1n;
        const mathematical = { kind: 'Op', opcode, sort: 'Z', args: args.map(value =>
          ({ kind: 'Op', opcode: 'bvToZ', sort: 'Z', args: [value] })) };
        overflow = { kind: 'Op', opcode: 'ite', sort: 'Bool', args: [
          { kind: 'Op', opcode: 'zLt', sort: 'Bool', args: [mathematical, { kind: 'Constant', sort: 'Z', value: lower.toString() }] },
          { kind: 'Constant', sort: 'Bool', value: true },
          { kind: 'Op', opcode: 'zGt', sort: 'Bool', args: [mathematical, { kind: 'Constant', sort: 'Z', value: upper.toString() }] }] };
      }
      const instruction = emit('numeric', syntax, selected.resultType,
        { operatorOccurrence: selected.operatorOccurrence, selected: selected.intrinsic, inputs: operands.map(value => value.instruction), term,
          ...(guarded ? { overflow } : {}) });
      if (guarded) {
        counter.charge('maxInvariantSteps', 'original-checked-exception-completion');
        retainOriginalException({ ordinal: exceptionalCompletions.length, instruction: instruction.id, category: 'System.OverflowException',
          condition: overflow, store: storageSnapshot() }, syntax);
      }
      // Only genuine original constant-expression children carry this value.
      // A definitely known mutable local is not a C# constant expression.
      let constant;
      if (operands.every(value => typeof value.constant === 'bigint')) {
        if (opcode === 'cast') constant = operands[0].constant;
        else {
          const constants = operands.map(value => value.constant);
          if (shift) constants[1] &= countMask;
          const folded = foldBitvector(opcode, term.sort, constants.map(value => value.toString()));
          if (guarded && folded.overflow) deny('INVALID_BINDING', 'checked original constant expression overflows', syntax.origin);
          if (folded.alternative !== 'normal') deny('INCOMPLETE_BODY', 'constant needs its original exceptional transfer', syntax.origin);
          constant = BigInt(folded.value);
        }
      }
      return { type: selected.resultType, term, instruction: instruction.id,
        ...(constant === undefined ? {} : { constant }) };
    }
    deny('INCOMPLETE_BODY', `selected body expression ${syntax.kind} requires its full transfer`, syntax.origin);
  };
  const lexicalScopes = [];
  let deferredReturn = null;
  const retainedExceptionFrontiers = new Map();
  const retainOriginalException = (failure, syntax) => {
    counter.charge('maxInvariantSteps', 'original-raw-exception-frontier');
    exceptionalCompletions.push(failure);
    const scopes = [];
    for (let index = 0; index < lexicalScopes.length; index++) {
      counter.charge('maxInvariantSteps', 'original-exception-scope-prefix');
      const scope = lexicalScopes[index], locals = [];
      for (const local of scope.locals) {
        counter.charge('maxInvariantSteps', 'original-exception-allocation-prefix');
        const key = locationKey(local.declId);
        if (locations.has(key) && !endedLocations.has(key)) locals.push({ syntax: local, key });
      }
      scopes.push({ block: scope.block, locals });
    }
    const frontier = { tail: failure.instruction, kind: 'throw', store: captureStore(), scopes,
      scopeDepth: deferredReturn?.scopeDepth ?? 0, frame: deferredReturn, exception: failure, syntax };
    retainedExceptionFrontiers.set(failure.ordinal, frontier);
    if (deferredReturn) {
      counter.charge('maxInvariantSteps', 'original-owning-try-exception-frontier');
      deferredReturn.exceptions.push(frontier);
    }
  };
  const retainReturnFrontier = (frame, pending) => {
    counter.charge('maxInvariantSteps', 'original-return-completion-frontier');
    frame.frontiers.push({ tail: previous, kind: pending.operation === 'pendingReturnVoid' ? 'returnVoid' : 'return',
      scopeDepth: frame.scopeDepth, store: captureStore(), pending });
  };
  const endScopeLocals = (scope, exceptional = false) => {
    for (let ordinal = scope.locals.length - 1; ordinal >= 0; ordinal--) {
      counter.charge('maxInvariantSteps', 'original-crossed-local-lifetime');
      const local = exceptional ? scope.locals[ordinal].syntax : scope.locals[ordinal];
      const key = exceptional ? scope.locals[ordinal].key : locationKey(local.declId), row = locations.get(key);
      if (!row || endedLocations.has(key)) deny('INVALID_BINDING', 'original local scope end lacks a unique allocation');
      if (exceptional && activeLocations.get(canonicalData(local.declId)) !== key)
        deny('INVALID_BINDING', 'exceptional local end differs from its retained active allocation');
      const instruction = emit('endLocal', local, row.type, { location: row.location, scopeOccurrence: scope.block.origin });
      row.defined = false; delete row.term; delete row.lastWrite;
      endedLocations.add(key); instruction.postStore = storageSnapshot();
      activeLocations.delete(canonicalData(local.declId));
    }
  };
  const endReturnScopes = () => {
    for (let index = lexicalScopes.length - 1; index >= 0; index--)
      endScopeLocals(lexicalScopes[index]);
    endFormalLocations();
  };
  const endFormalLocations = () => {
    for (let ordinal = signature.parameters.length - 1; ordinal >= 0; ordinal--) {
      const formal = signature.parameters[ordinal], key = canonicalData(formal.declaration);
      const original = compilation.byDeclaration.get(key), row = locations.get(key);
      if (!original || original.syntax.kind !== 'parameter' || !row || endedLocations.has(key))
        deny('INVALID_BINDING', 'scalar formal end lacks original parameter allocation');
      const instruction = emit('endParameter', original.syntax, row.type,
        { location: row.location, scopeOccurrence: entry.syntax.body.origin });
      row.defined = false; delete row.term; delete row.lastWrite;
      endedLocations.add(key); instruction.postStore = storageSnapshot();
      activeLocations.delete(canonicalData(formal.declaration));
    }
  };
  const enterExceptionFrontier = frontier => {
    previous = frontier.tail; restoreStore(frontier.store);
    if (frontier.pending) return;
    counter.charge('maxInvariantSteps', 'original-pending-exception-frontier');
    if (retainedExceptionFrontiers.get(frontier.exception.ordinal) !== frontier ||
        exceptionTargets.has(frontier.exception.ordinal) || frontier.tail !== frontier.exception.instruction)
      deny('INVALID_BINDING', 'exception entry lacks its unique retained original failure');
    const pending = emit('pendingException', frontier.syntax, signature.returnType,
      { exception: frontier.exception.ordinal, sourceInstruction: frontier.exception.instruction });
    exceptionTargets.set(frontier.exception.ordinal, pending.id);
    edges.at(-1).completion = 'throw';
    edges.at(-1).branch = { source: frontier.exception.instruction, outcome: { exception: frontier.exception.ordinal } };
    for (let index = frontier.scopes.length - 1; index >= frontier.scopeDepth; index--) {
      counter.charge('maxInvariantSteps', 'original-exception-crossed-scope');
      endScopeLocals(frontier.scopes[index], true);
    }
  };
  const statements = (block, checkedContext, depth = 0) => {
    if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'body statement depth exhausted', block.origin);
    const directLocals = [];
    const scope = { block, locals: directLocals };
    if (block.kind === 'block') lexicalScopes.push(scope);
    for (const syntax of block.kind === 'block' ? block.statements : [block]) {
      if (returned) deny('INCOMPLETE_BODY', 'unreachable statement requires explicit complete source accounting', syntax.origin);
      if (syntax.kind === 'block') { statements(syntax, checkedContext, depth + 1); continue; }
      if (syntax.kind === 'empty') { emit('empty', syntax, signature.returnType); continue; }
      if (syntax.kind === 'arithmeticBlock') {
        const word = syntax.checked ? 'checked' : 'unchecked', start = syntax.origin.utf16[0];
        if (decoded.text.slice(start, start + word.length) !== word) deny('INVALID_BINDING', 'arithmetic block differs from original bytes');
        statements(syntax.body, syntax.checked, depth + 1); continue;
      }
      if (syntax.kind === 'try') {
        if (syntax.catches.length || !syntax.finalizer)
          deny('INCOMPLETE_BODY', 'try requires its original catch completion dispatch', syntax.origin);
        const returnStart = earlyReturns.length;
        emit('tryEnter', syntax, signature.returnType);
        const outerReturn = deferredReturn, completion = { scopeDepth: lexicalScopes.length, frontiers: [], exceptions: [] };
        deferredReturn = completion;
        try { statements(syntax.body, checkedContext, depth + 1); }
        finally { deferredReturn = outerReturn; }
        if (earlyReturns.length !== returnStart)
          deny('INCOMPLETE_BODY', 'abrupt try completion requires its actual finalizer continuation', syntax.origin);
        const incomingFrontiers = [];
        for (const frontier of completion.exceptions) {
          counter.charge('maxInvariantSteps', 'original-try-exception-dispatch-frontier');
          incomingFrontiers.push(frontier);
        }
        for (const frontier of completion.frontiers) {
          counter.charge('maxInvariantSteps', 'original-try-return-dispatch-frontier');
          incomingFrontiers.push(frontier);
        }
        completion.frontiers = incomingFrontiers;
        const hasNormal = !returned;
        if (hasNormal) {
          counter.charge('maxInvariantSteps', 'original-normal-completion-frontier');
          completion.frontiers.push({ tail: previous, kind: 'normal', scopeDepth: lexicalScopes.length, store: captureStore() });
        }
        if (!completion.frontiers.length) deny('INVALID_BINDING', 'try lacks its original reached completion frontier');
        for (let ordinal = 0; ordinal < completion.frontiers.length; ordinal++) {
          counter.charge('maxInvariantSteps', 'original-finalizer-completion-frontier');
          const frontier = completion.frontiers[ordinal];
          if (frontier.scopeDepth !== lexicalScopes.length)
            deny('INVALID_BINDING', 'completion frontier crosses another original lexical boundary');
          if (frontier.kind === 'throw') enterExceptionFrontier(frontier);
          else { previous = frontier.tail; restoreStore(frontier.store); }
          returned = false;
          counter.charge('maxInvariantSteps', 'original-finalizer-allocation-context');
          const incoming = previous, outerFinalizer = finalizerContext;
          const finalizerEntry = emit('finallyEnter', syntax.finalizer, signature.returnType, { incoming, outerFinalizer });
          finalizerContext = { entry: finalizerEntry.id, incoming, outer: outerFinalizer };
          try { statements(syntax.finalizer, checkedContext, depth + 1); }
          finally { finalizerContext = outerFinalizer; }
          if (returned)
            deny('INCOMPLETE_BODY', 'abrupt finalizer requires its actual replacement completion', syntax.origin);
          emit('finallyLeave', syntax, signature.returnType);
          if (frontier.kind === 'normal') continue;
          if (frontier.kind === 'throw') {
            if (outerReturn) {
              for (let index = lexicalScopes.length - 1; index >= outerReturn.scopeDepth; index--) {
                counter.charge('maxInvariantSteps', 'original-nested-exception-scope');
                endScopeLocals(lexicalScopes[index]);
              }
            } else endReturnScopes();
            const resumed = emit(outerReturn ? 'pendingException' : 'resumeException', frontier.syntax,
              signature.returnType, { exception: frontier.exception.ordinal, sourceInstruction: frontier.exception.instruction });
            if (outerReturn) {
              counter.charge('maxInvariantSteps', 'original-enclosing-exception-frontier');
              outerReturn.exceptions.push({ tail: resumed.id, kind: 'throw', store: captureStore(), scopes: [],
                scopeDepth: outerReturn.scopeDepth, frame: outerReturn, exception: frontier.exception,
                syntax: frontier.syntax, pending: true });
            } else if (ordinal + 1 < completion.frontiers.length) {
              counter.charge('maxInvariantSteps', 'original-finalized-exception-frontier');
              earlyThrows.push(resumed.id);
            }
            returned = true; continue;
          }
          const pending = frontier.pending;
          if (outerReturn) {
            for (let index = lexicalScopes.length - 1; index >= outerReturn.scopeDepth; index--) {
              counter.charge('maxInvariantSteps', 'original-nested-return-scope');
              endScopeLocals(lexicalScopes[index]);
            }
          } else endReturnScopes();
          emit(outerReturn ? pending.operation : frontier.kind, pending.syntax, signature.returnType,
            pending.operation === 'pendingReturnVoid' ? {} : { input: pending.input, term: pending.term });
          if (outerReturn) retainReturnFrontier(outerReturn, pending);
          else if (ordinal + 1 < completion.frontiers.length) {
            counter.charge('maxInvariantSteps', 'original-finalized-return-frontier');
            earlyReturns.push(previous);
          }
          returned = true;
        }
        returned = !hasNormal;
        continue;
      }
      if (syntax.kind === 'if') {
        const test = expression(syntax.test, checkedContext);
        if (test.type.category !== 'primitive' || test.type.name !== 'bool')
          deny('INCOMPLETE_BODY', 'if requires original Boolean condition conversion', syntax.origin);
        const branch = emit('statementBranch', syntax, test.type, { input: test.instruction, term: test.term });
        const incomingStore = captureStore();
        emit('statementArm', syntax, test.type, { branch: branch.id, outcome: true });
        edges.at(-1).branch = { source: branch.id, outcome: true };
        statements(syntax.body, checkedContext, depth + 1);
        const trueReturned = returned, trueTail = previous, trueStore = captureStore();
        previous = branch.id; returned = false; restoreStore(incomingStore);
        emit('statementArm', syntax, test.type, { branch: branch.id, outcome: false });
        edges.at(-1).branch = { source: branch.id, outcome: false };
        if (syntax.alternative) statements(syntax.alternative, checkedContext, depth + 1);
        const falseReturned = returned, falseTail = previous;
        if (trueReturned !== falseReturned) {
          const returnedTail = trueReturned ? trueTail : falseTail;
          const normalTail = trueReturned ? falseTail : trueTail;
          const normalStore = trueReturned ? captureStore() : trueStore;
          if (!deferredReturn) earlyReturns.push(returnedTail);
          previous = normalTail; returned = false; restoreStore(normalStore);
          emit('statementContinuation', syntax, test.type, { branch: branch.id, test: test.instruction,
            returnedTail, normalTail, returnedOutcome: trueReturned });
          continue;
        }
        if (trueReturned) {
          if (deferredReturn) { returned = true; continue; }
          const isVoid = signature.returnType.name === 'void';
          const term = isVoid ? null : { kind: 'Op', opcode: 'ite', sort: selectedScalarSort(signature.returnType),
            args: [test.term, nodes[trueTail].term, nodes[falseTail].term] };
          const join = emit(isVoid ? 'returnMergeVoid' : 'returnMerge', syntax, signature.returnType,
            { branch: branch.id, test: test.instruction, whenTrue: trueTail, whenFalse: falseTail,
              ...(isVoid ? {} : { term }) });
          edges.at(-1).completion = 'return';
          edges.push({ from: trueTail, to: join.id, completion: 'return', branch: null });
          joinStores(trueStore, captureStore(), test.term, join);
          returned = true; continue;
        }
        const join = emit('statementJoin', syntax, test.type, { branch: branch.id, test: test.instruction });
        edges.push({ from: trueTail, to: join.id, completion: 'normal', branch: null });
        joinStores(trueStore, captureStore(), test.term, join);
        continue;
      }
      if (syntax.kind === 'localDeclaration') {
        for (const local of syntax.declarations) {
          counter.charge('maxInvariantSteps', 'original-block-local-roster');
          directLocals.push(local);
          if (!local.initializer) {
            if (local.constant) deny('INVALID_BINDING', 'original constant local lacks its initializer', local.origin);
            if (local.type.kind === 'inferredType') deny('INVALID_BINDING', 'inferred local has no original initializer', local.origin);
            const type = compilation.index.resolve(local.type, { ...context, owner: local.declId });
            selectedScalarSort(type);
            const row = locate(local.declId, type);
            emit('declare', local, type, { location: row.location });
            continue;
          }
          const value = expression(local.initializer, checkedContext);
          const type = local.type.kind === 'inferredType' ? value.type : compilation.index.resolve(local.type, { ...context, owner: local.declId });
          const converted = convert(value, type, local.initializer), row = locate(local.declId, type);
          if (local.constant) {
            if (local.type.kind === 'inferredType' || !['bigint', 'boolean'].includes(typeof converted.constant))
              deny('INCOMPLETE_BODY', 'constant local requires another original constant value/type domain', local.origin);
            const constants = typeof converted.constant === 'boolean' ? booleanConstants : integralConstants;
            constants.set(canonicalData(local.declId), converted.constant);
          }
          const instruction = emit('write', local, type, { location: row.location, input: converted.instruction, term: converted.term });
          row.defined = true; row.term = converted.term; row.lastWrite = instruction.id;
          instruction.postStore = storageSnapshot();
        }
        continue;
      }
      if (syntax.kind === 'expressionStatement' && (['assignment', 'call'].includes(syntax.expression.kind) ||
          ['unary', 'postfix'].includes(syntax.expression.kind) && ['++', '--'].includes(syntax.expression.operation))) {
        expression(syntax.expression, checkedContext); continue;
      }
      if (syntax.kind === 'return' && !syntax.value) {
        if (signature.returnType.category !== 'primitive' || signature.returnType.name !== 'void')
          deny('INVALID_BINDING', 'value-returning original method cannot return without a value', syntax.origin);
        if (deferredReturn) {
          for (let index = lexicalScopes.length - 1; index >= deferredReturn.scopeDepth; index--) {
            counter.charge('maxInvariantSteps', 'original-pending-return-scope');
            endScopeLocals(lexicalScopes[index]);
          }
          emit('pendingReturnVoid', syntax, signature.returnType);
          retainReturnFrontier(deferredReturn, { operation: 'pendingReturnVoid', syntax });
        } else { endReturnScopes(); emit('returnVoid', syntax, signature.returnType); }
        returned = true; continue;
      }
      if (syntax.kind === 'return' && syntax.value) {
        if (signature.returnType.category === 'primitive' && signature.returnType.name === 'void')
          deny('INVALID_BINDING', 'Void method cannot return an original value expression', syntax.origin);
        const value = convert(expression(syntax.value, checkedContext), signature.returnType, syntax.value);
        if (deferredReturn) {
          for (let index = lexicalScopes.length - 1; index >= deferredReturn.scopeDepth; index--) {
            counter.charge('maxInvariantSteps', 'original-pending-return-scope');
            endScopeLocals(lexicalScopes[index]);
          }
          emit('pendingReturn', syntax, signature.returnType, { input: value.instruction, term: value.term });
          retainReturnFrontier(deferredReturn, { operation: 'pendingReturn', syntax, input: value.instruction, term: value.term });
        } else {
          endReturnScopes();
          emit('return', syntax, signature.returnType, { input: value.instruction, term: value.term });
        }
        returned = true; continue;
      }
      deny('INCOMPLETE_BODY', `selected body statement ${syntax.kind} requires its full CFG transfer`, syntax.origin);
    }
    if (block.kind === 'block' && !returned) endScopeLocals(scope);
    if (block.kind === 'block') lexicalScopes.pop();
  };
  statements(entry.syntax.body, undefined);
  if (!returned) {
    if (signature.returnType.category !== 'primitive' || signature.returnType.name !== 'void')
      deny('INCOMPLETE_BODY', 'value method normal fallthrough requires its complete reachability proof', entry.origin);
    endFormalLocations();
    emit('fallthrough', entry.syntax.body, signature.returnType);
  }
  const primaryCompletion = previous;
  const returnNode = returned && ['return', 'returnVoid', 'returnMerge', 'returnMergeVoid'].includes(nodes[primaryCompletion].operation)
    ? primaryCompletion : null;
  const methodExitFrontiers = [{ instruction: primaryCompletion,
    kind: nodes[primaryCompletion].operation === 'resumeException' ? 'throw' : returned ? 'return' : 'normal' }];
  for (const instruction of earlyReturns) {
    counter.charge('maxInvariantSteps', 'original-method-return-exit-frontier');
    methodExitFrontiers.push({ instruction, kind: 'return' });
  }
  for (const instruction of earlyThrows) {
    counter.charge('maxInvariantSteps', 'original-method-throw-exit-frontier');
    methodExitFrontiers.push({ instruction, kind: 'throw' });
  }
  for (const failure of exceptionalCompletions) {
    counter.charge('maxInvariantSteps', 'original-unhandled-exception-cleanup');
    if (exceptionTargets.has(failure.ordinal)) continue;
    const frontier = retainedExceptionFrontiers.get(failure.ordinal);
    if (!frontier || frontier.scopeDepth !== 0)
      deny('INVALID_BINDING', 'unhandled failure retains an undispatched owning try frame');
    enterExceptionFrontier(frontier);
    endFormalLocations();
    const terminal = emit('resumeException', frontier.syntax, signature.returnType,
      { exception: failure.ordinal, sourceInstruction: failure.instruction });
    methodExitFrontiers.push({ instruction: terminal.id, kind: 'throw' });
  }
  previous = null;
  const exit = emit('exit', entry.syntax.body, signature.returnType);
  for (const frontier of methodExitFrontiers) {
    counter.charge('maxInvariantSteps', 'original-method-completion-exit-edge');
    edges.push({ from: frontier.instruction, to: exit.id, completion: frontier.kind, branch: null });
  }
  const normalEdges = new Map();
  for (const edge of exceptionalCompletions.length ? edges : []) {
    counter.charge('maxInvariantSteps', 'original-checked-normal-edge-index');
    if (edge.completion === 'normal') normalEdges.set(edge.from, normalEdges.has(edge.from) ? null : edge);
  }
  for (const failure of exceptionalCompletions) {
    counter.charge('maxInvariantSteps', 'original-checked-exception-edge');
    const normal = normalEdges.get(failure.instruction);
    if (!normal || normal.branch !== null && !(normal.branch.source === failure.instruction && normal.branch.outcome === 'normal')) deny('INVALID_BINDING', 'checked operation lacks its unique normal successor');
    normal.branch = { source: failure.instruction, outcome: 'normal' };
    if (!exceptionTargets.has(failure.ordinal))
      deny('INVALID_BINDING', 'original failure lacks its unique exceptional cleanup entry');
  }
  const finalFrontiers = [];
  for (const node of nodes) {
    counter.charge('maxInvariantSteps', 'original-method-completion-frontier');
    if (['return', 'returnVoid', 'fallthrough'].includes(node.operation))
      finalFrontiers.push({ kind: node.operation === 'fallthrough' ? 'normal' : node.operation,
        instruction: node.id, store: node.postStore,
        ...(node.operation === 'return' ? { input: node.input, term: node.term } : {}) });
    if (node.operation === 'resumeException') {
      const failure = exceptionalCompletions[node.exception];
      if (!failure || failure.instruction !== node.sourceInstruction)
        deny('INVALID_BINDING', 'terminal exception loses its original source failure');
      finalFrontiers.push({ kind: 'throw', instruction: node.id, sourceInstruction: failure.instruction,
        exception: failure.ordinal, condition: { kind: 'Constant', sort: 'Bool', value: true }, store: node.postStore });
    }
  }
  for (const failure of exceptionalCompletions) {
    counter.charge('maxInvariantSteps', 'original-method-exception-frontier');
    const frontier = retainedExceptionFrontiers.get(failure.ordinal);
    if (!frontier || frontier.exception !== failure || frontier.tail !== failure.instruction)
      deny('INVALID_BINDING', 'method throw loses its original retained failure frontier');
    if (!exceptionTargets.has(failure.ordinal))
      deny('INVALID_BINDING', 'raw original was not consumed by exceptional completion routing');
  }
  return { phase: 'scalarBody', sourceAdmission: false, completeBodyBinding: false,
    declaration, binder, slots, locations: [...locations.values()], nodes, edges, exceptionalCompletions, finalFrontiers,
    entry: 0, exit: exit.id, returnNode };
}

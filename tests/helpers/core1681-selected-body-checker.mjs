import { deny, exactKeys } from './core1681-source-input.mjs';
import { canonicalData, K2_LIMITS, checkProofData, checkTerm, termSort } from './core1681-proof-terms.mjs';
import { checkedOriginalLiteral, checkedCsharpUnaryLiteral } from './core1681-selected-literals.mjs';
import { sameSelectedType } from './core1681-selected-conversions.mjs';
import { rebindSelectedCompilationForProof } from './core1681-selected-compilation.mjs';

function checkedCalleeExceptions(body, substitute, counter) {
  counter.charge('maxInvariantSteps', 'K2-original-call-exception-reach');
  if (body.exceptionalCompletions.length === 0) return [];
  const yes = { kind: 'Constant', sort: 'Bool', value: true }, no = { ...yes, value: false };
  const choose = (test, whenTrue, whenFalse) => {
    counter.charge('maxInvariantSteps', 'K2-original-call-reach-join');
    if (test.kind === 'Constant') return test.value ? whenTrue : whenFalse;
    return { kind: 'Op', opcode: 'ite', sort: 'Bool', args: [test, whenTrue, whenFalse] };
  };
  const outgoing = new Map(), failures = new Map(), reach = new Map([[body.entry, yes]]);
  for (const row of body.exceptionalCompletions) {
    counter.charge('maxInvariantSteps', 'K2-original-call-exception-index');
    if (!failures.has(row.instruction)) failures.set(row.instruction, []);
    failures.get(row.instruction).push(row);
  }
  for (const edge of body.edges) {
    counter.charge('maxInvariantSteps', 'K2-original-call-reach-edge-index');
    if (edge.to <= edge.from) deny('INCOMPLETE_PROOF', 'call requires its actual cyclic completion contract');
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    if (edge.completion !== 'throw' || edge.to !== body.exit) outgoing.get(edge.from).push(edge);
  }
  for (const node of body.nodes) {
    counter.charge('maxInvariantSteps', 'K2-original-call-reach-node');
    const reached = reach.get(node.id) ?? no;
    for (const edge of outgoing.get(node.id) ?? []) {
      counter.charge('maxInvariantSteps', 'K2-original-call-reach-edge');
      if (edge.completion === 'throw' && edge.branch === null)
        deny('INVALID_PROOF', 'internal checked throw edge lacks its original exceptional branch');
      let guard = yes;
      if (edge.branch !== null) {
        if (edge.branch.source !== node.id) deny('INVALID_PROOF', 'call edge lost its actual condition source');
        if (edge.completion === 'throw') {
          const row = body.exceptionalCompletions[edge.branch.outcome?.exception];
          if (!row || row.instruction !== node.id) deny('INVALID_PROOF', 'internal checked throw edge loses its original failure predicate');
          guard = row.condition;
        } else if (typeof edge.branch.outcome === 'boolean') guard = edge.branch.outcome ? node.term : choose(node.term, no, yes);
        else if (edge.branch.outcome === 'normal' && failures.has(node.id)) {
          let anyFailure = no;
          for (const row of failures.get(node.id)) {
            counter.charge('maxInvariantSteps', 'K2-original-call-normal-failure');
            anyFailure = choose(anyFailure, yes, row.condition);
          }
          guard = choose(anyFailure, no, yes);
        } else deny('INCOMPLETE_PROOF', 'call requires another original completion guard');
      }
      const incoming = choose(reached, guard, no);
      reach.set(edge.to, choose(reach.get(edge.to) ?? no, yes, incoming));
    }
  }
  const results = [];
  for (const frontier of body.finalFrontiers) {
    counter.charge('maxInvariantSteps', 'K2-original-call-exception-substitution');
    if (frontier.kind !== 'throw') continue;
    const row = body.exceptionalCompletions[frontier.exception];
    if (!row || row.instruction !== frontier.sourceInstruction)
      deny('INVALID_PROOF', 'checked callee frontier loses its original exceptional alternative');
    results.push({ calleeOrdinal: row.ordinal, calleeInstruction: frontier.instruction, category: row.category,
      condition: substitute(choose(reach.get(frontier.instruction) ?? no, frontier.condition, no)) });
  }
  return results;
}

function checkOriginalBooleanTruth(operation, inputs, conclusion, binder, slots, counter, originalPredicates) {
  const atoms = new Map(), visited = new WeakSet();
  const inspect = (term, depth = 0) => {
    counter.charge('maxInvariantSteps', 'K2-Boolean-atom');
    if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'Boolean DAG depth exhausted');
    if (!term || typeof term !== 'object' || term.sort !== 'Bool') deny('INVALID_PROOF', 'Boolean DAG has an untyped term');
    if (visited.has(term)) return;
    visited.add(term);
    if (term.kind === 'Constant') {
      exactKeys(term, ['kind', 'sort', 'value'], 'Boolean constant');
      if (typeof term.value !== 'boolean') deny('INVALID_PROOF', 'Boolean constant is not true or false');
    } else if (term.kind === 'Bound') {
      exactKeys(term, ['kind', 'sort', 'binder', 'index'], 'Boolean formal atom');
      if (canonicalData(term.binder) !== canonicalData(binder) || !Number.isSafeInteger(term.index) ||
          term.index < 0 || term.index >= slots.length || slots[term.index].sort !== 'Bool')
        deny('INVALID_PROOF', 'Boolean atom lacks its original typed formal provenance');
      atoms.set(`formal:${term.index}`, term);
    } else if (term.kind === 'Op') {
      exactKeys(term, ['kind', 'opcode', 'sort', 'args'], 'Boolean DAG operation');
      if (['bvEq', 'bvNe', 'bvLt', 'bvLe', 'bvGt', 'bvGe'].includes(term.opcode)) {
        const key = canonicalData(term);
        if (!originalPredicates.has(key)) deny('INVALID_PROOF', 'comparison atom lacks an earlier independently checked original equation');
        atoms.set(`predicate:${key}`, term);
      } else {
        if (term.opcode !== 'ite' || !Array.isArray(term.args) || term.args.length !== 3) deny('INCOMPLETE_PROOF', 'Boolean DAG needs another checked constructor');
        for (const child of term.args) inspect(child, depth + 1);
      }
    } else deny('INCOMPLETE_PROOF', 'Boolean atom requires an independently bound predicate provenance');
  };
  for (const input of inputs) inspect(input);
  inspect(conclusion);
  const ordered = [...atoms.keys()].sort();
  // Exhaustion is explicit; no sampled truth rows or dropped atom alternatives.
  if (ordered.length > 16 || 2 ** ordered.length > K2_LIMITS.maxBranchLeaves)
    deny('EXHAUSTED', 'complete original Boolean leaf enumeration exhausted');
  const evaluate = (term, values, depth = 0) => {
    counter.charge('maxInvariantSteps', 'K2-Boolean-leaf-transfer');
    if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'Boolean evaluation depth exhausted');
    if (term.kind === 'Constant') return term.value;
    if (term.kind === 'Bound') return values.get(`formal:${term.index}`);
    if (term.opcode !== 'ite') return values.get(`predicate:${canonicalData(term)}`);
    return evaluate(term.args[evaluate(term.args[0], values, depth + 1) ? 1 : 2], values, depth + 1);
  };
  const leaves = 2 ** ordered.length;
  for (let leaf = 0; leaf < leaves; leaf++) {
    counter.charge('maxBranchLeaves', 'K2-original-Boolean-leaf');
    const values = new Map(ordered.map((index, ordinal) => [index, Boolean(leaf & 2 ** ordinal)]));
    const [left, right] = inputs.map(term => evaluate(term, values));
    const required = operation === '!' ? !left : ['&', '&&'].includes(operation) ? left && right :
      ['|', '||'].includes(operation) ? left || right : operation === '==' ? left === right : left !== right;
    if (evaluate(conclusion, values) !== required) deny('INVALID_PROOF', 'Boolean conclusion fails an original consistent leaf');
  }
  return leaves;
}

// Independent scalar KREAD/KWRITE/KLITERAL and reached store/value join checks.
// No programme admission follows: complete location aliases/owner frames,
// mixed abrupt/exception CFG, method-frame lifetime, calls, macros and every selected body remain required.
export function checkSelectedScalarBody(compilation, body, counter) {
  return checkScalarBody(compilation, body, counter, new Set());
}
function checkScalarBody(compilation, body, counter, ancestors) {
  checkProofData(body, counter);
  exactKeys(body, ['phase', 'sourceAdmission', 'completeBodyBinding', 'declaration', 'binder', 'slots', 'locations',
    'nodes', 'edges', 'exceptionalCompletions', 'finalFrontiers', 'entry', 'exit', 'returnNode'], 'scalar body proof input');
  compilation = rebindSelectedCompilationForProof(compilation, counter);
  const original = compilation.originals.find(unit => unit.unit === body.declaration.unit);
  const method = compilation.byDeclaration.get(canonicalData(body.declaration));
  const signature = compilation.bound.declarationMetadata.get(canonicalData(body.declaration));
  if (!original || method?.syntax.kind !== 'method' || !signature)
    deny('INVALID_PROOF', 'scalar proof lacks its original method and signature');
  const declarationKey = canonicalData(body.declaration);
  if (ancestors.has(declarationKey)) deny('INCOMPLETE_PROOF', 'recursive call requires its original recursive effect contract');
  if (ancestors.size >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'original checked callee depth exhausted');
  const descendants = new Set(ancestors); descendants.add(declarationKey);
  const originalCall = syntax => {
    if (syntax.kind !== 'call' || syntax.target.kind !== 'name' ||
        syntax.arguments.some(argument => argument.direction !== 'value'))
      deny('INCOMPLETE_PROOF', 'call requires complete original receiver/ref-out transfer');
    const lookup = compilation.names.get(original.unit).lookup(syntax.target.name, syntax.target);
    if (!['declaration', 'declarationGroup'].includes(lookup.kind) || lookup.declarations.length !== 1)
      deny('INCOMPLETE_PROOF', 'call requires complete original member/overload dispatch');
    const candidate = compilation.bound.declarationMetadata.get(canonicalData(lookup.declarations[0]));
    if (!candidate || candidate.category !== 'method' || !candidate.static || candidate.genericArity !== 0 ||
        candidate.parameters.length < syntax.arguments.length || candidate.parameters.some(formal =>
          formal.direction !== 'value' || formal.variadic || formal.defaultSyntax !== null &&
          !(formal.defaultSyntax.kind === 'literal' || formal.defaultSyntax.kind === 'unary' &&
            ['+', '-'].includes(formal.defaultSyntax.operation) && formal.defaultSyntax.operand.kind === 'literal')))
      deny('INCOMPLETE_PROOF', 'call requires complete original instance/generic/default/params effect');
    for (const member of compilation.bound.declarationMetadata.values()) {
      counter.charge('maxInvariantSteps', 'K2-original-call-type-initialization');
      if (member.category === 'constructor' && member.static && member.declaringType &&
          sameSelectedType(member.declaringType, candidate.declaringType))
        deny('INCOMPLETE_PROOF', 'call requires actual source type-initialization effects');
    }
    return candidate;
  };
  const originalFormalOrder = (syntax, candidate) => {
    const used = new Set(), order = []; let namedSeen = false;
    for (let sourceIndex = 0; sourceIndex < syntax.arguments.length; sourceIndex++) {
      counter.charge('maxInvariantSteps', 'K2-original-call-formal-order');
      const argument = syntax.arguments[sourceIndex];
      let formalIndex = sourceIndex;
      if (argument.name !== null) {
        namedSeen = true;
        formalIndex = candidate.parameters.findIndex(formal => formal.name === argument.name.spelling);
      } else if (namedSeen) deny('INVALID_PROOF', 'selected C#5 call has positional argument after named argument');
      if (formalIndex < 0 || formalIndex >= candidate.parameters.length || used.has(formalIndex))
        deny('INVALID_PROOF', 'call has unknown or repeated original formal name');
      used.add(formalIndex); order.push(formalIndex);
    }
    for (let formalIndex = 0; formalIndex < candidate.parameters.length; formalIndex++) {
      counter.charge('maxInvariantSteps', 'K2-original-call-omitted-formal');
      if (!used.has(formalIndex) && candidate.parameters[formalIndex].defaultSyntax === null)
        deny('INVALID_PROOF', 'call omits required original formal');
    }
    return order;
  };
  // Reconstruct the required instruction roster from original syntax, rather
  // than trusting a producer-supplied operation discriminator or reached list.
  const originalStorageTypes = new Map(signature.parameters.map(formal => [canonicalData(formal.declaration), formal.type]));
  const originalIntegralConstants = new Map();
  const originalBooleanConstants = new Map();
  const originalPredicates = new Set();
  const scalarAliases = { Int32: 'int', UInt32: 'uint', Int64: 'long', UInt64: 'ulong', Char: 'char', Boolean: 'bool',
    Single: 'float', Double: 'double', Decimal: 'decimal' };
  const integralNames = ['sbyte', 'byte', 'short', 'ushort', 'char', 'int', 'uint', 'long', 'ulong'];
  const isOriginalMinimumLiteral = syntax => syntax.kind === 'unary' && syntax.operation === '-' && syntax.operand.kind === 'literal' &&
    /^0*(?:2147483648|9223372036854775808[lL]?)$/u.test(syntax.operand.token.spelling);
  const originalCheckedContext = syntax => {
    let scope = syntax;
    while (scope) {
      counter.charge('maxInvariantSteps', 'K2-original-arithmetic-scope');
      if (['arithmeticBlock', 'arithmeticContext'].includes(scope.kind)) {
        const text = original.parser.scanner.decoded.text, start = scope.origin.utf16[0];
        const checked = text.slice(start, start + 9) === 'unchecked' ? false :
          text.slice(start, start + 7) === 'checked' ? true : null;
        if (checked === null || checked !== scope.checked)
          deny('INVALID_PROOF', 'arithmetic scope differs from original checked/unchecked keyword');
        return checked;
      }
      scope = compilation.sourceParents.get(scope);
    }
    return undefined;
  };
  const originalExpressionType = (syntax, depth = 0, comparisonOperandType = false) => {
    counter.charge('maxInvariantSteps', 'K2-original-expression-type');
    if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'original expression type depth exhausted');
    if (['group', 'arithmeticContext'].includes(syntax.kind)) return originalExpressionType(syntax.expression, depth + 1);
    if (isOriginalMinimumLiteral(syntax)) {
      const literal = checkedCsharpUnaryLiteral(original.parser.scanner.decoded, syntax, counter);
      return compilation.index.primitive(scalarAliases[literal.type], compilation.context(method), syntax.origin);
    }
    if (syntax.kind === 'literal') {
      const literal = checkedOriginalLiteral(original.parser.scanner.decoded, syntax.token, 'csharp', counter);
      const alias = scalarAliases[literal.type];
      if (!alias) deny('INCOMPLETE_PROOF', 'original literal needs another scalar type derivation');
      return compilation.index.primitive(alias, compilation.context(method), syntax.origin);
    }
    if (syntax.kind === 'name') {
      const binding = compilation.names.get(original.unit).lookup(syntax.name, syntax);
      const type = binding.kind === 'declaration' && originalStorageTypes.get(canonicalData(binding.declarations[0]));
      if (!type) deny('INCOMPLETE_PROOF', 'original expression needs another storage/member type derivation');
      return type;
    }
    if (syntax.kind === 'call') return originalCall(syntax).returnType;
    if (syntax.kind === 'assignment' && ['=', '+=', '-=', '*=', '&=', '|=', '^=', '<<=', '>>='].includes(syntax.operation) && syntax.left.kind === 'name' && !comparisonOperandType)
      return originalExpressionType(syntax.left, depth + 1);
    if (['unary', 'postfix'].includes(syntax.kind) && ['++', '--'].includes(syntax.operation)) {
      if (syntax.operand.kind !== 'name') deny('INCOMPLETE_PROOF', 'update requires complete original lvalue resolution');
      const type = originalExpressionType(syntax.operand, depth + 1);
      if (type.category !== 'primitive' || !integralNames.includes(type.name))
        deny('INCOMPLETE_PROOF', 'update requires another independently bound operator domain');
      return type;
    }
    if (syntax.kind === 'cast') return compilation.index.resolve(syntax.type, compilation.context(method));
    if (syntax.kind === 'conditional') {
      const test = originalExpressionType(syntax.test, depth + 1);
      const whenTrue = originalExpressionType(syntax.whenTrue, depth + 1);
      const whenFalse = originalExpressionType(syntax.whenFalse, depth + 1);
      if (test.category !== 'primitive' || test.name !== 'bool' || !sameSelectedType(whenTrue, whenFalse))
        deny('INCOMPLETE_PROOF', 'original conditional requires another Boolean/common-type conversion');
      return whenTrue;
    }
    if (syntax.kind === 'unary') {
      const type = originalExpressionType(syntax.operand, depth + 1);
      if (syntax.operation === '-' && syntax.operand.kind === 'literal' && ['uint', 'ulong'].includes(type.name)) {
        const literal = checkedOriginalLiteral(original.parser.scanner.decoded, syntax.operand.token, 'csharp', counter);
        const suffix = /[uUlL]+$/u.exec(syntax.operand.token.spelling)?.[0].toLowerCase() ?? '';
        if (type.name === 'uint' && literal.term.value === '2147483648' && suffix === '' ||
            type.name === 'ulong' && literal.term.value === '9223372036854775808' && ['', 'l'].includes(suffix))
          deny('INCOMPLETE_PROOF', 'signed minimum prefix requires the full original literal-prefix profile');
      }
      if (syntax.operation === '-' && type.name === 'uint')
        return compilation.index.primitive('long', compilation.context(method), syntax.origin);
      if (syntax.operation === '-' && type.name === 'ulong')
        deny('INVALID_PROOF', 'UInt64 has no predefined unary minus');
      if (['+', '-', '~'].includes(syntax.operation) && ['sbyte', 'byte', 'short', 'ushort', 'char'].includes(type.name))
        return compilation.index.primitive('int', compilation.context(method), syntax.origin);
      return type;
    }
    if (syntax.kind === 'binary' || syntax.kind === 'assignment' && ['+=', '-=', '*=', '&=', '|=', '^=', '<<=', '>>='].includes(syntax.operation)) {
      const operation = syntax.kind === 'assignment' ? syntax.operation.slice(0, -1) : syntax.operation;
      const left = originalExpressionType(syntax.left, depth + 1), right = originalExpressionType(syntax.right, depth + 1);
      const comparison = ['==', '!=', '<', '<=', '>', '>='].includes(operation);
      const resultType = type => comparison && !comparisonOperandType
        ? compilation.index.primitive('bool', compilation.context(method), syntax.origin) : type;
      if (comparison && ![left, right].every(type => type.category === 'primitive' &&
          (integralNames.includes(type.name) || ['==', '!='].includes(operation) && type.name === 'bool')))
        deny('INCOMPLETE_PROOF', 'comparison requires another original reference/nullable/floating domain');
      if (['<<', '>>'].includes(operation)) {
        if (left.category !== 'primitive' || !integralNames.includes(left.name))
          deny('INCOMPLETE_PROOF', 'shift requires original integral left promotion');
        return ['sbyte', 'byte', 'short', 'ushort', 'char'].includes(left.name)
          ? compilation.index.primitive('int', compilation.context(method), syntax.origin) : left;
      }
      if (['&&', '||'].includes(operation)) {
        if (![left, right].every(type => type.category === 'primitive' && type.name === 'bool'))
          deny('INCOMPLETE_PROOF', 'short-circuit needs original user-defined truth/operator equations');
        return left;
      }
      if (sameSelectedType(left, right) && !['sbyte', 'byte', 'short', 'ushort', 'char'].includes(left.name)) return resultType(left);
      if (![left, right].every(type => type.category === 'primitive' && integralNames.includes(type.name)))
        deny('INCOMPLETE_PROOF', 'mixed operands require another original promotion domain');
      const types = [left, right], children = [syntax.left, syntax.right];
      let result;
      if (types.some(type => type.name === 'ulong')) {
        const other = types.findIndex(type => type.name !== 'ulong'), type = types[other];
        const constant = originalIntegralConstant(children[other], depth + 1);
        if (!['byte', 'ushort', 'char', 'uint'].includes(type.name) &&
            (constant === null || constant < 0n || constant > 18446744073709551615n))
          deny('INVALID_PROOF', 'original signed operand has no implicit UInt64 operator conversion');
        result = 'ulong';
      } else if (types.some(type => type.name === 'long')) result = 'long';
      else if (types.some(type => type.name === 'uint')) {
        const signed = types.findIndex(type => ['sbyte', 'short', 'int'].includes(type.name));
        if (signed === -1) result = 'uint';
        else {
          const constant = originalIntegralConstant(children[signed], depth + 1);
          result = types[signed].name === 'int' && constant !== null && constant >= 0n && constant <= 4294967295n ? 'uint' : 'long';
        }
      } else result = 'int';
      return resultType(compilation.index.primitive(result, compilation.context(method), syntax.origin));
    }
    deny('INCOMPLETE_PROOF', 'original expression needs another independently derived type equation');
  };
  const originalIntegralConstant = (syntax, depth = 0) => {
    counter.charge('maxInvariantSteps', 'K2-original-integral-constant');
    if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'original constant expression depth exhausted');
    if (['group', 'arithmeticContext'].includes(syntax.kind)) return originalIntegralConstant(syntax.expression, depth + 1);
    if (isOriginalMinimumLiteral(syntax))
      return BigInt(checkedCsharpUnaryLiteral(original.parser.scanner.decoded, syntax, counter).term.value);
    if (syntax.kind === 'name') {
      const binding = compilation.names.get(original.unit).lookup(syntax.name, syntax);
      if (binding.kind !== 'declaration') return null;
      return originalIntegralConstants.get(canonicalData(binding.declarations[0])) ?? null;
    }
    if (syntax.kind === 'literal') {
      const literal = checkedOriginalLiteral(original.parser.scanner.decoded, syntax.token, 'csharp', counter);
      return ['Int32', 'UInt32', 'Int64', 'UInt64', 'Char'].includes(literal.type) ? BigInt(literal.term.value) : null;
    }
    if (syntax.kind === 'conditional') {
      const test = originalBooleanConstant(syntax.test, depth + 1);
      const left = originalIntegralConstant(syntax.whenTrue, depth + 1), right = originalIntegralConstant(syntax.whenFalse, depth + 1);
      return test === null || left === null || right === null ? null : test ? left : right;
    }
    if (syntax.kind === 'cast') {
      const value = originalIntegralConstant(syntax.operand, depth + 1);
      if (value === null) return null;
      const type = originalExpressionType(syntax, depth + 1);
      if (!integralNames.includes(type.name) || typeof originalCheckedContext(syntax) !== 'boolean')
        deny('INCOMPLETE_PROOF', 'constant cast needs another original conversion/profile domain');
      const width = ['sbyte', 'byte'].includes(type.name) ? 8 : ['short', 'ushort', 'char'].includes(type.name) ? 16 :
        ['int', 'uint'].includes(type.name) ? 32 : 64;
      const modulus = 1n << BigInt(width), unsigned = (value % modulus + modulus) % modulus;
      if (originalCheckedContext(syntax)) {
        const signed = ['sbyte', 'short', 'int', 'long'].includes(type.name);
        const lower = signed ? -modulus / 2n : 0n, upper = signed ? modulus / 2n - 1n : modulus - 1n;
        if (value < lower || value > upper) deny('INVALID_PROOF', 'checked original constant conversion overflows');
        return value;
      }
      return ['sbyte', 'short', 'int', 'long'].includes(type.name) && unsigned >= modulus / 2n ? unsigned - modulus : unsigned;
    }
    if (!['unary', 'binary'].includes(syntax.kind)) return null;
    const children = syntax.kind === 'unary' ? [syntax.operand] : [syntax.left, syntax.right];
    const values = children.map(child => originalIntegralConstant(child, depth + 1));
    if (values.some(value => value === null)) return null;
    const type = originalExpressionType(syntax, depth + 1);
    if (!['int', 'uint', 'long', 'ulong'].includes(type.name)) return null;
    // Bitwise and shift equations do not overflow in either explicit context.
    // Checked arithmetic and an unknown default profile remain separate paths.
    if (typeof originalCheckedContext(syntax) !== 'boolean')
      deny('INCOMPLETE_PROOF', 'constant arithmetic requires its checked/default profile derivation');
    const unary = syntax.kind === 'unary';
    let result;
    if (syntax.operation === '+') result = unary ? values[0] : values[0] + values[1];
    else if (syntax.operation === '-') result = unary ? -values[0] : values[0] - values[1];
    else if (!unary && syntax.operation === '*') result = values[0] * values[1];
    else if (!unary && syntax.operation === '&') result = values[0] & values[1];
    else if (!unary && syntax.operation === '|') result = values[0] | values[1];
    else if (!unary && syntax.operation === '^') result = values[0] ^ values[1];
    else if (unary && syntax.operation === '~') result = ~values[0];
    else if (!unary && ['<<', '>>'].includes(syntax.operation)) {
      const count = values[1] & (['long', 'ulong'].includes(type.name) ? 63n : 31n);
      result = syntax.operation === '<<' ? values[0] << count : values[0] >> count;
    }
    else deny('INCOMPLETE_PROOF', 'constant expression requires another original equation');
    const modulus = 1n << BigInt(['long', 'ulong'].includes(type.name) ? 64 : 32);
    const lower = ['int', 'long'].includes(type.name) ? -modulus / 2n : 0n;
    const upper = ['int', 'long'].includes(type.name) ? modulus / 2n - 1n : modulus - 1n;
    if (originalCheckedContext(syntax) === true && ['+', '-', '*'].includes(syntax.operation) &&
        (result < lower || result > upper)) deny('INVALID_PROOF', 'checked original constant expression overflows');
    const unsigned = (result % modulus + modulus) % modulus;
    return ['int', 'long'].includes(type.name) && unsigned >= modulus / 2n ? unsigned - modulus : unsigned;
  };
  const expected = [], expectedEdges = []; let expectedPrevious = null;
  const originalBooleanConstant = (syntax, depth = 0) => {
    counter.charge('maxInvariantSteps', 'K2-original-Boolean-constant');
    if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'original Boolean constant depth exhausted');
    if (['group', 'arithmeticContext'].includes(syntax.kind)) return originalBooleanConstant(syntax.expression, depth + 1);
    if (syntax.kind === 'name') {
      const binding = compilation.names.get(original.unit).lookup(syntax.name, syntax);
      return binding.kind === 'declaration' ? originalBooleanConstants.get(canonicalData(binding.declarations[0])) ?? null : null;
    }
    if (syntax.kind === 'literal') {
      const literal = checkedOriginalLiteral(original.parser.scanner.decoded, syntax.token, 'csharp', counter);
      return literal.type === 'Boolean' ? literal.term.value : null;
    }
    if (syntax.kind === 'unary' && syntax.operation === '!') {
      const operand = originalBooleanConstant(syntax.operand, depth + 1);
      return operand === null ? null : !operand;
    }
    if (syntax.kind === 'binary' && ['==', '!=', '<', '<=', '>', '>='].includes(syntax.operation) &&
        [syntax.left, syntax.right].every(child => integralNames.includes(originalExpressionType(child).name))) {
      const left = originalIntegralConstant(syntax.left, depth + 1), right = originalIntegralConstant(syntax.right, depth + 1);
      if (left === null || right === null) return null;
      return syntax.operation === '==' ? left === right : syntax.operation === '!=' ? left !== right :
        syntax.operation === '<' ? left < right : syntax.operation === '<=' ? left <= right :
          syntax.operation === '>' ? left > right : left >= right;
    }
    if (syntax.kind === 'binary' && ['&', '|', '^', '==', '!=', '&&', '||'].includes(syntax.operation)) {
      const left = originalBooleanConstant(syntax.left, depth + 1), right = originalBooleanConstant(syntax.right, depth + 1);
      if (left === null || right === null) return null;
      return ['&', '&&'].includes(syntax.operation) ? left && right : ['|', '||'].includes(syntax.operation) ? left || right :
        syntax.operation === '==' ? left === right : left !== right;
    }
    if (syntax.kind === 'conditional') {
      const test = originalBooleanConstant(syntax.test, depth + 1);
      const left = originalBooleanConstant(syntax.whenTrue, depth + 1), right = originalBooleanConstant(syntax.whenFalse, depth + 1);
      return test === null || left === null || right === null ? null : test ? left : right;
    }
    return null;
  };
  let originalReturned = false, checkedBooleanLeaves = 0;
  let originalFinalizerContext = null;
  const requiredAllocations = new Map();
  const requiredExceptions = new Map(), precheckedCallees = new Map();
  const same = (actual, expected, message) => {
    if (canonicalData(actual) !== canonicalData(expected)) deny('INVALID_PROOF', message);
  };
  let requiredExceptionCount = 0;
  const originalAllocationKey = (declaration, finalizer) => finalizer
    ? canonicalData({ declaration, finalizer }) : canonicalData(declaration);
  const requireInstruction = (operation, syntax, transfer = null) => {
    counter.charge('maxOccurrences', 'K2-required-original-instruction');
    const id = expected.length;
    const exceptionScopes = [];
    if (['scalarOperator', 'sourceCall', 'sourceCallVoid', 'update', 'explicitCast', 'compoundWrite'].includes(operation)) {
      for (const scope of originalScopes) {
        counter.charge('maxInvariantSteps', 'K2-original-exception-scope-prefix');
        const locals = [];
        for (const local of scope.locals) {
          counter.charge('maxInvariantSteps', 'K2-original-exception-allocation-prefix');
          const key = originalAllocationKey(local.declId, scope.finalizer);
          if (requiredAllocations.has(key)) locals.push({ syntax: local, key, allocation: requiredAllocations.get(key) });
        }
        exceptionScopes.push({ block: scope.block, locals });
      }
    }
    expected.push({ operation, syntax, transfer, finalizer: originalFinalizerContext, exceptionScopes });
    if (syntax.kind === 'local' && ['write', 'declare'].includes(operation)) {
      counter.charge('maxInvariantSteps', 'K2-required-original-allocation');
      requiredAllocations.set(originalAllocationKey(syntax.declId, originalFinalizerContext), id);
    }
    let failures = 0;
    if (operation === 'update' && originalCheckedContext(syntax) === true) failures = 1;
    if (operation === 'explicitCast' && originalCheckedContext(syntax) === true) failures = 1;
    if (operation === 'compoundWrite' && originalCheckedContext(syntax) === true &&
        originalExpressionType(syntax.left).name !== 'bool') {
      if (['+=', '-=', '*='].includes(syntax.operation)) failures++;
      if (!originalImplicitConversion(originalExpressionType(syntax, 0, true), originalExpressionType(syntax.left))) failures++;
    }
    if (operation === 'scalarOperator' && originalCheckedContext(syntax) === true &&
        (syntax.kind === 'binary' && ['+', '-', '*'].includes(syntax.operation) || syntax.kind === 'unary' && syntax.operation === '-')) {
      const type = originalExpressionType(syntax);
      if (type.category === 'primitive' && ['int', 'uint', 'long', 'ulong'].includes(type.name)) failures = 1;
    }
    if (['sourceCall', 'sourceCallVoid'].includes(operation)) {
      counter.charge('maxInvariantSteps', 'K2-source-original-callee-failure-roster');
      const candidate = originalCall(syntax), supplied = body.nodes?.[id]?.calleeBody;
      if (!supplied) deny('INVALID_PROOF', 'source call lacks its authentic callee proof before exception enumeration');
      same(supplied.declaration, candidate.declaration, 'source exception enumeration substitutes another callee');
      checkScalarBody(compilation, supplied, counter, descendants);
      precheckedCallees.set(id, supplied);
      for (const frontier of supplied.finalFrontiers) {
        counter.charge('maxInvariantSteps', 'K2-source-checked-callee-escape');
        if (frontier.kind === 'throw') failures++;
      }
    }
    for (let index = 0; index < failures; index++) {
      counter.charge('maxInvariantSteps', 'K2-source-original-exception-roster');
      const exception = requiredExceptionCount++;
      const frontier = { instruction: id, sourceInstruction: id, syntax, kind: 'throw', exception, exceptionScopes,
        scopeDepth: deferredOriginalReturn?.scopeDepth ?? 0 };
      requiredExceptions.set(exception, frontier);
      if (deferredOriginalReturn) {
        counter.charge('maxInvariantSteps', 'K2-source-owning-try-exception-frontier');
        deferredOriginalReturn.exceptions.push(frontier);
      }
    }
    if (expectedPrevious !== null) expectedEdges.push({ from: expectedPrevious, to: id, completion: 'normal', branch: null });
    expectedPrevious = id; return id;
  };
  const originalImplicitConversion = (source, target, constant = null) => {
    if (sameSelectedType(source, target)) return { kind: 'identity' };
    // Independently fixed lossless integral conversion equations (§10.2.3),
    // not the producer's conversion resolver or an arbitrary cast annotation.
    const destinations = { sbyte: ['short', 'int', 'long'], byte: ['short', 'ushort', 'int', 'uint', 'long', 'ulong'],
      short: ['int', 'long'], ushort: ['int', 'uint', 'long', 'ulong'], char: ['ushort', 'int', 'uint', 'long', 'ulong'],
      int: ['long'], uint: ['long', 'ulong'] };
    if (source.category !== 'primitive' || target.category !== 'primitive') return null;
    let conversion;
    if (destinations[source.name]?.includes(target.name)) conversion = { kind: 'numeric', source: source.name, target: target.name };
    else {
      const ranges = { sbyte: [-128n, 127n], byte: [0n, 255n], short: [-32768n, 32767n],
        ushort: [0n, 65535n], uint: [0n, 4294967295n], ulong: [0n, 18446744073709551615n] };
      const range = ranges[target.name];
      if (constant === null || !range || constant < range[0] || constant > range[1] ||
          !(source.name === 'int' || source.name === 'long' && target.name === 'ulong'))
        return null;
      conversion = { kind: 'constantNumeric', value: constant.toString(), target: target.name };
    }
    return conversion;
  };
  const requireImplicitValue = (syntax, target) => {
    const source = originalExpressionType(syntax);
    const conversion = originalImplicitConversion(source, target) ??
      originalImplicitConversion(source, target, originalIntegralConstant(syntax));
    if (!conversion) deny('INCOMPLETE_PROOF', 'implicit value requires another original conversion equation');
    if (conversion.kind !== 'identity') requireInstruction('convert', syntax, { source, target, conversion });
  };
  const originalDefaults = (candidate, order) => {
    const supplied = new Set(order), rows = [];
    const calleeOriginal = compilation.originals.find(unit => unit.unit === candidate.declaration.unit);
    const calleeEntry = compilation.byDeclaration.get(canonicalData(candidate.declaration));
    if (!calleeOriginal || !calleeEntry) deny('INVALID_PROOF', 'optional values lack their original callee source unit');
    for (let formalIndex = 0; formalIndex < candidate.parameters.length; formalIndex++) {
      counter.charge('maxInvariantSteps', 'K2-original-optional-literal');
      const formal = candidate.parameters[formalIndex], source = formal.defaultSyntax;
      if (source === null) continue;
      const unaryLiteral = source.kind === 'unary' && ['+', '-'].includes(source.operation) && source.operand.kind === 'literal';
      if (!(source.kind === 'literal' || unaryLiteral) || !['bool', ...integralNames].includes(formal.type.name))
        deny('INCOMPLETE_PROOF', 'optional value requires complete original constant expression');
      const literal = unaryLiteral ? checkedCsharpUnaryLiteral(calleeOriginal.parser.scanner.decoded, source, counter) :
        checkedOriginalLiteral(calleeOriginal.parser.scanner.decoded, source.token, 'csharp', counter);
      const alias = scalarAliases[literal.type];
      if (!alias) deny('INCOMPLETE_PROOF', 'optional literal requires another original scalar type');
      const sourceType = compilation.index.primitive(alias, compilation.context(calleeEntry), source.origin);
      const constant = typeof literal.term.value === 'string' && literal.term.sort?.kind === 'BV' ? BigInt(literal.term.value) : null;
      const conversion = originalImplicitConversion(sourceType, formal.type, constant);
      if (!conversion) deny('INVALID_PROOF', 'optional literal has no original formal conversion');
      const term = sameSelectedType(sourceType, formal.type) ? literal.term :
        { kind: 'Op', opcode: 'cast', sort: scalarSort(formal.type), args: [literal.term] };
      if (!supplied.has(formalIndex)) rows.push({ formal: formalIndex, unit: candidate.declaration.unit, occurrence: source.origin, type: formal.type, conversion, term });
    }
    return rows;
  };
  const requireExpression = (syntax, depth = 0) => {
    counter.charge('maxInvariantSteps', 'K2-required-original-expression');
    if (depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'original expression roster depth exhausted');
    if (['group', 'arithmeticContext'].includes(syntax.kind)) return requireExpression(syntax.expression, depth + 1);
    if (syntax.kind === 'call') {
      const candidate = originalCall(syntax), order = originalFormalOrder(syntax, candidate);
      for (const argument of syntax.arguments) requireExpression(argument.expression, depth + 1);
      for (let ordinal = 0; ordinal < syntax.arguments.length; ordinal++)
        requireImplicitValue(syntax.arguments[ordinal].expression, candidate.parameters[order[ordinal]].type);
      return requireInstruction(candidate.returnType.name === 'void' ? 'sourceCallVoid' : 'sourceCall', syntax);
    }
    if (isOriginalMinimumLiteral(syntax)) return requireInstruction('unaryLiteral', syntax);
    if (syntax.kind === 'literal') return requireInstruction('literal', syntax);
    if (syntax.kind === 'name') return requireInstruction('read', syntax);
    if (['unary', 'postfix'].includes(syntax.kind) && ['++', '--'].includes(syntax.operation)) {
      originalExpressionType(syntax);
      if (typeof originalCheckedContext(syntax) !== 'boolean') deny('INCOMPLETE_PROOF', 'update requires its original arithmetic context');
      requireExpression(syntax.operand, depth + 1);
      return requireInstruction('update', syntax);
    }
    if (syntax.kind === 'binary' && ['&&', '||'].includes(syntax.operation)) {
      const requireBranchExpression = (node, level = 0) => {
        counter.charge('maxInvariantSteps', 'K2-original-short-circuit-effect-roster');
        if (level >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'original short-circuit depth exhausted');
        if (['literal', 'name'].includes(node.kind)) return;
        const children = node.kind === 'assignment' && node.operation === '=' && node.left.kind === 'name' ? [node.right] :
          ['group', 'arithmeticContext'].includes(node.kind) ? [node.expression] :
          ['cast', 'unary', 'postfix'].includes(node.kind) ? [node.operand] : node.kind === 'binary' ? [node.left, node.right] :
          node.kind === 'conditional' ? [node.test, node.whenTrue, node.whenFalse] : null;
        if (!children) deny('INCOMPLETE_PROOF', 'original short-circuit needs effectful store/call transfer');
        for (const child of children) requireBranchExpression(child, level + 1);
      };
      requireBranchExpression(syntax); originalExpressionType(syntax);
      requireExpression(syntax.left, depth + 1);
      const branch = requireInstruction('shortCircuitBranch', syntax);
      requireInstruction('shortCircuitArm', syntax, { branch, outcome: true });
      expectedEdges.at(-1).branch = { source: branch, outcome: true };
      if (syntax.operation === '&&') requireExpression(syntax.right, depth + 1);
      const trueTail = expectedPrevious;
      expectedPrevious = branch;
      requireInstruction('shortCircuitArm', syntax, { branch, outcome: false });
      expectedEdges.at(-1).branch = { source: branch, outcome: false };
      if (syntax.operation === '||') requireExpression(syntax.right, depth + 1);
      const join = requireInstruction('shortCircuitJoin', syntax, { branch });
      expectedEdges.push({ from: trueTail, to: join, completion: 'normal', branch: null });
      return join;
    }
    if (syntax.kind === 'conditional') {
      const requireBranchExpression = (node, level = 0) => {
        counter.charge('maxInvariantSteps', 'K2-original-conditional-effect-roster');
        if (level >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'original conditional depth exhausted');
        if (['literal', 'name'].includes(node.kind)) return;
        const children = node.kind === 'assignment' && node.operation === '=' && node.left.kind === 'name' ? [node.right] :
          ['group', 'arithmeticContext'].includes(node.kind) ? [node.expression] :
          ['cast', 'unary', 'postfix'].includes(node.kind) ? [node.operand] : node.kind === 'binary' ? [node.left, node.right] :
          node.kind === 'conditional' ? [node.test, node.whenTrue, node.whenFalse] : null;
        if (!children) deny('INCOMPLETE_PROOF', 'original conditional requires its effectful CFG/state rule');
        for (const child of children) requireBranchExpression(child, level + 1);
      };
      requireBranchExpression(syntax); originalExpressionType(syntax);
      requireExpression(syntax.test, depth + 1);
      const branch = requireInstruction('conditionalBranch', syntax);
      requireInstruction('conditionalArm', syntax, { branch, outcome: true });
      expectedEdges.at(-1).branch = { source: branch, outcome: true };
      requireExpression(syntax.whenTrue, depth + 1); const trueTail = expectedPrevious;
      expectedPrevious = branch;
      requireInstruction('conditionalArm', syntax, { branch, outcome: false });
      expectedEdges.at(-1).branch = { source: branch, outcome: false };
      requireExpression(syntax.whenFalse, depth + 1);
      const join = requireInstruction('conditionalJoin', syntax, { branch });
      expectedEdges.push({ from: trueTail, to: join, completion: 'normal', branch: null });
      return join;
    }
    if (syntax.kind === 'cast') {
      requireExpression(syntax.operand, depth + 1);
      const source = originalExpressionType(syntax.operand), target = originalExpressionType(syntax);
      if (![source, target].every(type => type.category === 'primitive' && integralNames.includes(type.name)) ||
          typeof originalCheckedContext(syntax) !== 'boolean')
        deny('INCOMPLETE_PROOF', 'cast requires another original checked/reference/numeric transfer');
      return requireInstruction('explicitCast', syntax, { source, target,
        conversion: { kind: 'explicitIntegral', source: source.name, target: target.name, checkedContext: originalCheckedContext(syntax) } });
    }
    if (syntax.kind === 'binary' && ['+', '-', '*', '&', '|', '^', '==', '!=', '<', '<=', '>', '>=', '<<', '>>'].includes(syntax.operation)) {
      requireExpression(syntax.left, depth + 1); requireExpression(syntax.right, depth + 1);
      const target = originalExpressionType(syntax, 0, true);
      requireImplicitValue(syntax.left, target);
      requireImplicitValue(syntax.right, ['<<', '>>'].includes(syntax.operation)
        ? compilation.index.primitive('int', compilation.context(method), syntax.right.origin) : target);
      return requireInstruction('scalarOperator', syntax);
    }
    if (syntax.kind === 'unary' && ['+', '-', '~', '!'].includes(syntax.operation)) {
      requireExpression(syntax.operand, depth + 1);
      if (['+', '-', '~'].includes(syntax.operation))
        requireImplicitValue(syntax.operand, originalExpressionType(syntax));
      return requireInstruction('scalarOperator', syntax);
    }
    if (syntax.kind === 'assignment' && ['+=', '-=', '*=', '&=', '|=', '^=', '<<=', '>>='].includes(syntax.operation) && syntax.left.kind === 'name') {
      requireExpression(syntax.left, depth + 1);
      requireExpression(syntax.right, depth + 1);
      const operatorType = originalExpressionType(syntax, 0, true);
      requireImplicitValue(syntax.left, operatorType);
      requireImplicitValue(syntax.right, ['<<=', '>>='].includes(syntax.operation)
        ? compilation.index.primitive('int', compilation.context(method), syntax.right.origin) : operatorType);
      return requireInstruction('compoundWrite', syntax);
    }
    if (syntax.kind === 'assignment' && syntax.operation === '=' && syntax.left.kind === 'name') {
      requireExpression(syntax.right, depth + 1);
      requireImplicitValue(syntax.right, originalExpressionType(syntax.left));
      return requireInstruction('write', syntax);
    }
    deny('INCOMPLETE_PROOF', 'original expression requires another complete checker transfer');
  };
  const originalScopes = [];
  const requireFormalEnds = () => {
    for (let ordinal = signature.parameters.length - 1; ordinal >= 0; ordinal--) {
      const formal = signature.parameters[ordinal], original = compilation.byDeclaration.get(canonicalData(formal.declaration));
      if (formal.direction !== 'value' || original?.syntax.kind !== 'parameter')
        deny('INVALID_PROOF', 'formal end lacks original by-value parameter production');
      requireInstruction('endParameter', original.syntax, { scope: method.syntax.body.origin });
    }
  };
  const requireReturnScopeEnds = () => {
    for (let index = originalScopes.length - 1; index >= 0; index--) {
      const scope = originalScopes[index];
      for (let ordinal = scope.locals.length - 1; ordinal >= 0; ordinal--)
        requireInstruction('endLocal', scope.locals[ordinal], { scope: scope.block.origin });
    }
    requireFormalEnds();
  };
  const originalFrontierTails = new Set();
  const originalReturnBranchEnds = new Map();
  const expectedExceptionTargets = new Map();
  const requireExceptionEntry = frontier => {
    expectedPrevious = frontier.instruction;
    if (frontier.pending) return;
    counter.charge('maxInvariantSteps', 'K2-original-pending-exception-frontier');
    if (requiredExceptions.get(frontier.exception) !== frontier ||
        expectedExceptionTargets.has(frontier.exception) || frontier.instruction !== frontier.sourceInstruction)
      deny('INVALID_PROOF', 'original exception entry lacks its unique source failure');
    const pending = requireInstruction('pendingException', frontier.syntax,
      { exception: frontier.exception, sourceInstruction: frontier.sourceInstruction, initial: true });
    expectedExceptionTargets.set(frontier.exception, pending);
    expectedEdges.at(-1).completion = 'throw';
    expectedEdges.at(-1).branch = { source: frontier.sourceInstruction, outcome: { exception: frontier.exception } };
    for (let index = frontier.exceptionScopes.length - 1; index >= frontier.scopeDepth; index--) {
      counter.charge('maxInvariantSteps', 'K2-original-exception-crossed-scope');
      const scope = frontier.exceptionScopes[index];
      for (let ordinal = scope.locals.length - 1; ordinal >= 0; ordinal--) {
        counter.charge('maxInvariantSteps', 'K2-original-exception-crossed-local');
        const local = scope.locals[ordinal];
        requireInstruction('endLocal', local.syntax, { scope: scope.block.origin, allocation: local.allocation });
      }
    }
  };
  let deferredOriginalReturn = null;
  const requireBlock = (block, depth = 0) => {
    counter.charge('maxInvariantSteps', 'K2-required-original-block');
    if (depth >= K2_LIMITS.maxTermDepth) deny('INCOMPLETE_PROOF', 'original body requires bounded statement traversal');
    const directLocals = [];
    if (block.kind === 'block') originalScopes.push({ block, locals: directLocals, finalizer: originalFinalizerContext });
    for (const syntax of block.kind === 'block' ? block.statements : [block]) {
      counter.charge('maxInvariantSteps', 'K2-required-original-statement');
      if (originalReturned) deny('INCOMPLETE_PROOF', 'original unreachable syntax requires complete reachability accounting');
      if (syntax.kind === 'block') { requireBlock(syntax, depth + 1); continue; }
      if (syntax.kind === 'arithmeticBlock') { requireBlock(syntax.body, depth + 1); continue; }
      if (syntax.kind === 'try') {
        if (syntax.catches.length || !syntax.finalizer)
          deny('INCOMPLETE_PROOF', 'original try requires complete catch dispatch');
        requireInstruction('tryEnter', syntax);
        const returnStart = originalEarlyReturns.length;
        const outerReturn = deferredOriginalReturn, completion = { scopeDepth: originalScopes.length, frontiers: [], exceptions: [] };
        deferredOriginalReturn = completion;
        try { requireBlock(syntax.body, depth + 1); }
        finally { deferredOriginalReturn = outerReturn; }
        if (originalEarlyReturns.length !== returnStart)
          deny('INCOMPLETE_PROOF', 'original abrupt try requires its actual finalizer continuation');
        const incomingFrontiers = [];
        for (const frontier of completion.exceptions) {
          counter.charge('maxInvariantSteps', 'K2-original-try-exception-dispatch-frontier');
          incomingFrontiers.push(frontier);
        }
        for (const frontier of completion.frontiers) {
          counter.charge('maxInvariantSteps', 'K2-original-try-return-dispatch-frontier');
          incomingFrontiers.push(frontier);
        }
        completion.frontiers = incomingFrontiers;
        const hasNormal = !originalReturned;
        if (hasNormal) {
          counter.charge('maxInvariantSteps', 'K2-original-normal-completion-frontier');
          completion.frontiers.push({ instruction: expectedPrevious, kind: 'normal', scopeDepth: originalScopes.length });
        }
        if (!completion.frontiers.length) deny('INVALID_PROOF', 'original try lacks its reached completion frontier');
        for (let ordinal = 0; ordinal < completion.frontiers.length; ordinal++) {
          counter.charge('maxInvariantSteps', 'K2-original-finalizer-completion-frontier');
          const frontier = completion.frontiers[ordinal];
          if (frontier.scopeDepth !== originalScopes.length)
            deny('INVALID_PROOF', 'original completion frontier crosses another source scope boundary');
          if (frontier.kind === 'throw') requireExceptionEntry(frontier);
          else expectedPrevious = frontier.instruction;
          originalReturned = false;
          originalFrontierTails.add(expectedPrevious);
          counter.charge('maxInvariantSteps', 'K2-original-finalizer-allocation-context');
          const incoming = expectedPrevious, outerFinalizer = originalFinalizerContext;
          const finalizerEntry = requireInstruction('finallyEnter', syntax.finalizer, { incoming, outerFinalizer });
          originalFinalizerContext = { entry: finalizerEntry, incoming, outer: outerFinalizer };
          try { requireBlock(syntax.finalizer, depth + 1); }
          finally { originalFinalizerContext = outerFinalizer; }
          if (originalReturned) deny('INCOMPLETE_PROOF', 'original finalizer requires its replacement completion');
          requireInstruction('finallyLeave', syntax);
          if (frontier.kind === 'normal') continue;
          if (frontier.kind === 'throw') {
            if (outerReturn) {
              for (let index = originalScopes.length - 1; index >= outerReturn.scopeDepth; index--) {
                counter.charge('maxInvariantSteps', 'K2-original-nested-exception-scope');
                for (let ordinal = originalScopes[index].locals.length - 1; ordinal >= 0; ordinal--)
                  requireInstruction('endLocal', originalScopes[index].locals[ordinal], { scope: originalScopes[index].block.origin });
              }
            } else requireReturnScopeEnds();
            const resumed = requireInstruction(outerReturn ? 'pendingException' : 'resumeException', frontier.syntax,
              { exception: frontier.exception, sourceInstruction: frontier.sourceInstruction });
            if (outerReturn) {
              counter.charge('maxInvariantSteps', 'K2-original-enclosing-exception-frontier');
              outerReturn.exceptions.push({ instruction: resumed, kind: 'throw', exception: frontier.exception,
                sourceInstruction: frontier.sourceInstruction, syntax: frontier.syntax,
                scopeDepth: outerReturn.scopeDepth, pending: true });
            } else if (ordinal + 1 < completion.frontiers.length) {
              counter.charge('maxInvariantSteps', 'K2-original-finalized-exception-frontier');
              originalEarlyThrows.push(resumed);
            }
            originalReturned = true; continue;
          }
          if (outerReturn) {
            for (let index = originalScopes.length - 1; index >= outerReturn.scopeDepth; index--) {
              counter.charge('maxInvariantSteps', 'K2-original-nested-return-scope');
              for (let ordinal = originalScopes[index].locals.length - 1; ordinal >= 0; ordinal--)
                requireInstruction('endLocal', originalScopes[index].locals[ordinal], { scope: originalScopes[index].block.origin });
            }
          } else requireReturnScopeEnds();
          const resumed = requireInstruction(outerReturn ? frontier.syntax.value ? 'pendingReturn' : 'pendingReturnVoid' :
            frontier.syntax.value ? 'return' : 'returnVoid', frontier.syntax,
            { pending: frontier.instruction });
          if (outerReturn) {
            counter.charge('maxInvariantSteps', 'K2-original-return-completion-frontier');
            outerReturn.frontiers.push({ syntax: frontier.syntax, instruction: resumed, scopeDepth: outerReturn.scopeDepth });
          }
          else if (ordinal + 1 < completion.frontiers.length) {
            counter.charge('maxInvariantSteps', 'K2-original-finalized-return-frontier');
            originalEarlyReturns.push(resumed);
          }
          originalReturned = true;
        }
        originalReturned = !hasNormal;
        continue;
      }
      if (syntax.kind === 'empty') { requireInstruction('empty', syntax); continue; }
      if (syntax.kind === 'if') {
        const type = originalExpressionType(syntax.test);
        if (type.category !== 'primitive' || type.name !== 'bool')
          deny('INCOMPLETE_PROOF', 'original if needs another condition conversion');
        requireExpression(syntax.test, depth + 1);
        const branch = requireInstruction('statementBranch', syntax);
        requireInstruction('statementArm', syntax, { branch, outcome: true });
        expectedEdges.at(-1).branch = { source: branch, outcome: true };
        requireBlock(syntax.body, depth + 1);
        const trueReturned = originalReturned, trueTail = expectedPrevious;
        expectedPrevious = branch; originalReturned = false;
        requireInstruction('statementArm', syntax, { branch, outcome: false });
        expectedEdges.at(-1).branch = { source: branch, outcome: false };
        if (syntax.alternative) requireBlock(syntax.alternative, depth + 1);
        const falseReturned = originalReturned, falseTail = expectedPrevious;
        if (trueReturned !== falseReturned) {
          const returnedTail = trueReturned ? trueTail : falseTail;
          const normalTail = trueReturned ? falseTail : trueTail;
          if (!deferredOriginalReturn) originalEarlyReturns.push(returnedTail);
          expectedPrevious = normalTail; originalReturned = false;
          requireInstruction('statementContinuation', syntax, { branch, returnedTail, normalTail, returnedOutcome: trueReturned });
          continue;
        }
        if (trueReturned) {
          if (deferredOriginalReturn) {
            counter.charge('maxInvariantSteps', 'K2-original-return-frontier-branch');
            if (!originalReturnBranchEnds.has(falseTail)) originalReturnBranchEnds.set(falseTail, []);
            originalReturnBranchEnds.get(falseTail).push(branch);
            originalReturned = true; continue;
          }
          const join = requireInstruction(signature.returnType.name === 'void' ? 'returnMergeVoid' : 'returnMerge', syntax,
            { branch, whenTrue: trueTail, whenFalse: falseTail });
          expectedEdges.at(-1).completion = 'return';
          expectedEdges.push({ from: trueTail, to: join, completion: 'return', branch: null });
          originalReturned = true; continue;
        }
        const join = requireInstruction('statementJoin', syntax, { branch });
        expectedEdges.push({ from: trueTail, to: join, completion: 'normal', branch: null });
        continue;
      }
      if (syntax.kind === 'localDeclaration') {
        for (const local of syntax.declarations) {
          counter.charge('maxInvariantSteps', 'K2-original-block-local-roster');
          directLocals.push(local);
          if (!local.initializer) {
            if (local.constant) deny('INVALID_PROOF', 'original constant local lacks its initializer');
            if (local.type.kind === 'inferredType') deny('INVALID_PROOF', 'original inferred local lacks an initializer');
            const type = compilation.index.resolve(local.type, { ...compilation.context(method), owner: local.declId });
            originalStorageTypes.set(canonicalData(local.declId), type);
            requireInstruction('declare', local);
            continue;
          }
          requireExpression(local.initializer, depth + 1);
          const type = local.type.kind === 'inferredType' ? originalExpressionType(local.initializer) :
            compilation.index.resolve(local.type, { ...compilation.context(method), owner: local.declId });
          requireImplicitValue(local.initializer, type);
          if (local.constant) {
            const boolean = type.category === 'primitive' && type.name === 'bool';
            const constant = boolean ? originalBooleanConstant(local.initializer) : originalIntegralConstant(local.initializer);
            if (local.type.kind === 'inferredType' || (!boolean && !integralNames.includes(type.name)) || constant === null)
              deny('INCOMPLETE_PROOF', 'original constant local requires another complete constant domain');
            (boolean ? originalBooleanConstants : originalIntegralConstants).set(canonicalData(local.declId), constant);
          }
          originalStorageTypes.set(canonicalData(local.declId), type);
          requireInstruction('write', local);
        }
        continue;
      }
      if (syntax.kind === 'expressionStatement' && (['assignment', 'call'].includes(syntax.expression.kind) ||
          ['unary', 'postfix'].includes(syntax.expression.kind) && ['++', '--'].includes(syntax.expression.operation))) {
        requireExpression(syntax.expression, depth + 1); continue;
      }
      if (syntax.kind === 'return' && !syntax.value) {
        if (signature.returnType.category !== 'primitive' || signature.returnType.name !== 'void')
          deny('INVALID_PROOF', 'original value method has no return value');
        if (deferredOriginalReturn) {
          for (let index = originalScopes.length - 1; index >= deferredOriginalReturn.scopeDepth; index--) {
            counter.charge('maxInvariantSteps', 'K2-original-pending-return-scope');
            for (let ordinal = originalScopes[index].locals.length - 1; ordinal >= 0; ordinal--)
              requireInstruction('endLocal', originalScopes[index].locals[ordinal], { scope: originalScopes[index].block.origin });
          }
          counter.charge('maxInvariantSteps', 'K2-original-return-completion-frontier');
          deferredOriginalReturn.frontiers.push({ syntax, scopeDepth: deferredOriginalReturn.scopeDepth,
            instruction: requireInstruction('pendingReturnVoid', syntax) });
        } else { requireReturnScopeEnds(); requireInstruction('returnVoid', syntax); }
        originalReturned = true; continue;
      }
      if (syntax.kind === 'return' && syntax.value) {
        if (signature.returnType.category === 'primitive' && signature.returnType.name === 'void')
          deny('INVALID_PROOF', 'original Void method cannot return a value expression');
        requireExpression(syntax.value, depth + 1); requireImplicitValue(syntax.value, signature.returnType);
        if (deferredOriginalReturn) {
          for (let index = originalScopes.length - 1; index >= deferredOriginalReturn.scopeDepth; index--) {
            counter.charge('maxInvariantSteps', 'K2-original-pending-return-scope');
            for (let ordinal = originalScopes[index].locals.length - 1; ordinal >= 0; ordinal--)
              requireInstruction('endLocal', originalScopes[index].locals[ordinal], { scope: originalScopes[index].block.origin });
          }
          counter.charge('maxInvariantSteps', 'K2-original-return-completion-frontier');
          deferredOriginalReturn.frontiers.push({ syntax, scopeDepth: deferredOriginalReturn.scopeDepth,
            instruction: requireInstruction('pendingReturn', syntax) });
        } else { requireReturnScopeEnds(); requireInstruction('return', syntax); }
        originalReturned = true; continue;
      }
      deny('INCOMPLETE_PROOF', 'original statement requires another complete CFG transfer');
    }
    if (block.kind === 'block' && !originalReturned)
      for (let ordinal = directLocals.length - 1; ordinal >= 0; ordinal--)
        requireInstruction('endLocal', directLocals[ordinal], { scope: block.origin });
    if (block.kind === 'block') originalScopes.pop();
  };
  const originalEarlyReturns = [], originalEarlyThrows = [];
  requireInstruction('entry', method.syntax.body); requireBlock(method.syntax.body);
  if (!originalReturned) {
    if (signature.returnType.category !== 'primitive' || signature.returnType.name !== 'void')
      deny('INCOMPLETE_PROOF', 'original value body lacks a proved value return');
    requireFormalEnds();
    requireInstruction('fallthrough', method.syntax.body);
  }
  const originalPrimaryCompletion = expectedPrevious;
  const originalReturnNode = originalReturned &&
    ['return', 'returnVoid', 'returnMerge', 'returnMergeVoid'].includes(expected[originalPrimaryCompletion].operation)
    ? originalPrimaryCompletion : null;
  const originalMethodExits = [{ instruction: originalPrimaryCompletion,
    kind: expected[originalPrimaryCompletion].operation === 'resumeException' ? 'throw' : originalReturned ? 'return' : 'normal' }];
  for (const instruction of originalEarlyReturns) {
    counter.charge('maxInvariantSteps', 'K2-original-method-return-exit-frontier');
    originalMethodExits.push({ instruction, kind: 'return' });
  }
  for (const instruction of originalEarlyThrows) {
    counter.charge('maxInvariantSteps', 'K2-original-method-throw-exit-frontier');
    originalMethodExits.push({ instruction, kind: 'throw' });
  }
  for (const frontier of requiredExceptions.values()) {
    counter.charge('maxInvariantSteps', 'K2-original-unhandled-exception-cleanup');
    if (expectedExceptionTargets.has(frontier.exception)) continue;
    if (frontier.scopeDepth !== 0)
      deny('INVALID_PROOF', 'source failure retains an undispatched owning try frame');
    requireExceptionEntry(frontier);
    requireFormalEnds();
    const terminal = requireInstruction('resumeException', frontier.syntax,
      { exception: frontier.exception, sourceInstruction: frontier.sourceInstruction });
    originalMethodExits.push({ instruction: terminal, kind: 'throw' });
  }
  expectedPrevious = null;
  const originalExit = requireInstruction('exit', method.syntax.body);
  for (const frontier of originalMethodExits) {
    counter.charge('maxInvariantSteps', 'K2-original-method-completion-exit-edge');
    expectedEdges.push({ from: frontier.instruction, to: originalExit, completion: frontier.kind, branch: null });
  }
  const valueSyntax = syntax => {
    let current = syntax, depth = 0;
    while (['group', 'arithmeticContext'].includes(current.kind)) {
      counter.charge('maxInvariantSteps', 'K2-original-value-wrapper');
      if (++depth >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'original value wrapper depth exhausted');
      current = current.expression;
    }
    return current;
  };
  const scalarSort = type => {
    if (type.category !== 'primitive' || ![...integralNames, 'bool', 'float', 'double', 'decimal'].includes(type.name))
      deny('INCOMPLETE_PROOF', 'scalar checker still requires another original type/sort');
    if (['float', 'double', 'decimal'].includes(type.name))
      return { float: 'F32', double: 'F64', decimal: 'Decimal' }[type.name];
    return type.name === 'bool' ? 'Bool' : { kind: 'BV',
      width: ['long', 'ulong'].includes(type.name) ? 64 : ['sbyte', 'byte'].includes(type.name) ? 8 :
        ['short', 'ushort', 'char'].includes(type.name) ? 16 : 32,
      signed: ['sbyte', 'short', 'int', 'long'].includes(type.name) };
  };
  same(body.binder, { declaration: body.declaration, role: 'scalarBody' }, 'body binder differs from its original declaration');
  if (body.phase !== 'scalarBody' || body.sourceAdmission !== false || body.completeBodyBinding !== false)
    deny('INVALID_PROOF', 'initial scalar body cannot claim whole source or body admission');
  const store = new Map();
  const storeTypes = new Map(), lastWrites = new Map();
  const storeLocations = new Map(), activeLocations = new Map();
  const storageKey = declaration => activeLocations.get(canonicalData(declaration)) ?? canonicalData(declaration);
  const allocateOriginalLocation = (declaration, finalizer) => {
    counter.charge('maxInvariantSteps', 'K2-original-contextual-location');
    const key = finalizer ? canonicalData({ declaration, finalizer }) : canonicalData(declaration);
    if (storeLocations.has(key)) deny('INVALID_PROOF', 'source allocation context is reused');
    storeLocations.set(key, { binder: body.binder, declaration, ...(finalizer ? { finalizer } : {}) });
    activeLocations.set(canonicalData(declaration), key);
    return key;
  };
  const branchStores = new Map();
  const endedLocations = new Set();
  const captureStore = () => {
    const snapshot = { values: new Map(), writes: new Map(), locations: new Set(), ended: new Set(), active: new Set() };
    for (const key of storeTypes.keys()) {
      counter.charge('maxInvariantSteps', 'K2-original-branch-store-capture');
      snapshot.locations.add(key);
      if (activeLocations.get(canonicalData(storeLocations.get(key).declaration)) === key) snapshot.active.add(key);
      if (endedLocations.has(key)) snapshot.ended.add(key);
      if (store.has(key)) snapshot.values.set(key, store.get(key));
      if (lastWrites.has(key)) snapshot.writes.set(key, lastWrites.get(key));
    }
    return snapshot;
  };
  const restoreStore = snapshot => {
    activeLocations.clear();
    for (const key of storeTypes.keys()) {
      counter.charge('maxInvariantSteps', 'K2-original-branch-location-restore');
      if (!snapshot.locations.has(key) && (!endedLocations.has(key) || store.has(key) || lastWrites.has(key)))
        deny('INCOMPLETE_PROOF', 'branch requires complete original local allocation/lifetime transfer');
      if (snapshot.locations.has(key)) {
        if (snapshot.active.has(key)) activeLocations.set(canonicalData(storeLocations.get(key).declaration), key);
        if (snapshot.ended.has(key)) endedLocations.add(key); else endedLocations.delete(key);
      }
    }
    store.clear(); lastWrites.clear();
    for (const [key, value] of snapshot.values) {
      counter.charge('maxInvariantSteps', 'K2-original-branch-value-restore'); store.set(key, value);
    }
    for (const [key, write] of snapshot.writes) {
      counter.charge('maxInvariantSteps', 'K2-original-branch-write-restore'); lastWrites.set(key, write);
    }
  };
  const joinStores = (whenTrue, whenFalse, test, join) => {
    for (const [key, type] of storeTypes) {
      counter.charge('maxInvariantSteps', 'K2-original-branch-store-join');
      if (!whenTrue.locations.has(key) || !whenFalse.locations.has(key)) {
        if (!endedLocations.has(key) || whenTrue.values.has(key) || whenFalse.values.has(key))
          deny('INCOMPLETE_PROOF', 'join requires complete original local allocation/lifetime transfer');
        store.delete(key); lastWrites.delete(key); continue;
      }
      if (whenTrue.values.has(key) && whenFalse.values.has(key)) {
        const left = whenTrue.values.get(key), right = whenFalse.values.get(key);
        store.set(key, canonicalData(left) === canonicalData(right) ? left :
          { kind: 'Op', opcode: 'ite', sort: scalarSort(type), args: [test, left, right] });
        const leftWrite = whenTrue.writes.get(key), rightWrite = whenFalse.writes.get(key);
        if (leftWrite === rightWrite && leftWrite !== undefined) lastWrites.set(key, leftWrite);
        else if (leftWrite !== undefined || rightWrite !== undefined) lastWrites.set(key, join);
        else lastWrites.delete(key);
      } else { store.delete(key); lastWrites.delete(key); }
    }
  };
  const storeSnapshot = () => {
    const snapshot = [];
    for (const [key, type] of storeTypes) {
      counter.charge('maxInvariantSteps', 'K2-original-store-snapshot-location');
      if (store.has(key)) snapshot.push({ location: storeLocations.get(key), type, value: store.get(key) });
    }
    return snapshot;
  };
  if (signature.returnType.name !== 'void') scalarSort(signature.returnType);
  for (let index = 0; index < signature.parameters.length; index++) {
    const formal = signature.parameters[index];
    if (formal.direction !== 'value')
      deny('INCOMPLETE_PROOF', 'independent scalar checker still requires other formal sorts and aliases');
    store.set(canonicalData(formal.declaration), { kind: 'Bound', sort: scalarSort(formal.type), binder: body.binder, index });
    storeTypes.set(canonicalData(formal.declaration), formal.type);
    allocateOriginalLocation(formal.declaration, null);
  }
  same(body.slots, signature.parameters.map(formal => ({ declaration: formal.declaration,
    sort: scalarSort(formal.type) })), 'body slots differ from its original method signature');
  const binderKey = canonicalData(body.binder);
  const termIdentities = { BinderId: new Set([binderKey]) };
  const termMetadata = { binders: new Map([[binderKey, { slots: signature.parameters
    .map(formal => ({ sort: scalarSort(formal.type) })) }]]) };
  if (!Array.isArray(body.nodes) || body.nodes.length > K2_LIMITS.maxOccurrences || body.nodes.length < 2)
    deny('INVALID_PROOF', 'body has no bounded original instruction roster');
  if (body.nodes.length !== expected.length) deny('INVALID_PROOF', 'body omits or adds required original instructions');
  const prior = new Map(), exceptionalCompletions = [], returnFrontierStores = new Map(), finalFrontiers = [];
  const checkedExceptionFrontiers = new Map();
  const retainCheckedException = (failure, expectation) => {
    counter.charge('maxInvariantSteps', 'K2-original-raw-exception-frontier');
    const required = requiredExceptions.get(failure.ordinal);
    if (!required || required.instruction !== failure.instruction || required.exceptionScopes !== expectation.exceptionScopes)
      deny('INVALID_PROOF', 'raw failure differs from independently enumerated original source exception');
    const scopes = [];
    for (const scope of expectation.exceptionScopes) {
      counter.charge('maxInvariantSteps', 'K2-checked-exception-scope-prefix');
      const locals = [];
      for (const local of scope.locals) {
        counter.charge('maxInvariantSteps', 'K2-checked-exception-allocation-prefix');
        const allocation = prior.get(local.allocation);
        if (!allocation || !['write', 'declare'].includes(allocation.operation) ||
            !storeTypes.has(local.key) || endedLocations.has(local.key))
          deny('INVALID_PROOF', 'exception scope loses its actual earlier live source allocation');
        same(allocation.location, storeLocations.get(local.key), 'exception scope substitutes another source allocation');
        locals.push(local);
      }
      scopes.push({ block: scope.block, locals });
    }
    exceptionalCompletions.push(failure);
    checkedExceptionFrontiers.set(failure.ordinal, { tail: failure.instruction, kind: 'throw',
      store: captureStore(), scopes, exception: failure });
  };
  for (let ordinal = 0; ordinal < body.nodes.length; ordinal++) {
    counter.charge('maxProofNodes', 'K2-scalar-conclusion');
    const node = body.nodes[ordinal], syntax = expected[ordinal].syntax;
    const expectedOperation = expected[ordinal].operation;
    const payloadKeys = { entry: ['declaration'], exit: [], empty: [], returnVoid: [], fallthrough: [],
      tryEnter: [], finallyEnter: ['incoming', 'outerFinalizer'], finallyLeave: [],
      pendingException: ['exception', 'sourceInstruction'], resumeException: ['exception', 'sourceInstruction'],
      pendingReturnVoid: [], pendingReturn: ['input', 'term'], literal: ['term'],
      unaryLiteral: ['operatorOccurrence', 'operandOccurrence', 'term'],
      declare: ['location'], read: ['location', 'term'], write: ['location', 'input', 'term'], return: ['input', 'term'],
      endLocal: ['location', 'scopeOccurrence'], endParameter: ['location', 'scopeOccurrence'],
      update: ['location', 'input', 'operatorOccurrence', 'selected', 'written', 'term'],
      compoundWrite: ['location', 'savedLeft', 'left', 'right', 'operatorOccurrence', 'resultType', 'resultConversion', 'selected', 'term'],
      sourceCall: ['declaration', 'inputs', 'formalOrder', 'defaults', 'calleeBody', 'exceptions', 'term'],
      sourceCallVoid: ['declaration', 'inputs', 'formalOrder', 'defaults', 'calleeBody', 'exceptions'],
      conditionalBranch: ['input', 'term'], conditionalArm: ['branch', 'outcome'],
      conditionalJoin: ['branch', 'test', 'whenTrue', 'whenFalse', 'term'],
      shortCircuitBranch: ['input', 'term'], shortCircuitArm: ['branch', 'outcome'],
      shortCircuitJoin: ['branch', 'left', 'right', 'term'],
      statementBranch: ['input', 'term'], statementArm: ['branch', 'outcome'], statementJoin: ['branch', 'test'],
      statementContinuation: ['branch', 'test', 'returnedTail', 'normalTail', 'returnedOutcome'],
      returnMerge: ['branch', 'test', 'whenTrue', 'whenFalse', 'term'],
      returnMergeVoid: ['branch', 'test', 'whenTrue', 'whenFalse'],
      convert: ['input', 'conversion', 'term'], explicitCast: ['input', 'conversion', 'term'],
      scalarOperator: ['operatorOccurrence', 'selected', 'inputs', 'term'] }[expectedOperation];
    const guardedNumeric = expectedOperation === 'scalarOperator' && originalCheckedContext(syntax) === true &&
      (syntax.kind === 'binary' && ['+', '-', '*'].includes(syntax.operation) || syntax.kind === 'unary' && syntax.operation === '-');
    const guardedUpdate = expectedOperation === 'update' && originalCheckedContext(syntax) === true;
    const guardedCast = expectedOperation === 'explicitCast' && originalCheckedContext(syntax) === true;
    const checkedCompound = expectedOperation === 'compoundWrite' && originalCheckedContext(syntax) === true &&
      originalExpressionType(syntax.left).name !== 'bool';
    const compoundArithmetic = checkedCompound && ['+=', '-=', '*='].includes(syntax.operation);
    const compoundNarrowing = checkedCompound &&
      !originalImplicitConversion(originalExpressionType(syntax, 0, true), originalExpressionType(syntax.left));
    exactKeys(node, ['id', 'occurrence', 'sourceKind', 'operation', 'type', 'preStore', 'postStore', ...payloadKeys,
      ...(guardedNumeric || guardedUpdate || guardedCast ? ['overflow'] : []),
      ...(compoundArithmetic ? ['arithmeticOverflow'] : []), ...(compoundNarrowing ? ['narrowingOverflow'] : [])],
      'original scalar instruction');
    exactKeys(node.occurrence, ['unit', 'span', 'syntacticParent', 'ordinal'], 'original scalar occurrence');
    if ((expectedOperation === 'scalarOperator' ? !['numeric', 'boolean', 'integralComparison'].includes(node.operation) : node.operation !== expectedOperation) || node.sourceKind !== syntax.kind || node.id !== ordinal ||
        node.occurrence.ordinal !== ordinal || node.occurrence.unit !== original.unit)
      deny('INVALID_PROOF', 'instruction does not bind its actual ordered source occurrence');
    same(node.occurrence.span, syntax.origin, 'instruction span differs from its required original production');
    if (expectedOperation === 'entry') same(node.declaration, body.declaration, 'entry belongs to another original method');
    if (expectedOperation === 'finallyEnter')
      same({ incoming: node.incoming, outerFinalizer: node.outerFinalizer }, expected[ordinal].transfer,
        'finalizer allocation context differs from its original incoming CFG and enclosing continuation');
    if (expectedOperation === 'scalarOperator') {
      const token = syntax.operatorToken, decoded = original.parser.scanner.decoded;
      same(token.origin, decoded.origin(...token.origin.utf16), 'scalar operator token differs from original byte endpoints');
      if (decoded.text.slice(...token.origin.utf16) !== syntax.operation || token.spelling !== syntax.operation)
        deny('INVALID_PROOF', 'scalar operator spelling differs from original bytes');
    }
    if (['entry', 'exit', 'empty', 'returnVoid', 'fallthrough', 'tryEnter', 'finallyEnter', 'finallyLeave', 'pendingException', 'resumeException'].includes(node.operation) &&
        ['term', 'input', 'inputs', 'location', 'operatorOccurrence', 'selected', 'conversion'].some(key => Object.hasOwn(node, key)))
      deny('INVALID_PROOF', 'control-only instruction cannot introduce an arbitrary value conclusion');
    if (['entry', 'exit', 'empty', 'returnVoid', 'fallthrough', 'tryEnter', 'finallyEnter', 'finallyLeave', 'pendingException', 'resumeException'].includes(node.operation))
      same(node.type, signature.returnType, 'control instruction type differs from its independently bound method signature');
    const parent = compilation.sourceParents.get(syntax);
    same(node.occurrence.syntacticParent, { kind: parent?.kind, span: parent?.origin }, 'instruction parent differs from original syntax');
    if (node.type.name === 'void') {
      if (!['entry', 'exit', 'empty', 'returnVoid', 'pendingReturnVoid', 'fallthrough', 'tryEnter', 'finallyEnter', 'finallyLeave', 'pendingException', 'resumeException', 'returnMergeVoid', 'sourceCallVoid'].includes(node.operation))
        deny('INVALID_PROOF', 'Void cannot be an original scalar value/storage instruction');
      if (node.operation !== 'sourceCallVoid') same(node.type, signature.returnType, 'void control edge differs from its original method signature');
    } else scalarSort(node.type);
    const actualType = compilation.index.primitive(node.type.name, compilation.context(method), syntax.origin);
    if (!sameSelectedType(node.type, actualType)) deny('INVALID_PROOF', 'instruction scalar type differs from the original CLR binding');
    if (['conditionalArm', 'shortCircuitArm', 'statementArm'].includes(expectedOperation) && expected[ordinal].transfer.outcome === false) {
      const frame = branchStores.get(expected[ordinal].transfer.branch);
      if (!frame || frame.whenTrue) deny('INVALID_PROOF', 'branch false alternative lacks its original one-use store frame');
      frame.whenTrue = captureStore(); restoreStore(frame.incoming);
    }
    if (expectedOperation === 'statementContinuation' && expected[ordinal].transfer.returnedOutcome === false) {
      const frame = branchStores.get(expected[ordinal].transfer.branch);
      if (!frame?.whenTrue) deny('INVALID_PROOF', 'normal true continuation lacks original live store');
      restoreStore(frame.whenTrue);
    }
    if (expectedOperation === 'finallyEnter') {
      counter.charge('maxInvariantSteps', 'K2-original-finalizer-completion-frontier-store');
      const frontierStore = returnFrontierStores.get(expected[ordinal].transfer.incoming);
      if (!frontierStore) deny('INVALID_PROOF', 'finalizer lacks its original retained return frontier store');
      restoreStore(frontierStore);
    }
    if (['pendingException', 'resumeException'].includes(expectedOperation)) {
      counter.charge('maxInvariantSteps', 'K2-original-exception-transfer-store');
      const transfer = expected[ordinal].transfer, frontier = checkedExceptionFrontiers.get(transfer.exception);
      if (!frontier || frontier.exception.instruction !== transfer.sourceInstruction)
        deny('INVALID_PROOF', 'exception transfer loses its independently checked original failure');
      same({ exception: node.exception, sourceInstruction: node.sourceInstruction },
        { exception: transfer.exception, sourceInstruction: transfer.sourceInstruction },
        'exception transfer substitutes another original exception');
      if (transfer.initial) restoreStore(frontier.store);
    }
    same(node.preStore, storeSnapshot(), 'instruction incoming typed store differs from its original predecessor');
    if (node.operation === 'statementBranch') {
      const input = prior.get(node.input);
      if (syntax.kind !== 'if' || !input || input.type.name !== 'bool')
        deny('INVALID_PROOF', 'statement branch lacks original Boolean if condition');
      const originalText = original.parser.scanner.decoded.text, start = syntax.origin.utf16[0];
      if (originalText.slice(start, start + 2) !== 'if') deny('INVALID_PROOF', 'statement branch lacks original if keyword bytes');
      same(input.occurrence.span, valueSyntax(syntax.test).origin, 'if consumes another original test');
      same(node.type, originalExpressionType(syntax.test), 'if changes original test type');
      same(node.term, input.term, 'if changes original test value');
      branchStores.set(node.id, { incoming: captureStore(), whenTrue: null });
    } else if (node.operation === 'statementArm') {
      const transfer = expected[ordinal].transfer, branch = prior.get(node.branch);
      if (!transfer || branch?.operation !== 'statementBranch') deny('INVALID_PROOF', 'if arm has no original branch');
      same({ branch: node.branch, outcome: node.outcome }, transfer, 'if changes reached statement alternative');
      same(node.type, originalExpressionType(syntax.test), 'if arm changes original test type');
    } else if (node.operation === 'statementContinuation') {
      const transfer = expected[ordinal].transfer, branch = prior.get(node.branch), test = prior.get(node.test);
      const returnedTail = prior.get(node.returnedTail), normalTail = prior.get(node.normalTail);
      if (!transfer || branch?.operation !== 'statementBranch' || !test || branch.input !== test.id || !normalTail ||
          !returnedTail || !['return', 'returnVoid', 'returnMerge', 'returnMergeVoid', 'pendingReturn', 'pendingReturnVoid'].includes(returnedTail.operation))
        deny('INVALID_PROOF', 'mixed continuation loses original terminal/normal alternatives');
      same({ branch: node.branch, returnedTail: node.returnedTail, normalTail: node.normalTail,
        returnedOutcome: node.returnedOutcome }, transfer, 'mixed continuation substitutes original branch completion');
      same(test.occurrence.span, valueSyntax(syntax.test).origin, 'mixed continuation changes original decision');
      same(node.type, originalExpressionType(syntax.test), 'mixed continuation changes original decision type');
      const frame = branchStores.get(node.branch);
      if (!frame?.whenTrue) deny('INVALID_PROOF', 'mixed continuation has no original branch store frame');
      branchStores.delete(node.branch);
    } else if (['returnMerge', 'returnMergeVoid'].includes(node.operation)) {
      const transfer = expected[ordinal].transfer, branch = prior.get(node.branch), test = prior.get(node.test);
      const whenTrue = prior.get(node.whenTrue), whenFalse = prior.get(node.whenFalse);
      if (!transfer || branch?.operation !== 'statementBranch' || !test || branch.input !== test.id ||
          !whenTrue || !whenFalse || ![whenTrue.operation, whenFalse.operation].every(operation =>
            ['return', 'returnVoid', 'returnMerge', 'returnMergeVoid'].includes(operation)))
        deny('INVALID_PROOF', 'return merge lacks both original terminal return alternatives');
      same({ branch: node.branch, whenTrue: node.whenTrue, whenFalse: node.whenFalse }, transfer,
        'return merge substitutes original terminal instruction owners');
      same(test.occurrence.span, valueSyntax(syntax.test).origin, 'return merge substitutes original decision occurrence');
      same(node.type, signature.returnType, 'return merge changes original method result type');
      same(whenTrue.type, signature.returnType, 'true return changes original result type');
      same(whenFalse.type, signature.returnType, 'false return changes original result type');
      if (signature.returnType.name === 'void') {
        if (node.operation !== 'returnMergeVoid') deny('INVALID_PROOF', 'void return merge introduces a scalar value');
      } else {
        if (node.operation !== 'returnMerge') deny('INVALID_PROOF', 'value return merge drops its actual result');
        same(node.term, { kind: 'Op', opcode: 'ite', sort: scalarSort(signature.returnType),
          args: [test.term, whenTrue.term, whenFalse.term] }, 'return merge has another original result equation');
      }
      const frame = branchStores.get(node.branch);
      if (!frame?.whenTrue) deny('INVALID_PROOF', 'return merge lacks original terminal store alternatives');
      joinStores(frame.whenTrue, captureStore(), test.term, node.id); branchStores.delete(node.branch);
    } else if (node.operation === 'statementJoin') {
      const transfer = expected[ordinal].transfer, branch = prior.get(node.branch), test = prior.get(node.test);
      if (!transfer || node.branch !== transfer.branch || branch?.operation !== 'statementBranch' || !test || branch.input !== test.id)
        deny('INVALID_PROOF', 'if join loses original test/branch');
      same(test.occurrence.span, valueSyntax(syntax.test).origin, 'if join changes original condition occurrence');
      same(node.type, originalExpressionType(syntax.test), 'if join changes original decision type');
      const frame = branchStores.get(node.branch);
      if (!frame?.whenTrue) deny('INVALID_PROOF', 'if join lacks both original normal-completion frames');
      joinStores(frame.whenTrue, captureStore(), test.term, node.id); branchStores.delete(node.branch);
    } else if (node.operation === 'shortCircuitBranch') {
      const input = prior.get(node.input);
      if (syntax.kind !== 'binary' || !['&&', '||'].includes(syntax.operation) || !input || input.type.name !== 'bool')
        deny('INVALID_PROOF', 'short-circuit branch lacks its original Boolean left operand');
      const token = syntax.operatorToken, decoded = original.parser.scanner.decoded;
      same(token.origin, decoded.origin(...token.origin.utf16), 'short-circuit token changes original byte endpoints');
      if (decoded.text.slice(...token.origin.utf16) !== syntax.operation || token.spelling !== syntax.operation)
        deny('INVALID_PROOF', 'short-circuit spelling differs from original bytes');
      same(input.occurrence.span, valueSyntax(syntax.left).origin, 'short-circuit consumes another original left operand');
      same(node.type, originalExpressionType(syntax.left), 'short-circuit decision changes original type');
      same(node.term, input.term, 'short-circuit changes original decision value');
      branchStores.set(node.id, { incoming: captureStore(), whenTrue: null });
    } else if (node.operation === 'shortCircuitArm') {
      const transfer = expected[ordinal].transfer, branch = prior.get(node.branch);
      if (!transfer || branch?.operation !== 'shortCircuitBranch')
        deny('INVALID_PROOF', 'short-circuit arm loses its original decision');
      same({ branch: node.branch, outcome: node.outcome }, transfer, 'short-circuit changes reached alternative');
      same(node.type, originalExpressionType(syntax.left), 'short-circuit arm changes original decision type');
    } else if (node.operation === 'shortCircuitJoin') {
      const transfer = expected[ordinal].transfer, branch = prior.get(node.branch);
      const left = prior.get(node.left), right = prior.get(node.right);
      if (!transfer || node.branch !== transfer.branch || branch?.operation !== 'shortCircuitBranch' ||
          !left || !right || branch.input !== left.id)
        deny('INVALID_PROOF', 'short-circuit join loses original operands and branch');
      same([left.occurrence.span, right.occurrence.span], [syntax.left, syntax.right].map(child => valueSyntax(child).origin),
        'short-circuit join substitutes original child occurrences');
      same(node.type, originalExpressionType(syntax), 'short-circuit result changes original type');
      same(left.type, node.type, 'short-circuit left has another type');
      same(right.type, node.type, 'short-circuit right has another type');
      const constant = { kind: 'Constant', sort: 'Bool', value: syntax.operation === '||' };
      same(node.term, { kind: 'Op', opcode: 'ite', sort: 'Bool', args: syntax.operation === '&&'
        ? [left.term, right.term, constant] : [left.term, constant, right.term] },
        'short-circuit conclusion changes original reached-child selection');
      checkedBooleanLeaves += checkOriginalBooleanTruth(syntax.operation, [left.term, right.term],
        node.term, body.binder, body.slots, counter, originalPredicates);
      const frame = branchStores.get(node.branch);
      if (!frame?.whenTrue) deny('INVALID_PROOF', 'short-circuit join lacks both original reached store frames');
      joinStores(frame.whenTrue, captureStore(), left.term, node.id); branchStores.delete(node.branch);
    } else if (node.operation === 'conditionalBranch') {
      const input = prior.get(node.input);
      if (syntax.kind !== 'conditional' || !input || input.type.name !== 'bool')
        deny('INVALID_PROOF', 'conditional branch lacks its actual original Boolean test');
      same(input.occurrence.span, valueSyntax(syntax.test).origin, 'conditional branch consumes another original test');
      same(node.type, originalExpressionType(syntax.test), 'conditional branch changes its original test type');
      same(node.term, input.term, 'conditional decision changes its original Boolean value');
      branchStores.set(node.id, { incoming: captureStore(), whenTrue: null });
    } else if (node.operation === 'conditionalArm') {
      const transfer = expected[ordinal].transfer, branch = prior.get(node.branch);
      if (!branch || branch.operation !== 'conditionalBranch' || !transfer)
        deny('INVALID_PROOF', 'conditional arm has no original branch owner');
      same({ branch: node.branch, outcome: node.outcome }, transfer, 'conditional arm changes its original reached alternative');
      same(node.type, originalExpressionType(syntax.test), 'conditional arm has another original decision type');
    } else if (node.operation === 'conditionalJoin') {
      const transfer = expected[ordinal].transfer, branch = prior.get(node.branch);
      const test = prior.get(node.test), whenTrue = prior.get(node.whenTrue), whenFalse = prior.get(node.whenFalse);
      if (!transfer || node.branch !== transfer.branch || branch?.operation !== 'conditionalBranch' ||
          !test || !whenTrue || !whenFalse || branch.input !== test.id)
        deny('INVALID_PROOF', 'conditional join loses its original branch/test/value owners');
      same([test.occurrence.span, whenTrue.occurrence.span, whenFalse.occurrence.span],
        [syntax.test, syntax.whenTrue, syntax.whenFalse].map(child => valueSyntax(child).origin),
        'conditional join consumes another original test or child alternative');
      same(node.type, originalExpressionType(syntax), 'conditional join changes its original common result type');
      same(whenTrue.type, node.type, 'true alternative lacks its actual result type');
      same(whenFalse.type, node.type, 'false alternative lacks its actual result type');
      same(node.term, { kind: 'Op', opcode: 'ite', sort: scalarSort(node.type),
        args: [test.term, whenTrue.term, whenFalse.term] }, 'conditional conclusion differs from original branch selection');
      const frame = branchStores.get(node.branch);
      if (!frame?.whenTrue) deny('INVALID_PROOF', 'conditional join lacks both original reached store frames');
      joinStores(frame.whenTrue, captureStore(), test.term, node.id); branchStores.delete(node.branch);
    } else if (node.operation === 'declare') {
      if (syntax.kind !== 'local' || syntax.initializer || syntax.constant || syntax.type.kind === 'inferredType')
        deny('INVALID_PROOF', 'declaration does not bind an original uninitialized scalar local');
      const key = allocateOriginalLocation(syntax.declId, expected[ordinal].finalizer);
      if (storeTypes.has(key)) deny('INVALID_PROOF', 'original location is declared more than once');
      const type = compilation.index.resolve(syntax.type, { ...compilation.context(method), owner: syntax.declId });
      same(node.type, type, 'declaration changes its independently resolved original local type');
      same(node.location, storeLocations.get(key), 'declaration allocates another original location');
      storeTypes.set(key, type);
    } else if (node.operation === 'literal') {
      if (syntax.kind !== 'literal') deny('INVALID_PROOF', 'literal conclusion lacks original literal production');
      const literal = checkedOriginalLiteral(original.parser.scanner.decoded, syntax.token, 'csharp', counter);
      const alias = scalarAliases[literal.type];
      if (!alias) deny('INCOMPLETE_PROOF', 'literal requires another independently bound scalar type');
      if (node.type.name !== alias) deny('INVALID_PROOF', 'literal type differs from independently decoded original token');
      same(node.term, literal.term,
        'literal conclusion differs from independently decoded original bytes');
    } else if (['endLocal', 'endParameter'].includes(node.operation)) {
      const key = storageKey(syntax.declId), transfer = expected[ordinal].transfer;
      const requiredKind = node.operation === 'endLocal' ? 'local' : 'parameter';
      if (syntax.kind !== requiredKind || !storeTypes.has(key) || endedLocations.has(key) || !transfer?.scope)
        deny('INVALID_PROOF', 'local lifetime end lacks original unique scoped declaration');
      if (node.operation === 'endParameter' && !signature.parameters.some(formal =>
          formal.direction === 'value' && canonicalData(formal.declaration) === key))
        deny('INVALID_PROOF', 'parameter end substitutes another method/formal owner');
      same(node.location, storeLocations.get(key), 'scope end targets another original location');
      if (transfer.allocation !== undefined) {
        counter.charge('maxInvariantSteps', 'K2-original-exception-ended-allocation');
        const allocation = prior.get(transfer.allocation);
        if (!allocation || !['write', 'declare'].includes(allocation.operation))
          deny('INVALID_PROOF', 'exceptional local end lacks its original earlier allocation');
        same(node.location, allocation.location, 'exceptional local end substitutes another contextual allocation');
      }
      same(node.type, storeTypes.get(key), 'scope end changes original local type');
      same(node.scopeOccurrence, transfer.scope, 'scope end belongs to another original lexical block');
      store.delete(key); lastWrites.delete(key); endedLocations.add(key);
      activeLocations.delete(canonicalData(syntax.declId));
    } else if (node.operation === 'unaryLiteral') {
      if (!isOriginalMinimumLiteral(syntax)) deny('INVALID_PROOF', 'combined literal lacks original minimum-token production');
      const literal = checkedCsharpUnaryLiteral(original.parser.scanner.decoded, syntax, counter);
      same(node.type, originalExpressionType(syntax), 'combined minimum literal has another original type');
      same(node.term, literal.term, 'combined minimum literal differs from independently decoded token equation');
      same(node.operatorOccurrence, syntax.operatorToken.origin, 'combined literal has another original minus token');
      same(node.operandOccurrence, syntax.operand.origin, 'combined literal has another original integer token');
    } else if (node.operation === 'read') {
      if (syntax.kind !== 'name') deny('INVALID_PROOF', 'read conclusion lacks original name production');
      const binding = compilation.names.get(original.unit).lookup(syntax.name, syntax);
      if (binding.kind !== 'declaration') deny('INVALID_PROOF', 'read lacks a unique original storage declaration');
      same(node.location, storeLocations.get(storageKey(binding.declarations[0])), 'read uses another original location');
      const term = store.get(storageKey(binding.declarations[0]));
      if (!term) deny('INVALID_PROOF', 'read is not defined on its incoming store');
      same(node.type, storeTypes.get(storageKey(binding.declarations[0])), 'read changes original storage type');
      same(node.term, term, 'read conclusion differs from original incoming store');
    } else if (node.operation === 'update') {
      const binding = compilation.names.get(original.unit).lookup(syntax.operand.name, syntax.operand);
      if (binding.kind !== 'declaration') deny('INVALID_PROOF', 'update has no unique original lexical location');
      const declaration = binding.declarations[0], key = storageKey(declaration);
      if (originalIntegralConstants.has(canonicalData(declaration)) || originalBooleanConstants.has(canonicalData(declaration)))
        deny('INVALID_PROOF', 'update targets original constant storage');
      const before = store.get(key), input = prior.get(node.input), token = syntax.operatorToken;
      if (!before || !input || input.operation !== 'read') deny('INVALID_PROOF', 'update lacks original definitely assigned read');
      same(input.occurrence.span, syntax.operand.origin, 'update consumes another original operand');
      same(node.location, storeLocations.get(key), 'update targets another original location');
      same(input.location, node.location, 'update read and write disagree on original location');
      same(node.type, storeTypes.get(key), 'update changes original storage type');
      same(node.type, originalExpressionType(syntax), 'update differs from original result type');
      same(input.type, node.type, 'update promotes its storage instead of retaining original type');
      const identity = ['named', node.type.declaration, [], null];
      same(node.selected, { language: 'csharp', operation: syntax.operation, parameters: [identity], result: identity },
        'update intrinsic differs from independently bound original primitive storage signature');
      same(input.term, before, 'update read differs from incoming original storage');
      same(node.operatorOccurrence, token.origin, 'update operator occurrence differs');
      same(token.origin, original.parser.scanner.decoded.origin(...token.origin.utf16), 'update original token byte endpoints differ');
      if (token.spelling !== syntax.operation || original.parser.scanner.decoded.text.slice(...token.origin.utf16) !== syntax.operation)
        deny('INVALID_PROOF', 'update original operator spelling differs');
      const sort = scalarSort(node.type), written = { kind: 'Op', opcode: syntax.operation === '++' ? 'add' : 'sub', sort,
        args: [before, { kind: 'Constant', sort, value: '1' }] };
      same(node.written, written, 'update has another original width/result store equation');
      checkTerm(node.written, termIdentities);
      same(termSort(node.written, termMetadata), sort, 'update store equation has another closed sort');
      same(node.term, syntax.kind === 'postfix' ? before : written, 'update confuses prefix/postfix original value');
      if (guardedUpdate) {
        const modulus = 1n << BigInt(sort.width);
        const lower = sort.signed ? -modulus / 2n : 0n, upper = sort.signed ? modulus / 2n - 1n : modulus - 1n;
        const mathematical = { kind: 'Op', opcode: syntax.operation === '++' ? 'add' : 'sub', sort: 'Z', args: [
          { kind: 'Op', opcode: 'bvToZ', sort: 'Z', args: [before] }, { kind: 'Constant', sort: 'Z', value: '1' }] };
        const overflow = { kind: 'Op', opcode: 'ite', sort: 'Bool', args: [
          { kind: 'Op', opcode: 'zLt', sort: 'Bool', args: [mathematical, { kind: 'Constant', sort: 'Z', value: lower.toString() }] },
          { kind: 'Constant', sort: 'Bool', value: true },
          { kind: 'Op', opcode: 'zGt', sort: 'Bool', args: [mathematical, { kind: 'Constant', sort: 'Z', value: upper.toString() }] }] };
        same(node.overflow, overflow, 'checked update changes original storage-range failure');
        checkTerm(overflow, termIdentities);
        same(termSort(overflow, termMetadata), 'Bool', 'update overflow condition is not Boolean');
        counter.charge('maxInvariantSteps', 'K2-original-checked-update-exception');
        retainCheckedException({ ordinal: exceptionalCompletions.length, instruction: node.id,
          category: 'System.OverflowException', condition: overflow, store: storeSnapshot() }, expected[ordinal]);
      }
      store.set(key, written); lastWrites.set(key, node.id);
    } else if (node.operation === 'compoundWrite') {
      if (syntax.kind !== 'assignment' || syntax.left.kind !== 'name' ||
          !['+=', '-=', '*=', '&=', '|=', '^=', '<<=', '>>='].includes(syntax.operation))
        deny('INVALID_PROOF', 'compound write has no original scalar assignment');
      const binding = compilation.names.get(original.unit).lookup(syntax.left.name, syntax.left);
      if (binding.kind !== 'declaration') deny('INVALID_PROOF', 'compound write lacks unique original lexical storage');
      const declaration = binding.declarations[0], key = storageKey(declaration), type = storeTypes.get(key);
      if (!type || originalIntegralConstants.has(canonicalData(declaration)) || originalBooleanConstants.has(canonicalData(declaration)))
        deny('INVALID_PROOF', 'compound write lacks mutable original storage');
      const boolean = type.category === 'primitive' && type.name === 'bool';
      const shift = ['<<=', '>>='].includes(syntax.operation);
      if (boolean ? !['&=', '|=', '^='].includes(syntax.operation) : type.category !== 'primitive' ||
          !['sbyte', 'byte', 'short', 'ushort', 'char', 'int', 'uint', 'long', 'ulong'].includes(type.name) ||
          typeof originalCheckedContext(syntax) !== 'boolean')
        deny('INCOMPLETE_PROOF', 'compound write requires original checked/promotion/domain proof');
      same(originalExpressionType(syntax.left), type, 'compound location type differs');
      const operatorType = originalExpressionType(syntax, 0, true);
      const rightType = shift ? compilation.index.primitive('int', compilation.context(method), syntax.right.origin) : operatorType;
      const savedLeft = prior.get(node.savedLeft), left = prior.get(node.left), right = prior.get(node.right);
      if (!savedLeft || !left || !right || savedLeft.operation !== 'read' || savedLeft.id >= right.id)
        deny('INVALID_PROOF', 'compound write lacks once-only original read before RHS');
      same(node.location, storeLocations.get(key), 'compound write targets another location');
      same(savedLeft.location, node.location, 'compound read targets another location');
      same(savedLeft.occurrence.span, syntax.left.origin, 'compound read lacks original left occurrence');
      same(right.occurrence.span, right.operation === 'convert' ? syntax.right.origin : valueSyntax(syntax.right).origin, 'compound RHS differs from original expression');
      same(savedLeft.type, type, 'compound read changes original storage type');
      same(left.type, operatorType, 'compound left promotion differs');
      if (canonicalData(type) === canonicalData(operatorType)) same(left.id, savedLeft.id, 'compound repeats original left read');
      else if (left.operation !== 'convert' || left.input !== savedLeft.id)
        deny('INVALID_PROOF', 'compound promotion does not consume saved original left');
      same(right.type, rightType, 'compound RHS changes original signature type');
      same(node.type, type, 'compound result changes original storage type');
      same(node.resultType, operatorType, 'compound operator result differs from original promotion');
      let resultConversion = originalImplicitConversion(operatorType, type);
      if (!resultConversion) {
        if (boolean ||
            (!shift && !originalImplicitConversion(originalExpressionType(syntax.right), type, originalIntegralConstant(syntax.right))))
          deny('INCOMPLETE_PROOF', 'compound back conversion lacks original permitted rule');
        resultConversion = { kind: 'explicitIntegral', source: operatorType.name, target: type.name, checkedContext: originalCheckedContext(syntax) };
      }
      same(node.resultConversion, resultConversion, 'compound back conversion differs from original language rule');
      const token = syntax.operatorToken, decoded = original.parser.scanner.decoded;
      same(node.operatorOccurrence, token.origin, 'compound token occurrence differs');
      same(token.origin, decoded.origin(...token.origin.utf16), 'compound token original endpoints differ');
      if (token.spelling !== syntax.operation || decoded.text.slice(...token.origin.utf16) !== syntax.operation)
        deny('INVALID_PROOF', 'compound token spelling differs from original bytes');
      const operation = syntax.operation.slice(0, -1), identity = ['named', operatorType.declaration, [], null];
      same(node.selected, { language: 'csharp', operation, parameters: [identity, ['named', rightType.declaration, [], null]], result: identity },
        'compound signature differs from independently bound same-type primitive operator');
      const choose = (test, yes, no) => ({ kind: 'Op', opcode: 'ite', sort: 'Bool', args: [test, yes, no] });
      const bool = value => ({ kind: 'Constant', sort: 'Bool', value });
      const args = [left.term, right.term];
      if (shift) args[1] = { kind: 'Op', opcode: 'cast', sort: 'Z', args: [
        { kind: 'Op', opcode: 'bitand', sort: scalarSort(rightType), args: [right.term,
          { kind: 'Constant', sort: scalarSort(rightType), value: ['long', 'ulong'].includes(operatorType.name) ? '63' : '31' }] }] };
      const operatorTerm = boolean ? operation === '&' ? choose(left.term, right.term, bool(false)) :
        operation === '|' ? choose(left.term, bool(true), right.term) :
        choose(left.term, choose(right.term, bool(false), bool(true)), right.term) :
        { kind: 'Op', opcode: { '+': 'add', '-': 'sub', '*': 'mul', '&': 'bitand', '|': 'bitor', '^': 'bitxor', '<<': 'shl', '>>': 'shr' }[operation],
          sort: scalarSort(operatorType), args };
      const term = canonicalData(type) === canonicalData(operatorType) ? operatorTerm :
        { kind: 'Op', opcode: 'cast', sort: scalarSort(type), args: [operatorTerm] };
      same(node.term, term, 'compound write changes original saved-left/operator equation');
      const rangeFailure = (mathematical, target) => {
        const sort = scalarSort(target), modulus = 1n << BigInt(sort.width);
        const lower = sort.signed ? -modulus / 2n : 0n, upper = sort.signed ? modulus / 2n - 1n : modulus - 1n;
        return { kind: 'Op', opcode: 'ite', sort: 'Bool', args: [
          { kind: 'Op', opcode: 'zLt', sort: 'Bool', args: [mathematical, { kind: 'Constant', sort: 'Z', value: lower.toString() }] },
          bool(true), { kind: 'Op', opcode: 'zGt', sort: 'Bool', args: [mathematical, { kind: 'Constant', sort: 'Z', value: upper.toString() }] }] };
      };
      const arithmeticFailure = compoundArithmetic ? rangeFailure({ kind: 'Op', opcode: operatorTerm.opcode,
        sort: 'Z', args: [left.term, right.term].map(value => ({ kind: 'Op', opcode: 'bvToZ', sort: 'Z', args: [value] })) }, operatorType) : null;
      const conversionFailure = compoundNarrowing ? rangeFailure({ kind: 'Op', opcode: 'bvToZ', sort: 'Z', args: [operatorTerm] }, type) : null;
      const narrowingFailure = conversionFailure && (arithmeticFailure ? choose(arithmeticFailure, bool(false), conversionFailure) : conversionFailure);
      for (const [field, failure] of [['arithmeticOverflow', arithmeticFailure], ['narrowingOverflow', narrowingFailure]]) {
        counter.charge('maxInvariantSteps', 'K2-original-compound-failure-site');
        if (!failure) continue;
        same(node[field], failure, 'compound failure differs from original ordered arithmetic/conversion site');
        checkTerm(failure, termIdentities);
        same(termSort(failure, termMetadata), 'Bool', 'compound failure is not Boolean');
        retainCheckedException({ ordinal: exceptionalCompletions.length, instruction: node.id,
          category: 'System.OverflowException', condition: failure, store: storeSnapshot() }, expected[ordinal]);
      }
      store.set(key, term); lastWrites.set(key, node.id);
    } else if (node.operation === 'write') {
      const assignment = syntax.kind === 'assignment';
      let declaration, initializer;
      if (assignment) {
        if (syntax.operation !== '=' || syntax.left.kind !== 'name') deny('INCOMPLETE_PROOF', 'write requires complete original lvalue transfer');
        const token = syntax.operatorToken, decoded = original.parser.scanner.decoded;
        same(token.origin, decoded.origin(...token.origin.utf16), 'assignment token span differs from original bytes');
        if (decoded.text.slice(...token.origin.utf16) !== '=') deny('INVALID_PROOF', 'assignment has no original simple assignment token');
        const binding = compilation.names.get(original.unit).lookup(syntax.left.name, syntax.left);
        if (binding.kind !== 'declaration') deny('INVALID_PROOF', 'assignment target lacks unique original lexical storage');
        declaration = binding.declarations[0]; initializer = syntax.right;
        if (originalIntegralConstants.has(canonicalData(declaration)) || originalBooleanConstants.has(canonicalData(declaration)))
          deny('INVALID_PROOF', 'original constant local cannot be an assignment target');
        if (!storeTypes.has(storageKey(declaration))) deny('INCOMPLETE_PROOF', 'assignment requires original allocated scalar storage');
        same(node.type, storeTypes.get(storageKey(declaration)), 'assignment changes original storage type');
      } else {
        if (syntax.kind !== 'local' || !syntax.initializer) deny('INCOMPLETE_PROOF', 'write requires its original local declaration production');
        declaration = syntax.declId; initializer = syntax.initializer;
      }
      const key = assignment ? storageKey(declaration) : allocateOriginalLocation(declaration, expected[ordinal].finalizer);
      same(node.location, storeLocations.get(key), 'write targets another original location');
      if (!assignment && syntax.type.kind !== 'inferredType') {
        const type = compilation.index.resolve(syntax.type, { ...compilation.context(method), owner: syntax.declId });
        same(node.type, type, 'write type differs from its original declaration');
      }
      const input = prior.get(node.input);
      if (!input) deny('INVALID_PROOF', 'write lacks a preceding original input');
      same(input.occurrence.span, input.operation === 'convert' ? initializer.origin : valueSyntax(initializer).origin,
        'write consumes another original initializer');
      same(input.type, node.type, 'write input type differs from its original storage after required conversion');
      same(node.term, input.term, 'write conclusion changes its input value');
      store.set(key, node.term);
      storeTypes.set(key, node.type);
      lastWrites.set(key, node.id);
    } else if (['convert', 'explicitCast'].includes(node.operation)) {
      const transfer = expected[ordinal].transfer, input = prior.get(node.input);
      if (!transfer || !input) deny('INVALID_PROOF', 'conversion lacks its original source input and type equation');
      same(input.occurrence.span, valueSyntax(node.operation === 'explicitCast' ? syntax.operand : syntax).origin,
        'conversion consumes another original expression');
      same(input.type, transfer.source, 'conversion source type differs from independently bound original storage/literal');
      same(node.type, transfer.target, 'conversion target differs from original assignment/return owner');
      same(node.conversion, transfer.conversion, 'conversion metadata differs from the original selected integral relation');
      same(node.term, { kind: 'Op', opcode: 'cast', sort: scalarSort(transfer.target), args: [input.term] },
        'conversion conclusion differs from the original selected integral equation');
      if (guardedCast) {
        const sort = scalarSort(transfer.target), modulus = 1n << BigInt(sort.width);
        const lower = sort.signed ? -modulus / 2n : 0n, upper = sort.signed ? modulus / 2n - 1n : modulus - 1n;
        const mathematical = { kind: 'Op', opcode: 'bvToZ', sort: 'Z', args: [input.term] };
        const overflow = { kind: 'Op', opcode: 'ite', sort: 'Bool', args: [
          { kind: 'Op', opcode: 'zLt', sort: 'Bool', args: [mathematical, { kind: 'Constant', sort: 'Z', value: lower.toString() }] },
          { kind: 'Constant', sort: 'Bool', value: true },
          { kind: 'Op', opcode: 'zGt', sort: 'Bool', args: [mathematical, { kind: 'Constant', sort: 'Z', value: upper.toString() }] }] };
        same(node.overflow, overflow, 'checked cast changes its original target-range failure');
        checkTerm(overflow, termIdentities);
        same(termSort(overflow, termMetadata), 'Bool', 'cast overflow condition is not Boolean');
        const constant = originalIntegralConstant(syntax.operand);
        if (constant !== null && (constant < lower || constant > upper))
          deny('INVALID_PROOF', 'checked original constant integral cast overflows');
        counter.charge('maxInvariantSteps', 'K2-original-checked-cast-exception');
        retainCheckedException({ ordinal: exceptionalCompletions.length, instruction: node.id,
          category: 'System.OverflowException', condition: overflow, store: storeSnapshot() }, expected[ordinal]);
      }
    } else if (node.operation === 'boolean') {
      const unary = syntax.kind === 'unary', inputs = node.inputs.map(id => prior.get(id));
      if (node.type.name !== 'bool' || inputs.length !== (unary ? 1 : 2) ||
          inputs.some(input => !input || input.type.name !== 'bool') ||
          !(unary ? ['!'] : ['&', '|', '^', '==', '!=']).includes(syntax.operation))
        deny('INVALID_PROOF', 'Boolean transfer differs from original typed operands/operator');
      same(inputs.map(input => input.occurrence.span), (unary ? [syntax.operand] : [syntax.left, syntax.right])
        .map(child => valueSyntax(child).origin), 'Boolean operands differ from original eager ordered children');
      same(node.operatorOccurrence, syntax.operatorToken.origin, 'Boolean token differs from original occurrence');
      const constant = value => ({ kind: 'Constant', sort: 'Bool', value });
      const ite = (test, yes, no) => ({ kind: 'Op', opcode: 'ite', sort: 'Bool', args: [test, yes, no] });
      const [left, right] = inputs.map(input => input.term);
      const expectedTerm = unary ? ite(left, constant(false), constant(true)) : syntax.operation === '&'
        ? ite(left, right, constant(false)) : syntax.operation === '|' ? ite(left, constant(true), right)
          : syntax.operation === '==' ? ite(left, right, ite(right, constant(false), constant(true)))
            : ite(left, ite(right, constant(false), constant(true)), right);
      same(node.term, expectedTerm, 'Boolean conclusion differs from exhaustive original truth equation');
      checkedBooleanLeaves += checkOriginalBooleanTruth(syntax.operation, inputs.map(input => input.term),
        node.term, body.binder, body.slots, counter, originalPredicates);
    } else if (node.operation === 'integralComparison') {
      const opcode = { '==': 'bvEq', '!=': 'bvNe', '<': 'bvLt', '<=': 'bvLe', '>': 'bvGt', '>=': 'bvGe' }[syntax.operation];
      const target = originalExpressionType(syntax, 0, true);
      if (syntax.kind !== 'binary' || !opcode || typeof originalCheckedContext(syntax) !== 'boolean' ||
          target.category !== 'primitive' || !['int', 'uint', 'long', 'ulong'].includes(target.name) ||
          node.type.name !== 'bool') deny('INCOMPLETE_PROOF', 'comparison requires original integral promotion and Boolean result');
      const inputs = node.inputs.map(id => prior.get(id));
      if (inputs.length !== 2 || inputs.some(input => !input || !sameSelectedType(input.type, target)))
        deny('INVALID_PROOF', 'comparison inputs differ from independently derived operand promotion');
      same(inputs.map(input => input.occurrence.span), [syntax.left, syntax.right].map((child, index) =>
        inputs[index].operation === 'convert' ? child.origin : valueSyntax(child).origin),
        'comparison inputs differ from original left-to-right source occurrences');
      same(node.operatorOccurrence, syntax.operatorToken.origin, 'comparison operator differs from original token');
      same(node.term, { kind: 'Op', opcode, sort: 'Bool', args: inputs.map(input => input.term) },
        'comparison conclusion differs from exact signed/unsigned original integral equation');
      originalPredicates.add(canonicalData(node.term));
    } else if (node.operation === 'numeric') {
      const checked = originalCheckedContext(syntax);
      const unary = syntax.kind === 'unary';
      const shift = ['<<', '>>'].includes(syntax.operation);
      const bitwise = ['&', '|', '^', '~'].includes(syntax.operation);
      if (typeof checked !== 'boolean' || (!unary && syntax.kind !== 'binary') ||
          !(unary ? ['+', '-', '~'] : ['+', '-', '*', '&', '|', '^', '<<', '>>']).includes(syntax.operation))
        deny('INCOMPLETE_PROOF', 'numeric checker requires its original integral overflow context');
      const inputs = node.inputs.map(id => prior.get(id));
      if (!['int', 'uint', 'long', 'ulong'].includes(node.type.name) ||
          inputs.length !== (unary ? 1 : 2) || inputs.some((input, ordinal) => !input ||
            input.type.category !== 'primitive' || (shift && ordinal === 1 ? input.type.name !== 'int' : !sameSelectedType(input.type, node.type))))
        deny('INCOMPLETE_PROOF', 'numeric checker requires independently bound equal-width integral operands');
      // Unary minus on UInt32 promotes to Int64; UInt64 has no predefined
      // unary minus. These require their original promotion/conversion roster,
      // never the same-width wrap equation used for signed unary minus.
      if (unary && syntax.operation === '-' && ['uint', 'ulong'].includes(node.type.name))
        deny('INVALID_PROOF', 'unsigned unary minus cannot use a same-width integral conclusion');
      same(inputs.map(input => input.occurrence.span), (unary ? [syntax.operand] : [syntax.left, syntax.right])
        .map((child, index) => inputs[index].operation === 'convert' ? child.origin : valueSyntax(child).origin),
        'numeric operands differ from original ordered children and required promotions');
      same(node.operatorOccurrence, syntax.operatorToken.origin, 'numeric operator differs from original token');
      const args = inputs.map(input => input.term);
      if (shift) args[1] = { kind: 'Op', opcode: 'cast', sort: 'Z', args: [
        { kind: 'Op', opcode: 'bitand', sort: scalarSort(inputs[1].type), args: [args[1],
          { kind: 'Constant', sort: scalarSort(inputs[1].type), value: ['long', 'ulong'].includes(node.type.name) ? '63' : '31' }] }] };
      same(node.term, { kind: 'Op', opcode: (unary ? { '+': 'cast', '-': 'neg', '~': 'bitnot' } :
        { '+': 'add', '-': 'sub', '*': 'mul', '&': 'bitand', '|': 'bitor', '^': 'bitxor', '<<': 'shl', '>>': 'shr' })[syntax.operation],
        sort: scalarSort(node.type), args }, 'numeric conclusion differs from original integral equation');
      if (guardedNumeric) {
        const sort = scalarSort(node.type), modulus = 1n << BigInt(sort.width);
        const lower = sort.signed ? -modulus / 2n : 0n, upper = sort.signed ? modulus / 2n - 1n : modulus - 1n;
        const mathematical = { kind: 'Op', opcode: node.term.opcode, sort: 'Z', args: inputs.map(input =>
          ({ kind: 'Op', opcode: 'bvToZ', sort: 'Z', args: [input.term] })) };
        const overflow = { kind: 'Op', opcode: 'ite', sort: 'Bool', args: [
          { kind: 'Op', opcode: 'zLt', sort: 'Bool', args: [mathematical, { kind: 'Constant', sort: 'Z', value: lower.toString() }] },
          { kind: 'Constant', sort: 'Bool', value: true },
          { kind: 'Op', opcode: 'zGt', sort: 'Bool', args: [mathematical, { kind: 'Constant', sort: 'Z', value: upper.toString() }] }] };
        same(node.overflow, overflow, 'checked arithmetic changes its original mathematical overflow alternatives');
        checkTerm(overflow, termIdentities);
        same(termSort(overflow, termMetadata), 'Bool', 'overflow condition is not Boolean');
        const constant = originalIntegralConstant(syntax);
        // A runtime overflow alternative is not permission to accept an invalid
        // checked constant expression. The original constant walker is separate.
        if (constant !== null && (constant < lower || constant > upper))
          deny('INVALID_PROOF', 'checked original constant expression overflows');
        counter.charge('maxInvariantSteps', 'K2-original-checked-exception-completion');
        retainCheckedException({ ordinal: exceptionalCompletions.length, instruction: node.id, category: 'System.OverflowException',
          condition: overflow, store: storeSnapshot() }, expected[ordinal]);
      }
    } else if (['sourceCall', 'sourceCallVoid'].includes(node.operation)) {
      const candidate = originalCall(syntax), order = originalFormalOrder(syntax, candidate);
      same(node.declaration, candidate.declaration, 'call selects another original callee');
      same(node.formalOrder, order, 'call changes original source-to-formal correspondence');
      same(node.type, candidate.returnType, 'call changes original return type');
      if (!Array.isArray(node.inputs) || node.inputs.length !== syntax.arguments.length)
        deny('INVALID_PROOF', 'call omits original arguments');
      const inputs = node.inputs.map((id, ordinal) => {
        const input = prior.get(id), argument = syntax.arguments[ordinal].expression;
        if (!input) deny('INVALID_PROOF', 'call lacks earlier original argument');
        same(input.occurrence.span, input.operation === 'convert' ? argument.origin : valueSyntax(argument).origin,
          'call reorders or substitutes original argument');
        same(input.type, candidate.parameters[order[ordinal]].type, 'call lacks original formal conversion');
        return input;
      });
      const formalValues = new Array(candidate.parameters.length);
      for (let sourceIndex = 0; sourceIndex < inputs.length; sourceIndex++) {
        counter.charge('maxInvariantSteps', 'K2-original-call-formal-value');
        formalValues[order[sourceIndex]] = inputs[sourceIndex];
      }
      const defaults = originalDefaults(candidate, order);
      same(node.defaults, defaults, 'call supplies another original omitted literal/conversion');
      for (const value of defaults) {
        counter.charge('maxInvariantSteps', 'K2-original-call-default-value');
        formalValues[value.formal] = { term: value.term };
      }
      same(node.calleeBody.declaration, candidate.declaration, 'call supplies another original callee body');
      counter.charge('maxInvariantSteps', 'K2-original-prechecked-callee-association');
      if (precheckedCallees.get(node.id) !== node.calleeBody)
        deny('INVALID_PROOF', 'call loses its same independently source-checked callee proof');
      const substitute = (term, level = 0) => {
        counter.charge('maxInvariantSteps', 'K2-original-callee-substitution');
        if (level >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'checked callee substitution depth exhausted');
        if (term.kind === 'Bound') {
          same(term.binder, node.calleeBody.binder, 'callee result contains another original binder');
          if (!formalValues[term.index]) deny('INVALID_PROOF', 'callee result contains another original formal');
          return formalValues[term.index].term;
        }
        if (term.kind === 'Constant') return { ...term };
        if (term.kind !== 'Op') deny('INCOMPLETE_PROOF', 'callee result requires another original closed constructor');
        return { ...term, args: term.args.map(argument => substitute(argument, level + 1)) };
      };
      const exceptions = checkedCalleeExceptions(node.calleeBody, substitute, counter);
      same(node.exceptions, exceptions, 'call changes an original callee exception path or substituted condition');
      for (const failure of exceptions) {
        counter.charge('maxInvariantSteps', 'K2-original-call-exception-completion');
        checkTerm(failure.condition, termIdentities);
        same(termSort(failure.condition, termMetadata), 'Bool', 'call exception path is not an original Boolean condition');
        retainCheckedException({ ordinal: exceptionalCompletions.length, instruction: node.id,
          category: failure.category, condition: failure.condition, store: storeSnapshot() }, expected[ordinal]);
      }
      if (candidate.returnType.name === 'void') {
        if (node.operation !== 'sourceCallVoid') deny('INVALID_PROOF', 'void call introduces an original scalar value');
      } else {
      if (node.operation !== 'sourceCall') deny('INVALID_PROOF', 'value call drops its original returned equation');
      const returnIds = new Set(), coveredReturns = new Set(), outgoing = new Map();
      for (const calleeNode of node.calleeBody.nodes) {
        counter.charge('maxInvariantSteps', 'K2-original-call-return-frontier');
        outgoing.set(calleeNode.id, []);
      }
      for (const frontier of node.calleeBody.finalFrontiers) {
        counter.charge('maxInvariantSteps', 'K2-original-call-final-return-frontier');
        if (['return', 'returnVoid'].includes(frontier.kind)) returnIds.add(frontier.instruction);
      }
      for (const edge of node.calleeBody.edges) {
        counter.charge('maxInvariantSteps', 'K2-original-call-return-edge');
        if (edge.completion !== 'throw') outgoing.get(edge.from).push(edge);
      }
      const results = new Map(), active = new Set();
      const returnEquation = (id, level = 0) => {
        const chain = []; let term;
        for (;;) {
          counter.charge('maxInvariantSteps', 'K2-original-call-return-path');
          if (level >= K2_LIMITS.maxTermDepth) deny('EXHAUSTED', 'checked call return path depth exhausted');
          if (results.has(id)) { term = results.get(id); break; }
          if (active.has(id)) deny('INCOMPLETE_PROOF', 'call requires original cyclic control contract');
          const calleeNode = node.calleeBody.nodes[id];
          if (!calleeNode) deny('INVALID_PROOF', 'call return path lacks an original checked node');
          active.add(id); chain.push(id);
          if (calleeNode.operation === 'return') { coveredReturns.add(id); term = calleeNode.term; }
          else {
            const edges = outgoing.get(id);
            if (edges.length === 1 && (edges[0].branch === null || edges[0].branch.outcome === 'normal')) { id = edges[0].to; continue; }
            else if (edges.length === 2 && edges.every(edge => edge.branch?.source === id) &&
                edges.some(edge => edge.branch.outcome === true) && edges.some(edge => edge.branch.outcome === false) &&
                ['statementBranch', 'conditionalBranch', 'shortCircuitBranch'].includes(calleeNode.operation)) {
              const yes = returnEquation(edges.find(edge => edge.branch.outcome === true).to, level + 1);
              const no = returnEquation(edges.find(edge => edge.branch.outcome === false).to, level + 1);
              term = canonicalData(yes) === canonicalData(no) ? yes :
                { kind: 'Op', opcode: 'ite', sort: scalarSort(candidate.returnType), args: [calleeNode.term, yes, no] };
            } else deny('INCOMPLETE_PROOF', 'call requires complete original void/exceptional control transfer');
          }
          break;
        }
        for (const visited of chain) { active.delete(visited); results.set(visited, term); }
        return term;
      };
      const returnedTerm = returnEquation(node.calleeBody.entry);
      if (returnIds.size !== coveredReturns.size)
        deny('INCOMPLETE_PROOF', 'call requires every original checked return path');
      for (const id of returnIds) {
        counter.charge('maxInvariantSteps', 'K2-original-call-return-coverage');
        if (!coveredReturns.has(id)) deny('INCOMPLETE_PROOF', 'call omits an original checked final return frontier');
      }
      same(node.term, substitute(returnedTerm), 'call result is not its checked original callee equation');
      }
    } else if (['return', 'pendingReturn'].includes(node.operation)) {
      if (syntax.kind !== 'return' || !syntax.value) deny('INVALID_PROOF', 'return lacks its original value production');
      const input = prior.get(node.input);
      if (!input) deny('INVALID_PROOF', 'return lacks a preceding input');
      same(input.occurrence.span, input.operation === 'convert' ? syntax.value.origin : valueSyntax(syntax.value).origin,
        'return consumes another source expression');
      same(input.type, signature.returnType, 'return input lacks its original result conversion');
      same(node.term, input.term, 'return changes its original input value');
      same(node.type, signature.returnType, 'return differs from original method return type');
      if (expected[ordinal].transfer?.pending !== undefined) {
        const pending = prior.get(expected[ordinal].transfer.pending);
        if (!pending || pending.operation !== 'pendingReturn') deny('INVALID_PROOF', 'return lost its original pending completion');
        same(node.input, pending.input, 'finalizer resume reevaluates or substitutes the saved return input');
        same(node.term, pending.term, 'finalizer resume changes the saved return value');
      }
    } else if (!['entry', 'exit', 'empty', 'returnVoid', 'pendingReturnVoid', 'fallthrough', 'tryEnter', 'finallyEnter', 'finallyLeave', 'pendingException', 'resumeException'].includes(node.operation)) deny('INCOMPLETE_PROOF', 'scalar instruction conclusion still requires its independent rule');
    if (expectedOperation === 'scalarOperator') {
      const identity = type => ['named', type.declaration, [], null];
      same(node.selected, { language: 'csharp', operation: syntax.operation,
        parameters: node.inputs.map(id => identity(prior.get(id).type)), result: identity(node.type) },
      'operator intrinsic identity differs from original typed scalar signature');
    }
    if (Object.hasOwn(node, 'term')) {
      checkTerm(node.term, termIdentities);
      same(termSort(node.term, termMetadata), scalarSort(node.type),
        'instruction closed term sort differs from its independently bound original type');
    }
    same(node.postStore, storeSnapshot(), 'instruction changes another original location or publishes the wrong store');
    counter.charge('maxInvariantSteps', 'K2-original-method-completion-frontier');
    if (['return', 'returnVoid', 'fallthrough'].includes(expectedOperation))
      finalFrontiers.push({ kind: expectedOperation === 'fallthrough' ? 'normal' : expectedOperation,
        instruction: node.id, store: storeSnapshot(),
        ...(expectedOperation === 'return' ? { input: node.input, term: node.term } : {}) });
    if (expectedOperation === 'resumeException') {
      const failure = checkedExceptionFrontiers.get(node.exception)?.exception;
      if (!failure || failure.instruction !== node.sourceInstruction)
        deny('INVALID_PROOF', 'terminal throw lacks its independently checked source failure');
      finalFrontiers.push({ kind: 'throw', instruction: node.id, sourceInstruction: failure.instruction,
        exception: failure.ordinal, condition: { kind: 'Constant', sort: 'Bool', value: true }, store: storeSnapshot() });
    }
    if (originalFrontierTails.has(node.id)) {
      counter.charge('maxInvariantSteps', 'K2-original-retained-completion-frontier-store');
      returnFrontierStores.set(node.id, captureStore());
    }
    for (const branch of originalReturnBranchEnds.get(node.id) ?? []) {
      counter.charge('maxInvariantSteps', 'K2-original-return-frontier-branch-end');
      if (!branchStores.get(branch)?.whenTrue) deny('INVALID_PROOF', 'return frontiers lose original sibling store boundary');
      branchStores.delete(branch);
    }
    prior.set(node.id, node);
  }
  const normalEdges = new Map();
  for (const edge of exceptionalCompletions.length ? expectedEdges : []) {
    counter.charge('maxInvariantSteps', 'K2-original-checked-normal-edge-index');
    if (edge.completion === 'normal') normalEdges.set(edge.from, normalEdges.has(edge.from) ? null : edge);
  }
  for (const failure of exceptionalCompletions) {
    counter.charge('maxInvariantSteps', 'K2-original-checked-exception-edge');
    const normal = normalEdges.get(failure.instruction);
    if (!normal || normal.branch !== null && !(normal.branch.source === failure.instruction && normal.branch.outcome === 'normal')) deny('INVALID_PROOF', 'checked original operation lacks unique normal successor');
    normal.branch = { source: failure.instruction, outcome: 'normal' };
    if (!expectedExceptionTargets.has(failure.ordinal))
      deny('INVALID_PROOF', 'original failure lacks its independently reconstructed exceptional entry');
  }
  same(body.exceptionalCompletions, exceptionalCompletions, 'body changes an original exceptional condition or pre-operation store');
  if (exceptionalCompletions.length !== requiredExceptionCount)
    deny('INVALID_PROOF', 'body omits an independently enumerated original source exception');
  for (const failure of exceptionalCompletions) {
    counter.charge('maxInvariantSteps', 'K2-original-method-exception-frontier');
    const frontier = checkedExceptionFrontiers.get(failure.ordinal);
    if (!frontier || frontier.exception !== failure || frontier.tail !== failure.instruction)
      deny('INVALID_PROOF', 'method throw loses its independently retained original failure frontier');
    if (!expectedExceptionTargets.has(failure.ordinal))
      deny('INVALID_PROOF', 'raw source failure was not consumed by exceptional completion routing');
  }
  same(body.finalFrontiers, finalFrontiers, 'body changes its independently checked final method completion roster');
  same(body.edges, expectedEdges, 'body CFG omits, adds or changes an original conditional/normal/return/throw edge');
  if (branchStores.size) deny('INVALID_PROOF', 'original branch retains an unjoined store frame');
  if (body.nodes[0].operation !== 'entry' || body.nodes.at(-1).operation !== 'exit')
    deny('INVALID_PROOF', 'scalar body lacks exact entry/exit topology');
  if (body.entry !== 0 || body.exit !== body.nodes.length - 1 || body.returnNode !== originalReturnNode)
    deny('INVALID_PROOF', 'scalar entry, exit or return identity differs from original reached topology');
  same(body.locations, [...storeTypes.entries()].map(([key, type]) => ({
    location: storeLocations.get(key), type, defined: store.has(key),
    ...(store.has(key) ? { term: store.get(key) } : {}),
    ...(lastWrites.has(key) ? { lastWrite: lastWrites.get(key) } : {}) })),
  'body final location roster differs from independently reconstructed original storage');
  return { checkedScalarConclusions: body.nodes.length, checkedBooleanLeaves,
    sourceAdmission: false, completeBodyProof: false };
}

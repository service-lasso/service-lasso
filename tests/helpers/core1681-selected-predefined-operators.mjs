import { deny } from './core1681-source-input.mjs';
import { selectCsharpOverload } from './core1681-selected-overloads.mjs';
import { selectedTypeIdentity, selectedTypeKey } from './core1681-selected-types.mjs';
import { canonicalData } from './core1681-proof-terms.mjs';

const arithmetic = new Set(['+', '-', '*', '/', '%']);
const comparison = new Set(['==', '!=', '<', '>', '<=', '>=']);
const bitwise = new Set(['&', '|', '^']);
const shifts = new Set(['<<', '>>']);
const compound = new Set(['+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);
const numeric = ['int', 'uint', 'long', 'ulong', 'float', 'double', 'decimal'];
const integral = ['int', 'uint', 'long', 'ulong'];
const nullable = type => ({ category: 'nullable', element: type });

// These are fixed language signatures, not user declaration rows or native
// provider factories. Primitive identities resolve through the independently
// admitted symbolic CLR catalogue. Operator occurrence binding is retained.
// Numeric promotion is the outcome of overload resolution over signatures;
// there is no independent producer-supplied promotion rank or result type.
export function bindSelectedPredefinedOperator(node, operands, environment, context) {
  const assignment = node?.kind === 'assignment' && compound.has(node.operation);
  if (!node?.origin || !['unary', 'postfix', 'binary'].includes(node.kind) && !assignment ||
      node.kind === 'postfix' && !['++', '--'].includes(node.operation) || !Array.isArray(operands) ||
      operands.length !== (node.kind === 'binary' || assignment ? 2 : 1) ||
      typeof environment.typeIndex?.primitive !== 'function')
    deny('INVALID_BINDING', 'predefined operator requires actual syntax, operands and symbolic type index', node?.origin);
  const operation = assignment ? node.operation.slice(0, -1) : node.operation;
  const booleanOnly = ['!', '&', '|', '^', '==', '!=', '&&', '||'].includes(operation) &&
    operands.every(operand => operand.type?.category === 'primitive' && operand.type.name === 'bool');
  if (!booleanOnly && typeof environment.checkedArithmeticContext !== 'boolean')
    deny('INVALID_BINDING', 'operator arithmetic context must be independently bound from original checked/unchecked scopes', node.origin);
  // Select the underlying signature from the authentic compound token; never
  // fabricate a binary AST whose operator span disagrees with original bytes.
  const unary = node.kind !== 'binary' && !assignment;
  if (unary && operation === '-' && (operands[0].type?.category === 'primitive' && operands[0].type.name === 'ulong' ||
      operands[0].type?.category === 'nullable' && operands[0].type.element?.category === 'primitive' && operands[0].type.element.name === 'ulong'))
    deny('INVALID_BINDING', 'ordinary UInt64 unary minus has no predefined operator', node.origin);
  const decoded = environment.decodedUnits?.get(context.unit), token = node.operatorToken;
  if (!decoded || !token?.origin || token.spelling !== node.operation ||
      canonicalData(decoded.origin(...token.origin.utf16)) !== canonicalData(token.origin) ||
      decoded.text.slice(...token.origin.utf16) !== node.operation)
    deny('INVALID_BINDING', 'operator token does not bind its exact original compilation bytes', node.origin);
  const originalOperands = unary ? [node.operand] : [node.left, node.right];
  for (let ordinal = 0; ordinal < operands.length; ordinal++) {
    const operand = operands[ordinal];
    environment.counter.charge('maxInvariantSteps', 'predefined-original-operand');
    if (!operand.origin || canonicalData(operand.origin) !== canonicalData(originalOperands[ordinal]?.origin))
      deny('INVALID_BINDING', 'operator operand lost its actual source occurrence', node.origin);
    selectedTypeIdentity(operand.type);
    if (operand.direction !== 'value') deny('INVALID_BINDING', 'operator operand cannot be a ref/out argument', operand.origin);
  }
  const primitive = name => environment.typeIndex.primitive(name, context, node.origin);
  const boolean = primitive('bool'), signatures = [];
  const add = (parameters, result, semantics, lift = true) => {
    environment.counter.charge('maxInvariantSteps', 'predefined-operator-signature');
    const candidate = { intrinsic: { language: 'csharp', operation,
      parameters: parameters.map(type => selectedTypeIdentity(type)), result: selectedTypeIdentity(result) },
      genericArity: 0, parameters: parameters.map((type, index) => ({ name: `operand${index}`, type,
        direction: 'value', variadic: false })), originalParameterTypes: parameters,
      returnType: result, semantics, sourceOccurrence: node.origin, lifted: false };
    signatures.push(candidate);
    if (lift && parameters.every(type => ['primitive', 'enum'].includes(type.category) && type.name !== 'void') &&
        ['primitive', 'enum'].includes(result.category)) {
      environment.counter.charge('maxInvariantSteps', 'predefined-lifted-signature');
      const liftedParameters = parameters.map(nullable);
      const liftedResult = comparison.has(operation) ? boolean : nullable(result);
      signatures.push({ ...candidate, intrinsic: { ...candidate.intrinsic, lifted: true,
        parameters: liftedParameters.map(selectedTypeIdentity), result: selectedTypeIdentity(liftedResult) }, lifted: true,
        parameters: candidate.parameters.map((parameter, index) => ({ ...parameter, type: liftedParameters[index] })),
        originalParameterTypes: liftedParameters,
        returnType: liftedResult,
        semantics: comparison.has(operation)
          ? operation === '==' || operation === '!=' ? { kind: 'nullableEquality', underlying: semantics,
            bothNull: operation === '==', oneNull: operation === '!=', resultNullable: false }
            : { kind: 'nullableRelation', underlying: semantics, anyNull: false, resultNullable: false }
          : parameters[0].name === 'bool' && ['&', '|'].includes(operation)
            ? { kind: 'nullableBooleanLogic', operation, underlying: semantics,
              falseAndAnything: false, trueOrAnything: true, remainingNull: true }
            : { kind: 'nullableArithmetic', underlying: semantics, anyNull: 'null' } });
    }
  };
  const numericSignature = (name, parameters) => {
    // Pure Boolean operators have no arithmetic-overflow context. Do not mint
    // numeric candidates with an unbound profile merely to select a Boolean
    // signature; numeric binding still requires the original profile above.
    if (typeof environment.checkedArithmeticContext !== 'boolean') return;
    const type = primitive(name);
    add(parameters ? parameters(type) : Array.from({ length: operands.length }, () => type),
      comparison.has(operation) ? boolean : type,
      { kind: 'numeric', operation, arithmeticType: name,
        checkedContext: environment.checkedArithmeticContext,
        ieee: name === 'float' || name === 'double', decimal: name === 'decimal',
        integralDivisionZero: ['int', 'uint', 'long', 'ulong'].includes(name) && ['/', '%'].includes(operation),
        signedDivisionOverflow: ['int', 'long'].includes(name) && operation === '/' });
  };
  if (unary) {
    if (['++', '--'].includes(operation)) {
      for (const name of ['sbyte', 'byte', 'short', 'ushort', 'char', ...numeric]) {
        const type = primitive(name);
        add([type], type, { kind: 'numericUpdate', operation, arithmeticType: name,
          checkedContext: environment.checkedArithmeticContext,
          operandEvaluation: 'once', requiresOriginalLocationWrite: true,
          resultValue: node.kind === 'postfix' ? 'beforeWrite' : 'afterWrite' });
      }
    } else if (operation === '+') for (const name of numeric) numericSignature(name);
    else if (operation === '-') for (const name of numeric.filter(name => name !== 'uint' && name !== 'ulong')) numericSignature(name);
    else if (operation === '~') for (const name of integral) numericSignature(name);
    else if (operation === '!') add([boolean], boolean, { kind: 'booleanNot' });
    else deny('INVALID_BINDING', 'predefined unary operator requires a separate location/update binding', node.origin);
  } else if (arithmetic.has(operation) || comparison.has(operation)) {
    for (const name of numeric) numericSignature(name);
    if (['==', '!='].includes(operation)) add([boolean, boolean], boolean, { kind: 'booleanEquality', operation });
  } else if (bitwise.has(operation)) {
    for (const name of integral) numericSignature(name);
    add([boolean, boolean], boolean, { kind: 'booleanLogic', operation });
  } else if (shifts.has(operation)) {
    for (const name of integral) numericSignature(name, type => [type, primitive('int')]);
  } else if (['&&', '||'].includes(operation)) {
    add([boolean, boolean], boolean, { kind: 'conditionalBoolean', operation,
      rightEvaluation: operation === '&&' ? 'onlyIfLeftTrue' : 'onlyIfLeftFalse' }, false);
  } else deny('INVALID_BINDING', 'operator has no selected predefined numeric/boolean signature', node.origin);
  if (!unary && operation === '+') {
    const string = primitive('string'), object = primitive('object');
    for (const parameters of [[string, string], [string, object], [object, string]])
      add(parameters, string, { kind: 'utf16Concatenation', nullAsEmpty: true, resultNonNull: true,
        virtualObjectToStringOperands: parameters.map((type, index) => type.name === 'object' ? index : null).filter(index => index !== null),
        requiresOriginalVirtualCallBinding: parameters.some(type => type.name === 'object'),
        allocationMayFail: true }, false);
  }
  const enums = new Map();
  for (const operand of operands) {
    const type = operand.type.category === 'nullable' ? operand.type.element : operand.type;
    if (type.category === 'enum') enums.set(selectedTypeKey(type), type);
  }
  for (const enumType of enums.values()) {
    const row = environment.declarationMetadata?.get(canonicalData(enumType.declaration));
    if (row?.category !== 'enum' || !row.origin ||
        !['sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong'].includes(row.underlying))
      deny('INVALID_BINDING', 'enum operator requires its original independently resolved underlying declaration', node.origin);
    const underlying = primitive(row.underlying);
    const semantics = { kind: 'enumeration', operation, enumeration: enumType.declaration,
      declarationOccurrence: row.origin, underlyingType: underlying,
      checkedContext: environment.checkedArithmeticContext,
      requiresUnderlyingPromotionAndFinalConversion: ['+', '-', '~', '&', '|', '^'].includes(operation) };
    if (unary && ['++', '--'].includes(operation)) add([enumType], enumType,
      { ...semantics, operandEvaluation: 'once', requiresOriginalLocationWrite: true,
        resultValue: node.kind === 'postfix' ? 'beforeWrite' : 'afterWrite' });
    else if (unary && operation === '~') add([enumType], enumType, semantics);
    else if (!unary && operation === '+') {
      add([enumType, underlying], enumType, semantics);
      add([underlying, enumType], enumType, semantics);
    } else if (!unary && operation === '-') {
      add([enumType, enumType], underlying, semantics);
      add([enumType, underlying], enumType, semantics);
    } else if (!unary && bitwise.has(operation)) add([enumType, enumType], enumType, semantics);
    else if (!unary && comparison.has(operation)) add([enumType, enumType], boolean, semantics);
  }
  const selected = selectCsharpOverload(signatures, operands.map(operand => ({ ...operand, name: null })), environment, node.origin);
  return { ...selected, sourceOccurrence: node.origin, operandOccurrences: operands.map(operand => operand.origin),
    operatorOccurrence: token.origin,
    ...(assignment ? { compoundAssignment: { operation: node.operation, underlyingOperation: operation,
      locationOccurrence: node.left.origin, resultConversion: 'UNBOUND',
      requiresOriginalLocationReadAndWrite: true } } : {}),
    evaluationOrder: operands.map((_, index) => index), shortCircuit: ['&&', '||'].includes(operation),
    resultType: selected.candidate.returnType, intrinsic: selected.candidate.intrinsic,
    semantics: selected.candidate.semantics };
}

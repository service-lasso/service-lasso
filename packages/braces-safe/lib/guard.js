'use strict';

// AC-4AJ.6: fixed ceilings cannot be disabled through caller options.
const MAX_DEPTH = 64;
const MAX_NODES = 10000;
exports.pattern = input => {
  if (typeof input !== 'string') throw new TypeError('Expected a string');
  if (input.length > MAX_NODES) throw new SyntaxError('Brace input exceeds safe length');
  let depth = 0;
  for (const character of input) {
    // Conservatively count even escaped/quoted delimiters before the parser.
    if (character === '{' && ++depth > MAX_DEPTH) {
      throw new SyntaxError('Brace nesting exceeds safe depth');
    }
    if (character === '}') depth = Math.max(0, depth - 1);
  }
};
exports.ast = input => {
  const pending = [[input, 0]];
  const seen = new Set();
  let count = 0;
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (!node || typeof node !== 'object') throw new TypeError('Expected a brace AST node');
    if (depth > MAX_DEPTH || ++count > MAX_NODES) throw new SyntaxError('Brace AST exceeds safe depth or size');
    if (seen.has(node)) throw new SyntaxError('Brace AST contains repeated or cyclic nodes');
    seen.add(node);
    if (node.nodes !== undefined) {
      if (!Array.isArray(node.nodes)) throw new TypeError('Expected brace AST nodes');
      if (node.nodes.length > MAX_NODES) throw new SyntaxError('Brace AST exceeds safe size');
      for (const child of node.nodes) pending.push([child, depth + 1]);
    }
  }
};

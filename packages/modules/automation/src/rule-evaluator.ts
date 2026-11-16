type ConditionLeaf = {
  field: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'exists';
  value?: unknown;
};

function readField(payload: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let curr: unknown = payload;
  for (const part of parts) {
    if (curr === null || curr === undefined || typeof curr !== 'object') {
      return undefined;
    }
    curr = (curr as Record<string, unknown>)[part];
  }
  return curr;
}

function evaluateLeaf(
  node: ConditionLeaf,
  payload: Record<string, unknown>,
): boolean {
  const actual = readField(payload, node.field);
  switch (node.op) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'eq':
      return actual === node.value;
    case 'neq':
      return actual !== node.value;
    case 'gt':
      return (
        typeof actual === 'number' &&
        typeof node.value === 'number' &&
        actual > node.value
      );
    case 'gte':
      return (
        typeof actual === 'number' &&
        typeof node.value === 'number' &&
        actual >= node.value
      );
    case 'lt':
      return (
        typeof actual === 'number' &&
        typeof node.value === 'number' &&
        actual < node.value
      );
    case 'lte':
      return (
        typeof actual === 'number' &&
        typeof node.value === 'number' &&
        actual <= node.value
      );
    case 'in':
      return Array.isArray(node.value) && node.value.includes(actual);
    case 'contains':
      if (typeof actual === 'string' && typeof node.value === 'string') {
        return actual.includes(node.value);
      }
      if (Array.isArray(actual)) {
        return actual.includes(node.value);
      }
      return false;
    default:
      return false;
  }
}

/**
 * Pure deterministic AST evaluator for `auto_business_rules.condition_ast_json`.
 * Empty object `{}` matches unconditionally.
 */
export function evaluateConditionAst(
  ast: Record<string, unknown>,
  payload: Record<string, unknown>,
): boolean {
  if (Object.keys(ast).length === 0) {
    return true;
  }

  if (Array.isArray(ast.all)) {
    return ast.all.every(
      (child) =>
        child !== null &&
        typeof child === 'object' &&
        !Array.isArray(child) &&
        evaluateConditionAst(child as Record<string, unknown>, payload),
    );
  }

  if (Array.isArray(ast.any)) {
    return ast.any.some(
      (child) =>
        child !== null &&
        typeof child === 'object' &&
        !Array.isArray(child) &&
        evaluateConditionAst(child as Record<string, unknown>, payload),
    );
  }

  if (typeof ast.field === 'string' && typeof ast.op === 'string') {
    return evaluateLeaf(ast as ConditionLeaf, payload);
  }

  return false;
}

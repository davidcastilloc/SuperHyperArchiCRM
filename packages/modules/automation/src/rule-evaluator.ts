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

export const MAX_RULE_AST_DEPTH = 8;
export const MAX_RULE_VISITED_NODES = 250;

export interface RuleEvalBudget {
  visitedNodes: number;
  maxDepthSeen: number;
}

export function stepRuleBudget(budget: RuleEvalBudget, depth: number): void {
  budget.visitedNodes += 1;
  if (depth > budget.maxDepthSeen) budget.maxDepthSeen = depth;
  if (depth > MAX_RULE_AST_DEPTH) {
    throw new Error(`AUTOMATION_RULE_MAX_DEPTH_EXCEEDED: depth=${depth}`);
  }
  if (budget.visitedNodes > MAX_RULE_VISITED_NODES) {
    throw new Error(`AUTOMATION_RULE_NODE_BUDGET_EXCEEDED: nodes=${budget.visitedNodes}`);
  }
}

/**
 * Pure deterministic AST evaluator for `auto_business_rules.condition_ast_json`.
 * Empty object `{}` matches unconditionally.
 */
export function evaluateConditionAst(
  ast: Record<string, unknown>,
  payload: Record<string, unknown>,
  budget: RuleEvalBudget = { visitedNodes: 0, maxDepthSeen: 0 },
  depth = 0,
): boolean {
  stepRuleBudget(budget, depth);

  if (Object.keys(ast).length === 0) {
    return true;
  }

  if (Array.isArray(ast.all)) {
    return ast.all.every(
      (child) =>
        child !== null &&
        typeof child === 'object' &&
        !Array.isArray(child) &&
        evaluateConditionAst(child as Record<string, unknown>, payload, budget, depth + 1),
    );
  }

  if (Array.isArray(ast.any)) {
    return ast.any.some(
      (child) =>
        child !== null &&
        typeof child === 'object' &&
        !Array.isArray(child) &&
        evaluateConditionAst(child as Record<string, unknown>, payload, budget, depth + 1),
    );
  }

  if (typeof ast.field === 'string' && typeof ast.op === 'string') {
    return evaluateLeaf(ast as ConditionLeaf, payload);
  }

  return false;
}

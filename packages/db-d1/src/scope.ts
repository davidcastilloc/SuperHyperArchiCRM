import { AppError, type ExecutionContext } from '@shac/kernel';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as iamSchema from './schema/iam.js';

export type ShacD1Database = DrizzleD1Database<typeof iamSchema>;

function normalizeOrgPath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}

/**
 * Enforces multi-tenant isolation and hierarchical org subtree boundaries.
 * Throws 404 NOT_FOUND on cross-tenant access to prevent tenant enumeration,
 * and 403 FORBIDDEN_ORG_SCOPE when targetOrgPath is outside ctx.orgPath.
 */
export function assertOrgScope(
  ctx: Pick<ExecutionContext, 'tenantId' | 'orgPath'>,
  targetTenantId: string,
  targetOrgPath: string,
): void {
  if (ctx.tenantId !== targetTenantId) {
    throw new AppError('NOT_FOUND', 404, 'NOT_FOUND: Resource not found');
  }

  const normalizedCtx = normalizeOrgPath(ctx.orgPath);
  const normalizedTarget = normalizeOrgPath(targetOrgPath);

  const isWithinSubtree =
    normalizedTarget === normalizedCtx ||
    (normalizedCtx === '/'
      ? normalizedTarget.startsWith('/')
      : normalizedTarget.startsWith(`${normalizedCtx}/`));

  if (!isWithinSubtree) {
    throw new AppError(
      'FORBIDDEN_ORG_SCOPE',
      403,
      'FORBIDDEN_ORG_SCOPE: Target organization is outside authorized subtree',
    );
  }
}

export function createD1Client(d1: D1Database): ShacD1Database {
  return drizzle(d1, { schema: iamSchema });
}

export interface CountedD1 {
  db: D1Database;
  getQueryCount(): number;
  resetQueryCount(): void;
}

const rawStatementMap = new WeakMap<object, D1PreparedStatement>();

function wrapPreparedStatement(
  stmt: D1PreparedStatement,
  onExecute: () => void,
): D1PreparedStatement {
  const proxy = new Proxy(stmt, {
    get(target, prop, receiver) {
      if (prop === 'bind') {
        return (...values: unknown[]) => {
          const bound = target.bind(...values);
          return wrapPreparedStatement(bound, onExecute);
        };
      }
      if (prop === 'first' || prop === 'run' || prop === 'all' || prop === 'raw') {
        const fn = Reflect.get(target, prop, target) as (...args: unknown[]) => unknown;
        return (...args: unknown[]) => {
          onExecute();
          return fn.apply(target, args);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  rawStatementMap.set(proxy, stmt);
  return proxy;
}

/**
 * Wraps a D1Database binding to count executed SQL statements across
 * prepared statements, batch() calls, and exec() calls.
 */
export function wrapD1WithCounter(d1: D1Database): CountedD1 {
  let queryCount = 0;

  const db = new Proxy(d1, {
    get(target, prop, receiver) {
      if (prop === 'prepare') {
        return (query: string) => {
          const stmt = target.prepare(query);
          return wrapPreparedStatement(stmt, () => {
            queryCount += 1;
          });
        };
      }
      if (prop === 'batch') {
        return <T = unknown>(statements: D1PreparedStatement[]) => {
          queryCount += statements.length;
          const unwrapped = statements.map((s) => rawStatementMap.get(s) ?? s);
          return target.batch<T>(unwrapped);
        };
      }
      if (prop === 'exec') {
        return (query: string) => {
          queryCount += 1;
          return target.exec(query);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return {
    db,
    getQueryCount: () => queryCount,
    resetQueryCount: () => {
      queryCount = 0;
    },
  };
}

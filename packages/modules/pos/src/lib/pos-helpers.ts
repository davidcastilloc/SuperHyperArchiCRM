import {
  assertOrgScope,
  finAccounts,
  iamOrganizations,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, sha256Hex, type ExecutionContext } from '@shac/kernel';
import { and, eq, inArray, isNull } from 'drizzle-orm';

export type PosCtx = ExecutionContext<ShacD1Database>;

export interface ScopedAccountRow {
  id: string;
  tenantId: string;
  orgId: string;
  orgTreePath: string | null;
  code: string;
  name: string;
  accountKind: string;
  currency: string;
  currentBalanceMinor: number;
  isActive: boolean;
}

export async function computeCommandRequestHash(
  commandId: string,
  payload: unknown,
): Promise<string> {
  return sha256Hex(JSON.stringify({ commandId, payload }));
}

/**
 * Resolves and validates the target organization inside ctx.orgPath.
 * Throws 404 on cross-tenant orgId and 403 on out-of-subtree orgId.
 */
export async function resolveScopedTargetOrg(
  ctx: Pick<PosCtx, 'tenantId' | 'orgId' | 'orgPath' | 'db'>,
  requestedOrgId?: string,
): Promise<string> {
  if (!requestedOrgId || requestedOrgId === ctx.orgId) {
    assertOrgScope(ctx, ctx.tenantId, ctx.orgPath);
    return ctx.orgId;
  }

  const rows = await ctx.db
    .select({
      id: iamOrganizations.id,
      tenantId: iamOrganizations.tenantId,
      treePath: iamOrganizations.treePath,
    })
    .from(iamOrganizations)
    .where(
      and(
        eq(iamOrganizations.id, requestedOrgId),
        isNull(iamOrganizations.deletedAt),
      ),
    )
    .limit(1);

  const org = rows[0];
  if (!org) {
    throw new AppError('NOT_FOUND', 404, 'Target organization not found');
  }

  assertOrgScope(ctx, org.tenantId, org.treePath);
  return org.id;
}

/**
 * Builds an explicit-alias LEFT JOIN query for fin_accounts + iam_organizations
 * to verify ownership without D1 batch column collisions.
 */
export function buildFinAccountsLookupQuery(
  db: ShacD1Database,
  accountIds: readonly string[],
) {
  return db
    .select({
      id: finAccounts.id,
      tenantId: finAccounts.tenantId,
      orgId: finAccounts.orgId,
      orgTreePath: iamOrganizations.treePath,
      code: finAccounts.code,
      name: finAccounts.name,
      accountKind: finAccounts.accountKind,
      currency: finAccounts.currency,
      currentBalanceMinor: finAccounts.currentBalanceMinor,
      isActive: finAccounts.isActive,
    })
    .from(finAccounts)
    .leftJoin(
      iamOrganizations,
      and(
        eq(finAccounts.orgId, iamOrganizations.id),
        eq(finAccounts.tenantId, iamOrganizations.tenantId),
        isNull(iamOrganizations.deletedAt),
      ),
    )
    .where(
      and(inArray(finAccounts.id, [...accountIds]), isNull(finAccounts.deletedAt)),
    );
}

export function verifyScopedAccountRow(
  ctx: Pick<PosCtx, 'tenantId' | 'orgId' | 'orgPath'>,
  row: ScopedAccountRow | undefined,
  accountId: string,
): ScopedAccountRow {
  if (!row) {
    throw new AppError(
      'NOT_FOUND',
      404,
      `Financial account ${accountId} not found`,
    );
  }
  const effectiveOrgPath =
    row.orgTreePath ??
    (row.orgId === ctx.orgId ? ctx.orgPath : '/__out_of_scope__');
  assertOrgScope(ctx, row.tenantId, effectiveOrgPath);
  if (!row.isActive) {
    throw new AppError(
      'ACCOUNT_INACTIVE',
      422,
      `Financial account ${row.code} is inactive`,
    );
  }
  return row;
}

/**
 * Calls BranchInventoryDO over its ExecutionContext port for `${tenantId}:${orgId}`.
 */
export async function callBranchDoJson<TOut>(
  ctx: Pick<PosCtx, 'tenantId' | 'branchDo'>,
  orgId: string,
  path: string,
  body: unknown,
): Promise<TOut> {
  if (!ctx.branchDo) {
    throw new AppError(
      'BRANCH_DO_UNAVAILABLE',
      503,
      'BranchInventoryDO resolver is not configured on ExecutionContext',
    );
  }

  const stub = ctx.branchDo.getByBranchKey(`${ctx.tenantId}:${orgId}`);
  const response = await stub.fetch(`https://do.internal${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as
    | TOut
    | {
        ok?: false;
        error?: {
          code?: string;
          status?: number;
          message?: string;
          details?: unknown;
        };
      };

  if (!response.ok) {
    const err =
      payload && typeof payload === 'object' && 'error' in payload
        ? payload.error
        : undefined;
    throw new AppError(
      err?.code ?? 'BRANCH_DO_ERROR',
      err?.status ?? response.status,
      err?.message ?? `BranchInventoryDO ${path} failed with ${response.status}`,
      err?.details,
    );
  }

  return payload as TOut;
}

export function normalizeCurrencyMap(
  record: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key.trim().toUpperCase()] = value;
  }
  return out;
}

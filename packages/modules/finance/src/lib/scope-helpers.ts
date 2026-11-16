import {
  assertOrgScope,
  crmParties,
  finTrustEscrowLedgers,
  iamOrganizations,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, type ExecutionContext } from '@shac/kernel';
import { and, eq, isNull } from 'drizzle-orm';

export type FinanceCtx = Pick<
  ExecutionContext<ShacD1Database>,
  'tenantId' | 'orgId' | 'orgPath' | 'db' | 'actor'
>;

export async function resolveScopedTargetOrg(
  ctx: FinanceCtx,
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

export function buildPartyScopeQuery(db: ShacD1Database, partyId: string) {
  return db
    .select({
      id: crmParties.id,
      tenantId: crmParties.tenantId,
      orgId: crmParties.orgId,
      orgTreePath: iamOrganizations.treePath,
    })
    .from(crmParties)
    .leftJoin(
      iamOrganizations,
      and(
        eq(crmParties.orgId, iamOrganizations.id),
        eq(crmParties.tenantId, iamOrganizations.tenantId),
        isNull(iamOrganizations.deletedAt),
      ),
    )
    .where(and(eq(crmParties.id, partyId), isNull(crmParties.deletedAt)))
    .limit(1);
}

export async function assertTrustLedgerInScope(
  ctx: FinanceCtx,
  ledgerId: string,
) {
  const rows = await ctx.db
    .select({
      ledger: finTrustEscrowLedgers,
      orgTreePath: iamOrganizations.treePath,
    })
    .from(finTrustEscrowLedgers)
    .leftJoin(
      iamOrganizations,
      and(
        eq(finTrustEscrowLedgers.orgId, iamOrganizations.id),
        eq(finTrustEscrowLedgers.tenantId, iamOrganizations.tenantId),
        isNull(iamOrganizations.deletedAt),
      ),
    )
    .where(
      and(
        eq(finTrustEscrowLedgers.id, ledgerId),
        isNull(finTrustEscrowLedgers.deletedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new AppError('NOT_FOUND', 404, 'Trust/escrow ledger not found');
  }

  const effectiveOrgPath =
    row.orgTreePath ??
    (row.ledger.orgId === ctx.orgId ? ctx.orgPath : '/__out_of_scope__');
  assertOrgScope(ctx, row.ledger.tenantId, effectiveOrgPath);
  return row.ledger;
}

export function verifyScopedRow(
  ctx: Pick<ExecutionContext, 'tenantId' | 'orgId' | 'orgPath'>,
  row:
    | {
        id: string;
        tenantId: string;
        orgId: string;
        orgTreePath: string | null;
      }
    | undefined,
  label: string,
): { id: string; tenantId: string; orgId: string } {
  if (!row) {
    throw new AppError('NOT_FOUND', 404, `${label} not found`);
  }
  const effectiveOrgPath =
    row.orgTreePath ??
    (row.orgId === ctx.orgId ? ctx.orgPath : '/__out_of_scope__');
  assertOrgScope(ctx, row.tenantId, effectiveOrgPath);
  return { id: row.id, tenantId: row.tenantId, orgId: row.orgId };
}

export function parseJsonRecord(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function parseJsonArray(raw: string): Record<string, unknown>[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

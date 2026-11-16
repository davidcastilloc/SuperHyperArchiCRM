import {
  assertOrgScope,
  comOrders,
  crmParties,
  iamOrganizations,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, type ExecutionContext } from '@shac/kernel';
import { and, eq, isNull } from 'drizzle-orm';

export async function resolveTargetOrg(
  ctx: ExecutionContext<ShacD1Database>,
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
    .where(and(eq(iamOrganizations.id, requestedOrgId), isNull(iamOrganizations.deletedAt)))
    .limit(1);
  const org = rows[0];
  if (!org) {
    throw new AppError('NOT_FOUND', 404, 'Organization not found');
  }
  assertOrgScope(ctx, org.tenantId, org.treePath);
  return org.id;
}

function assertScopedRow(
  ctx: ExecutionContext<ShacD1Database>,
  row: { tenantId: string; orgId: string; orgTreePath: string | null } | undefined,
): void {
  if (!row) return;
  const path =
    row.orgTreePath ?? (row.orgId === ctx.orgId ? ctx.orgPath : '/__out_of_scope__');
  assertOrgScope(ctx, row.tenantId, path);
}

export async function assertOptionalRefScope(
  ctx: ExecutionContext<ShacD1Database>,
  partyId?: string | null,
  orderId?: string | null,
): Promise<void> {
  if (partyId) {
    const rows = await ctx.db
      .select({
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
    assertScopedRow(ctx, rows[0]);
  }
  if (orderId) {
    const rows = await ctx.db
      .select({
        tenantId: comOrders.tenantId,
        orgId: comOrders.orgId,
        orgTreePath: iamOrganizations.treePath,
      })
      .from(comOrders)
      .leftJoin(
        iamOrganizations,
        and(
          eq(comOrders.orgId, iamOrganizations.id),
          eq(comOrders.tenantId, iamOrganizations.tenantId),
          isNull(iamOrganizations.deletedAt),
        ),
      )
      .where(and(eq(comOrders.id, orderId), isNull(comOrders.deletedAt)))
      .limit(1);
    assertScopedRow(ctx, rows[0]);
  }
}

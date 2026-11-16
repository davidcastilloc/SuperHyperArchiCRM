import {
  assertOrgScope,
  iamOrganizations,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, type ExecutionContext } from '@shac/kernel';
import { and, eq, isNull } from 'drizzle-orm';

export type PortalCtx = Pick<
  ExecutionContext<ShacD1Database>,
  'tenantId' | 'orgId' | 'orgPath' | 'db'
>;

/**
 * Resolves and authorizes the target organization for a portal read.
 * Avoids extra D1 round-trips when reading the caller's own org.
 */
export async function resolveScopedTargetOrg(
  ctx: PortalCtx,
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

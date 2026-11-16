import {
  assertOrgScope,
  iamOrganizations,
  wmsPickings,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, type ExecutionContext } from '@shac/kernel';
import { and, eq, inArray, isNull, like, or, type SQL } from 'drizzle-orm';

export type WmsDbCtx = Pick<
  ExecutionContext<ShacD1Database>,
  'tenantId' | 'orgId' | 'orgPath' | 'db'
>;

function normalizeOrgPath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}

/** Resolves and authorizes the target orgId within ctx.tenantId and ctx.orgPath subtree. */
export async function resolveWmsTargetOrg(
  ctx: WmsDbCtx,
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

/** Verifies tenant and org-subtree authorization for a loaded resource row. */
export async function assertWmsResourceScope(
  ctx: WmsDbCtx,
  row: { tenantId: string; orgId: string } | undefined,
  label: string,
): Promise<void> {
  if (!row || row.tenantId !== ctx.tenantId) {
    throw new AppError('NOT_FOUND', 404, `${label} not found`);
  }
  if (row.orgId === ctx.orgId) {
    assertOrgScope(ctx, row.tenantId, ctx.orgPath);
    return;
  }

  const orgRows = await ctx.db
    .select({
      tenantId: iamOrganizations.tenantId,
      treePath: iamOrganizations.treePath,
    })
    .from(iamOrganizations)
    .where(
      and(
        eq(iamOrganizations.id, row.orgId),
        eq(iamOrganizations.tenantId, ctx.tenantId),
        isNull(iamOrganizations.deletedAt),
      ),
    )
    .limit(1);

  const org = orgRows[0];
  assertOrgScope(ctx, row.tenantId, org?.treePath ?? '/__out_of_scope__');
}

/** Builds a single-query SQL subtree filter for wmsPickings using ctx.orgPath. */
export function buildPickingsOrgSubtreeFilter(ctx: WmsDbCtx): SQL {
  const normalizedPath = normalizeOrgPath(ctx.orgPath);
  const pathCondition =
    normalizedPath === '/'
      ? or(
          eq(iamOrganizations.treePath, '/'),
          like(iamOrganizations.treePath, '/%'),
        )
      : or(
          eq(iamOrganizations.treePath, normalizedPath),
          like(iamOrganizations.treePath, `${normalizedPath}/%`),
        );

  const allowedOrgIds = ctx.db
    .select({ id: iamOrganizations.id })
    .from(iamOrganizations)
    .where(
      and(
        eq(iamOrganizations.tenantId, ctx.tenantId),
        isNull(iamOrganizations.deletedAt),
        pathCondition,
      ),
    );

  return or(
    eq(wmsPickings.orgId, ctx.orgId),
    inArray(wmsPickings.orgId, allowedOrgIds),
  )!;
}

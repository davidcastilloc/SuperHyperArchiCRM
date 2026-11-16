import {
  assertOrgScope,
  crmParties,
  iamOrganizations,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, type ExecutionContext } from '@shac/kernel';
import { and, eq, inArray, isNull, like, or, type SQL } from 'drizzle-orm';
import { normalizeOrgPath } from './identity.js';

export type CustomersCtx = Pick<
  ExecutionContext<ShacD1Database>,
  'tenantId' | 'orgId' | 'orgPath' | 'db'
>;

export async function resolveScopedTargetOrg(
  ctx: CustomersCtx,
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

export function buildPartyScopeQuery(
  db: ShacD1Database,
  partyId: string,
) {
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

export function verifyScopedPartyRow(
  ctx: Pick<ExecutionContext, 'tenantId' | 'orgId' | 'orgPath'>,
  row:
    | {
        id: string;
        tenantId: string;
        orgId: string;
        orgTreePath: string | null;
      }
    | undefined,
  label = 'Party',
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

export async function assertPartyInScope(
  ctx: CustomersCtx,
  partyId: string,
  label = 'Party',
): Promise<{ id: string; tenantId: string; orgId: string }> {
  const rows = await buildPartyScopeQuery(ctx.db, partyId);
  return verifyScopedPartyRow(ctx, rows[0], label);
}

export function buildOrgSubtreeFilter(ctx: CustomersCtx): SQL {
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
    eq(crmParties.orgId, ctx.orgId),
    inArray(crmParties.orgId, allowedOrgIds),
  )!;
}

export function escapeSqlLike(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

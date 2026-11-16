import {
  crmParties,
  iamOrganizations,
  srvWarrantyClaimsRma,
  srvWorkOrders,
  type ShacD1Database,
} from '@shac/db-d1';
import { defineCommand } from '@shac/kernel';
import { and, desc, eq, inArray, isNull, like, or, type AnyColumn } from 'drizzle-orm';
import { z } from 'zod';

const listClaimsInputSchema = z.object({
  partyId: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const claimRowSchema = z.object({
  id: z.string(),
  claimNumber: z.string(),
  partyId: z.string(),
  partyName: z.string().nullable(),
  priority: z.string(),
  advanceReplacement: z.boolean(),
  vendorRecoveryStatus: z.string(),
  vendorRecoveredMinor: z.number().int().nonnegative(),
  status: z.string(),
  createdAt: z.number().int(),
});

const workOrderRowSchema = z.object({
  id: z.string(),
  ticketNumber: z.string(),
  orderKind: z.string(),
  partyId: z.string().nullable(),
  partyName: z.string().nullable(),
  category: z.string(),
  deviceSerialOrImei: z.string().nullable(),
  initialDiagnosis: z.string().nullable(),
  priority: z.string(),
  laborCostMinor: z.number().int().nonnegative(),
  partsCostMinor: z.number().int().nonnegative(),
  status: z.string(),
  createdAt: z.number().int(),
});

const listClaimsOutputSchema = z.object({
  claims: z.array(claimRowSchema),
  workOrders: z.array(workOrderRowSchema),
});

function buildServicesOrgFilter(
  ctx: { tenantId: string; orgId: string; orgPath: string; db: ShacD1Database },
  orgCol: AnyColumn,
) {
  const clean = ctx.orgPath.trim().replace(/\/+$/, '') || '/';
  const pathCond =
    clean === '/'
      ? or(eq(iamOrganizations.treePath, '/'), like(iamOrganizations.treePath, '/%'))
      : or(eq(iamOrganizations.treePath, clean), like(iamOrganizations.treePath, `${clean}/%`));

  const allowedOrgIds = ctx.db
    .select({ id: iamOrganizations.id })
    .from(iamOrganizations)
    .where(
      and(
        eq(iamOrganizations.tenantId, ctx.tenantId),
        isNull(iamOrganizations.deletedAt),
        pathCond,
      ),
    );

  return or(eq(orgCol, ctx.orgId), inArray(orgCol, allowedOrgIds))!;
}

/** Lists RMA warranty claims and technical work orders in <= 2 D1 queries via db.batch(). */
export const servicesClaimsListCommand = defineCommand<
  typeof listClaimsInputSchema,
  z.infer<typeof listClaimsOutputSchema>,
  ShacD1Database
>({
  id: 'services.claims.list',
  moduleId: 'services',
  method: 'GET',
  path: '/api/services/claims',
  summary: 'List warranty RMA claims and field work orders in <= 2 D1 queries',
  requiredPermission: 'services.rma.read',
  mcp: {
    expose: true,
    readOnlyHint: true,
    description: 'List warranty claims and service work orders scoped by tenantId and orgPath',
  },
  inputSchema: listClaimsInputSchema,
  outputSchema: listClaimsOutputSchema,
  async handler(ctx, input) {
    const claimConds = [
      eq(srvWarrantyClaimsRma.tenantId, ctx.tenantId),
      isNull(srvWarrantyClaimsRma.deletedAt),
      buildServicesOrgFilter(ctx, srvWarrantyClaimsRma.orgId),
    ];
    const woConds = [
      eq(srvWorkOrders.tenantId, ctx.tenantId),
      isNull(srvWorkOrders.deletedAt),
      buildServicesOrgFilter(ctx, srvWorkOrders.orgId),
    ];

    if (input.partyId) {
      claimConds.push(eq(srvWarrantyClaimsRma.partyId, input.partyId));
      woConds.push(eq(srvWorkOrders.partyId, input.partyId));
    }
    if (input.status) {
      claimConds.push(eq(srvWarrantyClaimsRma.status, input.status));
      woConds.push(eq(srvWorkOrders.status, input.status));
    }

    const claimsQuery = ctx.db
      .select({
        id: srvWarrantyClaimsRma.id,
        claimNumber: srvWarrantyClaimsRma.claimNumber,
        partyId: srvWarrantyClaimsRma.partyId,
        partyName: crmParties.displayName,
        priority: srvWarrantyClaimsRma.priority,
        advanceReplacement: srvWarrantyClaimsRma.advanceReplacement,
        vendorRecoveryStatus: srvWarrantyClaimsRma.vendorRecoveryStatus,
        vendorRecoveredMinor: srvWarrantyClaimsRma.vendorRecoveredMinor,
        status: srvWarrantyClaimsRma.status,
        createdAt: srvWarrantyClaimsRma.createdAt,
      })
      .from(srvWarrantyClaimsRma)
      .leftJoin(
        crmParties,
        and(
          eq(srvWarrantyClaimsRma.partyId, crmParties.id),
          eq(srvWarrantyClaimsRma.tenantId, crmParties.tenantId),
          isNull(crmParties.deletedAt),
        ),
      )
      .where(and(...claimConds))
      .orderBy(desc(srvWarrantyClaimsRma.createdAt))
      .limit(input.limit);

    const workOrdersQuery = ctx.db
      .select({
        id: srvWorkOrders.id,
        ticketNumber: srvWorkOrders.ticketNumber,
        orderKind: srvWorkOrders.orderKind,
        partyId: srvWorkOrders.partyId,
        partyName: crmParties.displayName,
        category: srvWorkOrders.category,
        deviceSerialOrImei: srvWorkOrders.deviceSerialOrImei,
        initialDiagnosis: srvWorkOrders.initialDiagnosis,
        priority: srvWorkOrders.priority,
        laborCostMinor: srvWorkOrders.laborCostMinor,
        partsCostMinor: srvWorkOrders.partsCostMinor,
        status: srvWorkOrders.status,
        createdAt: srvWorkOrders.createdAt,
      })
      .from(srvWorkOrders)
      .leftJoin(
        crmParties,
        and(
          eq(srvWorkOrders.partyId, crmParties.id),
          eq(srvWorkOrders.tenantId, crmParties.tenantId),
          isNull(crmParties.deletedAt),
        ),
      )
      .where(and(...woConds))
      .orderBy(desc(srvWorkOrders.createdAt))
      .limit(input.limit);

    const [claims, workOrders] = await ctx.db.batch([claimsQuery, workOrdersQuery]);
    return { claims, workOrders };
  },
});

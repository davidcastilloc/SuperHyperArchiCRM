import {
  comOrders,
  crmParties,
  iamOrganizations,
  type ShacD1Database,
} from '@shac/db-d1';
import { defineCommand } from '@shac/kernel';
import { and, desc, eq, inArray, isNull, like, or } from 'drizzle-orm';
import { z } from 'zod';

const listOrdersInputSchema = z.object({
  status: z.string().min(1).optional(),
  orderKind: z.string().min(1).optional(),
  search: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const orderRowSchema = z.object({
  id: z.string(),
  orderNumber: z.string(),
  orderKind: z.string(),
  channelId: z.string().nullable(),
  registerId: z.string().nullable(),
  partyId: z.string().nullable(),
  partyName: z.string().nullable(),
  currency: z.string(),
  netSubtotalMinor: z.number().int().nonnegative(),
  taxTotalMinor: z.number().int().nonnegative(),
  grandTotalMinor: z.number().int().nonnegative(),
  paidTotalMinor: z.number().int().nonnegative(),
  fulfillmentStatus: z.string(),
  paymentStatus: z.string(),
  status: z.string(),
  createdAt: z.number().int(),
});

const listOrdersOutputSchema = z.object({
  items: z.array(orderRowSchema),
  summary: z.object({
    totalCount: z.number().int().nonnegative(),
    grossRevenueMinor: z.number().int().nonnegative(),
    fulfilledCount: z.number().int().nonnegative(),
    pendingCount: z.number().int().nonnegative(),
  }),
});

function buildPosOrgSubtreeFilter(ctx: {
  tenantId: string;
  orgId: string;
  orgPath: string;
  db: ShacD1Database;
}) {
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

  return or(eq(comOrders.orgId, ctx.orgId), inArray(comOrders.orgId, allowedOrgIds))!;
}

/** Open Mercato Sales Orders & Quotes back-office listing in <= 2 D1 queries. */
export const posOrdersListCommand = defineCommand<
  typeof listOrdersInputSchema,
  z.infer<typeof listOrdersOutputSchema>,
  ShacD1Database
>({
  id: 'pos.orders.list',
  moduleId: 'pos',
  method: 'GET',
  path: '/api/pos/orders',
  summary: 'List sales orders and quotes with net/gross totals in <= 2 D1 queries',
  requiredPermission: 'pos.sales.read',
  mcp: {
    expose: true,
    readOnlyHint: true,
    description: 'List sales orders and quotes scoped by tenantId and orgPath subtree',
  },
  inputSchema: listOrdersInputSchema,
  outputSchema: listOrdersOutputSchema,
  async handler(ctx, input) {
    const baseConds = [
      eq(comOrders.tenantId, ctx.tenantId),
      isNull(comOrders.deletedAt),
      buildPosOrgSubtreeFilter(ctx),
    ];

    const filterConds = [...baseConds];
    if (input.status) filterConds.push(eq(comOrders.status, input.status));
    if (input.orderKind) filterConds.push(eq(comOrders.orderKind, input.orderKind));
    if (input.search) {
      const escaped = input.search.replace(/[\\%_]/g, '\\$&');
      filterConds.push(like(comOrders.orderNumber, `%${escaped}%`));
    }

    const rowsQuery = ctx.db
      .select({
        id: comOrders.id,
        orderNumber: comOrders.orderNumber,
        orderKind: comOrders.orderKind,
        channelId: comOrders.channelId,
        registerId: comOrders.registerId,
        partyId: comOrders.partyId,
        partyName: crmParties.displayName,
        currency: comOrders.currency,
        subtotalExemptMinor: comOrders.subtotalExemptMinor,
        subtotalReducedMinor: comOrders.subtotalReducedMinor,
        subtotalGeneralMinor: comOrders.subtotalGeneralMinor,
        discountMinor: comOrders.discountMinor,
        taxGeneralMinor: comOrders.taxGeneralMinor,
        taxReducedMinor: comOrders.taxReducedMinor,
        grandTotalMinor: comOrders.grandTotalMinor,
        paidTotalMinor: comOrders.paidTotalMinor,
        fulfillmentStatus: comOrders.fulfillmentStatus,
        paymentStatus: comOrders.paymentStatus,
        status: comOrders.status,
        createdAt: comOrders.createdAt,
      })
      .from(comOrders)
      .leftJoin(
        crmParties,
        and(
          eq(comOrders.partyId, crmParties.id),
          eq(comOrders.tenantId, crmParties.tenantId),
          isNull(crmParties.deletedAt),
        ),
      )
      .where(and(...filterConds))
      .orderBy(desc(comOrders.createdAt))
      .limit(input.limit);

    const summaryQuery = ctx.db
      .select({
        grandTotalMinor: comOrders.grandTotalMinor,
        fulfillmentStatus: comOrders.fulfillmentStatus,
        status: comOrders.status,
      })
      .from(comOrders)
      .where(and(...baseConds));

    const [rawRows, allOrders] = await ctx.db.batch([rowsQuery, summaryQuery]);

    let grossMinor = 0n;
    let fulfilledCount = 0;
    let pendingCount = 0;
    for (const o of allOrders) {
      if (o.status !== 'cancelled') grossMinor += BigInt(Math.max(0, o.grandTotalMinor));
      if (o.fulfillmentStatus === 'fulfilled' || o.status === 'completed' || o.status === 'settled') {
        fulfilledCount += 1;
      } else {
        pendingCount += 1;
      }
    }

    const items = rawRows.map((r) => {
      const sub =
        BigInt(r.subtotalExemptMinor) +
        BigInt(r.subtotalReducedMinor) +
        BigInt(r.subtotalGeneralMinor) -
        BigInt(r.discountMinor);
      const net = sub > 0n ? Number(sub) : Math.max(0, r.grandTotalMinor - r.taxGeneralMinor - r.taxReducedMinor);
      return {
        id: r.id,
        orderNumber: r.orderNumber,
        orderKind: r.orderKind,
        channelId: r.channelId,
        registerId: r.registerId,
        partyId: r.partyId,
        partyName: r.partyName,
        currency: r.currency,
        netSubtotalMinor: net,
        taxTotalMinor: Math.max(0, r.taxGeneralMinor + r.taxReducedMinor),
        grandTotalMinor: Math.max(0, r.grandTotalMinor),
        paidTotalMinor: Math.max(0, r.paidTotalMinor),
        fulfillmentStatus: r.fulfillmentStatus,
        paymentStatus: r.paymentStatus,
        status: r.status,
        createdAt: r.createdAt,
      };
    });

    return {
      items,
      summary: {
        totalCount: allOrders.length,
        grossRevenueMinor: Number(grossMinor),
        fulfilledCount,
        pendingCount,
      },
    };
  },
});

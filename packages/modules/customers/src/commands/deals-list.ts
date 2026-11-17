import { crmDeals, crmParties, type ShacD1Database } from '@shac/db-d1';
import { buildCursorPage, decodeKeysetCursor, defineCommand } from '@shac/kernel';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { buildOrgSubtreeFilter } from '../lib/scope-helpers.js';

const listDealsInputSchema = z.object({
  partyId: z.string().min(1).optional(),
  outcome: z.enum(['open', 'won', 'lost']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

const dealItemSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  pipelineId: z.string(),
  stageId: z.string(),
  partyId: z.string(),
  partyName: z.string().nullable(),
  title: z.string(),
  valueMinor: z.number().int().nonnegative(),
  currency: z.string(),
  probabilityBps: z.number().int().min(0).max(10_000),
  expectedCloseDate: z.string().nullable(),
  outcome: z.string(),
  createdAt: z.number().int(),
});

const listDealsOutputSchema = z.object({
  items: z.array(dealItemSchema),
  nextCursor: z.string().nullable().optional(),
  hasMore: z.boolean().optional(),
  summary: z.object({
    totalCount: z.number().int().nonnegative(),
    openValueMinor: z.number().int().nonnegative(),
    wonValueMinor: z.number().int().nonnegative(),
    weightedValueMinor: z.number().int().nonnegative(),
  }),
});

export const customersDealsListCommand = defineCommand<
  typeof listDealsInputSchema,
  z.infer<typeof listDealsOutputSchema>,
  ShacD1Database
>({
  id: 'customers.deals.list',
  moduleId: 'customers',
  method: 'GET',
  path: '/api/customers/deals',
  summary: 'List CRM deals with party names and pipeline KPI totals in <= 2 D1 queries',
  requiredPermission: 'customers.deals.read',
  mcp: {
    expose: true,
    readOnlyHint: true,
    description: 'List CRM deals scoped by tenantId and orgPath subtree with KPI summary',
  },
  inputSchema: listDealsInputSchema,
  outputSchema: listDealsOutputSchema,
  async handler(ctx, input) {
    const baseConditions = [
      eq(crmDeals.tenantId, ctx.tenantId),
      isNull(crmDeals.deletedAt),
      buildOrgSubtreeFilter(ctx, crmDeals.orgId),
    ];

    const listConditions = [...baseConditions];
    if (input.partyId) {
      listConditions.push(eq(crmDeals.partyId, input.partyId));
    }
    if (input.outcome) {
      listConditions.push(eq(crmDeals.outcome, input.outcome));
    }

    const decodedCursor = decodeKeysetCursor(input.cursor);
    if (decodedCursor && typeof decodedCursor.sortValue === 'number') {
      listConditions.push(lt(crmDeals.createdAt, decodedCursor.sortValue));
    }

    const itemsQuery = ctx.db
      .select({
        id: crmDeals.id,
        tenantId: crmDeals.tenantId,
        orgId: crmDeals.orgId,
        pipelineId: crmDeals.pipelineId,
        stageId: crmDeals.stageId,
        partyId: crmDeals.partyId,
        partyName: crmParties.displayName,
        title: crmDeals.title,
        valueMinor: crmDeals.valueMinor,
        currency: crmDeals.currency,
        probabilityBps: crmDeals.probabilityBps,
        expectedCloseDate: crmDeals.expectedCloseDate,
        outcome: crmDeals.outcome,
        createdAt: crmDeals.createdAt,
      })
      .from(crmDeals)
      .leftJoin(
        crmParties,
        and(
          eq(crmDeals.partyId, crmParties.id),
          eq(crmDeals.tenantId, crmParties.tenantId),
          isNull(crmParties.deletedAt),
        ),
      )
      .where(and(...listConditions))
      .orderBy(desc(crmDeals.createdAt))
      .limit(input.limit + 1);

    const summaryQuery = ctx.db
      .select({
        valueMinor: crmDeals.valueMinor,
        probabilityBps: crmDeals.probabilityBps,
        outcome: crmDeals.outcome,
      })
      .from(crmDeals)
      .where(and(...baseConditions));

    const [rowsPlusOne, allDeals] = await ctx.db.batch([itemsQuery, summaryQuery]);
    const page = buildCursorPage(rowsPlusOne, input.limit, (d) => ({
      sortValue: d.createdAt,
      id: d.id,
    }));

    let openMinor = 0n;
    let wonMinor = 0n;
    let weightedMinor = 0n;
    for (const row of allDeals) {
      const val = BigInt(row.valueMinor);
      if (row.outcome === 'won') {
        wonMinor += val;
      } else if (row.outcome === 'open') {
        openMinor += val;
        weightedMinor += (val * BigInt(row.probabilityBps)) / 10_000n;
      }
    }

    return {
      items: [...page.items],
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      summary: {
        totalCount: allDeals.length,
        openValueMinor: Number(openMinor),
        wonValueMinor: Number(wonMinor),
        weightedValueMinor: Number(weightedMinor),
      },
    };
  },
});

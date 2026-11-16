import {
  crmInteractionsAndTasks,
  crmParties,
  type ShacD1Database,
} from '@shac/db-d1';
import { defineCommand } from '@shac/kernel';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { buildOrgSubtreeFilter } from '../lib/scope-helpers.js';

export const interactionItemSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  partyId: z.string().nullable(),
  partyName: z.string().nullable(),
  dealId: z.string().nullable(),
  kind: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  priority: z.string(),
  status: z.string(),
  dueAt: z.number().int().nullable(),
  scheduledStart: z.number().int().nullable(),
  completedAt: z.number().int().nullable(),
  createdAt: z.number().int(),
});

const listInteractionsInputSchema = z.object({
  partyId: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const listInteractionsOutputSchema = z.object({
  items: z.array(interactionItemSchema),
  summary: z.object({
    totalCount: z.number().int().nonnegative(),
    openCount: z.number().int().nonnegative(),
    completedCount: z.number().int().nonnegative(),
  }),
});

export const customersInteractionsListCommand = defineCommand<
  typeof listInteractionsInputSchema,
  z.infer<typeof listInteractionsOutputSchema>,
  ShacD1Database
>({
  id: 'customers.interactions.list',
  moduleId: 'customers',
  method: 'GET',
  path: '/api/customers/interactions',
  summary: 'List customer tasks, calls, meetings, and activity log in <= 2 D1 queries',
  requiredPermission: 'customers.parties.read',
  mcp: {
    expose: true,
    readOnlyHint: true,
    description: 'List CRM tasks and customer interactions scoped by tenantId and orgPath',
  },
  inputSchema: listInteractionsInputSchema,
  outputSchema: listInteractionsOutputSchema,
  async handler(ctx, input) {
    const baseConds = [
      eq(crmInteractionsAndTasks.tenantId, ctx.tenantId),
      isNull(crmInteractionsAndTasks.deletedAt),
      buildOrgSubtreeFilter(ctx, crmInteractionsAndTasks.orgId),
    ];
    const filterConds = [...baseConds];
    if (input.partyId) filterConds.push(eq(crmInteractionsAndTasks.partyId, input.partyId));
    if (input.status) filterConds.push(eq(crmInteractionsAndTasks.status, input.status));
    if (input.kind) filterConds.push(eq(crmInteractionsAndTasks.kind, input.kind));

    const rowsQuery = ctx.db
      .select({
        id: crmInteractionsAndTasks.id,
        tenantId: crmInteractionsAndTasks.tenantId,
        orgId: crmInteractionsAndTasks.orgId,
        partyId: crmInteractionsAndTasks.partyId,
        partyName: crmParties.displayName,
        dealId: crmInteractionsAndTasks.dealId,
        kind: crmInteractionsAndTasks.kind,
        title: crmInteractionsAndTasks.title,
        body: crmInteractionsAndTasks.body,
        priority: crmInteractionsAndTasks.priority,
        status: crmInteractionsAndTasks.status,
        dueAt: crmInteractionsAndTasks.dueAt,
        scheduledStart: crmInteractionsAndTasks.scheduledStart,
        completedAt: crmInteractionsAndTasks.completedAt,
        createdAt: crmInteractionsAndTasks.createdAt,
      })
      .from(crmInteractionsAndTasks)
      .leftJoin(
        crmParties,
        and(
          eq(crmInteractionsAndTasks.partyId, crmParties.id),
          eq(crmInteractionsAndTasks.tenantId, crmParties.tenantId),
          isNull(crmParties.deletedAt),
        ),
      )
      .where(and(...filterConds))
      .orderBy(desc(crmInteractionsAndTasks.createdAt))
      .limit(input.limit);

    const summaryQuery = ctx.db
      .select({ status: crmInteractionsAndTasks.status })
      .from(crmInteractionsAndTasks)
      .where(and(...baseConds));

    const [items, allRows] = await ctx.db.batch([rowsQuery, summaryQuery]);
    let openCount = 0;
    let completedCount = 0;
    for (const r of allRows) {
      if (r.status === 'completed' || r.status === 'done') completedCount += 1;
      else openCount += 1;
    }
    return {
      items,
      summary: { totalCount: allRows.length, openCount, completedCount },
    };
  },
});

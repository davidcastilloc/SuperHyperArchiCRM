import {
  assertOrgScope,
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  crmDeals,
  iamOrganizations,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand, sha256Hex } from '@shac/kernel';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

const dealStageInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  dealId: z.string().min(1),
  stageId: z.string().min(1),
  probabilityBps: z.number().int().min(0).max(10_000).optional(),
  outcome: z.enum(['open', 'won', 'lost']).optional(),
});

const dealStageOutputSchema = z.object({
  id: z.string(),
  stageId: z.string(),
  probabilityBps: z.number().int().min(0).max(10_000),
  outcome: z.string(),
  updatedAt: z.number().int(),
});

export const customersDealsStageCommand = defineCommand<
  typeof dealStageInputSchema,
  z.infer<typeof dealStageOutputSchema>,
  ShacD1Database
>({
  id: 'customers.deals.stage',
  moduleId: 'customers',
  method: 'POST',
  path: '/api/customers/deals/stage',
  summary: 'Transition a CRM deal across Kanban pipeline stages or mark won/lost',
  requiredPermission: 'customers.deals.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description: 'Idempotently move a CRM deal to a new stageId and update probabilityBps/outcome',
  },
  inputSchema: dealStageInputSchema,
  outputSchema: dealStageOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({ commandId: 'customers.deals.stage', ...input, clientMutationId: undefined }),
    );
    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      dealStageOutputSchema,
    );
    if (replay) return replay;

    const rows = await ctx.db
      .select({
        id: crmDeals.id,
        tenantId: crmDeals.tenantId,
        orgId: crmDeals.orgId,
        partyId: crmDeals.partyId,
        probabilityBps: crmDeals.probabilityBps,
        outcome: crmDeals.outcome,
        stageHistoryJson: crmDeals.stageHistoryJson,
        version: crmDeals.version,
        orgTreePath: iamOrganizations.treePath,
      })
      .from(crmDeals)
      .leftJoin(
        iamOrganizations,
        and(
          eq(crmDeals.orgId, iamOrganizations.id),
          eq(crmDeals.tenantId, iamOrganizations.tenantId),
          isNull(iamOrganizations.deletedAt),
        ),
      )
      .where(and(eq(crmDeals.id, input.dealId), isNull(crmDeals.deletedAt)))
      .limit(1);

    const deal = rows[0];
    if (!deal || deal.tenantId !== ctx.tenantId) {
      throw new AppError('NOT_FOUND', 404, 'Deal not found');
    }
    assertOrgScope(
      ctx,
      deal.tenantId,
      deal.orgTreePath ?? (deal.orgId === ctx.orgId ? ctx.orgPath : '/__out_of_scope__'),
    );

    const nowSec = Math.floor(Date.now() / 1000);
    const nextProb = input.probabilityBps ?? deal.probabilityBps;
    const nextOutcome = input.outcome ?? deal.outcome;
    let history: unknown[] = [];
    try {
      const parsed = JSON.parse(deal.stageHistoryJson) as unknown;
      if (Array.isArray(parsed)) history = parsed;
    } catch {
      history = [];
    }
    history.push({ stageId: input.stageId, outcome: nextOutcome, enteredAt: nowSec, actorId: ctx.actor.id });

    const out: z.infer<typeof dealStageOutputSchema> = {
      id: deal.id,
      stageId: input.stageId,
      probabilityBps: nextProb,
      outcome: nextOutcome,
      updatedAt: nowSec,
    };
    const responseJson = JSON.stringify(out);

    await ctx.db.batch([
      ctx.db
        .update(crmDeals)
        .set({
          stageId: input.stageId,
          probabilityBps: nextProb,
          outcome: nextOutcome,
          stageHistoryJson: JSON.stringify(history),
          version: deal.version + 1,
          updatedAt: nowSec,
        })
        .where(and(eq(crmDeals.id, deal.id), eq(crmDeals.tenantId, ctx.tenantId))),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: deal.orgId,
        clientMutationId: input.clientMutationId,
        commandId: 'customers.deals.stage',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: deal.orgId,
        actor: ctx.actor,
        commandId: 'customers.deals.stage',
        resourceKind: 'crm_deal',
        resourceId: deal.id,
        targetPartyId: deal.partyId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return out;
  },
});

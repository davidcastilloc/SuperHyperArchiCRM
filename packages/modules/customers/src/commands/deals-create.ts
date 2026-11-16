import {
  assertOrgScope,
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  crmDeals,
  crmPipelinesAndStages,
  iamOrganizations,
  type ShacD1Database,
} from '@shac/db-d1';
import { defineCommand, sha256Hex } from '@shac/kernel';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { parseJsonRecord } from '../lib/identity.js';
import {
  buildPartyScopeQuery,
  resolveScopedTargetOrg,
  verifyScopedPartyRow,
} from '../lib/scope-helpers.js';

const createDealInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  pipelineId: z.string().min(1),
  stageId: z.string().min(1),
  partyId: z.string().min(1),
  contactPartyId: z.string().min(1).nullable().optional(),
  title: z.string().min(1).max(200),
  valueMinor: z.number().int().nonnegative(),
  currency: z.string().min(3).max(8).default('USD'),
  probabilityBps: z.number().int().min(0).max(10_000).default(0),
  expectedCloseDate: z.string().max(32).nullable().optional(),
  ownerUserId: z.string().max(128).nullable().optional(),
  customFields: z.record(z.unknown()).default({}),
});

const dealOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  pipelineId: z.string(),
  stageId: z.string(),
  partyId: z.string(),
  contactPartyId: z.string().nullable(),
  title: z.string(),
  valueMinor: z.number().int().nonnegative(),
  currency: z.string(),
  probabilityBps: z.number().int().min(0).max(10_000),
  expectedCloseDate: z.string().nullable(),
  ownerUserId: z.string().nullable(),
  outcome: z.string(),
  customFields: z.record(z.unknown()),
  createdAt: z.number().int(),
});

export const customersDealsCreateCommand = defineCommand<
  typeof createDealInputSchema,
  z.infer<typeof dealOutputSchema>,
  ShacD1Database
>({
  id: 'customers.deals.create',
  moduleId: 'customers',
  method: 'POST',
  path: '/api/customers/deals',
  summary: 'Create a pipeline deal linked to a scoped party with integer valueMinor',
  requiredPermission: 'customers.deals.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description: 'Create a CRM deal for a scoped party using integer money (valueMinor)',
  },
  inputSchema: createDealInputSchema,
  outputSchema: dealOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'customers.deals.create',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      dealOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);

    const pipelineQuery = ctx.db
      .select({
        id: crmPipelinesAndStages.id,
        tenantId: crmPipelinesAndStages.tenantId,
        orgId: crmPipelinesAndStages.orgId,
        orgTreePath: iamOrganizations.treePath,
      })
      .from(crmPipelinesAndStages)
      .leftJoin(
        iamOrganizations,
        and(
          eq(crmPipelinesAndStages.orgId, iamOrganizations.id),
          eq(crmPipelinesAndStages.tenantId, iamOrganizations.tenantId),
          isNull(iamOrganizations.deletedAt),
        ),
      )
      .where(
        and(
          eq(crmPipelinesAndStages.id, input.pipelineId),
          isNull(crmPipelinesAndStages.deletedAt),
        ),
      )
      .limit(1);

    const partyQuery = buildPartyScopeQuery(ctx.db, input.partyId);
    const [partyRows, pipelineRows, contactRows] = input.contactPartyId
      ? await ctx.db.batch([
          partyQuery,
          pipelineQuery,
          buildPartyScopeQuery(ctx.db, input.contactPartyId),
        ])
      : [...(await ctx.db.batch([partyQuery, pipelineQuery])), undefined];

    verifyScopedPartyRow(ctx, partyRows[0], 'Party');
    if (input.contactPartyId) {
      verifyScopedPartyRow(ctx, contactRows?.[0], 'Contact party');
    }

    const pipeline = pipelineRows[0];
    if (pipeline) {
      assertOrgScope(
        ctx,
        pipeline.tenantId,
        pipeline.orgTreePath ??
          (pipeline.orgId === ctx.orgId ? ctx.orgPath : '/__out_of_scope__'),
      );
    }

    const dealId = crypto.randomUUID();
    const nowSec = Math.floor(Date.now() / 1000);
    const customFieldsJson = JSON.stringify(input.customFields);

    const created: z.infer<typeof dealOutputSchema> = {
      id: dealId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      pipelineId: input.pipelineId,
      stageId: input.stageId,
      partyId: input.partyId,
      contactPartyId: input.contactPartyId ?? null,
      title: input.title,
      valueMinor: input.valueMinor,
      currency: input.currency,
      probabilityBps: input.probabilityBps,
      expectedCloseDate: input.expectedCloseDate ?? null,
      ownerUserId: input.ownerUserId ?? null,
      outcome: 'open',
      customFields: parseJsonRecord(customFieldsJson),
      createdAt: nowSec,
    };

    const responseJson = JSON.stringify(created);

    await ctx.db.batch([
      ctx.db.insert(crmDeals).values({
        id: dealId,
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        pipelineId: input.pipelineId,
        stageId: input.stageId,
        partyId: input.partyId,
        contactPartyId: created.contactPartyId,
        title: input.title,
        valueMinor: input.valueMinor,
        currency: input.currency,
        probabilityBps: input.probabilityBps,
        expectedCloseDate: created.expectedCloseDate,
        ownerUserId: created.ownerUserId,
        outcome: 'open',
        stageHistoryJson: JSON.stringify([
          { stageId: input.stageId, enteredAt: nowSec, actorId: ctx.actor.id },
        ]),
        customFields: customFieldsJson,
        version: 1,
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'customers.deals.create',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'customers.deals.create',
        resourceKind: 'crm_deal',
        resourceId: dealId,
        targetPartyId: input.partyId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return created;
  },
});

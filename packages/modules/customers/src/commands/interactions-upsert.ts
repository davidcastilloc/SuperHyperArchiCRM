import {
  assertOrgScope,
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  crmInteractionsAndTasks,
  iamOrganizations,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand, sha256Hex } from '@shac/kernel';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { assertPartyInScope, resolveScopedTargetOrg } from '../lib/scope-helpers.js';
import { interactionItemSchema } from './interactions-list.js';

const upsertInteractionInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  id: z.string().min(1).optional(),
  orgId: z.string().min(1).optional(),
  partyId: z.string().min(1).nullable().optional(),
  dealId: z.string().min(1).nullable().optional(),
  kind: z.enum(['task', 'call', 'meeting', 'note', 'interaction']).default('task'),
  title: z.string().min(1).max(200),
  body: z.string().max(2000).nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  status: z.enum(['open', 'in_progress', 'completed']).default('open'),
  dueAt: z.number().int().nullable().optional(),
  scheduledStart: z.number().int().nullable().optional(),
});

export const customersInteractionsUpsertCommand = defineCommand<
  typeof upsertInteractionInputSchema,
  z.infer<typeof interactionItemSchema>,
  ShacD1Database
>({
  id: 'customers.interactions.upsert',
  moduleId: 'customers',
  method: 'POST',
  path: '/api/customers/interactions',
  summary: 'Create or update a CRM customer task, call, meeting, or interaction note',
  requiredPermission: 'customers.parties.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description: 'Idempotently create or update a customer task or activity log entry',
  },
  inputSchema: upsertInteractionInputSchema,
  outputSchema: interactionItemSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({ commandId: 'customers.interactions.upsert', ...input, clientMutationId: undefined }),
    );
    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      interactionItemSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);
    if (input.partyId) {
      await assertPartyInScope(ctx, input.partyId, 'Party');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const completedAt = input.status === 'completed' ? nowSec : null;

    if (input.id) {
      const existingRows = await ctx.db
        .select({
          id: crmInteractionsAndTasks.id,
          tenantId: crmInteractionsAndTasks.tenantId,
          orgId: crmInteractionsAndTasks.orgId,
          createdAt: crmInteractionsAndTasks.createdAt,
          orgTreePath: iamOrganizations.treePath,
        })
        .from(crmInteractionsAndTasks)
        .leftJoin(
          iamOrganizations,
          and(
            eq(crmInteractionsAndTasks.orgId, iamOrganizations.id),
            eq(crmInteractionsAndTasks.tenantId, iamOrganizations.tenantId),
            isNull(iamOrganizations.deletedAt),
          ),
        )
        .where(and(eq(crmInteractionsAndTasks.id, input.id), isNull(crmInteractionsAndTasks.deletedAt)))
        .limit(1);

      const row = existingRows[0];
      if (!row || row.tenantId !== ctx.tenantId) {
        throw new AppError('NOT_FOUND', 404, 'Interaction not found');
      }
      assertOrgScope(ctx, row.tenantId, row.orgTreePath ?? (row.orgId === ctx.orgId ? ctx.orgPath : '/__out_of_scope__'));

      const updated: z.infer<typeof interactionItemSchema> = {
        id: row.id,
        tenantId: ctx.tenantId,
        orgId: row.orgId,
        partyId: input.partyId ?? null,
        partyName: null,
        dealId: input.dealId ?? null,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        priority: input.priority,
        status: input.status,
        dueAt: input.dueAt ?? null,
        scheduledStart: input.scheduledStart ?? null,
        completedAt,
        createdAt: row.createdAt,
      };
      const responseJson = JSON.stringify(updated);
      await ctx.db.batch([
        ctx.db
          .update(crmInteractionsAndTasks)
          .set({
            kind: input.kind,
            title: input.title,
            body: updated.body,
            priority: input.priority,
            status: input.status,
            dueAt: updated.dueAt,
            scheduledStart: updated.scheduledStart,
            completedAt,
            updatedAt: nowSec,
          })
          .where(and(eq(crmInteractionsAndTasks.id, row.id), eq(crmInteractionsAndTasks.tenantId, ctx.tenantId))),
        buildIdempotencyInsert(ctx.db, {
          tenantId: ctx.tenantId,
          orgId: row.orgId,
          clientMutationId: input.clientMutationId,
          commandId: 'customers.interactions.upsert',
          requestHash,
          responseJson,
          nowSec,
        }),
      ]);
      return updated;
    }

    const newId = crypto.randomUUID();
    const created: z.infer<typeof interactionItemSchema> = {
      id: newId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      partyId: input.partyId ?? null,
      partyName: null,
      dealId: input.dealId ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      priority: input.priority,
      status: input.status,
      dueAt: input.dueAt ?? null,
      scheduledStart: input.scheduledStart ?? null,
      completedAt,
      createdAt: nowSec,
    };
    const responseJson = JSON.stringify(created);

    await ctx.db.batch([
      ctx.db.insert(crmInteractionsAndTasks).values({
        id: newId,
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        partyId: created.partyId,
        dealId: created.dealId,
        kind: input.kind,
        title: input.title,
        body: created.body,
        priority: input.priority,
        status: input.status,
        dueAt: created.dueAt,
        scheduledStart: created.scheduledStart,
        ownerUserId: ctx.actor.id,
        assignedToUserId: ctx.actor.id,
        completedAt,
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'customers.interactions.upsert',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'customers.interactions.upsert',
        resourceKind: 'crm_interaction',
        resourceId: newId,
        targetPartyId: created.partyId ?? undefined,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return created;
  },
});

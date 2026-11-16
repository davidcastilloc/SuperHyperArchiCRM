import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  condoCommunityHub,
  type ShacD1Database,
} from '@shac/db-d1';
import { defineCommand, sha256Hex } from '@shac/kernel';
import { z } from 'zod';
import {
  buildPartyScopeQuery,
  buildUnitScopeQuery,
  parseJsonRecord,
  resolveScopedTargetOrg,
  verifyScopedRow,
} from '../lib/scope-helpers.js';

const communityItemKindSchema = z.enum([
  'pet_registration',
  'lost_pet_alert',
  'resident_vehicle',
  'community_poll',
  'community_event',
  'marketplace_listing',
  'announcement',
]);

const postCommunityInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  itemKind: communityItemKindSchema,
  partyId: z.string().min(1).nullable().optional(),
  unitId: z.string().min(1).nullable().optional(),
  title: z.string().min(1).max(200),
  bodyOrDetails: z.record(z.unknown()).default({}),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  startsAt: z.number().int().nullable().optional(),
  endsAt: z.number().int().nullable().optional(),
  status: z.string().min(1).max(32).default('ACTIVE'),
  customFields: z.record(z.unknown()).default({}),
});

const communityPostOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  itemKind: communityItemKindSchema,
  partyId: z.string().nullable(),
  unitId: z.string().nullable(),
  title: z.string(),
  bodyOrDetails: z.record(z.unknown()),
  priority: z.string(),
  startsAt: z.number().int().nullable(),
  endsAt: z.number().int().nullable(),
  status: z.string(),
  customFields: z.record(z.unknown()),
  createdAt: z.number().int(),
});

export const leasesCommunityPostCommand = defineCommand<
  typeof postCommunityInputSchema,
  z.infer<typeof communityPostOutputSchema>,
  ShacD1Database
>({
  id: 'leases.community.post',
  moduleId: 'leases',
  method: 'POST',
  path: '/api/leases/community',
  summary:
    'Publish an item to the condo/HOA community hub (pets, vehicles, polls, events, announcements)',
  requiredPermission: 'leases.community.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Create a condo_community_hub entry (pet_registration, lost_pet_alert, resident_vehicle, community_poll, community_event, marketplace_listing, announcement)',
  },
  inputSchema: postCommunityInputSchema,
  outputSchema: communityPostOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'leases.community.post',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      communityPostOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);

    if (input.partyId && input.unitId) {
      const [partyRows, unitRows] = await ctx.db.batch([
        buildPartyScopeQuery(ctx.db, input.partyId),
        buildUnitScopeQuery(ctx.db, input.unitId),
      ]);
      verifyScopedRow(ctx, partyRows[0], 'Party');
      verifyScopedRow(ctx, unitRows[0], 'Unit');
    } else if (input.partyId) {
      const partyRows = await buildPartyScopeQuery(ctx.db, input.partyId);
      verifyScopedRow(ctx, partyRows[0], 'Party');
    } else if (input.unitId) {
      const unitRows = await buildUnitScopeQuery(ctx.db, input.unitId);
      verifyScopedRow(ctx, unitRows[0], 'Unit');
    }

    const postId = crypto.randomUUID();
    const nowSec = Math.floor(Date.now() / 1000);
    const bodyOrDetailsJson = JSON.stringify(input.bodyOrDetails);
    const customFieldsJson = JSON.stringify(input.customFields);

    const created: z.infer<typeof communityPostOutputSchema> = {
      id: postId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      itemKind: input.itemKind,
      partyId: input.partyId ?? null,
      unitId: input.unitId ?? null,
      title: input.title,
      bodyOrDetails: parseJsonRecord(bodyOrDetailsJson),
      priority: input.priority,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      status: input.status,
      customFields: parseJsonRecord(customFieldsJson),
      createdAt: nowSec,
    };

    const responseJson = JSON.stringify(created);

    await ctx.db.batch([
      ctx.db.insert(condoCommunityHub).values({
        id: postId,
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        itemKind: input.itemKind,
        partyId: created.partyId,
        unitId: created.unitId,
        title: input.title,
        bodyOrDetailsJson,
        priority: input.priority,
        startsAt: created.startsAt,
        endsAt: created.endsAt,
        status: input.status,
        customFields: customFieldsJson,
        version: 1,
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'leases.community.post',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'leases.community.post',
        resourceKind: 'condo_community_hub',
        resourceId: postId,
        targetPartyId: created.partyId ?? undefined,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return created;
  },
});

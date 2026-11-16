import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  crmPartyLinks,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand, sha256Hex } from '@shac/kernel';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { parseJsonRecord } from '../lib/identity.js';
import {
  buildPartyScopeQuery,
  resolveScopedTargetOrg,
  verifyScopedPartyRow,
} from '../lib/scope-helpers.js';

const LINK_TYPES = [
  'company_contact',
  'parent_guardian',
  'roommate_occupant',
  'emergency_contact',
  'co_applicant',
  'distributor_store',
] as const;

const createPartyLinkInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  fromPartyId: z.string().min(1),
  toPartyId: z.string().min(1),
  linkType: z.enum(LINK_TYPES),
  roleTitle: z.string().max(120).nullable().optional(),
  isPrimary: z.boolean().default(false),
  canViewRecords: z.boolean().default(false),
  canJoinTelehealth: z.boolean().default(false),
  sharePercentageBps: z.number().int().min(0).max(10_000).default(0),
  commercialTerms: z.record(z.unknown()).default({}),
  customFields: z.record(z.unknown()).default({}),
});

const partyLinkOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  fromPartyId: z.string(),
  toPartyId: z.string(),
  linkType: z.enum(LINK_TYPES),
  roleTitle: z.string().nullable(),
  isPrimary: z.boolean(),
  canViewRecords: z.boolean(),
  canJoinTelehealth: z.boolean(),
  sharePercentageBps: z.number().int().min(0).max(10_000),
  commercialTerms: z.record(z.unknown()),
  customFields: z.record(z.unknown()),
  createdAt: z.number().int(),
});

export const customersLinksCreateCommand = defineCommand<
  typeof createPartyLinkInputSchema,
  z.infer<typeof partyLinkOutputSchema>,
  ShacD1Database
>({
  id: 'customers.links.create',
  moduleId: 'customers',
  method: 'POST',
  path: '/api/customers/links',
  summary: 'Link two parties (company contact, guardian, roommate, emergency contact, distributor)',
  requiredPermission: 'customers.parties.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description: 'Create a typed relationship link between two tenant-scoped parties',
  },
  inputSchema: createPartyLinkInputSchema,
  outputSchema: partyLinkOutputSchema,
  async handler(ctx, input) {
    if (input.fromPartyId === input.toPartyId) {
      throw new AppError(
        'INVALID_PARTY_LINK',
        400,
        'Cannot link a party to itself',
      );
    }

    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'customers.links.create',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      partyLinkOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);

    const [fromRows, toRows, existingRows] = await ctx.db.batch([
      buildPartyScopeQuery(ctx.db, input.fromPartyId),
      buildPartyScopeQuery(ctx.db, input.toPartyId),
      ctx.db
        .select({ id: crmPartyLinks.id })
        .from(crmPartyLinks)
        .where(
          and(
            eq(crmPartyLinks.tenantId, ctx.tenantId),
            eq(crmPartyLinks.fromPartyId, input.fromPartyId),
            eq(crmPartyLinks.toPartyId, input.toPartyId),
            eq(crmPartyLinks.linkType, input.linkType),
            isNull(crmPartyLinks.deletedAt),
          ),
        )
        .limit(1),
    ]);

    verifyScopedPartyRow(ctx, fromRows[0], 'fromParty');
    verifyScopedPartyRow(ctx, toRows[0], 'toParty');

    if (existingRows[0]) {
      throw new AppError(
        'LINK_ALREADY_EXISTS',
        409,
        'Party link already exists for this pair and linkType',
      );
    }

    const linkId = crypto.randomUUID();
    const nowSec = Math.floor(Date.now() / 1000);
    const commercialTermsJson = JSON.stringify(input.commercialTerms);
    const customFieldsJson = JSON.stringify(input.customFields);

    const created: z.infer<typeof partyLinkOutputSchema> = {
      id: linkId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      fromPartyId: input.fromPartyId,
      toPartyId: input.toPartyId,
      linkType: input.linkType,
      roleTitle: input.roleTitle ?? null,
      isPrimary: input.isPrimary,
      canViewRecords: input.canViewRecords,
      canJoinTelehealth: input.canJoinTelehealth,
      sharePercentageBps: input.sharePercentageBps,
      commercialTerms: parseJsonRecord(commercialTermsJson),
      customFields: parseJsonRecord(customFieldsJson),
      createdAt: nowSec,
    };

    const responseJson = JSON.stringify(created);

    await ctx.db.batch([
      ctx.db.insert(crmPartyLinks).values({
        id: linkId,
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        fromPartyId: input.fromPartyId,
        toPartyId: input.toPartyId,
        linkType: input.linkType,
        roleTitle: created.roleTitle,
        isPrimary: created.isPrimary,
        canViewRecords: created.canViewRecords,
        canJoinTelehealth: created.canJoinTelehealth,
        sharePercentageBps: created.sharePercentageBps,
        commercialTermsJson,
        customFields: customFieldsJson,
        version: 1,
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'customers.links.create',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'customers.links.create',
        resourceKind: 'crm_party_link',
        resourceId: linkId,
        targetPartyId: input.fromPartyId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return created;
  },
});

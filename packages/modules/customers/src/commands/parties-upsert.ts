import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  crmParties,
  crmPartyProfiles,
  type ShacD1Database,
} from '@shac/db-d1';
import { defineCommand, sha256Hex } from '@shac/kernel';
import { and, eq } from 'drizzle-orm';
import {
  normalizeAndHashEmail,
  normalizeAndHashTaxId,
} from '../lib/identity.js';
import { resolveScopedTargetOrg } from '../lib/scope-helpers.js';
import {
  mapPartyRow,
  partySummarySchema,
  upsertPartyInputSchema,
  type PartySummary,
} from './parties-schemas.js';
import {
  buildMutablePartyFields,
  buildMutableProfileFields,
  findExistingPartyForUpsert,
} from './parties-upsert-helpers.js';

export const customersPartiesUpsertCommand = defineCommand<
  typeof upsertPartyInputSchema,
  PartySummary,
  ShacD1Database
>({
  id: 'customers.parties.upsert',
  moduleId: 'customers',
  method: 'POST',
  path: '/api/customers/parties',
  summary: 'Create or update a unified party with multi-role mask, hashed tax ID, and optional profile',
  requiredPermission: 'customers.parties.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Upsert a unified CRM party (customer, vendor, patient, guest, resident, legal client, carrier) with optional profile',
  },
  inputSchema: upsertPartyInputSchema,
  outputSchema: partySummarySchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'customers.parties.upsert',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      partySummarySchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);
    const dedupedRoles = Array.from(new Set(input.rolesMask));
    const taxId =
      typeof input.taxIdNumber === 'string'
        ? await normalizeAndHashTaxId(input.taxIdNumber)
        : null;
    const email =
      typeof input.primaryEmail === 'string'
        ? await normalizeAndHashEmail(input.primaryEmail)
        : null;

    const existingHit = await findExistingPartyForUpsert(
      ctx,
      input.id,
      taxId?.hash ?? null,
    );

    const nowSec = Math.floor(Date.now() / 1000);
    const partyId = existingHit?.party.id ?? input.id ?? crypto.randomUUID();
    const orgId = existingHit?.party.orgId ?? targetOrgId;
    const version = existingHit ? existingHit.party.version + 1 : 1;
    const createdAt = existingHit?.party.createdAt ?? nowSec;

    const mutableFields = buildMutablePartyFields(
      input,
      dedupedRoles,
      {
        taxIdNumber:
          input.taxIdNumber === null
            ? null
            : (taxId?.normalized ?? existingHit?.party.taxIdNumber ?? null),
        taxIdHash:
          input.taxIdNumber === null
            ? null
            : (taxId?.hash ?? existingHit?.party.taxIdHash ?? null),
        primaryEmail:
          input.primaryEmail === null
            ? null
            : (email?.normalized ?? existingHit?.party.primaryEmail ?? null),
        emailHash:
          input.primaryEmail === null
            ? null
            : (email?.hash ?? existingHit?.party.emailHash ?? null),
      },
      version,
      nowSec,
    );

    const partyRecord = {
      id: partyId,
      tenantId: ctx.tenantId,
      orgId,
      createdAt,
      ...mutableFields,
    };

    const profileFields = input.profile
      ? buildMutableProfileFields(input.profile, nowSec)
      : null;

    const result = mapPartyRow(
      partyRecord,
      profileFields
        ? { partyId, ...profileFields }
        : (existingHit?.profile ?? null),
    );
    const responseJson = JSON.stringify(result);

    const partyStmt = existingHit
      ? ctx.db
          .update(crmParties)
          .set(mutableFields)
          .where(
            and(
              eq(crmParties.tenantId, ctx.tenantId),
              eq(crmParties.id, partyId),
            ),
          )
      : ctx.db.insert(crmParties).values(partyRecord);

    const idempotencyStmt = buildIdempotencyInsert(ctx.db, {
      tenantId: ctx.tenantId,
      orgId,
      clientMutationId: input.clientMutationId,
      commandId: 'customers.parties.upsert',
      requestHash,
      responseJson,
      nowSec,
    });

    const actionLogStmt = buildActionLogInsert(ctx.db, {
      tenantId: ctx.tenantId,
      orgId,
      actor: ctx.actor,
      commandId: 'customers.parties.upsert',
      resourceKind: 'crm_party',
      resourceId: partyId,
      targetPartyId: partyId,
      snapshotBeforeJson: existingHit
        ? JSON.stringify(mapPartyRow(existingHit.party, existingHit.profile))
        : null,
      snapshotAfterJson: responseJson,
      nowSec,
    });

    if (profileFields) {
      const profileStmt = ctx.db
        .insert(crmPartyProfiles)
        .values({
          partyId,
          tenantId: ctx.tenantId,
          createdAt: nowSec,
          ...profileFields,
        })
        .onConflictDoUpdate({
          target: crmPartyProfiles.partyId,
          set: profileFields,
        });
      await ctx.db.batch([partyStmt, profileStmt, idempotencyStmt, actionLogStmt]);
    } else {
      await ctx.db.batch([partyStmt, idempotencyStmt, actionLogStmt]);
    }

    return result;
  },
});

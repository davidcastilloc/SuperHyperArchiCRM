import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  phyAccessPasses,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand } from '@shac/kernel';
import { z } from 'zod';
import { sha256DigestHex } from '../lib/crypto.js';
import {
  buildPartyScopeQuery,
  buildUnitScopeQuery,
  parseJsonRecord,
  resolveScopedTargetOrg,
  verifyScopedRow,
} from '../lib/scope-helpers.js';

const passKindEnum = z.enum([
  'RESIDENT_PERMANENT',
  'VIP_LPR',
  'FLEET_CARGO_LPR',
  'VISITOR_TEMP',
  'DELIVERY_PIN',
  'SERVICE_TECH',
]);

const issuePassInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  unitId: z.string().min(1).nullable().optional(),
  partyId: z.string().min(1).nullable().optional(),
  bookingOrLeaseId: z.string().min(1).nullable().optional(),
  passKind: passKindEnum.default('VISITOR_TEMP'),
  holderName: z.string().min(1).max(160),
  licensePlate: z.string().min(2).max(32).nullable().optional(),
  pinOrQrSecret: z.string().min(4).max(256),
  allowedDeviceIds: z.array(z.string().min(1)).default([]),
  validFrom: z.number().int().positive(),
  validUntil: z.number().int().positive(),
  maxUses: z.number().int().positive().nullable().optional(),
  whatsappShareText: z.string().max(1024).nullable().optional(),
  customFields: z.record(z.unknown()).default({}),
});

const issuePassOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  unitId: z.string().nullable(),
  partyId: z.string().nullable(),
  bookingOrLeaseId: z.string().nullable(),
  passKind: passKindEnum,
  holderName: z.string(),
  licensePlate: z.string().nullable(),
  pinOrQrHash: z.string(),
  allowedDeviceIds: z.array(z.string()),
  validFrom: z.number().int(),
  validUntil: z.number().int(),
  maxUses: z.number().int().nullable(),
  useCount: z.number().int(),
  whatsappShareText: z.string(),
  status: z.string(),
  customFields: z.record(z.unknown()),
  createdAt: z.number().int(),
});

export const physicalPassesIssueCommand = defineCommand<
  typeof issuePassInputSchema,
  z.infer<typeof issuePassOutputSchema>,
  ShacD1Database
>({
  id: 'physical.passes.issue',
  moduleId: 'physical',
  method: 'POST',
  path: '/api/physical/passes/issue',
  summary:
    'Issue a temporary PIN or QR access pass at Check-In with SHA-256 digest stored in D1',
  requiredPermission: 'physical.passes.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Issue a PIN/QR access pass with SHA-256 hash stored in phy_access_passes',
  },
  inputSchema: issuePassInputSchema,
  outputSchema: issuePassOutputSchema,
  async handler(ctx, input) {
    if (input.validUntil < input.validFrom) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        'validUntil must be greater than or equal to validFrom',
      );
    }

    const requestHash = await sha256DigestHex(
      JSON.stringify({
        commandId: 'physical.passes.issue',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      issuePassOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);

    if (input.partyId) {
      const partyRows = await buildPartyScopeQuery(ctx.db, input.partyId);
      verifyScopedRow(ctx, partyRows[0], 'Party');
    }

    if (input.unitId) {
      const unitRows = await buildUnitScopeQuery(ctx.db, input.unitId);
      verifyScopedRow(ctx, unitRows[0], 'Unit');
    }

    const pinOrQrHash = await sha256DigestHex(input.pinOrQrSecret);
    const normalizedPlate = input.licensePlate
      ? input.licensePlate.trim().toUpperCase()
      : null;

    const passId = crypto.randomUUID();
    const nowSec = Math.floor(Date.now() / 1000);
    const allowedDeviceIdsJson = JSON.stringify(input.allowedDeviceIds);
    const customFieldsJson = JSON.stringify(input.customFields);
    const shareText =
      input.whatsappShareText ??
      `Access pass for ${input.holderName} (${input.passKind}) valid until ${new Date(input.validUntil * 1000).toISOString()}`;

    const created: z.infer<typeof issuePassOutputSchema> = {
      id: passId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      unitId: input.unitId ?? null,
      partyId: input.partyId ?? null,
      bookingOrLeaseId: input.bookingOrLeaseId ?? null,
      passKind: input.passKind,
      holderName: input.holderName,
      licensePlate: normalizedPlate,
      pinOrQrHash,
      allowedDeviceIds: input.allowedDeviceIds,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      maxUses: input.maxUses ?? null,
      useCount: 0,
      whatsappShareText: shareText,
      status: 'ACTIVE',
      customFields: parseJsonRecord(customFieldsJson),
      createdAt: nowSec,
    };

    const responseJson = JSON.stringify(created);

    await ctx.db.batch([
      ctx.db.insert(phyAccessPasses).values({
        id: passId,
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        unitId: created.unitId,
        partyId: created.partyId,
        bookingOrLeaseId: created.bookingOrLeaseId,
        passKind: input.passKind,
        holderName: input.holderName,
        licensePlate: normalizedPlate,
        pinOrQrHash,
        allowedDeviceIdsJson,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        maxUses: created.maxUses,
        useCount: 0,
        whatsappShareText: shareText,
        status: 'ACTIVE',
        customFields: customFieldsJson,
        version: 1,
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'physical.passes.issue',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'physical.passes.issue',
        resourceKind: 'phy_access_pass',
        resourceId: passId,
        targetPartyId: created.partyId ?? undefined,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return created;
  },
});

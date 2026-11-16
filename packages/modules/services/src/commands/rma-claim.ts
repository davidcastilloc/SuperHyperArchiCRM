import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  srvWarrantyClaimsRma,
  type ShacD1Database,
} from '@shac/db-d1';
import { defineCommand, sha256Hex } from '@shac/kernel';
import { z } from 'zod';
import {
  buildPartyScopeQuery,
  parseJsonRecord,
  resolveScopedTargetOrg,
  verifyScopedRow,
} from '../lib/scope-helpers.js';

const rmaLineSchema = z.object({
  sku: z.string().min(1),
  serialNumber: z.string().optional(),
  qty: z.number().int().positive().default(1),
  reason: z.string().min(1),
});

const claimRmaInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  claimNumber: z.string().min(1).max(64).optional(),
  partyId: z.string().min(1),
  originalOrderId: z.string().min(1).nullable().optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  slaDueAt: z.number().int().positive().nullable().optional(),
  advanceReplacement: z.boolean().default(false),
  returnTrackingNumber: z.string().max(128).nullable().optional(),
  lines: z.array(rmaLineSchema).default([]),
  vendorRecoveryStatus: z
    .enum(['PENDING', 'SUBMITTED', 'RECOVERED', 'DENIED'])
    .default('PENDING'),
  vendorRecoveredMinor: z.number().int().nonnegative().default(0),
  status: z
    .enum([
      'REQUESTED',
      'APPROVED',
      'IN_TRANSIT',
      'RECEIVED',
      'REPLACED',
      'CREDITED',
      'REJECTED',
    ])
    .default('REQUESTED'),
  customFields: z.record(z.unknown()).default({}),
});

const claimRmaOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  claimNumber: z.string(),
  partyId: z.string(),
  originalOrderId: z.string().nullable(),
  priority: z.string(),
  advanceReplacement: z.boolean(),
  vendorRecoveryStatus: z.string(),
  vendorRecoveredMinor: z.number().int().nonnegative(),
  status: z.string(),
  customFields: z.record(z.unknown()),
  createdAt: z.number().int(),
});

export const servicesRmaClaimCommand = defineCommand<
  typeof claimRmaInputSchema,
  z.infer<typeof claimRmaOutputSchema>,
  ShacD1Database
>({
  id: 'services.rma.claim',
  moduleId: 'services',
  method: 'POST',
  path: '/api/services/rma',
  summary: 'Create a warranty claim or RMA return authorization',
  requiredPermission: 'services.rma.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description: 'Submit a warranty/RMA claim for a customer party with integer vendorRecoveredMinor',
  },
  inputSchema: claimRmaInputSchema,
  outputSchema: claimRmaOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'services.rma.claim',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      claimRmaOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);

    const partyRows = await buildPartyScopeQuery(ctx.db, input.partyId);
    verifyScopedRow(ctx, partyRows[0], 'Customer party');

    const claimId = crypto.randomUUID();
    const nowSec = Math.floor(Date.now() / 1000);
    const claimNumber =
      input.claimNumber ?? `RMA-${claimId.slice(0, 8).toUpperCase()}`;
    const customFieldsJson = JSON.stringify(input.customFields);

    const created: z.infer<typeof claimRmaOutputSchema> = {
      id: claimId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      claimNumber,
      partyId: input.partyId,
      originalOrderId: input.originalOrderId ?? null,
      priority: input.priority,
      advanceReplacement: input.advanceReplacement,
      vendorRecoveryStatus: input.vendorRecoveryStatus,
      vendorRecoveredMinor: input.vendorRecoveredMinor,
      status: input.status,
      customFields: parseJsonRecord(customFieldsJson),
      createdAt: nowSec,
    };

    const responseJson = JSON.stringify(created);

    await ctx.db.batch([
      ctx.db.insert(srvWarrantyClaimsRma).values({
        id: claimId,
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        claimNumber,
        partyId: input.partyId,
        originalOrderId: created.originalOrderId,
        priority: input.priority,
        slaDueAt: input.slaDueAt ?? null,
        advanceReplacement: input.advanceReplacement,
        returnTrackingNumber: input.returnTrackingNumber ?? null,
        linesJson: JSON.stringify(input.lines),
        vendorRecoveryStatus: input.vendorRecoveryStatus,
        vendorRecoveredMinor: input.vendorRecoveredMinor,
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
        commandId: 'services.rma.claim',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'services.rma.claim',
        resourceKind: 'srv_warranty_claim_rma',
        resourceId: claimId,
        targetPartyId: input.partyId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return created;
  },
});

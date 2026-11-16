import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  evvFieldVisits,
  type ShacD1Database,
} from '@shac/db-d1';
import { defineCommand, sha256Hex } from '@shac/kernel';
import { z } from 'zod';
import {
  computeDistanceMeters,
  DEFAULT_EVV_GEOFENCE_METERS,
} from '../lib/geofence.js';
import {
  buildPartyScopeQuery,
  parseJsonRecord,
  resolveScopedTargetOrg,
  verifyScopedRow,
} from '../lib/scope-helpers.js';

const svgSignatureSchema = z
  .string()
  .min(1)
  .max(65_536)
  .refine((val) => val.includes('<svg'), 'Signature must be a valid SVG');

const recordEvvInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  sourceKind: z
    .enum(['field_tech', 'home_health', 'aba_therapy', 'maintenance'])
    .default('field_tech'),
  parentRecordId: z.string().min(1),
  partyId: z.string().min(1).nullable().optional(),
  staffId: z.string().min(1),
  targetLatMicros: z.number().int().min(-90_000_000).max(90_000_000),
  targetLngMicros: z.number().int().min(-180_000_000).max(180_000_000),
  clockInLatMicros: z.number().int().min(-90_000_000).max(90_000_000),
  clockInLngMicros: z.number().int().min(-180_000_000).max(180_000_000),
  maxGeofenceMeters: z
    .number()
    .int()
    .positive()
    .max(50_000)
    .default(DEFAULT_EVV_GEOFENCE_METERS),
  clockInAt: z.number().int().positive(),
  clockOutAt: z.number().int().positive().nullable().optional(),
  clientOrCaregiverSignatureSvg: svgSignatureSchema,
  staffSignatureSvg: svgSignatureSchema,
  status: z
    .enum(['CLOCKED_IN', 'CLOCKED_OUT', 'VERIFIED'])
    .optional(),
  customFields: z.record(z.unknown()).default({}),
});

const evvOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  sourceKind: z.string(),
  parentRecordId: z.string(),
  partyId: z.string().nullable(),
  staffId: z.string(),
  distanceMeters: z.number().int().nonnegative(),
  geofenceCompliant: z.boolean(),
  clockInAt: z.number().int(),
  clockOutAt: z.number().int().nullable(),
  clientOrCaregiverSignatureSvg: z.string(),
  staffSignatureSvg: z.string(),
  status: z.string(),
  customFields: z.record(z.unknown()),
  createdAt: z.number().int(),
});

export const servicesEvvRecordCommand = defineCommand<
  typeof recordEvvInputSchema,
  z.infer<typeof evvOutputSchema>,
  ShacD1Database
>({
  id: 'services.evv.record',
  moduleId: 'services',
  method: 'POST',
  path: '/api/services/evv',
  summary: 'Record geofenced Electronic Visit Verification (EVV) with GPS coordinates and dual SVG signatures',
  requiredPermission: 'services.evv.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Record an EVV field visit using integer micro-degree GPS coordinates and dual SVG signatures',
  },
  inputSchema: recordEvvInputSchema,
  outputSchema: evvOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'services.evv.record',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      evvOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);

    if (input.partyId) {
      const partyRows = await buildPartyScopeQuery(ctx.db, input.partyId);
      verifyScopedRow(ctx, partyRows[0], 'Client party');
    }

    const distanceMeters = computeDistanceMeters(
      input.targetLatMicros,
      input.targetLngMicros,
      input.clockInLatMicros,
      input.clockInLngMicros,
    );
    const geofenceCompliant = distanceMeters <= input.maxGeofenceMeters;
    const status =
      input.status ?? (input.clockOutAt ? 'CLOCKED_OUT' : 'CLOCKED_IN');

    const visitId = crypto.randomUUID();
    const nowSec = Math.floor(Date.now() / 1000);
    const customFieldsJson = JSON.stringify(input.customFields);

    const created: z.infer<typeof evvOutputSchema> = {
      id: visitId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      sourceKind: input.sourceKind,
      parentRecordId: input.parentRecordId,
      partyId: input.partyId ?? null,
      staffId: input.staffId,
      distanceMeters,
      geofenceCompliant,
      clockInAt: input.clockInAt,
      clockOutAt: input.clockOutAt ?? null,
      clientOrCaregiverSignatureSvg: input.clientOrCaregiverSignatureSvg,
      staffSignatureSvg: input.staffSignatureSvg,
      status,
      customFields: parseJsonRecord(customFieldsJson),
      createdAt: nowSec,
    };

    const responseJson = JSON.stringify(created);

    await ctx.db.batch([
      ctx.db.insert(evvFieldVisits).values({
        id: visitId,
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        sourceKind: input.sourceKind,
        parentRecordId: input.parentRecordId,
        partyId: created.partyId,
        staffId: input.staffId,
        targetLatMicros: input.targetLatMicros,
        targetLngMicros: input.targetLngMicros,
        clockInLatMicros: input.clockInLatMicros,
        clockInLngMicros: input.clockInLngMicros,
        distanceMeters,
        geofenceCompliant,
        clockInAt: input.clockInAt,
        clockOutAt: created.clockOutAt,
        clientOrCaregiverSignatureSvg: input.clientOrCaregiverSignatureSvg,
        staffSignatureSvg: input.staffSignatureSvg,
        status,
        customFields: customFieldsJson,
        version: 1,
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'services.evv.record',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'services.evv.record',
        resourceKind: 'evv_field_visit',
        resourceId: visitId,
        targetPartyId: created.partyId ?? undefined,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return created;
  },
});

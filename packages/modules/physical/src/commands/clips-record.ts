import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  phyMediaClips,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand } from '@shac/kernel';
import { z } from 'zod';
import { sha256DigestHex } from '../lib/crypto.js';
import { parseJsonRecord, resolveScopedTargetOrg } from '../lib/scope-helpers.js';

const clipKindEnum = z.enum([
  'MOTION_EVENT',
  'LPR_TRIGGER',
  'TAMPER_EVIDENCE',
  'DOOR_UNLOCK',
  'MANUAL',
]);

const recordClipInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  cameraDeviceId: z.string().min(1),
  linkedEventId: z.string().min(1).nullable().optional(),
  clipKind: clipKindEnum.default('MOTION_EVENT'),
  r2Key: z.string().min(1).max(512),
  sha256Hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'sha256Hash must be a 64-char hex digest')
    .optional(),
  integrityPayload: z.string().min(1).optional(),
  durationSec: z.number().int().nonnegative().default(0),
  sizeBytes: z.number().int().nonnegative().default(0),
  recordedAt: z.number().int().positive().optional(),
  retentionUntil: z.number().int().positive().nullable().optional(),
  customFields: z.record(z.unknown()).default({}),
});

const recordClipOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  cameraDeviceId: z.string(),
  linkedEventId: z.string().nullable(),
  clipKind: clipKindEnum,
  r2Key: z.string(),
  sha256Hash: z.string(),
  durationSec: z.number().int(),
  sizeBytes: z.number().int(),
  recordedAt: z.number().int(),
  retentionUntil: z.number().int().nullable(),
  status: z.string(),
  customFields: z.record(z.unknown()),
  createdAt: z.number().int(),
});

export const physicalClipsRecordCommand = defineCommand<
  typeof recordClipInputSchema,
  z.infer<typeof recordClipOutputSchema>,
  ShacD1Database
>({
  id: 'physical.clips.record',
  moduleId: 'physical',
  method: 'POST',
  path: '/api/physical/clips',
  summary:
    'Record R2 video clip metadata sealed with a SHA-256 integrity hash in phy_media_clips',
  requiredPermission: 'physical.clips.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Record R2 video clip metadata with SHA-256 integrity hash in phy_media_clips',
  },
  inputSchema: recordClipInputSchema,
  outputSchema: recordClipOutputSchema,
  async handler(ctx, input) {
    if (!input.sha256Hash && !input.integrityPayload) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        'Either sha256Hash or integrityPayload must be provided',
      );
    }

    const requestHash = await sha256DigestHex(
      JSON.stringify({
        commandId: 'physical.clips.record',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      recordClipOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);
    const nowSec = Math.floor(Date.now() / 1000);
    const recordedAt = input.recordedAt ?? nowSec;
    const sha256Hash = input.sha256Hash
      ? input.sha256Hash.toLowerCase()
      : await sha256DigestHex(input.integrityPayload!);

    const clipId = crypto.randomUUID();
    const customFieldsJson = JSON.stringify(input.customFields);

    const created: z.infer<typeof recordClipOutputSchema> = {
      id: clipId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      cameraDeviceId: input.cameraDeviceId,
      linkedEventId: input.linkedEventId ?? null,
      clipKind: input.clipKind,
      r2Key: input.r2Key,
      sha256Hash,
      durationSec: input.durationSec,
      sizeBytes: input.sizeBytes,
      recordedAt,
      retentionUntil: input.retentionUntil ?? null,
      status: 'SEALED',
      customFields: parseJsonRecord(customFieldsJson),
      createdAt: nowSec,
    };

    const responseJson = JSON.stringify(created);

    await ctx.db.batch([
      ctx.db.insert(phyMediaClips).values({
        id: clipId,
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        cameraDeviceId: input.cameraDeviceId,
        linkedEventId: created.linkedEventId,
        clipKind: input.clipKind,
        r2Key: input.r2Key,
        sha256Hash,
        durationSec: input.durationSec,
        sizeBytes: input.sizeBytes,
        recordedAt,
        retentionUntil: created.retentionUntil,
        status: 'SEALED',
        customFields: customFieldsJson,
        version: 1,
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'physical.clips.record',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'physical.clips.record',
        resourceKind: 'phy_media_clip',
        resourceId: clipId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return created;
  },
});

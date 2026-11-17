import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  phyTamperAlerts,
  type ShacD1Database,
} from '@shac/db-d1';
import {
  computeAuditEntryHashHex,
  defineCommand,
  GENESIS_AUDIT_HASH,
} from '@shac/kernel';
import { z } from 'zod';
import { sha256DigestHex } from '../lib/crypto.js';
import { parseJsonRecord, resolveScopedTargetOrg } from '../lib/scope-helpers.js';

const reportTamperInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  deviceId: z.string().min(1),
  alertKind: z
    .enum([
      'ENCLOSURE_OPEN',
      'POWER_LOSS',
      'HEARTBEAT_TIMEOUT',
      'CAMERA_BLINDED',
      'FORCED_ENTRY',
      'SIGNAL_JAM',
    ])
    .default('ENCLOSURE_OPEN'),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('CRITICAL'),
  description: z.string().min(1).max(1024),
  evidenceClipId: z.string().min(1).nullable().optional(),
  originSiteDid: z.string().min(1).nullable().optional(),
  occurredAt: z.number().int().positive().optional(),
  customFields: z.record(z.unknown()).default({}),
});

const reportTamperOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  deviceId: z.string(),
  alertKind: z.string(),
  severity: z.string(),
  description: z.string(),
  evidenceClipId: z.string().nullable(),
  originSiteDid: z.string().nullable(),
  occurredAt: z.number().int(),
  status: z.string(),
  customFields: z.record(z.unknown()),
  createdAt: z.number().int(),
});

export const physicalTamperReportCommand = defineCommand<
  typeof reportTamperInputSchema,
  z.infer<typeof reportTamperOutputSchema>,
  ShacD1Database
>({
  id: 'physical.tamper.report',
  moduleId: 'physical',
  method: 'POST',
  path: '/api/physical/tamper',
  summary: 'Record a CRITICAL anti-sabotage tamper alert in phy_tamper_alerts',
  requiredPermission: 'physical.tamper.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Record anti-sabotage alert in phy_tamper_alerts with CRITICAL severity',
  },
  inputSchema: reportTamperInputSchema,
  outputSchema: reportTamperOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256DigestHex(
      JSON.stringify({
        commandId: 'physical.tamper.report',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      reportTamperOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);
    const nowSec = Math.floor(Date.now() / 1000);
    const occurredAt = input.occurredAt ?? nowSec;
    const alertId = crypto.randomUUID();
    const customFieldsJson = JSON.stringify(input.customFields);

    const created: z.infer<typeof reportTamperOutputSchema> = {
      id: alertId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      deviceId: input.deviceId,
      alertKind: input.alertKind,
      severity: input.severity,
      description: input.description,
      evidenceClipId: input.evidenceClipId ?? null,
      originSiteDid: input.originSiteDid ?? null,
      occurredAt,
      status: 'OPEN',
      customFields: parseJsonRecord(customFieldsJson),
      createdAt: nowSec,
    };

    const responseJson = JSON.stringify(created);
    await computeAuditEntryHashHex({
      orgId: targetOrgId,
      streamKey: 'physical:tamper',
      seqNo: nowSec,
      actorId: ctx.actor.id,
      action: input.alertKind,
      targetId: alertId,
      occurredAtMs: occurredAt * 1000,
      prevHashHex: GENESIS_AUDIT_HASH,
      payload: created,
    });

    await ctx.db.batch([
      ctx.db.insert(phyTamperAlerts).values({
        id: alertId,
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        deviceId: input.deviceId,
        alertKind: input.alertKind,
        severity: input.severity,
        description: input.description,
        evidenceClipId: created.evidenceClipId,
        originSiteDid: created.originSiteDid,
        occurredAt,
        status: 'OPEN',
        customFields: customFieldsJson,
        version: 1,
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'physical.tamper.report',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'physical.tamper.report',
        resourceKind: 'phy_tamper_alert',
        resourceId: alertId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return created;
  },
});

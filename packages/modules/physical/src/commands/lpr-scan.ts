import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  phyAccessPasses,
  phyLprGates,
  phyLprPlateEvents,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand } from '@shac/kernel';
import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { sha256DigestHex } from '../lib/crypto.js';
import { resolveScopedTargetOrg } from '../lib/scope-helpers.js';

const lprScanInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  gateId: z.string().min(1),
  licensePlate: z.string().min(2).max(32),
  confidenceBps: z.number().int().min(0).max(10_000).default(9500),
  snapshotR2Key: z.string().min(1).max(512).nullable().optional(),
  hmacSignature: z.string().min(1).max(256).nullable().optional(),
  nowSec: z.number().int().positive().optional(),
});

const lprScanOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  gateId: z.string(),
  gateCode: z.string(),
  passId: z.string().nullable(),
  licensePlate: z.string(),
  confidenceBps: z.number().int(),
  decision: z.enum(['GRANTED', 'DENIED']),
  latencyMs: z.number().int().nonnegative(),
  withinSla: z.boolean(),
  snapshotR2Key: z.string().nullable(),
  doormanNotified: z.boolean(),
  doormanNotification: z.object({
    channel: z.string(),
    target: z.string().nullable(),
    decision: z.enum(['GRANTED', 'DENIED']),
    licensePlate: z.string(),
    gateCode: z.string(),
    message: z.string(),
  }),
  occurredAt: z.number().int(),
});

export const physicalLprScanCommand = defineCommand<
  typeof lprScanInputSchema,
  z.infer<typeof lprScanOutputSchema>,
  ShacD1Database
>({
  id: 'physical.lpr.scan',
  moduleId: 'physical',
  method: 'POST',
  path: '/api/physical/lpr/scan',
  summary:
    'Evaluate an LPR license plate scan against the gate whitelist and emit a doorman notification payload',
  requiredPermission: 'physical.lpr.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'LPR plate scan (< 15 ms check) against phy_lpr_gates whitelist, recording phy_lpr_plate_events and returning WhatsApp/Telegram doorman notification payload',
  },
  inputSchema: lprScanInputSchema,
  outputSchema: lprScanOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256DigestHex(
      JSON.stringify({
        commandId: 'physical.lpr.scan',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      lprScanOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);
    const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
    const normalizedPlate = input.licensePlate.trim().toUpperCase();

    const gateRows = await ctx.db
      .select()
      .from(phyLprGates)
      .where(
        and(
          eq(phyLprGates.tenantId, ctx.tenantId),
          eq(phyLprGates.orgId, targetOrgId),
          or(
            eq(phyLprGates.id, input.gateId),
            eq(phyLprGates.gateCode, input.gateId),
          ),
          eq(phyLprGates.isActive, true),
          isNull(phyLprGates.deletedAt),
        ),
      )
      .limit(1);

    const gate = gateRows[0];
    if (!gate) {
      throw new AppError('NOT_FOUND', 404, 'Active LPR gate not found');
    }

    const scanStartMs = performance.now();
    const passRows = await ctx.db
      .select({
        id: phyAccessPasses.id,
        holderName: phyAccessPasses.holderName,
        passKind: phyAccessPasses.passKind,
      })
      .from(phyAccessPasses)
      .where(
        and(
          eq(phyAccessPasses.tenantId, ctx.tenantId),
          eq(phyAccessPasses.orgId, targetOrgId),
          eq(phyAccessPasses.licensePlate, normalizedPlate),
          eq(phyAccessPasses.status, 'ACTIVE'),
          lte(phyAccessPasses.validFrom, nowSec),
          gte(phyAccessPasses.validUntil, nowSec),
          isNull(phyAccessPasses.deletedAt),
        ),
      )
      .limit(1);

    const latencyMs = Math.max(0, Math.round(performance.now() - scanStartMs));
    const matchedPass = passRows[0] ?? null;
    const decision: 'GRANTED' | 'DENIED' = matchedPass ? 'GRANTED' : 'DENIED';
    const withinSla = latencyMs < 15;

    const eventId = crypto.randomUUID();
    const message = matchedPass
      ? `[LPR GRANTED] Gate ${gate.gateCode} (${gate.laneDirection}): Plate ${normalizedPlate} matched ${matchedPass.holderName} (${matchedPass.passKind}) in ${latencyMs}ms.`
      : `[LPR DENIED] Gate ${gate.gateCode} (${gate.laneDirection}): Unknown or expired plate ${normalizedPlate} (${latencyMs}ms). Doorman review required.`;

    const created: z.infer<typeof lprScanOutputSchema> = {
      id: eventId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      gateId: gate.id,
      gateCode: gate.gateCode,
      passId: matchedPass?.id ?? null,
      licensePlate: normalizedPlate,
      confidenceBps: input.confidenceBps,
      decision,
      latencyMs,
      withinSla,
      snapshotR2Key: input.snapshotR2Key ?? null,
      doormanNotified: true,
      doormanNotification: {
        channel: gate.notifyChannel,
        target: gate.notifyTarget ?? null,
        decision,
        licensePlate: normalizedPlate,
        gateCode: gate.gateCode,
        message,
      },
      occurredAt: nowSec,
    };

    const responseJson = JSON.stringify(created);

    await ctx.db.batch([
      ctx.db.insert(phyLprPlateEvents).values({
        id: eventId,
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        gateId: gate.id,
        passId: created.passId,
        licensePlate: normalizedPlate,
        confidenceBps: input.confidenceBps,
        decision,
        latencyMs,
        snapshotR2Key: created.snapshotR2Key,
        doormanNotified: true,
        hmacSignature: input.hmacSignature ?? null,
        occurredAt: nowSec,
        customFields: '{}',
        version: 1,
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'physical.lpr.scan',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'physical.lpr.scan',
        resourceKind: 'phy_lpr_plate_event',
        resourceId: eventId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return created;
  },
});

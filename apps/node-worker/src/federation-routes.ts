import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  createD1Client,
  wmsPickings,
  wmsStockMoves,
} from '@shac/db-d1';
import {
  consolidatePendingRestocks,
  evaluateReorderTrigger,
  verifyFederationEnvelope,
  type FederationEnvelope,
} from '@shac/federation-sdk';
import { AppError, type ProfileLoader } from '@shac/kernel';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  authenticateWorkerActor,
  readJsonBodyWithMutationId,
  type HonoEnv,
} from './command-registry.js';

const ReorderEvaluateInputSchema = z.object({
  trigger: z.object({
    availableQty: z.number().int(),
    reorderPoint: z.number().int(),
    urgent: z.boolean().default(false),
    consolidateLowStockHours: z.number().int().nonnegative().optional(),
  }),
  pendingItems: z
    .array(
      z.object({
        supplierDid: z.string().min(1),
        gtin: z.string().min(1),
        requestedQty: z.number().int().positive(),
        queuedAtMs: z.number().int(),
        localSku: z.string().optional(),
        branchId: z.string().optional(),
      }),
    )
    .default([]),
  windowMs: z.number().int().positive().optional(),
});

const AsnReceiveInputSchema = z.object({
  envelope: z.unknown(),
  senderPublicKeyJwk: z.record(z.unknown()),
  sourceLocationId: z.string().min(1),
  destLocationId: z.string().min(1),
  productId: z.string().min(1),
  orgId: z.string().min(1).optional(),
  variantId: z.string().min(1).optional(),
  lotId: z.string().min(1).optional(),
});

const AsnReceiptResultSchema = z.object({
  ok: z.literal(true),
  pickingId: z.string(),
  moveId: z.string(),
  pickingNumber: z.string(),
  operationKind: z.literal('asn_receipt'),
  envelopeId: z.string(),
  eventType: z.enum(['B2B_SHIPMENT_DISPATCHED', 'B2B_EPOD_CONFIRMED']),
  qtyMicros: z.number().int().positive(),
  lotCode: z.string().nullable(),
});

type AsnReceiptResult = z.infer<typeof AsnReceiptResultSchema>;

async function authenticateReadActor(c: Context<HonoEnv>, profileLoader: ProfileLoader) {
  try {
    return await authenticateWorkerActor(
      c.env,
      c.req.raw.headers,
      profileLoader,
      'wms',
      'wms.pickings.read',
    );
  } catch (err) {
    if (err instanceof AppError && err.code === 'FORBIDDEN') {
      return authenticateWorkerActor(
        c.env,
        c.req.raw.headers,
        profileLoader,
        'iam',
        'iam.orgs.read',
      );
    }
    throw err;
  }
}

function extractAsnPayloadDetails(payload: Record<string, unknown>) {
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const firstItem =
    rawItems.length > 0 && typeof rawItems[0] === 'object' && rawItems[0] !== null
      ? (rawItems[0] as Record<string, unknown>)
      : undefined;

  const rawQty =
    typeof payload.qty === 'number'
      ? payload.qty
      : typeof payload.shippedQty === 'number'
        ? payload.shippedQty
        : typeof firstItem?.qty === 'number'
          ? firstItem.qty
          : 1;
  if (!Number.isSafeInteger(rawQty) || rawQty <= 0) {
    throw new AppError('INVALID_ASN_QTY', 400, 'ASN payload quantity must be a positive safe integer');
  }

  const rawCost =
    typeof payload.unitCostMinor === 'number'
      ? payload.unitCostMinor
      : typeof firstItem?.unitPriceMinor === 'number'
        ? firstItem.unitPriceMinor
        : 0;
  if (!Number.isSafeInteger(rawCost) || rawCost < 0) {
    throw new AppError('INVALID_ASN_COST', 400, 'ASN unitCostMinor must be a non-negative safe integer');
  }

  const currency = typeof payload.currency === 'string' && payload.currency.length > 0 ? payload.currency : 'USD';
  const lotCode =
    typeof payload.lotCode === 'string'
      ? payload.lotCode
      : typeof payload.gs1Lot === 'string'
        ? payload.gs1Lot
        : typeof firstItem?.lotCode === 'string'
          ? firstItem.lotCode
          : null;
  const poNumber = typeof payload.poNumber === 'string' ? payload.poNumber : null;

  return { qtyMicros: rawQty * 1_000_000, unitCostMinor: rawCost, currency, lotCode, poNumber };
}

function assertAsnEventType(
  envelope: FederationEnvelope,
): 'B2B_SHIPMENT_DISPATCHED' | 'B2B_EPOD_CONFIRMED' {
  if (envelope.eventType !== 'B2B_SHIPMENT_DISPATCHED' && envelope.eventType !== 'B2B_EPOD_CONFIRMED') {
    throw new AppError('UNSUPPORTED_FEDERATION_EVENT', 403, `Event type ${envelope.eventType} is not accepted by asn-receive`);
  }
  return envelope.eventType;
}

/**
 * Mounts /api/federation/* B2B reorder & ASN receipt routes.
 */
export function createFederationRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .post('/b2b/reorder-evaluate', async (c) => {
      c.header('X-Request-Id', c.req.header('X-Request-Id') ?? crypto.randomUUID());
      c.header('X-SHAC-Mode', 'edge');

      const { profile } = await authenticateReadActor(c, profileLoader);
      const parsed = ReorderEvaluateInputSchema.safeParse(await readJsonBodyWithMutationId(c));
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid reorder evaluation input', parsed.error.flatten());
      }

      const hours = parsed.data.trigger.consolidateLowStockHours ?? profile.federation.consolidateLowStockHours;
      const decision = evaluateReorderTrigger({
        availableQty: parsed.data.trigger.availableQty,
        reorderPoint: parsed.data.trigger.reorderPoint,
        urgent: parsed.data.trigger.urgent,
        consolidateLowStockHours: hours,
      });
      const batches = consolidatePendingRestocks(parsed.data.pendingItems, parsed.data.windowMs);
      return c.json({ ok: true, decision, batches }, 200);
    })
    .post('/b2b/asn-receive', async (c) => {
      c.header('X-Request-Id', c.req.header('X-Request-Id') ?? crypto.randomUUID());
      c.header('X-SHAC-Mode', 'edge');

      const { actor } = await authenticateWorkerActor(
        c.env,
        c.req.raw.headers,
        profileLoader,
        'wms',
        'wms.pickings.write',
      );

      const parsed = AsnReceiveInputSchema.safeParse(await readJsonBodyWithMutationId(c));
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid ASN receive input', parsed.error.flatten());
      }

      const envelope = await verifyFederationEnvelope(
        parsed.data.envelope,
        parsed.data.senderPublicKeyJwk as unknown as JsonWebKey,
      );
      const eventType = assertAsnEventType(envelope);

      const db = createD1Client(c.env.DB);
      const existing = await checkIdempotency(
        db,
        actor.tenantId,
        envelope.envelopeId,
        envelope.payloadHashSha256,
        AsnReceiptResultSchema,
      );
      if (existing) {
        return c.json({ ...existing, idempotentReplay: true }, 200);
      }

      const details = extractAsnPayloadDetails(envelope.payload);
      const nowSec = Math.floor(Date.now() / 1000);
      const orgId = parsed.data.orgId ?? actor.orgId;
      const pickingId = crypto.randomUUID();
      const moveId = crypto.randomUUID();
      const pickingNumber = `ASN-${envelope.envelopeId.slice(0, 28)}`;

      const result: AsnReceiptResult = {
        ok: true,
        pickingId,
        moveId,
        pickingNumber,
        operationKind: 'asn_receipt',
        envelopeId: envelope.envelopeId,
        eventType,
        qtyMicros: details.qtyMicros,
        lotCode: details.lotCode,
      };

      const resultJson = JSON.stringify(result);
      await db.batch([
        db.insert(wmsPickings).values({
          id: pickingId,
          tenantId: actor.tenantId,
          orgId,
          pickingNumber,
          operationKind: 'asn_receipt',
          sourceLocationId: parsed.data.sourceLocationId,
          destLocationId: parsed.data.destLocationId,
          completedAt: nowSec,
          assignedToUserId: actor.id,
          status: 'done',
          customFields: JSON.stringify({
            envelopeId: envelope.envelopeId,
            senderDid: envelope.senderDid,
            eventType,
            poNumber: details.poNumber,
            lotCode: details.lotCode,
          }),
          createdAt: nowSec,
          updatedAt: nowSec,
        }),
        db.insert(wmsStockMoves).values({
          id: moveId,
          tenantId: actor.tenantId,
          orgId,
          pickingId,
          productId: parsed.data.productId,
          variantId: parsed.data.variantId ?? null,
          lotId: parsed.data.lotId ?? null,
          sourceLocationId: parsed.data.sourceLocationId,
          destLocationId: parsed.data.destLocationId,
          uom: 'UNIT',
          demandedQtyMicros: details.qtyMicros,
          doneQtyMicros: details.qtyMicros,
          unitCostMinor: details.unitCostMinor,
          currency: details.currency,
          reasonCode: eventType,
          performedByUserId: actor.id,
          idempotencyKey: `asn:${envelope.envelopeId}:0`,
          occurredAt: nowSec,
          customFields: JSON.stringify({ lotCode: details.lotCode }),
          createdAt: nowSec,
          updatedAt: nowSec,
        }),
        buildIdempotencyInsert(db, {
          tenantId: actor.tenantId,
          orgId,
          clientMutationId: envelope.envelopeId,
          commandId: 'federation.b2b.asn_receive',
          requestHash: envelope.payloadHashSha256,
          responseJson: resultJson,
          nowSec,
        }),
        buildActionLogInsert(db, {
          tenantId: actor.tenantId,
          orgId,
          actor,
          commandId: 'federation.b2b.asn_receive',
          resourceKind: 'wms_picking',
          resourceId: pickingId,
          snapshotAfterJson: resultJson,
          nowSec,
        }),
      ]);

      return c.json({ ...result, idempotentReplay: false }, 201);
    });
}

import {
  assertPublicOfferSafe,
  FederationEnvelopeSchema,
  normalizeGtin,
  verifyFederationEnvelope,
  type FederationEnvelope,
} from '@shac/federation-sdk';
import { AppError, verifyTimestampWindow } from '@shac/kernel';
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import {
  B2bOrderStatusPayloadSchema,
  B2bPoSubmittedPayloadSchema,
  CatalogOfferUpsertPayloadSchema,
  CatalogOfferWithdrawPayloadSchema,
} from './envelope-schemas.js';
import {
  hubB2bOrders,
  hubEnvelopesIdempotency,
  hubNodes,
  hubPublicOffers,
} from './schema.js';

export type HubDb = DrizzleD1Database;

const EVENT_STATUS_MAP: Partial<Record<FederationEnvelope['eventType'], string>> = {
  B2B_PO_ACCEPTED: 'ACCEPTED',
  B2B_PO_BACKORDERED: 'BACKORDERED',
  B2B_SHIPMENT_DISPATCHED: 'DISPATCHED',
  B2B_EPOD_CONFIRMED: 'EPOD_CONFIRMED',
};

export interface ProcessedEnvelopeResult {
  status: 200 | 201;
  idempotentReplay: boolean;
  envelopeId: string;
  eventType: FederationEnvelope['eventType'];
  result: Record<string, unknown>;
}

async function handleEnvelopeEffect(
  db: HubDb,
  envelope: FederationEnvelope,
  nowIso: string,
): Promise<Record<string, unknown>> {
  if (envelope.eventType === 'CATALOG_OFFER_UPSERTED') {
    assertPublicOfferSafe(envelope.payload);
    const data = CatalogOfferUpsertPayloadSchema.parse(envelope.payload);
    if (!data.isPublicInNetwork) {
      throw new AppError(
        'PRIVACY_BOUNDARY_VIOLATION',
        403,
        'Only public network offers may be published to the Hub',
      );
    }
    const normalizedGtin = normalizeGtin(data.gtin);
    const offerId = data.offerId ?? `${envelope.senderDid}:${data.supplierSku}`;

    await db
      .insert(hubPublicOffers)
      .values({
        id: offerId,
        supplierDid: envelope.senderDid,
        gtin: normalizedGtin,
        supplierSku: data.supplierSku,
        title: data.title,
        category: data.category,
        city: data.city,
        region: data.region,
        unitPriceMinor: data.unitPriceMinor,
        minOrderQty: data.minOrderQty,
        uomFactorMicros: data.uomFactorMicros,
        availableQty: data.availableQty,
        deliveryHours: data.deliveryHours,
        isActive: data.isActive ? 1 : 0,
        updatedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: hubPublicOffers.id,
        set: {
          gtin: normalizedGtin,
          title: data.title,
          category: data.category,
          city: data.city,
          region: data.region,
          unitPriceMinor: data.unitPriceMinor,
          minOrderQty: data.minOrderQty,
          uomFactorMicros: data.uomFactorMicros,
          availableQty: data.availableQty,
          deliveryHours: data.deliveryHours,
          isActive: data.isActive ? 1 : 0,
          updatedAt: nowIso,
        },
      });

    return { action: 'offer_upserted', offerId, gtin: normalizedGtin };
  }

  if (envelope.eventType === 'CATALOG_OFFER_WITHDRAWN') {
    const data = CatalogOfferWithdrawPayloadSchema.parse(envelope.payload);
    const offerId =
      data.offerId ??
      (data.supplierSku ? `${envelope.senderDid}:${data.supplierSku}` : undefined);
    if (!offerId) {
      throw new AppError('INVALID_PAYLOAD', 400, 'offerId or supplierSku is required');
    }
    await db
      .update(hubPublicOffers)
      .set({ isActive: 0, updatedAt: nowIso })
      .where(
        and(
          eq(hubPublicOffers.id, offerId),
          eq(hubPublicOffers.supplierDid, envelope.senderDid),
        ),
      );
    return { action: 'offer_withdrawn', offerId };
  }

  if (envelope.eventType === 'B2B_PO_SUBMITTED') {
    const data = B2bPoSubmittedPayloadSchema.parse(envelope.payload);
    const orderId = data.orderId ?? `po_${envelope.envelopeId}`;
    const supplierDid = data.supplierDid ?? envelope.recipientDid;
    await db
      .insert(hubB2bOrders)
      .values({
        id: orderId,
        poNumber: data.poNumber,
        buyerDid: envelope.senderDid,
        supplierDid,
        status: 'SUBMITTED',
        itemsJson: JSON.stringify(data.items),
        totalMinor: data.totalMinor,
        updatedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: hubB2bOrders.id,
        set: {
          status: 'SUBMITTED',
          itemsJson: JSON.stringify(data.items),
          totalMinor: data.totalMinor,
          updatedAt: nowIso,
        },
      });
    return {
      action: 'b2b_po_submitted',
      orderId,
      poNumber: data.poNumber,
      status: 'SUBMITTED',
    };
  }

  const nextStatus = EVENT_STATUS_MAP[envelope.eventType];
  if (nextStatus) {
    const data = B2bOrderStatusPayloadSchema.parse(envelope.payload);
    const [existingOrder] = await db
      .select()
      .from(hubB2bOrders)
      .where(
        data.orderId
          ? eq(hubB2bOrders.id, data.orderId)
          : eq(hubB2bOrders.poNumber, data.poNumber),
      )
      .limit(1);

    if (!existingOrder) {
      throw new AppError(
        'B2B_ORDER_NOT_FOUND',
        404,
        `B2B order ${data.orderId ?? data.poNumber} not found`,
      );
    }

    await db
      .update(hubB2bOrders)
      .set({ status: nextStatus, updatedAt: nowIso })
      .where(eq(hubB2bOrders.id, existingOrder.id));

    return {
      action: envelope.eventType.toLowerCase(),
      orderId: existingOrder.id,
      poNumber: existingOrder.poNumber,
      status: nextStatus,
    };
  }

  return { action: 'rfq_recorded', envelopeId: envelope.envelopeId };
}

export function assertEnvelopeTimestampWindow(
  issuedAtMs: number,
  nowMs: number = Date.now(),
  maxSkewMs: number = 300_000,
): void {
  if (!verifyTimestampWindow(issuedAtMs, nowMs, maxSkewMs)) {
    throw new AppError(
      'ENVELOPE_TIMESTAMP_SKEW',
      409,
      'Federation envelope timestamp is outside the allowed 300s skew window',
    );
  }
}

export async function processHubEnvelope(
  db: HubDb,
  rawEnvelope: unknown,
  nowMs: number = Date.now(),
): Promise<ProcessedEnvelopeResult> {
  const preParsed = FederationEnvelopeSchema.safeParse(rawEnvelope);
  if (!preParsed.success) {
    throw new AppError(
      'INVALID_ENVELOPE',
      400,
      'Malformed federation envelope',
      preParsed.error.flatten(),
    );
  }

  const [senderNode] = await db
    .select()
    .from(hubNodes)
    .where(eq(hubNodes.did, preParsed.data.senderDid))
    .limit(1);

  if (!senderNode) {
    throw new AppError(
      'UNKNOWN_HUB_NODE',
      404,
      `Sender DID ${preParsed.data.senderDid} is not registered`,
    );
  }
  if (senderNode.status !== 'active') {
    throw new AppError(
      'INACTIVE_HUB_NODE',
      403,
      `Sender DID ${preParsed.data.senderDid} is not active`,
    );
  }

  const publicKeyJwk = JSON.parse(senderNode.publicKeyJwk) as JsonWebKey;
  const envelope = await verifyFederationEnvelope(preParsed.data, publicKeyJwk, nowMs);

  const [existing] = await db
    .select()
    .from(hubEnvelopesIdempotency)
    .where(eq(hubEnvelopesIdempotency.envelopeId, envelope.envelopeId))
    .limit(1);

  if (existing) {
    if (
      existing.payloadHash !== envelope.payloadHashSha256 ||
      existing.senderDid !== envelope.senderDid
    ) {
      throw new AppError(
        'ENVELOPE_IDEMPOTENCY_CONFLICT',
        409,
        `Envelope ${envelope.envelopeId} already processed with different payload or sender`,
      );
    }
    return {
      status: 200,
      idempotentReplay: true,
      envelopeId: envelope.envelopeId,
      eventType: envelope.eventType,
      result: JSON.parse(existing.responseJson) as Record<string, unknown>,
    };
  }

  const nowIso = new Date(nowMs).toISOString();
  const result = await handleEnvelopeEffect(db, envelope, nowIso);

  await db.insert(hubEnvelopesIdempotency).values({
    envelopeId: envelope.envelopeId,
    senderDid: envelope.senderDid,
    eventType: envelope.eventType,
    payloadHash: envelope.payloadHashSha256,
    responseJson: JSON.stringify(result),
    processedAt: nowIso,
  });

  return {
    status: 201,
    idempotentReplay: false,
    envelopeId: envelope.envelopeId,
    eventType: envelope.eventType,
    result,
  };
}

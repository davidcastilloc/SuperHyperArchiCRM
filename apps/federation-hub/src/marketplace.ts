import { normalizeGtin } from '@shac/federation-sdk';
import { AppError } from '@shac/kernel';
import { and, asc, eq, gt, gte, inArray, like, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { HubDb } from './envelopes.js';
import { hubInventoryHolds, hubPublicOffers } from './schema.js';

export const FindBestOffersSchema = z.object({
  gtin: z.string().min(8),
  qty: z.number().int().positive().default(1),
  region: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  allowedSupplierDids: z.array(z.string().min(1)).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export type FindBestOffersInput = z.infer<typeof FindBestOffersSchema>;

export const MarketplaceSearchSchema = z.object({
  q: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  region: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  gtin: z.string().min(8).optional(),
  maxPriceMinor: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export type MarketplaceSearchInput = z.infer<typeof MarketplaceSearchSchema>;

export const HoldInventorySchema = z.object({
  offerId: z.string().min(1),
  buyerRef: z.string().min(1),
  qty: z.number().int().positive(),
  ttlSeconds: z.number().int().min(10).max(3600).default(300),
  nowMs: z.number().int().positive().optional(),
});

export type HoldInventoryInput = z.infer<typeof HoldInventorySchema>;

export async function findBestOffers(db: HubDb, input: FindBestOffersInput) {
  const normalizedGtin = normalizeGtin(input.gtin);
  const conditions: SQL[] = [
    eq(hubPublicOffers.isActive, 1),
    eq(hubPublicOffers.gtin, normalizedGtin),
    gte(hubPublicOffers.availableQty, input.qty),
    lte(hubPublicOffers.minOrderQty, input.qty),
  ];

  if (input.region) {
    conditions.push(eq(hubPublicOffers.region, input.region));
  }
  if (input.city) {
    conditions.push(eq(hubPublicOffers.city, input.city));
  }
  if (input.allowedSupplierDids && input.allowedSupplierDids.length > 0) {
    conditions.push(inArray(hubPublicOffers.supplierDid, input.allowedSupplierDids));
  }

  const offers = await db
    .select()
    .from(hubPublicOffers)
    .where(and(...conditions))
    .orderBy(asc(hubPublicOffers.unitPriceMinor), asc(hubPublicOffers.deliveryHours))
    .limit(input.limit);

  return { gtin: normalizedGtin, offers };
}

export async function searchMarketplace(db: HubDb, input: MarketplaceSearchInput) {
  const conditions: SQL[] = [
    eq(hubPublicOffers.isActive, 1),
    gt(hubPublicOffers.availableQty, 0),
  ];

  if (input.city) {
    conditions.push(eq(hubPublicOffers.city, input.city));
  }
  if (input.region) {
    conditions.push(eq(hubPublicOffers.region, input.region));
  }
  if (input.category) {
    conditions.push(eq(hubPublicOffers.category, input.category));
  }
  if (input.gtin) {
    conditions.push(eq(hubPublicOffers.gtin, normalizeGtin(input.gtin)));
  }
  if (input.maxPriceMinor !== undefined) {
    conditions.push(lte(hubPublicOffers.unitPriceMinor, input.maxPriceMinor));
  }
  if (input.q) {
    conditions.push(like(hubPublicOffers.title, `%${input.q}%`));
  }

  const offers = await db
    .select()
    .from(hubPublicOffers)
    .where(and(...conditions))
    .orderBy(asc(hubPublicOffers.unitPriceMinor), asc(hubPublicOffers.deliveryHours))
    .limit(input.limit);

  return { offers };
}

export async function holdInventoryTTL(
  db: HubDb,
  kv: KVNamespace | undefined,
  input: HoldInventoryInput,
) {
  const nowMs = input.nowMs ?? Date.now();

  const [offer] = await db
    .select()
    .from(hubPublicOffers)
    .where(and(eq(hubPublicOffers.id, input.offerId), eq(hubPublicOffers.isActive, 1)))
    .limit(1);

  if (!offer) {
    throw new AppError(
      'OFFER_NOT_FOUND',
      404,
      `Active offer ${input.offerId} not found`,
    );
  }

  const activeHolds = await db
    .select({ qty: hubInventoryHolds.qty })
    .from(hubInventoryHolds)
    .where(
      and(
        eq(hubInventoryHolds.offerId, input.offerId),
        eq(hubInventoryHolds.status, 'HELD'),
        gt(hubInventoryHolds.expiresAt, nowMs),
      ),
    );

  const heldQty = activeHolds.reduce((sum, row) => sum + row.qty, 0);
  const remainingQty = offer.availableQty - heldQty;

  if (remainingQty < input.qty) {
    throw new AppError(
      'INSUFFICIENT_AVAILABLE_QTY',
      409,
      `Requested qty ${input.qty} exceeds remaining available qty ${Math.max(0, remainingQty)}`,
    );
  }

  const holdId = crypto.randomUUID();
  const expiresAt = nowMs + input.ttlSeconds * 1000;

  await db.insert(hubInventoryHolds).values({
    holdId,
    offerId: input.offerId,
    buyerRef: input.buyerRef,
    qty: input.qty,
    expiresAt,
    status: 'HELD',
  });

  if (kv) {
    await kv.put(
      `hold:${holdId}`,
      JSON.stringify({
        holdId,
        offerId: input.offerId,
        buyerRef: input.buyerRef,
        qty: input.qty,
        expiresAt,
      }),
      { expirationTtl: input.ttlSeconds },
    );
  }

  return {
    holdId,
    offerId: input.offerId,
    buyerRef: input.buyerRef,
    qty: input.qty,
    expiresAt,
    status: 'HELD' as const,
    remainingQty: remainingQty - input.qty,
  };
}

import { z } from 'zod';

export const CatalogOfferUpsertPayloadSchema = z.object({
  offerId: z.string().min(1).optional(),
  gtin: z.string().min(8),
  supplierSku: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1).default('general'),
  city: z.string().min(1),
  region: z.string().min(1),
  unitPriceMinor: z.number().int().positive(),
  minOrderQty: z.number().int().positive().default(1),
  uomFactorMicros: z.number().int().positive().default(1_000_000),
  availableQty: z.number().int().nonnegative(),
  deliveryHours: z.number().int().nonnegative().default(24),
  isActive: z.boolean().default(true),
  isPublicInNetwork: z.boolean().default(true),
});

export const CatalogOfferWithdrawPayloadSchema = z.object({
  offerId: z.string().min(1).optional(),
  supplierSku: z.string().min(1).optional(),
});

const B2bPoItemSchema = z.object({
  gtin: z.string().min(8).optional(),
  supplierSku: z.string().min(1).optional(),
  qty: z.number().int().positive(),
  unitPriceMinor: z.number().int().nonnegative(),
});

export const B2bPoSubmittedPayloadSchema = z.object({
  orderId: z.string().min(1).optional(),
  poNumber: z.string().min(1),
  supplierDid: z.string().min(1).optional(),
  items: z.array(B2bPoItemSchema).min(1),
  totalMinor: z.number().int().nonnegative(),
});

export const B2bOrderStatusPayloadSchema = z.object({
  orderId: z.string().min(1).optional(),
  poNumber: z.string().min(1),
});

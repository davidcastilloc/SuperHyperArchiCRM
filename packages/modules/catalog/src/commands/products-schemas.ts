import { z } from 'zod';

const defaultVariantInputSchema = z.object({
  id: z.string().min(1).optional(),
  sku: z.string().min(1).max(80).optional(),
  barcode: z.string().max(128).nullable().optional(),
  barcodeType: z
    .enum(['EAN13', 'UPCA', 'GS1_128', 'QR', 'CODE128'])
    .nullable()
    .optional(),
  presentationName: z.string().min(1).max(48).default('UNIDAD'),
  uomFactorMicros: z.number().int().positive().default(1_000_000),
  overridePriceMinor: z.number().int().nonnegative().nullable().optional(),
  defaultLocationId: z.string().min(1).nullable().optional(),
});

const variantSummarySchema = z.object({
  id: z.string(),
  productId: z.string(),
  sku: z.string(),
  barcode: z.string().nullable(),
  barcodeType: z.string().nullable(),
  presentationName: z.string(),
  uomFactorMicros: z.number().int().positive(),
  overridePriceMinor: z.number().int().nullable(),
  defaultLocationId: z.string().nullable(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
});

export const productSummarySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  itemKind: z.string(),
  sku: z.string(),
  gtin: z.string().nullable(),
  name: z.string(),
  subtitle: z.string().nullable(),
  categoryId: z.string().nullable(),
  baseUom: z.string(),
  salesUom: z.string(),
  trackingMode: z.string(),
  costingMethod: z.string(),
  removalStrategy: z.string(),
  basePriceMinor: z.number().int().nonnegative(),
  costPriceMinor: z.number().int().nonnegative(),
  standardPriceMinor: z.number().int().nonnegative(),
  primaryCurrency: z.string(),
  taxClass: z.string(),
  taxRateBps: z.number().int().nonnegative(),
  isFixedPrice: z.boolean(),
  isActive: z.boolean(),
  version: z.number().int().positive(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const upsertProductInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  id: z.string().min(1).optional(),
  orgId: z.string().min(1).optional(),
  itemKind: z
    .enum(['physical', 'service', 'clinical_cpt', 'medication', 'room_rate', 'fee'])
    .default('physical'),
  sku: z.string().trim().min(1).max(80),
  gtin: z.string().max(64).nullable().optional(),
  mpn: z.string().max(64).nullable().optional(),
  cptOrNdcCode: z.string().max(64).nullable().optional(),
  hsCode: z.string().max(32).nullable().optional(),
  name: z.string().trim().min(1).max(200),
  subtitle: z.string().max(240).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  baseUom: z.string().min(1).max(32).default('UNIT'),
  salesUom: z.string().min(1).max(32).default('UNIT'),
  trackingMode: z.enum(['NONE', 'LOT', 'LOT_EXPIRY', 'SERIAL']).default('NONE'),
  costingMethod: z.enum(['AVCO', 'FIFO', 'STANDARD']).default('AVCO'),
  removalStrategy: z.enum(['FEFO', 'FIFO']).default('FEFO'),
  basePriceMinor: z.number().int().nonnegative(),
  costPriceMinor: z.number().int().nonnegative().default(0),
  standardPriceMinor: z.number().int().nonnegative().optional(),
  primaryCurrency: z.string().trim().min(3).max(8).default('USD'),
  taxClass: z.enum(['GENERAL', 'REDUCED', 'EXEMPT', 'CUSTOM']).default('GENERAL'),
  taxRateBps: z.number().int().min(0).max(10_000).default(0),
  isFixedPrice: z.boolean().default(false),
  isPublicInNetwork: z.boolean().default(false),
  isActive: z.boolean().default(true),
  customFields: z.record(z.string(), z.unknown()).optional(),
  defaultVariant: defaultVariantInputSchema.optional(),
});

export const upsertProductOutputSchema = z.object({
  product: productSummarySchema,
  defaultVariant: variantSummarySchema.nullable(),
  created: z.boolean(),
});

export const listProductsInputSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  cursor: z.string().min(1).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  itemKind: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  orgId: z.string().min(1).optional(),
  includeInactive: z.coerce.boolean().default(false),
});

export const listProductsOutputSchema = z.object({
  items: z.array(productSummarySchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  nextCursor: z.string().nullable().optional(),
  hasMore: z.boolean().optional(),
});

export function buildProductSummary(
  input: z.infer<typeof upsertProductInputSchema>,
  params: {
    id: string;
    tenantId: string;
    orgId: string;
    primaryCurrency: string;
    version: number;
    createdAt: number;
    updatedAt: number;
  },
): z.infer<typeof productSummarySchema> {
  return {
    id: params.id,
    tenantId: params.tenantId,
    orgId: params.orgId,
    itemKind: input.itemKind,
    sku: input.sku,
    gtin: input.gtin ?? null,
    name: input.name,
    subtitle: input.subtitle ?? null,
    categoryId: input.categoryId ?? null,
    baseUom: input.baseUom,
    salesUom: input.salesUom,
    trackingMode: input.trackingMode,
    costingMethod: input.costingMethod,
    removalStrategy: input.removalStrategy,
    basePriceMinor: input.basePriceMinor,
    costPriceMinor: input.costPriceMinor,
    standardPriceMinor: input.standardPriceMinor ?? input.basePriceMinor,
    primaryCurrency: params.primaryCurrency,
    taxClass: input.taxClass,
    taxRateBps: input.taxRateBps,
    isFixedPrice: input.isFixedPrice,
    isActive: input.isActive,
    version: params.version,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
  };
}

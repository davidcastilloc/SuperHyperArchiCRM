import { z } from 'zod';

export const pickingOperationKindSchema = z.enum([
  'asn_receipt',
  'putaway',
  'wave_pick',
  'pack',
  'outgoing_ship',
  'internal_transfer',
  'pos_drop',
]);

export const pickingStatusSchema = z.enum([
  'draft',
  'waiting',
  'assigned',
  'done',
  'cancelled',
]);

export const pickingMoveLineInputSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).default('default'),
  lotId: z.string().min(1).nullable().optional(),
  lotCode: z.string().min(1).nullable().optional(),
  gs1RawBarcode: z.string().min(1).nullable().optional(),
  serialNumber: z.string().min(1).nullable().optional(),
  expiryEpochMs: z.number().int().nonnegative().nullable().optional(),
  manufactureEpochMs: z.number().int().nonnegative().nullable().optional(),
  packageId: z.string().min(1).nullable().optional(),
  uom: z.string().min(1).max(16).default('UNIT'),
  demandedQtyMicros: z.number().int().positive(),
  doneQtyMicros: z.number().int().nonnegative(),
  unitCostMinor: z.number().int().nonnegative().default(0),
  reasonCode: z.string().max(64).nullable().optional(),
  binCode: z.string().min(1).max(64).optional(),
});

export const processPickingInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  pickingId: z.string().min(1).optional(),
  pickingNumber: z.string().min(1).max(80).optional(),
  operationKind: pickingOperationKindSchema.default('outgoing_ship'),
  sourceLocationId: z.string().min(1).optional(),
  destLocationId: z.string().min(1).optional(),
  orderId: z.string().min(1).nullable().optional(),
  purchaseOrderId: z.string().min(1).nullable().optional(),
  partyId: z.string().min(1).nullable().optional(),
  assignedToUserId: z.string().min(1).nullable().optional(),
  binCode: z.string().min(1).max(64).default('MAIN'),
  allocateMode: z.enum(['DEDUCT', 'RESERVE']).default('DEDUCT'),
  currency: z.string().trim().length(3).default('USD'),
  lines: z.array(pickingMoveLineInputSchema).min(1),
});

const processedMoveSummarySchema = z.object({
  moveId: z.string(),
  productId: z.string(),
  lotId: z.string().nullable(),
  lotCode: z.string().nullable(),
  serialNumber: z.string().nullable(),
  demandedQtyMicros: z.number().int().positive(),
  doneQtyMicros: z.number().int().nonnegative(),
  remainingQtyMicros: z.number().int().nonnegative(),
  unitCostMinor: z.number().int().nonnegative(),
});

export const processPickingOutputSchema = z.object({
  ok: z.literal(true),
  pickingId: z.string(),
  pickingNumber: z.string(),
  operationKind: pickingOperationKindSchema,
  status: pickingStatusSchema,
  moves: z.array(processedMoveSummarySchema),
  backorderPicking: z
    .object({
      id: z.string(),
      pickingNumber: z.string(),
      backorderOfPickingId: z.string(),
      status: pickingStatusSchema,
      totalRemainingQtyMicros: z.number().int().positive(),
    })
    .nullable(),
  doSynced: z.boolean(),
});

export const listPickingsInputSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  cursor: z.string().min(1).optional(),
  orgId: z.string().min(1).optional(),
  status: pickingStatusSchema.optional(),
  operationKind: pickingOperationKindSchema.optional(),
  backorderOfPickingId: z.string().min(1).optional(),
  search: z.string().max(80).optional(),
});

const pickingListItemSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  pickingNumber: z.string(),
  operationKind: z.string(),
  sourceLocationId: z.string(),
  sourceLocationName: z.string().nullable(),
  sourceLocationKind: z.string().nullable(),
  destLocationId: z.string(),
  destLocationName: z.string().nullable(),
  destLocationKind: z.string().nullable(),
  orderId: z.string().nullable(),
  purchaseOrderId: z.string().nullable(),
  backorderOfPickingId: z.string().nullable(),
  partyId: z.string().nullable(),
  scheduledAt: z.number().int().nullable(),
  completedAt: z.number().int().nullable(),
  assignedToUserId: z.string().nullable(),
  status: z.string(),
  version: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const listPickingsOutputSchema = z.object({
  items: z.array(pickingListItemSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  nextCursor: z.string().nullable().optional(),
  hasMore: z.boolean().optional(),
});

const splitMethodSchema = z.enum([
  'by_value',
  'by_weight',
  'by_volume',
  'by_qty',
  'equal',
]);

export const allocateLandedCostsInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  splitMethod: splitMethodSchema,
  totalFreightMinor: z.number().int().nonnegative(),
  pickingIds: z.array(z.string().min(1)).default([]),
  costComponents: z
    .array(
      z.object({
        kind: z.string().min(1).max(40),
        amountMinor: z.number().int().nonnegative(),
        currency: z.string().trim().length(3).default('USD'),
      }),
    )
    .default([]),
  lines: z
    .array(
      z.object({
        lineId: z.string().min(1),
        productId: z.string().min(1),
        stockMoveId: z.string().min(1).optional(),
        qtyMicros: z.number().int().positive(),
        lineValueMinor: z.number().int().nonnegative().optional(),
        unitCostMinor: z.number().int().nonnegative().optional(),
        weightGrams: z.number().int().nonnegative().optional(),
        volumeCm3: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1),
});

export const allocateLandedCostsOutputSchema = z.object({
  ok: z.literal(true),
  splitMethod: splitMethodSchema,
  totalFreightMinor: z.number().int().nonnegative(),
  totalAllocatedMinor: z.number().int().nonnegative(),
  remainderDistributedMinor: z.number().int().nonnegative(),
  allocations: z.array(
    z.object({
      valuationId: z.string(),
      lineId: z.string(),
      productId: z.string(),
      stockMoveId: z.string().nullable(),
      qtyMicros: z.number().int().positive(),
      previousTotalValueMinor: z.number().int().nonnegative(),
      allocatedCostMinor: z.number().int().nonnegative(),
      newTotalValueMinor: z.number().int().nonnegative(),
      newUnitCostMinor: z.number().int().nonnegative(),
    }),
  ),
});

export const completeEpodInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  deliveryTripId: z.string().min(1).optional(),
  vehicleId: z.string().min(1),
  orderId: z.string().min(1).nullable().optional(),
  loadWeightGrams: z.number().int().nonnegative(),
  loadPallets: z.number().int().nonnegative(),
  requiresColdChain: z.boolean().default(false),
  epodRecipientName: z.string().trim().min(1).max(160),
  epodSignatureSvg: z.string().trim().min(1).max(32_000),
  epodPhotoR2Key: z.string().trim().min(1).max(512),
  epodLat: z.number().min(-90).max(90),
  epodLng: z.number().min(-180).max(180),
  gpsBreadcrumbs: z
    .array(
      z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        atSec: z.number().int().nonnegative(),
      }),
    )
    .default([]),
  autoRestocked: z.boolean().default(false),
  autoInvoiced: z.boolean().default(false),
});

export const completeEpodOutputSchema = z.object({
  ok: z.literal(true),
  deliveryTripId: z.string(),
  vehicleId: z.string(),
  vehicleCode: z.string().nullable(),
  orderId: z.string().nullable(),
  status: z.literal('delivered'),
  epodRecipientName: z.string(),
  epodPhotoR2Key: z.string(),
  epodLat: z.number(),
  epodLng: z.number(),
  arrivedAt: z.number().int(),
});

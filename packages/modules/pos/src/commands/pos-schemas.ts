import { z } from 'zod';

const currencyCodeSchema = z
  .string()
  .trim()
  .min(3)
  .max(8)
  .regex(/^[A-Za-z0-9_]{3,8}$/, 'Invalid currency code')
  .transform((value) => value.toUpperCase());

const safeNonNegIntSchema = z.number().int().safe().nonnegative();
const safePositiveIntSchema = z.number().int().safe().positive();

export const posShiftsOpenInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  shiftId: z.string().min(1).optional(),
  registerId: z.string().min(1).max(80),
  cashierUserId: z.string().min(1).optional(),
  cashierName: z.string().trim().min(1).max(160),
  initialBalancesMinor: z.record(currencyCodeSchema, safeNonNegIntSchema),
  openedAt: safeNonNegIntSchema.optional(),
});

export const posShiftsOpenOutputSchema = z.object({
  ok: z.literal(true),
  clientMutationId: z.string(),
  shiftId: z.string(),
  registerId: z.string(),
  cashierUserId: z.string(),
  cashierName: z.string(),
  status: z.literal('OPEN'),
  initialBalancesMinor: z.record(z.string(), safeNonNegIntSchema),
  nextTicketSeq: safePositiveIntSchema,
  openedAt: safeNonNegIntSchema,
  outboxSeqId: safePositiveIntSchema,
});

export const posShiftsCloseInputSchema = z
  .object({
    clientMutationId: z.string().min(1).max(128),
    orgId: z.string().min(1).optional(),
    shiftId: z.string().min(1).optional(),
    registerId: z.string().min(1).optional(),
    actualCountedBalancesMinor: z.record(currencyCodeSchema, safeNonNegIntSchema),
    observations: z.string().max(1000).optional(),
    plainTextReport: z.string().max(16_000).optional(),
    closedAt: safeNonNegIntSchema.optional(),
  })
  .refine((v) => Boolean(v.shiftId || v.registerId), {
    message: 'Either shiftId or registerId is required',
  });

export const posShiftsCloseOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  shiftId: z.string(),
  registerId: z.string(),
  cashierUserId: z.string(),
  cashierName: z.string(),
  status: z.literal('CLOSED'),
  openedAt: safeNonNegIntSchema,
  closedAt: safeNonNegIntSchema,
  shiftDurationSec: safeNonNegIntSchema,
  totalTickets: safeNonNegIntSchema,
  initialBalancesMinor: z.record(z.string(), z.number().int()),
  salesByCurrencyMinor: z.record(z.string(), z.number().int()),
  salesByMethodMinor: z.record(z.string(), z.number().int()),
  expensesByCurrencyMinor: z.record(z.string(), z.number().int()),
  expectedBalancesMinor: z.record(z.string(), z.number().int()),
  actualCountedBalancesMinor: z.record(z.string(), z.number().int()),
  discrepancyBalancesMinor: z.record(z.string(), z.number().int()),
  auditStatus: z.string(),
  plainTextReport: z.string(),
  outboxSeqId: safePositiveIntSchema,
});

export const posCheckoutLineInputSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).optional(),
  binCode: z.string().min(1).optional(),
  qty: safePositiveIntSchema,
  unitPriceMinor: safeNonNegIntSchema.optional(),
  manualDiscountBps: z.number().int().min(0).max(10_000).default(0),
  taxRateBps: z.number().int().min(0).max(10_000).optional(),
  trackInventory: z.boolean().optional(),
});

export const posCheckoutPaymentInputSchema = z.object({
  financialAccountId: z.string().min(1),
  currency: currencyCodeSchema,
  methodCode: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .transform((s) => s.toUpperCase()),
  amountMinor: safePositiveIntSchema,
  exchangeRateMicros: safePositiveIntSchema.optional(),
  rateDirection: z.enum(['order_to_payment', 'payment_to_order']).optional(),
  referenceNumber: z.string().max(120).optional(),
  externalGatewayTxId: z.string().max(120).optional(),
});

export const posSalesCheckoutInputSchema = z
  .object({
    clientMutationId: z.string().min(1).max(128),
    orgId: z.string().min(1).optional(),
    shiftId: z.string().min(1).optional(),
    registerId: z.string().min(1).optional(),
    channelId: z.string().min(1).optional(),
    warehouseId: z.string().min(1).optional(),
    partyId: z.string().min(1).optional(),
    customerSnapshot: z.record(z.string(), z.unknown()).optional(),
    orderNumber: z.string().trim().min(1).max(80).optional(),
    orderCurrency: currencyCodeSchema.default('USD'),
    exchangeRateMicros: safePositiveIntSchema.default(1_000_000),
    items: z.array(posCheckoutLineInputSchema).min(1).max(200),
    payments: z.array(posCheckoutPaymentInputSchema).min(1).max(32),
    withholdingIslrMinor: safeNonNegIntSchema.default(0),
    shippingMinor: safeNonNegIntSchema.default(0),
    allowBelowCost: z.boolean().default(false),
    nowEpochMs: safeNonNegIntSchema.optional(),
  })
  .refine((v) => Boolean(v.shiftId || v.registerId), {
    message: 'Either shiftId or registerId is required',
  });

export const posSalesCheckoutOutputSchema = z.object({
  orderId: z.string(),
  orderNumber: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  shiftId: z.string(),
  registerId: z.string(),
  ticketSeq: safePositiveIntSchema,
  nextTicketSeq: safePositiveIntSchema,
  orderCurrency: z.string(),
  grandTotalMinor: safeNonNegIntSchema,
  paidTotalMinor: safeNonNegIntSchema,
  changeGivenMinor: safeNonNegIntSchema,
  taxTotalMinor: safeNonNegIntSchema,
  lines: z.array(
    z.object({
      lineNo: safePositiveIntSchema,
      productId: z.string(),
      variantId: z.string().nullable(),
      sku: z.string(),
      qty: safePositiveIntSchema,
      unitPriceMinor: safeNonNegIntSchema,
      taxMinor: safeNonNegIntSchema,
      lineTotalMinor: safeNonNegIntSchema,
      lotId: z.string().nullable(),
    }),
  ),
  payments: z.array(
    z.object({
      paymentId: z.string(),
      paymentNumber: z.string(),
      financialAccountId: z.string(),
      methodCode: z.string(),
      currency: z.string(),
      amountMinor: safePositiveIntSchema,
      exchangeRateMicros: safePositiveIntSchema,
    }),
  ),
  outboxSeqId: safePositiveIntSchema,
});

export const posKioskSmartCheckInputSchema = z
  .object({
    code: z.string().trim().min(1).max(128).optional(),
    productId: z.string().min(1).optional(),
    secondaryCurrency: currencyCodeSchema.optional(),
    qty: z.coerce.number().int().safe().positive().default(1),
    asOfSec: z.coerce.number().int().safe().nonnegative().optional(),
  })
  .refine((v) => Boolean(v.code || v.productId), {
    message: 'Either code or productId is required',
  });

export const posKioskSmartCheckOutputSchema = z.object({
  autoCloseSeconds: z.literal(10),
  productId: z.string(),
  variantId: z.string().nullable(),
  sku: z.string(),
  gtin: z.string().nullable(),
  barcode: z.string().nullable(),
  name: z.string(),
  presentationName: z.string(),
  qty: safePositiveIntSchema,
  primaryCurrency: z.string(),
  taxRateBps: safeNonNegIntSchema,
  unitPriceExclTaxMinor: safeNonNegIntSchema,
  unitTaxMinor: safeNonNegIntSchema,
  unitPriceInclTaxMinor: safeNonNegIntSchema,
  lineTotalMinor: safeNonNegIntSchema,
  secondaryCurrency: z.string().nullable(),
  rateMicros: safePositiveIntSchema.nullable(),
  rateSource: z.string().nullable(),
  secondaryUnitPriceInclTaxMinor: safeNonNegIntSchema.nullable(),
  secondaryLineTotalMinor: safeNonNegIntSchema.nullable(),
});

const posReturnItemInputSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).default('default'),
  lotId: z.string().min(1).optional(),
  lotCode: z.string().min(1).optional(),
  binCode: z.string().min(1).optional(),
  qty: safePositiveIntSchema,
  unitCostMinor: safeNonNegIntSchema.optional(),
  disposition: z.enum(['RESTOCK', 'QUARANTINE', 'SCRAP']),
  expiryEpochMs: safeNonNegIntSchema.nullable().optional(),
  reason: z.string().max(500).optional(),
});

export const posReturnsSettleInputSchema = z
  .object({
    clientMutationId: z.string().min(1).max(128),
    orgId: z.string().min(1).optional(),
    originalOrderId: z.string().min(1),
    shiftId: z.string().min(1).optional(),
    returnType: z.enum(['partial', 'total']).default('partial'),
    settlementMode: z.enum(['credit_memo', 'refund_account']).default('credit_memo'),
    refundCurrency: currencyCodeSchema,
    refundAmountMinor: safeNonNegIntSchema,
    refundAccountId: z.string().min(1).optional(),
    items: z.array(posReturnItemInputSchema).min(1).max(100),
    nowEpochMs: safeNonNegIntSchema.optional(),
  })
  .refine(
    (v) => v.settlementMode !== 'refund_account' || Boolean(v.refundAccountId),
    { message: 'refundAccountId is required when settlementMode is refund_account' },
  );

export const posReturnsSettleOutputSchema = z.object({
  returnId: z.string(),
  returnNumber: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  originalOrderId: z.string(),
  returnType: z.enum(['partial', 'total']),
  physicalStatus: z.string(),
  financialStatus: z.string(),
  refundCurrency: z.string(),
  refundAmountMinor: safeNonNegIntSchema,
  refundAccountId: z.string().nullable(),
  outboxSeqId: safePositiveIntSchema,
  items: z.array(
    z.object({
      productId: z.string(),
      variantId: z.string(),
      lotId: z.string(),
      binCode: z.string(),
      disposition: z.enum(['RESTOCK', 'QUARANTINE', 'SCRAP']),
      quarantineStatus: z.enum(['RELEASED', 'QUARANTINE', 'REJECTED']),
      qty: safePositiveIntSchema,
      onHandQty: safeNonNegIntSchema,
      availableQty: safeNonNegIntSchema,
    }),
  ),
});

import { z } from 'zod';
import type { FefoAllocationSlice } from './contracts.js';

export const currencyCodeSchema = z
  .string()
  .trim()
  .min(3)
  .max(8)
  .regex(/^[A-Za-z0-9_]{3,8}$/, 'Invalid currency code')
  .transform((value) => value.toUpperCase());

export const posSaleLineItemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).default('default'),
  sku: z.string().min(1).optional(),
  binCode: z.string().min(1).optional(),
  qty: z.number().int().safe().positive(),
  unitPriceMinor: z.number().int().safe().nonnegative().optional(),
  trackInventory: z.boolean().default(true),
});

export type PosSaleLineItem = z.input<typeof posSaleLineItemSchema>;

export const posPaymentLineSchema = z.object({
  financialAccountId: z.string().min(1),
  accountCurrency: currencyCodeSchema,
  paymentCurrency: currencyCodeSchema,
  methodCode: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.toUpperCase()),
  amountMinor: z.number().int().safe().positive(),
  referenceNumber: z.string().min(1).optional(),
});

export type PosPaymentLine = z.infer<typeof posPaymentLineSchema>;

export const checkoutPosSaleInputSchema = z
  .object({
    clientMutationId: z.string().min(1),
    shiftId: z.string().min(1).optional(),
    registerId: z.string().min(1).optional(),
    orderId: z.string().min(1).optional(),
    orderCurrency: currencyCodeSchema.default('USD'),
    items: z.array(posSaleLineItemSchema).min(1),
    payments: z.array(posPaymentLineSchema).min(1),
    changeByCurrencyMinor: z
      .record(currencyCodeSchema, z.number().int().safe().nonnegative())
      .optional(),
    nowEpochMs: z.number().int().safe().nonnegative().optional(),
  })
  .refine((value) => Boolean(value.shiftId || value.registerId), {
    message: 'Either shiftId or registerId is required',
  });

export type CheckoutPosSaleInput = z.input<typeof checkoutPosSaleInputSchema>;

export interface PosSaleLineAllocation {
  productId: string;
  variantId: string;
  sku: string | null;
  qty: number;
  allocations: FefoAllocationSlice[];
}

export interface CheckoutPosSaleResult {
  ok: true;
  clientMutationId: string;
  shiftId: string;
  registerId: string;
  orderId: string;
  ticketSeq: number;
  nextTicketSeq: number;
  orderCurrency: string;
  items: PosSaleLineAllocation[];
  payments: PosPaymentLine[];
  salesByCurrencyMinor: Record<string, number>;
  salesByMethodMinor: Record<string, number>;
  outboxSeqId: number;
  checkedOutAtMs: number;
}

export const closePosShiftInputSchema = z
  .object({
    clientMutationId: z.string().min(1),
    shiftId: z.string().min(1).optional(),
    registerId: z.string().min(1).optional(),
    actualCountedBalancesMinor: z.record(
      currencyCodeSchema,
      z.number().int().safe().nonnegative(),
    ),
    closedByUserId: z.string().min(1).optional(),
    observations: z.string().max(1000).optional(),
    closedAt: z.number().int().safe().nonnegative().optional(),
  })
  .refine((value) => Boolean(value.shiftId || value.registerId), {
    message: 'Either shiftId or registerId is required',
  });

export type ClosePosShiftInput = z.input<typeof closePosShiftInputSchema>;

export interface ClosePosShiftResult {
  ok: true;
  clientMutationId: string;
  shiftId: string;
  registerId: string;
  cashierUserId: string;
  cashierName: string;
  status: 'CLOSED';
  openedAt: number;
  closedAt: number;
  shiftDurationSec: number;
  totalTickets: number;
  nextTicketSeq: number;
  initialBalancesMinor: Record<string, number>;
  salesByCurrencyMinor: Record<string, number>;
  salesByMethodMinor: Record<string, number>;
  expensesByCurrencyMinor: Record<string, number>;
  expectedBalancesMinor: Record<string, number>;
  actualCountedBalancesMinor: Record<string, number>;
  discrepancyBalancesMinor: Record<string, number>;
  outboxSeqId: number;
}

export const posReturnItemInputSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).default('default'),
  lotId: z.string().min(1).optional(),
  lotCode: z.string().min(1).optional(),
  binCode: z.string().min(1).optional(),
  qty: z.number().int().safe().positive(),
  unitCostMinor: z.number().int().safe().nonnegative().optional(),
  disposition: z.enum(['RESTOCK', 'QUARANTINE', 'SCRAP']),
  expiryEpochMs: z.number().int().safe().nonnegative().nullable().optional(),
  reason: z.string().max(500).optional(),
});

export type PosReturnItemInput = z.input<typeof posReturnItemInputSchema>;

export const approvePhysicalReturnInputSchema = z.object({
  clientMutationId: z.string().min(1),
  returnId: z.string().min(1).optional(),
  originalOrderId: z.string().min(1),
  shiftId: z.string().min(1).optional(),
  authorizedByUserId: z.string().min(1).optional(),
  items: z.array(posReturnItemInputSchema).min(1),
  nowEpochMs: z.number().int().safe().nonnegative().optional(),
});

export type ApprovePhysicalReturnInput = z.input<
  typeof approvePhysicalReturnInputSchema
>;

export interface ApprovedReturnItemResult {
  productId: string;
  variantId: string;
  lotId: string;
  lotCode: string;
  binCode: string;
  disposition: 'RESTOCK' | 'QUARANTINE' | 'SCRAP';
  quarantineStatus: 'RELEASED' | 'QUARANTINE' | 'REJECTED';
  qty: number;
  unitCostMinor: number;
  onHandQty: number;
  availableQty: number;
}

export interface ApprovePhysicalReturnResult {
  ok: true;
  clientMutationId: string;
  returnId: string;
  originalOrderId: string;
  shiftId: string | null;
  items: ApprovedReturnItemResult[];
  outboxSeqId: number;
  approvedAtMs: number;
}

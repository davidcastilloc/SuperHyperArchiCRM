import { z } from 'zod';

export const receiveLotInputSchema = z.object({
  clientMutationId: z.string().min(1),
  lotId: z.string().min(1).optional(),
  lotCode: z.string().min(1).optional(),
  productId: z.string().min(1),
  variantId: z.string().min(1).default('default'),
  binCode: z.string().min(1).default('MAIN'),
  qty: z.number().int().positive(),
  unitCostMinor: z.number().int().nonnegative().default(0),
  serialNumber: z.string().min(1).nullable().optional(),
  manufactureEpochMs: z.number().int().nonnegative().nullable().optional(),
  expiryEpochMs: z.number().int().nonnegative().nullable().optional(),
  quarantineStatus: z
    .enum(['RELEASED', 'QUARANTINE', 'HOLD', 'REJECTED'])
    .default('RELEASED'),
  receivedAt: z.number().int().nonnegative().optional(),
});

export type ReceiveLotInput = z.input<typeof receiveLotInputSchema>;

export interface ReceiveLotResult {
  ok: true;
  clientMutationId: string;
  lotId: string;
  lotCode: string;
  productId: string;
  variantId: string;
  binCode: string;
  qtyReceived: number;
  onHandQty: number;
  availableQty: number;
  unitCostMinor: number;
  quarantineStatus: 'RELEASED' | 'QUARANTINE' | 'HOLD' | 'REJECTED';
  expiryEpochMs: number | null;
  receivedAt: number;
  outboxSeqId: number;
}

export const allocateFefoInputSchema = z.object({
  clientMutationId: z.string().min(1),
  productId: z.string().min(1),
  variantId: z.string().min(1).optional(),
  binCode: z.string().min(1).optional(),
  qtyRequested: z.number().int().positive(),
  mode: z.enum(['DEDUCT', 'RESERVE']).default('DEDUCT'),
  orderId: z.string().min(1).optional(),
  nowEpochMs: z.number().int().nonnegative().optional(),
});

export type AllocateFefoInput = z.input<typeof allocateFefoInputSchema>;

export interface FefoAllocationSlice {
  lotId: string;
  lotCode: string;
  variantId: string;
  binCode: string;
  qtyAllocated: number;
  unitCostMinor: number;
  lineCostMinor: number;
  expiryEpochMs: number | null;
}

export interface AllocateFefoResult {
  ok: true;
  clientMutationId: string;
  productId: string;
  qtyAllocated: number;
  mode: 'DEDUCT' | 'RESERVE';
  allocations: FefoAllocationSlice[];
  outboxSeqId: number;
  allocatedAtMs: number;
}

export interface LotBalanceItem {
  productId: string;
  variantId: string;
  binCode: string;
  lotId: string;
  lotCode: string;
  serialNumber: string | null;
  onHandQty: number;
  reservedQty: number;
  availableQty: number;
  unitCostMinor: number;
  quarantineStatus: string;
  manufactureEpochMs: number | null;
  expiryEpochMs: number | null;
  receivedAt: number;
  updatedAt: number;
}

export interface BalancesResult {
  productId: string | null;
  totalOnHandQty: number;
  totalReservedQty: number;
  totalAvailableQty: number;
  lots: LotBalanceItem[];
}

export type JsonScalar = string | number | boolean | null;

type JsonLevel1 = JsonScalar | Record<string, JsonScalar> | JsonScalar[];
type JsonLevel2 = JsonLevel1 | Record<string, JsonLevel1> | JsonLevel1[];

export type JsonValue = JsonLevel2 | Record<string, JsonLevel2> | JsonLevel2[];

export interface OutboxEvent {
  seqId: number;
  eventType: string;
  aggregateId: string;
  payload: Record<string, JsonValue>;
  attempts: number;
  nextAttemptMs: number;
  createdAtMs: number;
}

export const drainOutboxOptionsSchema = z.object({
  limit: z.number().int().positive().max(500).default(100),
  ackSeqIds: z.array(z.number().int().positive()).optional(),
});

export type DrainOutboxOptions = z.input<typeof drainOutboxOptionsSchema>;

export const acquireSpaceLockInputSchema = z.object({
  clientMutationId: z.string().min(1),
  spaceId: z.string().min(1),
  slotBucket: z.string().min(1),
  lockKind: z.enum(['STAY', 'APPOINTMENT', 'AMENITY', 'MAINTENANCE_BLOCK']),
  holderRefId: z.string().min(1),
  partyNameMasked: z.string().min(1),
  checkInMs: z.number().int().nonnegative(),
  checkOutMs: z.number().int().nonnegative(),
  expiresAtMs: z.number().int().nonnegative().nullable().optional(),
  nowEpochMs: z.number().int().nonnegative().optional(),
});

export type AcquireSpaceLockInput = z.input<typeof acquireSpaceLockInputSchema>;

export interface SpaceLockResult {
  ok: true;
  clientMutationId: string;
  spaceId: string;
  slotBucket: string;
  lockKind: 'STAY' | 'APPOINTMENT' | 'AMENITY' | 'MAINTENANCE_BLOCK';
  holderRefId: string;
  partyNameMasked: string;
  status: 'LOCKED' | 'CHECKED_IN' | 'RELEASED' | 'EXPIRED';
  checkInMs: number;
  checkOutMs: number;
  expiresAtMs: number | null;
  outboxSeqId: number;
}

export interface SpaceLockRecord {
  spaceId: string;
  slotBucket: string;
  lockKind: string;
  holderRefId: string;
  partyNameMasked: string;
  status: string;
  checkInMs: number;
  checkOutMs: number;
  expiresAtMs: number | null;
}

export const openPosShiftInputSchema = z.object({
  clientMutationId: z.string().min(1),
  shiftId: z.string().min(1).optional(),
  registerId: z.string().min(1),
  cashierUserId: z.string().min(1),
  cashierName: z.string().min(1),
  initialBalancesMinor: z.record(
    z.string().min(3).max(8),
    z.number().int().nonnegative(),
  ),
  openedAt: z.number().int().nonnegative().optional(),
});

export type OpenPosShiftInput = z.input<typeof openPosShiftInputSchema>;

export interface OpenPosShiftResult {
  ok: true;
  clientMutationId: string;
  shiftId: string;
  registerId: string;
  cashierUserId: string;
  cashierName: string;
  status: 'OPEN';
  initialBalancesMinor: Record<string, number>;
  nextTicketSeq: number;
  openedAt: number;
  outboxSeqId: number;
}

export interface PosShiftRecord {
  shiftId: string;
  registerId: string;
  cashierUserId: string;
  cashierName: string;
  status: string;
  initialBalancesMinor: Record<string, number>;
  salesByCurrencyMinor: Record<string, number>;
  salesByMethodMinor: Record<string, number>;
  nextTicketSeq: number;
  openedAt: number;
  closedAt: number | null;
}

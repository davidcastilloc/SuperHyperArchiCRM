import { AppError } from '@shac/kernel';
import { normalizeGtin } from './catalog-matcher.js';

export const DEFAULT_CONSOLIDATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ReorderTriggerInput {
  availableQty: number;
  reorderPoint: number;
  urgent: boolean;
  consolidateLowStockHours: number;
}

export type ReorderTriggerDecision =
  | { action: 'NONE'; reason: 'ABOVE_REORDER_POINT' }
  | {
      action: 'DISPATCH_IMMEDIATE';
      reason: 'CRITICAL_STOCKOUT_URGENT' | 'CONSOLIDATION_DISABLED';
    }
  | {
      action: 'BUFFER_FOR_CONSOLIDATION';
      reason: 'LOW_STOCK_BUFFERED';
      windowHours: number;
    };

export interface PendingRestockItem {
  supplierDid: string;
  gtin: string;
  requestedQty: number;
  queuedAtMs: number;
  localSku?: string;
  branchId?: string;
}

export interface ConsolidatedRestockBatch {
  supplierDid: string;
  gtin: string;
  totalQty: number;
  itemCount: number;
  earliestQueuedAtMs: number;
  latestQueuedAtMs: number;
  localSkus: string[];
  branchIds: string[];
}

export function evaluateReorderTrigger(
  input: ReorderTriggerInput,
): ReorderTriggerDecision {
  if (!Number.isSafeInteger(input.consolidateLowStockHours) || input.consolidateLowStockHours < 0) {
    throw new AppError(
      'INVALID_REORDER_CONFIG',
      400,
      'consolidateLowStockHours must be a non-negative integer',
    );
  }

  if (input.availableQty > input.reorderPoint) {
    return { action: 'NONE', reason: 'ABOVE_REORDER_POINT' };
  }

  if (input.availableQty <= 0 && input.urgent) {
    return {
      action: 'DISPATCH_IMMEDIATE',
      reason: 'CRITICAL_STOCKOUT_URGENT',
    };
  }

  if (input.consolidateLowStockHours === 0) {
    return {
      action: 'DISPATCH_IMMEDIATE',
      reason: 'CONSOLIDATION_DISABLED',
    };
  }

  return {
    action: 'BUFFER_FOR_CONSOLIDATION',
    reason: 'LOW_STOCK_BUFFERED',
    windowHours: input.consolidateLowStockHours,
  };
}

/**
 * Consolidates pending restock items by (supplierDid, normalizedGtin) within a 24h window.
 */
export function consolidatePendingRestocks(
  items: readonly PendingRestockItem[],
  windowMs: number = DEFAULT_CONSOLIDATION_WINDOW_MS,
): ConsolidatedRestockBatch[] {
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
    throw new AppError(
      'INVALID_CONSOLIDATION_WINDOW',
      400,
      'Consolidation windowMs must be a positive integer',
    );
  }

  const sorted = [...items].sort((a, b) => a.queuedAtMs - b.queuedAtMs);
  const buckets = new Map<string, ConsolidatedRestockBatch[]>();

  for (const item of sorted) {
    if (!Number.isSafeInteger(item.requestedQty) || item.requestedQty <= 0) {
      throw new AppError(
        'INVALID_RESTOCK_QTY',
        400,
        'requestedQty must be a positive safe integer',
      );
    }
    const gtin = normalizeGtin(item.gtin);
    const key = `${item.supplierDid}::${gtin}`;
    const groupBatches = buckets.get(key) ?? [];
    const current = groupBatches[groupBatches.length - 1];

    if (current && item.queuedAtMs - current.earliestQueuedAtMs < windowMs) {
      current.totalQty += item.requestedQty;
      current.itemCount += 1;
      current.latestQueuedAtMs = item.queuedAtMs;
      if (item.localSku && !current.localSkus.includes(item.localSku)) {
        current.localSkus.push(item.localSku);
      }
      if (item.branchId && !current.branchIds.includes(item.branchId)) {
        current.branchIds.push(item.branchId);
      }
    } else {
      groupBatches.push({
        supplierDid: item.supplierDid,
        gtin,
        totalQty: item.requestedQty,
        itemCount: 1,
        earliestQueuedAtMs: item.queuedAtMs,
        latestQueuedAtMs: item.queuedAtMs,
        localSkus: item.localSku ? [item.localSku] : [],
        branchIds: item.branchId ? [item.branchId] : [],
      });
      buckets.set(key, groupBatches);
    }
  }

  const result: ConsolidatedRestockBatch[] = [];
  for (const group of buckets.values()) {
    result.push(...group);
  }
  return result;
}

export type FederatedSettlementState =
  | 'ENVELOPE_QUEUED'
  | 'HUB_ACCEPTED'
  | 'COUNTERPARTY_ACKED'
  | 'COUNTERPARTY_REJECTED';

export interface FederatedDeliveryReceipt {
  readonly envelopeId: string;
  readonly senderOrgId: string;
  readonly recipientOrgId: string;
  readonly state: FederatedSettlementState;
  readonly ackedAtMs: number;
  readonly payloadSha256Hex: string;
  readonly counterpartySignatureHex: string;
}

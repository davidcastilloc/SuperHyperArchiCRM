import { AppError } from '@shac/kernel';
import {
  allocateFefoInputSchema,
  type AllocateFefoInput,
  type AllocateFefoResult,
  type FefoAllocationSlice,
} from './contracts.js';
import {
  checkIdempotencySync,
  hashCommandPayload,
  insertOutboxEventSync,
  parseInput,
  recordIdempotencySync,
} from './idempotency.js';

const NO_EXPIRY_SORT_SENTINEL = 9007199254740991;

type CandidateLotRow = {
  product_id: string;
  variant_id: string;
  bin_code: string;
  lot_id: string;
  lot_code: string;
  available_qty: number;
  unit_cost_minor: number;
  expiry_epoch_ms: number | null;
};

/**
 * Allocates stock strictly by FEFO across released, non-expired lots in a tx.
 */
export function allocateFefoInTx(
  sql: SqlStorage,
  rawInput: AllocateFefoInput,
): AllocateFefoResult {
  const input = parseInput(allocateFefoInputSchema, rawInput);
  const commandId = 'branch.inventory.allocate_fefo';
  const requestHash = hashCommandPayload(commandId, {
    productId: input.productId,
    variantId: input.variantId ?? null,
    binCode: input.binCode ?? null,
    qtyRequested: input.qtyRequested,
    mode: input.mode,
    orderId: input.orderId ?? null,
  });

  const replay = checkIdempotencySync<AllocateFefoResult>(
    sql,
    input.clientMutationId,
    commandId,
    requestHash,
  );
  if (replay) return replay;

  const nowMs = input.nowEpochMs ?? Date.now();
  const variantFilter = input.variantId ?? null;
  const binFilter = input.binCode ?? null;

  const candidates = sql
    .exec<CandidateLotRow>(
      `SELECT
         b.product_id, b.variant_id, b.bin_code, b.lot_id,
         l.lot_code, b.available_qty, b.unit_cost_minor, l.expiry_epoch_ms
       FROM hot_bin_balances b
       INNER JOIN hot_inventory_lots l ON l.lot_id = b.lot_id
       WHERE b.product_id = ?
         AND (? IS NULL OR b.variant_id = ?)
         AND (? IS NULL OR b.bin_code = ?)
         AND b.available_qty > 0
         AND l.quarantine_status = 'RELEASED'
         AND (l.expiry_epoch_ms IS NULL OR l.expiry_epoch_ms > ?)
       ORDER BY
         COALESCE(l.expiry_epoch_ms, ${NO_EXPIRY_SORT_SENTINEL}) ASC,
         l.received_at ASC,
         l.lot_id ASC,
         b.bin_code ASC`,
      input.productId,
      variantFilter,
      variantFilter,
      binFilter,
      binFilter,
      nowMs,
    )
    .toArray();

  const totalAvailable = candidates.reduce((sum, r) => sum + r.available_qty, 0);
  if (totalAvailable < input.qtyRequested) {
    throw new AppError(
      'INSUFFICIENT_STOCK',
      409,
      `INSUFFICIENT_STOCK: requested ${input.qtyRequested} for ${input.productId}, available ${totalAvailable}`,
      {
        productId: input.productId,
        variantId: variantFilter,
        binCode: binFilter,
        qtyRequested: input.qtyRequested,
        totalAvailable,
      },
    );
  }

  const allocations: FefoAllocationSlice[] = [];
  let remaining = input.qtyRequested;

  for (const row of candidates) {
    if (remaining === 0) break;
    const take = Math.min(remaining, row.available_qty);
    const updated =
      input.mode === 'RESERVE'
        ? sql
            .exec<{ lot_id: string }>(
              `UPDATE hot_bin_balances
               SET reserved_qty = reserved_qty + ?,
                   available_qty = available_qty - ?,
                   updated_at = ?
               WHERE product_id = ? AND variant_id = ? AND bin_code = ? AND lot_id = ?
                 AND available_qty >= ?
               RETURNING lot_id`,
              take,
              take,
              nowMs,
              row.product_id,
              row.variant_id,
              row.bin_code,
              row.lot_id,
              take,
            )
            .toArray()
        : sql
            .exec<{ lot_id: string }>(
              `UPDATE hot_bin_balances
               SET on_hand_qty = on_hand_qty - ?,
                   available_qty = available_qty - ?,
                   updated_at = ?
               WHERE product_id = ? AND variant_id = ? AND bin_code = ? AND lot_id = ?
                 AND on_hand_qty >= ? AND available_qty >= ?
               RETURNING lot_id`,
              take,
              take,
              nowMs,
              row.product_id,
              row.variant_id,
              row.bin_code,
              row.lot_id,
              take,
              take,
            )
            .toArray();

    if (updated.length !== 1) {
      throw new AppError('CONCURRENT_MODIFICATION', 409, 'Balance update guard failed');
    }

    allocations.push({
      lotId: row.lot_id,
      lotCode: row.lot_code,
      variantId: row.variant_id,
      binCode: row.bin_code,
      qtyAllocated: take,
      unitCostMinor: row.unit_cost_minor,
      lineCostMinor: take * row.unit_cost_minor,
      expiryEpochMs: row.expiry_epoch_ms,
    });
    remaining -= take;
  }

  const outboxSeqId = insertOutboxEventSync(sql, {
    eventType: 'STOCK_ALLOCATED_FEFO',
    aggregateId: input.orderId ?? input.productId,
    payload: {
      clientMutationId: input.clientMutationId,
      orderId: input.orderId ?? null,
      productId: input.productId,
      qtyAllocated: input.qtyRequested,
      mode: input.mode,
      allocations,
    },
    nowMs,
  });

  const result: AllocateFefoResult = {
    ok: true,
    clientMutationId: input.clientMutationId,
    productId: input.productId,
    qtyAllocated: input.qtyRequested,
    mode: input.mode,
    allocations,
    outboxSeqId,
    allocatedAtMs: nowMs,
  };

  recordIdempotencySync(sql, {
    clientMutationId: input.clientMutationId,
    commandId,
    requestHash,
    responseStatus: 200,
    responseJson: JSON.stringify(result),
    nowMs,
  });

  return result;
}

import { AppError } from '@shac/kernel';
import {
  receiveLotInputSchema,
  type BalancesResult,
  type LotBalanceItem,
  type ReceiveLotInput,
  type ReceiveLotResult,
} from './contracts.js';
import {
  checkIdempotencySync,
  hashCommandPayload,
  insertOutboxEventSync,
  parseInput,
  recordIdempotencySync,
} from './idempotency.js';

const NO_EXPIRY_SORT_SENTINEL = 9007199254740991;

type BalanceJoinRow = {
  product_id: string;
  variant_id: string;
  bin_code: string;
  lot_id: string;
  lot_code: string;
  serial_number: string | null;
  on_hand_qty: number;
  reserved_qty: number;
  available_qty: number;
  unit_cost_minor: number;
  quarantine_status: string;
  manufacture_epoch_ms: number | null;
  expiry_epoch_ms: number | null;
  received_at: number;
  updated_at: number;
};

/**
 * Receives inventory into a lot and bin with idempotency and outbox emission.
 */
export function receiveLotInTx(
  sql: SqlStorage,
  rawInput: ReceiveLotInput,
): ReceiveLotResult {
  const input = parseInput(receiveLotInputSchema, rawInput);
  const commandId = 'branch.inventory.receive_lot';
  const requestHash = hashCommandPayload(commandId, {
    lotId: input.lotId ?? null,
    lotCode: input.lotCode ?? null,
    productId: input.productId,
    variantId: input.variantId,
    binCode: input.binCode,
    qty: input.qty,
    unitCostMinor: input.unitCostMinor,
    serialNumber: input.serialNumber ?? null,
    manufactureEpochMs: input.manufactureEpochMs ?? null,
    expiryEpochMs: input.expiryEpochMs ?? null,
    quarantineStatus: input.quarantineStatus,
  });

  const replay = checkIdempotencySync<ReceiveLotResult>(
    sql,
    input.clientMutationId,
    commandId,
    requestHash,
  );
  if (replay) return replay;

  const nowMs = input.receivedAt ?? Date.now();
  const lotId = input.lotId ?? crypto.randomUUID();
  const lotCode = input.lotCode ?? lotId;
  const expiryEpochMs = input.expiryEpochMs ?? null;

  const existingLot = sql
    .exec<{ product_id: string; variant_id: string; received_at: number }>(
      `SELECT product_id, variant_id, received_at
       FROM hot_inventory_lots
       WHERE lot_id = ?
       LIMIT 1`,
      lotId,
    )
    .toArray()[0];

  if (existingLot) {
    if (
      existingLot.product_id !== input.productId ||
      existingLot.variant_id !== input.variantId
    ) {
      throw new AppError(
        'LOT_CONFLICT',
        409,
        `lotId ${lotId} already belongs to a different product or variant`,
      );
    }
  } else {
    sql.exec(
      `INSERT INTO hot_inventory_lots (
         lot_id, product_id, variant_id, lot_code, serial_number,
         manufacture_epoch_ms, expiry_epoch_ms, quarantine_status, received_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      lotId,
      input.productId,
      input.variantId,
      lotCode,
      input.serialNumber ?? null,
      input.manufactureEpochMs ?? null,
      expiryEpochMs,
      input.quarantineStatus,
      nowMs,
    );
  }

  const balanceRow = sql
    .exec<{ on_hand_qty: number; available_qty: number; unit_cost_minor: number }>(
      `INSERT INTO hot_bin_balances (
         product_id, variant_id, bin_code, lot_id,
         on_hand_qty, reserved_qty, available_qty, unit_cost_minor, updated_at
       ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
       ON CONFLICT (product_id, variant_id, bin_code, lot_id) DO UPDATE SET
         unit_cost_minor = CASE
           WHEN (hot_bin_balances.on_hand_qty + excluded.on_hand_qty) > 0
           THEN ((hot_bin_balances.on_hand_qty * hot_bin_balances.unit_cost_minor)
                 + (excluded.on_hand_qty * excluded.unit_cost_minor))
                / (hot_bin_balances.on_hand_qty + excluded.on_hand_qty)
           ELSE excluded.unit_cost_minor
         END,
         on_hand_qty = hot_bin_balances.on_hand_qty + excluded.on_hand_qty,
         available_qty = hot_bin_balances.available_qty + excluded.available_qty,
         updated_at = excluded.updated_at
       RETURNING on_hand_qty, available_qty, unit_cost_minor`,
      input.productId,
      input.variantId,
      input.binCode,
      lotId,
      input.qty,
      input.qty,
      input.unitCostMinor,
      nowMs,
    )
    .one();

  const receivedAt = existingLot?.received_at ?? nowMs;
  const outboxSeqId = insertOutboxEventSync(sql, {
    eventType: 'LOT_RECEIVED',
    aggregateId: lotId,
    payload: {
      clientMutationId: input.clientMutationId,
      lotId,
      lotCode,
      productId: input.productId,
      variantId: input.variantId,
      binCode: input.binCode,
      qtyReceived: input.qty,
      unitCostMinor: balanceRow.unit_cost_minor,
      quarantineStatus: input.quarantineStatus,
      expiryEpochMs,
    },
    nowMs,
  });

  const result: ReceiveLotResult = {
    ok: true,
    clientMutationId: input.clientMutationId,
    lotId,
    lotCode,
    productId: input.productId,
    variantId: input.variantId,
    binCode: input.binCode,
    qtyReceived: input.qty,
    onHandQty: balanceRow.on_hand_qty,
    availableQty: balanceRow.available_qty,
    unitCostMinor: balanceRow.unit_cost_minor,
    quarantineStatus: input.quarantineStatus,
    expiryEpochMs,
    receivedAt,
    outboxSeqId,
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

/**
 * Reads hot bin & lot balances ordered by FEFO for a product (or all products).
 */
export function getBalancesInTx(
  sql: SqlStorage,
  productId?: string,
  variantId?: string,
): BalancesResult {
  const productFilter = productId ?? null;
  const variantFilter = variantId ?? null;
  const rows = sql
    .exec<BalanceJoinRow>(
      `SELECT
         b.product_id, b.variant_id, b.bin_code, b.lot_id,
         b.on_hand_qty, b.reserved_qty, b.available_qty, b.unit_cost_minor, b.updated_at,
         l.lot_code, l.serial_number, l.quarantine_status,
         l.manufacture_epoch_ms, l.expiry_epoch_ms, l.received_at
       FROM hot_bin_balances b
       INNER JOIN hot_inventory_lots l ON l.lot_id = b.lot_id
       WHERE (? IS NULL OR b.product_id = ?)
         AND (? IS NULL OR b.variant_id = ?)
       ORDER BY
         b.product_id ASC,
         COALESCE(l.expiry_epoch_ms, ${NO_EXPIRY_SORT_SENTINEL}) ASC,
         l.received_at ASC,
         l.lot_id ASC,
         b.bin_code ASC`,
      productFilter,
      productFilter,
      variantFilter,
      variantFilter,
    )
    .toArray();

  let totalOnHandQty = 0;
  let totalReservedQty = 0;
  let totalAvailableQty = 0;
  const lots: LotBalanceItem[] = rows.map((row) => {
    totalOnHandQty += row.on_hand_qty;
    totalReservedQty += row.reserved_qty;
    totalAvailableQty += row.available_qty;
    return {
      productId: row.product_id,
      variantId: row.variant_id,
      binCode: row.bin_code,
      lotId: row.lot_id,
      lotCode: row.lot_code,
      serialNumber: row.serial_number,
      onHandQty: row.on_hand_qty,
      reservedQty: row.reserved_qty,
      availableQty: row.available_qty,
      unitCostMinor: row.unit_cost_minor,
      quarantineStatus: row.quarantine_status,
      manufactureEpochMs: row.manufacture_epoch_ms,
      expiryEpochMs: row.expiry_epoch_ms,
      receivedAt: row.received_at,
      updatedAt: row.updated_at,
    };
  });

  return { productId: productFilter, totalOnHandQty, totalReservedQty, totalAvailableQty, lots };
}

import { AppError } from '@shac/kernel';
import {
  checkIdempotencySync,
  hashCommandPayload,
  insertOutboxEventSync,
  parseInput,
  recordIdempotencySync,
} from './idempotency.js';
import {
  approvePhysicalReturnInputSchema,
  type ApprovedReturnItemResult,
  type ApprovePhysicalReturnInput,
  type ApprovePhysicalReturnResult,
  type PosReturnItemInput,
} from './pos-contracts.js';

const DISPOSITION_TARGETS = {
  RESTOCK: {
    defaultBin: 'MAIN',
    quarantineStatus: 'RELEASED',
    sellable: true,
  },
  QUARANTINE: {
    defaultBin: 'QUARANTINE',
    quarantineStatus: 'QUARANTINE',
    sellable: false,
  },
  SCRAP: {
    defaultBin: 'SCRAP',
    quarantineStatus: 'REJECTED',
    sellable: false,
  },
} as const;

type LotLookupRow = {
  product_id: string;
  variant_id: string;
  lot_code: string;
  quarantine_status: string;
};

function findLotRow(sql: SqlStorage, lotId: string): LotLookupRow | undefined {
  return sql
    .exec<LotLookupRow>(
      `SELECT product_id, variant_id, lot_code, quarantine_status
       FROM hot_inventory_lots WHERE lot_id = ? LIMIT 1`,
      lotId,
    )
    .toArray()[0];
}

function resolveOrCreateReturnLot(
  sql: SqlStorage,
  params: {
    returnId: string;
    index: number;
    item: PosReturnItemInput;
    quarantineStatus: 'RELEASED' | 'QUARANTINE' | 'REJECTED';
    nowMs: number;
  },
): { lotId: string; lotCode: string } {
  const { item, quarantineStatus, nowMs, returnId, index } = params;
  const baseId = item.lotId ?? `${returnId}:${index}:${item.disposition}`;
  let targetLotId = baseId;
  let targetLotCode = item.lotCode ?? targetLotId;

  const existing = findLotRow(sql, targetLotId);
  if (existing) {
    if (
      existing.product_id !== item.productId ||
      existing.variant_id !== item.variantId
    ) {
      throw new AppError(
        'LOT_CONFLICT',
        409,
        `lotId ${targetLotId} already belongs to a different product or variant`,
      );
    }
    targetLotCode = item.lotCode ?? existing.lot_code;
    if (existing.quarantine_status === quarantineStatus) {
      return { lotId: targetLotId, lotCode: targetLotCode };
    }
    // Isolate under a disposition suffix so sellable lots stay RELEASED.
    targetLotId = `${targetLotId}:${item.disposition}`;
  }

  const derived =
    targetLotId !== baseId ? findLotRow(sql, targetLotId) : undefined;
  if (!derived) {
    sql.exec(
      `INSERT INTO hot_inventory_lots (
         lot_id, product_id, variant_id, lot_code, serial_number,
         manufacture_epoch_ms, expiry_epoch_ms, quarantine_status, received_at
       ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
      targetLotId,
      item.productId,
      item.variantId,
      targetLotCode,
      item.expiryEpochMs ?? null,
      quarantineStatus,
      nowMs,
    );
  }
  return { lotId: targetLotId, lotCode: targetLotCode };
}

/**
 * Approves physical return items into RESTOCK (RELEASED), QUARANTINE, or SCRAP (REJECTED)
 * bins inside a DO SQLite transaction with idempotency and outbox emission.
 */
export function approvePhysicalReturnInTx(
  sql: SqlStorage,
  rawInput: ApprovePhysicalReturnInput,
): ApprovePhysicalReturnResult {
  const input = parseInput(approvePhysicalReturnInputSchema, rawInput);
  const commandId = 'branch.pos.approve_return';
  const requestHash = hashCommandPayload(commandId, {
    returnId: input.returnId ?? null,
    originalOrderId: input.originalOrderId,
    shiftId: input.shiftId ?? null,
    authorizedByUserId: input.authorizedByUserId ?? null,
    items: input.items,
  });

  const replay = checkIdempotencySync<ApprovePhysicalReturnResult>(
    sql,
    input.clientMutationId,
    commandId,
    requestHash,
  );
  if (replay) return replay;

  const nowMs = input.nowEpochMs ?? Date.now();
  const returnId = input.returnId ?? crypto.randomUUID();
  const approvedItems: ApprovedReturnItemResult[] = [];

  for (let idx = 0; idx < input.items.length; idx++) {
    const item = input.items[idx]!;
    const target = DISPOSITION_TARGETS[item.disposition];
    const binCode = item.binCode ?? target.defaultBin;
    const { lotId, lotCode } = resolveOrCreateReturnLot(sql, {
      returnId,
      index: idx,
      item,
      quarantineStatus: target.quarantineStatus,
      nowMs,
    });

    const existingBal = sql
      .exec<{ on_hand_qty: number; available_qty: number; unit_cost_minor: number }>(
        `SELECT on_hand_qty, available_qty, unit_cost_minor
         FROM hot_bin_balances
         WHERE product_id = ? AND variant_id = ? AND bin_code = ? AND lot_id = ?
         LIMIT 1`,
        item.productId,
        item.variantId,
        binCode,
        lotId,
      )
      .toArray()[0];

    const prevOnHand = existingBal?.on_hand_qty ?? 0;
    const prevAvailable = existingBal?.available_qty ?? 0;
    const prevCost = existingBal?.unit_cost_minor ?? 0;
    const nextOnHand = prevOnHand + item.qty;
    const nextAvailable = target.sellable
      ? prevAvailable + item.qty
      : prevAvailable;

    let nextCost = prevCost;
    if (item.unitCostMinor !== undefined) {
      const totalVal =
        BigInt(prevOnHand) * BigInt(prevCost) +
        BigInt(item.qty) * BigInt(item.unitCostMinor);
      const avgCost = Number(totalVal / BigInt(nextOnHand));
      if (!Number.isSafeInteger(avgCost)) {
        throw new AppError('INTEGER_OVERFLOW', 400, 'unitCostMinor overflow');
      }
      nextCost = avgCost;
    }

    sql.exec(
      `INSERT INTO hot_bin_balances (
         product_id, variant_id, bin_code, lot_id,
         on_hand_qty, reserved_qty, available_qty, unit_cost_minor, updated_at
       ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
       ON CONFLICT (product_id, variant_id, bin_code, lot_id) DO UPDATE SET
         on_hand_qty = excluded.on_hand_qty,
         available_qty = excluded.available_qty,
         unit_cost_minor = excluded.unit_cost_minor,
         updated_at = excluded.updated_at`,
      item.productId,
      item.variantId,
      binCode,
      lotId,
      nextOnHand,
      nextAvailable,
      nextCost,
      nowMs,
    );

    approvedItems.push({
      productId: item.productId,
      variantId: item.variantId,
      lotId,
      lotCode,
      binCode,
      disposition: item.disposition,
      quarantineStatus: target.quarantineStatus,
      qty: item.qty,
      unitCostMinor: nextCost,
      onHandQty: nextOnHand,
      availableQty: nextAvailable,
    });
  }

  const outboxSeqId = insertOutboxEventSync(sql, {
    eventType: 'POS_RETURN_PHYSICAL_APPROVED',
    aggregateId: returnId,
    payload: {
      clientMutationId: input.clientMutationId,
      returnId,
      originalOrderId: input.originalOrderId,
      shiftId: input.shiftId ?? null,
      authorizedByUserId: input.authorizedByUserId ?? null,
      items: approvedItems,
      approvedAtMs: nowMs,
    },
    nowMs,
  });

  const result: ApprovePhysicalReturnResult = {
    ok: true,
    clientMutationId: input.clientMutationId,
    returnId,
    originalOrderId: input.originalOrderId,
    shiftId: input.shiftId ?? null,
    items: approvedItems,
    outboxSeqId,
    approvedAtMs: nowMs,
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

import { AppError } from '@shac/kernel';
import { executeFefoAllocationInTx } from './fefo-allocate.js';
import {
  checkIdempotencySync,
  hashCommandPayload,
  insertOutboxEventSync,
  parseInput,
  recordIdempotencySync,
} from './idempotency.js';
import {
  checkoutPosSaleInputSchema,
  type CheckoutPosSaleInput,
  type CheckoutPosSaleResult,
  type PosSaleLineAllocation,
} from './pos-contracts.js';
import {
  bigIntMapToSafeRecord,
  parseMinorMapBigInt,
  requireOpenPosShiftRow,
} from './pos-shift.js';

function addBigIntEntry(
  map: Map<string, bigint>,
  key: string,
  delta: bigint,
): void {
  map.set(key, (map.get(key) ?? 0n) + delta);
}

/**
 * Executes an atomic multi-currency POS checkout inside a DO SQLite transaction:
 * checks idempotency, enforces open shift + Cuenta=Moneda, deducts FEFO stock,
 * updates shift counters, emits POS_SALE_COMPLETED, and stores the receipt.
 */
export function checkoutPosSaleInTx(
  sql: SqlStorage,
  rawInput: CheckoutPosSaleInput,
): CheckoutPosSaleResult {
  const input = parseInput(checkoutPosSaleInputSchema, rawInput);
  const commandId = 'branch.pos.checkout';
  const requestHash = hashCommandPayload(commandId, {
    shiftId: input.shiftId ?? null,
    registerId: input.registerId ?? null,
    orderId: input.orderId ?? null,
    orderCurrency: input.orderCurrency,
    items: input.items,
    payments: input.payments,
    changeByCurrencyMinor: input.changeByCurrencyMinor ?? null,
  });

  const replay = checkIdempotencySync<CheckoutPosSaleResult>(
    sql,
    input.clientMutationId,
    commandId,
    requestHash,
  );
  if (replay) return replay;

  const shift = requireOpenPosShiftRow(sql, input.shiftId, input.registerId);

  // Enforce Cuenta=Moneda invariant before mutating any inventory or shift state.
  for (const payment of input.payments) {
    if (payment.accountCurrency !== payment.paymentCurrency) {
      throw new AppError(
        'ERR_CURRENCY_ACCOUNT_MISMATCH',
        422,
        `ERR_CURRENCY_ACCOUNT_MISMATCH: account currency ${payment.accountCurrency} does not match payment currency ${payment.paymentCurrency}`,
        {
          financialAccountId: payment.financialAccountId,
          accountCurrency: payment.accountCurrency,
          paymentCurrency: payment.paymentCurrency,
          methodCode: payment.methodCode,
        },
      );
    }
  }

  const nowMs = input.nowEpochMs ?? Date.now();
  const allocatedItems: PosSaleLineAllocation[] = [];
  for (const item of input.items) {
    const allocations = item.trackInventory
      ? executeFefoAllocationInTx(sql, {
          productId: item.productId,
          variantId: item.variantId,
          binCode: item.binCode,
          qtyRequested: item.qty,
          mode: 'DEDUCT',
          nowMs,
        })
      : [];
    allocatedItems.push({
      productId: item.productId,
      variantId: item.variantId,
      sku: item.sku ?? null,
      qty: item.qty,
      allocations,
    });
  }

  const salesByCurrencyMap = parseMinorMapBigInt(shift.sales_by_currency_json);
  const salesByMethodMap = parseMinorMapBigInt(shift.sales_by_method_json);

  for (const payment of input.payments) {
    const amount = BigInt(payment.amountMinor);
    addBigIntEntry(salesByCurrencyMap, payment.paymentCurrency, amount);
    addBigIntEntry(
      salesByMethodMap,
      `${payment.paymentCurrency}:${payment.methodCode}`,
      amount,
    );
  }

  if (input.changeByCurrencyMinor) {
    for (const [currency, changeMinor] of Object.entries(
      input.changeByCurrencyMinor,
    )) {
      addBigIntEntry(salesByCurrencyMap, currency, -BigInt(changeMinor));
    }
  }

  const salesByCurrencyMinor = bigIntMapToSafeRecord(salesByCurrencyMap);
  const salesByMethodMinor = bigIntMapToSafeRecord(salesByMethodMap);
  const ticketSeq = shift.next_ticket_seq;

  const updatedShift = sql
    .exec<{ next_ticket_seq: number }>(
      `UPDATE hot_pos_shifts
       SET next_ticket_seq = next_ticket_seq + 1,
           sales_by_currency_json = ?,
           sales_by_method_json = ?
       WHERE shift_id = ? AND status = 'OPEN'
       RETURNING next_ticket_seq`,
      JSON.stringify(salesByCurrencyMinor),
      JSON.stringify(salesByMethodMinor),
      shift.shift_id,
    )
    .toArray();

  if (updatedShift.length !== 1) {
    throw new AppError(
      'SHIFT_NOT_OPEN',
      409,
      'SHIFT_NOT_OPEN: shift closed concurrently during checkout',
    );
  }

  const orderId = input.orderId ?? crypto.randomUUID();
  const nextTicketSeq = updatedShift[0]!.next_ticket_seq;

  const outboxSeqId = insertOutboxEventSync(sql, {
    eventType: 'POS_SALE_COMPLETED',
    aggregateId: orderId,
    payload: {
      clientMutationId: input.clientMutationId,
      shiftId: shift.shift_id,
      registerId: shift.register_id,
      orderId,
      ticketSeq,
      orderCurrency: input.orderCurrency,
      items: allocatedItems,
      payments: input.payments,
      salesByCurrencyMinor,
      salesByMethodMinor,
      checkedOutAtMs: nowMs,
    },
    nowMs,
  });

  const result: CheckoutPosSaleResult = {
    ok: true,
    clientMutationId: input.clientMutationId,
    shiftId: shift.shift_id,
    registerId: shift.register_id,
    orderId,
    ticketSeq,
    nextTicketSeq,
    orderCurrency: input.orderCurrency,
    items: allocatedItems,
    payments: input.payments,
    salesByCurrencyMinor,
    salesByMethodMinor,
    outboxSeqId,
    checkedOutAtMs: nowMs,
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

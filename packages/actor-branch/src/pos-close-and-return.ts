import { AppError } from '@shac/kernel';
import {
  checkIdempotencySync,
  hashCommandPayload,
  insertOutboxEventSync,
  parseInput,
  recordIdempotencySync,
} from './idempotency.js';
import {
  closePosShiftInputSchema,
  type ClosePosShiftInput,
  type ClosePosShiftResult,
} from './pos-contracts.js';
import {
  bigIntMapToSafeRecord,
  parseMinorMapBigInt,
  requireOpenPosShiftRow,
} from './pos-shift.js';

export { approvePhysicalReturnInTx } from './pos-return.js';

function parsePettyExpensesBigInt(rawJson: string): Map<string, bigint> {
  const parsed = JSON.parse(rawJson) as unknown;
  const map = new Map<string, bigint>();
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === 'object' &&
        'currency' in entry &&
        'amountMinor' in entry &&
        typeof entry.currency === 'string' &&
        typeof entry.amountMinor === 'number' &&
        Number.isSafeInteger(entry.amountMinor)
      ) {
        const ccy = entry.currency.trim().toUpperCase();
        map.set(ccy, (map.get(ccy) ?? 0n) + BigInt(entry.amountMinor));
      }
    }
    return map;
  }
  if (parsed && typeof parsed === 'object') {
    return parseMinorMapBigInt(rawJson);
  }
  return map;
}

/**
 * Closes an OPEN POS shift, reconciles expected vs counted balances per currency in BigInt,
 * and emits POS_SHIFT_CLOSED into hot_outbox.
 */
export function closePosShiftInTx(
  sql: SqlStorage,
  rawInput: ClosePosShiftInput,
): ClosePosShiftResult {
  const input = parseInput(closePosShiftInputSchema, rawInput);
  const commandId = 'branch.pos.close_shift';
  const requestHash = hashCommandPayload(commandId, {
    shiftId: input.shiftId ?? null,
    registerId: input.registerId ?? null,
    actualCountedBalancesMinor: input.actualCountedBalancesMinor,
    closedByUserId: input.closedByUserId ?? null,
    observations: input.observations ?? null,
  });

  const replay = checkIdempotencySync<ClosePosShiftResult>(
    sql,
    input.clientMutationId,
    commandId,
    requestHash,
  );
  if (replay) return replay;

  const shift = requireOpenPosShiftRow(sql, input.shiftId, input.registerId);
  const initialMap = parseMinorMapBigInt(shift.initial_balances_json);
  const salesMap = parseMinorMapBigInt(shift.sales_by_currency_json);
  const methodMap = parseMinorMapBigInt(shift.sales_by_method_json);
  const expensesMap = parsePettyExpensesBigInt(shift.petty_expenses_json);

  const currencies = new Set<string>([
    ...initialMap.keys(),
    ...salesMap.keys(),
    ...expensesMap.keys(),
    ...Object.keys(input.actualCountedBalancesMinor),
  ]);

  const expectedMap = new Map<string, bigint>();
  const actualMap = new Map<string, bigint>();
  const discrepancyMap = new Map<string, bigint>();

  for (const ccy of [...currencies].sort()) {
    const expected =
      (initialMap.get(ccy) ?? 0n) +
      (salesMap.get(ccy) ?? 0n) -
      (expensesMap.get(ccy) ?? 0n);
    const actual = BigInt(input.actualCountedBalancesMinor[ccy] ?? 0);
    expectedMap.set(ccy, expected);
    actualMap.set(ccy, actual);
    discrepancyMap.set(ccy, actual - expected);
  }

  const closedAt = input.closedAt ?? Date.now();
  const durationMs =
    closedAt > shift.opened_at ? BigInt(closedAt - shift.opened_at) : 0n;
  const shiftDurationSec = Number(durationMs / 1000n);
  const totalTickets = Math.max(0, shift.next_ticket_seq - 1);

  const updated = sql
    .exec<{ shift_id: string }>(
      `UPDATE hot_pos_shifts
       SET status = 'CLOSED', closed_at = ?
       WHERE shift_id = ? AND status = 'OPEN'
       RETURNING shift_id`,
      closedAt,
      shift.shift_id,
    )
    .toArray();

  if (updated.length !== 1) {
    throw new AppError('SHIFT_NOT_OPEN', 409, 'SHIFT_NOT_OPEN: shift already closed');
  }

  const initialBalancesMinor = bigIntMapToSafeRecord(initialMap);
  const salesByCurrencyMinor = bigIntMapToSafeRecord(salesMap);
  const salesByMethodMinor = bigIntMapToSafeRecord(methodMap);
  const expensesByCurrencyMinor = bigIntMapToSafeRecord(expensesMap);
  const expectedBalancesMinor = bigIntMapToSafeRecord(expectedMap);
  const actualCountedBalancesMinor = bigIntMapToSafeRecord(actualMap);
  const discrepancyBalancesMinor = bigIntMapToSafeRecord(discrepancyMap);

  const outboxSeqId = insertOutboxEventSync(sql, {
    eventType: 'POS_SHIFT_CLOSED',
    aggregateId: shift.shift_id,
    payload: {
      clientMutationId: input.clientMutationId,
      shiftId: shift.shift_id,
      registerId: shift.register_id,
      cashierUserId: shift.cashier_user_id,
      closedByUserId: input.closedByUserId ?? shift.cashier_user_id,
      totalTickets,
      shiftDurationSec,
      initialBalancesMinor,
      salesByCurrencyMinor,
      salesByMethodMinor,
      expensesByCurrencyMinor,
      expectedBalancesMinor,
      actualCountedBalancesMinor,
      discrepancyBalancesMinor,
      observations: input.observations ?? null,
      closedAt,
    },
    nowMs: closedAt,
  });

  const result: ClosePosShiftResult = {
    ok: true,
    clientMutationId: input.clientMutationId,
    shiftId: shift.shift_id,
    registerId: shift.register_id,
    cashierUserId: shift.cashier_user_id,
    cashierName: shift.cashier_name,
    status: 'CLOSED',
    openedAt: shift.opened_at,
    closedAt,
    shiftDurationSec,
    totalTickets,
    nextTicketSeq: shift.next_ticket_seq,
    initialBalancesMinor,
    salesByCurrencyMinor,
    salesByMethodMinor,
    expensesByCurrencyMinor,
    expectedBalancesMinor,
    actualCountedBalancesMinor,
    discrepancyBalancesMinor,
    outboxSeqId,
  };

  recordIdempotencySync(sql, {
    clientMutationId: input.clientMutationId,
    commandId,
    requestHash,
    responseStatus: 200,
    responseJson: JSON.stringify(result),
    nowMs: closedAt,
  });

  return result;
}

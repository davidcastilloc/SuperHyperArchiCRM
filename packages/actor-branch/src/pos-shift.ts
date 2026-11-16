import { AppError } from '@shac/kernel';
import {
  openPosShiftInputSchema,
  type OpenPosShiftInput,
  type OpenPosShiftResult,
  type PosShiftRecord,
} from './contracts.js';
import {
  checkIdempotencySync,
  hashCommandPayload,
  insertOutboxEventSync,
  parseInput,
  recordIdempotencySync,
} from './idempotency.js';

type PosShiftRow = {
  shift_id: string;
  register_id: string;
  cashier_user_id: string;
  cashier_name: string;
  status: string;
  initial_balances_json: string;
  next_ticket_seq: number;
  opened_at: number;
  closed_at: number | null;
};

/**
 * Opens an exclusive POS register shift with integer multi-currency floats.
 */
export function openPosShiftInTx(
  sql: SqlStorage,
  rawInput: OpenPosShiftInput,
): OpenPosShiftResult {
  const input = parseInput(openPosShiftInputSchema, rawInput);
  const commandId = 'branch.pos.open_shift';
  const requestHash = hashCommandPayload(commandId, {
    shiftId: input.shiftId ?? null,
    registerId: input.registerId,
    cashierUserId: input.cashierUserId,
    cashierName: input.cashierName,
    initialBalancesMinor: input.initialBalancesMinor,
  });

  const replay = checkIdempotencySync<OpenPosShiftResult>(
    sql,
    input.clientMutationId,
    commandId,
    requestHash,
  );
  if (replay) return replay;

  const openOnRegister = sql
    .exec<{ shift_id: string }>(
      `SELECT shift_id
       FROM hot_pos_shifts
       WHERE register_id = ? AND status = 'OPEN'
       LIMIT 1`,
      input.registerId,
    )
    .toArray()[0];

  if (openOnRegister) {
    throw new AppError(
      'SHIFT_ALREADY_OPEN',
      409,
      `SHIFT_ALREADY_OPEN: register ${input.registerId} already has open shift ${openOnRegister.shift_id}`,
      {
        registerId: input.registerId,
        openShiftId: openOnRegister.shift_id,
      },
    );
  }

  const shiftId = input.shiftId ?? crypto.randomUUID();
  const existingShiftId = sql
    .exec<{ shift_id: string }>(
      `SELECT shift_id FROM hot_pos_shifts WHERE shift_id = ? LIMIT 1`,
      shiftId,
    )
    .toArray()[0];
  if (existingShiftId) {
    throw new AppError('SHIFT_EXISTS', 409, `Shift ${shiftId} already exists`);
  }

  const openedAt = input.openedAt ?? Date.now();
  sql.exec(
    `INSERT INTO hot_pos_shifts (
       shift_id, register_id, cashier_user_id, cashier_name, status,
       initial_balances_json, sales_by_currency_json, sales_by_method_json,
       petty_expenses_json, next_ticket_seq, opened_at, closed_at
     ) VALUES (?, ?, ?, ?, 'OPEN', ?, '{}', '{}', '[]', 1, ?, NULL)`,
    shiftId,
    input.registerId,
    input.cashierUserId,
    input.cashierName,
    JSON.stringify(input.initialBalancesMinor),
    openedAt,
  );

  const outboxSeqId = insertOutboxEventSync(sql, {
    eventType: 'POS_SHIFT_OPENED',
    aggregateId: shiftId,
    payload: {
      clientMutationId: input.clientMutationId,
      shiftId,
      registerId: input.registerId,
      cashierUserId: input.cashierUserId,
      initialBalancesMinor: input.initialBalancesMinor,
      openedAt,
    },
    nowMs: openedAt,
  });

  const result: OpenPosShiftResult = {
    ok: true,
    clientMutationId: input.clientMutationId,
    shiftId,
    registerId: input.registerId,
    cashierUserId: input.cashierUserId,
    cashierName: input.cashierName,
    status: 'OPEN',
    initialBalancesMinor: input.initialBalancesMinor,
    nextTicketSeq: 1,
    openedAt,
    outboxSeqId,
  };

  recordIdempotencySync(sql, {
    clientMutationId: input.clientMutationId,
    commandId,
    requestHash,
    responseStatus: 200,
    responseJson: JSON.stringify(result),
    nowMs: openedAt,
  });

  return result;
}

/**
 * Lists POS shifts optionally filtered by registerId.
 */
export function listPosShiftsInTx(
  sql: SqlStorage,
  registerId?: string,
): PosShiftRecord[] {
  const filter = registerId ?? null;
  const rows = sql
    .exec<PosShiftRow>(
      `SELECT shift_id, register_id, cashier_user_id, cashier_name, status,
              initial_balances_json, next_ticket_seq, opened_at, closed_at
       FROM hot_pos_shifts
       WHERE (? IS NULL OR register_id = ?)
       ORDER BY opened_at DESC`,
      filter,
      filter,
    )
    .toArray();
  return rows.map((row) => ({
    shiftId: row.shift_id,
    registerId: row.register_id,
    cashierUserId: row.cashier_user_id,
    cashierName: row.cashier_name,
    status: row.status,
    initialBalancesMinor: JSON.parse(row.initial_balances_json) as Record<
      string,
      number
    >,
    nextTicketSeq: row.next_ticket_seq,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
  }));
}

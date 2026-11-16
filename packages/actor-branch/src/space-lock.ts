import { AppError } from '@shac/kernel';
import {
  acquireSpaceLockInputSchema,
  type AcquireSpaceLockInput,
  type SpaceLockRecord,
  type SpaceLockResult,
} from './contracts.js';
import {
  checkIdempotencySync,
  hashCommandPayload,
  insertOutboxEventSync,
  parseInput,
  recordIdempotencySync,
} from './idempotency.js';

type SpaceLockRow = {
  space_id: string;
  slot_bucket: string;
  lock_kind: string;
  holder_ref_id: string;
  party_name_masked: string;
  status: string;
  check_in_ms: number;
  check_out_ms: number;
  expires_at_ms: number | null;
};

/**
 * Acquires an exclusive lock on (space_id, slot_bucket) inside a SQLite tx.
 */
export function acquireSpaceLockInTx(
  sql: SqlStorage,
  rawInput: AcquireSpaceLockInput,
): SpaceLockResult {
  const input = parseInput(acquireSpaceLockInputSchema, rawInput);
  if (input.checkOutMs <= input.checkInMs) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'checkOutMs must be strictly greater than checkInMs',
    );
  }

  const commandId = 'branch.space.acquire_lock';
  const requestHash = hashCommandPayload(commandId, {
    spaceId: input.spaceId,
    slotBucket: input.slotBucket,
    lockKind: input.lockKind,
    holderRefId: input.holderRefId,
    partyNameMasked: input.partyNameMasked,
    checkInMs: input.checkInMs,
    checkOutMs: input.checkOutMs,
    expiresAtMs: input.expiresAtMs ?? null,
  });

  const replay = checkIdempotencySync<SpaceLockResult>(
    sql,
    input.clientMutationId,
    commandId,
    requestHash,
  );
  if (replay) return replay;

  const nowMs = input.nowEpochMs ?? Date.now();
  const existing = sql
    .exec<SpaceLockRow>(
      `SELECT space_id, slot_bucket, lock_kind, holder_ref_id, party_name_masked,
              status, check_in_ms, check_out_ms, expires_at_ms
       FROM hot_space_locks
       WHERE space_id = ? AND slot_bucket = ?
       LIMIT 1`,
      input.spaceId,
      input.slotBucket,
    )
    .toArray()[0];

  const isHeld =
    existing !== undefined &&
    (existing.status === 'LOCKED' || existing.status === 'CHECKED_IN') &&
    (existing.expires_at_ms === null || existing.expires_at_ms > nowMs);

  if (isHeld) {
    throw new AppError(
      'SPACE_ALREADY_LOCKED',
      409,
      `SPACE_ALREADY_LOCKED: ${input.spaceId} @ ${input.slotBucket}`,
      {
        spaceId: input.spaceId,
        slotBucket: input.slotBucket,
        holderRefId: existing.holder_ref_id,
        expiresAtMs: existing.expires_at_ms,
      },
    );
  }

  const expiresAtMs = input.expiresAtMs ?? null;
  sql.exec(
    `INSERT INTO hot_space_locks (
       space_id, slot_bucket, lock_kind, holder_ref_id, party_name_masked,
       status, check_in_ms, check_out_ms, expires_at_ms
     ) VALUES (?, ?, ?, ?, ?, 'LOCKED', ?, ?, ?)
     ON CONFLICT (space_id, slot_bucket) DO UPDATE SET
       lock_kind = excluded.lock_kind,
       holder_ref_id = excluded.holder_ref_id,
       party_name_masked = excluded.party_name_masked,
       status = 'LOCKED',
       check_in_ms = excluded.check_in_ms,
       check_out_ms = excluded.check_out_ms,
       expires_at_ms = excluded.expires_at_ms`,
    input.spaceId,
    input.slotBucket,
    input.lockKind,
    input.holderRefId,
    input.partyNameMasked,
    input.checkInMs,
    input.checkOutMs,
    expiresAtMs,
  );

  const outboxSeqId = insertOutboxEventSync(sql, {
    eventType: 'SPACE_LOCK_ACQUIRED',
    aggregateId: `${input.spaceId}:${input.slotBucket}`,
    payload: {
      clientMutationId: input.clientMutationId,
      spaceId: input.spaceId,
      slotBucket: input.slotBucket,
      lockKind: input.lockKind,
      holderRefId: input.holderRefId,
      checkInMs: input.checkInMs,
      checkOutMs: input.checkOutMs,
      expiresAtMs,
    },
    nowMs,
  });

  const result: SpaceLockResult = {
    ok: true,
    clientMutationId: input.clientMutationId,
    spaceId: input.spaceId,
    slotBucket: input.slotBucket,
    lockKind: input.lockKind,
    holderRefId: input.holderRefId,
    partyNameMasked: input.partyNameMasked,
    status: 'LOCKED',
    checkInMs: input.checkInMs,
    checkOutMs: input.checkOutMs,
    expiresAtMs,
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
 * Lists space locks optionally filtered by spaceId.
 */
export function listSpaceLocksInTx(
  sql: SqlStorage,
  spaceId?: string,
): SpaceLockRecord[] {
  const filter = spaceId ?? null;
  const rows = sql
    .exec<SpaceLockRow>(
      `SELECT space_id, slot_bucket, lock_kind, holder_ref_id, party_name_masked,
              status, check_in_ms, check_out_ms, expires_at_ms
       FROM hot_space_locks
       WHERE (? IS NULL OR space_id = ?)
       ORDER BY space_id ASC, slot_bucket ASC`,
      filter,
      filter,
    )
    .toArray();
  return rows.map((row) => ({
    spaceId: row.space_id,
    slotBucket: row.slot_bucket,
    lockKind: row.lock_kind,
    holderRefId: row.holder_ref_id,
    partyNameMasked: row.party_name_masked,
    status: row.status,
    checkInMs: row.check_in_ms,
    checkOutMs: row.check_out_ms,
    expiresAtMs: row.expires_at_ms,
  }));
}

import { z } from 'zod';
import {
  drainOutboxOptionsSchema,
  type DrainOutboxOptions,
  type JsonValue,
  type OutboxEvent,
} from './contracts.js';
import { parseInput } from './idempotency.js';

type OutboxRow = {
  seq_id: number;
  event_type: string;
  aggregate_id: string;
  payload_json: string;
  attempts: number;
  next_attempt_ms: number;
  created_at_ms: number;
};

function mapOutboxRow(row: OutboxRow): OutboxEvent {
  return {
    seqId: row.seq_id,
    eventType: row.event_type,
    aggregateId: row.aggregate_id,
    payload: JSON.parse(row.payload_json) as Record<string, JsonValue>,
    attempts: row.attempts,
    nextAttemptMs: row.next_attempt_ms,
    createdAtMs: row.created_at_ms,
  };
}

/**
 * Peeks pending hot_outbox events in monotonic seq_id order without deleting.
 */
export function listOutboxInTx(sql: SqlStorage, limit = 100): OutboxEvent[] {
  const safeLimit = parseInput(z.number().int().positive().max(500), limit);
  const rows = sql
    .exec<OutboxRow>(
      `SELECT seq_id, event_type, aggregate_id, payload_json,
              attempts, next_attempt_ms, created_at_ms
       FROM hot_outbox
       ORDER BY seq_id ASC
       LIMIT ?`,
      safeLimit,
    )
    .toArray();
  return rows.map(mapOutboxRow);
}

/**
 * Reads and deletes outbox events atomically inside a SQLite transaction.
 */
export function drainOutboxInTx(
  sql: SqlStorage,
  rawOptions: DrainOutboxOptions = {},
): OutboxEvent[] {
  const options = parseInput(drainOutboxOptionsSchema, rawOptions);
  if (options.ackSeqIds !== undefined) {
    if (options.ackSeqIds.length === 0) return [];
    const placeholders = options.ackSeqIds.map(() => '?').join(', ');
    const rows = sql
      .exec<OutboxRow>(
        `SELECT seq_id, event_type, aggregate_id, payload_json,
                attempts, next_attempt_ms, created_at_ms
         FROM hot_outbox
         WHERE seq_id IN (${placeholders})
         ORDER BY seq_id ASC`,
        ...options.ackSeqIds,
      )
      .toArray();
    if (rows.length > 0) {
      sql.exec(
        `DELETE FROM hot_outbox WHERE seq_id IN (${placeholders})`,
        ...options.ackSeqIds,
      );
    }
    return rows.map(mapOutboxRow);
  }

  const rows = sql
    .exec<OutboxRow>(
      `SELECT seq_id, event_type, aggregate_id, payload_json,
              attempts, next_attempt_ms, created_at_ms
       FROM hot_outbox
       ORDER BY seq_id ASC
       LIMIT ?`,
      options.limit,
    )
    .toArray();
  if (rows.length > 0) {
    const seqIds = rows.map((r) => r.seq_id);
    const placeholders = seqIds.map(() => '?').join(', ');
    sql.exec(`DELETE FROM hot_outbox WHERE seq_id IN (${placeholders})`, ...seqIds);
  }
  return rows.map(mapOutboxRow);
}

export type OutboxDeliveryStatus = 'PENDING' | 'DELIVERED' | 'DLQ';

export const OUTBOX_MAX_ATTEMPTS = 8;

export function computeOutboxBackoffMs(
  attemptCount: number,
  randomFloat: number = Math.random(),
): number {
  const baseMs = Math.min(60_000, 250 * Math.pow(2, Math.max(0, attemptCount)));
  const jitterMs = Math.floor(randomFloat * Math.min(1_000, baseMs * 0.25));
  return baseMs + jitterMs;
}

export function classifyOutboxFailure(attemptCount: number): {
  nextStatus: OutboxDeliveryStatus;
  nextDelayMs: number;
} {
  const nextAttempt = attemptCount + 1;
  if (nextAttempt >= OUTBOX_MAX_ATTEMPTS) {
    return { nextStatus: 'DLQ', nextDelayMs: 0 };
  }
  return {
    nextStatus: 'PENDING',
    nextDelayMs: computeOutboxBackoffMs(nextAttempt),
  };
}

export function listReadyOutboxInTx(
  sql: SqlStorage,
  nowMs: number = Date.now(),
  limit = 100,
): OutboxEvent[] {
  const safeLimit = parseInput(z.number().int().positive().max(500), limit);
  const rows = sql
    .exec<OutboxRow>(
      `SELECT seq_id, event_type, aggregate_id, payload_json,
              attempts, next_attempt_ms, created_at_ms
       FROM hot_outbox
       WHERE attempts < ? AND next_attempt_ms <= ?
       ORDER BY seq_id ASC
       LIMIT ?`,
      OUTBOX_MAX_ATTEMPTS,
      nowMs,
      safeLimit,
    )
    .toArray();
  return rows.map(mapOutboxRow);
}

export function recordOutboxAttemptFailureInTx(
  sql: SqlStorage,
  seqId: number,
  nowMs: number = Date.now(),
): { nextStatus: OutboxDeliveryStatus; nextAttemptAtMs: number } {
  const row = sql
    .exec<{ attempts: number }>(
      `SELECT attempts FROM hot_outbox WHERE seq_id = ? LIMIT 1`,
      seqId,
    )
    .toArray()[0];
  if (!row) {
    return { nextStatus: 'DELIVERED', nextAttemptAtMs: 0 };
  }
  const decision = classifyOutboxFailure(row.attempts);
  const nextAttemptAtMs =
    decision.nextStatus === 'DLQ' ? Number.MAX_SAFE_INTEGER : nowMs + decision.nextDelayMs;
  sql.exec(
    `UPDATE hot_outbox
     SET attempts = attempts + 1, next_attempt_ms = ?
     WHERE seq_id = ?`,
    nextAttemptAtMs,
    seqId,
  );
  return { nextStatus: decision.nextStatus, nextAttemptAtMs };
}

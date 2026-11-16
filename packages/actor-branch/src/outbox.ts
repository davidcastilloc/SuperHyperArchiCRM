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

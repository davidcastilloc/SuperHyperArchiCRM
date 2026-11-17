import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const immutableAuditChainLedger = sqliteTable(
  'immutable_audit_chain_ledger',
  {
    orgId: text('org_id').notNull(),
    streamKey: text('stream_key').notNull(),
    seqNo: integer('seq_no').notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    targetId: text('target_id').notNull(),
    occurredAtMs: integer('occurred_at_ms').notNull(),
    prevHashHex: text('prev_hash_hex').notNull(),
    recordHashHex: text('record_hash_hex').notNull(),
    payloadJson: text('payload_json').notNull(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.streamKey, table.seqNo] })],
);

export const customFieldSearchProjections = sqliteTable(
  'custom_field_search_projections',
  {
    orgId: text('org_id').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    fieldKey: text('field_key').notNull(),
    textVal: text('text_val'),
    numVal: real('num_val'),
    updatedAtMs: integer('updated_at_ms').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.orgId, table.entityType, table.fieldKey, table.entityId],
    }),
  ],
);

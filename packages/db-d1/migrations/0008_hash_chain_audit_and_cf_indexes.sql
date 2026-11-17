-- 0008_hash_chain_audit_and_cf_indexes.sql
-- Ledger inmutable encadenado por SHA-256 + índices de proyección para Custom Fields

CREATE TABLE IF NOT EXISTS immutable_audit_chain_ledger (
  org_id TEXT NOT NULL,
  stream_key TEXT NOT NULL,
  seq_no INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  occurred_at_ms INTEGER NOT NULL,
  prev_hash_hex TEXT NOT NULL,
  record_hash_hex TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (org_id, stream_key, seq_no)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_immutable_audit_target
  ON immutable_audit_chain_ledger (org_id, target_id, occurred_at_ms DESC);

CREATE TABLE IF NOT EXISTS custom_field_search_projections (
  org_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  text_val TEXT,
  num_val REAL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (org_id, entity_type, field_key, entity_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_cf_proj_text
  ON custom_field_search_projections (org_id, entity_type, field_key, text_val);

CREATE INDEX IF NOT EXISTS idx_cf_proj_num
  ON custom_field_search_projections (org_id, entity_type, field_key, num_val);

-- 0007_hardening_outbox_and_audit.sql
-- Evolución ortogonal para idempotencia endurecida, auditoría de DLQ y anti-sobregiro IOLTA

CREATE TABLE IF NOT EXISTS kernel_idempotency_locks (
  scope_key TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  command_name TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED_RETRYABLE')),
  status_code INTEGER NOT NULL DEFAULT 200,
  response_json TEXT,
  locked_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_kernel_idempotency_expires
  ON kernel_idempotency_locks (org_id, expires_at_ms);

CREATE TABLE IF NOT EXISTS branch_outbox_dlq_audit (
  dlq_id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempt_count INTEGER NOT NULL,
  last_error TEXT NOT NULL,
  quarantined_at_ms INTEGER NOT NULL,
  replayed_at_ms INTEGER
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_branch_outbox_dlq_org_branch
  ON branch_outbox_dlq_audit (org_id, branch_id, quarantined_at_ms DESC);

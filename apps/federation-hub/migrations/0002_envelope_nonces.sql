CREATE TABLE IF NOT EXISTS federation_envelope_nonces (
  sender_org_id TEXT NOT NULL,
  envelope_id TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (sender_org_id, envelope_id)
) WITHOUT ROWID;

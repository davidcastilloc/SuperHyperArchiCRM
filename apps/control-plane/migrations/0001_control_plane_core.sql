-- Phase 4: Control Plane Core Schema (Additive SQL only)

CREATE TABLE IF NOT EXISTS cp_deployments (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  hosting_mode TEXT NOT NULL DEFAULT 'BYOC_FREE',
  cf_account_id TEXT,
  d1_database_id TEXT NOT NULL,
  config_kv_key TEXT NOT NULL,
  release_channel TEXT NOT NULL DEFAULT 'stable',
  current_version TEXT NOT NULL DEFAULT '1.0.0',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS cp_deployments_tenant_idx
  ON cp_deployments (tenant_id);

CREATE INDEX IF NOT EXISTS cp_deployments_channel_idx
  ON cp_deployments (release_channel, status);

CREATE TABLE IF NOT EXISTS cp_market_profiles (
  deployment_id TEXT PRIMARY KEY,
  preset_id TEXT NOT NULL,
  region_pack TEXT NOT NULL,
  active_packs_json TEXT NOT NULL,
  active_modules_json TEXT NOT NULL,
  vocabulary_json TEXT NOT NULL,
  currency_json TEXT NOT NULL,
  entitlements_json TEXT NOT NULL,
  federation_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (deployment_id) REFERENCES cp_deployments(id)
);

CREATE TABLE IF NOT EXISTS cp_appliance_licenses (
  license_id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  hardware_fingerprint TEXT NOT NULL,
  edition_preset TEXT NOT NULL DEFAULT 'omni-enterprise',
  issued_at INTEGER NOT NULL,
  expires_at INTEGER,
  hmac_signature TEXT NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (deployment_id) REFERENCES cp_deployments(id)
);

CREATE INDEX IF NOT EXISTS cp_appliance_licenses_dep_idx
  ON cp_appliance_licenses (deployment_id);

CREATE TABLE IF NOT EXISTS cp_telemetry_daily (
  deployment_id TEXT NOT NULL,
  date_ymd TEXT NOT NULL,
  d1_rows_read INTEGER NOT NULL DEFAULT 0,
  d1_rows_written INTEGER NOT NULL DEFAULT 0,
  worker_requests INTEGER NOT NULL DEFAULT 0,
  storage_bytes INTEGER NOT NULL DEFAULT 0,
  active_registers INTEGER NOT NULL DEFAULT 0,
  alert_level TEXT NOT NULL DEFAULT 'OK',
  recommended_mode TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (deployment_id, date_ymd),
  FOREIGN KEY (deployment_id) REFERENCES cp_deployments(id)
);

CREATE TABLE IF NOT EXISTS cp_rollout_jobs (
  job_id TEXT PRIMARY KEY,
  target_version TEXT NOT NULL,
  channel TEXT NOT NULL,
  migration_batch_hash TEXT NOT NULL,
  total_nodes INTEGER NOT NULL DEFAULT 0,
  succeeded_nodes INTEGER NOT NULL DEFAULT 0,
  failed_nodes INTEGER NOT NULL DEFAULT 0,
  batches_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

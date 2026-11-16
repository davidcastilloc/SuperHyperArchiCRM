-- Phase 1 IAM Core & Kernel Audit/Idempotency Tables (Expand-Only / Additive)

CREATE TABLE IF NOT EXISTS iam_tenants (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  legal_name TEXT,
  primary_currency TEXT NOT NULL DEFAULT 'USD',
  default_locale TEXT NOT NULL DEFAULT 'en-US',
  encryption_kms_key_ref TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  trial_ends_at INTEGER,
  billing_external_refs_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS iam_tenants_slug_uniq
  ON iam_tenants (slug);

CREATE TABLE IF NOT EXISTS iam_organizations (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  parent_id TEXT,
  root_id TEXT NOT NULL,
  tree_path TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  org_kind TEXT NOT NULL DEFAULT 'branch',
  tax_id TEXT,
  npi_code TEXT,
  license_number TEXT,
  phone TEXT,
  email TEXT,
  address_json TEXT NOT NULL DEFAULT '{}',
  latitude REAL,
  longitude REAL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  operating_hours_json TEXT NOT NULL DEFAULT '{}',
  branding_json TEXT NOT NULL DEFAULT '{}',
  receipt_header TEXT,
  receipt_footer TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS iam_orgs_tenant_slug_uniq
  ON iam_organizations (tenant_id, slug);

CREATE INDEX IF NOT EXISTS iam_orgs_tenant_path_idx
  ON iam_organizations (tenant_id, tree_path);

CREATE INDEX IF NOT EXISTS iam_orgs_tenant_parent_idx
  ON iam_organizations (tenant_id, parent_id);

CREATE TABLE IF NOT EXISTS iam_users (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  default_org_id TEXT NOT NULL,
  realm TEXT NOT NULL DEFAULT 'staff',
  email TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  username TEXT,
  full_name TEXT NOT NULL,
  avatar_url TEXT,
  phone TEXT,
  password_hash_webcrypto TEXT,
  floor_pin_hash TEXT,
  is_verified INTEGER NOT NULL DEFAULT 0,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  sessions_revoked_at INTEGER,
  last_login_at INTEGER,
  preferences_json TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS iam_users_tenant_email_hash_uniq
  ON iam_users (tenant_id, email_hash);

CREATE INDEX IF NOT EXISTS iam_users_tenant_realm_idx
  ON iam_users (tenant_id, realm);

CREATE TABLE IF NOT EXISTS iam_api_keys (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_sha256 TEXT NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  last_used_at INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS iam_api_keys_tenant_sha256_uniq
  ON iam_api_keys (tenant_id, key_sha256);

CREATE INDEX IF NOT EXISTS iam_api_keys_tenant_org_idx
  ON iam_api_keys (tenant_id, org_id);

CREATE TABLE IF NOT EXISTS iam_delegation_pins (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  grantor_user_id TEXT NOT NULL,
  redeemer_user_id TEXT,
  pin_sha256 TEXT NOT NULL,
  scope_permissions_json TEXT NOT NULL DEFAULT '[]',
  duration_label TEXT NOT NULL,
  redeemed_at INTEGER,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS iam_delegation_pins_tenant_org_status_idx
  ON iam_delegation_pins (tenant_id, org_id, status);

CREATE INDEX IF NOT EXISTS iam_delegation_pins_tenant_sha256_idx
  ON iam_delegation_pins (tenant_id, pin_sha256);

CREATE TABLE IF NOT EXISTS kernel_idempotency_keys (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  client_mutation_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS kernel_idempotency_tenant_mutation_uniq
  ON kernel_idempotency_keys (tenant_id, client_mutation_id);

CREATE TABLE IF NOT EXISTS kernel_action_logs (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  log_stream TEXT NOT NULL DEFAULT 'action_mutation',
  actor_id TEXT NOT NULL,
  delegated_by_id TEXT,
  target_party_id TEXT,
  command_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  access_purpose TEXT,
  snapshot_before_json TEXT,
  snapshot_after_json TEXT,
  undo_token TEXT,
  ip_address TEXT,
  user_agent TEXT,
  hmac_signature TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS kernel_action_logs_tenant_created_idx
  ON kernel_action_logs (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS kernel_action_logs_tenant_resource_idx
  ON kernel_action_logs (tenant_id, resource_kind, resource_id);

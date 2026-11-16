import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const cpDeployments = sqliteTable(
  'cp_deployments',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    tenantId: text('tenant_id').notNull(),
    companyName: text('company_name').notNull(),
    hostingMode: text('hosting_mode').notNull().default('BYOC_FREE'),
    cfAccountId: text('cf_account_id'),
    d1DatabaseId: text('d1_database_id').notNull(),
    configKvKey: text('config_kv_key').notNull(),
    releaseChannel: text('release_channel').notNull().default('stable'),
    currentVersion: text('current_version').notNull().default('1.0.0'),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('cp_deployments_slug_uniq').on(t.slug),
    index('cp_deployments_tenant_idx').on(t.tenantId),
    index('cp_deployments_channel_idx').on(t.releaseChannel, t.status),
  ],
);

export const cpMarketProfiles = sqliteTable('cp_market_profiles', {
  deploymentId: text('deployment_id')
    .primaryKey()
    .references(() => cpDeployments.id),
  presetId: text('preset_id').notNull(),
  regionPack: text('region_pack').notNull(),
  activePacksJson: text('active_packs_json').notNull(),
  activeModulesJson: text('active_modules_json').notNull(),
  vocabularyJson: text('vocabulary_json').notNull(),
  currencyJson: text('currency_json').notNull(),
  entitlementsJson: text('entitlements_json').notNull(),
  federationJson: text('federation_json').notNull(),
  revision: integer('revision').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
});

export const cpApplianceLicenses = sqliteTable(
  'cp_appliance_licenses',
  {
    licenseId: text('license_id').primaryKey(),
    deploymentId: text('deployment_id')
      .notNull()
      .references(() => cpDeployments.id),
    hardwareFingerprint: text('hardware_fingerprint').notNull(),
    editionPreset: text('edition_preset').notNull().default('omni-enterprise'),
    issuedAt: integer('issued_at').notNull(),
    expiresAt: integer('expires_at'),
    hmacSignature: text('hmac_signature').notNull(),
    revokedAt: integer('revoked_at'),
  },
  (t) => [index('cp_appliance_licenses_dep_idx').on(t.deploymentId)],
);

export const cpTelemetryDaily = sqliteTable(
  'cp_telemetry_daily',
  {
    deploymentId: text('deployment_id')
      .notNull()
      .references(() => cpDeployments.id),
    dateYmd: text('date_ymd').notNull(),
    d1RowsRead: integer('d1_rows_read').notNull().default(0),
    d1RowsWritten: integer('d1_rows_written').notNull().default(0),
    workerRequests: integer('worker_requests').notNull().default(0),
    storageBytes: integer('storage_bytes').notNull().default(0),
    activeRegisters: integer('active_registers').notNull().default(0),
    alertLevel: text('alert_level').notNull().default('OK'),
    recommendedMode: text('recommended_mode'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.deploymentId, t.dateYmd] })],
);

export const cpRolloutJobs = sqliteTable('cp_rollout_jobs', {
  jobId: text('job_id').primaryKey(),
  targetVersion: text('target_version').notNull(),
  channel: text('channel').notNull(),
  migrationBatchHash: text('migration_batch_hash').notNull(),
  totalNodes: integer('total_nodes').notNull().default(0),
  succeededNodes: integer('succeeded_nodes').notNull().default(0),
  failedNodes: integer('failed_nodes').notNull().default(0),
  batchesJson: text('batches_json').notNull().default('[]'),
  status: text('status').notNull().default('planned'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

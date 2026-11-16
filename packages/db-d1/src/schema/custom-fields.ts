import { AppError } from '@shac/kernel';
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const ALLOWED_VIRTUAL_COLUMN_TABLES = [
  'crm_parties',
  'cat_products',
  'iam_organizations',
] as const;

export type VirtualColumnTable = (typeof ALLOWED_VIRTUAL_COLUMN_TABLES)[number];

const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{1,40}$/;

export interface VirtualColumnSqlResult {
  columnName: string;
  alterSql: string;
  indexSql: string;
}

/**
 * Builds additive SQLite virtual generated column + B-tree index DDL for
 * hot-searchable JSON custom fields on trunk tables (`v_cf_<fieldKey>`).
 */
export function buildVirtualColumnSql(params: {
  tableName: VirtualColumnTable;
  fieldKey: string;
}): VirtualColumnSqlResult {
  if (!(ALLOWED_VIRTUAL_COLUMN_TABLES as readonly string[]).includes(params.tableName)) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      `Invalid virtual column tableName: ${String(params.tableName)}`,
    );
  }
  if (!FIELD_KEY_PATTERN.test(params.fieldKey)) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      `Invalid fieldKey for virtual column: ${params.fieldKey}`,
    );
  }

  const columnName = `v_cf_${params.fieldKey}`;
  const alterSql =
    `ALTER TABLE ${params.tableName} ADD COLUMN ${columnName} TEXT ` +
    `GENERATED ALWAYS AS (json_extract(custom_fields, '$.${params.fieldKey}')) VIRTUAL;`;
  const indexSql =
    `CREATE INDEX IF NOT EXISTS idx_${params.tableName}_${columnName} ` +
    `ON ${params.tableName} (tenant_id, ${columnName});`;

  return { columnName, alterSql, indexSql };
}

export const kernelCustomFieldDefs = sqliteTable(
  'kernel_custom_field_defs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    entityType: text('entity_type').notNull(),
    fieldsetCode: text('fieldset_code').notNull().default('default'),
    fieldKey: text('field_key').notNull(),
    label: text('label').notNull(),
    dataType: text('data_type').notNull().default('text'),
    isRequired: integer('is_required', { mode: 'boolean' }).notNull().default(false),
    isEncrypted: integer('is_encrypted', { mode: 'boolean' }).notNull().default(false),
    isIndexed: integer('is_indexed', { mode: 'boolean' }).notNull().default(false),
    virtualColumnName: text('virtual_column_name'),
    dictionaryId: text('dictionary_id'),
    validationJson: text('validation_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    uniqueIndex('kernel_cf_defs_tenant_entity_key_uniq').on(
      t.tenantId,
      t.entityType,
      t.fieldKey,
    ),
    index('kernel_cf_defs_tenant_entity_idx').on(t.tenantId, t.entityType),
  ],
);

export const kernelCustomRecords = sqliteTable(
  'kernel_custom_records',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    orgId: text('org_id').notNull(),
    entitySlug: text('entity_slug').notNull(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    dataJson: text('data_json').notNull().default('{}'),
    searchTokensHash: text('search_tokens_hash'),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    uniqueIndex('kernel_custom_records_tenant_slug_code_uniq').on(
      t.tenantId,
      t.entitySlug,
      t.code,
    ),
    index('kernel_custom_records_tenant_org_slug_idx').on(
      t.tenantId,
      t.orgId,
      t.entitySlug,
    ),
  ],
);

export const kernelRecordLocks = sqliteTable(
  'kernel_record_locks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    orgId: text('org_id').notNull(),
    resourceKind: text('resource_kind').notNull(),
    resourceId: text('resource_id').notNull(),
    lockToken: text('lock_token').notNull(),
    strategy: text('strategy').notNull().default('optimistic'),
    lockedByUserId: text('locked_by_user_id').notNull(),
    baseVersion: integer('base_version').notNull().default(1),
    heartbeatAt: integer('heartbeat_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    conflictPayloadJson: text('conflict_payload_json'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('kernel_record_locks_tenant_resource_uniq').on(
      t.tenantId,
      t.resourceKind,
      t.resourceId,
    ),
    index('kernel_record_locks_tenant_expires_idx').on(t.tenantId, t.expiresAt),
  ],
);

import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const baseCols = () => ({
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  orgId: text('org_id').notNull(),
});

const tailCols = () => ({
  customFields: text('custom_fields').notNull().default('{}'),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
});

export const legMatters = sqliteTable(
  'leg_matters',
  {
    ...baseCols(),
    referenceNumber: text('reference_number').notNull(),
    clientPartyId: text('client_party_id').notNull(),
    leadLawyerStaffId: text('lead_lawyer_staff_id').notNull(),
    practiceArea: text('practice_area').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    billingMode: text('billing_mode').notNull().default('hourly'),
    conflictCheckId: text('conflict_check_id'),
    openedAt: integer('opened_at').notNull(),
    closedAt: integer('closed_at'),
    status: text('status').notNull().default('OPEN'),
    ...tailCols(),
  },
  (t) => [
    uniqueIndex('leg_matters_tenant_ref_uniq').on(t.tenantId, t.referenceNumber),
    index('leg_matters_tenant_org_status_idx').on(t.tenantId, t.orgId, t.status),
    index('leg_matters_tenant_client_idx').on(t.tenantId, t.clientPartyId),
  ],
);

export const legDocketsAndEvents = sqliteTable(
  'leg_dockets_and_events',
  {
    ...baseCols(),
    matterId: text('matter_id').notNull(),
    caseNumber: text('case_number').notNull(),
    caseTitle: text('case_title').notNull(),
    courtName: text('court_name').notNull(),
    judgeName: text('judge_name'),
    filingStatus: text('filing_status').notNull().default('ACTIVE'),
    autoSyncEnabled: integer('auto_sync_enabled', { mode: 'boolean' }).notNull().default(false),
    lastSyncedAt: integer('last_synced_at'),
    entriesAndDeadlinesJson: text('entries_and_deadlines_json').notNull().default('[]'),
    ...tailCols(),
  },
  (t) => [
    index('leg_dockets_tenant_matter_idx').on(t.tenantId, t.matterId),
    index('leg_dockets_tenant_case_idx').on(t.tenantId, t.caseNumber),
  ],
);

export const legTimeEntries = sqliteTable(
  'leg_time_entries',
  {
    ...baseCols(),
    matterId: text('matter_id').notNull(),
    staffId: text('staff_id').notNull(),
    entryDate: integer('entry_date').notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(0),
    hourlyRateMinor: integer('hourly_rate_minor').notNull().default(0),
    amountMinor: integer('amount_minor').notNull().default(0),
    isBillable: integer('is_billable', { mode: 'boolean' }).notNull().default(true),
    description: text('description').notNull(),
    status: text('status').notNull().default('DRAFT'),
    ...tailCols(),
  },
  (t) => [
    index('leg_time_tenant_matter_idx').on(t.tenantId, t.matterId, t.entryDate),
    index('leg_time_tenant_staff_idx').on(t.tenantId, t.staffId),
  ],
);

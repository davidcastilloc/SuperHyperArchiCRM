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

export const srvWorkOrders = sqliteTable(
  'srv_work_orders',
  {
    ...baseCols(),
    ticketNumber: text('ticket_number').notNull(),
    orderKind: text('order_kind').notNull().default('tech_repair'),
    partyId: text('party_id'),
    unitId: text('unit_id'),
    commonAreaName: text('common_area_name'),
    category: text('category').notNull().default('GENERAL'),
    deviceSerialOrImei: text('device_serial_or_imei'),
    initialDiagnosis: text('initial_diagnosis'),
    permissionToEnter: integer('permission_to_enter', { mode: 'boolean' }).notNull().default(false),
    hasPetsAlert: integer('has_pets_alert', { mode: 'boolean' }).notNull().default(false),
    preferredTimeWindow: text('preferred_time_window'),
    priority: text('priority').notNull().default('NORMAL'),
    slaDueAt: integer('sla_due_at'),
    assignedStaffId: text('assigned_staff_id'),
    etaAt: integer('eta_at'),
    partsConsumedJson: text('parts_consumed_json').notNull().default('[]'),
    laborCostMinor: integer('labor_cost_minor').notNull().default(0),
    partsCostMinor: integer('parts_cost_minor').notNull().default(0),
    mediaUrlsJson: text('media_urls_json').notNull().default('[]'),
    commentsThreadJson: text('comments_thread_json').notNull().default('[]'),
    residentRating1to5: integer('resident_rating_1to5'),
    startedAt: integer('started_at'),
    completedAt: integer('completed_at'),
    status: text('status').notNull().default('OPEN'),
    ...tailCols(),
  },
  (t) => [
    uniqueIndex('srv_work_orders_tenant_ticket_uniq').on(t.tenantId, t.ticketNumber),
    index('srv_work_orders_tenant_org_status_idx').on(t.tenantId, t.orgId, t.status),
    index('srv_work_orders_tenant_staff_idx').on(t.tenantId, t.assignedStaffId),
  ],
);

export const srvPreventiveSchedules = sqliteTable(
  'srv_preventive_schedules',
  {
    ...baseCols(),
    fixedAssetId: text('fixed_asset_id'),
    unitId: text('unit_id'),
    title: text('title').notNull(),
    category: text('category').notNull().default('GENERAL'),
    frequencyDays: integer('frequency_days').notNull().default(30),
    checklistTemplateJson: text('checklist_template_json').notNull().default('[]'),
    lastPerformedAt: integer('last_performed_at'),
    nextDueAt: integer('next_due_at').notNull(),
    assignedStaffId: text('assigned_staff_id'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    ...tailCols(),
  },
  (t) => [
    index('srv_prev_sched_tenant_org_due_idx').on(t.tenantId, t.orgId, t.nextDueAt),
    index('srv_prev_sched_tenant_asset_idx').on(t.tenantId, t.fixedAssetId),
  ],
);

export const srvWarrantyClaimsRma = sqliteTable(
  'srv_warranty_claims_rma',
  {
    ...baseCols(),
    claimNumber: text('claim_number').notNull(),
    partyId: text('party_id').notNull(),
    originalOrderId: text('original_order_id'),
    priority: text('priority').notNull().default('NORMAL'),
    slaDueAt: integer('sla_due_at'),
    slaPausedAt: integer('sla_paused_at'),
    advanceReplacement: integer('advance_replacement', { mode: 'boolean' }).notNull().default(false),
    returnTrackingNumber: text('return_tracking_number'),
    linesJson: text('lines_json').notNull().default('[]'),
    replacementOrderId: text('replacement_order_id'),
    creditMemoId: text('credit_memo_id'),
    vendorRecoveryStatus: text('vendor_recovery_status').notNull().default('PENDING'),
    vendorRecoveredMinor: integer('vendor_recovered_minor').notNull().default(0),
    status: text('status').notNull().default('REQUESTED'),
    ...tailCols(),
  },
  (t) => [
    uniqueIndex('srv_rma_tenant_claim_uniq').on(t.tenantId, t.claimNumber),
    index('srv_rma_tenant_org_status_idx').on(t.tenantId, t.orgId, t.status),
    index('srv_rma_tenant_party_idx').on(t.tenantId, t.partyId),
  ],
);

export const psaProjectsAndTasks = sqliteTable(
  'psa_projects_and_tasks',
  {
    ...baseCols(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    partyId: text('party_id'),
    matterId: text('matter_id'),
    budgetKind: text('budget_kind').notNull().default('hours'),
    budgetValue: integer('budget_value').notNull().default(0),
    hourlyRateMinor: integer('hourly_rate_minor').notNull().default(0),
    tasksKanbanJson: text('tasks_kanban_json').notNull().default('[]'),
    status: text('status').notNull().default('ACTIVE'),
    ...tailCols(),
  },
  (t) => [
    uniqueIndex('psa_projects_tenant_code_uniq').on(t.tenantId, t.code),
    index('psa_projects_tenant_org_status_idx').on(t.tenantId, t.orgId, t.status),
  ],
);

export const evvFieldVisits = sqliteTable(
  'evv_field_visits',
  {
    ...baseCols(),
    sourceKind: text('source_kind').notNull().default('field_tech'),
    parentRecordId: text('parent_record_id').notNull(),
    partyId: text('party_id'),
    staffId: text('staff_id').notNull(),
    targetLatMicros: integer('target_lat_micros').notNull(),
    targetLngMicros: integer('target_lng_micros').notNull(),
    clockInLatMicros: integer('clock_in_lat_micros').notNull(),
    clockInLngMicros: integer('clock_in_lng_micros').notNull(),
    distanceMeters: integer('distance_meters').notNull().default(0),
    geofenceCompliant: integer('geofence_compliant', { mode: 'boolean' }).notNull().default(false),
    clockInAt: integer('clock_in_at').notNull(),
    clockOutAt: integer('clock_out_at'),
    clientOrCaregiverSignatureSvg: text('client_or_caregiver_signature_svg'),
    staffSignatureSvg: text('staff_signature_svg'),
    status: text('status').notNull().default('CLOCKED_IN'),
    ...tailCols(),
  },
  (t) => [
    index('evv_visits_tenant_org_status_idx').on(t.tenantId, t.orgId, t.status),
    index('evv_visits_tenant_staff_idx').on(t.tenantId, t.staffId, t.clockInAt),
    index('evv_visits_tenant_parent_idx').on(t.tenantId, t.parentRecordId),
  ],
);

-- Phase 6: Spaces, PMS, Leases & Condo Community Hub (Domain 7: #66-75, Additive Only)

-- 66. spc_unit_types
CREATE TABLE IF NOT EXISTS spc_unit_types (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  space_category TEXT NOT NULL DEFAULT 'hotel_room',
  max_occupancy INTEGER NOT NULL DEFAULT 1,
  bed_or_layout_type TEXT,
  area_sqft INTEGER,
  base_rate_minor INTEGER NOT NULL DEFAULT 0,
  rate_period TEXT NOT NULL DEFAULT 'night',
  amenities_json TEXT NOT NULL DEFAULT '[]',
  media_urls_json TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS spc_unit_types_tenant_code_uniq
  ON spc_unit_types (tenant_id, code);

CREATE INDEX IF NOT EXISTS spc_unit_types_tenant_org_cat_idx
  ON spc_unit_types (tenant_id, org_id, space_category);

-- 67. spc_units
CREATE TABLE IF NOT EXISTS spc_units (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  unit_type_id TEXT NOT NULL,
  unit_number TEXT NOT NULL,
  floor_label TEXT,
  building_section TEXT,
  current_status TEXT NOT NULL DEFAULT 'AVAILABLE',
  condition_notes TEXT,
  last_cleaned_at INTEGER,
  smart_lock_device_id TEXT,
  monthly_rent_minor INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS spc_units_tenant_org_number_uniq
  ON spc_units (tenant_id, org_id, unit_number);

CREATE INDEX IF NOT EXISTS spc_units_tenant_org_status_idx
  ON spc_units (tenant_id, org_id, current_status);

CREATE INDEX IF NOT EXISTS spc_units_tenant_type_idx
  ON spc_units (tenant_id, unit_type_id);

-- 68. spc_availability_rules
CREATE TABLE IF NOT EXISTS spc_availability_rules (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  subject_type TEXT NOT NULL DEFAULT 'space_unit',
  subject_id TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  rrule_text TEXT NOT NULL,
  exdates_json TEXT NOT NULL DEFAULT '[]',
  kind TEXT NOT NULL DEFAULT 'working_hours',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS spc_avail_rules_tenant_subject_idx
  ON spc_availability_rules (tenant_id, subject_type, subject_id);

CREATE INDEX IF NOT EXISTS spc_avail_rules_tenant_org_kind_idx
  ON spc_availability_rules (tenant_id, org_id, kind);

-- 69. spc_bookings_and_appointments
CREATE TABLE IF NOT EXISTS spc_bookings_and_appointments (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  confirmation_code TEXT NOT NULL,
  booking_kind TEXT NOT NULL DEFAULT 'hotel_stay',
  party_id TEXT NOT NULL,
  provider_staff_id TEXT,
  unit_id TEXT,
  source_channel TEXT NOT NULL DEFAULT 'DIRECT',
  scheduled_start INTEGER NOT NULL,
  scheduled_end INTEGER NOT NULL,
  actual_check_in INTEGER,
  actual_check_out INTEGER,
  adults_count INTEGER NOT NULL DEFAULT 1,
  children_count INTEGER NOT NULL DEFAULT 0,
  recurrence_rule TEXT,
  visit_reason TEXT,
  special_requests TEXT,
  check_in_checklist_json TEXT NOT NULL DEFAULT '{}',
  telehealth_room_id TEXT,
  move_history_json TEXT NOT NULL DEFAULT '[]',
  total_minor INTEGER NOT NULL DEFAULT 0,
  paid_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS spc_bookings_tenant_code_uniq
  ON spc_bookings_and_appointments (tenant_id, confirmation_code);

CREATE INDEX IF NOT EXISTS spc_bookings_tenant_org_status_idx
  ON spc_bookings_and_appointments (tenant_id, org_id, status);

CREATE INDEX IF NOT EXISTS spc_bookings_tenant_unit_window_idx
  ON spc_bookings_and_appointments (tenant_id, unit_id, scheduled_start, scheduled_end);

CREATE INDEX IF NOT EXISTS spc_bookings_tenant_party_idx
  ON spc_bookings_and_appointments (tenant_id, party_id);

-- 70. spc_waitlist
CREATE TABLE IF NOT EXISTS spc_waitlist (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  party_id TEXT NOT NULL,
  preferred_staff_id TEXT,
  unit_type_id TEXT,
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  preferred_dates_json TEXT NOT NULL DEFAULT '[]',
  preferred_slots_json TEXT NOT NULL DEFAULT '[]',
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'waiting',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS spc_waitlist_tenant_org_status_idx
  ON spc_waitlist (tenant_id, org_id, status, priority);

CREATE INDEX IF NOT EXISTS spc_waitlist_tenant_party_idx
  ON spc_waitlist (tenant_id, party_id);

-- 71. spc_folios
CREATE TABLE IF NOT EXISTS spc_folios (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  folio_number TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  party_id TEXT NOT NULL,
  unit_id TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  charges_json TEXT NOT NULL DEFAULT '[]',
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  paid_minor INTEGER NOT NULL DEFAULT 0,
  balance_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS spc_folios_tenant_number_uniq
  ON spc_folios (tenant_id, folio_number);

CREATE INDEX IF NOT EXISTS spc_folios_tenant_booking_idx
  ON spc_folios (tenant_id, booking_id);

CREATE INDEX IF NOT EXISTS spc_folios_tenant_org_status_idx
  ON spc_folios (tenant_id, org_id, status);

-- 72. spc_housekeeping_tasks
CREATE TABLE IF NOT EXISTS spc_housekeeping_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  task_kind TEXT NOT NULL DEFAULT 'CHECKOUT_CLEANING',
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  assigned_to_staff_id TEXT,
  scheduled_for INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  checklist_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'PENDING',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS spc_hk_tasks_tenant_org_status_idx
  ON spc_housekeeping_tasks (tenant_id, org_id, status);

CREATE INDEX IF NOT EXISTS spc_hk_tasks_tenant_unit_idx
  ON spc_housekeeping_tasks (tenant_id, unit_id);

-- 73. lease_applications
CREATE TABLE IF NOT EXISTS lease_applications (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  applicant_party_id TEXT NOT NULL,
  target_unit_id TEXT NOT NULL,
  application_kind TEXT NOT NULL DEFAULT 'NEW_LEASE',
  desired_move_in INTEGER NOT NULL,
  term_months INTEGER NOT NULL DEFAULT 12,
  proposed_rent_minor INTEGER NOT NULL DEFAULT 0,
  screening_score INTEGER,
  steps_timeline_json TEXT NOT NULL DEFAULT '[]',
  co_applicant_json TEXT NOT NULL DEFAULT '{}',
  pet_summary_json TEXT NOT NULL DEFAULT '{}',
  signature_svg TEXT,
  status TEXT NOT NULL DEFAULT 'SUBMITTED',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS lease_apps_tenant_org_status_idx
  ON lease_applications (tenant_id, org_id, status);

CREATE INDEX IF NOT EXISTS lease_apps_tenant_unit_idx
  ON lease_applications (tenant_id, target_unit_id);

CREATE INDEX IF NOT EXISTS lease_apps_tenant_party_idx
  ON lease_applications (tenant_id, applicant_party_id);

-- 74. lease_contracts_and_renewals
CREATE TABLE IF NOT EXISTS lease_contracts_and_renewals (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'active_lease',
  lease_number TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  primary_party_id TEXT NOT NULL,
  occupants_json TEXT NOT NULL DEFAULT '[]',
  start_date INTEGER NOT NULL,
  end_date INTEGER NOT NULL,
  monthly_rent_minor INTEGER NOT NULL DEFAULT 0,
  recurring_breakdown_json TEXT NOT NULL DEFAULT '{}',
  security_deposit_escrow_minor INTEGER NOT NULL DEFAULT 0,
  grace_period_days INTEGER NOT NULL DEFAULT 5,
  late_fee_minor INTEGER NOT NULL DEFAULT 0,
  autopay_enabled INTEGER NOT NULL DEFAULT 0,
  autopay_day_of_month INTEGER,
  split_rent_shares_json TEXT NOT NULL DEFAULT '[]',
  renewal_incentives_json TEXT NOT NULL DEFAULT '{}',
  vacate_notice_json TEXT NOT NULL DEFAULT '{}',
  electronic_signature_svg TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS lease_contracts_tenant_number_uniq
  ON lease_contracts_and_renewals (tenant_id, lease_number);

CREATE INDEX IF NOT EXISTS lease_contracts_tenant_org_status_idx
  ON lease_contracts_and_renewals (tenant_id, org_id, status);

CREATE INDEX IF NOT EXISTS lease_contracts_tenant_unit_idx
  ON lease_contracts_and_renewals (tenant_id, unit_id);

CREATE INDEX IF NOT EXISTS lease_contracts_tenant_party_idx
  ON lease_contracts_and_renewals (tenant_id, primary_party_id);

-- 75. condo_community_hub
CREATE TABLE IF NOT EXISTS condo_community_hub (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  item_kind TEXT NOT NULL DEFAULT 'announcement',
  party_id TEXT,
  unit_id TEXT,
  title TEXT NOT NULL,
  body_or_details_json TEXT NOT NULL DEFAULT '{}',
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  starts_at INTEGER,
  ends_at INTEGER,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS condo_hub_tenant_org_kind_idx
  ON condo_community_hub (tenant_id, org_id, item_kind);

CREATE INDEX IF NOT EXISTS condo_hub_tenant_status_idx
  ON condo_community_hub (tenant_id, status);

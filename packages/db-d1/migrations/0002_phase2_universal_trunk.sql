-- Phase 2 Universal Trunk: Custom Fields + FTS5 + Parties/CRM/HR + Catalog/Pricing (Additive Only)

-- Domain 1 (#11-13): Kernel Custom Fields, Custom Records, Record Locks & FTS5
CREATE TABLE IF NOT EXISTS kernel_custom_field_defs (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  fieldset_code TEXT NOT NULL DEFAULT 'default',
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  data_type TEXT NOT NULL DEFAULT 'text',
  is_required INTEGER NOT NULL DEFAULT 0,
  is_encrypted INTEGER NOT NULL DEFAULT 0,
  is_indexed INTEGER NOT NULL DEFAULT 0,
  virtual_column_name TEXT,
  dictionary_id TEXT,
  validation_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS kernel_cf_defs_tenant_entity_key_uniq
  ON kernel_custom_field_defs (tenant_id, entity_type, field_key);

CREATE INDEX IF NOT EXISTS kernel_cf_defs_tenant_entity_idx
  ON kernel_custom_field_defs (tenant_id, entity_type);

CREATE TABLE IF NOT EXISTS kernel_custom_records (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  entity_slug TEXT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  search_tokens_hash TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS kernel_custom_records_tenant_slug_code_uniq
  ON kernel_custom_records (tenant_id, entity_slug, code);

CREATE INDEX IF NOT EXISTS kernel_custom_records_tenant_org_slug_idx
  ON kernel_custom_records (tenant_id, org_id, entity_slug);

CREATE VIRTUAL TABLE IF NOT EXISTS kernel_custom_records_fts USING fts5(
  tenant_id UNINDEXED,
  org_id UNINDEXED,
  record_id UNINDEXED,
  entity_slug,
  code,
  title,
  search_text
);

CREATE TABLE IF NOT EXISTS kernel_record_locks (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  lock_token TEXT NOT NULL,
  strategy TEXT NOT NULL DEFAULT 'optimistic',
  locked_by_user_id TEXT NOT NULL,
  base_version INTEGER NOT NULL DEFAULT 1,
  heartbeat_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  conflict_payload_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS kernel_record_locks_tenant_resource_uniq
  ON kernel_record_locks (tenant_id, resource_kind, resource_id);

CREATE INDEX IF NOT EXISTS kernel_record_locks_tenant_expires_idx
  ON kernel_record_locks (tenant_id, expires_at);

-- Domain 2 (#15-26): Unified Parties, CRM 360 & HR/Payroll
CREATE TABLE IF NOT EXISTS crm_parties (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  party_kind TEXT NOT NULL DEFAULT 'person',
  roles_mask_json TEXT NOT NULL DEFAULT '["customer"]',
  display_name TEXT NOT NULL,
  legal_name TEXT,
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT,
  second_last_name TEXT,
  nationality TEXT,
  tax_id_type TEXT,
  tax_id_number TEXT,
  tax_id_hash TEXT,
  primary_email TEXT,
  email_hash TEXT,
  primary_phone TEXT,
  secondary_phone TEXT,
  portal_user_id TEXT,
  owner_user_id TEXT,
  lifecycle_stage TEXT NOT NULL DEFAULT 'active',
  lead_source TEXT,
  temperature TEXT,
  vip_status TEXT NOT NULL DEFAULT 'standard',
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  credit_limit_minor INTEGER NOT NULL DEFAULT 0,
  preferred_currency TEXT NOT NULL DEFAULT 'USD',
  payment_terms_code TEXT,
  is_1099_vendor INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS crm_parties_tenant_org_idx
  ON crm_parties (tenant_id, org_id);

CREATE INDEX IF NOT EXISTS crm_parties_tenant_tax_hash_idx
  ON crm_parties (tenant_id, tax_id_hash);

CREATE INDEX IF NOT EXISTS crm_parties_tenant_email_hash_idx
  ON crm_parties (tenant_id, email_hash);

CREATE INDEX IF NOT EXISTS crm_parties_tenant_display_name_idx
  ON crm_parties (tenant_id, display_name);

CREATE TABLE IF NOT EXISTS crm_party_profiles (
  party_id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  birth_date TEXT,
  gender TEXT,
  marital_status TEXT,
  preferred_language TEXT,
  occupation TEXT,
  employer_name TEXT,
  annual_income_minor INTEGER,
  screening_score INTEGER,
  mrn_code TEXT,
  guest_preferences_json TEXT NOT NULL DEFAULT '{}',
  total_stays INTEGER NOT NULL DEFAULT 0,
  total_spent_minor INTEGER NOT NULL DEFAULT 0,
  has_evictions INTEGER NOT NULL DEFAULT 0,
  agreed_credit_check INTEGER NOT NULL DEFAULT 0,
  kyc_verified_at INTEGER,
  kyc_document_urls_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS crm_party_profiles_tenant_mrn_idx
  ON crm_party_profiles (tenant_id, mrn_code);

CREATE TABLE IF NOT EXISTS crm_party_links (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  from_party_id TEXT NOT NULL,
  to_party_id TEXT NOT NULL,
  link_type TEXT NOT NULL,
  role_title TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  can_view_records INTEGER NOT NULL DEFAULT 0,
  can_join_telehealth INTEGER NOT NULL DEFAULT 0,
  share_percentage_bps INTEGER NOT NULL DEFAULT 0,
  commercial_terms_json TEXT NOT NULL DEFAULT '{}',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS crm_party_links_tenant_from_idx
  ON crm_party_links (tenant_id, from_party_id);

CREATE INDEX IF NOT EXISTS crm_party_links_tenant_to_idx
  ON crm_party_links (tenant_id, to_party_id);

CREATE UNIQUE INDEX IF NOT EXISTS crm_party_links_tenant_pair_type_uniq
  ON crm_party_links (tenant_id, from_party_id, to_party_id, link_type);

CREATE TABLE IF NOT EXISTS crm_party_addresses (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  party_id TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'billing',
  label TEXT,
  line1 TEXT NOT NULL,
  line2 TEXT,
  building_no TEXT,
  flat_no TEXT,
  city TEXT NOT NULL,
  state_region TEXT,
  postal_code TEXT,
  country_code TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS crm_party_addresses_tenant_party_idx
  ON crm_party_addresses (tenant_id, party_id);

CREATE TABLE IF NOT EXISTS crm_groups_and_terms (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  parent_id TEXT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  group_kind TEXT NOT NULL DEFAULT 'b2c',
  priority INTEGER NOT NULL DEFAULT 100,
  price_list_id TEXT,
  payment_terms_days INTEGER NOT NULL DEFAULT 0,
  default_credit_limit_minor INTEGER NOT NULL DEFAULT 0,
  max_rep_discount_bps INTEGER NOT NULL DEFAULT 0,
  allow_below_cost INTEGER NOT NULL DEFAULT 0,
  auto_invoice_on_delivery INTEGER NOT NULL DEFAULT 0,
  assortment_scope_json TEXT NOT NULL DEFAULT '{}',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_groups_tenant_code_uniq
  ON crm_groups_and_terms (tenant_id, code);

CREATE INDEX IF NOT EXISTS crm_groups_tenant_org_kind_idx
  ON crm_groups_and_terms (tenant_id, org_id, group_kind);

CREATE TABLE IF NOT EXISTS crm_group_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  party_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  valid_from INTEGER,
  valid_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_group_memberships_tenant_group_party_uniq
  ON crm_group_memberships (tenant_id, group_id, party_id);

CREATE INDEX IF NOT EXISTS crm_group_memberships_tenant_party_idx
  ON crm_group_memberships (tenant_id, party_id);

CREATE TABLE IF NOT EXISTS crm_pipelines_and_stages (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  pipeline_name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  stages_json TEXT NOT NULL DEFAULT '[]',
  stuck_threshold_days INTEGER NOT NULL DEFAULT 14,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS crm_pipelines_tenant_org_idx
  ON crm_pipelines_and_stages (tenant_id, org_id);

CREATE TABLE IF NOT EXISTS crm_deals (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  pipeline_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  party_id TEXT NOT NULL,
  contact_party_id TEXT,
  title TEXT NOT NULL,
  value_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  probability_bps INTEGER NOT NULL DEFAULT 0,
  expected_close_date TEXT,
  owner_user_id TEXT,
  outcome TEXT NOT NULL DEFAULT 'open',
  loss_reason TEXT,
  stage_history_json TEXT NOT NULL DEFAULT '[]',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS crm_deals_tenant_org_outcome_idx
  ON crm_deals (tenant_id, org_id, outcome);

CREATE INDEX IF NOT EXISTS crm_deals_tenant_party_idx
  ON crm_deals (tenant_id, party_id);

CREATE INDEX IF NOT EXISTS crm_deals_tenant_pipeline_stage_idx
  ON crm_deals (tenant_id, pipeline_id, stage_id);

CREATE TABLE IF NOT EXISTS crm_interactions_and_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  party_id TEXT,
  deal_id TEXT,
  case_id TEXT,
  kind TEXT NOT NULL DEFAULT 'note',
  title TEXT NOT NULL,
  body TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  due_at INTEGER,
  scheduled_start INTEGER,
  duration_minutes INTEGER,
  recurrence_rule TEXT,
  owner_user_id TEXT,
  assigned_to_user_id TEXT,
  completed_at INTEGER,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS crm_interactions_tenant_org_status_idx
  ON crm_interactions_and_tasks (tenant_id, org_id, status);

CREATE INDEX IF NOT EXISTS crm_interactions_tenant_party_idx
  ON crm_interactions_and_tasks (tenant_id, party_id);

CREATE INDEX IF NOT EXISTS crm_interactions_tenant_assigned_due_idx
  ON crm_interactions_and_tasks (tenant_id, assigned_to_user_id, due_at);

CREATE TABLE IF NOT EXISTS crm_conflict_checks (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  candidate_party_id TEXT,
  matter_title TEXT NOT NULL,
  searched_terms_json TEXT NOT NULL DEFAULT '[]',
  matched_parties_json TEXT NOT NULL DEFAULT '[]',
  risk_status TEXT NOT NULL DEFAULT 'clear',
  waiver_document_id TEXT,
  reviewed_by_user_id TEXT,
  reviewed_at INTEGER,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS crm_conflict_checks_tenant_org_idx
  ON crm_conflict_checks (tenant_id, org_id);

CREATE INDEX IF NOT EXISTS crm_conflict_checks_tenant_party_idx
  ON crm_conflict_checks (tenant_id, candidate_party_id);

CREATE TABLE IF NOT EXISTS hr_staff_profiles_and_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  employee_number TEXT,
  department_name TEXT,
  job_title TEXT,
  employment_type TEXT,
  specialty TEXT,
  sub_specialty TEXT,
  compensation_type TEXT NOT NULL DEFAULT 'salary',
  base_rate_minor INTEGER NOT NULL DEFAULT 0,
  supervision_rate_minor INTEGER NOT NULL DEFAULT 0,
  indirect_rate_minor INTEGER NOT NULL DEFAULT 0,
  pay_frequency TEXT,
  npi_number TEXT,
  dea_number TEXT,
  bar_or_medical_license TEXT,
  license_state TEXT,
  license_expires_at INTEGER,
  cle_or_cme_credits INTEGER NOT NULL DEFAULT 0,
  oig_sanction_status TEXT,
  availability_ruleset_id TEXT,
  signature_svg_url TEXT,
  direct_deposit_json TEXT NOT NULL DEFAULT '{}',
  hire_date TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS hr_staff_tenant_org_idx
  ON hr_staff_profiles_and_credentials (tenant_id, org_id);

CREATE INDEX IF NOT EXISTS hr_staff_tenant_user_idx
  ON hr_staff_profiles_and_credentials (tenant_id, user_id);

CREATE TABLE IF NOT EXISTS hr_shifts_timesheets_and_payroll (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record_type TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  project_or_case_id TEXT,
  party_id TEXT,
  shift_type TEXT,
  start_at INTEGER,
  end_at INTEGER,
  clock_in_at INTEGER,
  clock_out_at INTEGER,
  break_minutes INTEGER NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  rounded_minutes INTEGER NOT NULL DEFAULT 0,
  is_billable INTEGER NOT NULL DEFAULT 0,
  hourly_rate_minor INTEGER NOT NULL DEFAULT 0,
  mileage_miles INTEGER,
  mileage_reimbursement_minor INTEGER NOT NULL DEFAULT 0,
  gross_pay_minor INTEGER NOT NULL DEFAULT 0,
  deductions_minor INTEGER NOT NULL DEFAULT 0,
  net_pay_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  approved_by_user_id TEXT,
  line_items_json TEXT NOT NULL DEFAULT '[]',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS hr_shifts_tenant_org_type_idx
  ON hr_shifts_timesheets_and_payroll (tenant_id, org_id, record_type);

CREATE INDEX IF NOT EXISTS hr_shifts_tenant_staff_start_idx
  ON hr_shifts_timesheets_and_payroll (tenant_id, staff_id, start_at);

-- Domain 3 (#27-36): Universal Catalog, 5-Layer Pricing, Promotions & Label Batches
CREATE TABLE IF NOT EXISTS cat_categories_and_dictionaries (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'product_category',
  parent_id TEXT,
  tree_path TEXT NOT NULL DEFAULT '/',
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS cat_categories_tenant_kind_code_uniq
  ON cat_categories_and_dictionaries (tenant_id, kind, code);

CREATE INDEX IF NOT EXISTS cat_categories_tenant_org_path_idx
  ON cat_categories_and_dictionaries (tenant_id, org_id, tree_path);

CREATE TABLE IF NOT EXISTS cat_products (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  item_kind TEXT NOT NULL DEFAULT 'physical',
  sku TEXT NOT NULL,
  gtin TEXT,
  mpn TEXT,
  cpt_or_ndc_code TEXT,
  hs_code TEXT,
  name TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  category_id TEXT,
  base_uom TEXT NOT NULL DEFAULT 'UNIT',
  sales_uom TEXT NOT NULL DEFAULT 'UNIT',
  tracking_mode TEXT NOT NULL DEFAULT 'NONE',
  costing_method TEXT NOT NULL DEFAULT 'AVCO',
  removal_strategy TEXT NOT NULL DEFAULT 'FEFO',
  base_price_minor INTEGER NOT NULL DEFAULT 0,
  cost_price_minor INTEGER NOT NULL DEFAULT 0,
  standard_price_minor INTEGER NOT NULL DEFAULT 0,
  primary_currency TEXT NOT NULL DEFAULT 'USD',
  tax_class TEXT NOT NULL DEFAULT 'GENERAL',
  tax_rate_bps INTEGER NOT NULL DEFAULT 0,
  is_fixed_price INTEGER NOT NULL DEFAULT 0,
  weight_grams INTEGER,
  volume_cm3 INTEGER,
  dimensions_json TEXT NOT NULL DEFAULT '{}',
  is_perishable INTEGER NOT NULL DEFAULT 0,
  shelf_life_days INTEGER,
  temp_min_c INTEGER,
  temp_max_c INTEGER,
  requires_prescription INTEGER NOT NULL DEFAULT 0,
  dea_schedule TEXT,
  is_controlled INTEGER NOT NULL DEFAULT 0,
  is_public_in_network INTEGER NOT NULL DEFAULT 0,
  media_urls_json TEXT NOT NULL DEFAULT '[]',
  option_schema_json TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS cat_products_tenant_sku_uniq
  ON cat_products (tenant_id, sku);

CREATE INDEX IF NOT EXISTS cat_products_tenant_org_kind_idx
  ON cat_products (tenant_id, org_id, item_kind);

CREATE INDEX IF NOT EXISTS cat_products_tenant_gtin_idx
  ON cat_products (tenant_id, gtin);

CREATE INDEX IF NOT EXISTS cat_products_tenant_category_idx
  ON cat_products (tenant_id, category_id);

CREATE TABLE IF NOT EXISTS cat_variants_and_presentations (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  barcode TEXT,
  barcode_type TEXT,
  presentation_name TEXT NOT NULL DEFAULT 'UNIDAD',
  uom_factor_micros INTEGER NOT NULL DEFAULT 1000000,
  option_values_json TEXT NOT NULL DEFAULT '{}',
  weight_grams INTEGER,
  override_price_minor INTEGER,
  default_location_id TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS cat_variants_tenant_sku_uniq
  ON cat_variants_and_presentations (tenant_id, sku);

CREATE INDEX IF NOT EXISTS cat_variants_tenant_product_idx
  ON cat_variants_and_presentations (tenant_id, product_id);

CREATE INDEX IF NOT EXISTS cat_variants_tenant_barcode_idx
  ON cat_variants_and_presentations (tenant_id, barcode);

CREATE TABLE IF NOT EXISTS cat_price_lists (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  display_mode TEXT NOT NULL DEFAULT 'excluding_tax',
  tariff_kind TEXT NOT NULL DEFAULT 'retail',
  valid_from INTEGER,
  valid_to INTEGER,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS cat_price_lists_tenant_code_uniq
  ON cat_price_lists (tenant_id, code);

CREATE INDEX IF NOT EXISTS cat_price_lists_tenant_org_kind_idx
  ON cat_price_lists (tenant_id, org_id, tariff_kind);

CREATE TABLE IF NOT EXISTS cat_price_rules (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  price_list_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  target_party_id TEXT,
  target_group_id TEXT,
  channel_id TEXT,
  min_qty INTEGER NOT NULL DEFAULT 1,
  max_qty INTEGER,
  unit_price_minor INTEGER,
  discount_bps INTEGER NOT NULL DEFAULT 0,
  rvu_score_micros INTEGER,
  starts_at INTEGER,
  ends_at INTEGER,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS cat_price_rules_tenant_product_idx
  ON cat_price_rules (tenant_id, product_id);

CREATE INDEX IF NOT EXISTS cat_price_rules_tenant_party_idx
  ON cat_price_rules (tenant_id, target_party_id);

CREATE INDEX IF NOT EXISTS cat_price_rules_tenant_group_idx
  ON cat_price_rules (tenant_id, target_group_id);

CREATE INDEX IF NOT EXISTS cat_price_rules_tenant_list_idx
  ON cat_price_rules (tenant_id, price_list_id);

CREATE TABLE IF NOT EXISTS cat_price_history_omnibus (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  price_minor INTEGER NOT NULL,
  lowest_30d_minor INTEGER NOT NULL,
  change_source TEXT NOT NULL DEFAULT 'manual',
  recorded_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS cat_price_history_tenant_product_rec_idx
  ON cat_price_history_omnibus (tenant_id, product_id, recorded_at);

CREATE TABLE IF NOT EXISTS cat_promotions_and_coupons (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  is_cumulative INTEGER NOT NULL DEFAULT 0,
  max_budget_minor INTEGER,
  consumed_budget_minor INTEGER NOT NULL DEFAULT 0,
  rules_tree_json TEXT NOT NULL DEFAULT '{}',
  benefits_json TEXT NOT NULL DEFAULT '{}',
  coupon_prefix TEXT,
  coupon_code TEXT,
  max_uses INTEGER,
  max_uses_per_party INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  starts_at INTEGER,
  ends_at INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS cat_promotions_tenant_org_active_idx
  ON cat_promotions_and_coupons (tenant_id, org_id, is_active);

CREATE INDEX IF NOT EXISTS cat_promotions_tenant_coupon_idx
  ON cat_promotions_and_coupons (tenant_id, coupon_code);

CREATE TABLE IF NOT EXISTS cat_coupon_usages_and_locks (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  promotion_id TEXT NOT NULL,
  code_string TEXT NOT NULL,
  cart_id TEXT,
  order_id TEXT,
  party_id TEXT,
  discount_applied_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'reserved',
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS cat_coupon_usages_tenant_promo_idx
  ON cat_coupon_usages_and_locks (tenant_id, promotion_id);

CREATE INDEX IF NOT EXISTS cat_coupon_usages_tenant_code_idx
  ON cat_coupon_usages_and_locks (tenant_id, code_string);

CREATE TABLE IF NOT EXISTS cat_currencies_and_rates (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate_micros INTEGER NOT NULL,
  buy_rate_micros INTEGER,
  sell_rate_micros INTEGER,
  source TEXT NOT NULL DEFAULT 'BCV',
  effective_at INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS cat_rates_tenant_pair_eff_idx
  ON cat_currencies_and_rates (tenant_id, from_currency, to_currency, effective_at);

CREATE INDEX IF NOT EXISTS cat_rates_tenant_org_active_idx
  ON cat_currencies_and_rates (tenant_id, org_id, is_active);

CREATE TABLE IF NOT EXISTS cat_label_print_batches (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  template_code TEXT NOT NULL DEFAULT 'THERMAL_28x18',
  rate_micros_snapshot INTEGER NOT NULL,
  secondary_currency TEXT NOT NULL DEFAULT 'VES',
  items_json TEXT NOT NULL DEFAULT '[]',
  printed_by_user_id TEXT NOT NULL,
  printed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS cat_label_batches_tenant_org_printed_idx
  ON cat_label_print_batches (tenant_id, org_id, printed_at);

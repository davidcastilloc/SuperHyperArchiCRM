-- Phase 7: Services, Cases (Legal & Medical EHR/ABA), Finance (GAAP & Trust/IOLTA),
-- Portal & Automation (Domains 8-11: #76-111, skipping #93 fin_accounts; Additive Only)

-- Domain 8: Services, RMA, Legal, PSA & EVV
CREATE TABLE IF NOT EXISTS srv_work_orders (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  ticket_number TEXT NOT NULL,
  order_kind TEXT NOT NULL DEFAULT 'tech_repair',
  party_id TEXT,
  unit_id TEXT,
  common_area_name TEXT,
  category TEXT NOT NULL DEFAULT 'GENERAL',
  device_serial_or_imei TEXT,
  initial_diagnosis TEXT,
  permission_to_enter INTEGER NOT NULL DEFAULT 0,
  has_pets_alert INTEGER NOT NULL DEFAULT 0,
  preferred_time_window TEXT,
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  sla_due_at INTEGER,
  assigned_staff_id TEXT,
  eta_at INTEGER,
  parts_consumed_json TEXT NOT NULL DEFAULT '[]',
  labor_cost_minor INTEGER NOT NULL DEFAULT 0,
  parts_cost_minor INTEGER NOT NULL DEFAULT 0,
  media_urls_json TEXT NOT NULL DEFAULT '[]',
  comments_thread_json TEXT NOT NULL DEFAULT '[]',
  resident_rating_1to5 INTEGER,
  started_at INTEGER,
  completed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'OPEN',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS srv_work_orders_tenant_ticket_uniq ON srv_work_orders (tenant_id, ticket_number);
CREATE INDEX IF NOT EXISTS srv_work_orders_tenant_org_status_idx ON srv_work_orders (tenant_id, org_id, status);
CREATE INDEX IF NOT EXISTS srv_work_orders_tenant_staff_idx ON srv_work_orders (tenant_id, assigned_staff_id);

CREATE TABLE IF NOT EXISTS srv_preventive_schedules (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  fixed_asset_id TEXT,
  unit_id TEXT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'GENERAL',
  frequency_days INTEGER NOT NULL DEFAULT 30,
  checklist_template_json TEXT NOT NULL DEFAULT '[]',
  last_performed_at INTEGER,
  next_due_at INTEGER NOT NULL,
  assigned_staff_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS srv_prev_sched_tenant_org_due_idx ON srv_preventive_schedules (tenant_id, org_id, next_due_at);
CREATE INDEX IF NOT EXISTS srv_prev_sched_tenant_asset_idx ON srv_preventive_schedules (tenant_id, fixed_asset_id);

CREATE TABLE IF NOT EXISTS srv_warranty_claims_rma (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  claim_number TEXT NOT NULL,
  party_id TEXT NOT NULL,
  original_order_id TEXT,
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  sla_due_at INTEGER,
  sla_paused_at INTEGER,
  advance_replacement INTEGER NOT NULL DEFAULT 0,
  return_tracking_number TEXT,
  lines_json TEXT NOT NULL DEFAULT '[]',
  replacement_order_id TEXT,
  credit_memo_id TEXT,
  vendor_recovery_status TEXT NOT NULL DEFAULT 'PENDING',
  vendor_recovered_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'REQUESTED',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS srv_rma_tenant_claim_uniq ON srv_warranty_claims_rma (tenant_id, claim_number);
CREATE INDEX IF NOT EXISTS srv_rma_tenant_org_status_idx ON srv_warranty_claims_rma (tenant_id, org_id, status);
CREATE INDEX IF NOT EXISTS srv_rma_tenant_party_idx ON srv_warranty_claims_rma (tenant_id, party_id);

CREATE TABLE IF NOT EXISTS psa_projects_and_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  party_id TEXT,
  matter_id TEXT,
  budget_kind TEXT NOT NULL DEFAULT 'hours',
  budget_value INTEGER NOT NULL DEFAULT 0,
  hourly_rate_minor INTEGER NOT NULL DEFAULT 0,
  tasks_kanban_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS psa_projects_tenant_code_uniq ON psa_projects_and_tasks (tenant_id, code);
CREATE INDEX IF NOT EXISTS psa_projects_tenant_org_status_idx ON psa_projects_and_tasks (tenant_id, org_id, status);

CREATE TABLE IF NOT EXISTS evv_field_visits (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'field_tech',
  parent_record_id TEXT NOT NULL,
  party_id TEXT,
  staff_id TEXT NOT NULL,
  target_lat_micros INTEGER NOT NULL,
  target_lng_micros INTEGER NOT NULL,
  clock_in_lat_micros INTEGER NOT NULL,
  clock_in_lng_micros INTEGER NOT NULL,
  distance_meters INTEGER NOT NULL DEFAULT 0,
  geofence_compliant INTEGER NOT NULL DEFAULT 0,
  clock_in_at INTEGER NOT NULL,
  clock_out_at INTEGER,
  client_or_caregiver_signature_svg TEXT,
  staff_signature_svg TEXT,
  status TEXT NOT NULL DEFAULT 'CLOCKED_IN',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS evv_visits_tenant_org_status_idx ON evv_field_visits (tenant_id, org_id, status);
CREATE INDEX IF NOT EXISTS evv_visits_tenant_staff_idx ON evv_field_visits (tenant_id, staff_id, clock_in_at);
CREATE INDEX IF NOT EXISTS evv_visits_tenant_parent_idx ON evv_field_visits (tenant_id, parent_record_id);

CREATE TABLE IF NOT EXISTS leg_matters (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  reference_number TEXT NOT NULL,
  client_party_id TEXT NOT NULL,
  lead_lawyer_staff_id TEXT NOT NULL,
  practice_area TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  billing_mode TEXT NOT NULL DEFAULT 'hourly',
  conflict_check_id TEXT,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'OPEN',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS leg_matters_tenant_ref_uniq ON leg_matters (tenant_id, reference_number);
CREATE INDEX IF NOT EXISTS leg_matters_tenant_org_status_idx ON leg_matters (tenant_id, org_id, status);
CREATE INDEX IF NOT EXISTS leg_matters_tenant_client_idx ON leg_matters (tenant_id, client_party_id);

CREATE TABLE IF NOT EXISTS leg_dockets_and_events (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  matter_id TEXT NOT NULL,
  case_number TEXT NOT NULL,
  case_title TEXT NOT NULL,
  court_name TEXT NOT NULL,
  judge_name TEXT,
  filing_status TEXT NOT NULL DEFAULT 'ACTIVE',
  auto_sync_enabled INTEGER NOT NULL DEFAULT 0,
  last_synced_at INTEGER,
  entries_and_deadlines_json TEXT NOT NULL DEFAULT '[]',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS leg_dockets_tenant_matter_idx ON leg_dockets_and_events (tenant_id, matter_id);
CREATE INDEX IF NOT EXISTS leg_dockets_tenant_case_idx ON leg_dockets_and_events (tenant_id, case_number);

CREATE TABLE IF NOT EXISTS leg_time_entries (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  matter_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  entry_date INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  hourly_rate_minor INTEGER NOT NULL DEFAULT 0,
  amount_minor INTEGER NOT NULL DEFAULT 0,
  is_billable INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS leg_time_tenant_matter_idx ON leg_time_entries (tenant_id, matter_id, entry_date);
CREATE INDEX IF NOT EXISTS leg_time_tenant_staff_idx ON leg_time_entries (tenant_id, staff_id);

-- Domain 9: Medical EHR, Therapy/ABA, Supervision & RCM
CREATE TABLE IF NOT EXISTS med_patient_chart_items (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  patient_party_id TEXT NOT NULL,
  item_kind TEXT NOT NULL DEFAULT 'problem_icd10',
  code_icd10_or_cvx TEXT,
  title TEXT NOT NULL,
  severity TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  onset_date INTEGER,
  resolved_date INTEGER,
  lot_number TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  recorded_by_staff_id TEXT NOT NULL,
  verified_by_staff_id TEXT,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS med_chart_tenant_patient_kind_idx ON med_patient_chart_items (tenant_id, patient_party_id, item_kind);

CREATE TABLE IF NOT EXISTS med_encounters_and_vitals (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  patient_party_id TEXT NOT NULL,
  provider_staff_id TEXT NOT NULL,
  appointment_id TEXT,
  unit_room_id TEXT,
  encounter_kind TEXT NOT NULL DEFAULT 'office_visit',
  chief_complaint TEXT,
  vitals_json TEXT NOT NULL DEFAULT '{}',
  ai_scribe_transcript_r2_key TEXT,
  ai_extracted_draft_json TEXT NOT NULL DEFAULT '{}',
  billing_codes_json TEXT NOT NULL DEFAULT '[]',
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  signed_by_staff_id TEXT,
  signed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS med_enc_tenant_patient_idx ON med_encounters_and_vitals (tenant_id, patient_party_id, started_at);
CREATE INDEX IF NOT EXISTS med_enc_tenant_org_status_idx ON med_encounters_and_vitals (tenant_id, org_id, status);

CREATE TABLE IF NOT EXISTS med_clinical_notes (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  encounter_id TEXT NOT NULL,
  patient_party_id TEXT NOT NULL,
  author_staff_id TEXT NOT NULL,
  note_format TEXT NOT NULL DEFAULT 'SOAP',
  specialty TEXT,
  subjective TEXT,
  objective TEXT,
  assessment TEXT,
  plan TEXT,
  structured_sections_json TEXT NOT NULL DEFAULT '{}',
  icd10_codes_json TEXT NOT NULL DEFAULT '[]',
  cpt_codes_json TEXT NOT NULL DEFAULT '[]',
  is_confidential INTEGER NOT NULL DEFAULT 0,
  visible_to_guardian INTEGER NOT NULL DEFAULT 1,
  is_locked INTEGER NOT NULL DEFAULT 0,
  signed_by_staff_id TEXT,
  signed_at INTEGER,
  supervisor_cosigned_by_id TEXT,
  cosigned_at INTEGER,
  amendment_reason TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS med_notes_tenant_encounter_idx ON med_clinical_notes (tenant_id, encounter_id);
CREATE INDEX IF NOT EXISTS med_notes_tenant_patient_idx ON med_clinical_notes (tenant_id, patient_party_id);

CREATE TABLE IF NOT EXISTS med_prescriptions_and_erx (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'prescription_erx',
  patient_party_id TEXT NOT NULL,
  prescriber_staff_id TEXT NOT NULL,
  encounter_id TEXT,
  pharmacy_party_id TEXT,
  medication_name TEXT NOT NULL,
  ndc_code TEXT,
  dosage TEXT NOT NULL,
  sig_instructions TEXT NOT NULL,
  route TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  days_supply INTEGER NOT NULL DEFAULT 30,
  refills_authorized INTEGER NOT NULL DEFAULT 0,
  refills_remaining INTEGER NOT NULL DEFAULT 0,
  is_controlled INTEGER NOT NULL DEFAULT 0,
  dea_schedule TEXT,
  epcs_mfa_verified INTEGER NOT NULL DEFAULT 0,
  transmission_id TEXT,
  barcode_scanned INTEGER NOT NULL DEFAULT 0,
  witnessed_by_staff_id TEXT,
  status TEXT NOT NULL DEFAULT 'ORDERED',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS med_rx_tenant_patient_idx ON med_prescriptions_and_erx (tenant_id, patient_party_id);
CREATE INDEX IF NOT EXISTS med_rx_tenant_org_status_idx ON med_prescriptions_and_erx (tenant_id, org_id, status);

CREATE TABLE IF NOT EXISTS med_labs_and_imaging (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'lab_order',
  order_or_accession_no TEXT NOT NULL,
  patient_party_id TEXT NOT NULL,
  ordering_staff_id TEXT NOT NULL,
  encounter_id TEXT,
  modality_or_category TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'ROUTINE',
  specimen_type TEXT,
  tests_or_body_part_json TEXT NOT NULL DEFAULT '[]',
  result_value TEXT,
  reference_range TEXT,
  abnormal_flag TEXT NOT NULL DEFAULT 'NORMAL',
  dicom_or_report_r2_key TEXT,
  hl7_fhir_payload_json TEXT NOT NULL DEFAULT '{}',
  reviewed_by_staff_id TEXT,
  reviewed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'ORDERED',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS med_labs_tenant_patient_idx ON med_labs_and_imaging (tenant_id, patient_party_id);
CREATE INDEX IF NOT EXISTS med_labs_tenant_accession_idx ON med_labs_and_imaging (tenant_id, order_or_accession_no);

CREATE TABLE IF NOT EXISTS med_referrals_prior_auth_and_hie (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'prior_authorization',
  patient_party_id TEXT NOT NULL,
  referring_staff_id TEXT NOT NULL,
  external_provider_name TEXT,
  external_npi TEXT,
  payer_name TEXT,
  auth_number TEXT,
  cpt_codes_json TEXT NOT NULL DEFAULT '[]',
  units_authorized INTEGER NOT NULL DEFAULT 0,
  units_used INTEGER NOT NULL DEFAULT 0,
  valid_from INTEGER,
  valid_to INTEGER,
  consent_signed INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'SUBMITTED',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS med_ref_tenant_patient_idx ON med_referrals_prior_auth_and_hie (tenant_id, patient_party_id);
CREATE INDEX IF NOT EXISTS med_ref_tenant_org_status_idx ON med_referrals_prior_auth_and_hie (tenant_id, org_id, status);

CREATE TABLE IF NOT EXISTS med_therapy_groups_and_aba (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'aba_trial',
  group_or_session_id TEXT,
  patient_party_id TEXT NOT NULL,
  therapist_staff_id TEXT NOT NULL,
  title_or_behavior TEXT NOT NULL,
  antecedent TEXT,
  consequence TEXT,
  prompt_level TEXT,
  is_correct_trial INTEGER,
  score INTEGER,
  severity_level TEXT,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  occurred_at INTEGER NOT NULL,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS med_aba_tenant_patient_idx ON med_therapy_groups_and_aba (tenant_id, patient_party_id, occurred_at);
CREATE INDEX IF NOT EXISTS med_aba_tenant_session_idx ON med_therapy_groups_and_aba (tenant_id, group_or_session_id);

CREATE TABLE IF NOT EXISTS med_supervision_queue (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  associate_staff_id TEXT NOT NULL,
  supervisor_staff_id TEXT NOT NULL,
  patient_party_id TEXT NOT NULL,
  clinical_note_id TEXT NOT NULL,
  flagged INTEGER NOT NULL DEFAULT 0,
  flag_reason TEXT,
  feedback TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS med_sup_tenant_supervisor_idx ON med_supervision_queue (tenant_id, supervisor_staff_id, status);
CREATE INDEX IF NOT EXISTS med_sup_tenant_note_idx ON med_supervision_queue (tenant_id, clinical_note_id);

CREATE TABLE IF NOT EXISTS med_patient_insurances (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  patient_party_id TEXT NOT NULL,
  payer_party_id TEXT NOT NULL,
  priority_rank INTEGER NOT NULL DEFAULT 1,
  policy_number TEXT NOT NULL,
  group_number TEXT,
  member_id TEXT NOT NULL,
  subscriber_name TEXT NOT NULL,
  subscriber_dob INTEGER,
  relationship TEXT NOT NULL DEFAULT 'self',
  copay_minor INTEGER NOT NULL DEFAULT 0,
  deductible_minor INTEGER NOT NULL DEFAULT 0,
  deductible_met_minor INTEGER NOT NULL DEFAULT 0,
  card_front_r2_key TEXT,
  card_back_r2_key TEXT,
  ocr_confidence_bps INTEGER,
  last_eligibility_271_json TEXT NOT NULL DEFAULT '{}',
  verified_at INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS med_ins_tenant_patient_idx ON med_patient_insurances (tenant_id, patient_party_id, priority_rank);

CREATE TABLE IF NOT EXISTS med_rcm_claims_and_era (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'claim_837',
  claim_or_check_number TEXT NOT NULL,
  patient_party_id TEXT NOT NULL,
  encounter_id TEXT,
  insurance_id TEXT,
  diagnosis_codes_json TEXT NOT NULL DEFAULT '[]',
  claim_lines_json TEXT NOT NULL DEFAULT '[]',
  total_charge_minor INTEGER NOT NULL DEFAULT 0,
  allowed_minor INTEGER NOT NULL DEFAULT 0,
  insurer_paid_minor INTEGER NOT NULL DEFAULT 0,
  patient_responsibility_minor INTEGER NOT NULL DEFAULT 0,
  scrubber_warnings_json TEXT NOT NULL DEFAULT '[]',
  denial_code TEXT,
  appeal_deadline INTEGER,
  raw_edi_r2_key TEXT,
  installments_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'DRAFT',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS med_rcm_tenant_patient_idx ON med_rcm_claims_and_era (tenant_id, patient_party_id);
CREATE INDEX IF NOT EXISTS med_rcm_tenant_org_status_idx ON med_rcm_claims_and_era (tenant_id, org_id, status);

-- Domain 10: Finance GAAP, Treasury & Trust/IOLTA (#94-99)
CREATE TABLE IF NOT EXISTS fin_trust_escrow_ledgers (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  ledger_kind TEXT NOT NULL DEFAULT 'legal_iolta_trust',
  party_id TEXT NOT NULL,
  matter_or_lease_id TEXT NOT NULL,
  bank_account_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  balance_minor INTEGER NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
  transactions_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS fin_trust_tenant_org_kind_idx ON fin_trust_escrow_ledgers (tenant_id, org_id, ledger_kind);
CREATE INDEX IF NOT EXISTS fin_trust_tenant_party_idx ON fin_trust_escrow_ledgers (tenant_id, party_id);
CREATE INDEX IF NOT EXISTS fin_trust_tenant_ref_idx ON fin_trust_escrow_ledgers (tenant_id, matter_or_lease_id);

CREATE TABLE IF NOT EXISTS fin_chart_of_accounts_and_periods (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'gl_account',
  account_code TEXT NOT NULL,
  name TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'asset',
  normal_balance TEXT NOT NULL DEFAULT 'debit',
  parent_id TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  current_balance_minor INTEGER NOT NULL DEFAULT 0,
  fiscal_year INTEGER,
  period_number INTEGER,
  start_date INTEGER,
  end_date INTEGER,
  is_closed INTEGER NOT NULL DEFAULT 0,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS fin_coa_tenant_code_uniq ON fin_chart_of_accounts_and_periods (tenant_id, record_kind, account_code);
CREATE INDEX IF NOT EXISTS fin_coa_tenant_org_class_idx ON fin_chart_of_accounts_and_periods (tenant_id, org_id, classification);

CREATE TABLE IF NOT EXISTS fin_journal_entries (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  entry_number TEXT NOT NULL,
  entry_date INTEGER NOT NULL,
  fiscal_year INTEGER NOT NULL,
  fiscal_period INTEGER NOT NULL,
  source_module TEXT NOT NULL DEFAULT 'finance',
  source_record_id TEXT,
  reference TEXT,
  description TEXT NOT NULL,
  lines_json TEXT NOT NULL DEFAULT '[]',
  total_debit_minor INTEGER NOT NULL DEFAULT 0,
  total_credit_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  posted_by_user_id TEXT,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS fin_je_tenant_number_uniq ON fin_journal_entries (tenant_id, entry_number);
CREATE INDEX IF NOT EXISTS fin_je_tenant_org_period_idx ON fin_journal_entries (tenant_id, org_id, fiscal_year, fiscal_period);
CREATE INDEX IF NOT EXISTS fin_je_tenant_status_idx ON fin_journal_entries (tenant_id, status);

CREATE TABLE IF NOT EXISTS fin_ap_bills_and_expenses (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'vendor_bill',
  bill_or_expense_no TEXT NOT NULL,
  vendor_party_id TEXT,
  category TEXT NOT NULL DEFAULT 'OPERATING',
  currency TEXT NOT NULL DEFAULT 'USD',
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  paid_minor INTEGER NOT NULL DEFAULT 0,
  balance_due_minor INTEGER NOT NULL DEFAULT 0,
  issue_date INTEGER NOT NULL,
  due_date INTEGER,
  recurrence_freq TEXT,
  next_run_date INTEGER,
  is_reimbursable INTEGER NOT NULL DEFAULT 0,
  receipt_r2_key TEXT,
  lines_json TEXT NOT NULL DEFAULT '[]',
  approved_by_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS fin_ap_tenant_no_uniq ON fin_ap_bills_and_expenses (tenant_id, bill_or_expense_no);
CREATE INDEX IF NOT EXISTS fin_ap_tenant_org_status_idx ON fin_ap_bills_and_expenses (tenant_id, org_id, status);

CREATE TABLE IF NOT EXISTS fin_bank_reconciliations (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  financial_account_id TEXT NOT NULL,
  statement_date INTEGER NOT NULL,
  statement_balance_minor INTEGER NOT NULL DEFAULT 0,
  book_balance_minor INTEGER NOT NULL DEFAULT 0,
  difference_minor INTEGER NOT NULL DEFAULT 0,
  matched_tx_ids_json TEXT NOT NULL DEFAULT '[]',
  reconciled_by_user_id TEXT,
  completed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS fin_recon_tenant_acct_idx ON fin_bank_reconciliations (tenant_id, financial_account_id, statement_date);

CREATE TABLE IF NOT EXISTS fin_fixed_assets_and_budgets (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'fixed_asset',
  code_or_tag TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'EQUIPMENT',
  serial_number TEXT,
  acquisition_date INTEGER,
  acquisition_cost_minor INTEGER NOT NULL DEFAULT 0,
  salvage_value_minor INTEGER NOT NULL DEFAULT 0,
  useful_life_months INTEGER NOT NULL DEFAULT 36,
  depreciation_method TEXT NOT NULL DEFAULT 'straight_line',
  accumulated_depreciation_minor INTEGER NOT NULL DEFAULT 0,
  fiscal_year INTEGER,
  monthly_budget_minor_json TEXT NOT NULL DEFAULT '[]',
  actual_spent_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS fin_assets_tenant_code_uniq ON fin_fixed_assets_and_budgets (tenant_id, record_kind, code_or_tag);
CREATE INDEX IF NOT EXISTS fin_assets_tenant_org_status_idx ON fin_fixed_assets_and_budgets (tenant_id, org_id, status);

-- Domain 11: Docs, GDPR Forms, Omnichannel, Automation & AI Proposals
CREATE TABLE IF NOT EXISTS doc_attachments (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  partition_code TEXT NOT NULL DEFAULT 'private_docs',
  entity_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  party_id TEXT,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL DEFAULT 0,
  r2_object_key TEXT NOT NULL,
  sha256_hash TEXT NOT NULL,
  ocr_extracted_text TEXT,
  is_confidential INTEGER NOT NULL DEFAULT 0,
  uploaded_by_user_id TEXT NOT NULL,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS doc_att_tenant_org_conf_idx ON doc_attachments (tenant_id, org_id, is_confidential);
CREATE INDEX IF NOT EXISTS doc_att_tenant_record_idx ON doc_attachments (tenant_id, entity_type, record_id);

CREATE TABLE IF NOT EXISTS doc_collaborative_pages (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  folder_id TEXT,
  title TEXT NOT NULL,
  template_id TEXT,
  yjs_state_r2_key TEXT,
  content_html TEXT,
  version_no INTEGER NOT NULL DEFAULT 1,
  linked_entities_json TEXT NOT NULL DEFAULT '[]',
  shares_acl_json TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS doc_pages_tenant_org_idx ON doc_collaborative_pages (tenant_id, org_id);

CREATE TABLE IF NOT EXISTS doc_forms_and_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'form_submission',
  form_slug TEXT NOT NULL,
  version_no INTEGER NOT NULL DEFAULT 1,
  schema_json TEXT NOT NULL DEFAULT '{}',
  party_id TEXT,
  case_or_encounter_id TEXT,
  answers_encrypted_json TEXT NOT NULL DEFAULT '{}',
  clause_sha256 TEXT,
  signature_svg TEXT,
  signed_by_ip TEXT,
  gdpr_retention_until INTEGER,
  anonymized_at INTEGER,
  status TEXT NOT NULL DEFAULT 'SUBMITTED',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS doc_forms_tenant_slug_idx ON doc_forms_and_submissions (tenant_id, form_slug);
CREATE INDEX IF NOT EXISTS doc_forms_tenant_party_idx ON doc_forms_and_submissions (tenant_id, party_id);

CREATE TABLE IF NOT EXISTS comm_channels (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  provider_key TEXT NOT NULL DEFAULT 'resend',
  visibility TEXT NOT NULL DEFAULT 'shared_org',
  credentials_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS comm_channels_tenant_org_idx ON comm_channels (tenant_id, org_id, provider_key);

CREATE TABLE IF NOT EXISTS comm_threads_and_messages (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  channel_id TEXT,
  thread_kind TEXT NOT NULL DEFAULT 'portal_support',
  subject TEXT,
  party_id TEXT,
  linked_object_ref_json TEXT NOT NULL DEFAULT '{}',
  shared_with_user_ids_json TEXT NOT NULL DEFAULT '[]',
  sender_id TEXT NOT NULL,
  sender_type TEXT NOT NULL DEFAULT 'staff',
  body TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  read_by_json TEXT NOT NULL DEFAULT '[]',
  is_confidential INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS comm_threads_tenant_org_conf_idx ON comm_threads_and_messages (tenant_id, org_id, is_confidential);
CREATE INDEX IF NOT EXISTS comm_threads_tenant_party_idx ON comm_threads_and_messages (tenant_id, party_id, sent_at);

CREATE TABLE IF NOT EXISTS comm_voice_ai_and_calls (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'phone_call_log',
  agent_name TEXT,
  phone_number TEXT NOT NULL,
  voice_model TEXT,
  system_prompt TEXT,
  transfer_number TEXT,
  party_id TEXT,
  direction TEXT NOT NULL DEFAULT 'inbound',
  duration_sec INTEGER NOT NULL DEFAULT 0,
  recording_r2_key TEXT,
  transcript TEXT,
  ai_extracted_intent_json TEXT NOT NULL DEFAULT '{}',
  campaign_leads_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS comm_voice_tenant_org_kind_idx ON comm_voice_ai_and_calls (tenant_id, org_id, record_kind);

CREATE TABLE IF NOT EXISTS comm_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'INFO',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_url TEXT,
  channels_json TEXT NOT NULL DEFAULT '["in_app"]',
  read_at INTEGER,
  actioned_at INTEGER,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS comm_notif_tenant_user_idx ON comm_notifications (tenant_id, recipient_user_id, read_at);

CREATE TABLE IF NOT EXISTS auto_business_rules (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  rule_code TEXT NOT NULL,
  name TEXT NOT NULL,
  rule_kind TEXT NOT NULL DEFAULT 'ACTION',
  entity_type TEXT NOT NULL,
  lifecycle_event TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  condition_ast_json TEXT NOT NULL DEFAULT '{}',
  actions_json TEXT NOT NULL DEFAULT '[]',
  is_enabled INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS auto_rules_tenant_code_uniq ON auto_business_rules (tenant_id, rule_code);
CREATE INDEX IF NOT EXISTS auto_rules_tenant_org_event_idx ON auto_business_rules (tenant_id, org_id, entity_type, lifecycle_event);

CREATE TABLE IF NOT EXISTS auto_workflows (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  workflow_code TEXT NOT NULL,
  version_no INTEGER NOT NULL DEFAULT 1,
  definition_graph_json TEXT NOT NULL DEFAULT '{}',
  event_triggers_json TEXT NOT NULL DEFAULT '[]',
  is_enabled INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS auto_wf_tenant_code_ver_uniq ON auto_workflows (tenant_id, workflow_code, version_no);

CREATE TABLE IF NOT EXISTS auto_workflow_instances_and_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  correlation_key TEXT NOT NULL,
  current_step_id TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  user_tasks_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'running',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS auto_wfi_tenant_wf_status_idx ON auto_workflow_instances_and_tasks (tenant_id, workflow_id, status);
CREATE INDEX IF NOT EXISTS auto_wfi_tenant_corr_idx ON auto_workflow_instances_and_tasks (tenant_id, correlation_key);

CREATE TABLE IF NOT EXISTS auto_inbox_ops (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  channel_id TEXT,
  sender_email_or_handle TEXT NOT NULL,
  subject TEXT NOT NULL,
  raw_body TEXT NOT NULL,
  extracted_intent TEXT,
  extracted_entities_json TEXT NOT NULL DEFAULT '{}',
  proposal_id TEXT,
  status TEXT NOT NULL DEFAULT 'NEW',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS auto_inbox_tenant_org_status_idx ON auto_inbox_ops (tenant_id, org_id, status);

CREATE TABLE IF NOT EXISTS kernel_ai_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'mutation_proposal_card',
  owner_user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  messages_or_email_json TEXT NOT NULL DEFAULT '[]',
  target_command_id TEXT NOT NULL,
  target_record_id TEXT,
  proposed_diff_json TEXT NOT NULL DEFAULT '{}',
  confidence_bps INTEGER NOT NULL DEFAULT 0,
  disposition TEXT NOT NULL DEFAULT 'PENDING',
  resolved_by_user_id TEXT,
  executed_at INTEGER,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_minor INTEGER NOT NULL DEFAULT 0,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS kernel_ai_prop_tenant_org_disp_idx ON kernel_ai_proposals (tenant_id, org_id, disposition);
CREATE INDEX IF NOT EXISTS kernel_ai_prop_tenant_owner_idx ON kernel_ai_proposals (tenant_id, owner_user_id);

CREATE TABLE IF NOT EXISTS int_webhooks_and_sync_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'webhook_endpoint',
  provider_or_url TEXT NOT NULL,
  hmac_secret_enc TEXT,
  subscribed_events_json TEXT NOT NULL DEFAULT '[]',
  cursor_state TEXT,
  field_mapping_json TEXT NOT NULL DEFAULT '{}',
  processed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS int_wh_tenant_org_kind_idx ON int_webhooks_and_sync_jobs (tenant_id, org_id, record_kind);

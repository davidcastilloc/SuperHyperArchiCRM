-- Phase 3: POS Todo-Terreno, Omnichannel Commerce, Double-Entry WMS & fin_accounts (Additive Only)

-- Domain 5 (#45-49) & Domain 10 (#93 fin_accounts)
CREATE TABLE IF NOT EXISTS pos_registers_and_displays (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  device_mode TEXT NOT NULL DEFAULT 'POS_REGISTER',
  default_warehouse_id TEXT,
  printer_config_json TEXT NOT NULL DEFAULT '{}',
  square_terminal_id TEXT,
  fiscal_printer_serial TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_registers_tenant_code_uniq
  ON pos_registers_and_displays (tenant_id, code);

CREATE INDEX IF NOT EXISTS pos_registers_tenant_org_mode_idx
  ON pos_registers_and_displays (tenant_id, org_id, device_mode);

CREATE TABLE IF NOT EXISTS pos_cash_closings (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  shift_id TEXT NOT NULL,
  register_id TEXT NOT NULL,
  cashier_user_id TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER NOT NULL,
  shift_duration_sec INTEGER NOT NULL DEFAULT 0,
  initial_balances_json TEXT NOT NULL DEFAULT '{}',
  expected_balances_json TEXT NOT NULL DEFAULT '{}',
  actual_counted_balances_json TEXT NOT NULL DEFAULT '{}',
  discrepancy_balances_json TEXT NOT NULL DEFAULT '{}',
  sales_by_currency_json TEXT NOT NULL DEFAULT '{}',
  sales_by_method_json TEXT NOT NULL DEFAULT '{}',
  expenses_by_currency_json TEXT NOT NULL DEFAULT '{}',
  top_parties_json TEXT NOT NULL DEFAULT '[]',
  total_tickets INTEGER NOT NULL DEFAULT 0,
  audit_status TEXT NOT NULL DEFAULT 'pending',
  audited_by_user_id TEXT,
  observations TEXT,
  plain_text_report TEXT,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_closings_tenant_shift_uniq
  ON pos_cash_closings (tenant_id, shift_id);

CREATE INDEX IF NOT EXISTS pos_cash_closings_tenant_org_closed_idx
  ON pos_cash_closings (tenant_id, org_id, closed_at);

CREATE INDEX IF NOT EXISTS pos_cash_closings_tenant_register_idx
  ON pos_cash_closings (tenant_id, register_id);

CREATE TABLE IF NOT EXISTS com_channels_and_stores (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  channel_kind TEXT NOT NULL DEFAULT 'pos',
  domain_hostname TEXT,
  theme_branding_json TEXT NOT NULL DEFAULT '{}',
  default_price_list_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS com_channels_tenant_code_uniq
  ON com_channels_and_stores (tenant_id, code);

CREATE INDEX IF NOT EXISTS com_channels_tenant_org_kind_idx
  ON com_channels_and_stores (tenant_id, org_id, channel_kind);

CREATE TABLE IF NOT EXISTS com_carts_and_paylinks (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'cart',
  slug_or_token_hash TEXT,
  party_id TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  tax_mode TEXT NOT NULL DEFAULT 'excluding_tax',
  lines_json TEXT NOT NULL DEFAULT '[]',
  coupon_codes_json TEXT NOT NULL DEFAULT '[]',
  totals_json TEXT NOT NULL DEFAULT '{}',
  merged_into_id TEXT,
  max_completions INTEGER,
  completion_count INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  legal_consents_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  expires_at INTEGER,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS com_carts_tenant_org_kind_idx
  ON com_carts_and_paylinks (tenant_id, org_id, record_kind);

CREATE INDEX IF NOT EXISTS com_carts_tenant_token_idx
  ON com_carts_and_paylinks (tenant_id, slug_or_token_hash);

CREATE INDEX IF NOT EXISTS com_carts_tenant_party_idx
  ON com_carts_and_paylinks (tenant_id, party_id);

CREATE TABLE IF NOT EXISTS com_quotes (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  quote_number TEXT NOT NULL,
  party_id TEXT NOT NULL,
  contact_party_id TEXT,
  channel_id TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  exchange_rate_micros INTEGER NOT NULL DEFAULT 1000000,
  lines_json TEXT NOT NULL DEFAULT '[]',
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  valid_until INTEGER,
  acceptance_token_hash TEXT,
  accepted_at INTEGER,
  converted_order_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS com_quotes_tenant_number_uniq
  ON com_quotes (tenant_id, quote_number);

CREATE INDEX IF NOT EXISTS com_quotes_tenant_org_status_idx
  ON com_quotes (tenant_id, org_id, status);

CREATE INDEX IF NOT EXISTS com_quotes_tenant_party_idx
  ON com_quotes (tenant_id, party_id);

CREATE TABLE IF NOT EXISTS fin_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_kind TEXT NOT NULL DEFAULT 'cash_drawer',
  currency TEXT NOT NULL DEFAULT 'USD',
  bank_name TEXT,
  account_number_masked TEXT,
  gl_account_id TEXT,
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  current_balance_minor INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS fin_accounts_tenant_code_uniq
  ON fin_accounts (tenant_id, code);

CREATE INDEX IF NOT EXISTS fin_accounts_tenant_org_currency_idx
  ON fin_accounts (tenant_id, org_id, currency);

-- Domain 5 (#50-54): Commerce Orders, Lines, Fiscal Invoices, Payments & Returns
CREATE TABLE IF NOT EXISTS com_orders (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  order_kind TEXT NOT NULL DEFAULT 'pos_sale',
  channel_id TEXT,
  shift_id TEXT,
  register_id TEXT,
  party_id TEXT,
  customer_snapshot_json TEXT NOT NULL DEFAULT '{}',
  warehouse_id TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  exchange_rate_micros INTEGER NOT NULL DEFAULT 1000000,
  subtotal_exempt_minor INTEGER NOT NULL DEFAULT 0,
  subtotal_reduced_minor INTEGER NOT NULL DEFAULT 0,
  subtotal_general_minor INTEGER NOT NULL DEFAULT 0,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  tax_general_minor INTEGER NOT NULL DEFAULT 0,
  tax_reduced_minor INTEGER NOT NULL DEFAULT 0,
  withholding_islr_minor INTEGER NOT NULL DEFAULT 0,
  shipping_minor INTEGER NOT NULL DEFAULT 0,
  grand_total_minor INTEGER NOT NULL DEFAULT 0,
  paid_total_minor INTEGER NOT NULL DEFAULT 0,
  change_given_minor INTEGER NOT NULL DEFAULT 0,
  margin_bps INTEGER NOT NULL DEFAULT 0,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  approval_reason TEXT,
  approved_by_user_id TEXT,
  fulfillment_status TEXT NOT NULL DEFAULT 'unfulfilled',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  status TEXT NOT NULL DEFAULT 'open',
  client_mutation_id TEXT,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS com_orders_tenant_number_uniq
  ON com_orders (tenant_id, order_number);

CREATE UNIQUE INDEX IF NOT EXISTS com_orders_tenant_mutation_uniq
  ON com_orders (tenant_id, client_mutation_id);

CREATE INDEX IF NOT EXISTS com_orders_tenant_org_status_idx
  ON com_orders (tenant_id, org_id, status);

CREATE INDEX IF NOT EXISTS com_orders_tenant_party_idx
  ON com_orders (tenant_id, party_id);

CREATE INDEX IF NOT EXISTS com_orders_tenant_shift_idx
  ON com_orders (tenant_id, shift_id);

CREATE TABLE IF NOT EXISTS com_order_lines (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  line_no INTEGER NOT NULL DEFAULT 1,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  presentation_name TEXT NOT NULL DEFAULT 'UNIDAD',
  qty_micros INTEGER NOT NULL DEFAULT 1000000,
  uom TEXT NOT NULL DEFAULT 'UNIT',
  fulfilled_qty_micros INTEGER NOT NULL DEFAULT 0,
  returned_qty_micros INTEGER NOT NULL DEFAULT 0,
  unit_cost_minor INTEGER NOT NULL DEFAULT 0,
  base_price_minor INTEGER NOT NULL DEFAULT 0,
  unit_price_minor INTEGER NOT NULL DEFAULT 0,
  pricing_source_layer TEXT NOT NULL DEFAULT 'BASE_PRICE',
  manual_discount_bps INTEGER NOT NULL DEFAULT 0,
  tax_rate_bps INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  line_total_minor INTEGER NOT NULL DEFAULT 0,
  lot_id TEXT,
  serial_number TEXT,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS com_order_lines_tenant_order_idx
  ON com_order_lines (tenant_id, order_id, line_no);

CREATE INDEX IF NOT EXISTS com_order_lines_tenant_product_idx
  ON com_order_lines (tenant_id, product_id);

CREATE TABLE IF NOT EXISTS com_invoices_and_fiscal (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  order_id TEXT,
  booking_or_lease_id TEXT,
  case_or_encounter_id TEXT,
  party_id TEXT,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  exchange_rate_micros INTEGER NOT NULL DEFAULT 1000000,
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  withholding_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  paid_minor INTEGER NOT NULL DEFAULT 0,
  balance_due_minor INTEGER NOT NULL DEFAULT 0,
  region_pack TEXT NOT NULL DEFAULT 'global',
  fiscal_control_number TEXT,
  dian_cufe_sha384 TEXT,
  sat_cfdi_uuid TEXT,
  fiscal_qr_payload TEXT,
  hka_printer_z_report TEXT,
  is_consolidated_24h INTEGER NOT NULL DEFAULT 0,
  consolidation_closes_at INTEGER,
  pdf_r2_key TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS com_invoices_tenant_number_uniq
  ON com_invoices_and_fiscal (tenant_id, invoice_number);

CREATE INDEX IF NOT EXISTS com_invoices_tenant_org_status_idx
  ON com_invoices_and_fiscal (tenant_id, org_id, status);

CREATE INDEX IF NOT EXISTS com_invoices_tenant_order_idx
  ON com_invoices_and_fiscal (tenant_id, order_id);

CREATE INDEX IF NOT EXISTS com_invoices_tenant_party_idx
  ON com_invoices_and_fiscal (tenant_id, party_id);

CREATE TABLE IF NOT EXISTS com_payments (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  payment_number TEXT NOT NULL,
  order_id TEXT,
  invoice_id TEXT,
  shift_id TEXT,
  party_id TEXT,
  financial_account_id TEXT NOT NULL,
  method_code TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  amount_minor INTEGER NOT NULL,
  exchange_rate_micros INTEGER NOT NULL DEFAULT 1000000,
  reference_number TEXT,
  external_gateway_tx_id TEXT,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'captured',
  paid_at INTEGER NOT NULL,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS com_payments_tenant_number_uniq
  ON com_payments (tenant_id, payment_number);

CREATE UNIQUE INDEX IF NOT EXISTS com_payments_tenant_idem_uniq
  ON com_payments (tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS com_payments_tenant_order_idx
  ON com_payments (tenant_id, order_id);

CREATE INDEX IF NOT EXISTS com_payments_tenant_account_idx
  ON com_payments (tenant_id, financial_account_id);

CREATE TABLE IF NOT EXISTS com_returns_and_credit_memos (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  return_number TEXT NOT NULL,
  original_order_id TEXT NOT NULL,
  invoice_id TEXT,
  party_id TEXT,
  shift_id TEXT,
  return_type TEXT NOT NULL DEFAULT 'partial',
  physical_status TEXT NOT NULL DEFAULT 'pending',
  financial_status TEXT NOT NULL DEFAULT 'pending',
  items_json TEXT NOT NULL DEFAULT '[]',
  refund_currency TEXT NOT NULL DEFAULT 'USD',
  refund_amount_minor INTEGER NOT NULL DEFAULT 0,
  refund_account_id TEXT,
  authorized_by_user_id TEXT,
  status_history_json TEXT NOT NULL DEFAULT '[]',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS com_returns_tenant_number_uniq
  ON com_returns_and_credit_memos (tenant_id, return_number);

CREATE INDEX IF NOT EXISTS com_returns_tenant_order_idx
  ON com_returns_and_credit_memos (tenant_id, original_order_id);

CREATE INDEX IF NOT EXISTS com_returns_tenant_org_status_idx
  ON com_returns_and_credit_memos (tenant_id, org_id, financial_status);

-- Domain 6 (#55-65): Double-Entry WMS, GS1 Lots, Landed Costs & Fleet e-POD
CREATE TABLE IF NOT EXISTS wms_warehouses_and_zones (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  zone_code TEXT,
  zone_kind TEXT NOT NULL DEFAULT 'dry',
  temp_min_c INTEGER,
  temp_max_c INTEGER,
  capacity_volume_cm3 INTEGER,
  capacity_weight_grams INTEGER,
  manager_user_id TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS wms_warehouses_tenant_org_code_idx
  ON wms_warehouses_and_zones (tenant_id, org_id, code);

CREATE INDEX IF NOT EXISTS wms_warehouses_tenant_code_idx
  ON wms_warehouses_and_zones (tenant_id, code);

CREATE TABLE IF NOT EXISTS wms_locations (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  warehouse_id TEXT,
  parent_id TEXT,
  complete_name TEXT NOT NULL,
  barcode TEXT,
  location_kind TEXT NOT NULL DEFAULT 'internal_bin',
  aisle TEXT,
  rack TEXT,
  shelf_level TEXT,
  max_weight_grams INTEGER,
  removal_strategy TEXT NOT NULL DEFAULT 'FEFO',
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS wms_locations_tenant_warehouse_idx
  ON wms_locations (tenant_id, warehouse_id);

CREATE INDEX IF NOT EXISTS wms_locations_tenant_org_kind_idx
  ON wms_locations (tenant_id, org_id, location_kind);

CREATE INDEX IF NOT EXISTS wms_locations_tenant_barcode_idx
  ON wms_locations (tenant_id, barcode);

CREATE TABLE IF NOT EXISTS wms_packages_and_lots (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'lot',
  product_id TEXT,
  variant_id TEXT,
  lot_or_package_code TEXT NOT NULL,
  gs1_raw_barcode TEXT,
  serial_number TEXT,
  manufacture_date TEXT,
  best_before_date TEXT,
  expiration_date TEXT,
  removal_alert_date TEXT,
  current_location_id TEXT,
  weight_grams INTEGER,
  status TEXT NOT NULL DEFAULT 'released',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS wms_packages_lots_tenant_product_idx
  ON wms_packages_and_lots (tenant_id, product_id);

CREATE INDEX IF NOT EXISTS wms_packages_lots_tenant_code_idx
  ON wms_packages_and_lots (tenant_id, lot_or_package_code);

CREATE INDEX IF NOT EXISTS wms_packages_lots_tenant_expiry_idx
  ON wms_packages_and_lots (tenant_id, expiration_date);

CREATE TABLE IF NOT EXISTS wms_pickings (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  picking_number TEXT NOT NULL,
  operation_kind TEXT NOT NULL DEFAULT 'outgoing_ship',
  source_location_id TEXT NOT NULL,
  dest_location_id TEXT NOT NULL,
  order_id TEXT,
  purchase_order_id TEXT,
  backorder_of_picking_id TEXT,
  party_id TEXT,
  scheduled_at INTEGER,
  completed_at INTEGER,
  assigned_to_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS wms_pickings_tenant_number_uniq
  ON wms_pickings (tenant_id, picking_number);

CREATE INDEX IF NOT EXISTS wms_pickings_tenant_org_status_idx
  ON wms_pickings (tenant_id, org_id, status);

CREATE INDEX IF NOT EXISTS wms_pickings_tenant_backorder_idx
  ON wms_pickings (tenant_id, backorder_of_picking_id);

CREATE TABLE IF NOT EXISTS wms_stock_moves (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  picking_id TEXT,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  lot_id TEXT,
  package_id TEXT,
  source_location_id TEXT NOT NULL,
  dest_location_id TEXT NOT NULL,
  uom TEXT NOT NULL DEFAULT 'UNIT',
  demanded_qty_micros INTEGER NOT NULL DEFAULT 0,
  done_qty_micros INTEGER NOT NULL DEFAULT 0,
  unit_cost_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  reason_code TEXT,
  performed_by_user_id TEXT,
  idempotency_key TEXT,
  occurred_at INTEGER NOT NULL,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS wms_stock_moves_tenant_idem_uniq
  ON wms_stock_moves (tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS wms_stock_moves_tenant_picking_idx
  ON wms_stock_moves (tenant_id, picking_id);

CREATE INDEX IF NOT EXISTS wms_stock_moves_tenant_product_occ_idx
  ON wms_stock_moves (tenant_id, product_id, occurred_at);

CREATE TABLE IF NOT EXISTS wms_valuation_and_landed_costs (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'valuation_layer',
  product_id TEXT,
  stock_move_id TEXT,
  picking_ids_json TEXT NOT NULL DEFAULT '[]',
  split_method TEXT,
  qty_micros INTEGER NOT NULL DEFAULT 0,
  unit_cost_minor INTEGER NOT NULL DEFAULT 0,
  total_value_minor INTEGER NOT NULL DEFAULT 0,
  remaining_qty_micros INTEGER NOT NULL DEFAULT 0,
  remaining_value_minor INTEGER NOT NULL DEFAULT 0,
  cost_components_json TEXT NOT NULL DEFAULT '[]',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS wms_valuation_tenant_product_kind_idx
  ON wms_valuation_and_landed_costs (tenant_id, product_id, record_kind);

CREATE INDEX IF NOT EXISTS wms_valuation_tenant_move_idx
  ON wms_valuation_and_landed_costs (tenant_id, stock_move_id);

CREATE TABLE IF NOT EXISTS wms_reordering_and_putaway_rules (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  rule_kind TEXT NOT NULL DEFAULT 'reorder_minmax',
  warehouse_id TEXT NOT NULL,
  product_id TEXT,
  category_id TEXT,
  target_location_id TEXT,
  min_qty_micros INTEGER NOT NULL DEFAULT 0,
  max_qty_micros INTEGER NOT NULL DEFAULT 0,
  multiple_qty_micros INTEGER NOT NULL DEFAULT 1000000,
  lead_time_days INTEGER NOT NULL DEFAULT 0,
  preferred_supplier_party_id TEXT,
  preferred_supplier_did TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS wms_rules_tenant_org_kind_idx
  ON wms_reordering_and_putaway_rules (tenant_id, org_id, rule_kind);

CREATE INDEX IF NOT EXISTS wms_rules_tenant_warehouse_prod_idx
  ON wms_reordering_and_putaway_rules (tenant_id, warehouse_id, product_id);

CREATE TABLE IF NOT EXISTS wms_qc_and_cycle_counts (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'quality_check',
  warehouse_id TEXT NOT NULL,
  location_id TEXT,
  picking_id TEXT,
  product_id TEXT,
  lot_id TEXT,
  abc_class TEXT,
  measured_value INTEGER,
  norm_min INTEGER,
  norm_max INTEGER,
  items_variance_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  evidence_urls_json TEXT NOT NULL DEFAULT '[]',
  inspector_user_id TEXT,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS wms_qc_tenant_org_kind_status_idx
  ON wms_qc_and_cycle_counts (tenant_id, org_id, record_kind, status);

CREATE INDEX IF NOT EXISTS wms_qc_tenant_picking_idx
  ON wms_qc_and_cycle_counts (tenant_id, picking_id);

CREATE TABLE IF NOT EXISTS wms_purchase_orders (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  po_number TEXT NOT NULL,
  supplier_party_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  items_json TEXT NOT NULL DEFAULT '[]',
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  expected_at INTEGER,
  received_at INTEGER,
  ordered_by_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS wms_purchase_orders_tenant_number_uniq
  ON wms_purchase_orders (tenant_id, po_number);

CREATE INDEX IF NOT EXISTS wms_purchase_orders_tenant_org_status_idx
  ON wms_purchase_orders (tenant_id, org_id, status);

CREATE INDEX IF NOT EXISTS wms_purchase_orders_tenant_supplier_idx
  ON wms_purchase_orders (tenant_id, supplier_party_id);

CREATE TABLE IF NOT EXISTS wms_stock_requests_and_chat (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  requesting_org_id TEXT NOT NULL,
  fulfilling_org_id TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  cross_dock_ready INTEGER NOT NULL DEFAULT 0,
  items_json TEXT NOT NULL DEFAULT '[]',
  messages_json TEXT NOT NULL DEFAULT '[]',
  converted_order_id TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS wms_stock_req_tenant_req_org_idx
  ON wms_stock_requests_and_chat (tenant_id, requesting_org_id, status);

CREATE INDEX IF NOT EXISTS wms_stock_req_tenant_ful_org_idx
  ON wms_stock_requests_and_chat (tenant_id, fulfilling_org_id, status);

CREATE TABLE IF NOT EXISTS wms_fleet_and_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'delivery_trip',
  vehicle_code TEXT,
  license_plate TEXT,
  max_pallets INTEGER,
  max_weight_grams INTEGER,
  is_refrigerated INTEGER NOT NULL DEFAULT 0,
  driver_staff_id TEXT,
  order_id TEXT,
  origin_coords_json TEXT NOT NULL DEFAULT '{}',
  dest_coords_json TEXT NOT NULL DEFAULT '{}',
  gps_breadcrumbs_json TEXT NOT NULL DEFAULT '[]',
  departed_at INTEGER,
  arrived_at INTEGER,
  epod_recipient_name TEXT,
  epod_signature_svg TEXT,
  epod_photo_r2_key TEXT,
  epod_lat REAL,
  epod_lng REAL,
  auto_restocked INTEGER NOT NULL DEFAULT 0,
  auto_invoiced INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS wms_fleet_tenant_org_kind_idx
  ON wms_fleet_and_deliveries (tenant_id, org_id, record_kind);

CREATE INDEX IF NOT EXISTS wms_fleet_tenant_vehicle_code_idx
  ON wms_fleet_and_deliveries (tenant_id, vehicle_code);

CREATE INDEX IF NOT EXISTS wms_fleet_tenant_order_idx
  ON wms_fleet_and_deliveries (tenant_id, order_id);

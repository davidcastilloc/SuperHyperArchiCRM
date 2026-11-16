-- Phase 5: Federation Hub Core Schema (Additive SQL only)

CREATE TABLE IF NOT EXISTS hub_nodes (
  did TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  region TEXT NOT NULL,
  city TEXT NOT NULL,
  public_key_jwk TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS hub_nodes_deployment_idx
  ON hub_nodes (deployment_id);

CREATE INDEX IF NOT EXISTS hub_nodes_region_city_idx
  ON hub_nodes (region, city, status);

CREATE TABLE IF NOT EXISTS hub_public_offers (
  id TEXT PRIMARY KEY,
  supplier_did TEXT NOT NULL,
  gtin TEXT NOT NULL,
  supplier_sku TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  city TEXT NOT NULL,
  region TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  min_order_qty INTEGER NOT NULL DEFAULT 1,
  uom_factor_micros INTEGER NOT NULL DEFAULT 1000000,
  available_qty INTEGER NOT NULL DEFAULT 0,
  delivery_hours INTEGER NOT NULL DEFAULT 24,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS hub_public_offers_gtin_idx
  ON hub_public_offers (gtin, is_active, unit_price_minor);

CREATE INDEX IF NOT EXISTS hub_public_offers_supplier_sku_idx
  ON hub_public_offers (supplier_did, supplier_sku);

CREATE INDEX IF NOT EXISTS hub_public_offers_market_idx
  ON hub_public_offers (city, category, is_active);

CREATE TABLE IF NOT EXISTS hub_envelopes_idempotency (
  envelope_id TEXT PRIMARY KEY,
  sender_did TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS hub_envelopes_sender_idx
  ON hub_envelopes_idempotency (sender_did, processed_at);

CREATE TABLE IF NOT EXISTS hub_b2b_orders (
  id TEXT PRIMARY KEY,
  po_number TEXT NOT NULL,
  buyer_did TEXT NOT NULL,
  supplier_did TEXT NOT NULL,
  status TEXT NOT NULL,
  items_json TEXT NOT NULL,
  total_minor INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS hub_b2b_orders_buyer_idx
  ON hub_b2b_orders (buyer_did, updated_at);

CREATE INDEX IF NOT EXISTS hub_b2b_orders_supplier_idx
  ON hub_b2b_orders (supplier_did, updated_at);

CREATE TABLE IF NOT EXISTS hub_inventory_holds (
  hold_id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL,
  buyer_ref TEXT NOT NULL,
  qty INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'HELD'
);

CREATE INDEX IF NOT EXISTS hub_inventory_holds_offer_idx
  ON hub_inventory_holds (offer_id, status, expires_at);

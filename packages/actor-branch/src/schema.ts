/**
 * Canonical 8 hot SQLite tables for BranchInventoryDO (DATA_MODEL.md Domain 4 #37-44).
 */
const HOT_DDL_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS hot_bin_balances (
    product_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    bin_code TEXT NOT NULL,
    lot_id TEXT NOT NULL,
    on_hand_qty INTEGER NOT NULL CHECK (on_hand_qty >= 0),
    reserved_qty INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
    available_qty INTEGER NOT NULL CHECK (available_qty >= 0),
    unit_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_minor >= 0),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (product_id, variant_id, bin_code, lot_id)
  )`,
  `CREATE TABLE IF NOT EXISTS hot_inventory_lots (
    lot_id TEXT PRIMARY KEY NOT NULL,
    product_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    lot_code TEXT NOT NULL,
    serial_number TEXT,
    manufacture_epoch_ms INTEGER,
    expiry_epoch_ms INTEGER,
    quarantine_status TEXT NOT NULL DEFAULT 'RELEASED'
      CHECK (quarantine_status IN ('RELEASED', 'QUARANTINE', 'HOLD', 'REJECTED', 'EXPIRED')),
    received_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS hot_pos_shifts (
    shift_id TEXT PRIMARY KEY NOT NULL,
    register_id TEXT NOT NULL,
    cashier_user_id TEXT NOT NULL,
    cashier_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
    initial_balances_json TEXT NOT NULL,
    sales_by_currency_json TEXT NOT NULL DEFAULT '{}',
    sales_by_method_json TEXT NOT NULL DEFAULT '{}',
    petty_expenses_json TEXT NOT NULL DEFAULT '[]',
    next_ticket_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_ticket_seq >= 1),
    opened_at INTEGER NOT NULL,
    closed_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS hot_space_locks (
    space_id TEXT NOT NULL,
    slot_bucket TEXT NOT NULL,
    lock_kind TEXT NOT NULL
      CHECK (lock_kind IN ('STAY', 'APPOINTMENT', 'AMENITY', 'MAINTENANCE_BLOCK')),
    holder_ref_id TEXT NOT NULL,
    party_name_masked TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'LOCKED'
      CHECK (status IN ('LOCKED', 'CHECKED_IN', 'RELEASED', 'EXPIRED')),
    check_in_ms INTEGER NOT NULL,
    check_out_ms INTEGER NOT NULL,
    expires_at_ms INTEGER,
    PRIMARY KEY (space_id, slot_bucket)
  )`,
  `CREATE TABLE IF NOT EXISTS hot_queue_board (
    queue_entry_id TEXT PRIMARY KEY NOT NULL,
    party_id TEXT NOT NULL,
    display_initials TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    station_or_room TEXT,
    provider_id TEXT,
    status TEXT NOT NULL
      CHECK (status IN ('WAITING', 'CALLED', 'WITH_ASSISTANT', 'IN_SERVICE', 'DONE')),
    check_in_ms INTEGER NOT NULL,
    estimated_wait_min INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS hot_access_passes (
    pass_hash TEXT PRIMARY KEY NOT NULL,
    pass_kind TEXT NOT NULL
      CHECK (pass_kind IN ('DOOR_PIN', 'LOCKER_QR', 'LPR_PLATE', 'VISITOR_PIN')),
    allowed_device_ids_json TEXT NOT NULL DEFAULT '[]',
    subject_label TEXT NOT NULL,
    valid_from_ms INTEGER NOT NULL,
    valid_until_ms INTEGER NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 1,
    uses_count INTEGER NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
    status TEXT NOT NULL DEFAULT 'ACTIVE'
      CHECK (status IN ('ACTIVE', 'REVOKED', 'EXHAUSTED', 'EXPIRED'))
  )`,
  `CREATE TABLE IF NOT EXISTS hot_idempotency_log (
    client_mutation_id TEXT PRIMARY KEY NOT NULL,
    command_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_status INTEGER NOT NULL,
    response_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS hot_outbox (
    seq_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_ms INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_hot_lots_fefo
   ON hot_inventory_lots (
     product_id,
     variant_id,
     quarantine_status,
     COALESCE(expiry_epoch_ms, 9007199254740991),
     received_at,
     lot_id
   )`,
  `CREATE INDEX IF NOT EXISTS idx_hot_lots_product_code
   ON hot_inventory_lots (product_id, variant_id, lot_code)`,
  `CREATE INDEX IF NOT EXISTS idx_hot_bin_balances_lot
   ON hot_bin_balances (lot_id, product_id, variant_id, available_qty)`,
  `CREATE INDEX IF NOT EXISTS idx_hot_bin_balances_product_avail
   ON hot_bin_balances (product_id, variant_id, available_qty, bin_code)`,
  `CREATE INDEX IF NOT EXISTS idx_hot_pos_shifts_register_status
   ON hot_pos_shifts (register_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_hot_outbox_next_attempt
   ON hot_outbox (next_attempt_ms, seq_id)`,
];

/**
 * Idempotently creates all 8 hot SQLite tables and FEFO/bin indexes.
 */
export function ensureHotTables(sql: SqlStorage): void {
  for (const statement of HOT_DDL_STATEMENTS) {
    sql.exec(statement);
  }
}

-- Phase 8: Physical IoT, Smart Locks, QR Lockers & LPR Gates (Domain 12, Additive Only)

-- 1. phy_devices_and_locks
CREATE TABLE IF NOT EXISTS phy_devices_and_locks (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  unit_id TEXT,
  device_code TEXT NOT NULL,
  name TEXT NOT NULL,
  device_kind TEXT NOT NULL DEFAULT 'SMART_DOOR_LOCK',
  vendor_driver TEXT NOT NULL DEFAULT 'smartlock_cloud',
  linked_camera_id TEXT,
  battery_pct INTEGER,
  lock_state TEXT NOT NULL DEFAULT 'LOCKED',
  auto_lock_sec INTEGER NOT NULL DEFAULT 10,
  dual_path_mode INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at INTEGER,
  watchdog_status TEXT NOT NULL DEFAULT 'ONLINE',
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS phy_devices_tenant_code_uniq
  ON phy_devices_and_locks (tenant_id, device_code);

CREATE INDEX IF NOT EXISTS phy_devices_tenant_org_kind_idx
  ON phy_devices_and_locks (tenant_id, org_id, device_kind);

CREATE INDEX IF NOT EXISTS phy_devices_tenant_unit_idx
  ON phy_devices_and_locks (tenant_id, unit_id);

-- 2. phy_access_passes
CREATE TABLE IF NOT EXISTS phy_access_passes (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  unit_id TEXT,
  party_id TEXT,
  booking_or_lease_id TEXT,
  pass_kind TEXT NOT NULL DEFAULT 'VISITOR_TEMP',
  holder_name TEXT NOT NULL,
  license_plate TEXT,
  pin_or_qr_hash TEXT NOT NULL,
  allowed_device_ids_json TEXT NOT NULL DEFAULT '[]',
  valid_from INTEGER NOT NULL,
  valid_until INTEGER NOT NULL,
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  whatsapp_share_text TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS phy_passes_tenant_org_status_idx
  ON phy_access_passes (tenant_id, org_id, status);

CREATE INDEX IF NOT EXISTS phy_passes_tenant_hash_idx
  ON phy_access_passes (tenant_id, pin_or_qr_hash);

CREATE INDEX IF NOT EXISTS phy_passes_tenant_plate_idx
  ON phy_access_passes (tenant_id, license_plate);

-- 3. phy_smart_lockers
CREATE TABLE IF NOT EXISTS phy_smart_lockers (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  device_id TEXT,
  bank_code TEXT NOT NULL,
  compartment_code TEXT NOT NULL,
  compartment_size TEXT NOT NULL DEFAULT 'MEDIUM',
  location_label TEXT,
  door_state TEXT NOT NULL DEFAULT 'CLOSED_LOCKED',
  occupancy_status TEXT NOT NULL DEFAULT 'AVAILABLE',
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS phy_lockers_tenant_bank_comp_uniq
  ON phy_smart_lockers (tenant_id, bank_code, compartment_code);

CREATE INDEX IF NOT EXISTS phy_lockers_tenant_org_occ_idx
  ON phy_smart_lockers (tenant_id, org_id, occupancy_status);

-- 4. phy_locker_reservations
CREATE TABLE IF NOT EXISTS phy_locker_reservations (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  locker_id TEXT NOT NULL,
  unit_id TEXT,
  recipient_party_id TEXT,
  carrier_name TEXT,
  tracking_number TEXT,
  pickup_qr_or_pin_hash TEXT NOT NULL,
  reserved_from INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  picked_up_at INTEGER,
  status TEXT NOT NULL DEFAULT 'RESERVED',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS phy_locker_res_tenant_locker_idx
  ON phy_locker_reservations (tenant_id, locker_id, status);

CREATE INDEX IF NOT EXISTS phy_locker_res_tenant_hash_idx
  ON phy_locker_reservations (tenant_id, pickup_qr_or_pin_hash);

-- 5. phy_lpr_gates
CREATE TABLE IF NOT EXISTS phy_lpr_gates (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  gate_code TEXT NOT NULL,
  name TEXT NOT NULL,
  lane_direction TEXT NOT NULL DEFAULT 'ENTRY',
  camera_device_id TEXT,
  barrier_device_id TEXT,
  whitelist_mode TEXT NOT NULL DEFAULT 'STRICT',
  notify_channel TEXT NOT NULL DEFAULT 'whatsapp',
  notify_target TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS phy_lpr_gates_tenant_code_uniq
  ON phy_lpr_gates (tenant_id, gate_code);

CREATE INDEX IF NOT EXISTS phy_lpr_gates_tenant_org_idx
  ON phy_lpr_gates (tenant_id, org_id, is_active);

-- 6. phy_lpr_plate_events
CREATE TABLE IF NOT EXISTS phy_lpr_plate_events (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  gate_id TEXT NOT NULL,
  pass_id TEXT,
  license_plate TEXT NOT NULL,
  confidence_bps INTEGER NOT NULL DEFAULT 0,
  decision TEXT NOT NULL DEFAULT 'DENIED',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  snapshot_r2_key TEXT,
  doorman_notified INTEGER NOT NULL DEFAULT 0,
  hmac_signature TEXT,
  occurred_at INTEGER NOT NULL,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS phy_lpr_events_tenant_gate_time_idx
  ON phy_lpr_plate_events (tenant_id, gate_id, occurred_at);

CREATE INDEX IF NOT EXISTS phy_lpr_events_tenant_plate_idx
  ON phy_lpr_plate_events (tenant_id, license_plate);

-- 7. phy_media_clips
CREATE TABLE IF NOT EXISTS phy_media_clips (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  camera_device_id TEXT NOT NULL,
  linked_event_id TEXT,
  clip_kind TEXT NOT NULL DEFAULT 'MOTION_EVENT',
  r2_key TEXT NOT NULL,
  sha256_hash TEXT NOT NULL,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  recorded_at INTEGER NOT NULL,
  retention_until INTEGER,
  status TEXT NOT NULL DEFAULT 'SEALED',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS phy_clips_tenant_cam_time_idx
  ON phy_media_clips (tenant_id, camera_device_id, recorded_at);

CREATE INDEX IF NOT EXISTS phy_clips_tenant_hash_idx
  ON phy_media_clips (tenant_id, sha256_hash);

-- 8. phy_tamper_alerts
CREATE TABLE IF NOT EXISTS phy_tamper_alerts (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  alert_kind TEXT NOT NULL DEFAULT 'ENCLOSURE_OPEN',
  severity TEXT NOT NULL DEFAULT 'HIGH',
  description TEXT NOT NULL,
  evidence_clip_id TEXT,
  origin_site_did TEXT,
  acknowledged_by_user_id TEXT,
  acknowledged_at INTEGER,
  occurred_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS phy_tamper_tenant_org_status_idx
  ON phy_tamper_alerts (tenant_id, org_id, status);

CREATE INDEX IF NOT EXISTS phy_tamper_tenant_device_idx
  ON phy_tamper_alerts (tenant_id, device_id);

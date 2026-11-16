import {
  createD1Client,
  wrapD1WithCounter,
  type CountedD1,
  type ShacD1Database,
} from '@shac/db-d1';
import type { ExecutionContext, TenantMarketProfile } from '@shac/kernel';
import migration0001Sql from '../../../db-d1/migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../../../db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import migration0003Sql from '../../../db-d1/migrations/0003_phase3_pos_wms_regional.sql?raw';
import migration0004Sql from '../../../db-d1/migrations/0004_phase6_spaces_leases.sql?raw';
import migration0005Sql from '../../../db-d1/migrations/0005_phase7_services_cases_finance_portal.sql?raw';
import migration0006Sql from '../../../db-d1/migrations/0006_phase8_physical_iot.sql?raw';
import { sha256DigestHex } from '../src/index.js';

const baseTestProfile: TenantMarketProfile = {
  deploymentId: 'dep_p8_physical_test',
  tenantId: 'ten_1',
  editionPreset: 'omni-enterprise',
  regionPack: 've',
  activeModules: ['iam', 'customers', 'spaces', 'physical'],
  vocabulary: {
    partySingular: 'Residente',
    partyPlural: 'Residentes',
    orderSingular: 'Pase',
    branchSingular: 'Garita',
    spaceSingular: 'Unidad',
    caseSingular: 'Alerta',
  },
  currency: {
    baseCurrency: 'USD',
    operatingCurrencies: ['USD', 'VES'],
    rateSource: 'bcv',
    enforceAccountCurrencyMatch: true,
  },
  entitlements: {
    maxBranches: 10,
    maxPosRegisters: 20,
    maxSpacesOrUnits: 100,
    aiCopilotEnabled: true,
    customEntitiesLimit: 25,
  },
  federation: {
    enabled: false,
    nodeDid: 'did:shac:physical-test',
    publishPublicCatalog: false,
    acceptPeerB2BOrders: false,
    consolidateLowStockHours: 24,
    allowedSupplierDids: [],
  },
  updatedAt: '2026-11-16T00:00:00.000Z',
};

async function applySqlScript(db: D1Database, sqlText: string): Promise<void> {
  const statements = sqlText
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await db.prepare(stmt).run();
  }
}

export async function setupPhysicalD1(d1: D1Database): Promise<void> {
  await applySqlScript(d1, migration0001Sql);
  await applySqlScript(d1, migration0002Sql);
  await applySqlScript(d1, migration0003Sql);
  await applySqlScript(d1, migration0004Sql);
  await applySqlScript(d1, migration0005Sql);
  await applySqlScript(d1, migration0006Sql);

  const now = 1763300000;
  const lockerPinHash = await sha256DigestHex('LOCKER-8899');

  await d1.batch([
    d1.prepare(
      `INSERT OR IGNORE INTO iam_tenants (id, slug, name, primary_currency, default_locale, status, created_at, updated_at)
       VALUES ('ten_1', 'ten-1', 'Tenant One', 'USD', 'es-VE', 'active', ?, ?)`,
    ).bind(now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES ('org_1', 'ten_1', NULL, 'org_1', '/org_1', 0, 'hq-1', 'HQ One', 'company', 'UTC', 1, 1, ?, ?)`,
    ).bind(now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES ('org_1_gate', 'ten_1', 'org_1', 'org_1', '/org_1/gate', 1, 'gate-1', 'Main Gate', 'branch', 'UTC', 0, 1, ?, ?)`,
    ).bind(now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO crm_parties (id, tenant_id, org_id, party_kind, display_name, created_at, updated_at)
       VALUES ('party_1', 'ten_1', 'org_1_gate', 'person', 'Elena Visitor', ?, ?)`,
    ).bind(now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO phy_devices_and_locks (id, tenant_id, org_id, device_code, name, device_kind, lock_state, created_at, updated_at)
       VALUES ('dev_lock_1', 'ten_1', 'org_1_gate', 'LOCK-LOBBY-01', 'Lobby Smart Lock', 'SMART_DOOR_LOCK', 'LOCKED', ?, ?)`,
    ).bind(now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO phy_smart_lockers (id, tenant_id, org_id, bank_code, compartment_code, door_state, occupancy_status, created_at, updated_at)
       VALUES ('locker_1', 'ten_1', 'org_1_gate', 'BANK-A', 'A-01', 'CLOSED_LOCKED', 'OCCUPIED', ?, ?)`,
    ).bind(now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO phy_locker_reservations (id, tenant_id, org_id, locker_id, recipient_party_id, pickup_qr_or_pin_hash, reserved_from, expires_at, status, created_at, updated_at)
       VALUES ('lres_1', 'ten_1', 'org_1_gate', 'locker_1', 'party_1', ?, ?, ?, 'RESERVED', ?, ?)`,
    ).bind(lockerPinHash, now - 60, now + 86400, now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO phy_lpr_gates (id, tenant_id, org_id, gate_code, name, lane_direction, notify_channel, notify_target, is_active, created_at, updated_at)
       VALUES ('gate_1', 'ten_1', 'org_1_gate', 'GATE-NORTH-01', 'North Industrial Gate', 'ENTRY', 'whatsapp', '+584140001122', 1, ?, ?)`,
    ).bind(now, now),
  ]);
}

export function makePhysicalCtx(
  rawD1: D1Database,
  overrides?: Partial<Pick<ExecutionContext, 'tenantId' | 'orgId' | 'orgPath'>>,
): {
  ctx: ExecutionContext<ShacD1Database>;
  counted: CountedD1;
} {
  const counted = wrapD1WithCounter(rawD1);
  const tenantId = overrides?.tenantId ?? 'ten_1';
  const orgId = overrides?.orgId ?? 'org_1_gate';
  const orgPath = overrides?.orgPath ?? '/org_1/gate';

  const ctx: ExecutionContext<ShacD1Database> = {
    tenantId,
    orgId,
    orgPath,
    actor: {
      id: `usr_${tenantId}`,
      type: 'staff',
      perms: ['physical.*'],
    },
    profile: { ...baseTestProfile, tenantId },
    db: createD1Client(counted.db),
  };

  return { ctx, counted };
}

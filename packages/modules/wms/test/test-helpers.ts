import { createD1Client, type ShacD1Database } from '@shac/db-d1';
import type { ExecutionContext, TenantMarketProfile } from '@shac/kernel';

function makeWmsProfile(tenantId = 'ten_a'): TenantMarketProfile {
  return {
    deploymentId: 'dep_wms_test',
    tenantId,
    editionPreset: 'distro-wms',
    regionPack: 've',
    activeModules: ['iam', 'customers', 'catalog', 'wms'],
    vocabulary: {
      partySingular: 'Cliente',
      partyPlural: 'Clientes',
      orderSingular: 'Pedido',
      branchSingular: 'Almacén',
      spaceSingular: 'Muelle',
      caseSingular: 'Incidencia',
    },
    currency: {
      baseCurrency: 'USD',
      operatingCurrencies: ['USD', 'VES'],
      rateSource: 'bcv',
      enforceAccountCurrencyMatch: true,
    },
    entitlements: {
      maxBranches: 5,
      maxPosRegisters: 10,
      maxSpacesOrUnits: 10,
      aiCopilotEnabled: true,
      customEntitiesLimit: 10,
    },
    federation: {
      enabled: false,
      nodeDid: 'did:shac:wms-test',
      publishPublicCatalog: false,
      acceptPeerB2BOrders: false,
      consolidateLowStockHours: 0,
      allowedSupplierDids: [],
    },
    updatedAt: '2026-11-16T00:00:00.000Z',
  };
}

export async function applySqlScript(
  db: D1Database,
  sqlText: string,
): Promise<void> {
  const statements = sqlText
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await db.prepare(stmt).run();
  }
}

export async function seedWmsBaseFixtures(db: D1Database): Promise<void> {
  const now = 1_763_000_000;
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO iam_tenants (id, slug, name, primary_currency, default_locale, status, created_at, updated_at)
       VALUES ('ten_a', 'ten-a', 'Tenant A', 'USD', 'es-VE', 'active', ?, ?)`,
    ).bind(now, now),
    db.prepare(
      `INSERT OR IGNORE INTO iam_tenants (id, slug, name, primary_currency, default_locale, status, created_at, updated_at)
       VALUES ('ten_b', 'ten-b', 'Tenant B', 'USD', 'es-VE', 'active', ?, ?)`,
    ).bind(now, now),
    db.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES ('org_a', 'ten_a', NULL, 'org_a', '/org_a', 0, 'hq-a', 'HQ A', 'company', 'UTC', 1, 1, ?, ?)`,
    ).bind(now, now),
    db.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES ('org_a_other', 'ten_a', NULL, 'org_a_other', '/org_a_other', 0, 'other-a', 'Other Branch A', 'branch', 'UTC', 0, 1, ?, ?)`,
    ).bind(now, now),
    db.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES ('org_b', 'ten_b', NULL, 'org_b', '/org_b', 0, 'hq-b', 'HQ B', 'company', 'UTC', 1, 1, ?, ?)`,
    ).bind(now, now),
    db.prepare(
      `INSERT OR IGNORE INTO cat_products (id, tenant_id, org_id, sku, gtin, name, tracking_mode, base_price_minor, cost_price_minor, created_at, updated_at)
       VALUES ('prod_amox', 'ten_a', 'org_a', 'AMOX-500', '07501031311309', 'Amoxicilina 500mg', 'LOT_EXPIRY', 1500, 1000, ?, ?)`,
    ).bind(now, now),
    db.prepare(
      `INSERT OR IGNORE INTO cat_products (id, tenant_id, org_id, sku, name, tracking_mode, base_price_minor, cost_price_minor, created_at, updated_at)
       VALUES ('prod_p2', 'ten_a', 'org_a', 'IBU-400', 'Ibuprofeno 400mg', 'LOT_EXPIRY', 900, 500, ?, ?)`,
    ).bind(now, now),
    db.prepare(
      `INSERT OR IGNORE INTO cat_products (id, tenant_id, org_id, sku, name, tracking_mode, base_price_minor, cost_price_minor, created_at, updated_at)
       VALUES ('prod_p3', 'ten_a', 'org_a', 'PARA-500', 'Paracetamol 500mg', 'LOT_EXPIRY', 700, 400, ?, ?)`,
    ).bind(now, now),
    db.prepare(
      `INSERT OR IGNORE INTO cat_products (id, tenant_id, org_id, sku, name, tracking_mode, base_price_minor, cost_price_minor, created_at, updated_at)
       VALUES ('prod_b', 'ten_b', 'org_b', 'TENB-01', 'Tenant B SKU', 'NONE', 1000, 600, ?, ?)`,
    ).bind(now, now),
    db.prepare(
      `INSERT OR IGNORE INTO wms_locations (id, tenant_id, org_id, complete_name, location_kind, created_at, updated_at)
       VALUES ('loc_vendor', 'ten_a', 'org_a', 'Partners/Vendors', 'vendor', ?, ?)`,
    ).bind(now, now),
    db.prepare(
      `INSERT OR IGNORE INTO wms_locations (id, tenant_id, org_id, complete_name, location_kind, created_at, updated_at)
       VALUES ('loc_bin_main', 'ten_a', 'org_a', 'WH1/Stock/MAIN', 'internal_bin', ?, ?)`,
    ).bind(now, now),
    db.prepare(
      `INSERT OR IGNORE INTO wms_locations (id, tenant_id, org_id, complete_name, location_kind, created_at, updated_at)
       VALUES ('loc_customer', 'ten_a', 'org_a', 'Partners/Customers', 'customer', ?, ?)`,
    ).bind(now, now),
    db.prepare(
      `INSERT OR IGNORE INTO wms_locations (id, tenant_id, org_id, complete_name, location_kind, created_at, updated_at)
       VALUES ('loc_b_main', 'ten_b', 'org_b', 'WHB/Stock/MAIN', 'internal_bin', ?, ?)`,
    ).bind(now, now),
    db.prepare(
      `INSERT OR IGNORE INTO wms_fleet_and_deliveries (id, tenant_id, org_id, record_kind, vehicle_code, license_plate, max_pallets, max_weight_grams, is_refrigerated, status, created_at, updated_at)
       VALUES ('veh_dry', 'ten_a', 'org_a', 'vehicle', 'VAN-01', 'ABC-123', 2, 5000, 0, 'available', ?, ?)`,
    ).bind(now, now),
    db.prepare(
      `INSERT OR IGNORE INTO wms_fleet_and_deliveries (id, tenant_id, org_id, record_kind, vehicle_code, license_plate, max_pallets, max_weight_grams, is_refrigerated, status, created_at, updated_at)
       VALUES ('veh_cold', 'ten_a', 'org_a', 'vehicle', 'COLD-01', 'FRZ-999', 6, 25000, 1, 'available', ?, ?)`,
    ).bind(now, now),
  ]);
}

export function makeWmsCtx(
  d1: D1Database,
  overrides?: Partial<ExecutionContext<ShacD1Database>>,
): ExecutionContext<ShacD1Database> {
  const tenantId = overrides?.tenantId ?? 'ten_a';
  return {
    tenantId,
    orgId: overrides?.orgId ?? (tenantId === 'ten_b' ? 'org_b' : 'org_a'),
    orgPath: overrides?.orgPath ?? (tenantId === 'ten_b' ? '/org_b' : '/org_a'),
    actor: overrides?.actor ?? {
      id: 'usr_wms_1',
      type: 'staff',
      perms: ['wms.*'],
    },
    profile: overrides?.profile ?? makeWmsProfile(tenantId),
    db: createD1Client(d1),
    branchDo: overrides?.branchDo,
  };
}

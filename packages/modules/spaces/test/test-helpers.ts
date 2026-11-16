import {
  createD1Client,
  spcUnitTypes,
  spcUnits,
  type ShacD1Database,
} from '@shac/db-d1';
import type { ExecutionContext, TenantMarketProfile } from '@shac/kernel';
import { createWorkerdBranchResolver } from './test-worker.js';

export function makeSpacesProfile(tenantId = 'ten_a'): TenantMarketProfile {
  return {
    deploymentId: 'dep_spaces_test',
    tenantId,
    editionPreset: 'hospitality-pms',
    regionPack: 've',
    activeModules: ['iam', 'customers', 'spaces', 'pos', 'regional'],
    vocabulary: {
      partySingular: 'Huésped',
      partyPlural: 'Huéspedes',
      orderSingular: 'Reserva',
      branchSingular: 'Hotel',
      spaceSingular: 'Habitación',
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
      maxSpacesOrUnits: 50,
      aiCopilotEnabled: true,
      customEntitiesLimit: 10,
    },
    federation: {
      enabled: false,
      nodeDid: 'did:shac:test',
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

export async function seedTenantsAndSpacesFixtures(
  d1: D1Database,
  nowSec: number,
): Promise<void> {
  await d1.batch([
    d1.prepare(
      `INSERT OR IGNORE INTO iam_tenants (id, slug, name, primary_currency, default_locale, status, created_at, updated_at)
       VALUES ('ten_a', 'ten-a', 'Hotel Turpial A', 'USD', 'es-VE', 'active', ?, ?)`,
    ).bind(nowSec, nowSec),
    d1.prepare(
      `INSERT OR IGNORE INTO iam_tenants (id, slug, name, primary_currency, default_locale, status, created_at, updated_at)
       VALUES ('ten_b', 'ten-b', 'Hotel B', 'USD', 'es-VE', 'active', ?, ?)`,
    ).bind(nowSec, nowSec),
    d1.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES ('org_a', 'ten_a', NULL, 'org_a', '/org_a', 0, 'hq-a', 'Hotel Turpial Caracas', 'branch', 'America/Caracas', 1, 1, ?, ?)`,
    ).bind(nowSec, nowSec),
    d1.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES ('org_b', 'ten_b', NULL, 'org_b', '/org_b', 0, 'hq-b', 'Hotel B', 'branch', 'UTC', 1, 1, ?, ?)`,
    ).bind(nowSec, nowSec),
    d1.prepare(
      `INSERT OR IGNORE INTO crm_parties (id, tenant_id, org_id, party_kind, display_name, legal_name, tax_id_type, tax_id_number, is_active, created_at, updated_at)
       VALUES ('pty_guest_1', 'ten_a', 'org_a', 'person', 'Maria Perez', 'Maria Perez', 'V', '12345678', 1, ?, ?)`,
    ).bind(nowSec, nowSec),
    d1.prepare(
      `INSERT OR IGNORE INTO crm_parties (id, tenant_id, org_id, party_kind, display_name, legal_name, tax_id_type, tax_id_number, is_active, created_at, updated_at)
       VALUES ('pty_guest_b', 'ten_b', 'org_b', 'person', 'Guest B', 'Guest B', 'V', '87654321', 1, ?, ?)`,
    ).bind(nowSec, nowSec),
  ]);

  const db = createD1Client(d1);
  await db.batch([
    db.insert(spcUnitTypes).values([
      {
        id: 'ut_suite_a',
        tenantId: 'ten_a',
        orgId: 'org_a',
        code: 'SUITE-DLX',
        name: 'Suite Deluxe',
        spaceCategory: 'hotel_room',
        maxOccupancy: 3,
        baseRateMinor: 15_000,
        ratePeriod: 'night',
        createdAt: nowSec,
        updatedAt: nowSec,
      },
      {
        id: 'ut_suite_b',
        tenantId: 'ten_b',
        orgId: 'org_b',
        code: 'SUITE-B',
        name: 'Suite B',
        spaceCategory: 'hotel_room',
        maxOccupancy: 2,
        baseRateMinor: 12_000,
        ratePeriod: 'night',
        createdAt: nowSec,
        updatedAt: nowSec,
      },
    ]),
    db.insert(spcUnits).values([
      {
        id: 'unit_304',
        tenantId: 'ten_a',
        orgId: 'org_a',
        unitTypeId: 'ut_suite_a',
        unitNumber: '304',
        floorLabel: 'Piso 3',
        currentStatus: 'AVAILABLE',
        createdAt: nowSec,
        updatedAt: nowSec,
      },
      {
        id: 'unit_305',
        tenantId: 'ten_a',
        orgId: 'org_a',
        unitTypeId: 'ut_suite_a',
        unitNumber: '305',
        floorLabel: 'Piso 3',
        currentStatus: 'AVAILABLE',
        createdAt: nowSec,
        updatedAt: nowSec,
      },
      {
        id: 'unit_b1',
        tenantId: 'ten_b',
        orgId: 'org_b',
        unitTypeId: 'ut_suite_b',
        unitNumber: 'B-101',
        floorLabel: 'Piso 1',
        currentStatus: 'AVAILABLE',
        createdAt: nowSec,
        updatedAt: nowSec,
      },
    ]),
  ]);
}

export function makeSpacesCtx(
  d1: D1Database,
  branchDoNs: DurableObjectNamespace<
    import('./test-worker.js').BranchInventoryDO
  >,
  overrides?: Partial<ExecutionContext<ShacD1Database>>,
): ExecutionContext<ShacD1Database> {
  const tenantId = overrides?.tenantId ?? 'ten_a';
  return {
    tenantId,
    orgId: overrides?.orgId ?? (tenantId === 'ten_b' ? 'org_b' : 'org_a'),
    orgPath: overrides?.orgPath ?? (tenantId === 'ten_b' ? '/org_b' : '/org_a'),
    actor: overrides?.actor ?? {
      id: 'usr_frontdesk_1',
      type: 'staff',
      perms: ['spaces.*'],
    },
    profile: overrides?.profile ?? makeSpacesProfile(tenantId),
    db: createD1Client(d1),
    branchDo: overrides?.branchDo ?? createWorkerdBranchResolver(branchDoNs),
  };
}

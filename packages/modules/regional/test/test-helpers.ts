import {
  comOrders,
  createD1Client,
  crmParties,
  type ShacD1Database,
} from '@shac/db-d1';
import type {
  ExecutionContext,
  RegionPackId,
  TenantMarketProfile,
} from '@shac/kernel';

function makeRegionalProfile(
  tenantId = 'ten_a',
  regionPack: RegionPackId = 've',
): TenantMarketProfile {
  return {
    deploymentId: 'dep_reg_test',
    tenantId,
    editionPreset: 'retail-pos',
    regionPack,
    activeModules: ['iam', 'customers', 'catalog', 'pos', 'regional'],
    vocabulary: {
      partySingular: 'Cliente',
      partyPlural: 'Clientes',
      orderSingular: 'Venta',
      branchSingular: 'Sucursal',
      spaceSingular: 'Caja',
      caseSingular: 'Caso',
    },
    currency: {
      baseCurrency: 'USD',
      operatingCurrencies: ['USD', 'VES', 'COP', 'MXN'],
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

export async function seedRegionalTenantsAndRefs(db: D1Database): Promise<void> {
  const now = 1_763_300_000;
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO iam_tenants (id, slug, name, primary_currency, default_locale, status, created_at, updated_at)
       VALUES ('ten_a', 'ten-a', 'Tenant A', 'USD', 'es-VE', 'active', ${now}, ${now})`,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO iam_tenants (id, slug, name, primary_currency, default_locale, status, created_at, updated_at)
       VALUES ('ten_b', 'ten-b', 'Tenant B', 'USD', 'es-CO', 'active', ${now}, ${now})`,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES ('org_a', 'ten_a', NULL, 'org_a', '/org_a', 0, 'hq-a', 'HQ A', 'company', 'UTC', 1, 1, ${now}, ${now})`,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES ('org_a_other', 'ten_a', NULL, 'org_a_other', '/org_a_other', 0, 'other-a', 'Other Branch A', 'branch', 'UTC', 0, 1, ${now}, ${now})`,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES ('org_b', 'ten_b', NULL, 'org_b', '/org_b', 0, 'hq-b', 'HQ B', 'company', 'UTC', 1, 1, ${now}, ${now})`,
    ),
  ]);

  const client = createD1Client(db);
  await client.batch([
    client.insert(crmParties).values([
      {
        id: 'pty_a',
        tenantId: 'ten_a',
        orgId: 'org_a',
        partyKind: 'company',
        rolesMaskJson: '["customer"]',
        displayName: 'Cliente A',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'pty_a_other',
        tenantId: 'ten_a',
        orgId: 'org_a_other',
        partyKind: 'company',
        rolesMaskJson: '["customer"]',
        displayName: 'Cliente Otra Sucursal A',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'pty_b',
        tenantId: 'ten_b',
        orgId: 'org_b',
        partyKind: 'company',
        rolesMaskJson: '["customer"]',
        displayName: 'Cliente Tenant B',
        createdAt: now,
        updatedAt: now,
      },
    ]).onConflictDoNothing(),
    client.insert(comOrders).values({
      id: 'ord_b',
      tenantId: 'ten_b',
      orgId: 'org_b',
      orderNumber: 'ORD-B-1',
      grandTotalMinor: 5000,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing(),
  ]);
}

export function makeRegionalCtx(
  d1: D1Database,
  overrides?: Partial<ExecutionContext<ShacD1Database>> & {
    regionPack?: RegionPackId;
  },
): ExecutionContext<ShacD1Database> {
  const tenantId = overrides?.tenantId ?? 'ten_a';
  return {
    tenantId,
    orgId: overrides?.orgId ?? (tenantId === 'ten_b' ? 'org_b' : 'org_a'),
    orgPath: overrides?.orgPath ?? (tenantId === 'ten_b' ? '/org_b' : '/org_a'),
    actor: overrides?.actor ?? {
      id: 'usr_reg_1',
      type: 'staff',
      perms: ['regional.*'],
    },
    profile:
      overrides?.profile ??
      makeRegionalProfile(tenantId, overrides?.regionPack ?? 've'),
    db: createD1Client(d1),
  };
}

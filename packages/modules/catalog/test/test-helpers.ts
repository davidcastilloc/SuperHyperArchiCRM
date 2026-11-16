import {
  catPriceLists,
  catPriceRules,
  createD1Client,
  crmGroupMemberships,
  crmGroupsAndTerms,
  type ShacD1Database,
} from '@shac/db-d1';
import type { ExecutionContext, TenantMarketProfile } from '@shac/kernel';

function makeProfile(tenantId = 'ten_a'): TenantMarketProfile {
  return {
    deploymentId: 'dep_cat_test',
    tenantId,
    editionPreset: 'retail-pos',
    regionPack: 've',
    activeModules: ['iam', 'customers', 'catalog'],
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

export async function seedTenantsAndOrgs(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO iam_tenants (id, slug, name, primary_currency, default_locale, status, created_at, updated_at)
       VALUES ('ten_a', 'ten-a', 'Tenant A', 'USD', 'es-VE', 'active', 1700000000, 1700000000)`,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO iam_tenants (id, slug, name, primary_currency, default_locale, status, created_at, updated_at)
       VALUES ('ten_b', 'ten-b', 'Tenant B', 'USD', 'es-VE', 'active', 1700000000, 1700000000)`,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES ('org_a', 'ten_a', NULL, 'org_a', '/org_a', 0, 'hq-a', 'HQ A', 'company', 'UTC', 1, 1, 1700000000, 1700000000)`,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES ('org_a_other', 'ten_a', NULL, 'org_a_other', '/org_a_other', 0, 'other-a', 'Other Branch A', 'branch', 'UTC', 0, 1, 1700000000, 1700000000)`,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES ('org_b', 'ten_b', NULL, 'org_b', '/org_b', 0, 'hq-b', 'HQ B', 'company', 'UTC', 1, 1, 1700000000, 1700000000)`,
    ),
  ]);
}

export function makeCatalogCtx(
  d1: D1Database,
  overrides?: Partial<ExecutionContext<ShacD1Database>>,
): ExecutionContext<ShacD1Database> {
  const tenantId = overrides?.tenantId ?? 'ten_a';
  return {
    tenantId,
    orgId: overrides?.orgId ?? (tenantId === 'ten_b' ? 'org_b' : 'org_a'),
    orgPath: overrides?.orgPath ?? (tenantId === 'ten_b' ? '/org_b' : '/org_a'),
    actor: overrides?.actor ?? {
      id: 'usr_cat_1',
      type: 'staff',
      perms: ['catalog.*'],
    },
    profile: overrides?.profile ?? makeProfile(tenantId),
    db: createD1Client(d1),
  };
}

export async function seedFiveLayerPricingFixture(
  db: ShacD1Database,
  productId: string,
  nowSec: number,
): Promise<void> {
  await db.batch([
    db.insert(catPriceLists).values([
      {
        id: 'pl_promo',
        tenantId: 'ten_a',
        orgId: 'org_a',
        code: 'PROMO_POS',
        name: 'Promo POS',
        currency: 'USD',
        tariffKind: 'promotion',
        createdAt: nowSec,
        updatedAt: nowSec,
      },
      {
        id: 'pl_b2b',
        tenantId: 'ten_a',
        orgId: 'org_a',
        code: 'B2B',
        name: 'Mayorista B2B',
        currency: 'USD',
        tariffKind: 'wholesale',
        createdAt: nowSec,
        updatedAt: nowSec,
      },
      {
        id: 'pl_vip',
        tenantId: 'ten_a',
        orgId: 'org_a',
        code: 'VIP_1TO1',
        name: 'Contrato VIP',
        currency: 'USD',
        tariffKind: 'contract_1to1',
        createdAt: nowSec,
        updatedAt: nowSec,
      },
    ]),
    db.insert(crmGroupsAndTerms).values([
      {
        id: 'grp_b2b_std',
        tenantId: 'ten_a',
        orgId: 'org_a',
        code: 'B2B_STD',
        name: 'Distribuidores',
        groupKind: 'b2b',
        priceListId: 'pl_b2b',
        allowBelowCost: false,
        createdAt: nowSec,
        updatedAt: nowSec,
      },
      {
        id: 'grp_loss_ok',
        tenantId: 'ten_a',
        orgId: 'org_a',
        code: 'LOSS_OK',
        name: 'Liquidacion Autorizada',
        groupKind: 'corporate',
        allowBelowCost: true,
        createdAt: nowSec,
        updatedAt: nowSec,
      },
    ]),
    db.insert(crmGroupMemberships).values([
      {
        id: 'mem_b2b',
        tenantId: 'ten_a',
        groupId: 'grp_b2b_std',
        partyId: 'pty_b2b',
        createdAt: nowSec,
        updatedAt: nowSec,
      },
      {
        id: 'mem_loss',
        tenantId: 'ten_a',
        groupId: 'grp_loss_ok',
        partyId: 'pty_liq',
        createdAt: nowSec,
        updatedAt: nowSec,
      },
    ]),
    db.insert(catPriceRules).values([
      {
        id: 'rule_promo',
        tenantId: 'ten_a',
        orgId: 'org_a',
        priceListId: 'pl_promo',
        productId,
        channelId: 'pos',
        unitPriceMinor: 1350,
        createdAt: nowSec,
        updatedAt: nowSec,
      },
      {
        id: 'rule_b2b',
        tenantId: 'ten_a',
        orgId: 'org_a',
        priceListId: 'pl_b2b',
        productId,
        targetGroupId: 'grp_b2b_std',
        unitPriceMinor: 1250,
        createdAt: nowSec,
        updatedAt: nowSec,
      },
      {
        id: 'rule_1to1',
        tenantId: 'ten_a',
        orgId: 'org_a',
        priceListId: 'pl_vip',
        productId,
        targetPartyId: 'pty_vip',
        unitPriceMinor: 1150,
        createdAt: nowSec,
        updatedAt: nowSec,
      },
      {
        id: 'rule_below_cost',
        tenantId: 'ten_a',
        orgId: 'org_a',
        priceListId: 'pl_vip',
        productId,
        targetPartyId: 'pty_liq',
        unitPriceMinor: 800,
        createdAt: nowSec,
        updatedAt: nowSec,
      },
    ]),
  ]);
}

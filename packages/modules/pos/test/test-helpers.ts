import {
  catCurrenciesAndRates,
  catProducts,
  catVariantsAndPresentations,
  createD1Client,
  finAccounts,
  type ShacD1Database,
} from '@shac/db-d1';
import type { ExecutionContext, TenantMarketProfile } from '@shac/kernel';
import { createWorkerdBranchResolver } from './test-worker.js';

const DAY_MS = 86_400_000;

function makePosProfile(tenantId = 'ten_a'): TenantMarketProfile {
  return {
    deploymentId: 'dep_pos_test',
    tenantId,
    editionPreset: 'retail-pos',
    regionPack: 've',
    activeModules: ['iam', 'customers', 'catalog', 'pos', 'wms', 'regional'],
    vocabulary: {
      partySingular: 'Cliente',
      partyPlural: 'Clientes',
      orderSingular: 'Ticket',
      branchSingular: 'Sucursal',
      spaceSingular: 'Caja',
      caseSingular: 'Reclamo',
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

export function makePosCtx(
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
      id: 'usr_cashier_1',
      type: 'staff',
      perms: ['pos.*'],
    },
    profile: overrides?.profile ?? makePosProfile(tenantId),
    db: createD1Client(d1),
    branchDo: overrides?.branchDo ?? createWorkerdBranchResolver(branchDoNs),
  };
}

export async function seedPosFixtures(
  d1: D1Database,
  nowSec: number,
): Promise<void> {
  const db = createD1Client(d1);
  await db.batch([
    db.insert(finAccounts).values([
      {
        id: 'acc_usd_cash',
        tenantId: 'ten_a',
        orgId: 'org_a',
        code: 'CAJA_USD_1',
        name: 'Caja Efectivo USD',
        accountKind: 'cash_drawer',
        currency: 'USD',
        openingBalanceMinor: 10_000,
        currentBalanceMinor: 10_000,
        isDefault: true,
        isActive: true,
        createdAt: nowSec,
        updatedAt: nowSec,
      },
      {
        id: 'acc_ves_pm',
        tenantId: 'ten_a',
        orgId: 'org_a',
        code: 'PM_VES_1',
        name: 'Pago Movil Banco VES',
        accountKind: 'digital_wallet',
        currency: 'VES',
        openingBalanceMinor: 500_000,
        currentBalanceMinor: 500_000,
        isDefault: false,
        isActive: true,
        createdAt: nowSec,
        updatedAt: nowSec,
      },
      {
        id: 'acc_org_other_usd',
        tenantId: 'ten_a',
        orgId: 'org_a_other',
        code: 'OTHER_USD',
        name: 'Otra Sucursal USD',
        accountKind: 'cash_drawer',
        currency: 'USD',
        openingBalanceMinor: 5000,
        currentBalanceMinor: 5000,
        isDefault: false,
        isActive: true,
        createdAt: nowSec,
        updatedAt: nowSec,
      },
      {
        id: 'acc_ten_b_usd',
        tenantId: 'ten_b',
        orgId: 'org_b',
        code: 'TENB_USD',
        name: 'Tenant B Cash',
        accountKind: 'cash_drawer',
        currency: 'USD',
        openingBalanceMinor: 5000,
        currentBalanceMinor: 5000,
        isDefault: true,
        isActive: true,
        createdAt: nowSec,
        updatedAt: nowSec,
      },
    ]),
    db.insert(catCurrenciesAndRates).values({
      id: 'fx_usd_ves_bcv',
      tenantId: 'ten_a',
      orgId: 'org_a',
      fromCurrency: 'USD',
      toCurrency: 'VES',
      rateMicros: 36_500_000,
      source: 'BCV',
      effectiveAt: nowSec - 60,
      isActive: true,
      createdAt: nowSec,
      updatedAt: nowSec,
    }),
    db.insert(catProducts).values([
      {
        id: 'prod_amox',
        tenantId: 'ten_a',
        orgId: 'org_a',
        itemKind: 'physical',
        sku: 'AMOX-500',
        gtin: '7501031311309',
        name: 'Amoxicilina 500mg',
        trackingMode: 'LOT_EXPIRY',
        basePriceMinor: 2500,
        costPriceMinor: 1200,
        standardPriceMinor: 2500,
        primaryCurrency: 'USD',
        taxClass: 'EXEMPT',
        taxRateBps: 0,
        createdAt: nowSec,
        updatedAt: nowSec,
      },
      {
        id: 'prod_harina',
        tenantId: 'ten_a',
        orgId: 'org_a',
        itemKind: 'physical',
        sku: 'HARINA-1KG',
        gtin: '7591234567890',
        name: 'Harina Maiz 1kg',
        trackingMode: 'NONE',
        basePriceMinor: 1000,
        costPriceMinor: 600,
        standardPriceMinor: 1000,
        primaryCurrency: 'USD',
        taxClass: 'GENERAL',
        taxRateBps: 1600,
        createdAt: nowSec,
        updatedAt: nowSec,
      },
    ]),
    db.insert(catVariantsAndPresentations).values({
      id: 'var_harina_bulto',
      tenantId: 'ten_a',
      orgId: 'org_a',
      productId: 'prod_harina',
      sku: 'HARINA-BULTO5',
      barcode: '7599990001112',
      barcodeType: 'EAN13',
      presentationName: 'BULTO x5',
      uomFactorMicros: 5_000_000,
      overridePriceMinor: 5000,
      isDefault: false,
      createdAt: nowSec,
      updatedAt: nowSec,
    }),
  ]);
}

export async function seedAmoxBranchLots(
  branchDoNs: DurableObjectNamespace<import('./test-worker.js').BranchInventoryDO>,
): Promise<void> {
  const stub = branchDoNs.get(branchDoNs.idFromName('ten_a:org_a'));
  const nowMs = Date.now();
  await stub.receiveLot({
    clientMutationId: 'seed-pos-lot-late',
    lotId: 'LOT-POS-LATE',
    lotCode: 'LOT-POS-LATE',
    productId: 'prod_amox',
    qty: 10,
    unitCostMinor: 1200,
    expiryEpochMs: nowMs + 30 * DAY_MS,
    receivedAt: nowMs,
  });
  await stub.receiveLot({
    clientMutationId: 'seed-pos-lot-early',
    lotId: 'LOT-POS-EARLY',
    lotCode: 'LOT-POS-EARLY',
    productId: 'prod_amox',
    qty: 5,
    unitCostMinor: 1100,
    expiryEpochMs: nowMs + 5 * DAY_MS,
    receivedAt: nowMs + 1000,
  });
}

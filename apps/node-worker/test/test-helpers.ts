import type { TenantMarketProfile } from '@shac/kernel';

export const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

export function makeProfile(activeModules: string[]): TenantMarketProfile {
  return {
    deploymentId: 'dep_test_1',
    tenantId: 'ten_1',
    editionPreset: 'retail-pos',
    regionPack: 've',
    activeModules,
    vocabulary: {
      partySingular: 'Customer',
      partyPlural: 'Customers',
      orderSingular: 'Sale',
      branchSingular: 'Branch',
      spaceSingular: 'Register',
      caseSingular: 'Ticket',
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
      customEntitiesLimit: 25,
    },
    federation: {
      enabled: false,
      nodeDid: 'did:web:test.local',
      publishPublicCatalog: false,
      acceptPeerB2BOrders: false,
      consolidateLowStockHours: 24,
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
       VALUES ('ten_1', 'ten-1', 'Tenant One', 'USD', 'es-VE', 'active', 1700000000, 1700000000)`,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO iam_tenants (id, slug, name, primary_currency, default_locale, status, created_at, updated_at)
       VALUES ('ten_2', 'ten-2', 'Tenant Two', 'USD', 'es-VE', 'active', 1700000000, 1700000000)`,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES ('org_1', 'ten_1', NULL, 'org_1', '/org_1', 0, 'hq-1', 'HQ One', 'company', 'UTC', 1, 1, 1700000000, 1700000000)`,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES ('org_2', 'ten_2', NULL, 'org_2', '/org_2', 0, 'hq-2', 'HQ Two', 'company', 'UTC', 1, 1, 1700000000, 1700000000)`,
    ),
  ]);
}

export async function parseMcpJson(
  res: Response,
): Promise<Record<string, unknown>> {
  const text = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
    if (!dataLine) throw new Error(`Missing SSE data line: ${text}`);
    return JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
  }
  return JSON.parse(text) as Record<string, unknown>;
}

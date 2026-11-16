import { generateEd25519KeyPair, sha256Hex, signJwtEdDsa } from '@shac/kernel';
import type { WorkerEnv } from '../src/router.js';
import { MCP_HEADERS, parseMcpJson } from './test-helpers.js';

export const DAY_MS = 86_400_000;

export const mockCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

export type AppFetch = {
  fetch: (
    req: Request,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ) => Response | Promise<Response>;
};

export async function createTenantTokens() {
  const keys = await generateEd25519KeyPair();
  const tokenTen1 = await signJwtEdDsa(
    {
      sub: 'usr_p2_1',
      tenantId: 'ten_1',
      orgId: 'org_1',
      orgPath: '/org_1',
      actorType: 'staff',
      perms: [
        'iam.*',
        'customers.*',
        'catalog.*',
        'branch.inventory.read',
        'branch.inventory.write',
      ],
    },
    keys.privateKeyJwk,
    600,
  );
  const tokenTen2 = await signJwtEdDsa(
    {
      sub: 'usr_p2_2',
      tenantId: 'ten_2',
      orgId: 'org_2',
      orgPath: '/org_2',
      actorType: 'staff',
      perms: [
        'customers.*',
        'catalog.*',
        'branch.inventory.read',
        'branch.inventory.write',
      ],
    },
    keys.privateKeyJwk,
    600,
  );
  return { keys, tokenTen1, tokenTen2 };
}

export async function seedApiKeySession(
  kv: KVNamespace,
  rawKey = 'mk_live_phase2_self_test',
): Promise<string> {
  const hash = await sha256Hex(rawKey);
  await kv.put(
    `apikey:${hash}`,
    JSON.stringify({
      keyId: 'key_p2_1',
      tenantId: 'ten_1',
      orgId: 'org_1',
      orgPath: '/org_1',
      perms: [
        'customers.*',
        'catalog.*',
        'branch.inventory.read',
        'branch.inventory.write',
      ],
    }),
  );
  return rawKey;
}

export async function seedFiveLayerContractRule(
  db: D1Database,
  productId: string,
  partyId: string,
): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO cat_price_lists
         (id, tenant_id, org_id, code, name, currency, tariff_kind, is_active, created_at, updated_at)
         VALUES ('pl_p2_vip', 'ten_1', 'org_1', 'VIP_1TO1', 'VIP Contract', 'USD', 'contract_1to1', 1, ?, ?)`,
      )
      .bind(nowSec, nowSec),
    db
      .prepare(
        `INSERT OR IGNORE INTO cat_price_rules
         (id, tenant_id, org_id, price_list_id, product_id, target_party_id, min_qty, unit_price_minor, discount_bps, created_at, updated_at)
         VALUES ('rule_p2_1to1', 'ten_1', 'org_1', 'pl_p2_vip', ?, ?, 1, 1500, 0, ?, ?)`,
      )
      .bind(productId, partyId, nowSec, nowSec),
  ]);
}

export async function callWorkerJson<T>(
  app: AppFetch,
  testEnv: WorkerEnv,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await app.fetch(
    new Request(`https://example.com${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    testEnv,
    mockCtx,
  );
  return { status: res.status, data: (await res.json()) as T };
}

export async function callMcp(
  app: AppFetch,
  testEnv: WorkerEnv,
  token: string | null,
  method: string,
  params: Record<string, unknown>,
  id = 1,
): Promise<Record<string, unknown>> {
  const res = await app.fetch(
    new Request('https://example.com/mcp', {
      method: 'POST',
      headers: {
        ...MCP_HEADERS,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    }),
    testEnv,
    mockCtx,
  );
  if (res.status !== 200) {
    throw new Error(`MCP ${method} failed with status ${res.status}`);
  }
  return parseMcpJson(res);
}

export const EXPECTED_PHASE2_MCP_TOOLS = [
  'iam.orgs.list',
  'customers.parties.upsert',
  'customers.parties.list',
  'customers.links.create',
  'customers.deals.create',
  'customers.conflicts.check',
  'catalog.products.upsert',
  'catalog.products.list',
  'catalog.pricing.quote',
  'catalog.rates.upsert',
  'catalog.labels.batch',
] as const;

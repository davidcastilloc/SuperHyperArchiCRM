import { env, SELF } from 'cloudflare:test';
import { wrapD1WithCounter } from '@shac/db-d1';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import migration0001Sql from '../../../packages/db-d1/migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../../../packages/db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import {
  invalidateProfileCache,
  workerApp,
  type WorkerEnv,
} from '../src/router.js';
import {
  callMcp,
  callWorkerJson,
  createTenantTokens,
  DAY_MS,
  EXPECTED_PHASE2_MCP_TOOLS,
  seedApiKeySession,
  seedFiveLayerContractRule,
} from './phase2-helpers.js';
import {
  applySqlScript,
  makeProfile,
  seedTenantsAndOrgs,
} from './test-helpers.js';

describe('@shac/node-worker Phase 2 core workerd integration', () => {
  let publicKeyJwkJson: string;
  let tokenTen1: string;
  let tokenTen2: string;
  let apiKeyTen1: string;

  beforeAll(async () => {
    await applySqlScript(env.DB, migration0001Sql);
    await applySqlScript(env.DB, migration0002Sql);
    await seedTenantsAndOrgs(env.DB);
    const created = await createTenantTokens();
    publicKeyJwkJson = JSON.stringify(created.keys.publicKeyJwk);
    tokenTen1 = created.tokenTen1;
    tokenTen2 = created.tokenTen2;
    apiKeyTen1 = await seedApiKeySession(env.SESSION_KV);
  });

  beforeEach(() => {
    invalidateProfileCache();
  });

  it('enforces 403 MODULE_NOT_ENABLED for customers, catalog, and wms without touching D1', async () => {
    await env.CONFIG_KV.put('profile:current', JSON.stringify(makeProfile(['iam'])));
    const counted = wrapD1WithCounter(env.DB);
    const testEnv: WorkerEnv = {
      ...env,
      DB: counted.db,
      JWT_PUBLIC_KEY_JWK: publicKeyJwkJson,
    };

    for (const path of [
      '/api/customers/parties',
      '/api/catalog/products',
      '/api/branch/inventory/balances',
    ]) {
      const res = await callWorkerJson<{ error: { code: string } }>(
        workerApp,
        testEnv,
        path,
        tokenTen1,
      );
      expect(res.status).toBe(403);
      expect(res.data.error.code).toBe('MODULE_NOT_ENABLED');
    }
    expect(counted.getQueryCount()).toBe(0);
  });

  it('runs parties, catalog 5-layer + BCV quote (<= 2 D1 queries), and MCP Phase 2 tools', async () => {
    await env.CONFIG_KV.put(
      'profile:current',
      JSON.stringify(makeProfile(['iam', 'customers', 'catalog', 'wms'])),
    );
    const counted = wrapD1WithCounter(env.DB);
    const testEnv: WorkerEnv = {
      ...env,
      DB: counted.db,
      JWT_PUBLIC_KEY_JWK: publicKeyJwkJson,
    };

    const maria = await callWorkerJson<{ id: string; displayName: string }>(
      workerApp, testEnv, '/api/customers/parties', tokenTen1,
      {
        clientMutationId: 'mut-p2-maria',
        rolesMask: ['customer', 'patient'],
        displayName: 'María Gómez',
        taxIdNumber: 'V-12345678',
        creditLimitMinor: 50_000,
      },
    );
    expect(maria.status).toBe(200);
    expect(maria.data.displayName).toBe('María Gómez');

    counted.resetQueryCount();
    const listParties = await callWorkerJson<{ items: Array<{ id: string }> }>(
      workerApp, testEnv, '/api/customers/parties?search=Mar', tokenTen1,
    );
    expect(listParties.status).toBe(200);
    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);
    expect(listParties.data.items.some((p) => p.id === maria.data.id)).toBe(true);

    const ten2Parties = await callWorkerJson<{ total: number }>(
      workerApp, testEnv, '/api/customers/parties', tokenTen2,
    );
    expect(ten2Parties.status).toBe(200);
    expect(ten2Parties.data.total).toBe(0);

    const rateRes = await callWorkerJson<{ rateMicros: number }>(
      workerApp, testEnv, '/api/catalog/rates', tokenTen1,
      {
        clientMutationId: 'mut-p2-bcv',
        fromCurrency: 'USD',
        toCurrency: 'VES',
        rateMicros: 45_500_000,
        source: 'BCV',
      },
    );
    expect(rateRes.status).toBe(200);

    const prodRes = await callWorkerJson<{ product: { id: string } }>(
      workerApp, testEnv, '/api/catalog/products', tokenTen1,
      {
        clientMutationId: 'mut-p2-prod',
        sku: 'AMOX-500',
        name: 'Amoxicilina 500mg',
        trackingMode: 'LOT_EXPIRY',
        basePriceMinor: 2000,
        costPriceMinor: 1000,
        taxRateBps: 1600,
      },
    );
    expect(prodRes.status).toBe(200);
    const productId = prodRes.data.product.id;

    counted.resetQueryCount();
    const listProducts = await callWorkerJson<{ items: Array<{ id: string }> }>(
      workerApp, testEnv, '/api/catalog/products?search=AMOX', tokenTen1,
    );
    expect(listProducts.status).toBe(200);
    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);
    expect(listProducts.data.items).toHaveLength(1);

    await seedFiveLayerContractRule(env.DB, productId, maria.data.id);
    const quoteRes = await callWorkerJson<Record<string, unknown>>(
      workerApp, testEnv, '/api/catalog/pricing/quote', tokenTen1,
      { productId, partyId: maria.data.id, qty: 2, secondaryCurrency: 'VES' },
    );
    expect(quoteRes.status).toBe(200);
    expect(quoteRes.data).toMatchObject({
      appliedLayer: 'CONTRACT_1TO1',
      unitPriceMinor: 1500,
      lineTotalMinor: 3480,
      rateMicros: 45_500_000,
      secondaryUnitPriceMinor: 68_250,
    });

    const listTools = await callMcp(workerApp, testEnv, null, 'tools/list', {}, 10);
    const toolNames = (listTools.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    for (const expectedTool of EXPECTED_PHASE2_MCP_TOOLS) {
      expect(toolNames).toContain(expectedTool);
    }

    const mcpQuote = await callMcp(
      workerApp, testEnv, tokenTen1, 'tools/call',
      { name: 'catalog.pricing.quote', arguments: { productId, partyId: maria.data.id, qty: 1 } },
      11,
    );
    const mcpText = (mcpQuote.result as { content: Array<{ text: string }> })
      .content[0]?.text;
    expect(JSON.parse(mcpText ?? '{}')).toMatchObject({
      appliedLayer: 'CONTRACT_1TO1',
      unitPriceMinor: 1500,
    });
  });

  it('routes /api/branch/inventory/* to BranchInventoryDO with FEFO order and tenant isolation', async () => {
    await env.CONFIG_KV.put(
      'profile:current',
      JSON.stringify(makeProfile(['iam', 'customers', 'catalog', 'wms'])),
    );
    const testEnv: WorkerEnv = { ...env, JWT_PUBLIC_KEY_JWK: publicKeyJwkJson };
    const nowMs = Date.now();
    const productId = 'prod_fefo_worker';

    const lateLot = await callWorkerJson<{ lotId: string }>(
      workerApp,
      testEnv,
      '/api/branch/inventory/receive-lot',
      tokenTen1,
      {
        clientMutationId: 'mut-lot-late',
        lotId: 'LOT-LATE',
        lotCode: 'LOT-LATE',
        productId,
        qty: 10,
        unitCostMinor: 1000,
        expiryEpochMs: nowMs + 30 * DAY_MS,
        receivedAt: nowMs,
      },
    );
    expect(lateLot.status).toBe(200);

    const earlyLot = await callWorkerJson<{ lotId: string }>(
      workerApp,
      testEnv,
      '/api/branch/inventory/receive-lot',
      tokenTen1,
      {
        clientMutationId: 'mut-lot-early',
        lotId: 'LOT-EARLY',
        lotCode: 'LOT-EARLY',
        productId,
        qty: 20,
        unitCostMinor: 950,
        expiryEpochMs: nowMs + 5 * DAY_MS,
        receivedAt: nowMs + 1000,
      },
    );
    expect(earlyLot.status).toBe(200);

    const alloc = await callWorkerJson<{
      qtyAllocated: number;
      allocations: Array<{ lotId: string; qtyAllocated: number }>;
    }>(workerApp, testEnv, '/api/branch/inventory/allocate-fefo', tokenTen1, {
      clientMutationId: 'mut-alloc-15',
      productId,
      qtyRequested: 15,
    });
    expect(alloc.status).toBe(200);
    expect(alloc.data.qtyAllocated).toBe(15);
    expect(alloc.data.allocations[0]?.lotId).toBe('LOT-EARLY');

    const overAlloc = await callWorkerJson<{ error: { code: string } }>(
      workerApp,
      testEnv,
      '/api/branch/inventory/allocate-fefo',
      tokenTen1,
      {
        clientMutationId: 'mut-alloc-fail',
        productId,
        qtyRequested: 999,
      },
    );
    expect(overAlloc.status).toBe(409);
    expect(overAlloc.data.error.code).toBe('INSUFFICIENT_STOCK');

    const balancesSelf = await SELF.fetch(
      `https://example.com/api/branch/inventory/balances?productId=${encodeURIComponent(productId)}`,
      { headers: { 'X-API-Key': apiKeyTen1 } },
    );
    expect(balancesSelf.status).toBe(200);
    expect(await balancesSelf.json()).toMatchObject({
      totalOnHandQty: 15,
      totalAvailableQty: 15,
    });

    const ten2Balances = await callWorkerJson<{ totalOnHandQty: number }>(
      workerApp,
      testEnv,
      `/api/branch/inventory/balances?productId=${encodeURIComponent(productId)}`,
      tokenTen2,
    );
    expect(ten2Balances.status).toBe(200);
    expect(ten2Balances.data.totalOnHandQty).toBe(0);
  });
});

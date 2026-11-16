import { env } from 'cloudflare:test';
import { signApplianceLicense } from '@shac/control-plane';
import { buildMarketProfileFromPreset } from '@shac/editions';
import type { TenantMarketProfile } from '@shac/kernel';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import migration0001Sql from '../../../packages/db-d1/migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../../../packages/db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import migration0003Sql from '../../../packages/db-d1/migrations/0003_phase3_pos_wms_regional.sql?raw';
import '../src/index.js';
import { invalidateProfileCache, workerApp, type WorkerEnv } from '../src/router.js';
import { seedPhase3Fixtures } from './phase3-fixtures.js';
import { callMcpTool, callWorkerJson, createPhase3Tokens, DAY_MS } from './phase3-helpers.js';
import { applySqlScript, seedTenantsAndOrgs } from './test-helpers.js';

describe('@shac/node-worker Phase 4 App Store hot-switch & license workerd', () => {
  const nowSec = Math.floor(Date.now() / 1000);
  let publicKeyJwkJson: string;
  let tokenTen1: string;

  beforeAll(async () => {
    await applySqlScript(env.DB, migration0001Sql);
    await applySqlScript(env.DB, migration0002Sql);
    await applySqlScript(env.DB, migration0003Sql);
    await seedTenantsAndOrgs(env.DB);
    await seedPhase3Fixtures(env.DB, nowSec);
    const created = await createPhase3Tokens();
    publicKeyJwkJson = JSON.stringify(created.keys.publicKeyJwk);
    tokenTen1 = created.tokenTen1;
  });

  beforeEach(() => {
    invalidateProfileCache();
  });

  it('hot-switches modules and presets in 0ms without restart while preserving D1 and DO state', async () => {
    const initialProfile = buildMarketProfileFromPreset({
      deploymentId: 'dep_p4_hot',
      tenantId: 'ten_1',
      editionPreset: 'retail-pos',
      regionPack: 've',
      extraModules: ['wms'],
    });
    expect(initialProfile.activeModules).toEqual(
      expect.arrayContaining(['core', 'iam', 'customers', 'catalog', 'pos', 'regional', 'wms']),
    );
    await env.CONFIG_KV.put('profile:current', JSON.stringify(initialProfile));

    const testEnv: WorkerEnv = { ...env, JWT_PUBLIC_KEY_JWK: publicKeyJwkJson };

    // 1. Seed customer (María Gómez), product, BranchInventoryDO lot, and POS sale
    const maria = await callWorkerJson<{ id: string; displayName: string }>(
      workerApp, testEnv, '/api/customers/parties', tokenTen1,
      {
        clientMutationId: 'p4-maria',
        rolesMask: ['customer', 'patient'],
        displayName: 'María Gómez',
        taxIdNumber: 'V-12345678',
        creditLimitMinor: 50_000,
      },
    );
    expect(maria.status).toBe(200);
    expect(maria.data.displayName).toBe('María Gómez');

    const prod = await callWorkerJson<{ product: { id: string } }>(
      workerApp, testEnv, '/api/catalog/products', tokenTen1,
      {
        clientMutationId: 'p4-prod',
        sku: 'AMOX-P4',
        name: 'Amoxicilina P4',
        trackingMode: 'LOT_EXPIRY',
        basePriceMinor: 2500,
        costPriceMinor: 1000,
        taxRateBps: 1600,
      },
    );
    expect(prod.status).toBe(200);
    const productId = prod.data.product.id;

    const lot = await callWorkerJson<{ lotId: string }>(
      workerApp, testEnv, '/api/branch/inventory/receive-lot', tokenTen1,
      {
        clientMutationId: 'p4-lot-1',
        lotId: 'LOT-P4-1',
        lotCode: 'LOT-P4-1',
        productId,
        qty: 15,
        unitCostMinor: 1000,
        expiryEpochMs: Date.now() + 20 * DAY_MS,
      },
    );
    expect(lot.status).toBe(200);

    const openShift = await callWorkerJson<{ shiftId: string }>(
      workerApp, testEnv, '/api/pos/shifts/open', tokenTen1,
      {
        clientMutationId: 'p4-open-1',
        registerId: 'REG-P4-1',
        cashierName: 'Ana',
        initialBalancesMinor: { USD: 10_000 },
      },
    );
    expect(openShift.status).toBe(200);

    const sale = await callWorkerJson<{ orderId: string; grandTotalMinor: number }>(
      workerApp, testEnv, '/api/pos/sales/checkout', tokenTen1,
      {
        clientMutationId: 'p4-sale-1',
        shiftId: openShift.data.shiftId,
        orderCurrency: 'USD',
        items: [{ productId, qty: 2 }],
        payments: [
          {
            financialAccountId: 'acc_p3_usd',
            currency: 'USD',
            methodCode: 'USD_CASH',
            amountMinor: 5800,
          },
        ],
      },
    );
    expect(sale.status).toBe(200);

    // 2. Toggle wms OFF -> /api/wms/pickings immediately returns 403 MODULE_NOT_ENABLED
    const toggleOff = await callWorkerJson<{
      ok: boolean;
      profile: TenantMarketProfile;
    }>(workerApp, testEnv, '/api/system/app-store/toggle', tokenTen1, {
      disableModules: ['wms'],
    });
    expect(toggleOff.status).toBe(200);
    expect(toggleOff.data.ok).toBe(true);
    expect(toggleOff.data.profile.activeModules).not.toContain('wms');

    const wmsBlocked = await callWorkerJson<{ error: { code: string } }>(
      workerApp,
      testEnv,
      '/api/wms/pickings',
      tokenTen1,
    );
    expect(wmsBlocked.status).toBe(403);
    expect(wmsBlocked.data.error.code).toBe('MODULE_NOT_ENABLED');

    // 3. Toggle wms + new markets ON + switch preset + vocabulary override
    const toggleOn = await callWorkerJson<{
      ok: boolean;
      profile: TenantMarketProfile;
    }>(workerApp, testEnv, '/api/system/app-store/toggle', tokenTen1, {
      switchPreset: 'omni-enterprise',
      enableModules: ['wms', 'spaces', 'cases', 'finance', 'portal', 'automation'],
      vocabularyOverride: {
        partySingular: 'Paciente',
        partyPlural: 'Pacientes',
      },
    });
    expect(toggleOn.status).toBe(200);
    expect(toggleOn.data.profile.editionPreset).toBe('omni-enterprise');
    expect(toggleOn.data.profile.vocabulary.partyPlural).toBe('Pacientes');
    expect(toggleOn.data.profile.activeModules).toEqual(
      expect.arrayContaining([
        'core',
        'iam',
        'wms',
        'spaces',
        'cases',
        'finance',
        'portal',
        'automation',
      ]),
    );

    // 4. Verify GET /api/system/profile, /api/wms/pickings 200 OK, and D1 + DO data intact
    const profileRes = await callWorkerJson<{
      profile: TenantMarketProfile;
      catalog: { presets: Array<{ id: string }> };
    }>(workerApp, testEnv, '/api/system/profile', tokenTen1);
    expect(profileRes.status).toBe(200);
    expect(profileRes.data.profile.editionPreset).toBe('omni-enterprise');
    expect(profileRes.data.profile.vocabulary.partyPlural).toBe('Pacientes');
    expect(profileRes.data.catalog.presets).toHaveLength(9);

    const wmsOk = await callWorkerJson<{ items: unknown[] }>(
      workerApp,
      testEnv,
      '/api/wms/pickings',
      tokenTen1,
    );
    expect(wmsOk.status).toBe(200);

    const partiesCheck = await callWorkerJson<{ items: Array<{ id: string; displayName: string }> }>(
      workerApp,
      testEnv,
      '/api/customers/parties?search=Mar',
      tokenTen1,
    );
    expect(partiesCheck.status).toBe(200);
    expect(partiesCheck.data.items.some((p) => p.id === maria.data.id)).toBe(true);

    const prodCheck = await callWorkerJson<{ items: Array<{ id: string }> }>(
      workerApp,
      testEnv,
      '/api/catalog/products?search=AMOX-P4',
      tokenTen1,
    );
    expect(prodCheck.status).toBe(200);
    expect(prodCheck.data.items).toHaveLength(1);

    const doBalances = await callWorkerJson<{
      totalOnHandQty: number;
      totalAvailableQty: number;
    }>(
      workerApp,
      testEnv,
      `/api/branch/inventory/balances?productId=${encodeURIComponent(productId)}`,
      tokenTen1,
    );
    expect(doBalances.status).toBe(200);
    expect(doBalances.data.totalOnHandQty).toBe(13);
    expect(doBalances.data.totalAvailableQty).toBe(13);

    // 5. Test MCP tools/call system.app_store.get_profile & POST /api/system/reload-profile
    const mcpProfile = await callMcpTool<{
      profile: TenantMarketProfile;
      catalog: { presets: unknown[] };
    }>(workerApp, testEnv, tokenTen1, 'system.app_store.get_profile', {}, 10);
    expect(mcpProfile.profile.editionPreset).toBe('omni-enterprise');
    expect(mcpProfile.catalog.presets).toHaveLength(9);

    const reloadRes = await callWorkerJson<{ ok: boolean; reloaded: boolean }>(
      workerApp,
      testEnv,
      '/api/system/reload-profile',
      tokenTen1,
      {},
    );
    expect(reloadRes.status).toBe(200);
    expect(reloadRes.data.reloaded).toBe(true);
  });

  it('verifies appliance HMAC license (200 valid vs 403 LICENSE_INVALID tampered)', async () => {
    const secret = 'p4-test-hmac-secret';
    const testEnv: WorkerEnv = {
      ...env,
      JWT_PUBLIC_KEY_JWK: publicKeyJwkJson,
      LICENSE_HMAC_SECRET: secret,
    };

    const signed = await signApplianceLicense(
      {
        licenseId: 'lic_p4_1',
        deploymentId: 'dep_p4_1',
        hardwareFingerprint: 'hw_fp_abc123',
        editionPreset: 'retail-pos',
        issuedAt: nowSec - 60,
        expiresAt: nowSec + 86_400,
      },
      secret,
    );

    const validRes = await callWorkerJson<{ valid: boolean; reason: string }>(
      workerApp,
      testEnv,
      '/api/system/license/verify',
      tokenTen1,
      { license: signed, expectedFingerprint: 'hw_fp_abc123' },
    );
    expect(validRes.status).toBe(200);
    expect(validRes.data.valid).toBe(true);
    expect(validRes.data.reason).toBe('OK');

    const tamperedRes = await callWorkerJson<{
      valid: boolean;
      reason: string;
      error: { code: string };
    }>(workerApp, testEnv, '/api/system/license/verify', tokenTen1, {
      license: {
        ...signed,
        hmacSignature: `${signed.hmacSignature.slice(0, -4)}dead`,
      },
      expectedFingerprint: 'hw_fp_abc123',
    });
    expect(tamperedRes.status).toBe(403);
    expect(tamperedRes.data.error.code).toBe('LICENSE_INVALID');
    expect(tamperedRes.data.reason).toBe('INVALID_SIGNATURE');
  });
});

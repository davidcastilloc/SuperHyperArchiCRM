import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import migrationSql from '../migrations/0001_control_plane_core.sql?raw';
import {
  createControlPlaneApp,
  evaluateQuotaTelemetry,
  planRingRolloutBatches,
  signApplianceLicense,
  verifyApplianceLicense,
} from '../src/index.js';

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

const app = createControlPlaneApp({ defaultHmacSecret: 'test-cp-hmac-secret-2026' });

function callApi(path: string, body?: unknown, method = 'POST'): Promise<Response> {
  const req = new Request(`https://cp.test${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return Promise.resolve(app.fetch(req, env));
}

describe('@shac/control-plane on workerd', () => {
  beforeAll(async () => {
    await applySqlScript(env.CP_DB, migrationSql);
  });

  it('provisions 1-D1-per-tenant, syncs CONFIG_KV, and hot-toggles App Store modules', async () => {
    const provRes = await callApi('/api/cp/deployments', {
      slug: 'farmacia-caracas',
      tenantId: 'ten_farmacia',
      companyName: 'Farmacia Caracas CA',
      hostingMode: 'BYOC_FREE',
      editionPreset: 'retail-pos',
      regionPack: 've',
      releaseChannel: 'canary',
    });
    expect(provRes.status).toBe(201);
    const provJson = (await provRes.json()) as {
      deployment: { id: string; d1DatabaseId: string; configKvKey: string };
      profile: { activeModules: string[]; editionPreset: string };
      revision: number;
    };
    expect(provJson.revision).toBe(1);
    expect(provJson.profile.editionPreset).toBe('retail-pos');
    expect(provJson.profile.activeModules).toContain('pos');

    const kvRaw = await env.CP_KV.get(provJson.deployment.configKvKey);
    expect(kvRaw).not.toBeNull();
    const kvProfile1 = JSON.parse(kvRaw!) as { activeModules: string[] };
    expect(kvProfile1.activeModules).toContain('pos');

    const toggleRes = await callApi(
      `/api/cp/deployments/${provJson.deployment.id}/app-store`,
      {
        enableModules: ['spaces', 'cases'],
        disableModules: ['core', 'iam'],
      },
    );
    expect(toggleRes.status).toBe(200);
    const toggleJson = (await toggleRes.json()) as {
      revision: number;
      profile: { activeModules: string[]; tenantId: string };
    };
    expect(toggleJson.revision).toBe(2);
    expect(toggleJson.profile.tenantId).toBe('ten_farmacia');
    expect(toggleJson.profile.activeModules).toEqual(
      expect.arrayContaining(['core', 'iam', 'pos', 'spaces', 'cases']),
    );

    const kvRaw2 = await env.CP_KV.get(provJson.deployment.configKvKey);
    const kvProfile2 = JSON.parse(kvRaw2!) as { activeModules: string[] };
    expect(kvProfile2.activeModules).toContain('cases');
  });

  it('issues and verifies HMAC-SHA256 appliance licenses and rejects tampered/wrong-hw/expired/revoked', async () => {
    const provRes = await callApi('/api/cp/deployments', {
      slug: 'hotel-valencia',
      tenantId: 'ten_hotel',
      companyName: 'Hotel Valencia',
      hostingMode: 'HYBRID_APPLIANCE',
      editionPreset: 'hospitality-pms',
      regionPack: 've',
    });
    const provJson = (await provRes.json()) as { deployment: { id: string } };

    const issueRes = await callApi('/api/cp/licenses/issue', {
      deploymentId: provJson.deployment.id,
      hardwareFingerprint: 'hw-mac-aa:bb:cc:11',
      expiresInSeconds: 3600,
      issuedAt: 1_763_300_000,
    });
    expect(issueRes.status).toBe(201);
    const { license } = (await issueRes.json()) as {
      license: Awaited<ReturnType<typeof signApplianceLicense>>;
    };

    const okRes = await callApi('/api/cp/licenses/verify', {
      licenseId: license.licenseId,
      expectedFingerprint: 'hw-mac-aa:bb:cc:11',
      nowSec: 1_763_300_500,
    });
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toMatchObject({ valid: true, reason: 'OK' });

    const wrongHwRes = await callApi('/api/cp/licenses/verify', {
      license,
      expectedFingerprint: 'hw-mac-wrong',
      nowSec: 1_763_300_500,
    });
    expect(wrongHwRes.status).toBe(403);
    expect(await wrongHwRes.json()).toMatchObject({
      valid: false,
      reason: 'HARDWARE_MISMATCH',
    });

    const expiredRes = await callApi('/api/cp/licenses/verify', {
      license,
      expectedFingerprint: 'hw-mac-aa:bb:cc:11',
      nowSec: 1_763_305_000,
    });
    expect(expiredRes.status).toBe(403);
    expect(await expiredRes.json()).toMatchObject({
      valid: false,
      reason: 'EXPIRED',
    });

    const flippedSuffix = license.hmacSignature.endsWith('ff') ? '00' : 'ff';
    const tampered = {
      ...license,
      hmacSignature: `${license.hmacSignature.slice(0, -2)}${flippedSuffix}`,
    };
    const tamperedRes = await callApi('/api/cp/licenses/verify', {
      license: tampered,
      expectedFingerprint: 'hw-mac-aa:bb:cc:11',
      nowSec: 1_763_300_500,
    });
    expect(tamperedRes.status).toBe(403);
    expect(await tamperedRes.json()).toMatchObject({
      valid: false,
      reason: 'INVALID_SIGNATURE',
    });

    const revokedCheck = await verifyApplianceLicense(
      { ...license, revokedAt: 1_763_300_100 },
      'test-cp-hmac-secret-2026',
      'hw-mac-aa:bb:cc:11',
      1_763_300_500,
    );
    expect(revokedCheck).toMatchObject({ valid: false, reason: 'REVOKED' });
  });

  it('triggers WARN_75 on BYOC_FREE >=75% quota and plans Cloudflare rate-limited ring rollouts', async () => {
    const provRes = await callApi('/api/cp/deployments', {
      slug: 'bodega-maracaibo',
      tenantId: 'ten_bodega',
      companyName: 'Bodega Maracaibo',
      hostingMode: 'BYOC_FREE',
      editionPreset: 'retail-pos',
      regionPack: 've',
    });
    const provJson = (await provRes.json()) as { deployment: { id: string } };

    const warnRes = await callApi('/api/cp/telemetry/ingest', {
      deploymentId: provJson.deployment.id,
      dateYmd: '2026-11-16',
      d1RowsRead: 3_800_000,
      d1RowsWritten: 20_000,
      storageBytes: 100_000_000,
      workerRequests: 45_000,
      activeRegisters: 2,
    });
    expect(warnRes.status).toBe(200);
    expect(await warnRes.json()).toMatchObject({
      evaluation: {
        alertLevel: 'WARN_75',
        recommendedMode: 'SAAS_MULTI_D1',
        breachedMetrics: ['d1RowsRead'],
      },
    });

    const saasOk = evaluateQuotaTelemetry(
      { d1RowsRead: 4_900_000, d1RowsWritten: 95_000, storageBytes: 450_000_000 },
      'SAAS_MULTI_D1',
    );
    expect(saasOk.alertLevel).toBe('OK');

    const rolloutRes = await callApi('/api/cp/rollouts/plan', {
      targetVersion: '2.0.0',
      channel: 'canary',
      canaryPercent: 20,
      maxRequestsPer5Min: 1200,
    });
    expect(rolloutRes.status).toBe(201);
    const rolloutJson = (await rolloutRes.json()) as {
      jobId: string;
      plan: { totalNodes: number; batches: Array<{ ring: string }> };
    };
    expect(rolloutJson.plan.totalNodes).toBeGreaterThanOrEqual(3);
    expect(rolloutJson.plan.batches[0]?.ring).toBe('canary');

    const largeFleet = Array.from({ length: 2500 }, (_, i) => ({
      id: `dep_${i}`,
      releaseChannel: (i < 50 ? 'canary' : 'stable') as 'canary' | 'stable',
      currentVersion: '1.0.0',
    }));
    const fleetPlan = planRingRolloutBatches(largeFleet, {
      targetVersion: '2.0.0',
      canaryPercent: 5,
      maxRequestsPer5Min: 1200,
    });
    expect(fleetPlan.maxBatchNodes).toBe(1200);
    expect(fleetPlan.batches.every((b) => b.estimatedRequests <= 1200)).toBe(true);
    expect(fleetPlan.batches.length).toBe(3);
  });
});

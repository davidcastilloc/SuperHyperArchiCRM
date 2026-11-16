import { env } from 'cloudflare:test';
import { wrapD1WithCounter } from '@shac/db-d1';
import { generateEd25519KeyPair, signJwtEdDsa } from '@shac/kernel';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sql0001 from '../../../../packages/db-d1/migrations/0001_phase1_iam_core.sql?raw';
import sql0002 from '../../../../packages/db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import sql0003 from '../../../../packages/db-d1/migrations/0003_phase3_pos_wms_regional.sql?raw';
import sql0004 from '../../../../packages/db-d1/migrations/0004_phase6_spaces_leases.sql?raw';
import sql0005 from '../../../../packages/db-d1/migrations/0005_phase7_services_cases_finance_portal.sql?raw';
import sql0006 from '../../../../packages/db-d1/migrations/0006_phase8_physical_iot.sql?raw';
import { invalidateProfileCache, workerApp, type WorkerEnv } from '../router.js';
import { callMcpTool, callWorkerJson, mockCtx } from '../../test/phase3-helpers.js';
import { applySqlScript, makeProfile, seedTenantsAndOrgs } from '../../test/test-helpers.js';

describe('@shac/node-worker Phase 8 workerd integration (physical IoT, LPR, R2 clips, tamper, mcp)', () => {
  const nowSec = Math.floor(Date.now() / 1000);
  let publicKeyJwkJson: string;
  let tokenTen1: string;

  beforeAll(async () => {
    await applySqlScript(env.DB, sql0001);
    await applySqlScript(env.DB, sql0002);
    await applySqlScript(env.DB, sql0003);
    await applySqlScript(env.DB, sql0004);
    await applySqlScript(env.DB, sql0005);
    await applySqlScript(env.DB, sql0006);
    await seedTenantsAndOrgs(env.DB);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO phy_devices_and_locks
         (id, tenant_id, org_id, device_code, name, device_kind, vendor_driver, lock_state, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      ).bind('dev_p8_lock_1', 'ten_1', 'org_1', 'LOCK-P8-01', 'Puerta Principal', 'SMART_DOOR_LOCK', 'smartlock_cloud', 'LOCKED', nowSec, nowSec),
      env.DB.prepare(
        `INSERT OR IGNORE INTO phy_lpr_gates
         (id, tenant_id, org_id, gate_code, name, lane_direction, whitelist_mode, notify_channel, notify_target, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      ).bind('gate_p8_1', 'ten_1', 'org_1', 'GATE-P8-01', 'Barrera Norte', 'ENTRY', 'STRICT', 'whatsapp', '+584120000001', nowSec, nowSec),
    ]);

    const keys = await generateEd25519KeyPair();
    publicKeyJwkJson = JSON.stringify(keys.publicKeyJwk);
    tokenTen1 = await signJwtEdDsa(
      {
        sub: 'usr_p8_1',
        tenantId: 'ten_1',
        orgId: 'org_1',
        orgPath: '/org_1',
        actorType: 'staff',
        perms: ['iam.*', 'physical.*'],
      },
      keys.privateKeyJwk,
      600,
    );
  });

  beforeEach(() => {
    invalidateProfileCache();
  });

  it('enforces 403 MODULE_NOT_ENABLED for physical without touching D1', async () => {
    await env.CONFIG_KV.put('profile:current', JSON.stringify(makeProfile(['iam'])));
    const counted = wrapD1WithCounter(env.DB);
    const testEnv: WorkerEnv = { ...env, DB: counted.db, JWT_PUBLIC_KEY_JWK: publicKeyJwkJson };

    const res = await callWorkerJson<{ error: { code: string } }>(
      workerApp,
      testEnv,
      '/api/physical/tamper',
      tokenTen1,
      {
        clientMutationId: 'p8-gate-1',
        deviceId: 'dev_p8_lock_1',
        description: 'Should fail module gate',
      },
    );
    expect(res.status).toBe(403);
    expect(res.data.error.code).toBe('MODULE_NOT_ENABLED');
    expect(counted.getQueryCount()).toBe(0);
  });

  it('issues PIN pass, validates in constant time (200) & rejects bad PIN (403), scans LPR, seals R2 clip, and reports tamper', async () => {
    await env.CONFIG_KV.put('profile:current', JSON.stringify(makeProfile(['iam', 'physical'])));
    const testEnv: WorkerEnv = { ...env, JWT_PUBLIC_KEY_JWK: publicKeyJwkJson };

    const issued = await callWorkerJson<{ id: string; pinOrQrHash: string; status: string }>(
      workerApp,
      testEnv,
      '/api/physical/passes/issue',
      tokenTen1,
      {
        clientMutationId: 'p8-issue-1',
        passKind: 'VIP_LPR',
        holderName: 'Carlos VIP',
        licensePlate: 'P8VIP1',
        pinOrQrSecret: '847291',
        allowedDeviceIds: ['dev_p8_lock_1'],
        validFrom: nowSec - 60,
        validUntil: nowSec + 3600,
      },
    );
    expect(issued.status).toBe(200);
    expect(issued.data.status).toBe('ACTIVE');
    expect(issued.data.pinOrQrHash).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.data.pinOrQrHash).not.toBe('847291');

    const validRes = await callWorkerJson<{ valid: boolean; unlockedDeviceId: string | null }>(
      workerApp,
      testEnv,
      '/api/physical/passes/validate',
      tokenTen1,
      {
        passId: issued.data.id,
        deviceId: 'dev_p8_lock_1',
        pinOrQrSecret: '847291',
        nowSec,
      },
    );
    expect(validRes.status).toBe(200);
    expect(validRes.data.valid).toBe(true);
    expect(validRes.data.unlockedDeviceId).toBe('dev_p8_lock_1');

    const invalidRes = await callWorkerJson<{ error: { code: string } }>(
      workerApp,
      testEnv,
      '/api/physical/passes/validate',
      tokenTen1,
      {
        passId: issued.data.id,
        deviceId: 'dev_p8_lock_1',
        pinOrQrSecret: '000000',
        nowSec,
      },
    );
    expect(invalidRes.status).toBe(403);
    expect(invalidRes.data.error.code).toBe('FORBIDDEN');

    const lprRes = await callWorkerJson<{ decision: string; doormanNotified: boolean; gateCode: string }>(
      workerApp,
      testEnv,
      '/api/physical/lpr/scan',
      tokenTen1,
      {
        clientMutationId: 'p8-lpr-1',
        gateId: 'gate_p8_1',
        licensePlate: 'p8vip1',
        confidenceBps: 9800,
        nowSec,
      },
    );
    expect(lprRes.status).toBe(200);
    expect(lprRes.data.decision).toBe('GRANTED');
    expect(lprRes.data.doormanNotified).toBe(true);
    expect(lprRes.data.gateCode).toBe('GATE-P8-01');

    const clipRes = await callWorkerJson<{ id: string; sha256Hash: string; status: string }>(
      workerApp,
      testEnv,
      '/api/physical/clips',
      tokenTen1,
      {
        clientMutationId: 'p8-clip-1',
        cameraDeviceId: 'dev_p8_lock_1',
        clipKind: 'TAMPER_EVIDENCE',
        r2Key: 'clips/p8/tamper-01.mp4',
        integrityPayload: 'raw-mp4-integrity-seed',
        durationSec: 12,
        sizeBytes: 512_000,
      },
    );
    expect(clipRes.status).toBe(200);
    expect(clipRes.data.status).toBe('SEALED');
    expect(clipRes.data.sha256Hash).toMatch(/^[0-9a-f]{64}$/);

    const tamperRes = await callWorkerJson<{ id: string; severity: string; status: string }>(
      workerApp,
      testEnv,
      '/api/physical/tamper',
      tokenTen1,
      {
        clientMutationId: 'p8-tamper-1',
        deviceId: 'dev_p8_lock_1',
        alertKind: 'ENCLOSURE_OPEN',
        severity: 'CRITICAL',
        description: 'Enclosure opened unexpectedly',
        evidenceClipId: clipRes.data.id,
      },
    );
    expect(tamperRes.status).toBe(200);
    expect(tamperRes.data.severity).toBe('CRITICAL');
    expect(tamperRes.data.status).toBe('OPEN');
  });

  it('exposes Phase 8 tools over /mcp and executes physical.tamper.report', async () => {
    await env.CONFIG_KV.put('profile:current', JSON.stringify(makeProfile(['iam', 'physical'])));
    const testEnv: WorkerEnv = { ...env, JWT_PUBLIC_KEY_JWK: publicKeyJwkJson };

    const listReq = new Request('https://worker.test/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenTen1}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const listRes = await workerApp.fetch(listReq, testEnv, mockCtx);
    expect(listRes.status).toBe(200);
    const listText = await listRes.text();
    for (const toolName of [
      'physical.passes.issue',
      'physical.passes.validate',
      'physical.lpr.scan',
      'physical.clips.record',
      'physical.tamper.report',
    ]) {
      expect(listText).toContain(toolName);
    }

    const mcpTamper = await callMcpTool<{ id: string; severity: string; status: string }>(
      workerApp,
      testEnv,
      tokenTen1,
      'physical.tamper.report',
      {
        clientMutationId: 'p8-mcp-tamper-1',
        deviceId: 'dev_p8_lock_1',
        alertKind: 'CAMERA_BLINDED',
        severity: 'CRITICAL',
        description: 'Camera lens covered',
      },
      2,
    );
    expect(mcpTamper.severity).toBe('CRITICAL');
    expect(mcpTamper.status).toBe('OPEN');
  });
});

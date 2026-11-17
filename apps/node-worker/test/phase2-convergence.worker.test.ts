import { env } from 'cloudflare:test';
import {
  computeAuditEntryHashHex,
  generateEd25519KeyPair,
  GENESIS_AUDIT_HASH,
  signJwtEdDsa,
} from '@shac/kernel';
import { beforeAll, describe, expect, it } from 'vitest';
import migration0001 from '../../../packages/db-d1/migrations/0001_phase1_iam_core.sql?raw';
import migration0008 from '../../../packages/db-d1/migrations/0008_hash_chain_audit_and_cf_indexes.sql?raw';
import { invalidateProfileCache, workerApp, type WorkerEnv } from '../src/router.js';
import { applySqlScript, makeProfile, seedTenantsAndOrgs } from './test-helpers.js';

describe('@shac/node-worker Phase 2 audit-chain verify & realtime WS passthrough', () => {
  let token: string;
  let workerEnv: WorkerEnv;

  beforeAll(async () => {
    invalidateProfileCache();
    await applySqlScript(env.DB, migration0001);
    await applySqlScript(env.DB, migration0008);
    await seedTenantsAndOrgs(env.DB);
    const keys = await generateEd25519KeyPair();
    token = await signJwtEdDsa(
      {
        sub: 'usr_1',
        tenantId: 'ten_1',
        orgId: 'org_1',
        orgPath: '/org_1',
        actorType: 'staff',
        perms: ['*'],
      },
      keys.privateKeyJwk,
      300,
    );
    await env.CONFIG_KV.put('profile:current', JSON.stringify(makeProfile(['iam'])));
    workerEnv = {
      ...(env as unknown as WorkerEnv),
      JWT_PUBLIC_KEY_JWK: JSON.stringify(keys.publicKeyJwk),
    };
  });

  it('verifies immutable_audit_chain_ledger via POST /api/audit-chain/verify and guards WS upgrade', async () => {
    const payload1 = { amountMinor: 5000 };
    const h1 = await computeAuditEntryHashHex({
      orgId: 'org_1',
      streamKey: 'finance:trust',
      seqNo: 1,
      actorId: 'usr_1',
      action: 'DEPOSIT',
      targetId: 'led_1',
      occurredAtMs: 1000,
      prevHashHex: GENESIS_AUDIT_HASH,
      payload: payload1,
    });
    await env.DB.prepare(
      `INSERT INTO immutable_audit_chain_ledger
       (org_id, stream_key, seq_no, actor_id, action, target_id, occurred_at_ms, prev_hash_hex, record_hash_hex, payload_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
      .bind('org_1', 'finance:trust', 1, 'usr_1', 'DEPOSIT', 'led_1', 1000, GENESIS_AUDIT_HASH, h1, JSON.stringify(payload1))
      .run();

    const res = await workerApp.fetch(
      new Request('https://edge.shac.local/api/audit-chain/verify', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ streamKey: 'finance:trust' }),
      }),
      workerEnv,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { valid: boolean; checkedCount: number };
    expect(json.valid).toBe(true);
    expect(json.checkedCount).toBe(1);

    const streamsRes = await workerApp.fetch(
      new Request('https://edge.shac.local/api/audit-chain/streams', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      }),
      workerEnv,
    );
    expect(streamsRes.status).toBe(200);
    const streamsJson = (await streamsRes.json()) as {
      streams: Array<{ streamKey: string; entryCount: number }>;
    };
    expect(streamsJson.streams).toEqual([
      expect.objectContaining({ streamKey: 'finance:trust', entryCount: 1 }),
    ]);

    const wsRes = await workerApp.fetch(
      new Request('https://edge.shac.local/api/branch/org_1/realtime/ws', {
        method: 'GET',
      }),
      workerEnv,
    );
    expect(wsRes.status).toBe(426);
  });
});

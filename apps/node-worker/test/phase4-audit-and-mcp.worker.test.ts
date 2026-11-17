import { env } from 'cloudflare:test';
import { generateEd25519KeyPair, signJwtEdDsa } from '@shac/kernel';
import { beforeAll, describe, expect, it } from 'vitest';
import migration0001 from '../../../packages/db-d1/migrations/0001_phase1_iam_core.sql?raw';
import migration0002 from '../../../packages/db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import migration0005 from '../../../packages/db-d1/migrations/0005_phase7_services_cases_finance_portal.sql?raw';
import migration0008 from '../../../packages/db-d1/migrations/0008_hash_chain_audit_and_cf_indexes.sql?raw';
import { invalidateProfileCache, workerApp, type WorkerEnv } from '../src/router.js';
import {
  applySqlScript,
  MCP_HEADERS,
  makeProfile,
  parseMcpJson,
  seedTenantsAndOrgs,
} from './test-helpers.js';

describe('@shac/node-worker M4 audit-chain, MCP verify & customFields projections', () => {
  let token: string;
  let workerEnv: WorkerEnv;
  const mockCtx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;

  beforeAll(async () => {
    invalidateProfileCache();
    await applySqlScript(env.DB, migration0001);
    await applySqlScript(env.DB, migration0002);
    await applySqlScript(env.DB, migration0005);
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
    await env.CONFIG_KV.put(
      'profile:current',
      JSON.stringify(makeProfile(['iam', 'customers', 'finance'])),
    );
    workerEnv = {
      ...(env as unknown as WorkerEnv),
      JWT_PUBLIC_KEY_JWK: JSON.stringify(keys.publicKeyJwk),
    };
  });

  it('chains finance.journal.post into immutable_audit_chain_ledger, verifies via HTTP & MCP, and detects tampering', async () => {
    const postRes = await workerApp.fetch(
      new Request('https://edge.shac.local/api/finance/journal/post', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientMutationId: 'm4_journal_1',
          entryNumber: 'JE-M4-001',
          entryDate: 1763300000,
          fiscalYear: 2026,
          fiscalPeriod: 11,
          description: 'M4 Audit Chain Test Entry',
          lines: [
            { accountCode: '1100', debitMinor: 5000, creditMinor: 0 },
            { accountCode: '4000', debitMinor: 0, creditMinor: 5000 },
          ],
        }),
      }),
      workerEnv,
    );
    expect(postRes.status).toBe(200);

    const verifyRes = await workerApp.fetch(
      new Request('https://edge.shac.local/api/audit-chain/verify', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ streamKey: 'finance:journal' }),
      }),
      workerEnv,
    );
    expect(verifyRes.status).toBe(200);
    const verifyJson = (await verifyRes.json()) as { valid: boolean; checkedCount: number };
    expect(verifyJson.valid).toBe(true);
    expect(verifyJson.checkedCount).toBeGreaterThanOrEqual(1);

    const mcpRes = await workerApp.fetch(
      new Request('https://edge.shac.local/mcp', {
        method: 'POST',
        headers: {
          ...MCP_HEADERS,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'audit_verify_hash_chain',
            arguments: { streamKey: 'finance:journal' },
          },
        }),
      }),
      workerEnv,
      mockCtx,
    );
    expect(mcpRes.status).toBe(200);
    const mcpBody = (await parseMcpJson(mcpRes)) as {
      result?: { isError?: boolean; structuredContent?: { valid: boolean; checkedCount: number } };
    };
    expect(mcpBody.result?.isError).not.toBe(true);
    expect(mcpBody.result?.structuredContent?.valid).toBe(true);

    // Simulate direct SQL tampering in D1
    await env.DB.prepare(
      `UPDATE immutable_audit_chain_ledger SET payload_json = '{"tampered":true}' WHERE org_id = 'org_1' AND stream_key = 'finance:journal' AND seq_no = 1`,
    ).run();

    const tamperedRes = await workerApp.fetch(
      new Request('https://edge.shac.local/api/audit-chain/verify', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ streamKey: 'finance:journal' }),
      }),
      workerEnv,
    );
    const tamperedJson = (await tamperedRes.json()) as { valid: boolean; brokenAtSeqNo: number | null };
    expect(tamperedJson.valid).toBe(false);
    expect(tamperedJson.brokenAtSeqNo).toBe(1);
  });
});

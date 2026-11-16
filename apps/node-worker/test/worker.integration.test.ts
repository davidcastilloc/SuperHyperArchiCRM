import { env, SELF } from 'cloudflare:test';
import { wrapD1WithCounter } from '@shac/db-d1';
import { generateEd25519KeyPair, signJwtEdDsa } from '@shac/kernel';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import migrationSql from '../../../packages/db-d1/migrations/0001_phase1_iam_core.sql?raw';
import {
  invalidateProfileCache,
  workerApp,
  type WorkerEnv,
} from '../src/router.js';
import {
  applySqlScript,
  MCP_HEADERS,
  makeProfile,
  parseMcpJson,
  seedTenantsAndOrgs,
} from './test-helpers.js';

describe('@shac/node-worker workerd integration', () => {
  let keys: { publicKeyJwk: JsonWebKey; privateKeyJwk: JsonWebKey };
  let tokenTen1: string;
  let tokenTen2: string;

  const mockCtx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;

  beforeAll(async () => {
    await applySqlScript(env.DB, migrationSql);
    await seedTenantsAndOrgs(env.DB);
    keys = await generateEd25519KeyPair();
    tokenTen1 = await signJwtEdDsa(
      {
        sub: 'usr_1',
        tenantId: 'ten_1',
        orgId: 'org_1',
        orgPath: '/org_1',
        actorType: 'staff',
        perms: ['iam.orgs.create', 'iam.orgs.read'],
      },
      keys.privateKeyJwk,
      300,
    );
    tokenTen2 = await signJwtEdDsa(
      {
        sub: 'usr_2',
        tenantId: 'ten_2',
        orgId: 'org_2',
        orgPath: '/org_2',
        actorType: 'staff',
        perms: ['iam.orgs.create', 'iam.orgs.read'],
      },
      keys.privateKeyJwk,
      300,
    );
  });

  beforeEach(() => {
    invalidateProfileCache();
  });

  it('serves /api/health via SELF and fails closed 503 when profile:current is missing', async () => {
    const healthRes = await SELF.fetch('https://example.com/api/health');
    expect(healthRes.status).toBe(200);

    await env.CONFIG_KV.delete('profile:current');
    const counted = wrapD1WithCounter(env.DB);
    const testEnv: WorkerEnv = {
      ...env,
      DB: counted.db,
      JWT_PUBLIC_KEY_JWK: JSON.stringify(keys.publicKeyJwk),
    };

    const res = await workerApp.fetch(
      new Request('https://example.com/api/iam/orgs', {
        headers: { Authorization: `Bearer ${tokenTen1}` },
      }),
      testEnv,
      mockCtx,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PROFILE_UNAVAILABLE');
    expect(counted.getQueryCount()).toBe(0);
  });

  it('handles adaptive CORS OPTIONS preflight without touching KV or D1', async () => {
    const counted = wrapD1WithCounter(env.DB);
    const testEnv: WorkerEnv = {
      ...env,
      DB: counted.db,
      CORS_ALLOWED_ORIGINS:
        'https://aistudio.google.com,https://*.usercontent.goog',
    };

    const allowedRes = await workerApp.fetch(
      new Request('https://example.com/api/iam/orgs', {
        method: 'OPTIONS',
        headers: { Origin: 'https://preview.usercontent.goog' },
      }),
      testEnv,
      mockCtx,
    );
    expect(allowedRes.status).toBe(204);
    expect(allowedRes.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://preview.usercontent.goog',
    );
    expect(counted.getQueryCount()).toBe(0);

    const blockedRes = await workerApp.fetch(
      new Request('https://example.com/api/iam/orgs', {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example' },
      }),
      testEnv,
      mockCtx,
    );
    expect(blockedRes.status).toBe(204);
    expect(blockedRes.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('creates/lists orgs with queryCount <= 2, idempotency, tenant isolation, and 403 module gate', async () => {
    await env.CONFIG_KV.put(
      'profile:current',
      JSON.stringify(makeProfile(['iam'])),
    );
    const counted = wrapD1WithCounter(env.DB);
    const testEnv: WorkerEnv = {
      ...env,
      DB: counted.db,
      JWT_PUBLIC_KEY_JWK: JSON.stringify(keys.publicKeyJwk),
    };

    const createPayload = {
      clientMutationId: 'mut-org-1',
      name: 'North Branch',
      slug: 'north-branch',
      orgKind: 'branch',
      parentId: 'org_1',
    };

    const createRes1 = await workerApp.fetch(
      new Request('https://example.com/api/iam/orgs', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenTen1}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createPayload),
      }),
      testEnv,
      mockCtx,
    );
    expect(createRes1.status).toBe(200);
    const created1 = (await createRes1.json()) as { id: string; slug: string };
    expect(created1.slug).toBe('north-branch');

    const createRes2 = await workerApp.fetch(
      new Request('https://example.com/api/iam/orgs', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenTen1}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createPayload),
      }),
      testEnv,
      mockCtx,
    );
    expect(createRes2.status).toBe(200);
    const created2 = (await createRes2.json()) as { id: string };
    expect(created2.id).toBe(created1.id);

    counted.resetQueryCount();
    const listRes1 = await workerApp.fetch(
      new Request('https://example.com/api/iam/orgs', {
        headers: { Authorization: `Bearer ${tokenTen1}` },
      }),
      testEnv,
      mockCtx,
    );
    expect(listRes1.status).toBe(200);
    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);
    const list1 = (await listRes1.json()) as { items: Array<{ slug: string }> };
    expect(list1.items.some((item) => item.slug === 'north-branch')).toBe(true);

    const listRes2 = await workerApp.fetch(
      new Request('https://example.com/api/iam/orgs', {
        headers: { Authorization: `Bearer ${tokenTen2}` },
      }),
      testEnv,
      mockCtx,
    );
    expect(listRes2.status).toBe(200);
    const list2 = (await listRes2.json()) as { items: Array<{ slug: string }> };
    expect(list2.items.some((item) => item.slug === 'north-branch')).toBe(false);

    await env.CONFIG_KV.put('profile:current', JSON.stringify(makeProfile([])));
    invalidateProfileCache();
    counted.resetQueryCount();

    const gatedRes = await workerApp.fetch(
      new Request('https://example.com/api/iam/orgs', {
        headers: { Authorization: `Bearer ${tokenTen1}` },
      }),
      testEnv,
      mockCtx,
    );
    expect(gatedRes.status).toBe(403);
    const gatedBody = (await gatedRes.json()) as { error: { code: string } };
    expect(gatedBody.error.code).toBe('MODULE_NOT_ENABLED');
    expect(counted.getQueryCount()).toBe(0);
  });

  it('serves stateless MCP tools/list and tools/call at /mcp', async () => {
    await env.CONFIG_KV.put(
      'profile:current',
      JSON.stringify(makeProfile(['iam'])),
    );
    const counted = wrapD1WithCounter(env.DB);
    const testEnv: WorkerEnv = {
      ...env,
      DB: counted.db,
      JWT_PUBLIC_KEY_JWK: JSON.stringify(keys.publicKeyJwk),
    };

    const listToolsRes = await workerApp.fetch(
      new Request('https://example.com/mcp', {
        method: 'POST',
        headers: MCP_HEADERS,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      }),
      testEnv,
      mockCtx,
    );
    expect(listToolsRes.status).toBe(200);
    const listToolsRpc = await parseMcpJson(listToolsRes);
    const tools = (listToolsRpc.result as { tools: Array<{ name: string }> })
      .tools;
    expect(tools.some((t) => t.name === 'iam.orgs.list')).toBe(true);

    const callToolRes = await workerApp.fetch(
      new Request('https://example.com/mcp', {
        method: 'POST',
        headers: {
          ...MCP_HEADERS,
          Authorization: `Bearer ${tokenTen1}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'iam.orgs.list',
            arguments: { limit: 10, offset: 0 },
          },
        }),
      }),
      testEnv,
      mockCtx,
    );
    expect(callToolRes.status).toBe(200);
    const callRpc = await parseMcpJson(callToolRes);
    const content = (callRpc.result as { content: Array<{ text: string }> })
      .content;
    const parsedOutput = JSON.parse(content[0]?.text ?? '{}') as {
      items: Array<{ tenantId: string }>;
    };
    expect(parsedOutput.items.length).toBeGreaterThanOrEqual(1);
    expect(parsedOutput.items.every((o) => o.tenantId === 'ten_1')).toBe(true);
  });
});

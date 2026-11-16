import { env } from 'cloudflare:test';
import { iamOrganizations, iamUsers } from '@shac/db-d1';
import { hashPasswordPbkdf2, sha256Hex } from '@shac/kernel';
import { beforeAll, describe, expect, it } from 'vitest';
import phase1Sql from '../../../packages/db-d1/migrations/0001_phase1_iam_core.sql?raw';
import phase2Sql from '../../../packages/db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import { workerApp, type WorkerEnv } from '../src/router.js';
import { applySqlScript, seedTenantsAndOrgs } from './test-helpers.js';

describe('Interactive Auth Routes (/api/auth/*)', () => {
  const testEnv = env as unknown as WorkerEnv;
  let adminEmail = 'admin@shac.test';
  let adminPassword = 'StrongPassword!2026';
  let cashierPin = '4829';

  beforeAll(async () => {
    await applySqlScript(env.DB, phase1Sql);
    await applySqlScript(env.DB, phase2Sql);
    await seedTenantsAndOrgs(env.DB);
    await env.CONFIG_KV.put(
      'profile:current',
      JSON.stringify({
        deploymentId: 'dep_test',
        tenantId: 'ten_1',
        editionPreset: 'omni-enterprise',
        regionPack: 've',
        activeModules: ['core', 'iam', 'customers'],
        vocabulary: {
          partySingular: 'Cliente',
          partyPlural: 'Clientes',
          orderSingular: 'Pedido',
          branchSingular: 'Sucursal',
          spaceSingular: 'Espacio',
          caseSingular: 'Expediente',
        },
        currency: {
          baseCurrency: 'USD',
          operatingCurrencies: ['USD', 'VES'],
          rateSource: 'bcv',
          enforceAccountCurrencyMatch: true,
        },
        entitlements: {
          maxBranches: 10,
          maxPosRegisters: 20,
          maxSpacesOrUnits: 50,
          aiCopilotEnabled: true,
          customEntitiesLimit: 50,
        },
        federation: {
          enabled: false,
          nodeDid: 'did:web:edge.shac.local',
          publishPublicCatalog: false,
          acceptPeerB2BOrders: false,
          consolidateLowStockHours: 24,
          allowedSupplierDids: [],
        },
        updatedAt: new Date().toISOString(),
      }),
    );

    const nowSec = Math.floor(Date.now() / 1000);
    const emailHash = await sha256Hex(adminEmail.toLowerCase());
    const passwordHash = await hashPasswordPbkdf2(adminPassword);
    const floorPinHash = await sha256Hex(cashierPin);

    const { createD1Client } = await import('@shac/db-d1');
    const db = createD1Client(env.DB);
    await db.insert(iamUsers).values({
      id: 'usr_admin_1',
      tenantId: 'ten_1',
      defaultOrgId: 'org_1',
      realm: 'staff',
      email: adminEmail,
      emailHash,
      fullName: 'Admin SHAC',
      passwordHashWebcrypto: passwordHash,
      floorPinHash,
      isVerified: true,
      preferencesJson: JSON.stringify({ perms: ['*'] }),
      isActive: true,
      createdAt: nowSec,
      updatedAt: nowSec,
    });
    await db.insert(iamOrganizations).values({
      id: 'org_branch_2',
      tenantId: 'ten_1',
      parentId: 'org_1',
      rootId: 'org_1',
      treePath: '/org_1/sucursal-2',
      depth: 1,
      slug: 'sucursal-2',
      name: 'Sucursal Norte',
      orgKind: 'branch',
      isPrimary: false,
      isActive: true,
      createdAt: nowSec,
      updatedAt: nowSec,
    });
  });

  it('bootstraps profile and active branches without auth', async () => {
    const res = await workerApp.fetch(
      new Request('https://edge.shac.local/api/auth/bootstrap'),
      testEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tenantId: string;
      branches: Array<{ id: string; name: string; orgPath: string }>;
    };
    expect(body.tenantId).toBe('ten_1');
    expect(body.branches.some((b) => b.id === 'org_1')).toBe(true);
    expect(body.branches.some((b) => b.id === 'org_branch_2')).toBe(true);
  });

  it('logs in with email + password, accesses /api/customers/parties, and revokes on logout', async () => {
    const badRes = await workerApp.fetch(
      new Request('https://edge.shac.local/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: adminEmail,
          password: 'wrong-password',
          branchId: 'org_1',
        }),
      }),
      testEnv,
    );
    expect(badRes.status).toBe(401);

    const loginRes = await workerApp.fetch(
      new Request('https://edge.shac.local/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: adminEmail,
          password: adminPassword,
          branchId: 'org_1',
        }),
      }),
      testEnv,
    );
    expect(loginRes.status).toBe(200);
    const session = (await loginRes.json()) as {
      token: string;
      actor: { id: string; orgId: string; perms: string[] };
    };
    expect(session.token.startsWith('shac_sess_')).toBe(true);
    expect(session.actor.id).toBe('usr_admin_1');
    expect(session.actor.orgId).toBe('org_1');

    const partiesRes = await workerApp.fetch(
      new Request('https://edge.shac.local/api/customers/parties?limit=50', {
        headers: { Authorization: `Bearer ${session.token}` },
      }),
      testEnv,
    );
    expect(partiesRes.status).toBe(200);

    const logoutRes = await workerApp.fetch(
      new Request('https://edge.shac.local/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
      }),
      testEnv,
    );
    expect(logoutRes.status).toBe(200);

    const afterLogoutRes = await workerApp.fetch(
      new Request('https://edge.shac.local/api/customers/parties?limit=50', {
        headers: { Authorization: `Bearer ${session.token}` },
      }),
      testEnv,
    );
    expect(afterLogoutRes.status).toBe(401);
  });

  it('exchanges 4-digit cashier PIN and 6-digit delegation PIN for shac_sess_*', async () => {
    const cashierRes = await workerApp.fetch(
      new Request('https://edge.shac.local/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: cashierPin,
          branchId: 'org_1',
          mode: 'cashier',
        }),
      }),
      testEnv,
    );
    expect(cashierRes.status).toBe(200);
    const cashierSession = (await cashierRes.json()) as { token: string };
    expect(cashierSession.token.startsWith('shac_sess_')).toBe(true);

    const delegPin = '654321';
    const delegHash = await sha256Hex(delegPin);
    await env.SESSION_KV.put(
      `delegation:${delegHash}`,
      JSON.stringify({
        userId: 'usr_cashier_2',
        tenantId: 'ten_1',
        orgId: 'org_1',
        orgPath: '/org_1',
        perms: ['customers.read'],
        delegatedById: 'usr_admin_1',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      }),
    );

    const delegRes = await workerApp.fetch(
      new Request('https://edge.shac.local/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: delegPin,
          branchId: 'org_1',
          mode: 'delegation',
        }),
      }),
      testEnv,
    );
    expect(delegRes.status).toBe(200);
    const delegSession = (await delegRes.json()) as {
      token: string;
      actor: { type: string; delegatedById?: string };
    };
    expect(delegSession.token.startsWith('shac_sess_')).toBe(true);
    expect(delegSession.actor.type).toBe('delegated_staff');
    expect(delegSession.actor.delegatedById).toBe('usr_admin_1');
  });
});

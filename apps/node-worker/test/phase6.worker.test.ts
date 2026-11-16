import { env } from 'cloudflare:test';
import { createD1Client, spcUnitTypes, spcUnits, wrapD1WithCounter } from '@shac/db-d1';
import { generateEd25519KeyPair, signJwtEdDsa } from '@shac/kernel';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sql0001 from '../../../packages/db-d1/migrations/0001_phase1_iam_core.sql?raw';
import sql0002 from '../../../packages/db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import sql0003 from '../../../packages/db-d1/migrations/0003_phase3_pos_wms_regional.sql?raw';
import sql0004 from '../../../packages/db-d1/migrations/0004_phase6_spaces_leases.sql?raw';
import { invalidateProfileCache, workerApp, type WorkerEnv } from '../src/router.js';
import { callMcpTool, callWorkerJson, DAY_MS } from './phase3-helpers.js';
import { applySqlScript, makeProfile, seedTenantsAndOrgs } from './test-helpers.js';

describe('@shac/node-worker Phase 6 workerd integration (spaces, leases, mcp)', () => {
  const nowSec = Math.floor(Date.now() / 1000);
  let publicKeyJwkJson: string;
  let tokenTen1: string;

  beforeAll(async () => {
    await applySqlScript(env.DB, sql0001);
    await applySqlScript(env.DB, sql0002);
    await applySqlScript(env.DB, sql0003);
    await applySqlScript(env.DB, sql0004);
    await seedTenantsAndOrgs(env.DB);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO crm_parties (id, tenant_id, org_id, party_kind, display_name, legal_name, tax_id_type, tax_id_number, is_active, created_at, updated_at)
         VALUES ('pty_p6_1', 'ten_1', 'org_1', 'person', 'Ana Torres', 'Ana Torres', 'V', '11223344', 1, ?, ?)`,
      ).bind(nowSec, nowSec),
      env.DB.prepare(
        `INSERT OR IGNORE INTO crm_parties (id, tenant_id, org_id, party_kind, display_name, legal_name, tax_id_type, tax_id_number, is_active, created_at, updated_at)
         VALUES ('pty_p6_2', 'ten_1', 'org_1', 'person', 'Luis Gomez', 'Luis Gomez', 'V', '22334455', 1, ?, ?)`,
      ).bind(nowSec, nowSec),
    ]);

    const db = createD1Client(env.DB);
    await db.batch([
      db.insert(spcUnitTypes).values({
        id: 'ut_p6_suite',
        tenantId: 'ten_1',
        orgId: 'org_1',
        code: 'SUITE-P6',
        name: 'Suite P6',
        spaceCategory: 'hotel_room',
        maxOccupancy: 3,
        baseRateMinor: 15_000,
        ratePeriod: 'night',
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      db.insert(spcUnits).values([
        {
          id: 'unit_p6_101',
          tenantId: 'ten_1',
          orgId: 'org_1',
          unitTypeId: 'ut_p6_suite',
          unitNumber: '101',
          floorLabel: 'Piso 1',
          currentStatus: 'AVAILABLE',
          monthlyRentMinor: 100_001,
          createdAt: nowSec,
          updatedAt: nowSec,
        },
        {
          id: 'unit_p6_102',
          tenantId: 'ten_1',
          orgId: 'org_1',
          unitTypeId: 'ut_p6_suite',
          unitNumber: '102',
          floorLabel: 'Piso 1',
          currentStatus: 'AVAILABLE',
          monthlyRentMinor: 120_000,
          createdAt: nowSec,
          updatedAt: nowSec,
        },
      ]),
    ]);

    const keys = await generateEd25519KeyPair();
    publicKeyJwkJson = JSON.stringify(keys.publicKeyJwk);
    tokenTen1 = await signJwtEdDsa(
      {
        sub: 'usr_p6_1',
        tenantId: 'ten_1',
        orgId: 'org_1',
        orgPath: '/org_1',
        actorType: 'staff',
        perms: ['iam.*', 'spaces.*', 'leases.*'],
      },
      keys.privateKeyJwk,
      600,
    );
  });

  beforeEach(() => {
    invalidateProfileCache();
  });

  it('enforces 403 MODULE_NOT_ENABLED for spaces and leases without touching D1', async () => {
    await env.CONFIG_KV.put('profile:current', JSON.stringify(makeProfile(['iam'])));
    const counted = wrapD1WithCounter(env.DB);
    const testEnv: WorkerEnv = { ...env, DB: counted.db, JWT_PUBLIC_KEY_JWK: publicKeyJwkJson };

    for (const [path, body] of [
      ['/api/spaces/rack', undefined],
      [
        '/api/spaces/bookings/reserve',
        {
          clientMutationId: 'gate-1',
          unitId: 'unit_p6_101',
          partyId: 'pty_p6_1',
          slotBucket: '2026-12-10..2026-12-11',
          scheduledStart: Date.now() + DAY_MS,
          scheduledEnd: Date.now() + DAY_MS * 2,
        },
      ],
      ['/api/leases/community', { clientMutationId: 'gate-2', itemKind: 'announcement', title: 'Gate test' }],
    ] as const) {
      const res = await callWorkerJson<{ error: { code: string } }>(workerApp, testEnv, path, tokenTen1, body);
      expect(res.status).toBe(403);
      expect(res.data.error.code).toBe('MODULE_NOT_ENABLED');
    }
    expect(counted.getQueryCount()).toBe(0);
  });

  it('executes spaces rack (<= 2 queries), reserve + 409 SPACE_ALREADY_LOCKED, transition Check-Out -> Housekeeping, and MCP spaces.rack.list', async () => {
    await env.CONFIG_KV.put(
      'profile:current',
      JSON.stringify(makeProfile(['iam', 'spaces'])),
    );
    const counted = wrapD1WithCounter(env.DB);
    const testEnv: WorkerEnv = {
      ...env,
      DB: counted.db,
      JWT_PUBLIC_KEY_JWK: publicKeyJwkJson,
    };

    const startMs = Date.now() + DAY_MS;
    const endMs = startMs + DAY_MS * 2;
    const reserve1 = await callWorkerJson<{
      ok: true;
      bookingId: string;
      status: string;
    }>(workerApp, testEnv, '/api/spaces/bookings/reserve', tokenTen1, {
      clientMutationId: 'p6-res-1',
      unitId: 'unit_p6_101',
      partyId: 'pty_p6_1',
      slotBucket: '2026-12-15..2026-12-17',
      scheduledStart: startMs,
      scheduledEnd: endMs,
    });
    expect(reserve1.status).toBe(200);
    expect(reserve1.data.ok).toBe(true);

    const conflict = await callWorkerJson<{ error: { code: string } }>(
      workerApp,
      testEnv,
      '/api/spaces/bookings/reserve',
      tokenTen1,
      {
        clientMutationId: 'p6-res-2',
        unitId: 'unit_p6_101',
        partyId: 'pty_p6_2',
        slotBucket: '2026-12-15..2026-12-17',
        scheduledStart: startMs,
        scheduledEnd: endMs,
      },
    );
    expect(conflict.status).toBe(409);
    expect(conflict.data.error.code).toBe('SPACE_ALREADY_LOCKED');

    const checkIn = await callWorkerJson<{ status: string }>(
      workerApp,
      testEnv,
      '/api/spaces/bookings/transition',
      tokenTen1,
      {
        clientMutationId: 'p6-ci-1',
        bookingId: reserve1.data.bookingId,
        action: 'CHECK_IN',
      },
    );
    expect(checkIn.status).toBe(200);
    expect(checkIn.data.status).toBe('CHECKED_IN');

    const checkOut = await callWorkerJson<{
      status: string;
      unitStatus: string | null;
      housekeepingTaskId: string | null;
    }>(workerApp, testEnv, '/api/spaces/bookings/transition', tokenTen1, {
      clientMutationId: 'p6-co-1',
      bookingId: reserve1.data.bookingId,
      action: 'CHECK_OUT',
      housekeepingPriority: 'HIGH',
    });
    expect(checkOut.status).toBe(200);
    expect(checkOut.data.status).toBe('CHECKED_OUT');
    expect(checkOut.data.unitStatus).toBe('DIRTY');
    expect(checkOut.data.housekeepingTaskId).toBeTruthy();

    counted.resetQueryCount();
    const rack = await callWorkerJson<{
      units: Array<{ unitId: string }>;
      metrics: { totalAvailableUnits: number };
    }>(workerApp, testEnv, '/api/spaces/rack', tokenTen1);
    expect(rack.status).toBe(200);
    expect(rack.data.units.length).toBeGreaterThanOrEqual(2);
    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);

    const mcpRack = await callMcpTool<{
      orgId: string;
      units: Array<{ unitId: string }>;
    }>(workerApp, testEnv, tokenTen1, 'spaces.rack.list', {}, 601);
    expect(mcpRack.orgId).toBe('org_1');
    expect(mcpRack.units.length).toBeGreaterThanOrEqual(2);
  });

  it('activates a lease contract with Split Rent + escrow and posts to the condo community hub', async () => {
    await env.CONFIG_KV.put(
      'profile:current',
      JSON.stringify(makeProfile(['iam', 'leases'])),
    );
    const testEnv: WorkerEnv = {
      ...env,
      JWT_PUBLIC_KEY_JWK: publicKeyJwkJson,
    };

    const contract = await callWorkerJson<{
      id: string;
      status: string;
      securityDepositEscrowMinor: number;
      splitRentShares: Array<{ partyId: string; amountMinor: number }>;
    }>(workerApp, testEnv, '/api/leases/contracts/activate', tokenTen1, {
      clientMutationId: 'p6-lease-1',
      leaseNumber: 'LSE-P6-101',
      unitId: 'unit_p6_102',
      primaryPartyId: 'pty_p6_1',
      startDate: nowSec,
      endDate: nowSec + 31_536_000,
      monthlyRentMinor: 100_001,
      securityDepositEscrowMinor: 200_000,
      autopayEnabled: true,
      autopayDayOfMonth: 5,
      splitRentShares: [
        { partyId: 'pty_p6_1', shareBps: 5000, label: 'Ana' },
        { partyId: 'pty_p6_2', shareBps: 5000, label: 'Luis' },
      ],
    });
    expect(contract.status).toBe(200);
    expect(contract.data.status).toBe('ACTIVE');
    expect(contract.data.securityDepositEscrowMinor).toBe(200_000);
    expect(
      contract.data.splitRentShares.map((s) => s.amountMinor),
    ).toEqual([50_001, 50_000]);

    const post = await callWorkerJson<{
      id: string;
      itemKind: string;
      status: string;
    }>(workerApp, testEnv, '/api/leases/community', tokenTen1, {
      clientMutationId: 'p6-comm-1',
      itemKind: 'pet_registration',
      partyId: 'pty_p6_1',
      unitId: 'unit_p6_102',
      title: 'Max (Golden Retriever)',
      bodyOrDetails: { breed: 'Golden Retriever', weightKg: 28 },
    });
    expect(post.status).toBe(200);
    expect(post.data.itemKind).toBe('pet_registration');
    expect(post.data.status).toBe('ACTIVE');
  });
});

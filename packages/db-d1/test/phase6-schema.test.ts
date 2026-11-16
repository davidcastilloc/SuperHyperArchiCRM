import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import migration0001Sql from '../migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../migrations/0002_phase2_universal_trunk.sql?raw';
import migration0003Sql from '../migrations/0003_phase3_pos_wms_regional.sql?raw';
import migration0004Sql from '../migrations/0004_phase6_spaces_leases.sql?raw';
import {
  condoCommunityHub,
  createD1Client,
  iamOrganizations,
  iamTenants,
  leaseApplications,
  leaseContractsAndRenewals,
  spcAvailabilityRules,
  spcBookingsAndAppointments,
  spcFolios,
  spcHousekeepingTasks,
  spcUnits,
  spcUnitTypes,
  spcWaitlist,
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

describe('@shac/db-d1 Phase 6 workerd Spaces, PMS, Leases & Condo Hub schema', () => {
  beforeAll(async () => {
    await applySqlScript(env.DB, migration0001Sql);
    await applySqlScript(env.DB, migration0002Sql);
    await applySqlScript(env.DB, migration0003Sql);
    await applySqlScript(env.DB, migration0004Sql);
  });

  it('creates all 10 Phase 6 tables and merges all 64 schemas into Drizzle client', async () => {
    const result = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    ).all<{ name: string }>();
    const names = new Set(result.results.map((r) => r.name));

    const expectedTables = [
      'spc_unit_types',
      'spc_units',
      'spc_availability_rules',
      'spc_bookings_and_appointments',
      'spc_waitlist',
      'spc_folios',
      'spc_housekeeping_tasks',
      'lease_applications',
      'lease_contracts_and_renewals',
      'condo_community_hub',
    ];

    for (const tbl of expectedTables) {
      expect(names.has(tbl), `missing table ${tbl}`).toBe(true);
    }

    const db = createD1Client(env.DB);
    expect(Object.keys(db.query).length).toBeGreaterThanOrEqual(64);
  });

  it('supports integer-exact inserts and reads across all 10 Domain 7 tables', async () => {
    const db = createD1Client(env.DB);
    const now = 1763400000;
    const base = { tenantId: 'ten_p6', orgId: 'org_p6', createdAt: now, updatedAt: now };

    await db.batch([
      db.insert(iamTenants).values({
        id: 'ten_p6',
        slug: 'ten-p6',
        name: 'Phase 6 Tenant',
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(iamOrganizations).values({
        id: 'org_p6',
        tenantId: 'ten_p6',
        rootId: 'org_p6',
        treePath: '/org_p6',
        slug: 'hotel-hq',
        name: 'Hotel & Condo HQ',
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(spcUnitTypes).values({
        ...base,
        id: 'ut_suite',
        code: 'SUITE-KING',
        name: 'King Ocean Suite',
        spaceCategory: 'hotel_room',
        maxOccupancy: 4,
        bedOrLayoutType: '1 King + Sofa',
        areaSqft: 680,
        baseRateMinor: 25_000,
        ratePeriod: 'night',
      }),
      db.insert(spcUnits).values({
        ...base,
        id: 'unit_401',
        unitTypeId: 'ut_suite',
        unitNumber: '401',
        floorLabel: '4F',
        buildingSection: 'Tower A',
        currentStatus: 'AVAILABLE',
        monthlyRentMinor: 220_000,
      }),
      db.insert(spcAvailabilityRules).values({
        ...base,
        id: 'avail_401',
        subjectType: 'space_unit',
        subjectId: 'unit_401',
        timezone: 'America/New_York',
        rruleText: 'FREQ=DAILY;INTERVAL=1',
        kind: 'working_hours',
      }),
      db.insert(spcBookingsAndAppointments).values({
        ...base,
        id: 'bkg_01',
        confirmationCode: 'RES-2026-0001',
        bookingKind: 'hotel_stay',
        partyId: 'pty_guest_1',
        unitId: 'unit_401',
        sourceChannel: 'BOOKING_COM',
        scheduledStart: now + 3600,
        scheduledEnd: now + 90_000,
        totalMinor: 50_000,
        paidMinor: 25_000,
        status: 'CONFIRMED',
      }),
      db.insert(spcWaitlist).values({
        ...base,
        id: 'wl_01',
        partyId: 'pty_guest_2',
        unitTypeId: 'ut_suite',
        priority: 'HIGH',
        reason: 'Ocean view requested',
        status: 'waiting',
      }),
      db.insert(spcFolios).values({
        ...base,
        id: 'fol_01',
        folioNumber: 'FOL-2026-0001',
        bookingId: 'bkg_01',
        partyId: 'pty_guest_1',
        unitId: 'unit_401',
        currency: 'USD',
        subtotalMinor: 50_000,
        taxMinor: 5_000,
        totalMinor: 55_000,
        paidMinor: 25_000,
        balanceMinor: 30_000,
        status: 'OPEN',
      }),
      db.insert(spcHousekeepingTasks).values({
        ...base,
        id: 'hk_01',
        unitId: 'unit_401',
        taskKind: 'CHECKOUT_CLEANING',
        priority: 'HIGH',
        scheduledFor: now + 90_000,
        status: 'PENDING',
      }),
      db.insert(leaseApplications).values({
        ...base,
        id: 'lapp_01',
        applicantPartyId: 'pty_res_1',
        targetUnitId: 'unit_401',
        applicationKind: 'NEW_LEASE',
        desiredMoveIn: now + 86_400,
        termMonths: 12,
        proposedRentMinor: 220_000,
        screeningScore: 760,
        status: 'APPROVED',
      }),
      db.insert(leaseContractsAndRenewals).values({
        ...base,
        id: 'lse_01',
        recordKind: 'active_lease',
        leaseNumber: 'LSE-2026-0001',
        unitId: 'unit_401',
        primaryPartyId: 'pty_res_1',
        startDate: now,
        endDate: now + 31_536_000,
        monthlyRentMinor: 220_000,
        securityDepositEscrowMinor: 220_000,
        gracePeriodDays: 5,
        lateFeeMinor: 5_000,
        autopayEnabled: true,
        autopayDayOfMonth: 1,
        status: 'ACTIVE',
      }),
      db.insert(condoCommunityHub).values({
        ...base,
        id: 'hub_01',
        itemKind: 'pet_registration',
        partyId: 'pty_res_1',
        unitId: 'unit_401',
        title: 'Max (Golden Retriever)',
        priority: 'NORMAL',
        status: 'ACTIVE',
      }),
    ]);

    const [folio] = await db
      .select()
      .from(spcFolios)
      .where(and(eq(spcFolios.tenantId, 'ten_p6'), eq(spcFolios.folioNumber, 'FOL-2026-0001')));
    expect(folio?.balanceMinor).toBe(30_000);
    expect(Number.isInteger(folio?.totalMinor)).toBe(true);

    const [lease] = await db
      .select()
      .from(leaseContractsAndRenewals)
      .where(and(eq(leaseContractsAndRenewals.tenantId, 'ten_p6'), eq(leaseContractsAndRenewals.leaseNumber, 'LSE-2026-0001')));
    expect(lease?.securityDepositEscrowMinor).toBe(220_000);
    expect(lease?.autopayEnabled).toBe(true);
  });

  it('enforces tenant-scoped UNIQUE indexes while allowing same codes across tenants', async () => {
    const db = createD1Client(env.DB);
    const now = 1763400100;
    const base = { tenantId: 'ten_p6', orgId: 'org_p6', createdAt: now, updatedAt: now };

    await expect(
      db.insert(spcUnitTypes).values({ ...base, id: 'ut_dup', code: 'SUITE-KING', name: 'Dup' }),
    ).rejects.toThrow();

    await expect(
      db.insert(spcUnits).values({ ...base, id: 'unit_dup', unitTypeId: 'ut_suite', unitNumber: '401' }),
    ).rejects.toThrow();

    await expect(
      db.insert(spcBookingsAndAppointments).values({
        ...base,
        id: 'bkg_dup',
        confirmationCode: 'RES-2026-0001',
        partyId: 'pty_guest_1',
        scheduledStart: now,
        scheduledEnd: now + 3600,
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(spcFolios).values({
        ...base,
        id: 'fol_dup',
        folioNumber: 'FOL-2026-0001',
        bookingId: 'bkg_01',
        partyId: 'pty_guest_1',
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(leaseContractsAndRenewals).values({
        ...base,
        id: 'lse_dup',
        leaseNumber: 'LSE-2026-0001',
        unitId: 'unit_401',
        primaryPartyId: 'pty_res_1',
        startDate: now,
        endDate: now + 1000,
      }),
    ).rejects.toThrow();

    await db.insert(spcUnitTypes).values({
      id: 'ut_other_ten',
      tenantId: 'ten_other',
      orgId: 'org_other',
      code: 'SUITE-KING',
      name: 'Other Tenant Suite',
      createdAt: now,
      updatedAt: now,
    });
    const [other] = await db
      .select()
      .from(spcUnitTypes)
      .where(and(eq(spcUnitTypes.tenantId, 'ten_other'), eq(spcUnitTypes.code, 'SUITE-KING')));
    expect(other?.id).toBe('ut_other_ten');
  });
});

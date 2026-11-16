import { env } from 'cloudflare:test';
import {
  spcBookingsAndAppointments,
  spcFolios,
  spcHousekeepingTasks,
  spcUnits,
} from '@shac/db-d1';
import { AppError, enforceModuleGate } from '@shac/kernel';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import sql0001 from '../../../packages/db-d1/migrations/0001_phase1_iam_core.sql?raw';
import sql0002 from '../../../packages/db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import sql0003 from '../../../packages/db-d1/migrations/0003_phase3_pos_wms_regional.sql?raw';
import sql0004 from '../../../packages/db-d1/migrations/0004_phase6_spaces_leases.sql?raw';
import {
  computeAdrAndRevParMinor,
  modSpacesManifest,
  spacesBookingsReserveCommand,
  spacesBookingsTransitionCommand,
  spacesRackListCommand,
  spacesWaitlistManageCommand,
} from '../src/index.js';
import {
  applySqlScript,
  makeSpacesCtx,
  makeSpacesProfile,
  seedTenantsAndSpacesFixtures,
} from './test-helpers.js';

const DAY_MS = 86_400_000;

describe('@shac/mod-spaces on workerd', () => {
  beforeAll(async () => {
    await applySqlScript(env.DB, sql0001);
    await applySqlScript(env.DB, sql0002);
    await applySqlScript(env.DB, sql0003);
    await applySqlScript(env.DB, sql0004);
    await seedTenantsAndSpacesFixtures(env.DB, Math.floor(Date.now() / 1000));
  });

  it('computes integer BigInt ADR, RevPAR, and occupancyBps without floats', () => {
    const m = computeAdrAndRevParMinor({
      roomRevenueMinor: 45_000,
      occupiedUnits: 3,
      totalAvailableUnits: 4,
    });
    expect(m.adrMinor).toBe(15_000);
    expect(m.revParMinor).toBe(11_250);
    expect(m.occupancyBps).toBe(7_500);

    const empty = computeAdrAndRevParMinor({
      roomRevenueMinor: 0,
      occupiedUnits: 0,
      totalAvailableUnits: 10,
    });
    expect(empty.adrMinor).toBe(0);
    expect(empty.revParMinor).toBe(0);
    expect(empty.occupancyBps).toBe(0);

    expect(() =>
      computeAdrAndRevParMinor({
        roomRevenueMinor: 100,
        occupiedUnits: 5,
        totalAvailableUnits: 4,
      }),
    ).toThrow(AppError);
  });

  it('handles 30 simultaneous Promise.all reservations on unit_304: 1x200, 29x409 SPACE_ALREADY_LOCKED, 0 double bookings', async () => {
    const checkInMs = Date.now() + DAY_MS;
    const checkOutMs = checkInMs + DAY_MS * 2;
    const slotBucket = '2026-12-01..2026-12-03';

    const results = await Promise.all(
      Array.from({ length: 30 }, (_, idx) => {
        const ctx = makeSpacesCtx(env.DB, env.BRANCH_DO);
        return spacesBookingsReserveCommand
          .handler(ctx, {
            clientMutationId: `mut_burst_${idx}`,
            unitId: 'unit_304',
            partyId: 'pty_guest_1',
            partyNameMasked: `Guest ${idx}`,
            slotBucket,
            lockKind: 'STAY',
            bookingKind: 'hotel_stay',
            sourceChannel: 'BOOKING_COM',
            scheduledStart: checkInMs,
            scheduledEnd: checkOutMs,
            adultsCount: 2,
            childrenCount: 0,
          })
          .then((res) => ({ status: 200 as const, res }))
          .catch((err: unknown) => {
            if (err instanceof AppError) {
              return { status: err.status, code: err.code };
            }
            throw err;
          });
      }),
    );

    const successes = results.filter((r) => r.status === 200);
    const conflicts = results.filter(
      (r) => r.status === 409 && 'code' in r && r.code === 'SPACE_ALREADY_LOCKED',
    );

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(29);

    const ctx = makeSpacesCtx(env.DB, env.BRANCH_DO);
    const bookings = await ctx.db
      .select()
      .from(spcBookingsAndAppointments)
      .where(eq(spcBookingsAndAppointments.unitId, 'unit_304'));
    expect(bookings).toHaveLength(1);

    const folios = await ctx.db
      .select()
      .from(spcFolios)
      .where(eq(spcFolios.bookingId, bookings[0]!.id));
    expect(folios).toHaveLength(1);
    expect(folios[0]!.totalMinor).toBe(15_000);
    expect(folios[0]!.status).toBe('OPEN');
  });

  it('enforces idempotency replay and conflict on spaces.bookings.reserve', async () => {
    const ctx = makeSpacesCtx(env.DB, env.BRANCH_DO);
    const checkInMs = Date.now() + DAY_MS * 5;
    const checkOutMs = checkInMs + DAY_MS;

    const payload = {
      clientMutationId: 'mut_idem_305',
      unitId: 'unit_305',
      partyId: 'pty_guest_1',
      partyNameMasked: 'Maria P.',
      slotBucket: '2026-12-10..2026-12-11',
      lockKind: 'STAY' as const,
      bookingKind: 'hotel_stay',
      sourceChannel: 'DIRECT' as const,
      scheduledStart: checkInMs,
      scheduledEnd: checkOutMs,
      adultsCount: 1,
      childrenCount: 0,
    };

    const first = await spacesBookingsReserveCommand.handler(ctx, payload);
    const replay = await spacesBookingsReserveCommand.handler(ctx, payload);
    expect(replay).toEqual(first);

    await expect(
      spacesBookingsReserveCommand.handler(ctx, {
        ...payload,
        adultsCount: 2,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('runs Quick Check-In and Check-Out auto-creating spc_housekeeping_tasks', async () => {
    const ctx = makeSpacesCtx(env.DB, env.BRANCH_DO);
    const [booking] = await ctx.db
      .select()
      .from(spcBookingsAndAppointments)
      .where(eq(spcBookingsAndAppointments.unitId, 'unit_305'))
      .limit(1);
    expect(booking).toBeDefined();

    const checkInRes = await spacesBookingsTransitionCommand.handler(ctx, {
      clientMutationId: 'mut_checkin_305',
      bookingId: booking!.id,
      action: 'CHECK_IN',
      checkInChecklist: { idVerified: true, keyCardIssued: true },
      housekeepingPriority: 'MEDIUM',
    });
    expect(checkInRes.status).toBe('CHECKED_IN');
    expect(checkInRes.unitStatus).toBe('OCCUPIED');
    expect(checkInRes.housekeepingTaskId).toBeNull();

    const checkOutRes = await spacesBookingsTransitionCommand.handler(ctx, {
      clientMutationId: 'mut_checkout_305',
      bookingId: booking!.id,
      action: 'CHECK_OUT',
      housekeepingPriority: 'HIGH',
    });
    expect(checkOutRes.status).toBe('CHECKED_OUT');
    expect(checkOutRes.unitStatus).toBe('DIRTY');
    expect(checkOutRes.housekeepingTaskId).toBeTruthy();

    const hkRows = await ctx.db
      .select()
      .from(spcHousekeepingTasks)
      .where(eq(spcHousekeepingTasks.id, checkOutRes.housekeepingTaskId!));
    expect(hkRows).toHaveLength(1);
    expect(hkRows[0]!.taskKind).toBe('CHECKOUT_CLEANING');
    expect(hkRows[0]!.status).toBe('PENDING');

    const [unitRow] = await ctx.db
      .select()
      .from(spcUnits)
      .where(eq(spcUnits.id, 'unit_305'));
    expect(unitRow!.currentStatus).toBe('DIRTY');
  });

  it('lists live rack in <= 2 D1 queries and manages waitlist', async () => {
    const ctx = makeSpacesCtx(env.DB, env.BRANCH_DO);
    let batchCalls = 0;
    let totalQueriesInBatches = 0;
    const origBatch = ctx.db.batch.bind(ctx.db);
    ctx.db.batch = ((queries: readonly unknown[]) => {
      batchCalls += 1;
      totalQueriesInBatches += queries.length;
      return origBatch(queries as Parameters<typeof origBatch>[0]);
    }) as unknown as typeof ctx.db.batch;

    const rack = await spacesRackListCommand.handler(ctx, {});
    expect(batchCalls).toBe(1);
    expect(totalQueriesInBatches).toBeLessThanOrEqual(2);
    expect(rack.units.length).toBe(2);
    expect(rack.metrics.totalAvailableUnits).toBe(2);
    expect(rack.metrics.roomRevenueMinor).toBe(15_000);
    expect(rack.metrics.adrMinor).toBe(15_000);
    expect(rack.metrics.revParMinor).toBe(7_500);

    const added = await spacesWaitlistManageCommand.handler(ctx, {
      clientMutationId: 'mut_wl_add_1',
      action: 'ADD',
      partyId: 'pty_guest_1',
      unitTypeId: 'ut_suite_a',
      priority: 'HIGH',
      preferredDates: ['2026-12-24'],
      preferredSlots: ['NIGHT'],
      reason: 'VIP Christmas Eve',
    });
    expect(added.status).toBe('waiting');

    const promoted = await spacesWaitlistManageCommand.handler(ctx, {
      clientMutationId: 'mut_wl_promote_1',
      action: 'PROMOTE',
      waitlistId: added.waitlistId,
      priority: 'HIGH',
      preferredDates: [],
      preferredSlots: [],
    });
    expect(promoted.status).toBe('promoted');
  });

  it('enforces multi-tenant 404 isolation and 403 module/permission gates', async () => {
    expect(modSpacesManifest.id).toBe('spaces');
    expect(modSpacesManifest.commands).toHaveLength(4);

    const ctxB = makeSpacesCtx(env.DB, env.BRANCH_DO, {
      tenantId: 'ten_b',
      orgId: 'org_b',
      orgPath: '/org_b',
    });

    await expect(
      spacesBookingsReserveCommand.handler(ctxB, {
        clientMutationId: 'mut_cross_tenant',
        unitId: 'unit_304',
        partyId: 'pty_guest_b',
        partyNameMasked: 'Intruder',
        slotBucket: '2026-12-20..2026-12-21',
        lockKind: 'STAY',
        bookingKind: 'hotel_stay',
        sourceChannel: 'DIRECT',
        scheduledStart: Date.now() + DAY_MS * 10,
        scheduledEnd: Date.now() + DAY_MS * 11,
        adultsCount: 1,
        childrenCount: 0,
      }),
    ).rejects.toMatchObject({ status: 404, code: 'UNIT_NOT_FOUND' });

    const noSpacesProfile = makeSpacesProfile('ten_a');
    noSpacesProfile.activeModules = ['iam', 'customers'];
    expect(() =>
      enforceModuleGate(noSpacesProfile, 'spaces'),
    ).toThrowError(expect.objectContaining({ status: 403 }));
  });
});

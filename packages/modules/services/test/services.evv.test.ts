import { env } from 'cloudflare:test';
import { evvFieldVisits } from '@shac/db-d1';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  computeDistanceMeters,
  servicesEvvRecordCommand,
} from '../src/index.js';
import { makeServicesCtx, setupServicesD1 } from './test-helpers.js';

const CLIENT_SVG = '<svg viewBox="0 0 100 40"><path d="M5 20 L90 25"/></svg>';
const STAFF_SVG = '<svg viewBox="0 0 100 40"><path d="M10 15 L85 30"/></svg>';

describe('@shac/mod-services EVV on workerd', () => {
  beforeAll(async () => {
    await setupServicesD1(env.DB);
  });

  it('records EVV field visits with GPS micro-coords, geofence check, dual SVG signatures, idempotency, and 403/404 isolation', async () => {
    const { ctx, counted } = makeServicesCtx(env.DB);

    expect(
      computeDistanceMeters(10_480_594, -66_903_600, 10_480_594, -66_903_600),
    ).toBe(0);

    const compliantVisit = await servicesEvvRecordCommand.handler(
      ctx,
      servicesEvvRecordCommand.inputSchema.parse({
        clientMutationId: 'evv-create-1',
        sourceKind: 'field_tech',
        parentRecordId: 'wo_ref_1',
        partyId: 'party_1',
        staffId: 'tech_1',
        targetLatMicros: 10_480_594,
        targetLngMicros: -66_903_600,
        clockInLatMicros: 10_480_700,
        clockInLngMicros: -66_903_650,
        clockInAt: 1763300100,
        clockOutAt: 1763303700,
        clientOrCaregiverSignatureSvg: CLIENT_SVG,
        staffSignatureSvg: STAFF_SVG,
      }),
    );

    expect(compliantVisit.geofenceCompliant).toBe(true);
    expect(compliantVisit.distanceMeters).toBeLessThan(50);
    expect(compliantVisit.status).toBe('CLOCKED_OUT');
    expect(compliantVisit.clientOrCaregiverSignatureSvg).toBe(CLIENT_SVG);
    expect(compliantVisit.staffSignatureSvg).toBe(STAFF_SVG);

    const outOfRangeVisit = await servicesEvvRecordCommand.handler(
      ctx,
      servicesEvvRecordCommand.inputSchema.parse({
        clientMutationId: 'evv-create-far',
        sourceKind: 'home_health',
        parentRecordId: 'wo_ref_2',
        partyId: 'party_1',
        staffId: 'nurse_1',
        targetLatMicros: 10_480_594,
        targetLngMicros: -66_903_600,
        clockInLatMicros: 10_495_000,
        clockInLngMicros: -66_903_600,
        clockInAt: 1763300200,
        clientOrCaregiverSignatureSvg: CLIENT_SVG,
        staffSignatureSvg: STAFF_SVG,
      }),
    );

    expect(outOfRangeVisit.geofenceCompliant).toBe(false);
    expect(outOfRangeVisit.distanceMeters).toBeGreaterThan(250);
    expect(outOfRangeVisit.status).toBe('CLOCKED_IN');

    counted.resetQueryCount();
    const replayed = await servicesEvvRecordCommand.handler(
      ctx,
      servicesEvvRecordCommand.inputSchema.parse({
        clientMutationId: 'evv-create-1',
        sourceKind: 'field_tech',
        parentRecordId: 'wo_ref_1',
        partyId: 'party_1',
        staffId: 'tech_1',
        targetLatMicros: 10_480_594,
        targetLngMicros: -66_903_600,
        clockInLatMicros: 10_480_700,
        clockInLngMicros: -66_903_650,
        clockInAt: 1763300100,
        clockOutAt: 1763303700,
        clientOrCaregiverSignatureSvg: CLIENT_SVG,
        staffSignatureSvg: STAFF_SVG,
      }),
    );
    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);
    expect(replayed.id).toBe(compliantVisit.id);

    const dbEvv = await ctx.db
      .select()
      .from(evvFieldVisits)
      .where(eq(evvFieldVisits.id, compliantVisit.id));
    expect(dbEvv).toHaveLength(1);

    await expect(
      servicesEvvRecordCommand.handler(
        ctx,
        servicesEvvRecordCommand.inputSchema.parse({
          clientMutationId: 'evv-cross-branch',
          parentRecordId: 'wo_ref_3',
          partyId: 'party_south',
          staffId: 'tech_1',
          targetLatMicros: 10_480_594,
          targetLngMicros: -66_903_600,
          clockInLatMicros: 10_480_594,
          clockInLngMicros: -66_903_600,
          clockInAt: 1763300300,
          clientOrCaregiverSignatureSvg: CLIENT_SVG,
          staffSignatureSvg: STAFF_SVG,
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      servicesEvvRecordCommand.handler(
        ctx,
        servicesEvvRecordCommand.inputSchema.parse({
          clientMutationId: 'evv-missing-party',
          parentRecordId: 'wo_ref_4',
          partyId: 'party_missing',
          staffId: 'tech_1',
          targetLatMicros: 10_480_594,
          targetLngMicros: -66_903_600,
          clockInLatMicros: 10_480_594,
          clockInLngMicros: -66_903_600,
          clockInAt: 1763300400,
          clientOrCaregiverSignatureSvg: CLIENT_SVG,
          staffSignatureSvg: STAFF_SVG,
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});

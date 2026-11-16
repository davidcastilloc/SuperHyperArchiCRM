import {
  assertOrgScope,
  spcBookingsAndAppointments,
  spcUnits,
  spcUnitTypes,
  type ShacD1Database,
} from '@shac/db-d1';
import { defineCommand } from '@shac/kernel';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { resolveOrgId } from '../lib/spaces-helpers.js';
import { computeAdrAndRevParMinor } from '../pms-math.js';
import {
  spacesRackListInputSchema,
  spacesRackListOutputSchema,
} from './spaces-schemas.js';

export const spacesRackListCommand = defineCommand<
  typeof spacesRackListInputSchema,
  z.infer<typeof spacesRackListOutputSchema>,
  ShacD1Database
>({
  id: 'spaces.rack.list',
  moduleId: 'spaces',
  method: 'GET',
  path: '/api/spaces/rack',
  summary:
    'List live space rack units, active bookings, and integer ADR/RevPAR metrics',
  requiredPermission: 'spaces.rack.read',
  mcp: {
    expose: true,
    readOnlyHint: true,
    description:
      'Fetch the live room/space rack and compute ADR/RevPAR in <= 2 D1 batch queries',
  },
  inputSchema: spacesRackListInputSchema,
  outputSchema: spacesRackListOutputSchema,
  async handler(ctx, input) {
    assertOrgScope(ctx, ctx.tenantId, ctx.orgPath);
    const orgId = resolveOrgId(ctx, input.orgId);

    const unitConditions = [
      eq(spcUnits.tenantId, ctx.tenantId),
      eq(spcUnits.orgId, orgId),
      eq(spcUnits.isActive, true),
      isNull(spcUnits.deletedAt),
    ];
    if (input.status) {
      unitConditions.push(eq(spcUnits.currentStatus, input.status));
    }
    if (input.spaceCategory) {
      unitConditions.push(eq(spcUnitTypes.spaceCategory, input.spaceCategory));
    }

    const [units, activeBookings] = await ctx.db.batch([
      ctx.db
        .select({
          unitId: spcUnits.id,
          unitNumber: spcUnits.unitNumber,
          floorLabel: spcUnits.floorLabel,
          buildingSection: spcUnits.buildingSection,
          currentStatus: spcUnits.currentStatus,
          unitTypeId: spcUnitTypes.id,
          unitTypeCode: spcUnitTypes.code,
          unitTypeName: spcUnitTypes.name,
          spaceCategory: spcUnitTypes.spaceCategory,
          baseRateMinor: spcUnitTypes.baseRateMinor,
          monthlyRentMinor: spcUnits.monthlyRentMinor,
        })
        .from(spcUnits)
        .innerJoin(
          spcUnitTypes,
          and(
            eq(spcUnitTypes.id, spcUnits.unitTypeId),
            eq(spcUnitTypes.tenantId, spcUnits.tenantId),
          ),
        )
        .where(and(...unitConditions)),
      ctx.db
        .select({
          bookingId: spcBookingsAndAppointments.id,
          confirmationCode: spcBookingsAndAppointments.confirmationCode,
          unitId: spcBookingsAndAppointments.unitId,
          partyId: spcBookingsAndAppointments.partyId,
          sourceChannel: spcBookingsAndAppointments.sourceChannel,
          status: spcBookingsAndAppointments.status,
          scheduledStart: spcBookingsAndAppointments.scheduledStart,
          scheduledEnd: spcBookingsAndAppointments.scheduledEnd,
          totalMinor: spcBookingsAndAppointments.totalMinor,
        })
        .from(spcBookingsAndAppointments)
        .where(
          and(
            eq(spcBookingsAndAppointments.tenantId, ctx.tenantId),
            eq(spcBookingsAndAppointments.orgId, orgId),
            isNull(spcBookingsAndAppointments.deletedAt),
            inArray(spcBookingsAndAppointments.status, [
              'PENDING',
              'CONFIRMED',
              'CHECKED_IN',
            ]),
          ),
        ),
    ]);

    const totalAvailableUnits = units.length;
    const occupiedUnits = units.filter(
      (u) => u.currentStatus === 'OCCUPIED' || u.currentStatus === 'RESERVED',
    ).length;

    let roomRevenueMinor = 0;
    for (const booking of activeBookings) {
      if (booking.status === 'CONFIRMED' || booking.status === 'CHECKED_IN') {
        roomRevenueMinor += booking.totalMinor;
      }
    }

    const metrics = computeAdrAndRevParMinor({
      roomRevenueMinor,
      occupiedUnits: Math.min(occupiedUnits, totalAvailableUnits),
      totalAvailableUnits,
    });

    return {
      orgId,
      units,
      activeBookings,
      metrics,
    };
  },
});

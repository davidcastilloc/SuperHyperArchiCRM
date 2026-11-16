import {
  assertOrgScope,
  kernelIdempotencyKeys,
  spcBookingsAndAppointments,
  spcHousekeepingTasks,
  spcUnits,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand } from '@shac/kernel';
import { and, eq, isNull } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { z } from 'zod';
import {
  buildIdempotencyInsert,
  computeCommandRequestHash,
  nowEpochSec,
  resolveOrgId,
} from '../lib/spaces-helpers.js';
import {
  spacesBookingsTransitionInputSchema,
  spacesBookingsTransitionOutputSchema,
} from './spaces-schemas.js';

export const spacesBookingsTransitionCommand = defineCommand<
  typeof spacesBookingsTransitionInputSchema,
  z.infer<typeof spacesBookingsTransitionOutputSchema>,
  ShacD1Database
>({
  id: 'spaces.bookings.transition',
  moduleId: 'spaces',
  method: 'POST',
  path: '/api/spaces/bookings/transition',
  summary:
    'Transition a space booking (Quick Check-In, Check-Out with auto Housekeeping task, or Cancel)',
  requiredPermission: 'spaces.bookings.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Execute Quick Check-In, Check-Out (auto-creating spc_housekeeping_tasks), or Cancel on a booking',
  },
  inputSchema: spacesBookingsTransitionInputSchema,
  outputSchema: spacesBookingsTransitionOutputSchema,
  async handler(ctx, input) {
    assertOrgScope(ctx, ctx.tenantId, ctx.orgPath);
    const orgId = resolveOrgId(ctx, input.orgId);

    const requestHash = await computeCommandRequestHash(
      'spaces.bookings.transition',
      {
        orgId,
        bookingId: input.bookingId,
        action: input.action,
        checkInChecklist: input.checkInChecklist ?? null,
        assignedToStaffId: input.assignedToStaffId ?? null,
        housekeepingPriority: input.housekeepingPriority,
      },
    );

    const [idemRows, bookingRows] = await ctx.db.batch([
      ctx.db
        .select({
          requestHash: kernelIdempotencyKeys.requestHash,
          responseJson: kernelIdempotencyKeys.responseJson,
        })
        .from(kernelIdempotencyKeys)
        .where(
          and(
            eq(kernelIdempotencyKeys.tenantId, ctx.tenantId),
            eq(kernelIdempotencyKeys.clientMutationId, input.clientMutationId),
          ),
        )
        .limit(1),
      ctx.db
        .select({
          id: spcBookingsAndAppointments.id,
          unitId: spcBookingsAndAppointments.unitId,
          status: spcBookingsAndAppointments.status,
          actualCheckIn: spcBookingsAndAppointments.actualCheckIn,
          actualCheckOut: spcBookingsAndAppointments.actualCheckOut,
        })
        .from(spcBookingsAndAppointments)
        .where(
          and(
            eq(spcBookingsAndAppointments.tenantId, ctx.tenantId),
            eq(spcBookingsAndAppointments.orgId, orgId),
            eq(spcBookingsAndAppointments.id, input.bookingId),
            isNull(spcBookingsAndAppointments.deletedAt),
          ),
        )
        .limit(1),
    ]);

    const idemHit = idemRows[0];
    if (idemHit) {
      if (idemHit.requestHash !== requestHash) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          409,
          'clientMutationId already used with a different payload',
        );
      }
      return spacesBookingsTransitionOutputSchema.parse(
        JSON.parse(idemHit.responseJson),
      );
    }

    const booking = bookingRows[0];
    if (!booking) {
      throw new AppError(
        'BOOKING_NOT_FOUND',
        404,
        `Booking ${input.bookingId} not found in organization ${orgId}`,
      );
    }

    const nowSec = nowEpochSec();
    let nextStatus: string;
    let nextUnitStatus: string | null = null;
    let housekeepingTaskId: string | null = null;

    if (input.action === 'CHECK_IN') {
      if (booking.status !== 'PENDING' && booking.status !== 'CONFIRMED') {
        throw new AppError(
          'INVALID_BOOKING_TRANSITION',
          409,
          `Cannot CHECK_IN booking in status ${booking.status}`,
        );
      }
      nextStatus = 'CHECKED_IN';
      nextUnitStatus = 'OCCUPIED';
    } else if (input.action === 'CHECK_OUT') {
      if (booking.status !== 'CHECKED_IN') {
        throw new AppError(
          'INVALID_BOOKING_TRANSITION',
          409,
          `Cannot CHECK_OUT booking in status ${booking.status}`,
        );
      }
      nextStatus = 'CHECKED_OUT';
      nextUnitStatus = 'DIRTY';
      if (booking.unitId) {
        housekeepingTaskId = `hk_${crypto.randomUUID().replace(/-/g, '')}`;
      }
    } else {
      if (booking.status !== 'PENDING' && booking.status !== 'CONFIRMED') {
        throw new AppError(
          'INVALID_BOOKING_TRANSITION',
          409,
          `Cannot CANCEL booking in status ${booking.status}`,
        );
      }
      nextStatus = 'CANCELLED';
      nextUnitStatus = 'AVAILABLE';
    }

    const output: z.infer<typeof spacesBookingsTransitionOutputSchema> = {
      ok: true,
      bookingId: booking.id,
      unitId: booking.unitId,
      previousStatus: booking.status,
      status: nextStatus,
      unitStatus: booking.unitId ? nextUnitStatus : null,
      housekeepingTaskId,
    };

    const batchStatements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
      ctx.db
        .update(spcBookingsAndAppointments)
        .set({
          status: nextStatus,
          actualCheckIn:
            input.action === 'CHECK_IN' ? nowSec : booking.actualCheckIn,
          actualCheckOut:
            input.action === 'CHECK_OUT' ? nowSec : booking.actualCheckOut,
          checkInChecklistJson: input.checkInChecklist
            ? JSON.stringify(input.checkInChecklist)
            : undefined,
          updatedAt: nowSec,
        })
        .where(
          and(
            eq(spcBookingsAndAppointments.tenantId, ctx.tenantId),
            eq(spcBookingsAndAppointments.id, booking.id),
          ),
        ),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId,
        clientMutationId: input.clientMutationId,
        commandId: 'spaces.bookings.transition',
        requestHash,
        responseJson: JSON.stringify(output),
        nowSec,
      }),
    ];

    if (booking.unitId && nextUnitStatus) {
      batchStatements.push(
        ctx.db
          .update(spcUnits)
          .set({ currentStatus: nextUnitStatus, updatedAt: nowSec })
          .where(
            and(
              eq(spcUnits.tenantId, ctx.tenantId),
              eq(spcUnits.id, booking.unitId),
            ),
          ),
      );
    }

    if (housekeepingTaskId && booking.unitId) {
      batchStatements.push(
        ctx.db.insert(spcHousekeepingTasks).values({
          id: housekeepingTaskId,
          tenantId: ctx.tenantId,
          orgId,
          unitId: booking.unitId,
          taskKind: 'CHECKOUT_CLEANING',
          priority: input.housekeepingPriority,
          assignedToStaffId: input.assignedToStaffId ?? null,
          scheduledFor: nowSec,
          status: 'PENDING',
          createdAt: nowSec,
          updatedAt: nowSec,
        }),
      );
    }

    await ctx.db.batch(batchStatements);
    return output;
  },
});

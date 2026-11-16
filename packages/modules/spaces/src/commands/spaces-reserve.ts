import type { SpaceLockResult } from '@shac/actor-branch';
import {
  assertOrgScope,
  kernelIdempotencyKeys,
  spcBookingsAndAppointments,
  spcFolios,
  spcUnits,
  spcUnitTypes,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand } from '@shac/kernel';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import {
  buildIdempotencyInsert,
  callBranchDoJson,
  computeCommandRequestHash,
  nowEpochSec,
  resolveOrgId,
} from '../lib/spaces-helpers.js';
import {
  spacesBookingsReserveInputSchema,
  spacesBookingsReserveOutputSchema,
} from './spaces-schemas.js';

export const spacesBookingsReserveCommand = defineCommand<
  typeof spacesBookingsReserveInputSchema,
  z.infer<typeof spacesBookingsReserveOutputSchema>,
  ShacD1Database
>({
  id: 'spaces.bookings.reserve',
  moduleId: 'spaces',
  method: 'POST',
  path: '/api/spaces/bookings/reserve',
  summary:
    'Acquire exclusive BranchInventoryDO space lock and persist booking + open folio in D1',
  requiredPermission: 'spaces.bookings.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Reserve a unit/slot atomically via BranchInventoryDO /space-lock then persist booking and folio in D1',
  },
  inputSchema: spacesBookingsReserveInputSchema,
  outputSchema: spacesBookingsReserveOutputSchema,
  async handler(ctx, input) {
    assertOrgScope(ctx, ctx.tenantId, ctx.orgPath);
    if (input.scheduledEnd <= input.scheduledStart) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        'scheduledEnd must be strictly greater than scheduledStart',
      );
    }

    const orgId = resolveOrgId(ctx, input.orgId);
    const requestHash = await computeCommandRequestHash(
      'spaces.bookings.reserve',
      {
        orgId,
        unitId: input.unitId,
        partyId: input.partyId,
        slotBucket: input.slotBucket,
        lockKind: input.lockKind,
        bookingKind: input.bookingKind,
        sourceChannel: input.sourceChannel,
        scheduledStart: input.scheduledStart,
        scheduledEnd: input.scheduledEnd,
        adultsCount: input.adultsCount,
        childrenCount: input.childrenCount,
        rateMinor: input.rateMinor ?? null,
        currency: input.currency ?? null,
      },
    );

    const [idemRows, unitRows] = await ctx.db.batch([
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
          unitId: spcUnits.id,
          currentStatus: spcUnits.currentStatus,
          baseRateMinor: spcUnitTypes.baseRateMinor,
        })
        .from(spcUnits)
        .innerJoin(
          spcUnitTypes,
          and(
            eq(spcUnitTypes.id, spcUnits.unitTypeId),
            eq(spcUnitTypes.tenantId, spcUnits.tenantId),
          ),
        )
        .where(
          and(
            eq(spcUnits.tenantId, ctx.tenantId),
            eq(spcUnits.orgId, orgId),
            eq(spcUnits.id, input.unitId),
            eq(spcUnits.isActive, true),
            isNull(spcUnits.deletedAt),
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
      return spacesBookingsReserveOutputSchema.parse(
        JSON.parse(idemHit.responseJson),
      );
    }

    const unit = unitRows[0];
    if (!unit) {
      throw new AppError(
        'UNIT_NOT_FOUND',
        404,
        `Space unit ${input.unitId} not found in organization ${orgId}`,
      );
    }

    const bookingId = `bkg_${crypto.randomUUID().replace(/-/g, '')}`;
    const folioId = `fol_${crypto.randomUUID().replace(/-/g, '')}`;
    const confirmationCode = `CNF-${bookingId.slice(4, 12).toUpperCase()}`;
    const folioNumber = `FOL-${folioId.slice(4, 12).toUpperCase()}`;

    // Acquire exclusive lock in BranchInventoryDO BEFORE writing to D1.
    const lockRes = await callBranchDoJson<SpaceLockResult>(
      ctx,
      orgId,
      '/space-lock',
      {
        clientMutationId: input.clientMutationId,
        spaceId: input.unitId,
        slotBucket: input.slotBucket,
        lockKind: input.lockKind,
        holderRefId: bookingId,
        partyNameMasked: input.partyNameMasked,
        checkInMs: input.scheduledStart,
        checkOutMs: input.scheduledEnd,
        expiresAtMs: input.expiresAtMs ?? null,
      },
    );

    const nowSec = nowEpochSec();
    const totalMinor = input.rateMinor ?? unit.baseRateMinor;
    const currency = (
      input.currency ?? ctx.profile.currency.baseCurrency
    ).toUpperCase();

    const output: z.infer<typeof spacesBookingsReserveOutputSchema> = {
      ok: true,
      bookingId,
      confirmationCode,
      folioId,
      folioNumber,
      unitId: input.unitId,
      slotBucket: input.slotBucket,
      status: 'CONFIRMED',
      totalMinor,
      currency,
      lockOutboxSeqId: lockRes.outboxSeqId,
    };

    const chargesJson = JSON.stringify([
      {
        kind: 'ROOM_RATE',
        slotBucket: input.slotBucket,
        amountMinor: totalMinor,
        currency,
      },
    ]);

    await ctx.db.batch([
      ctx.db.insert(spcBookingsAndAppointments).values({
        id: bookingId,
        tenantId: ctx.tenantId,
        orgId,
        confirmationCode,
        bookingKind: input.bookingKind,
        partyId: input.partyId,
        unitId: input.unitId,
        sourceChannel: input.sourceChannel,
        scheduledStart: input.scheduledStart,
        scheduledEnd: input.scheduledEnd,
        adultsCount: input.adultsCount,
        childrenCount: input.childrenCount,
        specialRequests: input.specialRequests ?? null,
        totalMinor,
        paidMinor: 0,
        status: 'CONFIRMED',
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      ctx.db.insert(spcFolios).values({
        id: folioId,
        tenantId: ctx.tenantId,
        orgId,
        folioNumber,
        bookingId,
        partyId: input.partyId,
        unitId: input.unitId,
        currency,
        chargesJson,
        subtotalMinor: totalMinor,
        taxMinor: 0,
        totalMinor,
        paidMinor: 0,
        balanceMinor: totalMinor,
        status: 'OPEN',
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      ctx.db
        .update(spcUnits)
        .set({
          currentStatus:
            unit.currentStatus === 'AVAILABLE' ? 'RESERVED' : unit.currentStatus,
          updatedAt: nowSec,
        })
        .where(
          and(eq(spcUnits.tenantId, ctx.tenantId), eq(spcUnits.id, input.unitId)),
        ),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId,
        clientMutationId: input.clientMutationId,
        commandId: 'spaces.bookings.reserve',
        requestHash,
        responseJson: JSON.stringify(output),
        nowSec,
      }),
    ]);

    return output;
  },
});
